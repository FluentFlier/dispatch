import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import {
  assertAgentScope,
  getWorkspaceHint,
  resolveAgentAuth,
  resolveAgentWorkspaceId,
} from '@/lib/agent-auth/context';
import { draftWarmContactOutreach } from '@/lib/social-graph/warm-contacts';
import { guardAiRequest } from '@/lib/ai-guard';

/**
 * POST /api/agent/v1/warm-contacts/[id]/draft - draft LinkedIn connect note (write + outreach).
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const auth = await resolveAgentAuth(_request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const scopeErr = assertAgentScope(auth, 'outreach');
  if (scopeErr) return NextResponse.json({ error: scopeErr }, { status: 403 });

  const guard = await guardAiRequest(auth.userId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const client = getServiceClient();
  const workspaceId = await resolveAgentWorkspaceId(auth.userId, getWorkspaceHint(_request));

  try {
    const result = await draftWarmContactOutreach(
      client,
      auth.userId,
      workspaceId,
      params.id,
    );
    if (!result.contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, draft: result.draft, contact: result.contact });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Draft failed' },
      { status: 500 },
    );
  }
}
