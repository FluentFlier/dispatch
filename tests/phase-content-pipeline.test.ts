/**
 * Phase: 4-stage content pipeline + multi-pass humanizer
 */
import { describe, it, expect } from 'vitest';
import { deterministicPreClean, AI_SLOP_PATTERNS } from '@/lib/humanizer';
import { substanceContextOnly } from '@/lib/content-pipeline/context-split';
import { stripMarkdownFormatting } from '@/lib/content-pipeline';
import { selectBalancedVoiceSamples } from '@/lib/voice-lab/select-voice-samples';

describe('Phase: Content pipeline + humanizer', () => {
  describe('deterministicPreClean', () => {
    it('should replace common AI vocabulary and em dashes', () => {
      const raw = 'We must leverage this robust landscape — it is worth noting that teams utilize it.';
      const cleaned = deterministicPreClean(raw);
      expect(cleaned.toLowerCase()).not.toContain('leverage');
      expect(cleaned).not.toContain('—');
    });
  });

  describe('substanceContextOnly', () => {
    it('should keep facts/brain but strip voice examples', () => {
      const full = [
        'BACKGROUND FACTS (use specific details, never genericize):\nBuilt 3 startups',
        'VOICE EXAMPLES (match rhythm):\nExample 1: hello world',
        'EMAIL VOICE (how they write 1:1):\nEmail 1: hey team',
      ].join('\n\n');

      const substance = substanceContextOnly(full);
      expect(substance).toContain('BACKGROUND FACTS');
      expect(substance).not.toContain('VOICE EXAMPLES');
      expect(substance).not.toContain('EMAIL VOICE');
    });
  });

  describe('AI_SLOP_PATTERNS', () => {
    it('should match obvious AI throat-clearing', () => {
      const text = "In today's fast-paced world, let's dive into this landscape.";
      const hits = AI_SLOP_PATTERNS.some((re) => re.test(text));
      expect(hits).toBe(true);
    });
  });

  describe('stripMarkdownFormatting', () => {
    it('removes emphasis, headings, and code fences but keeps the words', () => {
      const raw = [
        '## My Big Launch',
        '',
        'We shipped **fast** and it was *hard* but `worth it`.',
        '',
        '> a quote line',
        '',
        '```js',
        'const x = 1;',
        '```',
      ].join('\n');
      const out = stripMarkdownFormatting(raw);
      expect(out).not.toMatch(/\*\*|##|```|`|^>/m);
      expect(out).toContain('My Big Launch');
      expect(out).toContain('We shipped fast and it was hard but worth it.');
      expect(out).toContain('a quote line');
      expect(out).toContain('const x = 1;');
    });

    it('leaves snake_case, list dashes, and plain text untouched', () => {
      const raw = 'Set the max_tokens value.\n- point one\n- point two';
      expect(stripMarkdownFormatting(raw)).toBe(raw);
    });
  });

  describe('selectBalancedVoiceSamples', () => {
    it('should balance posts and emails', () => {
      const samples = [
        ...Array.from({ length: 10 }, (_, i) => ({ content: 'p'.repeat(50 + i), platform: 'LinkedIn' })),
        ...Array.from({ length: 5 }, (_, i) => ({ content: 'e'.repeat(40 + i), platform: 'Email' })),
      ];
      const picked = selectBalancedVoiceSamples(samples, 12);
      const emails = picked.filter((s) => s.platform === 'Email').length;
      expect(emails).toBeGreaterThanOrEqual(2);
    });
  });
});
