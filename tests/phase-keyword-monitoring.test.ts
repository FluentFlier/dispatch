/**
 * Phase: X keyword monitoring — continuous keyword/tag search on X surfacing
 * "author just posted about <keyword>" leads through the signal engine.
 *
 * Covers: the deterministic keyword-match builder (summary copy + weekly
 * dedupe key), the X search query builder, the time-window search cursor,
 * the ICP relevance gate (fail-open), the process-batch keyword branch
 * (GTM classifier bypassed, events typed keyword_match, overlap runs create
 * no duplicates), the sources API topic cap + hourly poll default, and the
 * feed rendering contract (reachable x_handle contact, label coverage).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/llm', () => ({
  chatCompletion: vi.fn(),
}));
vi.mock('@/lib/signals/detect/hybrid', () => ({
  classifyPostHybrid: vi.fn(),
  classifyPostHybridWithMeta: vi.fn(),
}));
vi.mock('@/lib/signals/store', () => ({
  upsertRawPost: vi.fn().mockResolvedValue('raw-1'),
  createSignalEvent: vi.fn().mockResolvedValue({ created: true, eventId: 'evt-1' }),
  // getEvent null → the action pipeline is skipped, keeping the test focused.
  getEvent: vi.fn().mockResolvedValue(null),
  // Imported by the sources route (GET path); unused in these tests.
  ensureDefaultSources: vi.fn().mockResolvedValue(0),
  ensureGtmPlaybook: vi.fn().mockResolvedValue(false),
  listSources: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/insforge/server', () => ({
  getAuthenticatedUser: vi.fn(),
  getServerClient: vi.fn(),
  getServiceClient: vi.fn(),
}));
vi.mock('@/lib/workspace', () => ({
  getActiveWorkspaceId: vi.fn(),
}));

import { NextRequest } from 'next/server';
import { chatCompletion } from '@/lib/llm';
import { classifyPostHybridWithMeta } from '@/lib/signals/detect/hybrid';
import { createSignalEvent, upsertRawPost } from '@/lib/signals/store';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { POST as postSource } from '@/app/api/signals/sources/route';
import {
  buildKeywordMatchSignal,
  classifyKeywordPost,
  isoWeek,
  scoreKeywordRelevance,
} from '@/lib/signals/detect/keyword-match';
import { buildSearchQuery } from '@/lib/signals/ingest/apify-fetch';
import {
  filterSearchPostsSinceCursor,
  newestPostedAt,
} from '@/lib/signals/ingest/normalize';
import { processIngestedPosts } from '@/lib/signals/ingest/process-batch';
import { normalizeEvent } from '@/lib/signals/feed/normalize';
import { isReachable, signalTypeLabel } from '@/components/leads/feed-format';
import type {
  IngestedPost,
  SignalEventWithPost,
  SignalSourceRow,
} from '@/lib/signals/types';

const keywordSource = (overrides: Partial<SignalSourceRow> = {}): SignalSourceRow => ({
  id: 'src-1',
  workspace_id: 'ws-1',
  platform: 'x',
  handle_or_url: 'building in public',
  source_type: 'keyword_search',
  label: 'building in public',
  enabled: true,
  poll_interval_minutes: 60,
  last_polled_at: null,
  cursor_json: null,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
  ...overrides,
});

const post = (overrides: Partial<IngestedPost> = {}): IngestedPost => ({
  platform: 'x',
  externalPostId: 'p-1',
  authorHandle: 'janedoe',
  authorName: 'Jane Doe',
  content: 'Day 30 of building in public: shipped the billing page and got 3 signups.',
  postedAt: '2026-07-10T12:00:00.000Z',
  ...overrides,
});

/**
 * Minimal chainable InsForge client stub covering the two query shapes the
 * keyword branch uses: the raw-post pre-dedupe select and the cursor update.
 */
function makeClientStub(seenIds: string[] = []) {
  const cursorUpdates: Array<Record<string, unknown>> = [];
  const client = {
    database: {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              in: () =>
                Promise.resolve({
                  data: seenIds.map((id) => ({ external_post_id: id })),
                }),
            }),
          }),
        }),
        update: (patch: Record<string, unknown>) => {
          if (table === 'signal_sources') cursorUpdates.push(patch);
          return { eq: () => Promise.resolve({}) };
        },
      }),
    },
  };
  return { client: client as never, cursorUpdates };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(upsertRawPost).mockResolvedValue('raw-1');
  vi.mocked(createSignalEvent).mockResolvedValue({ created: true, eventId: 'evt-1' });
});

describe('buildKeywordMatchSignal', () => {
  it('summarizes as "@handle just posted about <keyword>" with a snippet', () => {
    const signal = buildKeywordMatchSignal(post(), keywordSource());
    expect(signal.signalType).toBe('keyword_match');
    expect(signal.signalSummary).toContain('@janedoe just posted about "building in public"');
    expect(signal.signalSummary).toContain('Day 30 of building in public');
    expect(signal.personName).toBe('Jane Doe');
    expect(signal.matchedKeywords).toEqual(['building in public']);
  });

  it('dedupe key is stable within an ISO week and differs across weeks, keywords, authors', () => {
    const monday = post({ postedAt: '2026-07-06T09:00:00.000Z' });
    const friday = post({ postedAt: '2026-07-10T21:00:00.000Z', externalPostId: 'p-2' });
    const nextWeek = post({ postedAt: '2026-07-13T09:00:00.000Z', externalPostId: 'p-3' });

    const a = buildKeywordMatchSignal(monday, keywordSource());
    const b = buildKeywordMatchSignal(friday, keywordSource());
    const c = buildKeywordMatchSignal(nextWeek, keywordSource());
    const otherKeyword = buildKeywordMatchSignal(
      monday,
      keywordSource({ label: '#indiehackers', handle_or_url: '#indiehackers' }),
    );
    const otherAuthor = buildKeywordMatchSignal(
      post({ postedAt: '2026-07-06T09:00:00.000Z', authorHandle: 'someoneelse' }),
      keywordSource(),
    );

    expect(a.dedupeKey).toBe(b.dedupeKey); // same author+keyword+week → one card
    expect(a.dedupeKey).not.toBe(c.dedupeKey);
    expect(a.dedupeKey).not.toBe(otherKeyword.dedupeKey);
    expect(a.dedupeKey).not.toBe(otherAuthor.dedupeKey);
  });

  it('preserves hashtag keywords in the summary', () => {
    const signal = buildKeywordMatchSignal(
      post(),
      keywordSource({ label: '#buildinpublic', handle_or_url: '#buildinpublic' }),
    );
    expect(signal.signalSummary).toContain('"#buildinpublic"');
  });

  it('isoWeek follows ISO-8601 (Jan 1 2027 belongs to 2026-W53)', () => {
    expect(isoWeek(new Date(Date.UTC(2026, 6, 6)))).toBe('2026-W28');
    expect(isoWeek(new Date(Date.UTC(2027, 0, 1)))).toBe('2026-W53');
  });
});

describe('buildSearchQuery', () => {
  it('quotes multi-word inputs for exact-phrase and excludes retweets', () => {
    expect(buildSearchQuery('building in public')).toBe('"building in public" -filter:retweets');
  });

  it('passes hashtags through unquoted', () => {
    expect(buildSearchQuery('#buildinpublic')).toBe('#buildinpublic -filter:retweets');
  });

  it('passes advanced X operators through raw', () => {
    const advanced = 'from:naval filter:links "startup advice"';
    expect(buildSearchQuery(advanced)).toBe(advanced);
  });
});

describe('filterSearchPostsSinceCursor', () => {
  const cursor = '2026-07-10T12:00:00.000Z';

  it('keeps posts inside the overlap window and drops posts well before the cursor', () => {
    const posts = [
      post({ externalPostId: 'old', postedAt: '2026-07-10T11:30:00.000Z' }), // 30 min before
      post({ externalPostId: 'near', postedAt: '2026-07-10T11:55:00.000Z' }), // 5 min before
      post({ externalPostId: 'new', postedAt: '2026-07-10T13:00:00.000Z' }),
    ];
    const fresh = filterSearchPostsSinceCursor(posts, cursor, 10);
    expect(fresh.map((p) => p.externalPostId)).toEqual(['new', 'near']);
  });

  it('caps and sorts newest-first when no cursor exists', () => {
    const posts = [
      post({ externalPostId: 'b', postedAt: '2026-07-09T00:00:00.000Z' }),
      post({ externalPostId: 'a', postedAt: '2026-07-10T00:00:00.000Z' }),
      post({ externalPostId: 'c', postedAt: '2026-07-08T00:00:00.000Z' }),
    ];
    const fresh = filterSearchPostsSinceCursor(posts, undefined, 2);
    expect(fresh.map((p) => p.externalPostId)).toEqual(['a', 'b']);
  });

  it('keeps posts without a timestamp (DB dedupe handles re-ingests)', () => {
    const posts = [post({ externalPostId: 'no-ts', postedAt: undefined })];
    expect(filterSearchPostsSinceCursor(posts, cursor, 10)).toHaveLength(1);
  });

  it('newestPostedAt returns the max timestamp regardless of order', () => {
    const posts = [
      post({ postedAt: '2026-07-09T00:00:00.000Z' }),
      post({ postedAt: '2026-07-11T00:00:00.000Z' }),
      post({ postedAt: undefined }),
    ];
    expect(newestPostedAt(posts)).toBe('2026-07-11T00:00:00.000Z');
  });
});

describe('relevance gate', () => {
  it('drops posts the LLM scores below the threshold', async () => {
    vi.mocked(chatCompletion).mockResolvedValue(JSON.stringify({ relevance: 0.1 }));
    const result = await classifyKeywordPost(post(), keywordSource(), {
      icpDescription: 'B2B SaaS founders selling dev tools',
    });
    expect(result).toBeNull();
  });

  it('uses the relevance score as confidence when above threshold', async () => {
    vi.mocked(chatCompletion).mockResolvedValue(JSON.stringify({ relevance: 0.9 }));
    const result = await classifyKeywordPost(post(), keywordSource(), {
      icpDescription: 'B2B SaaS founders selling dev tools',
    });
    expect(result?.confidence).toBe(0.9);
  });

  it('fails open: LLM error keeps the lead at baseline confidence', async () => {
    vi.mocked(chatCompletion).mockRejectedValue(new Error('provider down'));
    const result = await classifyKeywordPost(post(), keywordSource(), {
      icpDescription: 'B2B SaaS founders',
    });
    expect(result).not.toBeNull();
    expect(result?.confidence).toBe(0.5);
  });

  it('skips the LLM entirely without an ICP description', async () => {
    const result = await classifyKeywordPost(post(), keywordSource(), { icpDescription: null });
    expect(result?.confidence).toBe(0.5);
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it('scoreKeywordRelevance returns null on unparseable output', async () => {
    vi.mocked(chatCompletion).mockResolvedValue('sorry, I cannot help with that');
    expect(await scoreKeywordRelevance(post(), 'some ICP')).toBeNull();
  });
});

describe('processIngestedPosts keyword branch', () => {
  it('bypasses the GTM classifier and creates keyword_match events', async () => {
    const { client } = makeClientStub();
    const result = await processIngestedPosts(client, 'ws-1', keywordSource(), [post()], {
      maxItems: 5,
    });

    expect(classifyPostHybridWithMeta).not.toHaveBeenCalled();
    expect(result.signalsCreated).toBe(1);
    const classified = vi.mocked(createSignalEvent).mock.calls[0][3];
    expect(classified.signalType).toBe('keyword_match');
  });

  it('creates no duplicates on an overlapping second run (raw-post pre-dedupe)', async () => {
    const { client } = makeClientStub(['p-1']); // p-1 already ingested last run
    const result = await processIngestedPosts(client, 'ws-1', keywordSource(), [post()], {
      maxItems: 5,
    });

    expect(result.signalsCreated).toBe(0);
    expect(upsertRawPost).not.toHaveBeenCalled();
    expect(createSignalEvent).not.toHaveBeenCalled();
  });

  it('advances a last_seen_posted_at cursor for keyword sources', async () => {
    const { client, cursorUpdates } = makeClientStub();
    await processIngestedPosts(client, 'ws-1', keywordSource(), [post()], { maxItems: 5 });

    expect(cursorUpdates).toHaveLength(1);
    const cursor = cursorUpdates[0].cursor_json as Record<string, unknown>;
    expect(cursor.last_seen_posted_at).toBe('2026-07-10T12:00:00.000Z');
  });

  it('runs the relevance gate when an ICP description is provided', async () => {
    vi.mocked(chatCompletion).mockResolvedValue(JSON.stringify({ relevance: 0.05 }));
    const { client } = makeClientStub();
    const result = await processIngestedPosts(client, 'ws-1', keywordSource(), [post()], {
      maxItems: 5,
      icpDescription: 'B2B SaaS founders',
    });

    expect(chatCompletion).toHaveBeenCalledTimes(1);
    expect(result.signalsCreated).toBe(0); // scored 0.05 → dropped
  });
});

describe('POST /api/signals/sources — topic cap and poll default', () => {
  /** Client stub for the sources route: keyword-count select + insert echo. */
  function makeSourcesClientStub(existingKeywordCount: number) {
    const inserted: Array<Record<string, unknown>> = [];
    const client = {
      database: {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () =>
                Promise.resolve({
                  data: Array.from({ length: existingKeywordCount }, (_, i) => ({ id: `k${i}` })),
                }),
            }),
          }),
          insert: (row: Record<string, unknown>) => {
            inserted.push(row);
            return {
              select: () => ({
                single: () => Promise.resolve({ data: { id: 'new-src', ...row }, error: null }),
              }),
            };
          },
        }),
      },
    };
    return { client: client as never, inserted };
  }

  const makeRequest = (body: Record<string, unknown>) =>
    new NextRequest('http://localhost/api/signals/sources', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });

  beforeEach(() => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getActiveWorkspaceId).mockResolvedValue('ws-1');
  });

  it('rejects the 6th keyword source with 422', async () => {
    const { client } = makeSourcesClientStub(5);
    vi.mocked(getServerClient).mockReturnValue(client);

    const res = await postSource(
      makeRequest({ platform: 'x', handle_or_url: 'ai agents', source_type: 'keyword_search' }),
    );
    expect(res.status).toBe(422);
  });

  it('inserts keyword sources with a 60-minute poll interval', async () => {
    const { client, inserted } = makeSourcesClientStub(0);
    vi.mocked(getServerClient).mockReturnValue(client);

    const res = await postSource(
      makeRequest({ platform: 'x', handle_or_url: '#buildinpublic', source_type: 'keyword_search' }),
    );
    expect(res.status).toBe(201);
    expect(inserted[0].poll_interval_minutes).toBe(60);
  });

  it('leaves the poll interval at the column default for account sources', async () => {
    const { client, inserted } = makeSourcesClientStub(0);
    vi.mocked(getServerClient).mockReturnValue(client);

    const res = await postSource(makeRequest({ platform: 'x', handle_or_url: '@naval' }));
    expect(res.status).toBe(201);
    expect(inserted[0]).not.toHaveProperty('poll_interval_minutes');
  });
});

describe('feed rendering contract', () => {
  const keywordEvent: SignalEventWithPost = {
    id: 'evt-1',
    workspace_id: 'ws-1',
    raw_post_id: 'raw-1',
    signal_type: 'keyword_match',
    company_name: null,
    person_name: 'Jane Doe',
    accelerator_name: null,
    batch: null,
    signal_summary: '@janedoe just posted about "building in public": Day 30…',
    confidence: 0.8,
    dedupe_key: 'keyword_match|building-in-public|janedoe|2026-W28',
    status: 'pending',
    created_at: '2026-07-10T12:05:00.000Z',
    updated_at: '2026-07-10T12:05:00.000Z',
    raw_post: {
      id: 'raw-1',
      workspace_id: 'ws-1',
      source_id: 'src-1',
      platform: 'x',
      external_post_id: 'p-1',
      author_handle: 'janedoe',
      author_name: 'Jane Doe',
      content: 'Day 30 of building in public…',
      post_url: 'https://x.com/janedoe/status/p-1',
      posted_at: '2026-07-10T12:00:00.000Z',
      raw_payload: null,
      created_at: '2026-07-10T12:05:00.000Z',
    },
  };

  it('keyword_match cards carry the author x_handle and are reachable', () => {
    const card = normalizeEvent(keywordEvent);
    expect(card.contact?.x_handle).toBe('janedoe');
    expect(isReachable(card)).toBe(true);
  });

  it('non-keyword signal cards keep the name-only (unreachable) contact', () => {
    const card = normalizeEvent({ ...keywordEvent, signal_type: 'funding_round' });
    expect(card.contact?.x_handle).toBeUndefined();
    expect(isReachable(card)).toBe(false);
  });

  it('signalTypeLabel covers keyword_match', () => {
    expect(signalTypeLabel('keyword_match')).toBe('Posted about topic');
  });
});
