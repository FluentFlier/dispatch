import { createClient } from '@insforge/sdk';
import type { NextResponse } from 'next/server';
import { AUTH_COOKIE, AUTH_COOKIE_OPTS } from '@/lib/auth-cookies';
import { displayNameFromAuthUser, fetchOAuthDisplayName } from '@/lib/user-display-name';
import { logWarn } from '@/lib/logger';

export interface RefreshedSession {
  accessToken: string;
  refreshToken?: string;
  user: { id: string; email: string; name?: string };
}

interface InsforgeAuthUser {
  id?: string;
  email?: string;
  name?: string;
  user_metadata?: Record<string, unknown>;
  profile?: { name?: string } | null;
}

interface InsforgeTokenResponse {
  accessToken?: string;
  refreshToken?: string;
  user?: InsforgeAuthUser;
}

function insforgeBaseUrl(): string | null {
  const rawUrl = process.env.NEXT_PUBLIC_INSFORGE_URL;
  return rawUrl ? rawUrl.replace(/\/+$/, '') : null;
}

function userFromTokenResponse(data: InsforgeTokenResponse): InsforgeAuthUser | null {
  if (data.user?.id) return data.user;
  return null;
}

function normalizeUser(data: InsforgeTokenResponse): { id: string; email: string; name?: string } | null {
  const user = userFromTokenResponse(data);
  if (!user?.id) return null;

  const name =
    displayNameFromAuthUser(user as Parameters<typeof displayNameFromAuthUser>[0]) ??
    user.profile?.name?.trim() ??
    user.name?.trim() ??
    undefined;

  return {
    id: user.id,
    email: user.email ?? '',
    ...(name ? { name } : {}),
  };
}

async function parseInsforgeAuthResponse(
  res: Response,
  accessTokenFallback?: string,
): Promise<InsforgeTokenResponse | null> {
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    logWarn('auth.insforge_request_failed', {
      status: res.status,
      error: (errBody as { error?: string; message?: string }).error,
      message: (errBody as { message?: string }).message,
    });
    return null;
  }
  return (await res.json()) as InsforgeTokenResponse;
}

/**
 * Exchange OAuth code using server/mobile flow so refreshToken is returned in the body
 * (web flow only sets InsForge cross-origin cookies we cannot persist).
 */
export async function exchangeOAuthCodeForSession(
  code: string,
  codeVerifier: string,
): Promise<RefreshedSession | null> {
  const baseUrl = insforgeBaseUrl();
  const anonKey = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY;
  if (!baseUrl || !anonKey) return null;

  const refreshClient = createClient({
    baseUrl,
    anonKey,
    isServerMode: true,
  });

  const { data, error } = await (
    refreshClient.auth as unknown as {
      exchangeOAuthCode: (
        oauthCode: string,
        verifier?: string,
      ) => Promise<{ data: InsforgeTokenResponse | null; error: unknown }>;
    }
  ).exchangeOAuthCode(code, codeVerifier);

  if (error || !data?.accessToken) {
    logWarn('auth.oauth_exchange_failed', {
      error: error instanceof Error ? error.message : String(error ?? 'no_data'),
    });
    return null;
  }

  const user = normalizeUser(data);
  if (!user) return null;

  const oauthName = await fetchOAuthDisplayName(data.accessToken);
  if (oauthName) {
    user.name = oauthName;
  }

  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    user,
  };
}

/**
 * Exchange a refresh token for new access (and rotated refresh) tokens via InsForge.
 * Uses client_type=server REST API so refreshToken is returned in the body.
 */
export async function refreshSessionWithToken(refreshToken: string): Promise<RefreshedSession | null> {
  const baseUrl = insforgeBaseUrl();
  if (!baseUrl) return null;

  const res = await fetch(`${baseUrl}/api/auth/refresh?client_type=server`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  });

  const data = await parseInsforgeAuthResponse(res);
  if (!data?.accessToken) return null;

  let user = normalizeUser(data);
  if (!user) return null;

  const oauthName = await fetchOAuthDisplayName(data.accessToken);
  if (oauthName) {
    user = { ...user, name: oauthName };
  }

  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    user,
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
