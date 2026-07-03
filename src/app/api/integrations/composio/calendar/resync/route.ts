import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient, getServiceClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { isComposioConfigured } from '@/lib/composio/config';
import { getIntegration, patchIntegrationConfig } from '@/lib/signals/integrations/store';
import { resyncCalendar } from '@/lib/event-capture/resync';
import { errorResponse } from '@/lib/api-errors';

const BodySchema = z.object({
  timeMin: z.string().datetime(),
  timeMax: z.string().datetime(),
}).strict();

const MAX_SPAN_MS = 2 * 365 * 24 * 60 * 60 * 1000;
const RATE_LIMIT_MS = 60 * 1000;

/**
 * User-triggered manual Google Calendar reload over an explicit window. Fresh-start
 * reimport (mode='replace') that is id-stable and rate-limited so the destructive
 * re-enrich cannot be hammered at scale. Returns explicit counts + failure reasons
 * so the UI can tell the user exactly what to fix.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isComposioConfigured()) {
    return NextResponse.json({ error: 'Composio is not configured. Set COMPOSIO_API_KEY.' }, { status: 503 });
  }

  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid window: timeMin and timeMax must be ISO datetimes.' }, { status: 400 });
  }

  const timeMin = new Date(body.timeMin);
  const timeMax = new Date(body.timeMax);
  if (timeMin >= timeMax) {
    return NextResponse.json({ error: 'Window start must be before end.' }, { status: 400 });
  }
  if (timeMax.getTime() - timeMin.getTime() > MAX_SPAN_MS) {
    return NextResponse.json({ error: 'Window too large — pick a range under 2 years.' }, { status: 400 });
  }

  try {
    const client = getServerClient();
    const integration = await getIntegration(client, workspaceId, 'googlecalendar');
    if (!integration || !integration.connected_by_user_id) {
      return NextResponse.json({ error: 'Google Calendar is not connected. Connect it first.' }, { status: 400 });
    }

    const now = new Date();
    const last = integration.config.last_manual_resync_at;
    if (last && now.getTime() - new Date(last).getTime() < RATE_LIMIT_MS) {
      return NextResponse.json({ error: 'Reload was just run — wait a minute before retrying.' }, { status: 429 });
    }
    await patchIntegrationConfig(client, workspaceId, 'googlecalendar', {
      last_manual_resync_at: now.toISOString(),
    });

    // Ingest writes event_captures + jobs, which are service-managed tables (the
    // hourly cron writes them via the service client too). Use the service client
    // here as well so the manual reload isn't blocked by their RLS policies.
    const result = await resyncCalendar(getServiceClient(), integration, { timeMin, timeMax }, now);

    const touched = result.created + result.updated + result.cancelled;
    if (result.errors.length > 0) {
      return NextResponse.json({ ...result, message: result.errors[0] }, { status: 502 });
    }
    const message =
      touched === 0
        ? 'No events found in this range. Check the window or your calendar selection.'
        : `Imported ${result.created} new, updated ${result.updated}, removed ${result.cancelled}. ${result.enriched} ready to view now.`;

    return NextResponse.json({ ...result, message });
  } catch (err) {
    return errorResponse('Calendar reload failed. Try again or reconnect the calendar.', 500, err);
  }
}
