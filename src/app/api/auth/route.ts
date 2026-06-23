import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateAccessToken } from '@/lib/auth';
import { ensureSoloWorkspace } from '@/lib/workspace';
import { getServerClient } from '@/lib/insforge/server';
import { logInfo, logWarn } from '@/lib/logger';

const AuthTokenSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 7,
};

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
    // Non-blocking: failure to create workspace must not block login.
    try {
      await ensureSoloWorkspace(validation.userId);
    } catch (err) {
      logWarn('auth.workspace_provision_failed', { userId: validation.userId, err });
    }

    const response = NextResponse.json({ ok: true, userId: validation.userId });
    response.cookies.set('content-os-token', parsed.data.token, COOKIE_OPTS);
    logInfo('auth.session_created', { userId: validation.userId });
    return response;
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}

/** DELETE: Clear auth cookie */
export async function DELETE(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true });
  response.cookies.set('content-os-token', '', { ...COOKIE_OPTS, maxAge: 0 });
  return response;
}
