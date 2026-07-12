import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { errorResponse } from '@/lib/api-errors';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  try {
    const client = getServerClient();
    const { error } = await client.database
      .from('signal_sources')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('id', params.id);
    if (error) return errorResponse('Could not remove source.', 500, error);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse('Could not remove source.', 500, err);
  }
}
