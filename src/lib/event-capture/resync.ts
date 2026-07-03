import type { createClient } from '@insforge/sdk';
import type { SignalIntegrationRow } from '@/lib/signals/integrations/store';
import { findCalendarEvents } from '@/lib/composio/actions/calendar-read';
import { ingestEvents, cancelMissingEvents } from '@/lib/event-capture/ingest';
import { enrichCapture } from '@/lib/event-capture/enrich';
import type { ResolvedWindow } from '@/lib/event-capture/window';

type InsforgeClient = ReturnType<typeof createClient>;

export interface ResyncResult {
  created: number;
  updated: number;
  cancelled: number;
  /** Captures that got Stage 2 (questions) run inline, so they're visible without waiting on a cron. */
  enriched: number;
  errors: string[];
}

interface PendingJobRow {
  id: string;
  payload: { event_capture_id: string };
}

/**
 * Runs a full manual reload for one workspace's Google Calendar integration over
 * an explicit window: pulls events, ingests them in 'replace' mode (fresh-start
 * overwrite, id-stable), soft-cancels window events deleted in Google, then runs
 * Stage 2 enrichment inline for every newly-touched capture. The inline enrich
 * step exists because a manual reload is a synchronous user action expecting to
 * see results immediately — the production event-enrich cron would otherwise be
 * the only thing that advances 'detected' -> 'questions_ready', and it doesn't
 * run on localhost, leaving reloaded events invisible in the inbox (which only
 * shows questions_ready/drafting/drafted).
 * Never throws — provider failures are collected into `errors` so the endpoint
 * can surface an actionable reason to the user.
 */
export async function resyncCalendar(
  client: InsforgeClient,
  integration: SignalIntegrationRow,
  window: ResolvedWindow,
  now: Date,
): Promise<ResyncResult> {
  const errors: string[] = [];
  const userId = integration.connected_by_user_id;
  if (!userId) {
    return { created: 0, updated: 0, cancelled: 0, enriched: 0, errors: ['Calendar has no connected user — reconnect.'] };
  }

  const calendarId = integration.config.calendar_id ?? 'primary';
  const fetchResult = await findCalendarEvents(integration.composio_user_id, window.timeMin, window.timeMax, calendarId);
  if (!fetchResult.ok) {
    // Fetch failed — do NOT run the deletion pass (an empty set would soft-cancel the
    // user's whole window). Surface the reason so the endpoint can tell the user.
    return {
      created: 0,
      updated: 0,
      cancelled: 0,
      enriched: 0,
      errors: [fetchResult.error ?? 'Calendar fetch failed — reconnect and try again.'],
    };
  }
  const events = fetchResult.events;

  const { created, updated, enqueuedCaptureIds } = await ingestEvents(
    client,
    { workspaceId: integration.workspace_id, userId },
    events,
    now,
    'replace',
  );

  const cancelled = await cancelMissingEvents(
    client,
    { workspaceId: integration.workspace_id },
    window,
    new Set(events.map((e) => e.providerEventId)),
  );

  const enriched = await enrichNow(client, integration.workspace_id, enqueuedCaptureIds, now);

  return { created, updated, cancelled, enriched, errors };
}

/**
 * Runs enrichCapture inline for each just-ingested capture, then marks its
 * enrich_event job 'done' so the cron doesn't redo the work (and overwrite
 * questions the user may already be answering) when it eventually runs.
 * Enrichment failures are swallowed per-capture — the capture stays 'detected'
 * and the cron will pick it up later; a reload should never fail on this.
 */
async function enrichNow(
  client: InsforgeClient,
  workspaceId: string,
  captureIds: string[],
  now: Date,
): Promise<number> {
  if (captureIds.length === 0) return 0;

  const outcomes = await Promise.allSettled(captureIds.map((id) => enrichCapture(client, id, now)));
  const succeeded = outcomes.filter((o) => o.status === 'fulfilled' && o.value === 'questions_ready').length;

  const { data: pendingJobs } = await client.database
    .from('jobs')
    .select('id, payload')
    .eq('workspace_id', workspaceId)
    .eq('type', 'enrich_event')
    .eq('status', 'pending');

  const idSet = new Set(captureIds);
  const doneJobIds = ((pendingJobs as PendingJobRow[] | null) ?? [])
    .filter((j) => idSet.has(j.payload.event_capture_id))
    .map((j) => j.id);

  if (doneJobIds.length > 0) {
    await client.database.from('jobs').update({ status: 'done' }).in('id', doneJobIds);
  }

  return succeeded;
}
