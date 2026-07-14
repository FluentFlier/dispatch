import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { planEngagerNurture } from '@/lib/social-graph/engager-nurture';

/**
 * POST /api/social-graph/warm-contacts/[id]/plan - start the full nurture
 * sequence for an engager: build a research dossier, then either queue a
 * value-add comment on a recent post (comment-first warmup) or draft a connect
 * note directly when no recent post is found. Human stays in the loop: this only
 * plans + drafts; sends still go through the safety-gated send endpoints/cron.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: 'No active workspace' }, { status: 400 });
  }

  const client = getServerClient();

  try {
    const result = await planEngagerNurture(client, user.id, workspaceId, params.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[social-graph/warm-contacts/plan]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Plan failed' },
      { status: 500 },
    );
  }
}
