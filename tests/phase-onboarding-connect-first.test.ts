/**
 * Phase: Connect-first onboarding (Stanley-beating funnel)
 */
import { describe, it, expect } from 'vitest';
import { buildCreatorBaseline } from '@/lib/onboarding/baseline';
import { selectSamplesForAnalysis } from '@/lib/onboarding/import-posts';

describe('Phase: Connect-first onboarding', () => {
  describe('buildCreatorBaseline', () => {
    it('should produce themes, pillars, and suggested topic from analysis', () => {
      const baseline = buildCreatorBaseline(
        {
          analysis: {
            tone: 'Professional and direct',
            opening_patterns: 'Starts with a bold claim',
            signature_phrases: ['ship fast', 'build in public'],
            content_structure: 'Short punchy paragraphs',
          },
          voice_summary: 'Writes like a builder who shares practical lessons.',
          voice_rules: ['DO: use short sentences', 'NEVER: use corporate jargon'],
        },
        {
          postsAnalyzed: 42,
          platforms: ['LinkedIn', 'X'],
          displayName: 'Alex Creator',
        },
      );

      expect(baseline.displayName).toBe('Alex Creator');
      expect(baseline.postsAnalyzed).toBe(42);
      expect(baseline.platforms).toEqual(['LinkedIn', 'X']);
      expect(baseline.voiceSummary).toContain('builder');
      expect(baseline.voiceRules.length).toBeGreaterThan(0);
      expect(baseline.themes.length).toBeGreaterThan(0);
      expect(baseline.pillars.length).toBeGreaterThan(0);
      expect(baseline.suggestedTopic.length).toBeGreaterThan(10);
    });
  });

  describe('selectSamplesForAnalysis', () => {
    it('should prefer longer posts and cap at 20', () => {
      const samples = Array.from({ length: 30 }, (_, i) => ({
        content: 'x'.repeat(i + 10),
        platform: 'LinkedIn',
      }));

      const selected = selectSamplesForAnalysis(samples, 20);
      expect(selected).toHaveLength(20);
      expect(selected[0].content.length).toBeGreaterThanOrEqual(selected[19].content.length);
    });
  });
});
