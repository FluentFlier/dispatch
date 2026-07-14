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
 * Cap on concurrent enrichCapture calls during an inline reload enrich pass.
 * A large manual reload window (capture-all filter, up to a 2-year span) can
 * ingest dozens of events in one request; running enrichCapture for all of them
 * unbounded-concurrently would fire that many simultaneous Haiku/Serper/Jina
 * calls per workspace. Bounded batching keeps latency/cost predictable per reload.
 */
const ENRICH_CONCURRENCY = 4;

/** Runs `fn` over `items` with at most `limit` in flight at once, preserving Promise.allSettled semantics. */
async function runBatched<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    results.push(...(await Promise.allSettled(batch.map(fn))));
  }
  return results;
}

/**
 * Runs a full manual reload for one workspace's Google Calendar integration over
 * an explicit window: pulls events, ingests them in 'replace' mode (fresh-start
 * overwrite, id-stable), soft-cancels window events deleted in Google, then runs
 * Stage 2 enrichment inline for every newly-touched capture. The inline enrich
 * step exists because a manual reload is a synchronous user action expecting to
 * see results immediately - the production event-enrich cron would otherwise be
 * the only thing that advances 'detected' -> 'questions_ready', and it doesn't
 * run on localhost, leaving reloaded events invisible in the inbox (which only
 * shows questions_ready/drafting/drafted).
 * Never throws - provider failures are collected into `errors` so the endpoint
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
    return { created: 0, updated: 0, cancelled: 0, enriched: 0, errors: ['Calendar has no connected user - reconnect.'] };
  }

  const calendarId = integration.config.calendar_id ?? 'primary';
  const fetchResult = await findCalendarEvents(integration.composio_user_id, window.timeMin, window.timeMax, calendarId);
  if (!fetchResult.ok) {
    // Fetch failed - do NOT run the deletion pass (an empty set would soft-cancel the
    // user's whole window). Surface the reason so the endpoint can tell the user.
    return {
      created: 0,
      updated: 0,
      cancelled: 0,
      enriched: 0,
      errors: [fetchResult.error ?? 'Calendar fetch failed - reconnect and try again.'],
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
 * Enrichment failures are swallowed per-capture - the capture stays 'detected'
 * and the cron will pick it up later; a reload should never fail on this.
 *
 * Passes ignoreRecency so a manual reload enriches past events too: the user
 * explicitly asked to import this window (including "All events"), so a class
 * from three weeks ago should still reach the inbox, not be skipped as stale.
 */
async function enrichNow(
  client: InsforgeClient,
  workspaceId: string,
  captureIds: string[],
  now: Date,
): Promise<number> {
  if (captureIds.length === 0) return 0;

  const outcomes = await runBatched(captureIds, ENRICH_CONCURRENCY, (id) => enrichCapture(client, id, now, { ignoreRecency: true }));
  // outcomes[i] aligns with captureIds[i] (runBatched preserves order). Only the
  // captures that actually reached 'questions_ready' should have their job marked
  // done - a failed/blocked capture must stay pending so the cron retries it,
  // otherwise it reverts to 'detected' and vanishes from the inbox forever.
  const succeededIds = new Set(
    captureIds.filter(
      (_, i) => outcomes[i].status === 'fulfilled' &&
        (outcomes[i] as PromiseFulfilledResult<string>).value === 'questions_ready',
    ),
  );
  const succeeded = succeededIds.size;

  const { data: pendingJobs } = await client.database
    .from('jobs')
    .select('id, payload')
    .eq('workspace_id', workspaceId)
    .eq('type', 'enrich_event')
    .eq('status', 'pending');

  const doneJobIds = ((pendingJobs as PendingJobRow[] | null) ?? [])
    .filter((j) => succeededIds.has(j.payload.event_capture_id))
    .map((j) => j.id);

  if (doneJobIds.length > 0) {
    await client.database.from('jobs').update({ status: 'done' }).in('id', doneJobIds);
  }

  return succeeded;
}
