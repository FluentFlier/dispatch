import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { startTrialForUser } from '@/lib/start-trial';

/**
 * POST /api/billing/start-trial
 * Starts a one-time 7-day Starter trial and unlocks the workspace.
 */
export async function POST(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await startTrialForUser(user.id);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 403 });
  }

  if (result.status === 'already_active') {
    return NextResponse.json({ ok: true, alreadyActive: true });
  }

  if (result.status === 'already_paid') {
    return NextResponse.json({ ok: true, alreadyPaid: true });
  }

  return NextResponse.json({
    ok: true,
    trialEndsAt: result.trialEndsAt,
    days: 7,
  });
}
