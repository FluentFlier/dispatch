import { getServerClient, getServiceClient } from '@/lib/insforge/server';
import { generateAgentApiKey, normalizeAgentScopes } from '@/lib/agent-auth/keys';
import type { AgentKeyListItem, AgentScope } from '@/lib/agent-auth/types';

export interface CreateAgentKeyResult {
  id: string;
  name: string;
  key_prefix: string;
  scopes: AgentScope[];
  created_at: string;
  /** Shown once - not stored. */
  api_key: string;
}

/**
 * List active agent keys for the authenticated user (session cookie required).
 */
export async function listAgentKeys(userId: string): Promise<AgentKeyListItem[]> {
  const client = getServerClient();
  const { data, error } = await client.database
    .from('agent_api_keys')
    .select('id, name, key_prefix, scopes, last_used_at, created_at')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as AgentKeyListItem[];
}

/**
 * Mint a new agent API key. Returns the raw secret once.
 */
export async function createAgentKey(
  userId: string,
  name: string,
  scopesInput: unknown,
): Promise<CreateAgentKeyResult> {
  const scopes = normalizeAgentScopes(scopesInput);
  const { rawKey, keyPrefix, keyHash } = generateAgentApiKey();
  const client = getServerClient();

  const { data, error } = await client.database
    .from('agent_api_keys')
    .insert([
      {
        user_id: userId,
        name: name.trim(),
        key_prefix: keyPrefix,
        key_hash: keyHash,
        scopes,
      },
    ])
    .select('id, name, key_prefix, scopes, created_at')
    .single();

  if (error || !data) throw error ?? new Error('Failed to create agent key');

  return {
    ...(data as Omit<CreateAgentKeyResult, 'api_key'>),
    api_key: rawKey,
  };
}

/**
 * Revoke an agent key (soft delete). Uses service client for defense in depth.
 */
export async function revokeAgentKey(userId: string, keyId: string): Promise<boolean> {
  const client = getServiceClient();
  const { data, error } = await client.database
    .from('agent_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('user_id', userId)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();

  if (error) throw error;
  return Boolean(data?.id);
}
