'use client';

import { getInsforgeClient } from '@/lib/insforge/client';

/**
 * Refresh session using our httpOnly content-os-refresh cookie (same-origin).
 * Works when InsForge cross-origin cookies are blocked by the browser.
 */
export async function refreshAppSession(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Sync fresh tokens from the InsForge browser SDK into our httpOnly cookies.
 * Fallback when content-os-refresh is missing but InsForge still has a session.
 */
async function syncFromSdkRefresh(): Promise<boolean> {
  try {
    const client = getInsforgeClient();
    const { data, error } = await client.auth.refreshSession();
    if (error || !data?.accessToken) return false;

    const syncRes = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        token: data.accessToken,
        refreshToken: (data as { refreshToken?: string }).refreshToken ?? null,
      }),
    });
    return syncRes.ok;
  } catch {
    return false;
  }
}

/** Server cookie refresh first, then InsForge SDK (cross-origin cookies). */
export async function refreshAppSessionWithFallback(): Promise<boolean> {
  if (await refreshAppSession()) return true;
  return syncFromSdkRefresh();
}
