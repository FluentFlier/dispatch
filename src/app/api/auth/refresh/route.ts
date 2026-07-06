import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE } from '@/lib/auth-cookies';
import {
  clearAuthCookiesOnResponse,
  refreshSessionWithToken,
  setAuthCookiesOnResponse,
} from '@/lib/auth-refresh';

/**
 * Server-side session refresh using the httpOnly refresh token cookie.
 * Middleware redirects here when the access JWT is expired but refresh exists.
 * Sets fresh cookies on the redirect response (works in route handlers; not in RSC).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const refreshToken = request.cookies.get(AUTH_COOKIE.refresh)?.value;
  const nextParam = request.nextUrl.searchParams.get('next');
  const nextPath =
    nextParam && nextParam.startsWith('/') && !nextParam.startsWith('//')
      ? nextParam
      : '/dashboard';

  if (!refreshToken) {
    const restore = new URL('/auth/restore-session', request.url);
    restore.searchParams.set('next', nextPath);
    return NextResponse.redirect(restore, 307);
  }

  const refreshed = await refreshSessionWithToken(refreshToken);
  if (!refreshed) {
    const login = NextResponse.redirect(new URL('/login?expired=1', request.url), 307);
    clearAuthCookiesOnResponse(login);
    return login;
  }

  const response = NextResponse.redirect(new URL(nextPath, request.url), 307);
  setAuthCookiesOnResponse(response, refreshed.accessToken, refreshed.refreshToken);
  return response;
}
