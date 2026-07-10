/**
 * The parsed fingerprint/structural objects must ride alongside the flattened
 * context string all the way into the pipeline, so humanize passes (and the
 * hook logic) can use them without re-parsing prompt text.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supermemory', () => ({ searchUserContext: vi.fn().mockResolvedValue([]) }));
vi.mock('@/lib/brain/retrieve', () => ({ retrieveBrainContext: vi.fn().mockResolvedValue([]) }));

import { loadCreatorVoiceContext } from '@/lib/voice-context';

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
  return { database: { from: (t: string) => makeBuilder(perTable[t] ?? { data: null }) } } as never;
}

describe('loadCreatorVoiceContext returns parsed voice objects', () => {
  it('exposes vocabulary and structural alongside contextAdditions', async () => {
    const client = makeClient({
      creator_profile: { data: { display_name: 'Ani', content_pillars: '[]' } },
      user_settings: { data: [
        { key: 'vocabulary_fingerprint', value: JSON.stringify({ uses_often: ['shipped'] }) },
        { key: 'structural_patterns', value: JSON.stringify({ hook_pattern: 'Opens with a hot take' }) },
      ] },
    });
    const ctx = await loadCreatorVoiceContext(client, 'user-1');
    expect(ctx.vocabulary?.uses_often).toEqual(['shipped']);
    expect(ctx.structural?.hook_pattern).toBe('Opens with a hot take');
  });
});
