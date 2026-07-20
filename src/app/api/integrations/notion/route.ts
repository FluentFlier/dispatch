import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getNotionConnection } from '@/lib/notion/store';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ connected: false });

  try {
    const row = await getNotionConnection(workspaceId);
    return NextResponse.json(row ? {
      connected: true,
      workspace_name: row.notion_workspace_name,
      user_name: row.notion_user_name,
      source_urls: row.source_urls,
      last_synced_at: row.last_synced_at,
      last_sync_error: row.last_sync_error,
    } : { connected: false });
  } catch (error) {
    console.error('[notion:mcp] status failed', error);
    return NextResponse.json({ connected: false, setup_required: true }, { status: 503 });
  }
}

export async function DELETE(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ ok: true });

  const { deleteNotionConnection } = await import('@/lib/notion/store');
  await deleteNotionConnection(workspaceId);
  return NextResponse.json({ ok: true });
}
