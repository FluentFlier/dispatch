import { describe, expect, it } from 'vitest';
import { getFunnelCta } from '@/lib/funnel-cta';

describe('getFunnelCta', () => {
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

  it('sends logged-out users to the access-code gate', () => {
    expect(getFunnelCta({ loggedIn: false, onboardingComplete: false, sub: null })).toEqual({
      href: '/get-started',
      label: 'Start free trial',
    });
  });

  it('sends trial users mid-setup to onboarding', () => {
    expect(
      getFunnelCta({ loggedIn: true, onboardingComplete: false, sub: trialing })
    ).toEqual({
      href: '/onboarding',
      label: 'Finish setup',
    });
  });

  it('sends expired trial users to pricing', () => {
    expect(
      getFunnelCta({ loggedIn: true, onboardingComplete: true, sub: expired })
    ).toEqual({
      href: '/pricing?trial=expired',
      label: 'Choose a plan',
    });
  });
});
