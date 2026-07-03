import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServiceClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { errorResponse } from '@/lib/api-errors';

/**
 * POST /api/integrations/composio/calendar/disconnect
 *
 * Disconnects the active workspace's Google Calendar by clearing the connection
 * marker on its signal_integrations row (connected_by_user_id -> null, disabled).
 * The status endpoint reports connected off `connected_by_user_id`, so this flips
 * the UI back to "Not connected" and stops the sync cron from processing it.
 * Scoped to the caller's active workspace; uses the service client since
 * signal_integrations is service-managed.
 */
export async function POST(_request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  try {
    const client = getServiceClient();
    const { error } = await client.database
      .from('signal_integrations')
      .update({
        connected_by_user_id: null,
        enabled: false,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('toolkit', 'googlecalendar');

    if (error) return errorResponse('Could not disconnect calendar.', 500, error);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse('Could not disconnect calendar.', 500, err);
  }
}
