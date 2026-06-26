import { NextResponse, type NextRequest } from 'next/server';

const PROTECTED_ROUTES = [
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
  '/onboarding',
];

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // Always set x-pathname header
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', pathname);

  const token = request.cookies.get('content-os-token')?.value;

  // Public marketing routes
  if (pathname === '/pricing') {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Authenticated user hitting /login -> redirect to /dashboard.
  // Exception: if the dashboard sent them here with ?expired=1 it means the
  // server rejected the token — clear the stale cookie and let login render so
  // the user can re-authenticate. Without this the middleware and dashboard
  // redirect each other indefinitely (cookie present but token invalid = loop).
  if (pathname === '/login' && token) {
    const { searchParams } = request.nextUrl;
    if (searchParams.get('expired') === '1' || searchParams.has('error')) {
      const response = NextResponse.next({ request: { headers: requestHeaders } });
      response.cookies.set('content-os-token', '', { httpOnly: true, path: '/', maxAge: 0 });
      return response;
    }
    const dashboardUrl = new URL('/dashboard', request.url);
    return NextResponse.redirect(dashboardUrl, 307);
  }

  // Protected routes: redirect to /login if no token
  const isProtected = PROTECTED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(route + '/')
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
