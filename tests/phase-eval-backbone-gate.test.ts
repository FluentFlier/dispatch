/**
 * Phase: Eval Backbone - baseline gate math.
 * Gates: overall >= 92% AND no category drops > 5 points vs baseline.
 * Categories come from the description prefix: "core/story/..." -> "core/story".
 */
import { describe, it, expect } from 'vitest';
import { categoryOf, summarize, gate } from '../evals/compare-baseline';

const rows = (spec: Array<[string, boolean]>) => spec.map(([description, success]) => ({ description, success }));

describe('categoryOf', () => {
  it('uses the first two description segments', () => {
    expect(categoryOf('core/story/linkedin/voice/automotive')).toBe('core/story');
    expect(categoryOf('adversarial/fabrication-bait (bug 31f78c0)')).toBe('adversarial/fabrication-bait (bug 31f78c0)'.split('/').slice(0, 2).join('/'));
    expect(categoryOf('holdout/howto/twitter')).toBe('holdout/howto');
  });
  it('buckets colon-suffixed sanity descriptions under a stable category', () => {
    expect(categoryOf('core/sanity: linkedin voice-off basic')).toBe('core/sanity');
    expect(categoryOf('core/sanity: twitter voice-off basic')).toBe('core/sanity');
  });
});

describe('summarize', () => {
  it('computes overall and per-category pass rates', () => {
    const s = summarize(rows([['core/story/a', true], ['core/story/b', false], ['adversarial/x', true]]));
    expect(s.overall).toBeCloseTo(2 / 3, 5);
    expect(s.categories['core/story']).toBeCloseTo(0.5, 5);
  });
});

describe('gate', () => {
  const baseline = { overall: 0.9, categories: { 'core/story': 0.9, 'adversarial/x': 1.0 } };
  it('passes when >= 92% overall and no category drops > 5 points', () => {
    const current = { overall: 0.93, categories: { 'core/story': 0.88, 'adversarial/x': 1.0 } };
    expect(gate(current, baseline).ok).toBe(true);
  });
  it('fails under 92% overall', () => {
    const current = { overall: 0.91, categories: { 'core/story': 0.95, 'adversarial/x': 1.0 } };
    expect(gate(current, baseline).ok).toBe(false);
  });
  it('fails when any category drops more than 5 points even if overall holds', () => {
    const current = { overall: 0.95, categories: { 'core/story': 0.9, 'adversarial/x': 0.9 } };
    const g = gate(current, baseline);
    expect(g.ok).toBe(false);
    expect(g.reasons.join(' ')).toContain('adversarial/x');
  });
  it('treats a category missing from current as a failure (cases must not vanish silently)', () => {
    const current = { overall: 0.95, categories: { 'core/story': 0.95 } };
    expect(gate(current, baseline).ok).toBe(false);
  });
});
