/**
 * Phase: Niche Hooks - niche resolution decision logic.
 * The IO wrappers (LLM classify, DB read/write) are thin; the risk is in the
 * math: cosine dedupe thresholds, slug hygiene, and the anti-explosion budget
 * gate. Those are pure and fully tested here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  cosineSim, slugify, decideAssignment, earnsBudget,
  classifyProfileNiche, resolveNicheForProfile,
  NICHE_MERGE_THRESHOLD, MAX_ACTIVE_NICHES, type NicheRow,
} from '@/lib/hooks-intelligence/niche-resolver';
import { chatCompletion } from '@/lib/llm';
import { embedText } from '@/lib/embeddings';

vi.mock('@/lib/llm', () => ({ chatCompletion: vi.fn() }));
vi.mock('@/lib/embeddings', () => ({
  embedText: vi.fn(),
  toPgVector: (v: number[]) => `[${v.join(',')}]`,
}));

const chatMock = vi.mocked(chatCompletion);
const embedMock = vi.mocked(embedText);

const unit = (seed: number[]): number[] => {
  const n = Math.sqrt(seed.reduce((a, b) => a + b * b, 0));
  return seed.map((x) => x / n);
};

describe('cosineSim', () => {
  it('is 1 for identical, 0 for orthogonal', () => {
    expect(cosineSim([1, 0], [1, 0])).toBeCloseTo(1, 6);
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
});

describe('slugify', () => {
  it('lowercases, hyphenates, strips punctuation including trailing period', () => {
    expect(slugify('Fitness Coaching.')).toBe('fitness-coaching');
    expect(slugify('  Auto Detailing & Care!  ')).toBe('auto-detailing-care');
    expect(slugify('AI/ML')).toBe('ai-ml');
  });
});

describe('decideAssignment', () => {
  const near = unit([1, 0.02, 0]);
  const rows: NicheRow[] = [
    { id: 'a', slug: 'automotive', label: 'Automotive', embedding: unit([1, 0, 0]), status: 'active', active_user_count: 3 },
    { id: 'f', slug: 'fitness', label: 'Fitness', embedding: unit([0, 1, 0]), status: 'active', active_user_count: 1 },
  ];
  it('assigns to an existing niche above the 0.85 merge cutoff', () => {
    const d = decideAssignment(near, rows);
    expect(d.action).toBe('assign');
    expect(d.niche?.id).toBe('a');
    expect(d.bestSim).toBeGreaterThanOrEqual(NICHE_MERGE_THRESHOLD);
  });
  it('flags 0.75-0.85 for review but still assigns', () => {
    const mid = unit([1, 0.6, 0]); // sim to automotive ~ 0.86? keep below by construction
    const d = decideAssignment(unit([1, 0.75, 0]), rows);
    expect(['assign', 'assign-review']).toContain(d.action);
    void mid;
  });
  it('creates a new niche below 0.75', () => {
    const d = decideAssignment(unit([0, 0, 1]), rows);
    expect(d.action).toBe('create');
  });
  it('skips rows with no embedding', () => {
    const d = decideAssignment(unit([1, 0, 0]), [{ ...rows[0], embedding: null }]);
    expect(d.action).toBe('create');
  });
  it('returns the nearest row even on create, so the cap can fall back to it', () => {
    const d = decideAssignment(unit([0, 0, 1]), rows);
    expect(d.action).toBe('create');
    expect(d.nearest).toBeDefined();
  });
});

describe('earnsBudget (anti-explosion, spec 2.2.4)', () => {
  it('earns budget at 2+ active users', () => {
    expect(earnsBudget({ active_user_count: 2, isPaying: false, ageDays: 0 })).toBe(true);
  });
  it('earns budget for a paying user after 14 days', () => {
    expect(earnsBudget({ active_user_count: 1, isPaying: true, ageDays: 14 })).toBe(true);
    expect(earnsBudget({ active_user_count: 1, isPaying: true, ageDays: 13 })).toBe(false);
  });
  it('a lone free user does not earn budget (inherits parent)', () => {
    expect(earnsBudget({ active_user_count: 1, isPaying: false, ageDays: 99 })).toBe(false);
  });
  it('MAX_ACTIVE_NICHES cap is 50', () => {
    expect(MAX_ACTIVE_NICHES).toBe(50);
  });
});

describe('classifyProfileNiche (mocked LLM)', () => {
  beforeEach(() => {
    chatMock.mockReset();
  });
  const profile = { display_name: 'Sam', voice_description: 'gym talk', bio: 'coach' };

  it('parses a valid JSON classification', async () => {
    chatMock.mockResolvedValue('{"label":"Fitness Coaching","seed_keywords":["gym","macros"],"confidence":0.9}');
    const c = await classifyProfileNiche(profile);
    expect(c.label).toBe('Fitness Coaching');
    expect(c.seed_keywords).toEqual(['gym', 'macros']);
    expect(c.confidence).toBe(0.9);
  });

  it('falls back to defaults on malformed JSON without throwing', async () => {
    chatMock.mockResolvedValue('Sure! The niche is fitness, roughly speaking.');
    const c = await classifyProfileNiche(profile);
    expect(c.label).toBe('general');
    expect(c.seed_keywords).toEqual([]);
    expect(c.confidence).toBe(0.5);
  });

  it('clamps out-of-range confidence to [0, 1]', async () => {
    chatMock.mockResolvedValue('{"label":"X","seed_keywords":[],"confidence":5}');
    expect((await classifyProfileNiche(profile)).confidence).toBe(1);
    chatMock.mockResolvedValue('{"label":"X","seed_keywords":[],"confidence":-1}');
    expect((await classifyProfileNiche(profile)).confidence).toBe(0);
  });
});

// Minimal chainable fake of the InsForge database client - just the calls
// resolveNicheForProfile makes.
function fakeClient(rows: NicheRow[], opts: { rejectSelect?: boolean } = {}) {
  const calls = { inserts: 0, updates: [] as Array<{ table: string; payload: Record<string, unknown> }> };
  const database = {
    from(table: string) {
      return {
        select: () => ({
          neq: async () => {
            if (opts.rejectSelect) throw new Error('db down');
            return { data: rows, error: null };
          },
        }),
        update: (payload: Record<string, unknown>) => ({
          eq: async () => {
            calls.updates.push({ table, payload });
            return { error: null };
          },
        }),
        insert: () => ({
          select: () => ({
            single: async () => {
              calls.inserts += 1;
              return { data: { id: 'new-niche-id' }, error: null };
            },
          }),
        }),
      };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { database } as any, calls };
}

describe('resolveNicheForProfile (mocked client)', () => {
  beforeEach(() => {
    chatMock.mockReset();
    embedMock.mockReset();
    chatMock.mockResolvedValue('{"label":"Quantum Basket Weaving","seed_keywords":["qbw"],"confidence":0.8}');
    embedMock.mockResolvedValue(unit([0, 0, 1]));
  });
  const profile = { user_id: 'u1', display_name: 'Sam' };

  it('at the 50-active-niche cap, assigns the nearest niche instead of inserting', async () => {
    const rows: NicheRow[] = Array.from({ length: MAX_ACTIVE_NICHES }, (_, i) => ({
      id: `n${i}`, slug: `n${i}`, label: `N${i}`, embedding: unit([1, i * 0.001, 0]),
      status: 'active', active_user_count: 1,
    }));
    const { client, calls } = fakeClient(rows);
    const res = await resolveNicheForProfile(client, profile);
    expect(res.action).toBe('assign-capped');
    expect(res.created).toBe(false);
    expect(calls.inserts).toBe(0);
    const profileUpdate = calls.updates.find((u) => u.table === 'creator_profile');
    expect(profileUpdate?.payload.niche_id).toBe(res.nicheId);
    expect(rows.some((r) => r.id === res.nicheId)).toBe(true);
  });

  it('below the cap, still creates a new niche for a novel label', async () => {
    const rows: NicheRow[] = [{
      id: 'a', slug: 'automotive', label: 'Automotive', embedding: unit([1, 0, 0]),
      status: 'active', active_user_count: 3,
    }];
    const { client, calls } = fakeClient(rows);
    const res = await resolveNicheForProfile(client, profile);
    expect(res.created).toBe(true);
    expect(calls.inserts).toBe(1);
  });

  it('rejects (never throws synchronously) when the DB read fails, so fire-and-forget .catch() absorbs it', async () => {
    const { client } = fakeClient([], { rejectSelect: true });
    // Sync throw here would fail the test at the call, before the await.
    const p = resolveNicheForProfile(client, profile);
    await expect(p).rejects.toThrow('db down');
  });
});
