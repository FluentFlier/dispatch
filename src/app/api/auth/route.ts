import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { establishAuthenticatedSession } from '@/lib/auth-establish';
import { setAuthCookiesOnResponse, clearAuthCookiesOnResponse } from '@/lib/auth-refresh';
import { logWarn } from '@/lib/logger';

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

    const established = await establishAuthenticatedSession(parsed.data.token);
    if ('error' in established) {
      logWarn('auth.token_rejected', { reason: established.error });
      return NextResponse.json({ error: 'Invalid session token' }, { status: 401 });
    }

    const response = NextResponse.json({
      ok: true,
      userId: established.userId,
      hasRefreshToken: Boolean(parsed.data.refreshToken),
    });
    setAuthCookiesOnResponse(response, parsed.data.token, parsed.data.refreshToken);
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
