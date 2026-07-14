import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { syncWarmContacts } from '@/lib/social-graph/warm-contacts';

/**
 * POST /api/social-graph/sync - pull post reactions into warm_contacts (UseSocial-style).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let maxPosts = 10;
  try {
    const body = await request.json().catch(() => ({}));
    if (typeof body?.maxPosts === 'number') maxPosts = Math.min(body.maxPosts, 25);
  } catch {
    // empty body ok
  }

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);

  try {
    const result = await syncWarmContacts(client, user.id, workspaceId, { maxPosts });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[social-graph/sync]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 },
    );
  }
}
