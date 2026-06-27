'use client';

import { getInsforgeClient } from '@/lib/insforge/client';

let refreshInProgress: Promise<boolean> | null = null;

/**
 * Refresh the InsForge session using the browser SDK (which sends InsForge's
 * own HttpOnly cookie via credentials:include), then re-sync the new access
 * token to our server-side httpOnly cookie.
 *
 * Using a shared promise ensures concurrent 401s only trigger one refresh,
 * not N parallel refresh attempts.
 */
async function resyncToken(): Promise<boolean> {
  if (refreshInProgress) return refreshInProgress;

  refreshInProgress = (async () => {
    try {
      const client = getInsforgeClient();
      // Browser-mode refreshSession uses InsForge's own session cookie.
      // No refreshToken arg needed — the SDK calls /api/auth/refresh with
      // credentials:include so InsForge's HttpOnly cookie is sent automatically.
      const { data, error } = await client.auth.refreshSession();
      if (error || !data?.accessToken) return false;

      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          token: data.accessToken,
          refreshToken: (data as { refreshToken?: string }).refreshToken ?? null,
        }),
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      refreshInProgress = null;
    }
  })();

  return refreshInProgress;
}

/**
 * Drop-in replacement for fetch() on authenticated API endpoints.
 * On 401, attempts one token refresh + retry before returning the response.
 */
export async function fetchWithAuth(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(input, { credentials: 'same-origin', ...init });
  if (res.status !== 401) return res;

  const refreshed = await resyncToken();
  if (!refreshed) return res;

  return fetch(input, { credentials: 'same-origin', ...init });
}
