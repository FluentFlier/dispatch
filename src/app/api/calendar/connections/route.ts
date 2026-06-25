import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';

/**
 * GET /api/calendar/connections
 * Lists all Google Calendar connections for the active workspace.
 * Returns sanitized rows — access_token and refresh_token are never exposed to the client.
 */
export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: 'No active workspace' }, { status: 400 });
  }

  const client = getServerClient();

  const { data, error } = await client.database
    .from('calendar_connections')
    .select(
      'id, provider, calendar_id, calendar_name, sync_enabled, sync_status, last_synced_at, created_at',
    )
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[calendar/connections] DB error', error);
    return NextResponse.json({ error: 'Failed to fetch connections' }, { status: 500 });
  }

  return NextResponse.json({ connections: data ?? [] });
}
