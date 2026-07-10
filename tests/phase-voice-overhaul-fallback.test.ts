import { describe, it, expect, vi } from 'vitest';

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

describe('fallback voice honesty', () => {
  it('an empty-array fingerprint (the fallback persona) counts as ABSENT -> starved', async () => {
    const client = makeClient({
      creator_profile: { data: { display_name: 'Ani', content_pillars: '[]' } },
      user_settings: { data: [
        { key: 'vocabulary_fingerprint', value: JSON.stringify({ uses_often: [], never_uses: ['synergy'], signature_phrases: [] }) },
        { key: 'voice_source', value: 'fallback' },
      ] },
    });
    const { completeness } = await loadCreatorVoiceContext(client, 'user-1');
    expect(completeness.fingerprint).toBe(false);
    expect(completeness.starved).toBe(true);
    expect(completeness.voiceSource).toBe('fallback');
  });

  it('a real fingerprint still counts', async () => {
    const client = makeClient({
      creator_profile: { data: { display_name: 'Ani', content_pillars: '[]' } },
      user_settings: { data: [
        { key: 'vocabulary_fingerprint', value: JSON.stringify({ uses_often: ['shipped'] }) },
        { key: 'voice_source', value: 'imported' },
      ] },
    });
    const { completeness } = await loadCreatorVoiceContext(client, 'user-1');
    expect(completeness.fingerprint).toBe(true);
    expect(completeness.starved).toBe(false);
    expect(completeness.voiceSource).toBe('imported');
  });
});
