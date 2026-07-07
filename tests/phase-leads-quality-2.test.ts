/**
 * Phase: Leads quality 2 - Task 1 + Task 2
 *
 * The contact-resolution ladder's rung 4 (Unipile LinkedIn people-search) was
 * a null stub. This locks in the real search call (account-scoped, fail-closed)
 * and the enrichment path that threads a workspace-resolved account id into it.
 *
 * Task 2 appends focused regression tests for deferred branches flagged in
 * prior review: the Unipile type filter, the enforce-limit hard-truncate
 * fallback, the normalizeEvent author_name rung, the hybrid LLM-recovery
 * merge precedence, and the icp-score clamp.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('@/lib/signals/outreach/unipile-client', () => ({
  unipileJsonPost: vi.fn(),
  unipileJsonGet: vi.fn(),
  unipileFormPost: vi.fn(),
  parseUnipileError: vi.fn(async () => 'error'),
  getLinkedInApiMode: vi.fn(() => 'classic'),
}));

vi.mock('@/lib/llm', () => ({
  chatCompletion: vi.fn(),
}));

import { unipileJsonPost } from '@/lib/signals/outreach/unipile-client';
import { searchLinkedInPerson } from '@/lib/signals/outreach/unipile-linkedin';
import { enrichViaUnipileSearch } from '@/lib/signals/leads/enrich-contact';
import { enforceConnectLimit } from '@/lib/signals/outreach/enforce-limit';
import { normalizeEvent } from '@/lib/signals/feed/normalize';
import { classifyPostHybridWithMeta } from '@/lib/signals/detect/hybrid';
import { scoreIcpFit } from '@/lib/signals/leads/icp-score';
import { chatCompletion } from '@/lib/llm';
import { mapWithConcurrency } from '@/lib/util/concurrency';
import { mergeFeed, FEED_PAGE_LIMIT } from '@/lib/signals/feed/store';
import type { IngestedPost, SignalEventWithPost } from '@/lib/signals/types';
import type { UnifiedLeadCard } from '@/lib/signals/feed/normalize';

beforeAll(() => {
  process.env.UNIPILE_DSN = 'api1.unipile.com:1234';
  process.env.UNIPILE_API_KEY = 'test-key';
});

beforeEach(() => vi.clearAllMocks());

describe('Phase: Leads quality 2 - Unipile people-search rung', () => {
  describe('searchLinkedInPerson', () => {
    it('maps the first PEOPLE item to linkedinUrl + name on a 2xx response', async () => {
      vi.mocked(unipileJsonPost).mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [
              {
                type: 'PEOPLE',
                id: 'abc',
                name: 'Jordan Kim',
                profile_url: 'https://www.linkedin.com/in/jordankim',
                headline: 'Founder at Acme',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

      const result = await searchLinkedInPerson({
        name: 'Jordan Kim',
        company: 'Acme',
        accountId: 'acc_123',
      });

      expect(result).toEqual({
        name: 'Jordan Kim',
        role: 'Founder at Acme',
        linkedinUrl: 'https://www.linkedin.com/in/jordankim',
      });

      const [path, body] = vi.mocked(unipileJsonPost).mock.calls[0];
      expect(String(path)).toContain('/linkedin/search');
      expect(String(path)).toContain('account_id=acc_123');
      expect(body).toEqual({
        api: 'classic',
        category: 'people',
        keywords: 'Jordan Kim Acme',
      });
    });

    it('returns null without calling the HTTP helper when accountId is empty', async () => {
      const result = await searchLinkedInPerson({ name: 'Jordan Kim', company: 'Acme', accountId: '' });
      expect(result).toBeNull();
      expect(unipileJsonPost).not.toHaveBeenCalled();
    });

    it('returns null (fail-closed) on a non-2xx response', async () => {
      vi.mocked(unipileJsonPost).mockResolvedValue(
        new Response(JSON.stringify({ detail: 'nope' }), { status: 400 }),
      );

      const result = await searchLinkedInPerson({
        name: 'Jordan Kim',
        company: 'Acme',
        accountId: 'acc_123',
      });

      expect(result).toBeNull();
    });

    it('returns null when there are no people items', async () => {
      vi.mocked(unipileJsonPost).mockResolvedValue(
        new Response(JSON.stringify({ items: [] }), { status: 200 }),
      );

      const result = await searchLinkedInPerson({
        name: 'Jordan Kim',
        company: 'Acme',
        accountId: 'acc_123',
      });

      expect(result).toBeNull();
    });

    it('picks the PEOPLE item and skips a COMPANY item mixed into the results (regression: a company result must never be mapped as a founder contact)', async () => {
      vi.mocked(unipileJsonPost).mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [
              { type: 'COMPANY', profile_url: 'https://linkedin.com/company/x' },
              { type: 'PEOPLE', name: 'Sam', profile_url: 'https://linkedin.com/in/sam' },
            ],
          }),
          { status: 200 },
        ),
      );

      const result = await searchLinkedInPerson({
        name: 'Sam',
        company: 'Acme',
        accountId: 'acc_123',
      });

      expect(result?.linkedinUrl).toBe('https://linkedin.com/in/sam');
      expect(result?.linkedinUrl).not.toContain('/company/');
    });

    it('returns null for an item with no type at all, instead of picking it (type is required, not just non-COMPANY)', async () => {
      vi.mocked(unipileJsonPost).mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [{ profile_url: 'https://linkedin.com/company/x' }],
          }),
          { status: 200 },
        ),
      );

      const result = await searchLinkedInPerson({
        name: 'Jordan Kim',
        company: 'Acme',
        accountId: 'acc_123',
      });

      expect(result).toBeNull();
    });
  });

  describe('enrichViaUnipileSearch', () => {
    it('returns null when there is no founder name (unchanged behavior)', async () => {
      const search = vi.fn();
      const result = await enrichViaUnipileSearch({ companyName: 'Acme', founderName: null }, { search });
      expect(result).toBeNull();
      expect(search).not.toHaveBeenCalled();
    });

    it('returns the found contact when the injected search yields one', async () => {
      const search = vi.fn().mockResolvedValue({
        name: 'Jordan Kim',
        role: 'Founder',
        linkedinUrl: 'https://www.linkedin.com/in/jordankim',
      });
      const result = await enrichViaUnipileSearch(
        { companyName: 'Acme', founderName: 'Jordan Kim' },
        { search },
      );
      expect(result).toEqual({
        name: 'Jordan Kim',
        role: 'Founder',
        linkedinUrl: 'https://www.linkedin.com/in/jordankim',
        via: 'unipile',
      });
      expect(search).toHaveBeenCalledWith({ name: 'Jordan Kim', company: 'Acme' });
    });
  });
});

describe('Phase: Leads quality 2 - enforceConnectLimit hard-truncate fallback', () => {
  it('hard-truncates a single giant word with no whitespace to <= 300 chars (lastSpace <= 0 branch)', () => {
    const giant = 'A'.repeat(400);
    const result = enforceConnectLimit(giant);
    expect(result.length).toBeLessThanOrEqual(300);
    expect(result.length).toBeGreaterThan(0);
  });

  it('still returns <= 300 chars when only an early sentence period exists and no later boundary follows', () => {
    const text = `Hi.${'B'.repeat(400)}`;
    expect(text.length).toBeGreaterThan(300);
    const result = enforceConnectLimit(text);
    expect(result.length).toBeLessThanOrEqual(300);
    expect(result).toBe('Hi.');
  });
});

describe('Phase: Leads quality 2 - normalizeEvent author_name rung', () => {
  function makeEvent(overrides: Partial<SignalEventWithPost>): SignalEventWithPost {
    return {
      id: 'evt-1',
      workspace_id: 'ws-1',
      raw_post_id: null,
      signal_type: 'other',
      company_name: null,
      person_name: null,
      accelerator_name: null,
      batch: null,
      signal_summary: null,
      confidence: 0,
      dedupe_key: null,
      status: 'pending',
      created_at: '2026-07-01T00:00:00.000Z',
      updated_at: '2026-07-01T00:00:00.000Z',
      raw_post: null,
      outreach: null,
      ...overrides,
    } as SignalEventWithPost;
  }

  it('falls back to raw_post.author_name (3rd rung) rather than author_handle (4th rung) when both are present', () => {
    const event = makeEvent({
      company_name: null,
      person_name: null,
      raw_post: {
        id: 'post-1',
        workspace_id: 'ws-1',
        source_id: null,
        platform: 'x',
        external_post_id: 'ext-1',
        author_handle: 'acmehq',
        author_name: 'Acme Labs',
        content: 'we joined the accelerator',
        post_url: null,
        posted_at: null,
        raw_payload: null,
        created_at: '2026-07-01T00:00:00.000Z',
      },
    });
    const card = normalizeEvent(event);
    expect(card.companyName).toBe('Acme Labs');
  });
});

describe('Phase: Leads quality 2 - hybrid LLM-recovery merge precedence', () => {
  const post = (content: string): IngestedPost => ({
    platform: 'x',
    externalPostId: '1',
    authorName: 'Jane Doe',
    authorHandle: '@jane',
    content,
  });

  beforeEach(() => vi.clearAllMocks());

  it('fills companyName from the LLM but keeps the keyword-stage personName/batch (does not let the LLM overwrite fields the keyword stage already found)', async () => {
    // This keyword hit has no "building X" phrase, so companyName is undefined,
    // but it does carry a personName (from the post author) and a batch/accelerator
    // (from the YC regex) - exactly the "keyword result already has them" case.
    vi.mocked(chatCompletion).mockResolvedValue(JSON.stringify({
      is_signal: true,
      signal_type: 'accelerator_join',
      company_name: 'Modern Treasury',
      person_name: 'Someone Else',
      accelerator: 'Techstars',
      batch: 'S25',
    }));

    const r = await classifyPostHybridWithMeta(post('Excited to announce we joined Y Combinator W26!'));

    expect(r.escalated).toBe(true);
    // Recovered from the LLM because the keyword stage had no company.
    expect(r.signal?.companyName).toBe('Modern Treasury');
    // Preserved from the keyword stage, NOT overwritten by the LLM's values.
    expect(r.signal?.personName).toBe('Jane Doe');
    expect(r.signal?.batch).toBe('W26');
    expect(r.signal?.acceleratorName).toBe('Y Combinator');
  });
});

describe('Phase: Leads quality 2 - scoreIcpFit clamps out-of-range LLM output', () => {
  beforeEach(() => vi.clearAllMocks());

  it('clamps an above-range value (1.7) down to 1', async () => {
    vi.mocked(chatCompletion).mockResolvedValue('1.7');
    const s = await scoreIcpFit({ companyName: 'X', verticals: ['fintech'], keywords: [] });
    expect(s).toBe(1);
  });

  it('clamps a below-range value (-0.3) up to 0', async () => {
    vi.mocked(chatCompletion).mockResolvedValue('-0.3');
    const s = await scoreIcpFit({ companyName: 'X', verticals: ['fintech'], keywords: [] });
    expect(s).toBe(0);
  });

  it('clamps a negative integer (-1) to 0, not the wrong end of the range', async () => {
    vi.mocked(chatCompletion).mockResolvedValue('-1');
    const s = await scoreIcpFit({ companyName: 'X', verticals: ['fintech'], keywords: [] });
    expect(s).toBe(0);
  });
});

describe('Phase: Leads quality 2 - Task 3: mapWithConcurrency', () => {
  it('preserves result order even when later items resolve before earlier ones', async () => {
    // Item 0 has the longest delay, item 4 the shortest - if order were
    // determined by resolution time (not input index) this would fail.
    const delays = [40, 30, 20, 10, 0];
    const result = await mapWithConcurrency(delays, 5, (delay, index) => {
      return new Promise<number>((resolve) => {
        setTimeout(() => resolve(index), delay);
      });
    });
    expect(result).toEqual([0, 1, 2, 3, 4]);
  });

  it('never runs more than `limit` tasks concurrently', async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    let running = 0;
    let maxRunning = 0;
    const limit = 3;

    await mapWithConcurrency(items, limit, async (item) => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return item * 2;
    });

    expect(maxRunning).toBeLessThanOrEqual(limit);
    expect(maxRunning).toBeGreaterThan(0);
  });

  it('returns [] and never calls fn for empty input', async () => {
    const fn = vi.fn(async (item: number) => item);
    const result = await mapWithConcurrency<number, number>([], 5, fn);
    expect(result).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('Phase: Leads quality 2 - Task 4: unified feed page size', () => {
  const card = (over: Partial<UnifiedLeadCard>): UnifiedLeadCard => ({
    id: 'x', kind: 'directory', source: 'yc_directory', companyName: 'C', tagline: null,
    signalType: null, signalSummary: null, sourceUrl: null, batch: null, accelerator: null,
    contact: null, contactStatus: null, score: 0.5, status: 'new', detectedAt: '2026-07-01T00:00:00Z',
    ...over,
  });

  it('caps merged output to the page limit, keeping the top-scored slice', () => {
    // More cards than the page limit, descending scores, so the top
    // FEED_PAGE_LIMIT (by score) are the ones expected to survive the cap.
    const directoryCards = Array.from({ length: FEED_PAGE_LIMIT + 20 }, (_unused, i) =>
      card({ id: `d${i}`, score: 1 - i * 0.001 }));

    const out = mergeFeed(directoryCards, [], {});

    expect(out).toHaveLength(FEED_PAGE_LIMIT);
    const expectedIds = directoryCards
      .slice(0, FEED_PAGE_LIMIT) // top FEED_PAGE_LIMIT scores are the first FEED_PAGE_LIMIT entries (already descending)
      .map((c) => c.id);
    expect(out.map((c) => c.id)).toEqual(expectedIds);
  });

  it('caps merged output to an explicit filters.limit smaller than FEED_PAGE_LIMIT', () => {
    const directoryCards = Array.from({ length: 10 }, (_unused, i) =>
      card({ id: `d${i}`, score: 1 - i * 0.01 }));

    const out = mergeFeed(directoryCards, [], { limit: 3 });

    expect(out).toHaveLength(3);
    expect(out.map((c) => c.id)).toEqual(['d0', 'd1', 'd2']);
  });

  it('returns all cards unchanged when there are fewer than the limit', () => {
    const directoryCards = [card({ id: 'a', score: 0.9 }), card({ id: 'b', score: 0.4 })];
    const signalCards = [card({ id: 'c', kind: 'signal', source: 'x', score: 0.6 })];

    const out = mergeFeed(directoryCards, signalCards, {});

    expect(out).toHaveLength(3);
    expect(out.map((c) => c.id)).toEqual(['a', 'c', 'b']);
  });
});
