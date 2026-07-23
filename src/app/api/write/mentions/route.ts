import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import {
  getLinkedInUnipileAccountId,
  searchLinkedInPeople,
} from '@/lib/signals/outreach/unipile-linkedin';

export const dynamic = 'force-dynamic';

/**
 * GET /api/write/mentions?q=<name>: LinkedIn people-search through the user's
 * own connected Unipile account. Powers the Write page's @mention typeahead;
 * each suggestion's `id` is the profile_id Unipile post mentions expect.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const q = request.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) return NextResponse.json({ suggestions: [] });

  const client = getServerClient();
  const accountId = await getLinkedInUnipileAccountId(client, user.id);
  if (!accountId) {
    return NextResponse.json(
      { suggestions: [], error: 'Connect LinkedIn in Settings to mention people.' },
      { status: 200 },
    );
  }

  const suggestions = await searchLinkedInPeople(accountId, q, 5);
  return NextResponse.json({ suggestions });
}
