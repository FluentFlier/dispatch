'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { getInsforgeClient } from '@/lib/insforge/client';

const RETRY_KEY = 'token_refresh_attempts';
const DEPLOY_KEY = 'content_os_deploy_id';

/**
 * Client-side session restore after deploy or when only InsForge's browser session
 * can refresh (no content-os-refresh cookie). Syncs a fresh access token into
 * our httpOnly cookies, then returns to the requested page.
 */
export default function RestoreSessionPage() {
  const [message, setMessage] = useState('Restoring your session…');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const next =
      params.get('next') && params.get('next')!.startsWith('/')
        ? params.get('next')!
        : '/dashboard';

    async function goLogin() {
      setMessage('Session expired. Redirecting to sign in…');
      setTimeout(() => {
        window.location.href = '/login?expired=1';
      }, 600);
    }

    async function restore() {
      try {
        const healthRes = await fetch('/api/health', { cache: 'no-store' });
        const health = (await healthRes.json()) as { deploymentId?: string };
        const deployId = health.deploymentId ?? '';
        const prevDeploy = sessionStorage.getItem(DEPLOY_KEY);
        if (deployId && prevDeploy && prevDeploy !== deployId) {
          sessionStorage.removeItem(RETRY_KEY);
        }
        if (deployId) sessionStorage.setItem(DEPLOY_KEY, deployId);

        const attempts = Number(sessionStorage.getItem(RETRY_KEY) ?? '0');
        if (attempts >= 3) {
          await goLogin();
          return;
        }
        sessionStorage.setItem(RETRY_KEY, String(attempts + 1));

        const client = getInsforgeClient();
        const { data, error } = await client.auth.refreshSession();
        if (error || !data?.accessToken) {
          await goLogin();
          return;
        }

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
          await goLogin();
          return;
        }

        const verifyRes = await fetch('/api/auth/session', { credentials: 'same-origin' });
        const verifyData = await verifyRes.json().catch(() => ({}));
        if (!verifyRes.ok || !verifyData?.authenticated) {
          await goLogin();
          return;
        }

        sessionStorage.removeItem(RETRY_KEY);
        window.location.replace(next);
      } catch {
        await goLogin();
      }
    }

    void restore();
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-primary">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-text-secondary" />
        <p className="font-body text-[13px] text-text-secondary">{message}</p>
      </div>
    </div>
  );
}
