import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getEngagementInbox, type InboxFilter } from '@/lib/engagement/inbox';

const FILTERS: InboxFilter[] = ['all', 'needs_reply', 'drafted', 'sent'];

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rawFilter = request.nextUrl.searchParams.get('filter') ?? 'all';
  const filter = FILTERS.includes(rawFilter as InboxFilter)
    ? (rawFilter as InboxFilter)
    : 'all';
  const postId = request.nextUrl.searchParams.get('postId') ?? undefined;

  const client = getServerClient();

  try {
    const result = await getEngagementInbox(client, user.id, filter, postId);
    return NextResponse.json(result);
  } catch (err) {
    console.error('Engagement inbox error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load inbox' },
      { status: 500 },
    );
  }
}
