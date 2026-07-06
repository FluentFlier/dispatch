import { createClient } from '@insforge/sdk';
import type { NextResponse } from 'next/server';
import { AUTH_COOKIE, AUTH_COOKIE_OPTS } from '@/lib/auth-cookies';
import { displayNameFromAuthUser, fetchOAuthDisplayName } from '@/lib/user-display-name';

export interface RefreshedSession {
  accessToken: string;
  refreshToken?: string;
  user: { id: string; email: string; name?: string };
}

/**
 * Exchange a refresh token for new access (and optionally refresh) tokens via InsForge.
 */
export async function refreshSessionWithToken(refreshToken: string): Promise<RefreshedSession | null> {
  const rawUrl = process.env.NEXT_PUBLIC_INSFORGE_URL;
  const anonKey = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY;
  if (!rawUrl || !anonKey) return null;

  const refreshClient = createClient({
    baseUrl: rawUrl.replace(/\/+$/, ''),
    anonKey,
    isServerMode: true,
  });

  const { data: refreshed, error: refreshError } = await (
    refreshClient.auth as unknown as {
      refreshSession: (opts: { refreshToken: string }) => Promise<{
        data: {
          accessToken?: string;
          refreshToken?: string;
          user?: { id: string; email?: string; name?: string; user_metadata?: Record<string, unknown> };
        } | null;
        error: unknown;
      }>;
    }
  ).refreshSession({ refreshToken });

  if (refreshError || !refreshed?.accessToken || !refreshed.user?.id) return null;

  const oauthName = await fetchOAuthDisplayName(refreshed.accessToken);
  const name =
    oauthName ??
    displayNameFromAuthUser(refreshed.user) ??
    undefined;

  return {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    user: {
      id: refreshed.user.id,
      email: refreshed.user.email ?? '',
      ...(name ? { name } : {}),
    },
  };
}

/** Attach refreshed access + refresh tokens to a NextResponse (route handlers only). */
export function setAuthCookiesOnResponse(
  response: NextResponse,
  accessToken: string,
  refreshToken?: string,
): void {
  response.cookies.set(AUTH_COOKIE.access, accessToken, AUTH_COOKIE_OPTS);
  if (refreshToken) {
    response.cookies.set(AUTH_COOKIE.refresh, refreshToken, AUTH_COOKIE_OPTS);
  }
}

/** Clear session cookies (logout / unrecoverable refresh). */
export function clearAuthCookiesOnResponse(response: NextResponse): void {
  const cleared = { ...AUTH_COOKIE_OPTS, maxAge: 0 };
  response.cookies.set(AUTH_COOKIE.access, '', cleared);
  response.cookies.set(AUTH_COOKIE.refresh, '', cleared);
}
