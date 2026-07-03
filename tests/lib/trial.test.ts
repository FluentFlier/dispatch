import { describe, expect, it } from 'vitest';
import {
  computeTrialEndDate,
  isAppTrialActive,
  isAppTrialExpired,
  mustSubscribe,
  trialDaysRemaining,
  TRIAL_DAYS,
} from '@/lib/trial';

describe('trial', () => {
  const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

  it('TRIAL_DAYS is 7', () => {
    expect(TRIAL_DAYS).toBe(7);
  });

  it('detects active app trial', () => {
    expect(
      isAppTrialActive({ status: 'trialing', trial_ends_at: future, stripe_subscription_id: null })
    ).toBe(true);
  });

  it('rejects expired trial', () => {
    expect(
      isAppTrialExpired({ status: 'trialing', trial_ends_at: past, stripe_subscription_id: null })
    ).toBe(true);
    expect(mustSubscribe({ status: 'trialing', trial_ends_at: past, stripe_subscription_id: null })).toBe(
      true
    );
  });

  it('paid users are not paywalled', () => {
    expect(
      mustSubscribe({ status: 'active', trial_ends_at: past, stripe_subscription_id: 'sub_1' })
    ).toBe(false);
  });

  it('computeTrialEndDate adds 7 days', () => {
    const from = new Date('2026-01-01T12:00:00.000Z');
    const end = new Date(computeTrialEndDate(from));
    expect(end.getUTCDate()).toBe(8);
  });

  it('trialDaysRemaining rounds up partial days', () => {
    const days = trialDaysRemaining({
      status: 'trialing',
      trial_ends_at: future,
      stripe_subscription_id: null,
    });
    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThanOrEqual(7);
  });
});
