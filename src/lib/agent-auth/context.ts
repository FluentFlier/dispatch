import type { NextRequest } from 'next/server';
import { getAuthenticatedUser, getServiceClient } from '@/lib/insforge/server';
import {
  hashAgentApiKey,
  isAgentApiKeyAuthorization,
} from '@/lib/agent-auth/keys';
import type { AgentAuthContext, AgentScope } from '@/lib/agent-auth/types';
import { DEFAULT_AGENT_SCOPES } from '@/lib/agent-auth/types';

/**
 * Resolve workspace for agent calls. Agents lack the workspace cookie, so we
 * accept an explicit header/query or fall back to the user's solo workspace.
 */
export async function resolveAgentWorkspaceId(
  userId: string,
  explicit?: string | null,
): Promise<string | null> {
  if (explicit?.trim()) return explicit.trim();

  const client = getServiceClient();
  const { data: members } = await client.database
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId);

  const ids = ((members ?? []) as { workspace_id: string }[]).map((m) => m.workspace_id);
  if (ids.length === 0) return null;

  const { data: workspaces } = await client.database
    .from('workspaces')
    .select('id, type')
    .in('id', ids)
    .order('created_at', { ascending: true });

  const list = (workspaces ?? []) as { id: string; type: string }[];
  return list.find((w) => w.type === 'solo')?.id ?? list[0]?.id ?? null;
}

function workspaceFromRequest(request: NextRequest): string | null {
  return (
    request.headers.get('x-content-os-workspace') ??
    request.nextUrl.searchParams.get('workspace_id')
  );
}

/**
 * Authenticate a request via session cookie or Bearer agent API key.
 * Key lookup uses the service client because there is no user JWT for keys.
 */
export async function resolveAgentAuth(request: NextRequest): Promise<AgentAuthContext | null> {
  const authHeader = request.headers.get('authorization');

  if (isAgentApiKeyAuthorization(authHeader)) {
    const rawKey = authHeader!.slice('Bearer '.length).trim();
    const keyHash = hashAgentApiKey(rawKey);
    const client = getServiceClient();

    const { data: row } = await client.database
      .from('agent_api_keys')
      .select('id, user_id, scopes, revoked_at')
      .eq('key_hash', keyHash)
      .is('revoked_at', null)
      .maybeSingle();

    if (!row?.user_id) return null;

    const scopes = (Array.isArray(row.scopes) ? row.scopes : DEFAULT_AGENT_SCOPES) as AgentScope[];

    await client.database
      .from('agent_api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', row.id);

    return {
      kind: 'api_key',
      userId: row.user_id as string,
      email: '',
      keyId: row.id as string,
      scopes,
    };
  }

  const sessionUser = await getAuthenticatedUser();
  if (!sessionUser) return null;

  return {
    kind: 'session',
    userId: sessionUser.id,
    email: sessionUser.email,
    scopes: ['read', 'write', 'publish', 'outreach'],
  };
}

/**
 * Enforce that the authenticated agent context includes a required scope.
 */
export function assertAgentScope(ctx: AgentAuthContext, scope: AgentScope): string | null {
  if (ctx.kind === 'session') return null;
  if (ctx.scopes.includes(scope)) return null;
  return `API key missing required scope: ${scope}`;
}

export function getWorkspaceHint(request: NextRequest): string | null {
  return workspaceFromRequest(request);
}
