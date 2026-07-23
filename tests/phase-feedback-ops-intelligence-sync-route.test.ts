/**
 * Phase: Feedback Ops - GET /api/cron/intelligence-sync wiring (Task 2).
 * Proves the 3 binding caller contracts flagged Critical in the Task 1 review:
 *   1. ORDERING: trailing median is fetched BEFORE the post is marked processed.
 *   2. THRESHOLD: reward uses strict > (a post exactly at its own median → 0).
 *   3. NOISE FLOOR: a <100-view post never triggers an arm mutation (and is not
 *      counted as a failure) even if it somehow reaches the loop.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { callLog, posts, getTrailingMedianEngagement, updateArmsForHooks, updateFromPerformanceDB } = vi.hoisted(() => ({
  callLog: [] as string[],
  posts: [] as Array<Record<string, unknown>>,
  getTrailingMedianEngagement: vi.fn(),
  updateArmsForHooks: vi.fn().mockResolvedValue({ updated: 1, skipped: 0 }),
  updateFromPerformanceDB: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/insforge/server', () => ({
  getServiceClient: () => ({
    database: {
      from: (table: string) => {
        if (table === 'posts') {
          // Order-agnostic query builder: the route composes is/not/gte/eq in
          // whatever order onlyPublished() dictates, so every filter returns
          // the same self and only limit() resolves.
          const builder: Record<string, unknown> = {};
          builder.select = () => builder;
          builder.is = () => builder;
          builder.not = () => builder;
          builder.gte = () => builder;
          builder.eq = () => builder;
          builder.order = () => builder;
          builder.limit = () => Promise.resolve({ data: posts, error: null });
          return {
            ...builder,
            update: () => ({
              eq: (_col: string, id: string) => {
                callLog.push(`marked:${id}`);
                return Promise.resolve({ data: null, error: null });
              },
            }),
          };
        }
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) };
      },
    },
  }),
}));

vi.mock('@/lib/feature-flags', () => ({ isEnabled: () => Promise.resolve(true) }));
vi.mock('@/lib/hooks-intelligence/rl-trainer', () => ({
  updateFromPerformanceDB: (...args: unknown[]) => {
    callLog.push(`ema:${args[1]}`);
    return updateFromPerformanceDB(...args);
  },
  extractWinningPatterns: () => [],
}));
vi.mock('@/lib/engagement/categorize-leads', () => ({
  countLeadsForPost: vi.fn().mockResolvedValue(0),
  pillarToVertical: (p: string) => p,
}));
vi.mock('@/lib/analytics', () => ({ trackEvent: vi.fn() }));
vi.mock('@/lib/hooks-intelligence/rewards', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks-intelligence/rewards')>();
  return {
    ...actual,
    getTrailingMedianEngagement: (...args: Parameters<typeof getTrailingMedianEngagement>) => {
      callLog.push('median-fetched');
      return getTrailingMedianEngagement(...args);
    },
    updateArmsForHooks,
  };
});

function makeRequest() {
  return new NextRequest('http://localhost/api/cron/intelligence-sync', {
    headers: { authorization: 'Bearer test-secret' },
  });
}

describe('GET /api/cron/intelligence-sync - arm reward wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callLog.length = 0;
    posts.length = 0;
    vi.stubEnv('CRON_SECRET', 'test-secret');
    getTrailingMedianEngagement.mockResolvedValue(0.05);
    updateArmsForHooks.mockResolvedValue({ updated: 1, skipped: 0 });
  });

  it('CONTRACT 1 (ordering): fetches the trailing median before marking rl_processed_at', async () => {
    posts.push({ id: 'p1', user_id: 'u1', pillar: 'saas', saves: 5, views: 200, likes: 5, comments: 0, used_hook_ids: ['h1'] });
    const { GET } = await import('@/app/api/cron/intelligence-sync/route');
    await GET(makeRequest());

    expect(callLog).toEqual(['median-fetched', 'ema:h1', 'marked:p1']);
  });

  it('CONTRACT 2 (threshold): a post exactly at its own median gets reward 0 (strict >, not >=)', async () => {
    // engagementRate = (5+0+0)/200 = 0.025, set the median to the same value.
    getTrailingMedianEngagement.mockResolvedValue(0.025);
    posts.push({ id: 'p2', user_id: 'u1', pillar: 'saas', saves: 5, views: 200, likes: 0, comments: 0, used_hook_ids: ['h1'] });
    const { GET } = await import('@/app/api/cron/intelligence-sync/route');
    await GET(makeRequest());

    expect(updateArmsForHooks).toHaveBeenCalledWith(expect.anything(), ['h1'], 0);
  });

  it('CONTRACT 2b: a post that beats its own median gets reward 1', async () => {
    getTrailingMedianEngagement.mockResolvedValue(0.01);
    posts.push({ id: 'p3', user_id: 'u1', pillar: 'saas', saves: 5, views: 200, likes: 0, comments: 0, used_hook_ids: ['h1'] });
    const { GET } = await import('@/app/api/cron/intelligence-sync/route');
    await GET(makeRequest());

    expect(updateArmsForHooks).toHaveBeenCalledWith(expect.anything(), ['h1'], 1);
  });

  it('CONTRACT 3 (noise floor): a <100-view post never mutates arms, and is not scored a failure', async () => {
    posts.push({ id: 'p4', user_id: 'u1', pillar: 'saas', saves: 5, views: 50, likes: 0, comments: 0, used_hook_ids: ['h1'] });
    const { GET } = await import('@/app/api/cron/intelligence-sync/route');
    const res = await GET(makeRequest());
    const json = await res.json();

    expect(updateArmsForHooks).not.toHaveBeenCalled();
    expect(getTrailingMedianEngagement).not.toHaveBeenCalled();
    // Post is still processed (EMA + marked); noise floor only excludes arms.
    expect(json.processed).toBe(1);
    expect(json.armsUpdated).toBe(0);
    expect(json.armsSkipped).toBe(0);
    expect(callLog).toEqual(['ema:h1', 'marked:p4']);
  });

  it('CONTRACT 4 (failure isolation): a rejecting median fetch skips arms for that post only, never aborts the run', async () => {
    // First post's median fetch throws (DB blip / RLS). Second post is fine.
    // The failing post must still run EMA + get marked processed (so it is not
    // retried forever), be counted armsSkipped, and NOT 500 the whole run.
    getTrailingMedianEngagement
      .mockRejectedValueOnce(new Error('db blip'))
      .mockResolvedValueOnce(0.01);
    posts.push(
      { id: 'bad', user_id: 'u1', pillar: 'saas', saves: 5, views: 200, likes: 0, comments: 0, used_hook_ids: ['h1'] },
      { id: 'ok', user_id: 'u2', pillar: 'saas', saves: 5, views: 200, likes: 0, comments: 0, used_hook_ids: ['h2'] },
    );
    const { GET } = await import('@/app/api/cron/intelligence-sync/route');
    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);          // run did NOT abort
    expect(json.processed).toBe(2);        // both posts processed
    expect(json.armsSkipped).toBe(1);      // failing post's one hook counted skipped
    expect(json.armsUpdated).toBe(1);      // healthy post's arm still updated
    // Failing post still ran EMA and was marked processed (not retried forever).
    expect(callLog).toContain('marked:bad');
    expect(callLog.filter((e) => e.startsWith('ema:'))).toHaveLength(2);
    // Healthy post's arm update happened.
    expect(updateArmsForHooks).toHaveBeenCalledWith(expect.anything(), ['h2'], 1);
  });
});
