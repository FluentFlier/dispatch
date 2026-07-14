import type { createClient } from '@insforge/sdk';
import { shouldCaptureEvent, classifyEventType, isPublicEvent } from '@/lib/event-capture/filter';
import type { NormalizedEvent } from '@/lib/event-capture/sources/types';

type InsforgeClient = ReturnType<typeof createClient>;

export type IngestMode = 'incremental' | 'replace';

export interface IngestResult {
  created: number;
  updated: number;
  /** Ids of captures that got a fresh enrich_event job enqueued this run. */
  enqueuedCaptureIds: string[];
}

/** Provider-owned columns that a calendar sync is allowed to overwrite. */
interface ProviderFields {
  title: string;
  description: string | null;
  location: string | null;
  attendees: unknown;
  start_time: string;
  end_time: string;
  event_type: string;
  is_public_event: boolean;
}

/**
 * Builds the provider-owned column set for one normalized event. These are the
 * only fields a sync writes on update; user-owned columns (status, edits) are
 * governed by the ingest mode, never blindly overwritten.
 */
function toProviderFields(ev: NormalizedEvent): ProviderFields {
  const eventType = classifyEventType(ev.title);
  return {
    title: ev.title,
    description: ev.description ?? null,
    location: ev.location ?? null,
    attendees: ev.attendees ?? null,
    start_time: ev.startTime.toISOString(),
    end_time: ev.endTime.toISOString(),
    event_type: eventType,
    is_public_event: isPublicEvent(eventType),
  };
}

/**
 * Returns true when any provider-owned field differs from the stored row, so we
 * only pay an UPDATE + enrich when the calendar actually changed. Attendees are
 * compared by JSON since they are a nested array.
 */
function providerFieldsChanged(existing: Record<string, unknown>, next: ProviderFields): boolean {
  return (
    existing.title !== next.title ||
    (existing.description ?? null) !== next.description ||
    (existing.location ?? null) !== next.location ||
    existing.start_time !== next.start_time ||
    existing.end_time !== next.end_time ||
    existing.event_type !== next.event_type ||
    JSON.stringify(existing.attendees ?? null) !== JSON.stringify(next.attendees ?? null)
  );
}

/**
 * Enqueues an enrich_event job for a capture. Logs loudly on failure rather than
 * silently orphaning the capture (it would otherwise never be enriched).
 */
async function enqueueEnrich(client: InsforgeClient, workspaceId: string, captureId: string): Promise<void> {
  const { error } = await client.database.from('jobs').insert({
    type: 'enrich_event',
    workspace_id: workspaceId,
    payload: { event_capture_id: captureId },
    status: 'pending',
  });
  if (error) {
    console.warn('[event-capture:ingest] enrich job enqueue failed', { captureId, error });
  }
}

/**
 * Upserts normalized events into event_captures keyed on the stable
 * (workspace_id, provider_event_id) pair so the DB id never churns and no
 * downstream reference is orphaned.
 *
 * mode='incremental' (cron): insert new, update only genuinely-changed provider
 * fields, preserve user status/edits. mode='replace' (manual reload): overwrite
 * all provider fields, reset status to 'detected' - the user's deliberate fresh
 * start. Google events over an explicit reload window bypass the recency filter.
 * Returns counts of newly inserted and updated captures.
 */
export async function ingestEvents(
  client: InsforgeClient,
  owner: { workspaceId: string; userId: string; calendarConnectionId?: string | null },
  events: NormalizedEvent[],
  now: Date,
  mode: IngestMode = 'incremental',
): Promise<IngestResult> {
  let created = 0;
  let updated = 0;
  const enqueuedCaptureIds: string[] = [];

  for (const ev of events) {
    // Calendar events go through the duration+recency+allow/block filter. Manual
    // reloads (replace) bypass recency so past/future events in the chosen window
    // still import. LinkedIn events are LLM-gated upstream and skip the filter.
    if (
      ev.source === 'google' &&
      !shouldCaptureEvent(
        { title: ev.title, startTime: ev.startTime, endTime: ev.endTime },
        now,
        { ignoreRecency: mode === 'replace' },
      )
    ) {
      continue;
    }

    const fields = toProviderFields(ev);

    const { data: existing, error: findError } = await client.database
      .from('event_captures')
      .select('*')
      .eq('workspace_id', owner.workspaceId)
      .eq('provider_event_id', ev.providerEventId)
      .maybeSingle();

    if (findError) {
      console.warn('[event-capture:ingest] lookup failed', { providerEventId: ev.providerEventId, error: findError });
      continue;
    }

    // --- New capture ---
    if (!existing) {
      const { data: insertedRows, error } = await client.database
        .from('event_captures')
        .insert({
          workspace_id: owner.workspaceId,
          user_id: owner.userId,
          calendar_connection_id: owner.calendarConnectionId ?? null,
          source: ev.source,
          provider_event_id: ev.providerEventId,
          ...fields,
          status: 'detected',
        })
        .select('id');

      if (error) {
        console.warn('[event-capture:ingest] insert failed', { providerEventId: ev.providerEventId, error });
        continue;
      }
      if (insertedRows && insertedRows.length > 0) {
        const newId = (insertedRows[0] as { id: string }).id;
        await enqueueEnrich(client, owner.workspaceId, newId);
        enqueuedCaptureIds.push(newId);
        created++;
      }
      continue;
    }

    // --- Existing capture ---
    const existingRow = existing as Record<string, unknown> & { id: string };
    if (mode === 'incremental' && !providerFieldsChanged(existingRow, fields)) {
      continue; // no change → no cost
    }

    // replace resets status; incremental preserves the user's advanced status.
    const patch = mode === 'replace' ? { ...fields, status: 'detected' } : { ...fields };

    const { error: updateError } = await client.database
      .from('event_captures')
      .update(patch)
      .eq('id', existingRow.id)
      .select('id');

    if (updateError) {
      console.warn('[event-capture:ingest] update failed', { providerEventId: ev.providerEventId, error: updateError });
      continue;
    }
    await enqueueEnrich(client, owner.workspaceId, existingRow.id);
    enqueuedCaptureIds.push(existingRow.id);
    updated++;
  }

  return { created, updated, enqueuedCaptureIds };
}

/**
 * Soft-cancels google-source captures that fall inside a fully-fetched window but
 * were absent from the provider response - i.e. deleted in Google. Marks
 * status='cancelled' instead of deleting so the row + id survive for any
 * downstream reference. Returns the number of rows cancelled.
 */
export async function cancelMissingEvents(
  client: InsforgeClient,
  owner: { workspaceId: string },
  window: { timeMin: Date; timeMax: Date },
  presentProviderIds: Set<string>,
): Promise<number> {
  const { data, error } = await client.database
    .from('event_captures')
    .select('id, provider_event_id')
    .eq('workspace_id', owner.workspaceId)
    .eq('source', 'google')
    .neq('status', 'cancelled')
    .gte('start_time', window.timeMin.toISOString())
    .lte('start_time', window.timeMax.toISOString());

  if (error) {
    console.warn('[event-capture:ingest] cancel lookup failed', { error });
    return 0;
  }

  const stale = ((data as Array<{ id: string; provider_event_id: string }> | null) ?? []).filter(
    (r) => !presentProviderIds.has(r.provider_event_id),
  );
  if (stale.length === 0) return 0;

  const { error: cancelError } = await client.database
    .from('event_captures')
    .update({ status: 'cancelled' })
    .in('id', stale.map((r) => r.id));

  if (cancelError) {
    console.warn('[event-capture:ingest] cancel update failed', { error: cancelError });
    return 0;
  }
  return stale.length;
}
