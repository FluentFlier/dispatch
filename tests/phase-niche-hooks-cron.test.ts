/**
 * Phase: Niche Hooks - weekly refresh scheduling + budget gate.
 * The cron mines active niches due for a refresh, cheapest-first, stopping at
 * HOOKS_MINING_WEEKLY_CAP_USD. Pure helpers are tested; the Apify/DB path is a
 * manual dry-run (Step 5).
 */
import { describe, it, expect } from 'vitest';
import { selectDueNiches, budgetGate } from '@/lib/hooks-intelligence/refresh-scheduler';

const day = 86400000;
const now = new Date('2026-07-11T00:00:00Z').getTime();

describe('selectDueNiches', () => {
  const base = { id: 'n', label: 'x', seed_keywords: ['k'], status: 'active', active_user_count: 1, created_at: new Date(now - 100 * day).toISOString() };
  it('includes active niches never mined or mined > 7 days ago', () => {
    const niches = [
      { ...base, id: 'never', last_mined_at: null },
      { ...base, id: 'stale', last_mined_at: new Date(now - 8 * day).toISOString() },
      { ...base, id: 'fresh', last_mined_at: new Date(now - 2 * day).toISOString() },
    ];
    const due = selectDueNiches(niches, now).map((n) => n.id);
    expect(due).toContain('never');
    expect(due).toContain('stale');
    expect(due).not.toContain('fresh');
  });
  it('excludes zero-user active niches', () => {
    const niches = [
      { ...base, id: 'idle', active_user_count: 0, last_mined_at: null },
    ];
    expect(selectDueNiches(niches, now)).toHaveLength(0);
  });

  // B2: pending niches previously had zero production call sites into
  // earnsBudget, so they never got mined and the feature never activated.
  describe('pending niches (B2 fix)', () => {
    const pendingBase = { ...base, status: 'pending', last_mined_at: null };
    it('admits a pending niche with 2+ active users regardless of age', () => {
      const niches = [{ ...pendingBase, id: 'p1', active_user_count: 2, created_at: new Date(now - 1 * day).toISOString() }];
      expect(selectDueNiches(niches, now).map((n) => n.id)).toEqual(['p1']);
    });
    it('admits a pending niche with 1 user once it is 14+ days old', () => {
      const niches = [{ ...pendingBase, id: 'p2', active_user_count: 1, created_at: new Date(now - 15 * day).toISOString() }];
      expect(selectDueNiches(niches, now).map((n) => n.id)).toEqual(['p2']);
    });
    it('does not admit a pending niche with 1 user and only 2 days of age', () => {
      const niches = [{ ...pendingBase, id: 'p3', active_user_count: 1, created_at: new Date(now - 2 * day).toISOString() }];
      expect(selectDueNiches(niches, now)).toHaveLength(0);
    });
    it('an active stale niche is still due alongside pending admissions', () => {
      const niches = [
        { ...base, id: 'active-stale', last_mined_at: new Date(now - 8 * day).toISOString() },
        { ...pendingBase, id: 'p1', active_user_count: 2, created_at: new Date(now - 1 * day).toISOString() },
      ];
      const due = selectDueNiches(niches, now).map((n) => n.id);
      expect(due).toContain('active-stale');
      expect(due).toContain('p1');
    });
  });
});

describe('budgetGate', () => {
  it('allows spend below the cap and blocks at/over it', () => {
    expect(budgetGate(3, 5)).toBe(true);
    expect(budgetGate(5, 5)).toBe(false);
    expect(budgetGate(5.01, 5)).toBe(false);
  });
});
