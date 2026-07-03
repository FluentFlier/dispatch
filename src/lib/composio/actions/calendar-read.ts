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

/** Result of a calendar fetch: distinguishes a real empty calendar (ok:true, events:[]) from a provider failure (ok:false). */
export interface CalendarFetchResult {
  ok: boolean;
  events: NormalizedEvent[];
  error?: string;
}

/**
 * Pulls the Google Calendar events array out of a Composio tool response. Composio
 * wraps the raw provider payload under `data`, and the exact nesting has varied
 * (`data.items` vs `data.data.items` vs `data.response_data.items`), so probe the
 * known shapes rather than assuming one. Returns [] when none match.
 */
function extractEventItems(data: unknown): GoogleCalendarItem[] {
  const d = (data ?? {}) as Record<string, unknown>;
  const candidates: unknown[] = [
    d.items,
    (d.data as { items?: unknown } | undefined)?.items,
    (d.response_data as { items?: unknown } | undefined)?.items,
  ];
  const arr = candidates.find(Array.isArray);
  return (arr as GoogleCalendarItem[] | undefined) ?? [];
}

/**
 * Fetches timed calendar events for a Composio-connected user within a window
 * using the GOOGLECALENDAR_EVENTS_LIST tool, then normalizes them. Never throws,
 * but no longer silently masks failures: a provider error returns { ok: false }
 * so the caller MUST check `ok` before running any destructive deletion pass — an
 * empty result from a failed fetch would otherwise soft-cancel the whole window.
 */
export async function findCalendarEvents(
  composioUserId: string,
  timeMin: Date,
  timeMax: Date,
  calendarId = 'primary',
): Promise<CalendarFetchResult> {
  // Composio's Google Calendar toolkit exposes the events listing as
  // GOOGLECALENDAR_EVENTS_LIST (the earlier GOOGLECALENDAR_FIND_EVENTS slug does
  // not exist and 502s). max_results defaults to 10 on Composio, far too few for a
  // manual reload window, so raise it.
  const result = await executeComposioTool<Record<string, unknown>>(
    composioUserId,
    'GOOGLECALENDAR_EVENTS_LIST',
    {
      calendar_id: calendarId,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      single_events: true,
      order_by: 'startTime',
      max_results: 250,
    },
  );

  if (!result.success) {
    console.warn('[event-capture:calendar-read] Composio events list failed', { error: result.error });
    return { ok: false, events: [], error: String(result.error ?? 'Calendar fetch failed') };
  }
  return { ok: true, events: normalizeGoogleEvents(extractEventItems(result.data)) };
}
