import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { assertAgentScope, resolveAgentAuth } from '@/lib/agent-auth/context';
import { syncEngagementComments } from '@/lib/engagement/sync';

/**
 * POST /api/agent/v1/engagement/sync — pull latest comments from connected accounts.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await resolveAgentAuth(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const scopeErr = assertAgentScope(auth, 'read');
  if (scopeErr) return NextResponse.json({ error: scopeErr }, { status: 403 });

  const client = getServiceClient();

  try {
    const result = await syncEngagementComments(client, auth.userId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[agent/engagement/sync]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed' },
      { status: 500 },
    );
  }
}
