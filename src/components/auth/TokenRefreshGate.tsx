'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { refreshAppSessionWithFallback } from '@/lib/auth-client-refresh';

/**
 * Rendered by the dashboard layout when the session cookie exists but the
 * server-side token check failed (expired). Tries same-origin cookie refresh
 * first, then InsForge SDK, then hard-reloads so getAuthenticatedUser() succeeds.
 */
export default function TokenRefreshGate() {
  const [status, setStatus] = useState<'refreshing' | 'failed'>('refreshing');

  useEffect(() => {
    const RETRY_KEY = 'token_refresh_attempts';
    const DEPLOY_KEY = 'content_os_deploy_id';

    function goToLogin() {
      sessionStorage.removeItem(RETRY_KEY);
      setStatus('failed');
      setTimeout(() => {
        window.location.href = '/login?expired=1';
      }, 800);
    }

    async function tryRefresh() {
      try {
        const healthRes = await fetch('/api/health', { cache: 'no-store' });
        const health = (await healthRes.json()) as { deploymentId?: string };
        const deployId = health.deploymentId ?? '';
        const prevDeploy = sessionStorage.getItem(DEPLOY_KEY);
        if (deployId && prevDeploy && prevDeploy !== deployId) {
          sessionStorage.removeItem(RETRY_KEY);
        }
        if (deployId) sessionStorage.setItem(DEPLOY_KEY, deployId);
      } catch {
        /* health probe optional */
      }

      const attempts = Number(sessionStorage.getItem(RETRY_KEY) ?? '0');
      if (attempts >= 3) {
        goToLogin();
        return;
      }
      sessionStorage.setItem(RETRY_KEY, String(attempts + 1));

      try {
        const refreshed = await refreshAppSessionWithFallback();
        if (!refreshed) {
          goToLogin();
          return;
        }

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
