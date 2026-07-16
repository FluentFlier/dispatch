import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  PENDING_TRIAL_CODE_COOKIE,
  PENDING_TRIAL_CODE_MAX_AGE_SECONDS,
} from '@/lib/trial-code-cookie';
import { validateTrialCode } from '@/lib/trial-codes';

const BodySchema = z.object({ code: z.string().min(1).max(64) });

/** Validates a code before sign-in and stores it briefly for post-auth redemption. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter a code.' }, { status: 400 });
  }

  const result = await validateTrialCode(parsed.data.code);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(PENDING_TRIAL_CODE_COOKIE, result.code, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: PENDING_TRIAL_CODE_MAX_AGE_SECONDS,
  });
  return response;
}
