import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { errorResponse } from '@/lib/api-errors';
import { loadSeries } from '@/lib/series/db';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string; sourceId: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);
  const series = await loadSeries(client, params.id, user.id, workspaceId);
  if (!series) return NextResponse.json({ error: 'Series not found' }, { status: 404 });

  // series_chunks rows cascade via FK ON DELETE CASCADE.
  const { error } = await client.database
    .from('series_sources')
    .delete()
    .eq('id', params.sourceId)
    .eq('series_id', params.id)
    .eq('user_id', user.id);
  if (error) return errorResponse('Could not delete source.', 500, error);
  return NextResponse.json({ success: true });
}
