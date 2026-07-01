import { executeComposioTool } from '@/lib/composio/execute';
import type { NormalizedEvent } from '@/lib/event-capture/sources/types';

interface GoogleCalendarItem {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: Array<{ displayName?: string; email?: string }>;
}

/**
 * Converts raw Google Calendar items into source-agnostic NormalizedEvent rows.
 * Drops all-day events (no dateTime) and items missing id/summary/times, because
 * event capture only handles timed, titled events. Pure function - unit tested.
 */
export function normalizeGoogleEvents(items: GoogleCalendarItem[]): NormalizedEvent[] {
  const out: NormalizedEvent[] = [];
  for (const item of items ?? []) {
    if (!item.id || !item.summary) continue;
    const start = item.start?.dateTime ? new Date(item.start.dateTime) : null;
    const end = item.end?.dateTime ? new Date(item.end.dateTime) : null;
    if (!start || !end) continue;
    out.push({
      providerEventId: item.id,
      source: 'google',
      title: item.summary,
      description: item.description ?? null,
      location: item.location ?? null,
      attendees: item.attendees
        ? item.attendees.map((a) => ({ name: a.displayName ?? a.email ?? 'Unknown' }))
        : null,
      startTime: start,
      endTime: end,
    });
  }
  return out;
}

/**
 * Fetches timed calendar events for a Composio-connected user within a window
 * using the GOOGLECALENDAR_FIND_EVENTS tool, then normalizes them. Returns []
 * (never throws) so one bad integration cannot kill the cron loop.
 */
export async function findCalendarEvents(
  composioUserId: string,
  timeMin: Date,
  timeMax: Date,
  calendarId = 'primary',
): Promise<NormalizedEvent[]> {
  // TODO(verify): confirm GOOGLECALENDAR_FIND_EVENTS arg names + response shape against Composio dashboard before production
  const result = await executeComposioTool<{ items?: GoogleCalendarItem[] }>(
    composioUserId,
    'GOOGLECALENDAR_FIND_EVENTS',
    {
      calendar_id: calendarId,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      single_events: true,
      order_by: 'startTime',
    },
  );

  if (!result.success) {
    console.warn('[event-capture:calendar-read] Composio find events failed', { error: result.error });
    return [];
  }
  return normalizeGoogleEvents(result.data?.items ?? []);
}
