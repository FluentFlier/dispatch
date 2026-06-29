import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getInMailBalance, getLinkedInUnipileAccountId } from '@/lib/signals/outreach/unipile-linkedin';
import { errorResponse } from '@/lib/api-errors';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  const includeInmail = request.nextUrl.searchParams.get('inmail') === 'true';

  try {
    const client = getServerClient();
    const accountId = await getLinkedInUnipileAccountId(client, user.id, workspaceId);
    if (!accountId) {
      return NextResponse.json({
        connected: false,
        inmail: null,
      });
    }

    const inmail = includeInmail ? await getInMailBalance(accountId) : null;
    return NextResponse.json({
      connected: true,
      account_id: accountId,
      inmail,
    });
  } catch (err) {
    return errorResponse('Could not load LinkedIn status.', 500, err);
  }
}
