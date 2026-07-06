import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import {
  assertAgentScope,
  getWorkspaceHint,
  resolveAgentAuth,
  resolveAgentWorkspaceId,
} from '@/lib/agent-auth/context';
import { listEvents } from '@/lib/signals/store';
import { errorResponse } from '@/lib/api-errors';

/**
 * GET /api/agent/v1/signals — list GTM signal events for outreach triage.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await resolveAgentAuth(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const scopeErr = assertAgentScope(auth, 'read');
  if (scopeErr) return NextResponse.json({ error: scopeErr }, { status: 403 });

  const workspaceId = await resolveAgentWorkspaceId(auth.userId, getWorkspaceHint(request));
  if (!workspaceId) {
    return NextResponse.json({ error: 'No active workspace' }, { status: 400 });
  }

  const params = request.nextUrl.searchParams;
  const status = params.get('status') ?? undefined;
  const signalType = params.get('signal_type') ?? undefined;
  const limit = parseInt(params.get('limit') ?? '50', 10);

  try {
    const client = getServiceClient();
    const events = await listEvents(client, workspaceId, { status, signalType, limit });
    return NextResponse.json({ events });
  } catch (err) {
    return errorResponse('Could not load signals.', 500, err);
  }
}
