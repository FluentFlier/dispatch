import { describe, it, expect } from 'vitest';
import { CURATED_PILLARS, getTrendingPillars, pillarSlug } from '@/lib/pillar-catalog';

/**
 * Phase A: flexible pillars — curated catalog + data-driven trending suggestions
 * users can add on top of their voice pillars (without being locked in).
 */
describe('pillar catalog', () => {
  it('slugifies names consistently', () => {
    expect(pillarSlug('Hot Take')).toBe('hot-take');
    expect(pillarSlug('  Build  in   Public ')).toBe('build-in-public');
  });

  it('exposes a non-empty curated catalog tagged suggested', () => {
    expect(CURATED_PILLARS.length).toBeGreaterThan(10);
    for (const p of CURATED_PILLARS) {
      expect(p.tag).toBe('suggested');
      expect(p.slug).toBe(pillarSlug(p.name));
      expect(p.description.length).toBeGreaterThan(0);
    }
    // Hot Take is now a normal catalog option (dissolves the stale-default bug).
    expect(CURATED_PILLARS.some((p) => p.slug === 'hot-take')).toBe(true);
  });

  it('returns trending pillars derived from the hook dataset', () => {
    const trending = getTrendingPillars(6);
    expect(trending.length).toBeGreaterThan(0);
    expect(trending.length).toBeLessThanOrEqual(6);
    for (const p of trending) {
      expect(p.tag).toBe('trending');
      expect(p.name.length).toBeGreaterThan(0);
    }
    // No duplicate slugs in the trending list.
    const slugs = trending.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
