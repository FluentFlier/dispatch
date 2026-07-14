import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import {
  assertAgentScope,
  getWorkspaceHint,
  resolveAgentAuth,
  resolveAgentWorkspaceId,
} from '@/lib/agent-auth/context';
import {
  draftWarmContactOutreach,
  listWarmContacts,
  syncWarmContacts,
} from '@/lib/social-graph/warm-contacts';
import { guardAiRequest } from '@/lib/ai-guard';

/**
 * GET /api/agent/v1/warm-contacts - ICP-bucketed engagers from your posts.
 * POST /api/agent/v1/warm-contacts/sync - refresh from post reactions.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await resolveAgentAuth(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const scopeErr = assertAgentScope(auth, 'read');
  if (scopeErr) return NextResponse.json({ error: scopeErr }, { status: 403 });

  const params = request.nextUrl.searchParams;
  const client = getServiceClient();

  try {
    const result = await listWarmContacts(client, auth.userId, {
      status: params.get('status') ?? undefined,
      category: params.get('category') ?? 'ICP',
      limit: parseInt(params.get('limit') ?? '50', 10),
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load warm contacts' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await resolveAgentAuth(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const scopeErr = assertAgentScope(auth, 'read');
  if (scopeErr) return NextResponse.json({ error: scopeErr }, { status: 403 });

  let maxPosts = 10;
  try {
    const body = await request.json().catch(() => ({}));
    if (typeof body?.maxPosts === 'number') maxPosts = body.maxPosts;
  } catch {
    // ok
  }

  const client = getServiceClient();
  const workspaceId = await resolveAgentWorkspaceId(auth.userId, getWorkspaceHint(request));

  try {
    const result = await syncWarmContacts(client, auth.userId, workspaceId, { maxPosts });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 },
    );
  }
}
