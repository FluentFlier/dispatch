import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/insforge/server', () => ({
  getServiceClient: vi.fn(),
  getServerClient: vi.fn(),
}));
vi.mock('@/lib/entitlements', () => ({
  getOrCreateSubscription: vi.fn(),
}));
vi.mock('@/lib/analytics', () => ({
  trackEvent: vi.fn().mockResolvedValue(undefined),
}));

import { getServiceClient } from '@/lib/insforge/server';
import { getOrCreateSubscription } from '@/lib/entitlements';
import { redeemTrialCode, normalizeCode } from '@/lib/trial-codes';

/**
 * Builds a chainable InsForge client stub. `results` maps a table name to the
 * `{ data?, error? }` its terminal query resolves to.
 */
function makeClient(results: Record<string, { data?: unknown; error?: unknown }>) {
  function from(table: string) {
    const result = results[table] ?? { data: [], error: null };
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'limit', 'insert', 'upsert', 'update', 'delete']) {
      chain[m] = () => chain;
    }
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return chain;
  }
  return { database: { from } } as unknown as ReturnType<typeof getServiceClient>;
}

const NEW_USER_SUB = { plan: 'free', status: 'inactive', trial_ends_at: null, stripe_subscription_id: null };
const LINKEDIN_ROW = {
  code: 'LINKEDIN',
  plan: 'starter',
  trial_days: 7,
  active: true,
  max_redemptions: null,
  redemption_count: 3,
  note: 'LinkedIn launch campaign',
  created_at: '2026-07-14T00:00:00Z',
  updated_at: '2026-07-14T00:00:00Z',
};

describe('normalizeCode', () => {
  it('trims and uppercases', () => {
    expect(normalizeCode('  linkedin ')).toBe('LINKEDIN');
    expect(normalizeCode('')).toBe('');
  });
});

describe('redeemTrialCode', () => {
  beforeEach(() => {
    vi.mocked(getOrCreateSubscription).mockResolvedValue(NEW_USER_SUB);
  });

  it('starts a trial for a valid, active code', async () => {
    vi.mocked(getServiceClient).mockReturnValue(
      makeClient({
        trial_codes: { data: [LINKEDIN_ROW], error: null },
        trial_code_redemptions: { error: null },
        subscriptions: { error: null },
      }),
    );

    const result = await redeemTrialCode('user-1', 'linkedin');
    expect(result.ok).toBe(true);
    if (result.ok && result.status === 'started') {
      expect(result.plan).toBe('starter');
      expect(new Date(result.trialEndsAt).getTime()).toBeGreaterThan(Date.now());
    } else {
      throw new Error('expected started');
    }
  });

  it('rejects an unknown code', async () => {
    vi.mocked(getServiceClient).mockReturnValue(
      makeClient({ trial_codes: { data: [], error: null } }),
    );
    const result = await redeemTrialCode('user-1', 'NOPE');
    expect(result).toEqual({ ok: false, error: 'That code is not valid.' });
  });

  it('rejects a disabled code', async () => {
    vi.mocked(getServiceClient).mockReturnValue(
      makeClient({ trial_codes: { data: [{ ...LINKEDIN_ROW, active: false }], error: null } }),
    );
    const result = await redeemTrialCode('user-1', 'LINKEDIN');
    expect(result).toEqual({ ok: false, error: 'That code is no longer active.' });
  });

  it('rejects a code at its redemption cap', async () => {
    vi.mocked(getServiceClient).mockReturnValue(
      makeClient({
        trial_codes: { data: [{ ...LINKEDIN_ROW, max_redemptions: 3, redemption_count: 3 }], error: null },
      }),
    );
    const result = await redeemTrialCode('user-1', 'LINKEDIN');
    expect(result).toEqual({ ok: false, error: 'That code has reached its redemption limit.' });
  });

  it('short-circuits a user already on an active trial', async () => {
    vi.mocked(getOrCreateSubscription).mockResolvedValue({
      plan: 'starter',
      status: 'trialing',
      trial_ends_at: new Date(Date.now() + 86_400_000).toISOString(),
      stripe_subscription_id: null,
    });
    vi.mocked(getServiceClient).mockReturnValue(makeClient({}));
    const result = await redeemTrialCode('user-1', 'LINKEDIN');
    expect(result).toEqual({ ok: true, status: 'already_active' });
  });

  it('blocks a user whose trial was already used', async () => {
    vi.mocked(getOrCreateSubscription).mockResolvedValue({
      plan: 'free',
      status: 'inactive',
      trial_ends_at: new Date(Date.now() - 86_400_000).toISOString(),
      stripe_subscription_id: null,
    });
    vi.mocked(getServiceClient).mockReturnValue(makeClient({}));
    const result = await redeemTrialCode('user-1', 'LINKEDIN');
    expect(result.ok).toBe(false);
  });

  it('rejects empty input without hitting the database', async () => {
    vi.mocked(getServiceClient).mockReturnValue(makeClient({}));
    const result = await redeemTrialCode('user-1', '   ');
    expect(result).toEqual({ ok: false, error: 'Enter a code.' });
  });
});
