import { getServerClient } from '@/lib/insforge/server';
import { getOrCreateSubscription } from '@/lib/entitlements';
import { computeTrialEndDate, isAppTrialActive, isAppTrialExpired } from '@/lib/trial';
import { trackEvent } from '@/lib/analytics';

export type StartTrialResult =
  | { ok: true; status: 'started'; trialEndsAt: string }
  | { ok: true; status: 'already_active' }
  | { ok: true; status: 'already_paid' }
  | { ok: false; status: 'expired'; error: string };

/**
 * Starts a one-time 7-day Starter trial for the user, or reports current state.
 * Shared by API route and post-auth continue flow.
 */
export async function startTrialForUser(userId: string): Promise<StartTrialResult> {
  const client = getServerClient();
  const sub = await getOrCreateSubscription(userId);

  const row = sub as {
    status: string;
    trial_ends_at?: string | null;
    stripe_subscription_id?: string | null;
  };

  if (isAppTrialActive(row)) {
    return { ok: true, status: 'already_active' };
  }

  if (isAppTrialExpired(row) || row.trial_ends_at) {
    return {
      ok: false,
      status: 'expired',
      error: 'Your free trial has ended. Choose a plan to continue.',
    };
  }

  if (row.stripe_subscription_id || row.status === 'active') {
    return { ok: true, status: 'already_paid' };
  }

  const trialEndsAt = computeTrialEndDate();

  await client.database.from('subscriptions').upsert(
    [
      {
        user_id: userId,
        plan: 'starter',
        status: 'trialing',
        trial_ends_at: trialEndsAt,
        updated_at: new Date().toISOString(),
      },
    ],
    { onConflict: 'user_id' }
  );

  await trackEvent('trial_started', { userId, trialEndsAt });

  return { ok: true, status: 'started', trialEndsAt };
}
