import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getEvent } from '@/lib/signals/store';
import { getIntegration } from '@/lib/signals/integrations/store';
import { createCalendarFollowUp } from '@/lib/composio/actions/calendar';
import { isComposioConfigured } from '@/lib/composio/config';
import { errorResponse } from '@/lib/api-errors';

const CalendarSchema = z.object({
  start_iso: z.string().datetime(),
  end_iso: z.string().datetime(),
  attendee_email: z.string().email().optional(),
  summary: z.string().min(3).max(200).optional(),
}).strict();

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  if (!isComposioConfigured()) {
    return NextResponse.json({ error: 'Composio is not configured' }, { status: 503 });
  }

  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  let body: z.infer<typeof CalendarSchema>;
  try {
    body = CalendarSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const client = getServerClient();
    const integration = await getIntegration(client, workspaceId, 'googlecalendar');
    if (!integration?.enabled) {
      return NextResponse.json(
        { error: 'Connect Google Calendar in Settings first.' },
        { status: 400 },
      );
    }

    const event = await getEvent(client, workspaceId, params.id);
    if (!event) return NextResponse.json({ error: 'Signal not found' }, { status: 404 });

    const target = event.company_name || event.person_name || 'prospect';
    const summary =
      body.summary ?? `Follow up: ${target}${event.batch ? ` (${event.batch})` : ''}`;

    const result = await createCalendarFollowUp(integration.composio_user_id, {
      summary,
      description: event.signal_summary ?? undefined,
      startIso: body.start_iso,
      endIso: body.end_iso,
      attendeeEmail: body.attendee_email,
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }

    return NextResponse.json({
      event_id: result.eventId,
      html_link: result.htmlLink,
    });
  } catch (err) {
    return errorResponse('Could not create calendar event.', 500, err);
  }
}
