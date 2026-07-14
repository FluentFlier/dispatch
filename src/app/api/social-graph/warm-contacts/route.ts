import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { listWarmContacts } from '@/lib/social-graph/warm-contacts';

/**
 * GET /api/social-graph/warm-contacts - people who reacted to your posts (ICP buckets).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const status = params.get('status') ?? undefined;
  const category = params.get('category') ?? undefined;
  const limit = parseInt(params.get('limit') ?? '100', 10);

  try {
    const client = getServerClient();
    const result = await listWarmContacts(client, user.id, { status, category, limit });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[social-graph/warm-contacts]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load warm contacts' },
      { status: 500 },
    );
  }
}
