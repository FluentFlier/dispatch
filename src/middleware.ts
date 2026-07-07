import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_COOKIE, isJwtExpired } from '@/lib/auth-cookies';

const PROTECTED_ROUTES = [
  '/admin',
  '/dashboard',
  '/generate',
  '/library',
  '/calendar',
  '/inbox',
  '/story-bank',
  '/ideas',
  '/series',
  '/analytics',
  '/settings',
  '/voice-lab',
  '/teleprompter',
  '/video-studio',
  '/signals',
  '/leads',
  '/event-capture',
  '/onboarding',
  '/get-started',
];

const AUTH_BYPASS_PREFIXES = [
  '/api/auth',
  '/auth/restore-session',
  '/login',
  '/auth/continue',
];

function shouldBypassAuthRefresh(pathname: string): boolean {
  return AUTH_BYPASS_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', pathname);

  const token = request.cookies.get(AUTH_COOKIE.access)?.value;
  const refreshToken = request.cookies.get(AUTH_COOKIE.refresh)?.value;

  if (pathname === '/pricing' || pathname === '/book-demo' || pathname === '/terms' || pathname === '/privacy') {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Expired access JWT (or expiring within 5m): refresh before RSC layout runs.
  if (token && isJwtExpired(token, 300) && !shouldBypassAuthRefresh(pathname)) {
    const nextTarget = `${pathname}${search}`;
    if (refreshToken) {
      const refreshUrl = new URL('/api/auth/refresh', request.url);
      refreshUrl.searchParams.set('next', nextTarget);
      return NextResponse.redirect(refreshUrl, 307);
    }
    const restoreUrl = new URL('/auth/restore-session', request.url);
    restoreUrl.searchParams.set('next', nextTarget);
    return NextResponse.redirect(restoreUrl, 307);
  }

  if (pathname === '/login' && token) {
    const { searchParams } = request.nextUrl;
    if (searchParams.get('expired') === '1' || searchParams.has('error')) {
      return NextResponse.next({ request: { headers: requestHeaders } });
    }
    const continueUrl = new URL('/auth/continue', request.url);
    return NextResponse.redirect(continueUrl, 307);
  }

  const isProtected = PROTECTED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  if (isProtected && !token) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl, 307);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
