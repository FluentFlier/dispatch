/**
 * Phase: Event research orchestration + cross-workspace cache
 *
 * Verifies researchPublicEvent now populates structured fields (regression vs the
 * old always-empty key_topics/key_announcements), keeps the SSRF filter on
 * SERP-extracted links, and that the cache key + read/write behave correctly.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// dns lookup is used by assertPublicUrl - default to a public IP for real hosts.
vi.mock('dns/promises', () => ({
  lookup: vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }]),
}));

// Control extraction output without invoking a real LLM.
vi.mock('@/lib/event-capture/extract', () => ({
  extractResearchFacts: vi.fn(),
}));

import { extractResearchFacts } from '@/lib/event-capture/extract';
import {
  researchPublicEvent,
  researchCacheKey,
  getCachedResearch,
  putCachedResearch,
} from '@/lib/event-capture/research';

const mockExtract = vi.mocked(extractResearchFacts);

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
function textRes(body: string): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } });
}

const OLD_ENV = { ...process.env };

beforeEach(() => {
  process.env.SERPER_API_KEY = 'serper-key';
  mockExtract.mockReset();
});

afterEach(() => {
  process.env = { ...OLD_ENV };
  vi.restoreAllMocks();
});

describe('Phase: Event research', () => {
  describe('researchCacheKey', () => {
    it('normalizes title, date, and location', () => {
      const key = researchCacheKey('  TechCrunch Disrupt  ', 'San Francisco', new Date('2026-09-15T09:00:00Z'));
      expect(key).toBe('techcrunch disrupt|2026-09-15|san francisco');
    });
    it('handles null location', () => {
      expect(researchCacheKey('AI Summit', null, new Date('2026-01-02T00:00:00Z'))).toBe('ai summit|2026-01-02|');
    });
    it('is stable across workspaces for the same event', () => {
      const a = researchCacheKey('YC Demo Day', 'Remote', new Date('2026-03-20T18:00:00Z'));
      const b = researchCacheKey('yc demo day', 'remote', new Date('2026-03-20T20:00:00Z'));
      expect(a).toBe(b);
    });
  });

  describe('researchPublicEvent', () => {
    it('populates structured fields and filters private SERP links (SSRF regression)', async () => {
      const fetchSpy = vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes('serper')) {
          return jsonRes(200, {
            organic: [
              { link: 'http://127.0.0.1/evil', title: 'evil', snippet: 'x' },
              { link: 'https://example.com/event', title: 'Event', snippet: 'snippet fallback' },
            ],
          });
        }
        // Jina reader - only the public URL should ever reach here.
        return textRes('This is a sufficiently long page of readable event content about the conference.');
      });
      vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);

      mockExtract.mockResolvedValue({
        summary: 'A real conference',
        speakers: [{ name: 'Jane Doe' }],
        key_topics: ['LLMs', 'agents'],
        key_announcements: ['new product'],
      });

      const out = await researchPublicEvent('DevCon', 'Berlin', new Date('2026-05-01T09:00:00Z'));

      expect(out).not.toBeNull();
      // Regression: these were ALWAYS empty in the old regex implementation.
      expect(out?.key_topics).toEqual(['LLMs', 'agents']);
      expect(out?.key_announcements).toEqual(['new product']);
      expect(out?.speakers).toEqual([{ name: 'Jane Doe' }]);
      // SSRF: the 127.0.0.1 link was filtered - only the public source remains.
      expect(out?.sources).toEqual(['https://example.com/event']);
    });

    it('returns null when search yields no results', async () => {
      const fetchSpy = vi.fn(async () => jsonRes(200, { organic: [] }));
      vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);

      const out = await researchPublicEvent('Nonexistent Event', null, new Date('2026-05-01T09:00:00Z'));
      expect(out).toBeNull();
      expect(mockExtract).not.toHaveBeenCalled();
    });

    it('falls back to the SERP snippet when extraction is unavailable', async () => {
      const fetchSpy = vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes('serper')) {
          return jsonRes(200, {
            organic: [{ link: 'https://example.com/event', title: 'Event', snippet: 'snippet summary' }],
          });
        }
        return textRes('A sufficiently long page of readable event content that comfortably exceeds the Jina reader minimum length threshold.');
      });
      vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);

      mockExtract.mockResolvedValue(null); // e.g. free-tier quota exhausted

      const out = await researchPublicEvent('DevCon', 'Berlin', new Date('2026-05-01T09:00:00Z'));
      expect(out?.summary).toBe('snippet summary');
      expect(out?.key_topics).toEqual([]);
      expect(out?.sources).toEqual(['https://example.com/event']);
    });
  });

  describe('research cache', () => {
    it('getCachedResearch returns a fresh row', async () => {
      const row = {
        summary: 's',
        speakers: [],
        key_topics: ['t'],
        key_announcements: [],
        sources: ['https://x.com'],
        raw_text: 'r',
        updated_at: new Date().toISOString(),
      };
      const client = {
        database: {
          from: () => ({
            select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }),
          }),
        },
      };
      const out = await getCachedResearch(client as never, 'key');
      expect(out?.summary).toBe('s');
      expect(out?.key_topics).toEqual(['t']);
    });

    it('getCachedResearch treats stale rows as a miss', async () => {
      const stale = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
      const client = {
        database: {
          from: () => ({
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: { summary: 's', updated_at: stale } }) }),
            }),
          }),
        },
      };
      expect(await getCachedResearch(client as never, 'key')).toBeNull();
    });

    it('getCachedResearch returns null on miss', async () => {
      const client = {
        database: {
          from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
        },
      };
      expect(await getCachedResearch(client as never, 'key')).toBeNull();
    });

    it('putCachedResearch upserts with the research_key conflict target', async () => {
      const upsert = vi.fn(async () => ({}));
      const client = { database: { from: () => ({ upsert }) } };
      await putCachedResearch(client as never, 'techconf|2026-05-01|berlin', {
        summary: 's',
        speakers: [],
        key_topics: [],
        key_announcements: [],
        sources: [],
        raw_text: 'r',
      });
      expect(upsert).toHaveBeenCalledOnce();
      const [row, opts] = upsert.mock.calls[0] as unknown as [Record<string, unknown>, Record<string, unknown>];
      expect(row.research_key).toBe('techconf|2026-05-01|berlin');
      expect(opts).toEqual({ onConflict: 'research_key' });
    });
  });
});
