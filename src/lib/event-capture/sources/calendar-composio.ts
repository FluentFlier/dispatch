import type { NormalizedEvent } from '@/lib/event-capture/sources/types';
import type { SignalIntegrationRow } from '@/lib/signals/integrations/store';
import { findCalendarEvents } from '@/lib/composio/actions/calendar-read';

/**
 * Pulls recent timed events for one workspace's Composio Google Calendar
 * integration. `config.calendar_id` selects the calendar (defaults to 'primary').
 * Window: [now - lookbackHours, now] so we only see events that have started/ended.
 */
export async function pullCalendarEvents(
  integration: SignalIntegrationRow,
  now: Date,
  lookbackHours = 3,
): Promise<NormalizedEvent[]> {
  const calendarId =
    (integration.config as unknown as { calendar_id?: string }).calendar_id ?? 'primary';
  const timeMin = new Date(now.getTime() - lookbackHours * 60 * 60 * 1000);
  return findCalendarEvents(integration.composio_user_id, timeMin, now, calendarId);
}
