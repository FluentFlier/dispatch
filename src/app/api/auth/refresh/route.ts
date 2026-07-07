import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, decodeJwtExpSec } from '@/lib/auth-cookies';
import {
  clearAuthCookiesOnResponse,
  refreshSessionWithToken,
  setAuthCookiesOnResponse,
} from '@/lib/auth-refresh';

/**
 * POST: JSON session refresh for client keep-alive (SessionKeepAlive, fetchWithAuth).
 * Uses the httpOnly content-os-refresh cookie — no cross-origin InsForge cookies needed.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const refreshToken = request.cookies.get(AUTH_COOKIE.refresh)?.value;
  if (!refreshToken) {
    return NextResponse.json({ ok: false, error: 'no_refresh_token' }, { status: 401 });
  }

  const refreshed = await refreshSessionWithToken(refreshToken);
  if (!refreshed || refreshed === 'unauthorized') {
    // Do not clear cookies on POST — the access JWT may still be valid. Clearing here
    // caused logout on every page refresh when keep-alive fired a redundant refresh.
    const error =
      refreshed === 'unauthorized' ? 'refresh_unauthorized' : 'refresh_failed';
    const status = refreshed === 'unauthorized' ? 401 : 503;
    return NextResponse.json({ ok: false, error }, { status });
  }

  const response = NextResponse.json({ ok: true });
  setAuthCookiesOnResponse(response, refreshed.accessToken, refreshed.refreshToken, {
    fallbackRefreshToken: refreshToken,
  });
  return response;
}

/**
 * GET: Server-side session refresh using the httpOnly refresh token cookie.
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
  if (!refreshed || refreshed === 'unauthorized') {
    // Only hard-logout when the refresh token is ACTUALLY expired. Its exp is
    // the true ~7-day session boundary. A single transient 'unauthorized'
    // (rotation/reuse race, brief InsForge blip) must NOT clear cookies and
    // bounce to /login — that was ending week-long sessions minutes/hours in.
    // While the refresh window is still open, hand off to the recoverable
    // restore-session flow (SDK fallback + bounded retries) instead.
    const expSec = decodeJwtExpSec(refreshToken);
    const trulyExpired = expSec !== null && expSec <= Math.floor(Date.now() / 1000);
    if (refreshed === 'unauthorized' && trulyExpired) {
      const login = NextResponse.redirect(new URL('/login?expired=1', request.url), 307);
      clearAuthCookiesOnResponse(login);
      return login;
    }
    const restore = new URL('/auth/restore-session', request.url);
    restore.searchParams.set('next', nextPath);
    return NextResponse.redirect(restore, 307);
  }

  const response = NextResponse.redirect(new URL(nextPath, request.url), 307);
  setAuthCookiesOnResponse(response, refreshed.accessToken, refreshed.refreshToken, {
    fallbackRefreshToken: refreshToken,
  });
  return response;
}
