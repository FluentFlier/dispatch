import type { getInsforgeClient } from '@/lib/insforge/client';

type InsforgeClient = ReturnType<typeof getInsforgeClient>;

/**
 * Read access token from InsForge client after OAuth/password sign-in.
 * SDK stores tokens in tokenManager (runtime property, not in public TS types).
 */
export function getClientAccessToken(client: InsforgeClient): string | null {
  const auth = client.auth as unknown as Record<string, unknown>;
  const candidates = [
    auth.tokenManager,
    (client as unknown as Record<string, unknown>).tokenManager,
  ];

  for (const tm of candidates) {
    if (!tm || typeof tm !== 'object') continue;
    const mgr = tm as {
      getAccessToken?: () => string | null;
      getSession?: () => { accessToken?: string } | null;
    };
    if (typeof mgr.getAccessToken === 'function') {
      const token = mgr.getAccessToken();
      if (token) return token;
    }
    if (typeof mgr.getSession === 'function') {
      const session = mgr.getSession();
      if (session?.accessToken) return session.accessToken;
    }
  }

  return null;
}
