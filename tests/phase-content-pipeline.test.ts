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
    it('feeds facts + voice signal to substance but withholds email voice', () => {
      const full = [
        'BACKGROUND FACTS (use specific details, never genericize):\nBuilt 3 startups',
        'VOCABULARY FINGERPRINT:\nWords/phrases they use often: shipped, honestly',
        'VOICE EXAMPLES (match rhythm):\nExample 1: hello world',
        'EMAIL VOICE (how they write 1:1):\nEmail 1: hey team',
      ].join('\n\n');

      const substance = substanceContextOnly(full);
      // Facts + voice signal reach the Base/Hook stage so the draft sounds like
      // the creator from the first pass, not only after the late Stage 4 rewrite.
      expect(substance).toContain('BACKGROUND FACTS');
      expect(substance).toContain('VOCABULARY FINGERPRINT');
      expect(substance).toContain('VOICE EXAMPLES');
      // Email voice stays out — it is a 1:1 register, not for public posts.
      expect(substance).not.toContain('EMAIL VOICE');
    });

    it('keeps whole multi-paragraph sections (break 27: no blank-line fragmentation)', () => {
      // Real VOICE EXAMPLES / BACKGROUND FACTS bodies contain internal blank
      // lines, so a naive split('\n\n') would drop everything after the first
      // paragraph. The section must survive intact, and later examples too.
      const full = [
        'BACKGROUND FACTS (use specific details, never genericize):\nBuilt Ada.\n\nRaised a seed round.',
        'VOICE EXAMPLES (match rhythm, tone, and structure):\n' +
          'Example 1 (linkedin):\nWe shipped fast.\n\nHonestly it was messy.\n\n' +
          'Example 2 (linkedin):\nHere is the thing about launches.\n\nThey never feel ready.',
        'EMAIL VOICE (how they write 1:1):\nEmail 1:\nhey team\n\nquick update',
      ].join('\n\n');

      const substance = substanceContextOnly(full) ?? '';
      // Later paragraphs of a kept section survive.
      expect(substance).toContain('Raised a seed round.');
      // Both examples and their later paragraphs survive (the core break-27 case).
      expect(substance).toContain('Example 1 (linkedin)');
      expect(substance).toContain('Honestly it was messy.');
      expect(substance).toContain('Example 2 (linkedin)');
      expect(substance).toContain('They never feel ready.');
      // Withheld sections are still fully excluded — no leakage of their body.
      expect(substance).not.toContain('EMAIL VOICE');
      expect(substance).not.toContain('quick update');
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
