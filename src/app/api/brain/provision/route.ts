import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { syncCreatorBrainFull } from '@/lib/brain/sync';
import { getActiveWorkspaceId } from '@/lib/workspace';

/**
 * Provisions and fully syncs the creator brain (profile, posts, wins).
 * Prefer this over a stub-only provision so new users get populated memory immediately.
 */
export async function POST(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);

  try {
    const result = await syncCreatorBrainFull(client, user.id, workspaceId ?? undefined);
    return NextResponse.json({
      ok: true,
      page_count: result.synced_posts,
      message: `Brain synced (${result.synced_posts} published posts)`,
      synced_posts: result.synced_posts,
    });
  } catch (err) {
    console.error('Brain provision error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Provision failed' },
      { status: 500 },
    );
  }
}
