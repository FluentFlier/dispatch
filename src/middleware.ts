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
  // Exception: ?expired=1 or ?error means the server rejected the token — let
  // the login page render so the user can re-authenticate.
  // We do NOT clear the cookie here: any URL (/login?expired=1) could be used
  // to force-logout a user (CSRF). getAuthenticatedUser() handles stale/expired
  // tokens gracefully server-side — the cookie will be replaced on next sign-in.
  if (pathname === '/login' && token) {
    const { searchParams } = request.nextUrl;
    if (searchParams.get('expired') === '1' || searchParams.has('error')) {
      return NextResponse.next({ request: { headers: requestHeaders } });
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
