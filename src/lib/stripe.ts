/**
 * Minimal Stripe REST client (no SDK dependency).
 */

const STRIPE_API = 'https://api.stripe.com/v1';

function stripeKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');
  return key;
}

async function stripeRequest(
  path: string,
  body: Record<string, string>
): Promise<Record<string, unknown>> {
  const params = new URLSearchParams(body);
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeKey()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const json = (await res.json()) as Record<string, unknown> & { error?: { message?: string } };
  if (!res.ok) {
    throw new Error(json.error?.message ?? `Stripe error ${res.status}`);
  }
  return json;
}

export async function createStripeCustomer(email: string, userId: string): Promise<string> {
  const json = await stripeRequest('/customers', {
    email,
    'metadata[user_id]': userId,
  });
  return json.id as string;
}

export async function createCheckoutSession(params: {
  customerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  userId: string;
  plan: string;
}): Promise<string> {
  const json = await stripeRequest('/checkout/sessions', {
    mode: 'subscription',
    customer: params.customerId,
    'line_items[0][price]': params.priceId,
    'line_items[0][quantity]': '1',
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    'metadata[user_id]': params.userId,
    'metadata[plan]': params.plan,
    'subscription_data[metadata][user_id]': params.userId,
    'subscription_data[metadata][plan]': params.plan,
  });
  return json.url as string;
}

export async function createBillingPortalSession(
  customerId: string,
  returnUrl: string
): Promise<string> {
  const json = await stripeRequest('/billing_portal/sessions', {
    customer: customerId,
    return_url: returnUrl,
  });
  return json.url as string;
}
