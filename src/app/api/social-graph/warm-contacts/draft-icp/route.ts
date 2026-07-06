import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { bulkDraftIcpWarmContacts } from '@/lib/social-graph/warm-contacts';
import { guardAiRequest } from '@/lib/ai-guard';

/**
 * POST /api/social-graph/warm-contacts/draft-icp — batch draft top new ICP contacts.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const guard = await guardAiRequest(user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  let limit = 5;
  try {
    const body = await request.json().catch(() => ({}));
    if (typeof body?.limit === 'number') limit = body.limit;
  } catch {
    // ok
  }

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);

  try {
    const result = await bulkDraftIcpWarmContacts(client, user.id, workspaceId, limit);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[social-graph/warm-contacts/draft-icp]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Bulk draft failed' },
      { status: 500 },
    );
  }
}
