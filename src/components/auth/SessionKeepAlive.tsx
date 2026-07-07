'use client';

import { useEffect } from 'react';
import { refreshAppSessionWithFallback } from '@/lib/auth-client-refresh';

/**
 * Proactively refreshes the session BEFORE the access token expires.
 * Uses same-origin content-os-refresh cookie (not cross-origin InsForge cookies).
 */
const REFRESH_SKEW_MS = 120_000;
const FALLBACK_INTERVAL_MS = 45 * 60_000;
const MIN_DELAY_MS = 1_000;

export default function SessionKeepAlive() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    async function fetchAccessExpiresAt(): Promise<number | null> {
      try {
        const res = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' });
        if (!res.ok) return null;
        const data = (await res.json()) as { accessExpiresAt?: number | null };
        return typeof data.accessExpiresAt === 'number' ? data.accessExpiresAt * 1000 : null;
      } catch {
        return null;
      }
    }

    async function refreshAndSync(): Promise<void> {
      await refreshAppSessionWithFallback();
    }

    async function schedule(): Promise<void> {
      if (cancelled) return;
      const expMs = await fetchAccessExpiresAt();
      const delay = expMs
        ? Math.max(MIN_DELAY_MS, expMs - Date.now() - REFRESH_SKEW_MS)
        : FALLBACK_INTERVAL_MS;
      timer = setTimeout(async () => {
        await refreshAndSync();
        void schedule();
      }, delay);
    }

    function onVisible(): void {
      if (document.visibilityState !== 'visible') return;
      if (timer) clearTimeout(timer);
      void refreshAndSync().finally(() => {
        void schedule();
      });
    }

    void refreshAndSync().finally(() => {
      void schedule();
    });
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return null;
}
