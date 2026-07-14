import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';

/**
 * GET /api/event-capture/dismissed
 * Returns all soft-dismissed captures within the last 7 days.
 * Dismissed events are recoverable - they appear in a separate "Dismissed" tab.
 * After 7 days the row remains in the DB but is no longer surfaced (no hard delete).
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

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const client = getServerClient();

  const { data, error } = await client.database
    .from('event_captures')
    .select(
      'id, title, description, location, start_time, end_time, event_type, is_public_event, status, dismissed_at, created_at',
    )
    .eq('workspace_id', workspaceId)
    .eq('status', 'dismissed')
    .gte('dismissed_at', sevenDaysAgo)
    .order('dismissed_at', { ascending: false });

  if (error) {
    console.error('[event-capture/dismissed] GET error', error);
    return NextResponse.json({ error: 'Failed to fetch dismissed captures' }, { status: 500 });
  }

  return NextResponse.json({ captures: data ?? [] });
}
