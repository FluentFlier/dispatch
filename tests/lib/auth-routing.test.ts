import { describe, expect, it } from 'vitest';
import { getPostAuthPath } from '@/lib/auth-routing';

describe('getPostAuthPath', () => {
  const paid = { status: 'active', stripe_subscription_id: 'sub_1', trial_ends_at: null };
  const trialing = {
    status: 'trialing',
    stripe_subscription_id: null,
    trial_ends_at: new Date(Date.now() + 86400000).toISOString(),
  };
  const expired = {
    status: 'trialing',
    stripe_subscription_id: null,
    trial_ends_at: new Date(Date.now() - 86400000).toISOString(),
  };
  const fresh = { status: 'free', stripe_subscription_id: null, trial_ends_at: null };

  it('sends new users to get-started', () => {
    expect(getPostAuthPath(null, fresh)).toBe('/get-started');
  });

  it('sends trial users without profile to onboarding', () => {
    expect(getPostAuthPath({ onboarding_complete: false }, trialing)).toBe('/onboarding');
  });

  it('sends onboarded trial users to dashboard', () => {
    expect(getPostAuthPath({ onboarding_complete: true }, trialing)).toBe('/dashboard');
  });

  it('sends paid users without profile to onboarding', () => {
    expect(getPostAuthPath(null, paid)).toBe('/onboarding');
  });

  it('sends expired trial users to pricing', () => {
    expect(getPostAuthPath({ onboarding_complete: true }, expired)).toBe('/pricing');
  });
});
