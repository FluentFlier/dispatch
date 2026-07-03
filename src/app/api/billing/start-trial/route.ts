import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { computeTrialEndDate, isAppTrialActive, isAppTrialExpired } from '@/lib/trial';
import { getOrCreateSubscription } from '@/lib/entitlements';
import { trackEvent } from '@/lib/analytics';

/**
 * POST /api/billing/start-trial
 * Starts a one-time 7-day Starter trial and unlocks the workspace.
 */
export async function POST(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = getServerClient();
  const sub = await getOrCreateSubscription(user.id);

  const row = sub as {
    status: string;
    trial_ends_at?: string | null;
    stripe_subscription_id?: string | null;
  };

  if (isAppTrialActive(row)) {
    return NextResponse.json({ ok: true, alreadyActive: true });
  }

  if (isAppTrialExpired(row) || row.trial_ends_at) {
    return NextResponse.json(
      { error: 'Your free trial has ended. Choose a plan to continue.' },
      { status: 403 }
    );
  }

  if (row.stripe_subscription_id || row.status === 'active') {
    return NextResponse.json({ ok: true, alreadyPaid: true });
  }

  const trialEndsAt = computeTrialEndDate();

  await client.database.from('subscriptions').upsert(
    [
      {
        user_id: user.id,
        plan: 'starter',
        status: 'trialing',
        trial_ends_at: trialEndsAt,
        updated_at: new Date().toISOString(),
      },
    ],
    { onConflict: 'user_id' }
  );

  await trackEvent('trial_started', { userId: user.id, trialEndsAt });

  return NextResponse.json({
    ok: true,
    trialEndsAt,
    days: 7,
  });
}
