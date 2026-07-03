/**
 * Phase: Unlimited Plan Tier
 *
 * Verifies the internal 'unlimited' comp tier (for founder + demo accounts):
 * an unlimited/active subscription resolves to uncapped limits with paid access,
 * and the tier is excluded from the purchasable Stripe price map.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

describe('Phase: Unlimited Plan Tier', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('@/lib/insforge/server');
    vi.doUnmock('@/lib/usage');
  });

  it('gives an unlimited/active subscription uncapped limits and paid access', async () => {
    const subRow = { plan: 'unlimited', status: 'active', trial_ends_at: null, stripe_subscription_id: null };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fakeClient: any = {
      database: {
        from: () => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const q: any = {};
          q.select = () => q;
          q.eq = () => q;
          q.limit = () => ({ data: [subRow], error: null });
          return q;
        },
      },
    };
    vi.doMock('@/lib/insforge/server', () => ({ getServerClient: () => fakeClient }));
    vi.doMock('@/lib/usage', () => ({ getUsageCount: vi.fn().mockResolvedValue(0) }));

    const { getUserEntitlements } = await import('@/lib/entitlements');
    const ent = await getUserEntitlements('u-1');

    expect(ent.plan).toBe('unlimited');
    expect(ent.isPaid).toBe(true);
    expect(ent.limits.canPublish).toBe(true);
    expect(ent.limits.canSchedule).toBe(true);
    expect(ent.limits.aiGenerationsPerMonth).toBeGreaterThanOrEqual(1_000_000);
    expect(ent.limits.publishesPerMonth).toBeGreaterThanOrEqual(1_000_000);
  });

  it('excludes the unlimited comp tier from the purchasable price map', async () => {
    const { getPlanPriceIds } = await import('@/lib/entitlements');
    expect(Object.keys(getPlanPriceIds()).sort()).toEqual(['growth', 'pro', 'starter']);
  });
});
