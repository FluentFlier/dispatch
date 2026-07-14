/** Length of the no-card free trial (Starter-tier access). */
export const TRIAL_DAYS = 7;

export interface TrialSubscriptionRow {
  status: string;
  trial_ends_at?: string | null;
  stripe_subscription_id?: string | null;
}

/**
 * True when the user is in an active app-managed trial (not Stripe billing trial).
 */
export function isAppTrialActive(sub: TrialSubscriptionRow): boolean {
  if (!sub.trial_ends_at || sub.status !== 'trialing') return false;
  if (sub.stripe_subscription_id) return false;
  return new Date(sub.trial_ends_at).getTime() > Date.now();
}

/**
 * True when the user consumed their app trial and has no paid Stripe subscription.
 */
export function isAppTrialExpired(sub: TrialSubscriptionRow): boolean {
  if (!sub.trial_ends_at) return false;
  if (sub.status === 'active' || sub.stripe_subscription_id) return false;
  return new Date(sub.trial_ends_at).getTime() <= Date.now();
}

/** User has an active paid Stripe subscription. */
export function hasPaidSubscription(sub: TrialSubscriptionRow): boolean {
  return sub.status === 'active' || Boolean(sub.stripe_subscription_id);
}

/** Whole-app paywall: trial ended and no payment on file. */
export function mustSubscribe(sub: TrialSubscriptionRow): boolean {
  if (hasPaidSubscription(sub)) return false;
  if (isAppTrialActive(sub)) return false;
  return isAppTrialExpired(sub);
}

/** Days remaining in app trial (0 if inactive or expired). */
export function trialDaysRemaining(sub: TrialSubscriptionRow): number {
  if (!isAppTrialActive(sub) || !sub.trial_ends_at) return 0;
  const ms = new Date(sub.trial_ends_at).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

/** ISO timestamp for trial end, starting from now. Defaults to TRIAL_DAYS. */
export function computeTrialEndDate(from: Date = new Date(), days: number = TRIAL_DAYS): string {
  const end = new Date(from);
  end.setDate(end.getDate() + days);
  return end.toISOString();
}
