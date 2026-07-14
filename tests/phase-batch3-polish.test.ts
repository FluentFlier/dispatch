import { describe, it, expect } from 'vitest';
import { getBestHooksForContext } from '@/lib/hooks-intelligence';

/**
 * F6: the surfaced hook list must be diverse - not five clones of the
 * "I made $X from a viral thread" template.
 */
describe('F6: hook diversity', () => {
  it('does not flood the list with the viral-thread template', () => {
    const hooks = getBestHooksForContext(undefined, 8);
    expect(hooks.length).toBeGreaterThan(0);

    // Previously all 8 were "exact system" clones; dedup should cut this sharply.
    const templateCount = hooks.filter((h) => /exact system/i.test(h.text)).length;
    expect(templateCount).toBeLessThanOrEqual(2);
  });

  it('returns distinct hook texts (no exact duplicates)', () => {
    const hooks = getBestHooksForContext(undefined, 8);
    const texts = hooks.map((h) => h.text.trim().toLowerCase());
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('returns diverse openings (no two hooks share the same first words)', () => {
    const hooks = getBestHooksForContext(undefined, 8);
    const heads = hooks.map((h) =>
      h.text.toLowerCase().replace(/\$?\d[\d,.]*\w*/g, '#').replace(/[^a-z\s]/g, ' ').trim().split(/\s+/).slice(0, 5).join(' '),
    );
    expect(new Set(heads).size).toBe(heads.length);
  });
});
