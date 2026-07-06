import { createHash, randomBytes } from 'crypto';
import type { AgentScope } from '@/lib/agent-auth/types';
import { AGENT_SCOPES, DEFAULT_AGENT_SCOPES } from '@/lib/agent-auth/types';

export const AGENT_KEY_PREFIX = 'cos_live_';

/**
 * Hash a raw agent API key for storage. Keys are never persisted in plaintext.
 */
export function hashAgentApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

/**
 * Generate a new agent API key. The raw value is shown once at creation time.
 */
export function generateAgentApiKey(): { rawKey: string; keyPrefix: string; keyHash: string } {
  const suffix = randomBytes(24).toString('base64url');
  const rawKey = `${AGENT_KEY_PREFIX}${suffix}`;
  const keyPrefix = rawKey.slice(0, 16);
  return { rawKey, keyPrefix, keyHash: hashAgentApiKey(rawKey) };
}

/**
 * Normalize and validate scope arrays from user input.
 */
export function normalizeAgentScopes(input: unknown): AgentScope[] {
  if (!Array.isArray(input) || input.length === 0) return [...DEFAULT_AGENT_SCOPES];
  const allowed = new Set<string>(AGENT_SCOPES);
  const scopes = input.filter((s): s is AgentScope => typeof s === 'string' && allowed.has(s));
  return scopes.length > 0 ? scopes : [...DEFAULT_AGENT_SCOPES];
}

/**
 * Returns true when the Authorization header carries a Content OS agent key.
 */
export function isAgentApiKeyAuthorization(authHeader: string | null): boolean {
  if (!authHeader?.startsWith('Bearer ')) return false;
  const token = authHeader.slice('Bearer '.length).trim();
  return token.startsWith(AGENT_KEY_PREFIX);
}
