/** Scopes granted to agent API keys. Publish and outreach are opt-in for safety. */
export type AgentScope = 'read' | 'write' | 'publish' | 'outreach';

export const AGENT_SCOPES: AgentScope[] = ['read', 'write', 'publish', 'outreach'];

export const DEFAULT_AGENT_SCOPES: AgentScope[] = ['read', 'write'];

export interface AgentApiKeyRow {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  scopes: AgentScope[];
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface AgentAuthContext {
  kind: 'session' | 'api_key';
  userId: string;
  email: string;
  keyId?: string;
  scopes: AgentScope[];
}

export interface AgentKeyListItem {
  id: string;
  name: string;
  key_prefix: string;
  scopes: AgentScope[];
  last_used_at: string | null;
  created_at: string;
}
