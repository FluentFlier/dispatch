import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { exchangeGoogleCode, listCalendars } from '@/lib/calendar/google';
import { encryptToken } from '@/lib/crypto';
import { getActiveWorkspaceId } from '@/lib/workspace';

/**
 * GET /api/calendar/callback/google
 * Handles the OAuth 2.0 callback from Google after user grants calendar access.
 *
 * Validates state cookie (CSRF protection), exchanges the authorization code for tokens,
 * picks the primary calendar, encrypts both tokens, and upserts into calendar_connections.
 * Redirects to /settings/calendar on success or /settings/calendar?error=... on failure.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const settingsUrl = `${appUrl}/settings/calendar`;

  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.redirect(`${settingsUrl}?error=unauthenticated`);
  }

  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const errorParam = searchParams.get('error');

  // User denied access on Google's consent screen.
  if (errorParam) {
    return NextResponse.redirect(`${settingsUrl}?error=access_denied`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${settingsUrl}?error=invalid_callback`);
  }

  // --- CSRF state validation ---
  const cookieState = request.cookies.get('google_calendar_oauth_state')?.value;
  if (!cookieState || cookieState !== state) {
    return NextResponse.redirect(`${settingsUrl}?error=state_mismatch`);
  }

  try {
    // --- Exchange authorization code for tokens ---
    const { accessToken, refreshToken, expiresAt } = await exchangeGoogleCode(code);

    // Encrypt tokens before persisting — never store plaintext OAuth credentials.
    const encryptedAccess = encryptToken(accessToken);
    const encryptedRefresh = refreshToken ? encryptToken(refreshToken) : null;

    // --- Determine active workspace ---
    const workspaceId = await getActiveWorkspaceId(user.id);
    if (!workspaceId) {
      return NextResponse.redirect(`${settingsUrl}?error=no_workspace`);
    }

    // --- Fetch available calendars and pick primary ---
    const calendars = await listCalendars(encryptToken(accessToken));
    const primary = calendars.find((c) => c.primary) ?? calendars[0];
    if (!primary) {
      return NextResponse.redirect(`${settingsUrl}?error=no_calendar`);
    }

    const client = getServerClient();

    // Upsert connection — one row per (workspace, provider, calendar_id).
    // If the user reconnects (e.g., after revoking), tokens are refreshed in place.
    await client.database
      .from('calendar_connections')
      .upsert(
        {
          workspace_id: workspaceId,
          user_id: user.id,
          provider: 'google',
          access_token: encryptedAccess,
          refresh_token: encryptedRefresh,
          token_expires_at: expiresAt.toISOString(),
          calendar_id: primary.id,
          calendar_name: primary.summary ?? null,
          sync_enabled: true,
          sync_status: 'ok',
        },
        { onConflict: 'workspace_id,provider,calendar_id' },
      );

    const response = NextResponse.redirect(`${settingsUrl}?connected=true`);
    // Clear the CSRF cookie after successful exchange.
    response.cookies.delete('google_calendar_oauth_state');
    return response;
  } catch (err) {
    console.error('[calendar/callback/google] Error', err);
    return NextResponse.redirect(`${settingsUrl}?error=exchange_failed`);
  }
}
