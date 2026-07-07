import type { NextResponse } from 'next/server';
import { AUTH_COOKIE, AUTH_COOKIE_OPTS } from '@/lib/auth-cookies';
import { fetchOAuthDisplayName } from '@/lib/user-display-name';
import {
  exchangeOAuthCodeViaApi,
  refreshTokensViaApi,
  resolveAuthUser,
  type InsforgeTokenPayload,
} from '@/lib/insforge-auth-api';

export interface RefreshedSession {
  accessToken: string;
  refreshToken?: string;
  user: { id: string; email: string; name?: string };
}

async function toRefreshedSession(payload: InsforgeTokenPayload): Promise<RefreshedSession | null> {
  const user = resolveAuthUser(payload);
  if (!user) return null;

  const oauthName = await fetchOAuthDisplayName(payload.accessToken);
  if (oauthName) {
    user.name = oauthName;
  }

  return {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    user,
  };
}

export async function exchangeOAuthCodeForSession(
  code: string,
  codeVerifier: string,
): Promise<RefreshedSession | null> {
  const payload = await exchangeOAuthCodeViaApi(code, codeVerifier);
  if (!payload?.refreshToken) return null;
  return toRefreshedSession(payload);
}

export async function refreshSessionWithToken(
  refreshToken: string,
): Promise<RefreshedSession | null | 'unauthorized'> {
  const result = await refreshTokensViaApi(refreshToken);
  if (!result.ok) {
    return result.unauthorized ? 'unauthorized' : null;
  }
  return toRefreshedSession({
    ...result.payload,
    refreshToken: result.payload.refreshToken ?? refreshToken,
  });
}

/** Attach access + refresh tokens to a NextResponse (route handlers only). */
export function setAuthCookiesOnResponse(
  response: NextResponse,
  accessToken: string,
  refreshToken?: string | null,
  options?: { fallbackRefreshToken?: string },
): void {
  response.cookies.set(AUTH_COOKIE.access, accessToken, AUTH_COOKIE_OPTS);
  const nextRefresh = refreshToken ?? options?.fallbackRefreshToken;
  if (nextRefresh) {
    response.cookies.set(AUTH_COOKIE.refresh, nextRefresh, AUTH_COOKIE_OPTS);
  }
}

/** Clear session cookies (logout / unrecoverable refresh). */
export function clearAuthCookiesOnResponse(response: NextResponse): void {
  const cleared = { ...AUTH_COOKIE_OPTS, maxAge: 0 };
  response.cookies.set(AUTH_COOKIE.access, '', cleared);
  response.cookies.set(AUTH_COOKIE.refresh, '', cleared);
}
