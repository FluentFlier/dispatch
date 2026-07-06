import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateAccessToken } from '@/lib/auth';
import { setAuthCookiesOnResponse, clearAuthCookiesOnResponse } from '@/lib/auth-refresh';
import { ensureSoloWorkspace } from '@/lib/workspace';
import { getServiceClient } from '@/lib/insforge/server';
import { logInfo, logWarn } from '@/lib/logger';
import { fetchOAuthDisplayName, syncProfileDisplayNameFromOAuth } from '@/lib/user-display-name';

const AuthTokenSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  refreshToken: z.string().nullish().transform((v) => v ?? undefined),
});

/** POST: Validate token and set httpOnly session cookie */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const parsed = AuthTokenSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.message }, { status: 400 });
    }

    const validation = await validateAccessToken(parsed.data.token);
    if (!validation.valid) {
      logWarn('auth.token_rejected', { reason: validation.error });
      return NextResponse.json({ error: 'Invalid session token' }, { status: 401 });
    }

    // Ensure every authenticated user has a solo workspace on their first login.
    // Non-blocking: failure never blocks login. Called before the response cookie
    // is written so getServerClient() runs anon (RLS blocks the membership read).
    // ensureSoloWorkspace falls through to getServiceClient() for the INSERT —
    // if the workspace already exists the INSERT may fail, which is fine.
    ensureSoloWorkspace(validation.userId).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      // Suppress expected duplicate-workspace errors on repeat logins
      if (!msg.includes('duplicate') && !msg.includes('unique') && !msg.includes('already exists')) {
        logWarn('auth.workspace_provision_failed', { userId: validation.userId, error: msg });
      }
    });

    // Fix placeholder display names (email local-part) with OAuth profile name.
    void (async () => {
      const oauthName = await fetchOAuthDisplayName(parsed.data.token);
      if (!oauthName || !validation.email) return;
      try {
        await syncProfileDisplayNameFromOAuth(
          getServiceClient(),
          validation.userId,
          validation.email,
          oauthName,
        );
      } catch (err) {
        logWarn('auth.display_name_sync_failed', {
          userId: validation.userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    const response = NextResponse.json({ ok: true, userId: validation.userId });
    setAuthCookiesOnResponse(response, parsed.data.token, parsed.data.refreshToken);
    logInfo('auth.session_created', { userId: validation.userId });
    return response;
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}

/** DELETE: Clear auth cookie */
export async function DELETE(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true });
  clearAuthCookiesOnResponse(response);
  return response;
}
