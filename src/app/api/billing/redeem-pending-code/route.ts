import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { PENDING_TRIAL_CODE_COOKIE } from '@/lib/trial-code-cookie';
import { redeemTrialCode } from '@/lib/trial-codes';

/** Redeems the pre-auth access code after the user's session is established. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const code = request.cookies.get(PENDING_TRIAL_CODE_COOKIE)?.value;
  if (!code) {
    // Idempotent success covers a repeated client effect or a lost first response.
    // AuthContinue only sends users here when the cookie exists initially.
    return NextResponse.json({ ok: true, status: 'already_processed' });
  }

  const result = await redeemTrialCode(user.id, code);
  const response = result.ok
    ? NextResponse.json({ ok: true, status: result.status })
    : NextResponse.json({ error: result.error }, { status: 400 });

  response.cookies.set(PENDING_TRIAL_CODE_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return response;
}
