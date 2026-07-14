import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import {
  assertAgentScope,
  getWorkspaceHint,
  resolveAgentAuth,
  resolveAgentWorkspaceId,
} from '@/lib/agent-auth/context';
import { sendWarmContactConnect } from '@/lib/social-graph/outreach';

/**
 * POST /api/agent/v1/warm-contacts/[id]/send - send LinkedIn connect (outreach scope).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = await resolveAgentAuth(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const scopeErr = assertAgentScope(auth, 'outreach');
  if (scopeErr) return NextResponse.json({ error: scopeErr }, { status: 403 });

  const workspaceId = await resolveAgentWorkspaceId(auth.userId, getWorkspaceHint(request));
  if (!workspaceId) {
    return NextResponse.json({ error: 'Workspace required' }, { status: 400 });
  }

  let noteOverride: string | undefined;
  try {
    const body = await request.json().catch(() => ({}));
    if (typeof body?.note === 'string') noteOverride = body.note;
  } catch {
    // ok
  }

  const client = getServiceClient();

  try {
    const result = await sendWarmContactConnect(
      client,
      workspaceId,
      auth.userId,
      params.id,
      { noteOverride },
    );

    if (!result.ok) {
      const status = result.status === 'blocked' ? 429 : 400;
      return NextResponse.json(
        { error: result.message, retryAfterSeconds: result.retryAfterSeconds },
        { status },
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Send failed' },
      { status: 500 },
    );
  }
}
