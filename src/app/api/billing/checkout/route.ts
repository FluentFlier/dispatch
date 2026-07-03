import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getOrCreateSubscription, getPlanPriceIds, type PlanId } from '@/lib/entitlements';
import { createStripeCustomer, createCheckoutSession } from '@/lib/stripe';
import { getAppUrl } from '@/lib/env';
import { trackEvent } from '@/lib/analytics';

const CheckoutSchema = z.object({
  plan: z.enum(['starter', 'growth', 'pro']),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Billing is not configured' }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = CheckoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const plan = parsed.data.plan as Exclude<PlanId, 'free' | 'unlimited'>;
  const priceId = getPlanPriceIds()[plan];
  if (!priceId) {
    return NextResponse.json({ error: `Price not configured for ${plan}` }, { status: 503 });
  }

  const client = getServerClient();
  const sub = await getOrCreateSubscription(user.id);

  let customerId = (
    await client.database
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .limit(1)
  ).data?.[0]?.stripe_customer_id as string | undefined;

  if (!customerId) {
    customerId = await createStripeCustomer(user.email, user.id);
    await client.database
      .from('subscriptions')
      .update({ stripe_customer_id: customerId })
      .eq('user_id', user.id);
  }

  const appUrl = getAppUrl();
  const url = await createCheckoutSession({
    customerId,
    priceId,
    successUrl: `${appUrl}/settings?tab=billing&checkout=success`,
    cancelUrl: `${appUrl}/pricing?checkout=canceled`,
    userId: user.id,
    plan,
  });

  await trackEvent('upgrade_checkout_started', { plan, userId: user.id });

  return NextResponse.json({ url });
}
