import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { buildUnifiedFeed, type FeedFilters } from '@/lib/signals/feed/store';
import { errorResponse } from '@/lib/api-errors';

/**
 * GET /api/leads/feed?status=&source=&kind=&signalType=
 * Unified Signals + Directory lead feed for the active workspace: both
 * sources are normalized into one card shape, merged, and score-sorted.
 * Query params are optional filters applied after the merge.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  const sp = request.nextUrl.searchParams;
  const filters: FeedFilters = {
    status: sp.get('status') ?? undefined,
    source: sp.get('source') ?? undefined,
    kind: (sp.get('kind') as FeedFilters['kind']) ?? undefined,
    signalType: sp.get('signalType') ?? undefined,
  };

  try {
    const client = getServerClient();
    const cards = await buildUnifiedFeed(client, workspaceId, filters);
    return NextResponse.json({ cards });
  } catch (err) {
    return errorResponse('Could not load feed.', 500, err);
  }
}
