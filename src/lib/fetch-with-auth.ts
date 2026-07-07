'use client';

import { refreshAppSessionWithFallback } from '@/lib/auth-client-refresh';

let refreshInProgress: Promise<boolean> | null = null;

/**
 * Refresh session via same-origin cookies first, then InsForge SDK fallback.
 * Shared promise ensures concurrent 401s only trigger one refresh.
 */
async function resyncToken(): Promise<boolean> {
  if (refreshInProgress) return refreshInProgress;

  refreshInProgress = refreshAppSessionWithFallback().finally(() => {
    refreshInProgress = null;
  });

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
