'use client';

import { useEffect } from 'react';
import { refreshAppSessionWithFallback } from '@/lib/auth-client-refresh';

/**
 * Proactively refreshes the session BEFORE the access token expires.
 * Uses same-origin content-os-refresh cookie (not cross-origin InsForge cookies).
 */
const REFRESH_SKEW_MS = 120_000;
const FALLBACK_INTERVAL_MS = 45 * 60_000;
// Floor the self-scheduling delay well above 1s. Access tokens live ~15min and
// we refresh 120s early, so re-checking every 30s is ample - while a 1s floor let
// the loop hot-poll session+refresh once per second whenever a refresh failed to
// push expiry past the skew, which (with dev latency) became a request storm that
// froze the tab.
const MIN_DELAY_MS = 30_000;

export default function SessionKeepAlive() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    async function fetchSessionMeta(): Promise<{
      accessExpiresAt: number | null;
      hasRefreshToken: boolean;
    }> {
      try {
        const res = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
        if (!res.ok) return { accessExpiresAt: null, hasRefreshToken: false };
        const data = (await res.json()) as {
          accessExpiresAt?: number | null;
          hasRefreshToken?: boolean;
        };
        return {
          accessExpiresAt: typeof data.accessExpiresAt === 'number' ? data.accessExpiresAt * 1000 : null,
          hasRefreshToken: Boolean(data.hasRefreshToken),
        };
      } catch {
        return { accessExpiresAt: null, hasRefreshToken: false };
      }
    }

    function accessNeedsRefresh(accessExpiresAt: number | null): boolean {
      if (!accessExpiresAt) return false;
      return accessExpiresAt - Date.now() <= REFRESH_SKEW_MS;
    }

    async function refreshAndSync(): Promise<void> {
      const meta = await fetchSessionMeta();
      if (!meta.hasRefreshToken) return;
      if (!accessNeedsRefresh(meta.accessExpiresAt)) return;
      await refreshAppSessionWithFallback();
    }

    async function schedule(): Promise<void> {
      if (cancelled) return;
      const meta = await fetchSessionMeta();
      if (!meta.hasRefreshToken) return;
      const delay = meta.accessExpiresAt
        ? Math.max(MIN_DELAY_MS, meta.accessExpiresAt - Date.now() - REFRESH_SKEW_MS)
        : FALLBACK_INTERVAL_MS;
      // Cancel any prior pending timer before arming a new one so at most ONE
      // poll chain is ever live. schedule() is re-entered from the timer callback,
      // from onVisible, and (in dev StrictMode) from a double-mount; without this
      // clear, each re-entry spawned a parallel self-perpetuating chain and the
      // session/refresh calls multiplied until the tab froze.
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        await refreshAndSync();
        void schedule();
      }, delay);
    }

    function onVisible(): void {
      if (document.visibilityState !== 'visible') return;
      void (async () => {
        const meta = await fetchSessionMeta();
        if (!meta.hasRefreshToken) return;
        if (!accessNeedsRefresh(meta.accessExpiresAt)) {
          void schedule();
          return;
        }
        if (timer) clearTimeout(timer);
        await refreshAndSync();
        void schedule();
      })();
    }

    void schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return null;
}
