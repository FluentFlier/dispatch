import { executeComposioTool } from '@/lib/composio/execute';

export interface CalendarFollowUpInput {
  summary: string;
  description?: string;
  startIso: string;
  endIso: string;
  attendeeEmail?: string;
}

export async function createCalendarFollowUp(
  composioUserId: string,
  input: CalendarFollowUpInput,
): Promise<{ success: boolean; error?: string; eventId?: string; htmlLink?: string }> {
  const args: Record<string, unknown> = {
    summary: input.summary,
    description: input.description ?? '',
    start_datetime: input.startIso,
    end_datetime: input.endIso,
  };

  if (input.attendeeEmail) {
    args.attendees = [input.attendeeEmail];
  }

  const result = await executeComposioTool<{ id?: string; htmlLink?: string }>(
    composioUserId,
    'GOOGLECALENDAR_CREATE_EVENT',
    args,
  );

  if (!result.success) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    eventId: result.data?.id,
    htmlLink: result.data?.htmlLink,
  };
}
