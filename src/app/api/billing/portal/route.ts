import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { createBillingPortalSession } from '@/lib/stripe';
import { getAppUrl } from '@/lib/env';

export async function POST(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Billing is not configured' }, { status: 503 });
  }

  const client = getServerClient();
  const { data: rows } = await client.database
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .limit(1);

  const customerId = rows?.[0]?.stripe_customer_id as string | undefined;
  if (!customerId) {
    return NextResponse.json({ error: 'No billing account found' }, { status: 400 });
  }

  const url = await createBillingPortalSession(customerId, `${getAppUrl()}/settings?tab=billing`);
  return NextResponse.json({ url });
}
