/**
 * Phase: Niche Hooks - mining ingest filter primitives.
 * The 7-stage chain is cheapest-first (spec 2.3). Each primitive is pure and
 * carries punctuation-edge fixtures (Global Constraints: trailing '.' bugs).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  passesStructure, normEngagement, percentileRank, extractOpener, nearDupIndex,
  classifyBatch, mineNiche, type RawPost,
} from '@/lib/hooks-intelligence/mining';
import { chatCompletion } from '@/lib/llm';
import { aiTextLikelihood } from '@/lib/huggingface';
import { embedBatch } from '@/lib/embeddings';

const apifyState = vi.hoisted(() => ({ items: [] as Array<Record<string, unknown>> }));
vi.mock('apify-client', () => ({
  ApifyClient: class {
    actor() { return { call: async () => ({ defaultDatasetId: 'ds' }) }; }
    dataset() { return { listItems: async () => ({ items: apifyState.items }) }; }
  },
}));
vi.mock('@/lib/llm', () => ({ chatCompletion: vi.fn() }));
vi.mock('@/lib/huggingface', () => ({ aiTextLikelihood: vi.fn() }));
vi.mock('@/lib/embeddings', () => ({
  embedBatch: vi.fn(),
  toPgVector: (v: number[]) => `[${v.join(',')}]`,
  parseVec: (e: unknown) => {
    if (Array.isArray(e)) return e;
    if (typeof e === 'string') {
      try { const p = JSON.parse(e); return Array.isArray(p) ? p : null; } catch { return null; }
    }
    return null;
  },
}));

const chatMock = vi.mocked(chatCompletion);
const aiMock = vi.mocked(aiTextLikelihood);
const embedMock = vi.mocked(embedBatch);

describe('passesStructure (filter 1)', () => {
  it('accepts a real post with a first line and sane length', () => {
    expect(passesStructure('I rebuilt our onboarding in a weekend.\n\nHere is what changed and why it worked.')).toBe(true);
  });
  it('rejects too-short and empty', () => {
    expect(passesStructure('hi')).toBe(false);
    expect(passesStructure('   ')).toBe(false);
  });
  it('rejects a 4000-char wall', () => {
    expect(passesStructure('a. '.repeat(1400))).toBe(false);
  });
});

describe('normEngagement (filter 3)', () => {
  it('weights comments 3x and normalizes by followers', () => {
    // ln(1 + 10 + 3*5) - ln(1 + 1000)
    expect(normEngagement(10, 5, 1000)).toBeCloseTo(Math.log(26) - Math.log(1001), 6);
  });
  it('is higher for the same likes with more comments', () => {
    expect(normEngagement(10, 20, 1000)).toBeGreaterThan(normEngagement(10, 0, 1000));
  });
});

describe('percentileRank', () => {
  it('returns 0..1 rank within a batch', () => {
    expect(percentileRank(5, [1, 2, 3, 4, 5])).toBeCloseTo(1, 6);
    expect(percentileRank(1, [1, 2, 3, 4, 5])).toBeCloseTo(0.2, 6);
  });
  it('handles a single-element batch', () => {
    expect(percentileRank(3, [3])).toBe(1);
  });
});

describe('extractOpener (filter 5 helper)', () => {
  it('takes the first line and strips a trailing period', () => {
    expect(extractOpener('I made $12k in a week.\n\nThen it stopped.')).toBe('I made $12k in a week');
  });
  it('strips a trailing ellipsis and quote', () => {
    expect(extractOpener('Nobody tells you this...')).toBe('Nobody tells you this');
    expect(extractOpener('"Just ship it," they said.')).toBe('"Just ship it," they said');
  });
  it('falls back to a sentence when there is no newline', () => {
    expect(extractOpener('One line only, no breaks here. Second sentence.')).toBe('One line only, no breaks here');
  });
});

describe('nearDupIndex (filter 6)', () => {
  const a = [1, 0, 0];
  const b = [0.99, 0.14, 0];
  const c = [0, 1, 0];
  it('finds a near-duplicate above threshold', () => {
    expect(nearDupIndex(a, [c, b], 0.92)).toBe(1);
  });
  it('returns -1 when nothing is close', () => {
    expect(nearDupIndex(a, [c], 0.92)).toBe(-1);
  });
});

// --- mineNiche end-to-end with mocked IO ------------------------------------

// Texts pass structure (>= 30 chars) and the bait_hook regexes; A/B and C/E are
// the near-dup embedding pairs.
const TEXT_A = 'Our churn dropped after we changed onboarding. The full story took three months to play out.';
const TEXT_B = 'Our churn dropped after we changed the onboarding flow. Here is the full three month story.';
const TEXT_C = 'Pricing pages are where SaaS deals quietly die. We rebuilt ours around one annual plan.';
const VEC: Record<string, number[]> = {
  [TEXT_A]: [1, 0, 0],
  [TEXT_B]: [0.999, 0.045, 0], // near-dup of A
  [TEXT_C]: [0, 1, 0],         // near-dup of the existing DB row below
};
const EXISTING_VEC = [0, 0.99, 0.14];

function fakeClient(existingRows: Array<Record<string, unknown>>) {
  const upserts: Record<string, Array<Record<string, unknown>>> = {};
  const database = {
    from(table: string) {
      return {
        select: () => ({ eq: () => ({ not: () => ({ limit: async () => ({ data: existingRows }) }) }) }),
        upsert: async (rows: Array<Record<string, unknown>>) => {
          (upserts[table] ??= []).push(...rows);
          return { error: null };
        },
        update: () => ({ eq: async () => ({ error: null }) }),
      };
    },
  };
  return { client: { database } as unknown as Parameters<typeof mineNiche>[0], upserts };
}

const NICHE = { id: 'n1', label: 'saas', seed_keywords: ['saas'] };

describe('mineNiche near-dup keeps higher engagement (spec 2.3.6)', () => {
  beforeEach(() => {
    process.env.APIFY_TOKEN = 'test-token';
    chatMock.mockReset();
    aiMock.mockReset();
    embedMock.mockReset();
    aiMock.mockResolvedValue({ score: 0.1, detector: 'heuristic' });
    embedMock.mockImplementation(async (texts: string[]) => texts.map((t) => VEC[t]));
  });

  it('later higher-engagement near-dup wins over an earlier batch item AND a weaker existing DB row', async () => {
    // A is first in the batch but weakest; B (its near-dup) has the highest
    // engagement; C near-dups an existing DB row with norm_engagement 0.1.
    apifyState.items = [
      { text: TEXT_A, likes: 5, comments: 0, followers: 1000, authorName: 'a' },
      { text: TEXT_B, likes: 500, comments: 50, followers: 1000, authorName: 'b' },
      { text: TEXT_C, likes: 50, comments: 5, followers: 1000, authorName: 'c' },
    ];
    chatMock.mockResolvedValue(JSON.stringify({
      results: [
        { pattern_class: 'story_open', fit: 10 },
        { pattern_class: 'story_open', fit: 10 },
        { pattern_class: 'number_result', fit: 10 },
      ],
    }));
    const { client, upserts } = fakeClient([
      { id: 'existing-1', embedding: EXISTING_VEC, norm_engagement: 0.1 },
    ]);

    const res = await mineNiche(client, NICHE, {});

    expect(res.accepted).toBe(2);
    expect(res.rejections.nearDup).toBe(1); // A lost to B despite coming first
    const hookRows = upserts['hook_examples'] ?? [];
    const texts = hookRows.map((r) => r.text);
    expect(texts).toContain(TEXT_B);
    expect(texts).not.toContain(TEXT_A);
    // C replaced the weaker existing row in place (same id).
    const replaced = hookRows.find((r) => r.id === 'existing-1');
    expect(replaced?.text).toBe(TEXT_C);
    // Only the genuinely new hook gets a fresh arm; the replacement keeps the
    // existing arm's learned Thompson state.
    const arms = upserts['hook_arms'] ?? [];
    expect(arms).toHaveLength(1);
    expect(arms[0].hook_id).not.toBe('existing-1');
  });

  it('counts classifier-caught bait separately from the filter-2 regex', async () => {
    apifyState.items = [
      { text: TEXT_A, likes: 5, comments: 0, followers: 1000, authorName: 'a' },
      { text: TEXT_C, likes: 50, comments: 5, followers: 1000, authorName: 'c' },
    ];
    chatMock.mockResolvedValue(JSON.stringify({
      results: [
        { pattern_class: 'bait', fit: 10 },
        { pattern_class: 'number_result', fit: 10 },
      ],
    }));
    const { client } = fakeClient([]);

    const res = await mineNiche(client, NICHE, {});

    expect(res.rejections.bait_classifier).toBe(1);
    expect(res.rejections.bait).toBe(0);
    expect(res.accepted).toBe(1);
  });
});

describe('mineNiche parses pgvector string-serialized existing embeddings (B1)', () => {
  beforeEach(() => {
    process.env.APIFY_TOKEN = 'test-token';
    chatMock.mockReset();
    aiMock.mockReset();
    embedMock.mockReset();
    aiMock.mockResolvedValue({ score: 0.1, detector: 'heuristic' });
    embedMock.mockImplementation(async (texts: string[]) => texts.map((t) => VEC[t]));
  });

  it('near-dups against an existing hook_examples row whose embedding came back as a string, not an array', async () => {
    // Live PostgREST shape: embedding is `JSON.stringify(EXISTING_VEC)`, not the
    // array itself. Before the parseVec fix, nearDupIndex's cosineSim call NaNs
    // and never matches, so the mined near-dup is inserted as a brand new row
    // instead of replacing the weaker existing one - DB near-dup dedup never fires.
    apifyState.items = [
      { text: TEXT_C, likes: 50, comments: 5, followers: 1000, authorName: 'c' },
    ];
    chatMock.mockResolvedValue(JSON.stringify({
      results: [{ pattern_class: 'number_result', fit: 10 }],
    }));
    const { client, upserts } = fakeClient([
      { id: 'existing-1', embedding: JSON.stringify(EXISTING_VEC), norm_engagement: 0.05 },
    ]);

    const res = await mineNiche(client, NICHE, {});

    expect(res.accepted).toBe(1);
    const hookRows = upserts['hook_examples'] ?? [];
    const replaced = hookRows.find((r) => r.id === 'existing-1');
    expect(replaced?.text).toBe(TEXT_C);
    // Replacement, not a fresh arm.
    const arms = upserts['hook_arms'] ?? [];
    expect(arms).toHaveLength(0);
  });
});

describe('classifyBatch chunking (one call per <= 50 posts)', () => {
  it('splits 120 posts into 3 calls; a malformed chunk degrades that chunk only', async () => {
    chatMock.mockReset();
    let call = 0;
    chatMock.mockImplementation(async (_system: string, user: string) => {
      call++;
      const n = (JSON.parse(user) as { posts: string[] }).posts.length;
      if (call === 2) return 'sorry, no JSON today';
      return JSON.stringify({ results: Array.from({ length: n }, () => ({ pattern_class: 'how_to', fit: 9 })) });
    });
    const posts: RawPost[] = Array.from({ length: 120 }, (_, i) => ({
      text: `Post number ${i} about growth experiments that actually worked for us.`,
      likes: 1, comments: 1, followers: 1, author: 'x',
    }));

    const out = await classifyBatch(posts, 'growth');

    expect(chatMock).toHaveBeenCalledTimes(3);
    expect(out).toHaveLength(120);
    expect(out[0]).toEqual({ pattern_class: 'how_to', fit: 9 });
    expect(out[60]).toEqual({ pattern_class: 'other', fit: 0 }); // chunk 2 degraded
    expect(out[110]).toEqual({ pattern_class: 'how_to', fit: 9 });
  });
});
