/**
 * Phase: Niche Hooks - weekly refresh scheduling + budget gate.
 * The cron mines active niches due for a refresh, cheapest-first, stopping at
 * HOOKS_MINING_WEEKLY_CAP_USD. Pure helpers are tested; the Apify/DB path is a
 * manual dry-run (Step 5).
 */
import { describe, it, expect } from 'vitest';
import { selectDueNiches, budgetGate } from '@/app/api/cron/hooks-refresh/route';

const day = 86400000;
const now = new Date('2026-07-11T00:00:00Z').getTime();

describe('selectDueNiches', () => {
  const base = { id: 'n', label: 'x', seed_keywords: ['k'], status: 'active', active_user_count: 1 };
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
  it('excludes non-active niches and zero-user niches', () => {
    const niches = [
      { ...base, id: 'pending', status: 'pending', last_mined_at: null },
      { ...base, id: 'idle', active_user_count: 0, last_mined_at: null },
    ];
    expect(selectDueNiches(niches, now)).toHaveLength(0);
  });
});

describe('budgetGate', () => {
  it('allows spend below the cap and blocks at/over it', () => {
    expect(budgetGate(3, 5)).toBe(true);
    expect(budgetGate(5, 5)).toBe(false);
    expect(budgetGate(5.01, 5)).toBe(false);
  });
});
