/**
 * Per-post pillar classification: the post's pillar must come from its own
 * content (existing pillar when it fits, a new emergent one otherwise), and
 * never break a save - budget block / bad output fall back to the first pillar.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ raw: '', budget: 'ok' as 'ok' | 'blocked' }));

vi.mock('@/lib/llm', () => ({
  chatCompletion: vi.fn(async () => h.raw),
}));
vi.mock('@/lib/ai-budget', () => ({
  checkAndIncrementUsage: vi.fn(async () => h.budget),
}));

import { classifyPostPillar } from '@/lib/pillars/classify';

const client = {} as never;
const existing = [{ name: 'Artificial Intelligence' }, { name: 'Founder' }];

beforeEach(() => {
  h.raw = '';
  h.budget = 'ok';
});

describe('classifyPostPillar', () => {
  it('returns an existing pillar when the model picks one', async () => {
    h.raw = '{"pillar": "Founder", "is_new": false}';
    const r = await classifyPostPillar(client, 'ws', 'raising our seed round', existing);
    expect(r).toEqual({ pillar: 'Founder', isNew: false });
  });

  it('a slug-equal name is treated as existing, not new (dedup)', async () => {
    // Model claims is_new but the name canonicalizes to an existing pillar.
    h.raw = '{"pillar": "artificial-intelligence", "is_new": true}';
    const r = await classifyPostPillar(client, 'ws', 'new LLM benchmark', existing);
    expect(r.isNew).toBe(false);
    expect(r.pillar).toBe('Artificial Intelligence');
  });

  it('proposes a new pillar for an off-topic post', async () => {
    h.raw = '{"pillar": "Marathon Training", "is_new": true}';
    const r = await classifyPostPillar(client, 'ws', 'my 18-week plan', existing);
    expect(r).toEqual({ pillar: 'Marathon Training', isNew: true });
  });

  it('falls back to the first pillar when the budget is blocked', async () => {
    h.budget = 'blocked';
    const r = await classifyPostPillar(client, 'ws', 'anything', existing);
    expect(r).toEqual({ pillar: 'Artificial Intelligence', isNew: false });
  });

  it('falls back on unparseable output', async () => {
    h.raw = 'sorry I cannot help with that';
    const r = await classifyPostPillar(client, 'ws', 'anything', existing);
    expect(r).toEqual({ pillar: 'Artificial Intelligence', isNew: false });
  });

  it("empty content and no pillars yields 'general'", async () => {
    const r = await classifyPostPillar(client, 'ws', '   ', []);
    expect(r).toEqual({ pillar: 'general', isNew: false });
  });
});
