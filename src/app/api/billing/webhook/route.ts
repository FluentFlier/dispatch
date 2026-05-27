import { NextRequest, NextResponse } from 'next/server';
import { handleStripeWebhook } from '@/lib/stripe-webhook';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const payload = await request.text();
  const signature = request.headers.get('stripe-signature');

  const result = await handleStripeWebhook(payload, signature);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ received: true });
}
