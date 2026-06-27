'use client';

import { useEffect, useState } from 'react';
import { getInsforgeClient } from '@/lib/insforge/client';
import { Loader2 } from 'lucide-react';

/**
 * Rendered by the dashboard layout when the session cookie exists but the
 * server-side token check failed (expired). Attempts a browser-side refresh
 * using InsForge's own HttpOnly session cookie, then hard-reloads so the
 * layout re-runs getAuthenticatedUser() with the fresh token.
 *
 * Falls back to /login if the browser session is also expired.
 */
export default function TokenRefreshGate() {
  const [status, setStatus] = useState<'refreshing' | 'failed'>('refreshing');

  useEffect(() => {
    const RETRY_KEY = 'token_refresh_attempts';

    function goToLogin() {
      sessionStorage.removeItem(RETRY_KEY);
      setStatus('failed');
      setTimeout(() => { window.location.href = '/login'; }, 800);
    }

    async function tryRefresh() {
      // Break infinite reload loop: if we've already tried twice, give up.
      const attempts = Number(sessionStorage.getItem(RETRY_KEY) ?? '0');
      if (attempts >= 2) {
        goToLogin();
        return;
      }
      sessionStorage.setItem(RETRY_KEY, String(attempts + 1));

      try {
        const client = getInsforgeClient();
        const { data, error } = await client.auth.refreshSession();

        if (error || !data?.accessToken) {
          goToLogin();
          return;
        }

        // Sync new token to server-side httpOnly cookie.
        const syncRes = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            token: data.accessToken,
            refreshToken: (data as { refreshToken?: string }).refreshToken ?? null,
          }),
        });

        if (!syncRes.ok) {
          goToLogin();
          return;
        }

        // Verify the new token actually passes server-side auth before reloading.
        // If it fails here, reloading would just loop — go to login instead.
        const verifyRes = await fetch('/api/auth/session', { credentials: 'same-origin' });
        const verifyData = await verifyRes.json().catch(() => ({}));
        if (!verifyRes.ok || !verifyData?.authenticated) {
          goToLogin();
          return;
        }

        sessionStorage.removeItem(RETRY_KEY);
        window.location.reload();
      } catch {
        goToLogin();
      }
    }

    tryRefresh();
  }, []);

  return (
    <div className="flex h-screen items-center justify-center bg-bg-primary">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-text-secondary" />
        <p className="font-body text-[13px] text-text-secondary">
          {status === 'refreshing' ? 'Refreshing session...' : 'Session expired. Redirecting to login...'}
        </p>
      </div>
    </div>
  );
}
