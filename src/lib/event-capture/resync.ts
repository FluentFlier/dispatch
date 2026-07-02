import type { createClient } from '@insforge/sdk';
import type { SignalIntegrationRow } from '@/lib/signals/integrations/store';
import { findCalendarEvents } from '@/lib/composio/actions/calendar-read';
import { ingestEvents, cancelMissingEvents } from '@/lib/event-capture/ingest';
import type { ResolvedWindow } from '@/lib/event-capture/window';

type InsforgeClient = ReturnType<typeof createClient>;

export interface ResyncResult {
  created: number;
  updated: number;
  cancelled: number;
  errors: string[];
}

/**
 * Runs a full manual reload for one workspace's Google Calendar integration over
 * an explicit window: pulls events, ingests them in 'replace' mode (fresh-start
 * overwrite, id-stable), then soft-cancels window events deleted in Google.
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
    return { created: 0, updated: 0, cancelled: 0, errors: ['Calendar has no connected user — reconnect.'] };
  }

  const calendarId = integration.config.calendar_id ?? 'primary';
  const events = await findCalendarEvents(integration.composio_user_id, window.timeMin, window.timeMax, calendarId);

  const { created, updated } = await ingestEvents(
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

  return { created, updated, cancelled, errors };
}
