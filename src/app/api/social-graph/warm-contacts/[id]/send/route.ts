import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { sendWarmContactConnect } from '@/lib/social-graph/outreach';

/**
 * POST /api/social-graph/warm-contacts/[id]/send — send LinkedIn connect (Signals safety gated).
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

  let noteOverride: string | undefined;
  try {
    const body = await request.json().catch(() => ({}));
    if (typeof body?.note === 'string') noteOverride = body.note;
  } catch {
    // empty body ok
  }

  const client = getServerClient();

  try {
    const result = await sendWarmContactConnect(
      client,
      workspaceId,
      user.id,
      params.id,
      { noteOverride },
    );

    if (!result.ok) {
      const status = result.status === 'blocked' ? 429 : 400;
      return NextResponse.json(
        {
          error: result.message,
          retryAfterSeconds: result.retryAfterSeconds,
        },
        { status },
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error('[social-graph/warm-contacts/send]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Send failed' },
      { status: 500 },
    );
  }
}
