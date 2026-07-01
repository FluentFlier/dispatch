import type { createClient } from '@insforge/sdk';
import { shouldCaptureEvent, classifyEventType, isPublicEvent } from '@/lib/event-capture/filter';
import type { NormalizedEvent } from '@/lib/event-capture/sources/types';

type InsforgeClient = ReturnType<typeof createClient>;

/**
 * Upserts normalized events into event_captures (DO NOTHING on conflict to
 * preserve user edits) and enqueues an enrich_event job for each NEW capture.
 * Shared by every detection source so upsert semantics live in exactly one place.
 * Returns the count of newly inserted captures.
 */
export async function ingestEvents(
  client: InsforgeClient,
  owner: { workspaceId: string; userId: string; calendarConnectionId?: string | null },
  events: NormalizedEvent[],
  now: Date,
): Promise<number> {
  let created = 0;

  for (const ev of events) {
    if (!shouldCaptureEvent({ title: ev.title, startTime: ev.startTime, endTime: ev.endTime }, now)) {
      continue;
    }

    const eventType = classifyEventType(ev.title);
    const publicEvent = isPublicEvent(eventType);

    const { data: rows, error } = await client.database
      .from('event_captures')
      .upsert(
        {
          workspace_id: owner.workspaceId,
          user_id: owner.userId,
          calendar_connection_id: owner.calendarConnectionId ?? null,
          source: ev.source,
          provider_event_id: ev.providerEventId,
          title: ev.title,
          description: ev.description ?? null,
          location: ev.location ?? null,
          attendees: ev.attendees ?? null,
          start_time: ev.startTime.toISOString(),
          end_time: ev.endTime.toISOString(),
          event_type: eventType,
          is_public_event: publicEvent,
          status: 'detected',
        },
        { onConflict: 'workspace_id,provider_event_id', ignoreDuplicates: true },
      )
      .select('id');

    if (error) {
      console.warn('[event-capture:ingest] upsert failed', { providerEventId: ev.providerEventId, error });
      continue;
    }

    if (rows && rows.length > 0) {
      const captureId = (rows[0] as { id: string }).id;
      // Enqueue the enrich job. If this fails the capture is inserted but would
      // never be enriched, so log loudly rather than silently orphaning it.
      const { error: jobError } = await client.database.from('jobs').insert({
        type: 'enrich_event',
        workspace_id: owner.workspaceId,
        payload: { event_capture_id: captureId },
        status: 'pending',
      });
      if (jobError) {
        console.warn('[event-capture:ingest] enrich job enqueue failed', { captureId, error: jobError });
      }
      created++;
    }
  }

  return created;
}
