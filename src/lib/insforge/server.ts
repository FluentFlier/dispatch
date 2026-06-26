import { createClient } from '@insforge/sdk';
import { cookies } from 'next/headers';
import { isProduction } from '@/lib/env';

/** Service-role client for cron/background jobs (no user cookie). */
export function getServiceClient(): ReturnType<typeof createClient> {
  const rawUrl = process.env.NEXT_PUBLIC_INSFORGE_URL;
  const serviceKey = process.env.INSFORGE_SERVICE_ROLE_KEY?.trim();

  // In production the real service-role key is mandatory. Never silently fall
  // back to the public anon key: that would run cron/admin/webhook paths as an
  // anon user (RLS-blocked writes, broken billing) and conflate "service" with
  // a key that ships to the browser.
  if (isProduction() && !serviceKey) {
    throw new Error('INSFORGE_SERVICE_ROLE_KEY is required in production');
  }

  const key = serviceKey ?? process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY;
  if (!rawUrl || !key) {
    throw new Error('Missing InsForge env vars for service client');
  }

  const url = rawUrl.replace(/\/+$/, '');

  return createClient({
    baseUrl: url,
    anonKey: key,
    isServerMode: true,
  });
}

export function getServerClient(): ReturnType<typeof createClient> {
  const rawUrl = process.env.NEXT_PUBLIC_INSFORGE_URL;
  const anonKey = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY;

  if (!rawUrl || !anonKey) {
    throw new Error('Missing InsForge env vars');
  }

  const url = rawUrl.replace(/\/+$/, '');
  const cookieStore = cookies();
  const token = cookieStore.get('content-os-token')?.value;

  return createClient({
    baseUrl: url,
    anonKey,
    isServerMode: true,
    edgeFunctionToken: token,
  });
}

/**
 * Returns the authenticated user from the session cookie.
 * If the access token is expired, attempts a silent refresh using the refresh
 * token cookie and re-sets both cookies via a Set-Cookie header on the response.
 * Returns null only when both tokens are absent or the refresh itself fails.
 */
export async function getAuthenticatedUser(): Promise<{ id: string; email: string } | null> {
  try {
    const client = getServerClient();
    const { data, error } = await client.auth.getCurrentUser();
    if (data?.user) return { id: data.user.id, email: data.user.email ?? '' };

    // Access token expired or invalid — attempt silent refresh.
    if (error) {
      const cookieStore = cookies();
      const refreshToken = cookieStore.get('content-os-refresh')?.value;
      if (!refreshToken) return null;

      const rawUrl = process.env.NEXT_PUBLIC_INSFORGE_URL;
      const anonKey = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY;
      if (!rawUrl || !anonKey) return null;

      const { createClient: create } = await import('@insforge/sdk');
      const refreshClient = create({
        baseUrl: rawUrl.replace(/\/+$/, ''),
        anonKey,
        isServerMode: true,
      });

      const { data: refreshed, error: refreshError } = await (
        refreshClient.auth as unknown as {
          refreshSession: (opts: { refreshToken: string }) => Promise<{
            data: { accessToken?: string; refreshToken?: string; user?: { id: string; email?: string } } | null;
            error: unknown;
          }>;
        }
      ).refreshSession({ refreshToken });

      if (refreshError || !refreshed?.accessToken || !refreshed.user?.id) return null;

      // Re-set both cookies so subsequent server actions get the new tokens.
      // Dynamic import avoids circular deps with next/headers at module init.
      const { cookies: responseCookies } = await import('next/headers');
      const cookieOpts = {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax' as const,
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
      };
      const store = responseCookies();
      store.set('content-os-token', refreshed.accessToken, cookieOpts);
      if (refreshed.refreshToken) {
        store.set('content-os-refresh', refreshed.refreshToken, cookieOpts);
      }

      return { id: refreshed.user.id, email: refreshed.user.email ?? '' };
    }

    return null;
  } catch {
    return null;
  }
}
