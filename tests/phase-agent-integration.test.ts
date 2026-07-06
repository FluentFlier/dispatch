import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { NextRequest } from 'next/server';

vi.mock('@/lib/insforge/server', () => ({
  getAuthenticatedUser: vi.fn(),
  getServerClient: vi.fn(),
  getServiceClient: vi.fn(),
}));

import { getAuthenticatedUser, getServiceClient } from '@/lib/insforge/server';
import {
  AGENT_KEY_PREFIX,
  generateAgentApiKey,
  hashAgentApiKey,
  isAgentApiKeyAuthorization,
  normalizeAgentScopes,
} from '@/lib/agent-auth/keys';
import { assertAgentScope, resolveAgentAuth } from '@/lib/agent-auth/context';
import { GET as discoveryGet } from '@/app/api/agent/v1/route';
import { GET as sessionGet } from '@/app/api/agent/v1/session/route';

function chainableDb(result: { data: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.is = () => chain;
  chain.update = () => chain;
  chain.maybeSingle = () => Promise.resolve(result);
  chain.from = () => chain;
  return { database: { from: () => chain } };
}

describe('Phase: Agent integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('key crypto', () => {
    it('generates keys with cos_live_ prefix and unique hashes', () => {
      const a = generateAgentApiKey();
      const b = generateAgentApiKey();
      expect(a.rawKey.startsWith(AGENT_KEY_PREFIX)).toBe(true);
      expect(a.keyHash).toBe(hashAgentApiKey(a.rawKey));
      expect(a.keyHash).not.toBe(b.keyHash);
    });

    it('detects agent bearer tokens', () => {
      const { rawKey } = generateAgentApiKey();
      expect(isAgentApiKeyAuthorization(`Bearer ${rawKey}`)).toBe(true);
      expect(isAgentApiKeyAuthorization('Bearer session-jwt')).toBe(false);
    });

    it('normalizes scopes with safe defaults', () => {
      expect(normalizeAgentScopes([])).toEqual(['read', 'write']);
      expect(normalizeAgentScopes(['read', 'publish', 'bogus'])).toEqual(['read', 'publish']);
    });
  });

  describe('scope enforcement', () => {
    it('blocks publish when key lacks publish scope', () => {
      const err = assertAgentScope(
        { kind: 'api_key', userId: 'u1', email: '', scopes: ['read', 'write'], keyId: 'k1' },
        'publish',
      );
      expect(err).toMatch(/publish/);
    });

    it('allows all scopes for session auth', () => {
      expect(
        assertAgentScope(
          { kind: 'session', userId: 'u1', email: 'a@b.com', scopes: ['read'] },
          'publish',
        ),
      ).toBeNull();
    });
  });

  describe('resolveAgentAuth', () => {
    it('authenticates valid API keys via hash lookup', async () => {
      const rawKey = `${AGENT_KEY_PREFIX}testtoken123456789`;
      const keyHash = createHash('sha256').update(rawKey).digest('hex');

      vi.mocked(getServiceClient).mockReturnValue(
        chainableDb({
          data: {
            id: 'key-1',
            user_id: 'user-1',
            scopes: ['read', 'write'],
            revoked_at: null,
          },
        }) as unknown as ReturnType<typeof getServiceClient>,
      );

      const req = new NextRequest('http://localhost/api/agent/v1/session', {
        headers: { authorization: `Bearer ${rawKey}` },
      });

      const auth = await resolveAgentAuth(req);
      expect(auth?.userId).toBe('user-1');
      expect(auth?.kind).toBe('api_key');
      expect(keyHash).toBe(hashAgentApiKey(rawKey));
    });

    it('rejects unknown API keys', async () => {
      vi.mocked(getServiceClient).mockReturnValue(
        chainableDb({ data: null }) as unknown as ReturnType<typeof getServiceClient>,
      );
      vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

      const req = new NextRequest('http://localhost/api/agent/v1/session', {
        headers: { authorization: 'Bearer cos_live_unknown' },
      });

      const auth = await resolveAgentAuth(req);
      expect(auth).toBeNull();
    });
  });

  describe('agent v1 routes', () => {
    it('returns 401 without auth on discovery', async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValue(null);
      vi.mocked(getServiceClient).mockReturnValue(
        chainableDb({ data: null }) as unknown as ReturnType<typeof getServiceClient>,
      );

      const res = await discoveryGet(new NextRequest('http://localhost/api/agent/v1'));
      expect(res.status).toBe(401);
    });

    it('returns capabilities for session user', async () => {
      vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'u1', email: 'a@b.com' });

      const res = await discoveryGet(new NextRequest('http://localhost/api/agent/v1'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('Content OS Agent API');
      expect(body.endpoints.length).toBeGreaterThan(5);
    });

    it('returns 403 on session when key lacks read scope', async () => {
      const rawKey = `${AGENT_KEY_PREFIX}scoped`;
      vi.mocked(getServiceClient).mockImplementation(() => {
        const client = chainableDb({
          data: {
            id: 'key-1',
            user_id: 'user-1',
            scopes: [],
            revoked_at: null,
          },
        });
        return client as unknown as ReturnType<typeof getServiceClient>;
      });

      const req = new NextRequest('http://localhost/api/agent/v1/session', {
        headers: { authorization: `Bearer ${rawKey}` },
      });

      const res = await sessionGet(req);
      expect(res.status).toBe(403);
    });
  });
});
