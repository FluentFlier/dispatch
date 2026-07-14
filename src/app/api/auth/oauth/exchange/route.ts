import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { establishAuthenticatedSession } from '@/lib/auth-establish';
import { exchangeOAuthCodeForSession, setAuthCookiesOnResponse } from '@/lib/auth-refresh';
import { logWarn } from '@/lib/logger';

const OAuthExchangeSchema = z.object({
  code: z.string().min(1, 'OAuth code is required'),
  codeVerifier: z.string().min(1, 'PKCE code verifier is required'),
});

/**
 * Server-side OAuth code exchange (client_type=server/mobile).
 * Returns refreshToken in the response body so we can store it in content-os-refresh.
 * Web-browser SDK exchange only sets InsForge cross-origin cookies - unusable for SSR.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = OAuthExchangeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const exchanged = await exchangeOAuthCodeForSession(
    parsed.data.code,
    parsed.data.codeVerifier,
  );
  if (!exchanged?.refreshToken) {
    logWarn('auth.oauth_exchange_missing_refresh', {
      hasAccess: Boolean(exchanged?.accessToken),
    });
    return NextResponse.json(
      { error: 'OAuth exchange did not return a refresh token' },
      { status: 502 },
    );
  }

  const established = await establishAuthenticatedSession(exchanged.accessToken);
  if ('error' in established) {
    logWarn('auth.oauth_exchange_token_rejected', { reason: established.error });
    return NextResponse.json({ error: 'Invalid session token' }, { status: 401 });
  }

  const response = NextResponse.json({
    ok: true,
    userId: established.userId,
    hasRefreshToken: true,
  });
  setAuthCookiesOnResponse(response, exchanged.accessToken, exchanged.refreshToken);
  return response;
}
