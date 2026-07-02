/**
 * Phase: Event research extraction (provider-agnostic)
 *
 * Verifies the LLM extraction layer works WITHOUT provider-specific structured
 * output — it must parse the messier JSON that free models (Groq/HF) emit, so the
 * same code runs on the premium model in prod and free models in testing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/ai', () => ({
  generateContent: vi.fn(),
}));

import { generateContent } from '@/lib/ai';
import { parseResearchFactsJson, extractResearchFacts } from '@/lib/event-capture/extract';

const mockGenerate = vi.mocked(generateContent);

afterEach(() => {
  vi.restoreAllMocks();
  mockGenerate.mockReset();
});

describe('Phase: Event research extraction', () => {
  describe('parseResearchFactsJson', () => {
    it('parses a clean JSON object', () => {
      const out = parseResearchFactsJson(
        '{"summary":"AI summit","speakers":[{"name":"Jane Doe","title":"CTO"}],"key_topics":["LLMs"],"key_announcements":["Series B"]}',
      );
      expect(out).not.toBeNull();
      expect(out?.summary).toBe('AI summit');
      expect(out?.speakers).toEqual([{ name: 'Jane Doe', title: 'CTO' }]);
      expect(out?.key_topics).toEqual(['LLMs']);
      expect(out?.key_announcements).toEqual(['Series B']);
    });

    it('parses JSON wrapped in markdown code fences', () => {
      const out = parseResearchFactsJson(
        '```json\n{"summary":"X","speakers":[],"key_topics":["a"],"key_announcements":[]}\n```',
      );
      expect(out?.summary).toBe('X');
      expect(out?.key_topics).toEqual(['a']);
    });

    it('parses JSON followed by trailing prose', () => {
      const out = parseResearchFactsJson(
        'Here is the result:\n{"summary":"Y","speakers":[],"key_topics":[],"key_announcements":[]}\nHope that helps!',
      );
      expect(out?.summary).toBe('Y');
    });

    it('dedupes and caps topics/speakers', () => {
      const out = parseResearchFactsJson(
        JSON.stringify({
          summary: 's',
          speakers: [{ name: 'A' }, { name: 'a' }, { name: 'B' }],
          key_topics: ['t', 'T', 't', 'u'],
          key_announcements: [],
        }),
      );
      expect(out?.speakers.map((s) => s.name)).toEqual(['A', 'B']);
      expect(out?.key_topics).toEqual(['t', 'u']);
    });

    it('returns null for output containing no JSON object', () => {
      expect(parseResearchFactsJson('no json here')).toBeNull();
    });

    it('returns null for malformed JSON', () => {
      expect(parseResearchFactsJson('{"summary": "x", oops}')).toBeNull();
    });

    it('drops non-string / malformed list and speaker entries', () => {
      const out = parseResearchFactsJson(
        JSON.stringify({
          summary: 42,
          speakers: [{ title: 'no name' }, 'bad', { name: 'Real Person' }],
          key_topics: [1, 'valid', null],
          key_announcements: 'not-an-array',
        }),
      );
      expect(out?.summary).toBe('');
      expect(out?.speakers).toEqual([{ name: 'Real Person' }]);
      expect(out?.key_topics).toEqual(['valid']);
      expect(out?.key_announcements).toEqual([]);
    });
  });

  describe('extractResearchFacts', () => {
    it('returns null without calling the LLM when rawText is empty', async () => {
      const out = await extractResearchFacts('   ', 'Some Event');
      expect(out).toBeNull();
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('returns parsed facts on valid model output', async () => {
      mockGenerate.mockResolvedValue(
        '{"summary":"Great event","speakers":[],"key_topics":["ai"],"key_announcements":[]}',
      );
      const out = await extractResearchFacts('long enough page text about the event', 'Event');
      expect(out?.summary).toBe('Great event');
      expect(out?.key_topics).toEqual(['ai']);
    });

    it('returns null when the model output is unparseable', async () => {
      mockGenerate.mockResolvedValue('I could not find any structured data.');
      const out = await extractResearchFacts('some text', 'Event');
      expect(out).toBeNull();
    });

    it('returns null (no throw) when the LLM call fails, e.g. quota exhausted', async () => {
      mockGenerate.mockRejectedValue(new Error('LLM provider returned 429'));
      const out = await extractResearchFacts('some text', 'Event');
      expect(out).toBeNull();
    });
  });
});
