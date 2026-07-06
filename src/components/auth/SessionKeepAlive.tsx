'use client';

import { useEffect } from 'react';
import { getInsforgeClient } from '@/lib/insforge/client';

/**
 * Proactively refreshes the session BEFORE the access token expires, so the user
 * never hits the expired-token 401 -> TokenRefreshGate -> reload jank.
 *
 * Also runs an immediate refresh on mount (e.g. after a Vercel deploy) so the
 * server httpOnly cookie stays in sync with InsForge's browser session.
 */
const REFRESH_SKEW_MS = 120_000;
const FALLBACK_INTERVAL_MS = 10 * 60_000;
const MIN_DELAY_MS = 1_000;

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

    function currentAccessToken(): string | null {
      try {
        const auth = client.auth as unknown as { tokenManager?: { getAccessToken?: () => unknown } };
        const t = auth.tokenManager?.getAccessToken?.();
        return typeof t === 'string' && t.length > 0 ? t : null;
      } catch {
        return null;
      }
    }

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
        // TokenRefreshGate / restore-session remain fallbacks.
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
        schedule();
      }, delay);
    }

    function onVisible(): void {
      if (document.visibilityState !== 'visible') return;
      if (timer) clearTimeout(timer);
      void refreshAndSync().finally(schedule);
    }

    void refreshAndSync().finally(schedule);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return null;
}
