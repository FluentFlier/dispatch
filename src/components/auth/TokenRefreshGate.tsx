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
    async function tryRefresh() {
      try {
        const client = getInsforgeClient();
        const { data, error } = await client.auth.refreshSession();

        if (error || !data?.accessToken) {
          setStatus('failed');
          setTimeout(() => {
            window.location.href = '/login';
          }, 1500);
          return;
        }

        // Sync new token to server-side httpOnly cookie.
        const res = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            token: data.accessToken,
            refreshToken: (data as { refreshToken?: string }).refreshToken ?? null,
          }),
        });

        if (!res.ok) {
          setStatus('failed');
          setTimeout(() => {
            window.location.href = '/login';
          }, 1500);
          return;
        }

        // Hard reload so layout re-runs server-side auth with the new cookie.
        window.location.reload();
      } catch {
        setStatus('failed');
        setTimeout(() => {
          window.location.href = '/login';
        }, 1500);
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
