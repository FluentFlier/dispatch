import { describe, it, expect } from 'vitest';
import { formatBrainGuidance, getBrainGuidanceForGeneration } from '@/lib/brain/generation-guidance';
import type { ContentLearning } from '@/lib/brain/learnings';

/** Minimal chainable, awaitable query-builder mock resolving to { data }. */
function mockClient(posts: unknown[]) {
  const builder: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit']) builder[m] = () => builder;
  builder.then = (resolve: (v: { data: unknown[] }) => void) => resolve({ data: posts });
  return { database: { from: () => builder } } as never;
}

function learning(over: Partial<ContentLearning> & { id: string }): ContentLearning {
  return {
    kind: 'pillar',
    headline: '',
    detail: '',
    sentiment: 'positive',
    confidence: 'high',
    sampleSize: 5,
    nodeIds: [],
    ...over,
  };
}

describe('formatBrainGuidance', () => {
  it('returns empty when nothing is actionable for a draft', () => {
    expect(formatBrainGuidance([])).toBe('');
    expect(
      formatBrainGuidance([
        learning({ id: 'timing-best-day', kind: 'timing', headline: 'Tuesday posts perform best' }),
        learning({ id: 'voice-reality', kind: 'voice', headline: 'Your voice is landing' }),
        learning({ id: 'platform-best', kind: 'platform', headline: 'LinkedIn is your strongest channel' }),
      ]),
    ).toBe('');
  });

  it('turns pillar + hook learnings into imperative directives, dropping non-draft ones', () => {
    const block = formatBrainGuidance([
      learning({ id: 'pillar-strong', headline: '"Founder lessons" is your strongest pillar' }),
      learning({ id: 'pillar-weak', headline: '"Product" is dragging', sentiment: 'watch' }),
      learning({ id: 'hook-question', kind: 'hook', headline: 'Question hooks pull more views' }),
      learning({ id: 'hook-number', kind: 'hook', headline: 'Hooks with a number outperform' }),
      learning({ id: 'timing-best-day', kind: 'timing', headline: 'Tuesday posts perform best' }),
    ]);
    expect(block).toContain('WHAT WORKS FOR THIS CREATOR');
    expect(block).toContain('"Founder lessons"');
    expect(block).toContain('avoid it unless'); // pillar-weak → "Product"
    expect(block).toContain('"Product"');
    expect(block).toContain('Question-style hooks');
    expect(block).toContain('Numbered / list hooks');
    expect(block).not.toContain('Tuesday'); // timing is not draft-actionable
  });
});

describe('getBrainGuidanceForGeneration (loader → derive → format)', () => {
  const post = (id: string, pillar: string, views: number) => ({
    id,
    pillar,
    platform: 'linkedin',
    hook: null,
    views,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    follows_gained: null,
    voice_match_score: null,
    posted_date: null,
  });

  it('produces a guidance block from a creator\'s posts', async () => {
    const posts = [
      post('a1', 'Founder lessons', 1000),
      post('a2', 'Founder lessons', 1100),
      post('a3', 'Founder lessons', 1050),
      post('b1', 'Product', 100),
      post('b2', 'Product', 110),
      post('b3', 'Product', 120),
    ];
    const block = await getBrainGuidanceForGeneration(mockClient(posts), 'user-1');
    expect(block).toContain('WHAT WORKS FOR THIS CREATOR');
    expect(block).toContain('"Founder lessons"');
  });

  it('returns empty when there is not enough data', async () => {
    const block = await getBrainGuidanceForGeneration(mockClient([]), 'user-1');
    expect(block).toBe('');
  });
});
