import { describe, it, expect } from 'vitest';
import { curateSamplePosts } from '@/lib/voice-lab/select-voice-samples';

const post = (content: string) => ({ content, platform: 'linkedin' });

describe('curateSamplePosts', () => {
  it('dedupes near-identical posts (same first 80 chars)', () => {
    const dup = 'x'.repeat(90) + ' tail A';
    const dup2 = 'x'.repeat(90) + ' tail B';
    const out = curateSamplePosts([post(dup), post(dup2), post('a fresh different post '.repeat(10))], 10);
    expect(out.length).toBe(2);
  });

  it('prefers substantial posts (100-2500 chars) when enough exist', () => {
    const short = post('too short');
    const good = post('b'.repeat(300));
    const good2 = post('c'.repeat(500));
    const good3 = post('d'.repeat(800));
    const out = curateSamplePosts([short, good, good2, good3], 3);
    expect(out.some((s) => s.content === 'too short')).toBe(false);
  });

  it('falls back to whatever exists when few samples', () => {
    const out = curateSamplePosts([post('short one'), post('short two!')], 10);
    expect(out.length).toBe(2);
  });

  it('caps at limit, longest first', () => {
    // Index goes first so each post differs within the first 80 chars - otherwise
    // the near-identical dedup (first 80 chars, see test above) collapses all 20
    // of these into a single entry before the cap/sort logic ever runs.
    const many = Array.from({ length: 20 }, (_, i) => post(`post #${i} ` + 'p'.repeat(120 + i)));
    const out = curateSamplePosts(many, 5);
    expect(out.length).toBe(5);
    expect(out[0].content.length).toBeGreaterThanOrEqual(out[4].content.length);
  });
});
