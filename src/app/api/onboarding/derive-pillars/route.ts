import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { chatCompletion } from '@/lib/llm';
import {
  DEFAULT_PILLARS,
  DERIVE_PILLARS_SYSTEM,
  parseDerivedPillars,
} from '@/lib/onboarding/derive-pillars';

export const maxDuration = 30;

/**
 * POST /api/onboarding/derive-pillars
 *
 * Turns the onboarding one-liner into 2-3 content pillars for users who skip
 * account connect (no ingest, so no baseline pillars). Always returns 200 with a
 * usable set: onboarding must never dead-end on this call. chatCompletion
 * already enforces the deployment-wide daily AI budget.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let description = '';
  try {
    const body = (await request.json()) as { description?: unknown };
    description = String(body.description ?? '').trim().slice(0, 400);
  } catch {
    description = '';
  }

  if (!description) return NextResponse.json({ pillars: DEFAULT_PILLARS });

  try {
    const raw = await chatCompletion(DERIVE_PILLARS_SYSTEM, description, {
      maxTokens: 300,
      temperature: 0,
    });
    return NextResponse.json({ pillars: parseDerivedPillars(raw) });
  } catch {
    return NextResponse.json({ pillars: DEFAULT_PILLARS });
  }
}
