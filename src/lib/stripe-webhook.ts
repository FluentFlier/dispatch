import { createHmac, timingSafeEqual } from 'crypto';
import { getServiceClient } from '@/lib/insforge/server';
import type { PlanId } from '@/lib/entitlements';
import { trackEvent } from '@/lib/analytics';
import { logInfo } from '@/lib/logger';

function verifyStripeSignature(payload: string, signature: string, secret: string): boolean {
  const parts = signature.split(',').reduce<Record<string, string>>((acc, part) => {
    const [k, v] = part.split('=');
    if (k && v) acc[k] = v;
    return acc;
  }, {});

  const timestamp = parts.t;
  const sig = parts.v1;
  if (!timestamp || !sig) return false;

  const signed = `${timestamp}.${payload}`;
  const expected = createHmac('sha256', secret).update(signed).digest('hex');

  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return false;
  }
}

function planFromMetadata(meta: Record<string, string> | undefined): PlanId {
  const plan = meta?.plan;
  if (plan === 'starter' || plan === 'growth' || plan === 'pro') return plan;
  return 'starter';
}

export async function handleStripeWebhook(
  payload: string,
  signature: string | null
): Promise<{ ok: boolean; error?: string }> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return { ok: false, error: 'Webhook secret not configured' };
  if (!signature || !verifyStripeSignature(payload, signature, secret)) {
    return { ok: false, error: 'Invalid signature' };
  }

  const event = JSON.parse(payload) as {
    type: string;
    data: { object: Record<string, unknown> };
  };

  const client = getServiceClient();

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = (session.metadata as Record<string, string>)?.user_id;
      const customerId = session.customer as string;
      const subscriptionId = session.subscription as string;
      const plan = planFromMetadata(session.metadata as Record<string, string>);

      if (!userId) break;

      await client.database.from('subscriptions').upsert(
        [
          {
            user_id: userId,
            plan,
            status: 'active',
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            updated_at: new Date().toISOString(),
          },
        ],
        { onConflict: 'user_id' }
      );

      await trackEvent('subscription_active', { userId, plan });
      logInfo('stripe.checkout_completed', { userId, plan });
      break;
    }

    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const status = sub.status as string;
      const customerId = sub.customer as string;
      const subscriptionId = sub.id as string;
      const plan = planFromMetadata(sub.metadata as Record<string, string>);

      // Stripe does not reliably copy metadata onto subscription objects, so we
      // resolve the local user by the stored stripe_customer_id first and only
      // fall back to metadata.user_id. Without this, cancellations/downgrades
      // could silently no-op and leave a canceled user with paid access.
      let userId: string | undefined;
      if (customerId) {
        const { data: rows } = await client.database
          .from('subscriptions')
          .select('user_id')
          .eq('stripe_customer_id', customerId)
          .limit(1);
        userId = (rows?.[0] as { user_id?: string } | undefined)?.user_id;
      }
      if (!userId) {
        userId = (sub.metadata as Record<string, string>)?.user_id;
      }

      if (!userId) {
        console.warn(
          `[stripe-webhook] Could not resolve user for ${event.type}; stripe_customer_id=${customerId}`
        );
        break;
      }

      const mappedStatus =
        status === 'active' || status === 'trialing'
          ? status
          : status === 'past_due'
            ? 'past_due'
            : 'canceled';

      await client.database.from('subscriptions').upsert(
        [
          {
            user_id: userId,
            plan: mappedStatus === 'canceled' ? 'free' : plan,
            status: mappedStatus,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            current_period_start: sub.current_period_start
              ? new Date((sub.current_period_start as number) * 1000).toISOString()
              : null,
            current_period_end: sub.current_period_end
              ? new Date((sub.current_period_end as number) * 1000).toISOString()
              : null,
            updated_at: new Date().toISOString(),
          },
        ],
        { onConflict: 'user_id' }
      );
      break;
    }

    default:
      break;
  }

  return { ok: true };
}
