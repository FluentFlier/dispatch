import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/llm', () => ({
  chatCompletion: vi.fn(),
}));
import { chatCompletion } from '@/lib/llm';
import { classifyPost } from '@/lib/signals/classifier';
import { classifyPostHybridWithMeta } from '@/lib/signals/detect/hybrid';
import { enforceConnectLimit } from '@/lib/signals/outreach/enforce-limit';
import { DEFAULT_SAFETY_SETTINGS } from '@/lib/signals/safety/limits';
import { scoreChip, importedLabel } from '@/components/leads/feed-format';
import type { IngestedPost } from '@/lib/signals/types';

const post = (content: string): IngestedPost => ({
  platform: 'x',
  externalPostId: '1',
  authorName: 'Jane Doe',
  authorHandle: '@jane',
  content,
});

describe('Phase: Leads bugfixes', () => {
  describe('Task 2: LLM-recover company name when regex extraction fails', () => {
    beforeEach(() => vi.clearAllMocks());

    it('does NOT call the LLM when the keyword hit already has a company', async () => {
      const r = await classifyPostHybridWithMeta(post('I am building Acme, joined YC S24'));
      expect(r.signal?.companyName).toBe('Acme');
      expect(r.escalated).toBe(false);
      expect(chatCompletion).not.toHaveBeenCalled();
    });

    it('recovers the company via the LLM when the keyword hit has no company', async () => {
      vi.mocked(chatCompletion).mockResolvedValue(JSON.stringify({
        is_signal: true, signal_type: 'accelerator_join', company_name: 'Modern Treasury',
      }));
      const r = await classifyPostHybridWithMeta(post('Excited to announce we joined Y Combinator W26!'));
      expect(r.signal?.companyName).toBe('Modern Treasury');
      expect(r.escalated).toBe(true);
      expect(r.signal?.signalType).toBe('accelerator_join');
      expect(chatCompletion).toHaveBeenCalledTimes(1);
    });

    it('keeps the keyword result unchanged (no crash) when the LLM finds no company', async () => {
      vi.mocked(chatCompletion).mockResolvedValue(JSON.stringify({ is_signal: false }));
      const r = await classifyPostHybridWithMeta(post('Excited to announce we joined Y Combinator W26!'));
      expect(r.signal?.companyName).toBeUndefined();
      expect(r.escalated).toBe(true);
      expect(r.signal?.signalType).toBe('accelerator_join');
    });

    it('rejects a bare stopword company name recovered from the LLM, instead of passing it through', async () => {
      vi.mocked(chatCompletion).mockResolvedValue(JSON.stringify({
        is_signal: true, signal_type: 'accelerator_join', company_name: 'the',
      }));
      const r = await classifyPostHybridWithMeta(post('Excited to announce we joined Y Combinator W26!'));
      expect(r.signal?.companyName).toBeUndefined();
      expect(r.signal?.companyName).not.toBe('the');
      expect(r.escalated).toBe(true);
    });
  });

  describe('Task 3: reject stopword company names (defense-in-depth)', () => {
    it('never returns a lone stopword as companyName even if the regex surfaces one', () => {
      // "Building the future" has a keyword hit ("excited to announce" absent, so
      // use an explicit accelerator keyword to clear the confidence threshold)
      // and the extractor's capture group would (pre-guard) match "The" as a
      // capitalized token immediately after "building".
      const r = classifyPost(post('Excited to announce: building The future of fintech, joined YC S24'));
      expect(r).not.toBeNull();
      expect(r?.companyName).not.toBe('The');
      expect(r?.companyName).toBeUndefined();
    });

    it('still extracts a normal proper-noun company name', () => {
      const r = classifyPost(post('Excited to announce: building Acme, joined YC S24'));
      expect(r?.companyName).toBe('Acme');
    });
  });

  describe('Task 4: enforce 300-char LinkedIn connect limit server-side', () => {
    it('trims text over 300 chars to <= 300, not mid-word, no trailing space', () => {
      const long = 'A'.repeat(50) + ' this is a filler word run '.repeat(12) + 'end';
      expect(long.length).toBeGreaterThan(300);
      const result = enforceConnectLimit(long);
      expect(result.length).toBeLessThanOrEqual(300);
      expect(result.endsWith(' ')).toBe(false);
      // Not cut mid-word: the trimmed result must be a prefix that ends
      // exactly where a word/sentence boundary in the original text was.
      expect(long.startsWith(result)).toBe(true);
      const nextChar = long[result.length];
      expect(nextChar === undefined || nextChar === ' ').toBe(true);
    });

    it('trims at the last sentence boundary when one exists before the limit', () => {
      const sentence = 'Loved what you are building at Acme.';
      const filler = ' Just wanted to say hi and swap notes sometime soon if you are open to it more words here';
      const text = sentence + filler.repeat(4);
      expect(text.length).toBeGreaterThan(300);
      const result = enforceConnectLimit(text);
      expect(result.length).toBeLessThanOrEqual(300);
      expect(result.endsWith('.')).toBe(true);
    });

    it('leaves text unchanged when it is already <= 300 chars', () => {
      const short = 'Hi Jordan, loved the Acme launch. Would love to swap notes sometime.';
      expect(enforceConnectLimit(short)).toBe(short);
    });

    it('returns empty string unchanged', () => {
      expect(enforceConnectLimit('')).toBe('');
    });
  });

  describe('Task 5: dry-run ON by default for new workspaces', () => {
    it('seeds newly created workspaces with dry_run true until sending is explicitly enabled', () => {
      // getSafetySettings() spreads DEFAULT_SAFETY_SETTINGS onto brand-new
      // workspace rows. Locking this to true ensures a freshly onboarded
      // workspace never auto-sends live outreach before a human opts in.
      expect(DEFAULT_SAFETY_SETTINGS.dry_run).toBe(true);
    });
  });

  describe('Task 6: hide near-zero ICP score chips in the feed', () => {
    it('hides the chip (returns null) for a score of 0.00', () => {
      expect(scoreChip(0.0)).toBeNull();
    });

    it('hides the chip (returns null) for a score just below the threshold (0.14)', () => {
      expect(scoreChip(0.14)).toBeNull();
    });

    it('shows the chip at the threshold (0.15)', () => {
      expect(scoreChip(0.15)).toBe('0.15');
    });

    it('shows the chip for a high score (0.99)', () => {
      expect(scoreChip(0.99)).toBe('0.99');
    });
  });

  describe('Task 7: card shows import date + freshness', () => {
    // Assert the relative suffix (tz-independent: it is a UTC-ms diff); the exact
    // "Mon D" label depends on the runner's timezone so we only check the prefix.
    const now = Date.parse('2026-07-14T12:00:00Z');

    it('labels a same-day import as today', () => {
      const label = importedLabel('2026-07-14T09:00:00Z', now);
      expect(label).toMatch(/^Imported .+ · today$/);
    });

    it('labels a one-day-old import as 1d ago', () => {
      expect(importedLabel('2026-07-13T09:00:00Z', now)).toMatch(/ · 1d ago$/);
    });

    it('labels an older import with the day count', () => {
      expect(importedLabel('2026-07-02T12:00:00Z', now)).toMatch(/ · 12d ago$/);
    });

    it('returns null for a missing or invalid date (card omits the line)', () => {
      expect(importedLabel(null, now)).toBeNull();
      expect(importedLabel('not-a-date', now)).toBeNull();
    });
  });
});
