/**
 * Phase: Feedback Ops - Thompson arm rewards (spec 4.1 / 2.4).
 * r = 1 iff post engagement beat the SAME user's trailing median (controls
 * for audience size). alpha += r, beta += 1 - r. Edits are half-weight
 * negative: beta += 0.5. hook_performance EMA continues in parallel.
 */
import { describe, it, expect } from 'vitest';
import {
  medianOf, engagementRateOf, getTrailingMedianEngagement,
  updateArmsForHooks, applyEditPenaltyToArms,
} from '@/lib/hooks-intelligence/rewards';

// --- Minimal chainable fake of the InsForge client -------------------------
// Supports the exact chains rewards.ts uses. Records writes for assertions.
type Row = Record<string, unknown>;
function fakeClient(tables: Record<string, Row[]>) {
  const writes: Array<{ table: string; op: 'insert' | 'update'; values: Row; match?: Row }> = [];
  function from(table: string) {
    const rows = tables[table] ?? [];
    const filters: Array<(r: Row) => boolean> = [];
    const builder: any = {
      select: () => builder,
      eq: (col: string, val: unknown) => { filters.push((r) => r[col] === val); return builder; },
      gte: (col: string, val: number) => { filters.push((r) => Number(r[col]) >= val); return builder; },
      not: (col: string, _op: string, _val: unknown) => { filters.push((r) => r[col] !== null && r[col] !== undefined); return builder; },
      order: () => builder,
      limit: (n: number) => Promise.resolve({ data: rows.filter((r) => filters.every((f) => f(r))).slice(0, n), error: null }),
      maybeSingle: () => Promise.resolve({ data: rows.find((r) => filters.every((f) => f(r))) ?? null, error: null }),
      insert: (values: Row) => { writes.push({ table, op: 'insert', values }); return Promise.resolve({ data: values, error: null }); },
      update: (values: Row) => ({
        eq: (c1: string, v1: unknown) => ({
          eq: (_c2: string, _v2: unknown) => {
            writes.push({ table, op: 'update', values, match: { [c1]: v1 } });
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
    };
    return builder;
  }
  return { client: { database: { from } } as any, writes };
}

describe('medianOf / engagementRateOf', () => {
  it('median of odd and even lists, null for empty', () => {
    expect(medianOf([3, 1, 2])).toBe(2);
    expect(medianOf([4, 1, 2, 3])).toBe(2.5);
    expect(medianOf([])).toBeNull();
  });
  it('engagement rate matches the intelligence-sync formula', () => {
    expect(engagementRateOf({ saves: 2, likes: 5, comments: 3, views: 100 })).toBeCloseTo(0.1);
    expect(engagementRateOf({ saves: 0, likes: 0, comments: 0, views: 0 })).toBe(0);
  });
});

describe('getTrailingMedianEngagement', () => {
  const mkPost = (views: number, likes: number) => ({
    // posted_date required: getTrailingMedianEngagement narrows via onlyPublished.
    user_id: 'u1', status: 'posted', posted_date: '2026-07-01', views, saves: 0, likes, comments: 0, rl_processed_at: 'x', created_at: 'x',
  });
  it('returns null with fewer than 3 prior processed posts', async () => {
    const { client } = fakeClient({ posts: [mkPost(200, 10), mkPost(200, 20)] });
    expect(await getTrailingMedianEngagement(client, 'u1')).toBeNull();
  });
  it('returns the median engagement rate of prior posts', async () => {
    const { client } = fakeClient({ posts: [mkPost(100, 1), mkPost(100, 3), mkPost(100, 5)] });
    expect(await getTrailingMedianEngagement(client, 'u1')).toBeCloseTo(0.03);
  });
});

describe('updateArmsForHooks', () => {
  const tables = () => ({
    hook_examples: [{ id: 'h1', niche_id: 'n1' }, { id: 'h2', niche_id: null }],
    hook_arms: [{ niche_id: 'n1', hook_id: 'h1', alpha: 2, beta: 3, pulls: 5 }],
  });
  it('reward=1 bumps alpha, leaves beta', async () => {
    const { client, writes } = fakeClient(tables());
    const res = await updateArmsForHooks(client, ['h1'], 1);
    expect(res).toEqual({ updated: 1, skipped: 0 });
    const w = writes.find((x) => x.table === 'hook_arms' && x.op === 'update')!;
    expect(w.values.alpha).toBe(3);
    expect(w.values.beta).toBe(3);
  });
  it('reward=0 bumps beta, leaves alpha', async () => {
    const { client, writes } = fakeClient(tables());
    await updateArmsForHooks(client, ['h1'], 0);
    const w = writes.find((x) => x.table === 'hook_arms' && x.op === 'update')!;
    expect(w.values.alpha).toBe(2);
    expect(w.values.beta).toBe(4);
  });
  it('skips hooks without a niche (bootstrap/static hooks stay EMA-only)', async () => {
    const { client, writes } = fakeClient(tables());
    const res = await updateArmsForHooks(client, ['h2'], 1);
    expect(res).toEqual({ updated: 0, skipped: 1 });
    expect(writes.filter((x) => x.table === 'hook_arms')).toHaveLength(0);
  });
  it('inserts a fresh arm (prior 1,1 plus the reward) when none exists', async () => {
    const { client, writes } = fakeClient({
      hook_examples: [{ id: 'h3', niche_id: 'n2' }], hook_arms: [],
    });
    await updateArmsForHooks(client, ['h3'], 0);
    const w = writes.find((x) => x.table === 'hook_arms' && x.op === 'insert')!;
    expect(w.values.alpha).toBe(1);
    expect(w.values.beta).toBe(2);
  });
  it('ACCEPTANCE 4.5.1: ten straight flops visibly collapse the arm mean', async () => {
    // Start at alpha=2, beta=3 (mean 0.40). Ten reward=0 updates -> beta=13, mean ~0.13.
    let arm = { niche_id: 'n1', hook_id: 'h1', alpha: 2, beta: 3, pulls: 5 };
    for (let i = 0; i < 10; i++) {
      const { client, writes } = fakeClient({ hook_examples: [{ id: 'h1', niche_id: 'n1' }], hook_arms: [arm] });
      await updateArmsForHooks(client, ['h1'], 0);
      const w = writes.find((x) => x.table === 'hook_arms' && x.op === 'update')!;
      arm = { ...arm, alpha: Number(w.values.alpha), beta: Number(w.values.beta) };
    }
    const meanBefore = 2 / (2 + 3);
    const meanAfter = arm.alpha / (arm.alpha + arm.beta);
    expect(arm.beta).toBe(13);
    expect(meanAfter).toBeLessThan(meanBefore / 2); // selection share provably drops
  });
});

describe('applyEditPenaltyToArms', () => {
  it('adds exactly 0.5 to beta (half-weight negative), alpha unchanged', async () => {
    const { client, writes } = fakeClient({
      hook_examples: [{ id: 'h1', niche_id: 'n1' }],
      hook_arms: [{ niche_id: 'n1', hook_id: 'h1', alpha: 2, beta: 3, pulls: 5 }],
    });
    const n = await applyEditPenaltyToArms(client, ['h1']);
    expect(n).toBe(1);
    const w = writes.find((x) => x.table === 'hook_arms' && x.op === 'update')!;
    expect(w.values.alpha).toBe(2);
    expect(w.values.beta).toBe(3.5);
  });
});
