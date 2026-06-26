import type { getInsforgeClient } from '@/lib/insforge/client';

type InsforgeClient = ReturnType<typeof getInsforgeClient>;

interface TokenPair {
  accessToken: string | null;
  refreshToken: string | null;
}

/**
 * Read access + refresh tokens from InsForge client after OAuth/password sign-in.
 *
 * InsForge SDK internals (verified from SDK source):
 * - accessToken lives in auth.tokenManager (via tokenManager.getAccessToken())
 * - refreshToken lives in auth.http.refreshToken (NOT tokenManager — it only stores accessToken+user)
 *
 * detectAuthCallback() strips ?insforge_code from the URL before our code reads it,
 * so we cannot rely on URL params to detect OAuth callbacks. Instead we just try to
 * read tokens after awaiting authCallbackHandled.
 */
export function getClientTokens(client: InsforgeClient): TokenPair {
  const auth = client.auth as unknown as Record<string, unknown>;

  // Access token: tokenManager.getAccessToken()
  let accessToken: string | null = null;
  const tm = auth.tokenManager;
  if (tm && typeof tm === 'object') {
    const mgr = tm as { getAccessToken?: () => unknown; getSession?: () => unknown };
    if (typeof mgr.getAccessToken === 'function') {
      const t = mgr.getAccessToken();
      if (typeof t === 'string' && t.length > 0) accessToken = t;
    }
    // Fallback: getSession().accessToken
    if (!accessToken && typeof mgr.getSession === 'function') {
      const s = mgr.getSession();
      if (s && typeof s === 'object') {
        const t = (s as Record<string, unknown>).accessToken;
        if (typeof t === 'string' && t.length > 0) accessToken = t;
      }
    }
  }

  if (!accessToken) return { accessToken: null, refreshToken: null };

  // Refresh token: auth.http.refreshToken (SDK stores it here, not in tokenManager)
  let refreshToken: string | null = null;
  const http = auth.http;
  if (http && typeof http === 'object') {
    const rt = (http as Record<string, unknown>).refreshToken;
    if (typeof rt === 'string' && rt.length > 0) refreshToken = rt;
  }

  return { accessToken, refreshToken };
}

/** Backwards-compat shim — use getClientTokens for new code. */
export function getClientAccessToken(client: InsforgeClient): string | null {
  return getClientTokens(client).accessToken;
}
