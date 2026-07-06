import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { assertAgentScope, resolveAgentAuth } from '@/lib/agent-auth/context';
import { getEngagementInbox, type InboxFilter } from '@/lib/engagement/inbox';

const FILTERS: InboxFilter[] = ['all', 'needs_reply', 'drafted', 'sent'];

/**
 * GET /api/agent/v1/engagement/inbox — comment inbox for the creator.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await resolveAgentAuth(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const scopeErr = assertAgentScope(auth, 'read');
  if (scopeErr) return NextResponse.json({ error: scopeErr }, { status: 403 });

  const rawFilter = request.nextUrl.searchParams.get('filter') ?? 'all';
  const filter = FILTERS.includes(rawFilter as InboxFilter) ? (rawFilter as InboxFilter) : 'all';
  const postId = request.nextUrl.searchParams.get('postId') ?? undefined;

  const client = getServiceClient();

  try {
    const result = await getEngagementInbox(client, auth.userId, filter, postId);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[agent/engagement/inbox]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load inbox' },
      { status: 500 },
    );
  }
}
