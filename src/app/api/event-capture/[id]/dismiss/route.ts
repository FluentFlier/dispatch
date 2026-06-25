import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';

interface RouteParams {
  params: { id: string };
}

/**
 * POST /api/event-capture/[id]/dismiss
 * Soft-dismisses an event capture — the user has decided not to create content from it.
 * Sets status='dismissed' and dismissed_at=now().
 * Recoverable within 7 days via GET /api/event-capture/dismissed + POST /restore.
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
    .select('id, workspace_id')
    .eq('id', params.id)
    .eq('workspace_id', workspaceId)
    .single();

  if (!existing) {
    return NextResponse.json({ error: 'Capture not found' }, { status: 404 });
  }

  const { error } = await client.database
    .from('event_captures')
    .update({
      status: 'dismissed',
      dismissed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .eq('workspace_id', workspaceId);

  if (error) {
    console.error('[event-capture/dismiss] Update error', error);
    return NextResponse.json({ error: 'Failed to dismiss capture' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
