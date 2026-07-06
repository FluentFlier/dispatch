import { getServiceClient } from '@/lib/insforge/server';

export type StripeWebhookStatus = 'ok' | 'error' | 'ignored';

export interface StripeWebhookEntry {
  id: string;
  eventId: string | null;
  eventType: string;
  status: StripeWebhookStatus;
  details: Record<string, unknown>;
  createdAt: string;
}

/**
 * Records Stripe webhook processing outcome for admin health monitoring.
 */
export async function logStripeWebhook(input: {
  eventId?: string;
  eventType: string;
  status: StripeWebhookStatus;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    const client = getServiceClient();
    const { error } = await client.database.from('stripe_webhook_log').insert([
      {
        event_id: input.eventId ?? null,
        event_type: input.eventType,
        status: input.status,
        details: input.details ?? {},
      },
    ]);
    if (error) {
      console.warn('[stripe-log] insert failed:', error.message);
    }
  } catch (err) {
    console.warn('[stripe-log] unexpected error:', err);
  }
}

/**
 * Returns recent webhook log rows.
 */
export async function getStripeWebhookLog(limit = 100): Promise<StripeWebhookEntry[]> {
  const client = getServiceClient();
  const { data, error } = await client.database
    .from('stripe_webhook_log')
    .select('id, event_id, event_type, status, details, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id as string,
    eventId: (row.event_id as string | null) ?? null,
    eventType: row.event_type as string,
    status: row.status as StripeWebhookStatus,
    details: (row.details as Record<string, unknown>) ?? {},
    createdAt: row.created_at as string,
  }));
}
