/**
 * Voice-context wiring guarantees (docs/PIPELINE_WIRING_AUDIT.md).
 *   - break 2  : loadCreatorVoiceContext returns a ContextCompleteness signal and
 *                flags `starved` when fingerprint + voice examples are both absent
 *   - break 7  : Supermemory retrieval is called WITH workspaceId so the read tag
 *                (workspace_${ws}) matches the write tag
 *   - break 24 : the L4 quality baseline is emitted with the stable
 *                "PERFORMANCE BASELINE:" prefix (so it can reach the substance stage)
 *   - L3       : unused story-bank angles are injected when present
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const searchUserContext = vi.fn().mockResolvedValue([]);
vi.mock('@/lib/supermemory', () => ({
  searchUserContext: (...args: unknown[]) => searchUserContext(...args),
}));
const retrieveBrainContext = vi.fn().mockResolvedValue([]);
vi.mock('@/lib/brain/retrieve', () => ({
  retrieveBrainContext: (...args: unknown[]) => retrieveBrainContext(...args),
}));

import { loadCreatorVoiceContext } from '@/lib/voice-context';

// Minimal chainable InsForge query-builder mock: every filter returns `this`; the
// object is awaitable (thenable) for `await query`, and maybeSingle()/limit()
// resolve to the same per-table result.
function makeBuilder(result: unknown) {
  const b: Record<string, unknown> = {};
  const chain = () => b;
  Object.assign(b, {
    select: chain, eq: chain, in: chain, not: chain, order: chain,
    limit: () => Promise.resolve(result),
    maybeSingle: () => Promise.resolve(result),
    then: (res: (v: unknown) => unknown) => Promise.resolve(result).then(res),
  });
  return b;
}

function makeClient(perTable: Record<string, unknown>) {
  return {
    database: {
      from: (table: string) => makeBuilder(perTable[table] ?? { data: null }),
    },
  } as never;
}

const PROFILE_ROW = {
  display_name: 'Ani', bio: 'founder', bio_facts: 'built Ada',
  content_pillars: '[]', voice_description: 'punchy', voice_rules: 'no em dashes',
};

beforeEach(() => {
  searchUserContext.mockClear().mockResolvedValue([]);
  retrieveBrainContext.mockClear().mockResolvedValue([]);
});

describe('loadCreatorVoiceContext wiring', () => {
  it('break 2: flags `starved` when fingerprint + voice examples are absent', async () => {
    const client = makeClient({
      creator_profile: { data: PROFILE_ROW },
      user_settings: { data: [] }, // no vocabulary_fingerprint, no sample_posts
    });
    const { completeness } = await loadCreatorVoiceContext(client, 'user-1');
    expect(completeness.profile).toBe(true);
    expect(completeness.fingerprint).toBe(false);
    expect(completeness.voiceExamples).toBe(false);
    expect(completeness.starved).toBe(true);
  });

  it('break 2: not starved once a fingerprint is present', async () => {
    const client = makeClient({
      creator_profile: { data: PROFILE_ROW },
      user_settings: { data: [
        { key: 'vocabulary_fingerprint', value: JSON.stringify({ uses_often: ['shipped'] }) },
      ] },
    });
    const { completeness } = await loadCreatorVoiceContext(client, 'user-1');
    expect(completeness.fingerprint).toBe(true);
    expect(completeness.starved).toBe(false);
  });

  it('break 7: Supermemory retrieval is scoped by workspaceId', async () => {
    searchUserContext.mockResolvedValue([{ content: 'a memory' }]);
    vi.stubEnv('SUPERMEMORY_API_KEY', 'test-key');
    const client = makeClient({
      creator_profile: { data: PROFILE_ROW },
      user_settings: { data: [] },
    });

    await loadCreatorVoiceContext(client, 'user-1', {
      workspaceId: 'ws-42',
      memoryQuery: 'launch recap',
    });

    expect(searchUserContext).toHaveBeenCalledWith('user-1', 'launch recap', 3, 'ws-42');
    vi.unstubAllEnvs();
  });

  it('break 24 + L3: emits PERFORMANCE BASELINE prefix and story-bank angles', async () => {
    const client = makeClient({
      creator_profile: { data: PROFILE_ROW },
      user_settings: { data: [] },
      story_bank: { data: [{ mined_angle: 'the messy-launch angle', pillar: 'build' }] },
      workspace_voice_metrics: { data: { avg_voice_match_score: 82, avg_ai_score: 15, post_count: 5 } },
    });

    const { contextAdditions } = await loadCreatorVoiceContext(client, 'user-1', {
      workspaceId: 'ws-42',
      platform: 'linkedin',
    });

    expect(contextAdditions).toContain('PERFORMANCE BASELINE:'); // stable prefix (break 24)
    expect(contextAdditions).toContain('82/100 voice match');
    expect(contextAdditions).toContain('UNUSED STORY BANK ANGLES');
    expect(contextAdditions).toContain('the messy-launch angle');
  });
});
