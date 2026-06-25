import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { buildGoogleOAuthUrl } from '@/lib/calendar/google';

/**
 * GET /api/calendar/connect/google
 * Redirects the authenticated user to Google's OAuth 2.0 consent screen.
 * A random state nonce is stored in a short-lived cookie to prevent CSRF during the callback.
 */
export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let authUrl: string;
  try {
    const state = crypto.randomUUID();
    authUrl = buildGoogleOAuthUrl(state);

    const response = NextResponse.redirect(authUrl);
    response.cookies.set('google_calendar_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 600, // 10 minutes — enough for user to complete OAuth
    });

    return response;
  } catch (err) {
    console.error('[calendar/connect/google] OAuth URL build failed', err);
    return NextResponse.json(
      { error: 'Google Calendar API not configured' },
      { status: 500 },
    );
  }
}
