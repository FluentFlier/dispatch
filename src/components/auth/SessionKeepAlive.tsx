'use client';

import { useEffect } from 'react';
import { getInsforgeClient } from '@/lib/insforge/client';

/**
 * Proactively refreshes the session BEFORE the access token expires, so the user
 * never hits the expired-token 401 -> TokenRefreshGate -> reload jank.
 *
 * Why this exists: on the web sign-in flow the InsForge refresh token is kept in
 * InsForge's own httpOnly cookie and is never exposed to JS, so our server-side
 * `content-os-refresh` cookie can't be populated and the server cannot refresh on
 * its own. The only working refresh path is the browser SDK's refreshSession()
 * (which uses that httpOnly cookie). We drive it on a schedule derived from the
 * access token's own `exp`, then sync the fresh token into our httpOnly cookie so
 * server-side getAuthenticatedUser() keeps seeing a valid token.
 *
 * Safe by construction: if refreshSession() fails (e.g. dev cross-origin cookie),
 * it's a silent no-op and the reactive TokenRefreshGate still handles recovery.
 */
const REFRESH_SKEW_MS = 120_000; // refresh ~2 min before expiry
const FALLBACK_INTERVAL_MS = 10 * 60_000; // if exp is unreadable, refresh every 10 min
const MIN_DELAY_MS = 1_000;

/** Decode a JWT's exp (ms epoch) without verification; null if unreadable. */
function decodeExpMs(token: string | null): number | null {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '=='.slice(0, (4 - (payload.length % 4)) % 4);
    const claims = JSON.parse(atob(padded)) as { exp?: number };
    return typeof claims.exp === 'number' ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}

export default function SessionKeepAlive() {
  useEffect(() => {
    const client = getInsforgeClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    /** Read the access token the SDK holds in memory (for its exp). */
    function currentAccessToken(): string | null {
      try {
        const auth = client.auth as unknown as { tokenManager?: { getAccessToken?: () => unknown } };
        const t = auth.tokenManager?.getAccessToken?.();
        return typeof t === 'string' && t.length > 0 ? t : null;
      } catch {
        return null;
      }
    }

    /** Refresh via the SDK (InsForge httpOnly cookie) and sync into our cookie. */
    async function refreshAndSync(): Promise<void> {
      try {
        const { data, error } = await client.auth.refreshSession();
        if (error || !data?.accessToken) return;
        await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            token: data.accessToken,
            refreshToken: (data as { refreshToken?: string }).refreshToken ?? null,
          }),
        });
      } catch {
        // No-op: reactive TokenRefreshGate remains the fallback.
      }
    }

    function schedule(): void {
      if (cancelled) return;
      const exp = decodeExpMs(currentAccessToken());
      const delay = exp
        ? Math.max(MIN_DELAY_MS, exp - Date.now() - REFRESH_SKEW_MS)
        : FALLBACK_INTERVAL_MS;
      timer = setTimeout(async () => {
        await refreshAndSync();
        schedule(); // re-derive the next delay from the fresh token
      }, delay);
    }

    // Returning to a backgrounded tab is a common expiry point — re-arm immediately.
    function onVisible(): void {
      if (document.visibilityState !== 'visible') return;
      if (timer) clearTimeout(timer);
      schedule();
    }

    schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return null;
}
