import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { startComposioConnect } from '@/lib/composio/connect';
import { isComposioConfigured } from '@/lib/composio/config';
import { errorResponse } from '@/lib/api-errors';

const QuerySchema = z.object({
  toolkit: z.enum(['slack', 'gmail', 'googlecalendar']),
  return: z.enum(['onboarding']).optional(),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isComposioConfigured()) {
    return NextResponse.json({ error: 'Composio is not configured' }, { status: 503 });
  }

  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  const parsed = QuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid toolkit' }, { status: 400 });
  }

  try {
    const returnTo =
      parsed.data.return === 'onboarding'
        ? '/onboarding?gmail_connected=true'
        : undefined;

    const { redirectUrl, composioUserId } = await startComposioConnect(
      workspaceId,
      user.id,
      parsed.data.toolkit,
      returnTo,
    );
    return NextResponse.json({ redirect_url: redirectUrl, composio_user_id: composioUserId });
  } catch (err) {
    return errorResponse('Could not start Composio connect.', 500, err);
  }
}
