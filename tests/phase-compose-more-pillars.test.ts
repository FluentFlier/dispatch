/**
 * Phase: Compose — more pillar options
 *
 * The Compose pillar picker now surfaces the shared suggestion catalog so users
 * can write from more than their saved profile pillars. These guard the catalog
 * that feeds it (rich set, unique slugs, correct slugging).
 */
import { describe, it, expect } from 'vitest';
import { CURATED_PILLARS, pillarSlug } from '@/lib/pillar-catalog';

describe('Phase: Compose — more pillar options', () => {
  it('offers a rich curated catalog (well beyond the default 3)', () => {
    expect(CURATED_PILLARS.length).toBeGreaterThanOrEqual(20);
  });

  it('every curated pillar has a slug, name, description, and suggested tag', () => {
    for (const p of CURATED_PILLARS) {
      expect(p.slug.length).toBeGreaterThan(0);
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
      expect(p.tag).toBe('suggested');
    }
  });

  it('catalog slugs are unique (no duplicate pills in the picker)', () => {
    const slugs = CURATED_PILLARS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('pillarSlug kebab-cases names consistently', () => {
    expect(pillarSlug('Build in Public')).toBe('build-in-public');
    expect(pillarSlug('  AI & Automation ')).toBe('ai-&-automation');
    expect(pillarSlug('Hot Take')).toBe('hot-take');
  });
});
