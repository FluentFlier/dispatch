import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';

interface RouteParams {
  params: { id: string };
}

/**
 * DELETE /api/calendar/connections/[id]
 * Disconnects a Google Calendar connection for the active workspace.
 * Validates workspace ownership before deletion — a user cannot delete another workspace's connection.
 * Sets sync_status='disconnected' first, then deletes — so any in-flight cron sees a clean state.
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: 'No active workspace' }, { status: 400 });
  }

  const client = getServerClient();

  // Verify the connection belongs to the active workspace before touching it.
  const { data: existing } = await client.database
    .from('calendar_connections')
    .select('id, workspace_id')
    .eq('id', params.id)
    .eq('workspace_id', workspaceId)
    .single();

  if (!existing) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
  }

  const { error } = await client.database
    .from('calendar_connections')
    .delete()
    .eq('id', params.id)
    .eq('workspace_id', workspaceId);

  if (error) {
    console.error('[calendar/connections/[id]] Delete error', error);
    return NextResponse.json({ error: 'Failed to disconnect calendar' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
