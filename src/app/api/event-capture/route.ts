import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';

/**
 * GET /api/event-capture
 * Returns the inbox: all event captures with status in ['questions_ready', 'drafting', 'drafted']
 * for the active workspace, ordered newest-first by event end_time.
 * This is the primary feed shown on the /event-capture page.
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
    .from('event_captures')
    .select(
      'id, title, description, location, start_time, end_time, event_type, is_public_event, questions, status, created_at, updated_at',
    )
    .eq('workspace_id', workspaceId)
    .in('status', ['questions_ready', 'drafting', 'drafted'])
    .order('end_time', { ascending: false });

  if (error) {
    console.error('[event-capture] GET inbox error', error);
    return NextResponse.json({ error: 'Failed to fetch captures' }, { status: 500 });
  }

  return NextResponse.json({ captures: data ?? [] });
}
