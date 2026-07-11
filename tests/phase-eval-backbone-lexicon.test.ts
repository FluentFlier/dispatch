/**
 * Phase: Eval Backbone - slop lexicon
 * Single source of truth for AI-slop vocabulary. Phase 3 will point
 * humanizer + compact edit prompts here; Phase 4 reviews hit rates.
 */
import { describe, it, expect } from 'vitest';
import { SLOP_WORDS, SLOP_PHRASES, allSlopRegexes, findSlopMatches } from '@/lib/content-pipeline/slop-lexicon';

describe('Phase: Eval Backbone - slop lexicon', () => {
  it('has a substantial merged lexicon (words + phrases >= 80 entries)', () => {
    expect(SLOP_WORDS.length + SLOP_PHRASES.length).toBeGreaterThanOrEqual(80);
  });

  it('every entry has pattern, source, addedAt', () => {
    for (const e of [...SLOP_WORDS, ...SLOP_PHRASES]) {
      expect(e.pattern.length).toBeGreaterThan(1);
      expect(['humanizer', 'compact-edit', 'community-2026']).toContain(e.source);
      expect(e.addedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('no duplicate patterns (case-insensitive)', () => {
    const all = [...SLOP_WORDS, ...SLOP_PHRASES].map((e) => e.pattern.toLowerCase());
    expect(new Set(all).size).toBe(all.length);
  });

  it('all patterns compile to valid regexes', () => {
    expect(() => allSlopRegexes()).not.toThrow();
    expect(allSlopRegexes().length).toBe(SLOP_WORDS.length + SLOP_PHRASES.length);
  });

  it('findSlopMatches catches known tells and ignores clean prose', () => {
    expect(findSlopMatches("Let's delve into this tapestry of ideas.").length).toBeGreaterThanOrEqual(2);
    expect(findSlopMatches('I shipped the fix on Tuesday. Two users emailed thanks.')).toEqual([]);
  });

  it('word entries match whole words only (no substring hits)', () => {
    // "delved" contains "delve" but "underdeliver" must not match "deliver"-adjacent slop
    expect(findSlopMatches('The foster parents visited.').length).toBeGreaterThan(0); // 'foster' is a word entry
    // Brief typo fix: with \b...\b whole-word matching (verbatim toRegex), "fostered"
    // and "Fosterville" are NOT whole-word "foster" - this must be false, matching
    // this test's own title/comment above. See task-1-report.md for details.
    expect(findSlopMatches('He fostered goodwill at Fosterville.').some((m) => m === 'foster')).toBe(false);
    expect(findSlopMatches('costermonger')).toEqual([]);
  });
});
