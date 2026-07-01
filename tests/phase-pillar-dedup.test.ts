/**
 * Phase: Pillar de-duplication
 *
 * Suggestions the user already has (including aliases like AI vs Artificial
 * Intelligence) must be hidden so the pillar picker doesn't bloat with dupes.
 */
import { describe, it, expect } from 'vitest';
import { canonicalPillarName, isPillarCovered } from '@/lib/pillar-dedup';

describe('Phase: Pillar de-duplication', () => {
  describe('canonicalPillarName', () => {
    it('resolves the AI <-> Artificial Intelligence alias', () => {
      expect(canonicalPillarName('AI')).toBe('artificial intelligence');
      expect(canonicalPillarName('Artificial Intelligence')).toBe('artificial intelligence');
    });
    it('normalizes punctuation, ampersands, and case', () => {
      expect(canonicalPillarName('Tools & Stack')).toBe('tools and stack');
      expect(canonicalPillarName('  Hot   Take!! ')).toBe('hot take');
    });
  });

  describe('isPillarCovered', () => {
    it('hides AI when the user already has Artificial Intelligence', () => {
      expect(isPillarCovered(['Artificial Intelligence', 'Founder Journey'], 'AI')).toBe(true);
    });
    it('keeps genuinely different suggestions', () => {
      expect(isPillarCovered(['Artificial Intelligence'], 'Hot Take')).toBe(false);
      expect(isPillarCovered(['Founder Journey'], 'Career Growth')).toBe(false);
    });
    it('matches exact names regardless of case/spacing', () => {
      expect(isPillarCovered(['hot take'], 'Hot Take')).toBe(true);
    });
  });
});
