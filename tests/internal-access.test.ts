import { afterEach, describe, expect, it, vi } from 'vitest';

describe('internal product access', () => {
  const originalAdmins = process.env.ADMIN_EMAILS;
  const originalInternal = process.env.INTERNAL_ACCESS_EMAILS;

  afterEach(() => {
    if (originalAdmins === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = originalAdmins;
    if (originalInternal === undefined) delete process.env.INTERNAL_ACCESS_EMAILS;
    else process.env.INTERNAL_ACCESS_EMAILS = originalInternal;
    vi.resetModules();
  });

  it('defaults internal product access to the admin allowlist', async () => {
    process.env.ADMIN_EMAILS = 'Founder@TryAda.app, engineering@tryada.app';
    delete process.env.INTERNAL_ACCESS_EMAILS;

    const { isInternalAccessEmail } = await import('@/lib/internal-access');
    expect(isInternalAccessEmail('founder@tryada.app')).toBe(true);
    expect(isInternalAccessEmail('customer@example.com')).toBe(false);
  });

  it('allows a separate internal-access allowlist', async () => {
    process.env.ADMIN_EMAILS = 'admin@example.com';
    process.env.INTERNAL_ACCESS_EMAILS = 'founder@tryada.app';

    const { isInternalAccessEmail } = await import('@/lib/internal-access');
    expect(isInternalAccessEmail('founder@tryada.app')).toBe(true);
    expect(isInternalAccessEmail('admin@example.com')).toBe(false);
  });

  it('grants inactive internal accounts but preserves Stripe billing state', async () => {
    process.env.INTERNAL_ACCESS_EMAILS = 'founder@tryada.app';

    const { shouldGrantInternalAccess } = await import('@/lib/internal-access');
    expect(
      shouldGrantInternalAccess('founder@tryada.app', {
        status: 'inactive',
        stripe_subscription_id: null,
      }),
    ).toBe(true);
    expect(
      shouldGrantInternalAccess('founder@tryada.app', {
        status: 'active',
        stripe_subscription_id: 'sub_paid',
      }),
    ).toBe(false);
    expect(
      shouldGrantInternalAccess('customer@example.com', {
        status: 'inactive',
        stripe_subscription_id: null,
      }),
    ).toBe(false);
  });
});
