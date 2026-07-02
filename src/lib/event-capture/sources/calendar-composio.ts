import type { SignalIntegrationRow } from '@/lib/signals/integrations/store';
import { findCalendarEvents, type CalendarFetchResult } from '@/lib/composio/actions/calendar-read';

/** Cron/deletion lookback window in hours. Single source so the fetch window and the soft-cancel window can never drift. */
export const CALENDAR_LOOKBACK_HOURS = 3;

/**
 * Pulls recent timed events for one workspace's Composio Google Calendar
 * integration. `config.calendar_id` selects the calendar (defaults to 'primary').
 * Window: [now - lookbackHours, now] so we only see events that have started/ended.
 * Returns the raw CalendarFetchResult so the caller can distinguish a genuinely
 * empty calendar from a provider failure before running any deletion pass.
 */
export async function pullCalendarEvents(
  integration: SignalIntegrationRow,
  now: Date,
  lookbackHours = CALENDAR_LOOKBACK_HOURS,
): Promise<CalendarFetchResult> {
  const calendarId = integration.config.calendar_id ?? 'primary';
  const timeMin = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);
  return findCalendarEvents(integration.composio_user_id, timeMin, now, calendarId);
}
