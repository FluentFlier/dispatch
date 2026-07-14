import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import {
  assertAgentScope,
  getWorkspaceHint,
  resolveAgentAuth,
  resolveAgentWorkspaceId,
} from '@/lib/agent-auth/context';

/**
 * GET /api/agent/v1/session - bootstrap context for headless agents.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await resolveAgentAuth(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const scopeErr = assertAgentScope(auth, 'read');
  if (scopeErr) return NextResponse.json({ error: scopeErr }, { status: 403 });

  const client = getServiceClient();
  const workspaceId = await resolveAgentWorkspaceId(auth.userId, getWorkspaceHint(request));

  const { data: accounts } = await client.database
    .from('social_accounts')
    .select('platform, account_name, connected_at, health_status')
    .eq('user_id', auth.userId);

  const { data: profile } = await client.database
    .from('creator_profile')
    .select('display_name, onboarding_complete')
    .eq('user_id', auth.userId)
    .maybeSingle();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;

  return NextResponse.json({
    user: { id: auth.userId, email: auth.email || undefined },
    auth: { kind: auth.kind, scopes: auth.scopes, key_id: auth.keyId },
    workspace_id: workspaceId,
    profile: profile ?? null,
    connected_platforms: (accounts ?? []).map((a: Record<string, unknown>) => ({
      platform: a.platform,
      account_name: a.account_name,
      connected_at: a.connected_at,
      health_status: a.health_status,
    })),
    docs: `${appUrl}/api/agent/v1/skill`,
  });
}
