import { getServiceClient } from '@/lib/insforge/server';
import { getStripeWebhookLog } from '@/lib/admin/stripe-log';

export interface StripeMismatch {
  userId: string;
  issue: string;
  dbPlan: string;
  dbStatus: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export interface StripeHealthReport {
  recentWebhooks: Awaited<ReturnType<typeof getStripeWebhookLog>>;
  recentErrors: number;
  mismatches: StripeMismatch[];
  stripeApiChecked: boolean;
  timestamp: string;
}

/**
 * Finds local subscription rows that look inconsistent with Stripe linkage or status.
 */
export async function detectSubscriptionMismatches(): Promise<StripeMismatch[]> {
  const client = getServiceClient();
  const { data } = await client.database
    .from('subscriptions')
    .select('user_id, plan, status, stripe_customer_id, stripe_subscription_id')
    .limit(500);

  const mismatches: StripeMismatch[] = [];

  for (const row of data ?? []) {
    const userId = row.user_id as string;
    const plan = row.plan as string;
    const status = row.status as string;
    const customerId = (row.stripe_customer_id as string | null) ?? null;
    const subId = (row.stripe_subscription_id as string | null) ?? null;

    if (status === 'active' && plan !== 'free' && !customerId) {
      mismatches.push({
        userId,
        issue: 'Active paid plan without stripe_customer_id',
        dbPlan: plan,
        dbStatus: status,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subId,
      });
    }

    if (customerId && status === 'inactive' && plan !== 'free') {
      mismatches.push({
        userId,
        issue: 'Stripe customer linked but status inactive with non-free plan',
        dbPlan: plan,
        dbStatus: status,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subId,
      });
    }

    if (subId && !customerId) {
      mismatches.push({
        userId,
        issue: 'stripe_subscription_id without stripe_customer_id',
        dbPlan: plan,
        dbStatus: status,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subId,
      });
    }
  }

  return mismatches;
}

/**
 * Builds admin Stripe health report: webhook log + DB mismatch heuristics.
 */
export async function getStripeHealthReport(): Promise<StripeHealthReport> {
  const recentWebhooks = await getStripeWebhookLog(50);
  const recentErrors = recentWebhooks.filter(
    (w) => w.status === 'error' && Date.now() - new Date(w.createdAt).getTime() < 24 * 60 * 60 * 1000,
  ).length;
  const mismatches = await detectSubscriptionMismatches();

  return {
    recentWebhooks,
    recentErrors,
    mismatches,
    stripeApiChecked: Boolean(process.env.STRIPE_SECRET_KEY),
    timestamp: new Date().toISOString(),
  };
}
