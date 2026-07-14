import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';

interface RouteParams {
  params: { id: string };
}

/**
 * POST /api/event-capture/[id]/restore
 * Un-dismisses an event capture, sending it back to the inbox.
 * Restores status='questions_ready' and clears dismissed_at.
 * Only works within 7 days of dismissal (the caller's UI should enforce this,
 * but this route does not re-check age - the dismiss tab already filters to 7d).
 */
export async function POST(
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

  const { data: existing } = await client.database
    .from('event_captures')
    .select('id, workspace_id, status')
    .eq('id', params.id)
    .eq('workspace_id', workspaceId)
    .single();

  if (!existing) {
    return NextResponse.json({ error: 'Capture not found' }, { status: 404 });
  }

  const row = existing as { id: string; workspace_id: string; status: string };

  if (row.status !== 'dismissed') {
    return NextResponse.json({ error: 'Capture is not dismissed' }, { status: 409 });
  }

  const { error } = await client.database
    .from('event_captures')
    .update({
      status: 'questions_ready',
      dismissed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .eq('workspace_id', workspaceId);

  if (error) {
    console.error('[event-capture/restore] Update error', error);
    return NextResponse.json({ error: 'Failed to restore capture' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
