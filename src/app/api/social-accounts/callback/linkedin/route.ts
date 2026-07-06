import { NextRequest, NextResponse } from 'next/server';
import { getSocialProviderMode } from '@/lib/env';

// GET: Legacy LinkedIn OAuth callback — social connect is Unipile-only now.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');

  // Stale LinkedIn app redirects land here. Send users to the supported flow.
  if (getSocialProviderMode() === 'unipile' || !process.env.LINKEDIN_CLIENT_ID) {
    const connectUrl = new URL('/api/social-accounts/connect/unipile', appUrl);
    connectUrl.searchParams.set('return', 'settings');
    return NextResponse.redirect(connectUrl.toString());
  }

  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return redirectWithError(
      'Direct LinkedIn OAuth is disabled. Use Connect accounts (Unipile) in Settings.',
    );
  }

  const { getAuthenticatedUser, getServerClient } = await import('@/lib/insforge/server');
  const { encryptToken } = await import('@/lib/crypto');

  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');

  if (error) return redirectWithError(`LinkedIn auth denied: ${error}`);
  if (!code || !state) return redirectWithError('Missing code or state from LinkedIn');

  // Validate state against cookie (CSRF protection)
  const storedState = request.cookies.get('linkedin_oauth_state')?.value;
  if (state !== storedState) return redirectWithError('Invalid OAuth state. Try connecting again.');

  // Authenticate user
  const user = await getAuthenticatedUser();
  if (!user) {
    return redirectWithError('Not authenticated. Please log in first.');
  }

  const callbackUrl = `${appUrl}/api/social-accounts/callback/linkedin`;

  try {
    // Exchange code for token
    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callbackUrl,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    if (!tokenRes.ok) {
      return redirectWithError('Failed to exchange LinkedIn code for token');
    }

    const tokenData = await tokenRes.json();
    const { access_token, refresh_token, expires_in } = tokenData;

    // Get profile
    const profileRes = await fetch('https://api.linkedin.com/v2/me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const profile = profileRes.ok ? await profileRes.json() : null;

    const expiresAt = expires_in
      ? new Date(Date.now() + expires_in * 1000).toISOString()
      : null;

    // Store tokens directly via database (no self-fetch)
    const db = getServerClient().database;
    const { error: dbError } = await db
      .from('social_accounts')
      .upsert(
        {
          user_id: user.id,
          platform: 'linkedin',
          account_name: profile
            ? `${profile.localizedFirstName} ${profile.localizedLastName}`
            : 'LinkedIn',
          account_id: profile?.id ?? null,
          access_token: encryptToken(access_token),
          refresh_token: refresh_token ? encryptToken(refresh_token) : null,
          token_expires_at: expiresAt,
          connection_method: 'oauth',
          connected_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,platform' }
      );

    if (dbError) {
      console.error('[LinkedIn Callback] DB error:', dbError.message);
      return redirectWithError('Failed to save LinkedIn connection');
    }

    // Redirect to settings and clear OAuth cookies
    const response = NextResponse.redirect(`${appUrl}/settings?connected=linkedin`);
    response.cookies.set('linkedin_oauth_state', '', { maxAge: 0, path: '/' });
    return response;
  } catch (err) {
    console.error('[LinkedIn Callback]', err);
    return redirectWithError('Failed to complete LinkedIn connection');
  }
}

function redirectWithError(message: string): NextResponse {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  return NextResponse.redirect(
    `${appUrl}/settings?error=${encodeURIComponent(message)}`
  );
}
