import { getServiceClient } from '@/lib/insforge/server';

interface SubscriptionState {
  status?: string | null;
  stripe_subscription_id?: string | null;
}

/**
 * Internal operators need product access as well as admin-console access.
 * INTERNAL_ACCESS_EMAILS can narrow the set; otherwise ADMIN_EMAILS is the
 * single source of truth so an admin can never be trapped at the invite gate.
 */
export function getInternalAccessEmails(): string[] {
  const raw = process.env.INTERNAL_ACCESS_EMAILS ?? process.env.ADMIN_EMAILS ?? '';
  return raw
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isInternalAccessEmail(email: string): boolean {
  return getInternalAccessEmails().includes(email.trim().toLowerCase());
}

export function shouldGrantInternalAccess(
  email: string,
  subscription: SubscriptionState | null,
): boolean {
  if (!isInternalAccessEmail(email)) return false;

  // Preserve real Stripe subscriptions. They already grant access and their
  // billing state must remain webhook-owned.
  if (subscription?.stripe_subscription_id) return false;

  return subscription?.status !== 'active';
}

/**
 * Gives internal accounts the non-purchasable unlimited plan before the normal
 * post-auth router decides between onboarding, the app, and access-code entry.
 */
export async function ensureInternalProductAccess(user: {
  id: string;
  email: string;
}): Promise<void> {
  if (!isInternalAccessEmail(user.email)) return;

  const service = getServiceClient();
  const { data: rows, error: readError } = await service.database
    .from('subscriptions')
    .select('status, stripe_subscription_id')
    .eq('user_id', user.id)
    .limit(1);

  if (readError) throw readError;

  const existing = rows?.[0] as SubscriptionState | undefined;
  if (!shouldGrantInternalAccess(user.email, existing ?? null)) return;

  const values = {
    plan: 'unlimited',
    status: 'active',
    trial_ends_at: null,
    updated_at: new Date().toISOString(),
  };

  const result = existing
    ? await service.database.from('subscriptions').update(values).eq('user_id', user.id)
    : await service.database.from('subscriptions').insert([{ user_id: user.id, ...values }]);

  if (result.error) throw result.error;
}
