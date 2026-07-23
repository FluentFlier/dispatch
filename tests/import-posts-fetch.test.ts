/**
 * Tests for fetchPostsFromUnipile (src/lib/onboarding/import-posts.ts).
 *
 * The filter is now is_reply ONLY: a repost carries the creator's own commentary
 * and that commentary is their voice, so reposts are kept. A bare reshare with no
 * commentary still falls out via the <=20 char length guard.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/social/unipile', () => ({
  unipoleFetch: vi.fn(),
  fetchUnipileAccountDetails: vi.fn(),
  listUnipileAccounts: vi.fn(),
  mapPlatform: vi.fn(),
}));

import { unipoleFetch } from '@/lib/social/unipile';
import { fetchPostsFromUnipile } from '@/lib/onboarding/import-posts';

const fetchMock = unipoleFetch as ReturnType<typeof vi.fn>;

/** Queues one Unipile page response per call, in order. */
function queuePages(...pages: Array<Record<string, unknown>>) {
  fetchMock.mockReset();
  for (const page of pages) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue(page),
      text: vi.fn().mockResolvedValue(''),
    });
  }
}

const LONG = 'A post long enough to clear the twenty character minimum.';

describe('fetchPostsFromUnipile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('imports a repost that carries the creator commentary', async () => {
    queuePages({
      items: [
        { id: 'repost-1', text: `My take on this: ${LONG}`, is_repost: true, is_reply: false },
      ],
    });

    const result = await fetchPostsFromUnipile('provider-1', 'unipile-1', 'linkedin');

    expect(result.samples).toHaveLength(1);
    expect(result.samples[0].content).toContain('My take on this');
    expect(result.samples[0].platform).toBe('LinkedIn');
    expect(result.rawItems).toHaveLength(1);
    expect(result.filteredCount).toBe(0);
  });

  it('drops a bare reshare with no (or too little) commentary', async () => {
    queuePages({
      items: [
        { id: 'bare-repost', text: '', is_repost: true, is_reply: false },
        { id: 'short-repost', text: 'nice', is_repost: true, is_reply: false },
        { id: 'kept', text: LONG, is_repost: true, is_reply: false },
      ],
    });

    const result = await fetchPostsFromUnipile('provider-1', 'unipile-1', 'linkedin');

    expect(result.samples.map((s) => s.sourceUrl)).toEqual([
      expect.stringContaining('kept'),
    ]);
    expect(result.filteredCount).toBe(2);
  });

  it('drops replies - they are conversation, not posts', async () => {
    queuePages({
      items: [
        { id: 'reply-1', text: `A long thoughtful reply. ${LONG}`, is_repost: false, is_reply: true },
        { id: 'post-1', text: LONG, is_repost: false, is_reply: false },
      ],
    });

    const result = await fetchPostsFromUnipile('provider-1', 'unipile-1', 'linkedin');

    expect(result.samples).toHaveLength(1);
    expect(result.samples[0].sourceUrl).toContain('post-1');
    expect(result.filteredCount).toBe(1);
  });

  it('counts exactly the dropped items in filteredCount', async () => {
    queuePages({
      items: [
        { id: 'a', text: LONG, is_repost: false, is_reply: false },   // kept
        { id: 'b', text: LONG, is_repost: true, is_reply: false },    // kept (repost w/ commentary)
        { id: 'c', text: LONG, is_repost: false, is_reply: true },    // dropped: reply
        { id: 'd', text: 'too short', is_repost: false, is_reply: false }, // dropped: length
        { id: 'e', text: '', is_repost: false, is_reply: false },     // dropped: empty
      ],
    });

    const result = await fetchPostsFromUnipile('provider-1', 'unipile-1', 'linkedin');

    expect(result.fetchedCount).toBe(5);
    expect(result.samples).toHaveLength(2);
    expect(result.filteredCount).toBe(3);
  });

  it('follows next_cursor across pages and stops when the cursor is absent', async () => {
    queuePages(
      {
        items: [{ id: 'p1', text: LONG, is_repost: false, is_reply: false }],
        next_cursor: 'CURSOR_2',
      },
      {
        items: [{ id: 'p2', text: LONG, is_repost: false, is_reply: false }],
      },
    );

    const result = await fetchPostsFromUnipile('provider-1', 'unipile-1', 'linkedin');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).not.toContain('cursor=');
    expect(fetchMock.mock.calls[1][0]).toContain('cursor=CURSOR_2');
    expect(result.samples).toHaveLength(2);
    expect(result.fetchedCount).toBe(2);
  });

  it('falls back to the legacy `cursor` field when next_cursor is absent', async () => {
    queuePages(
      {
        items: [{ id: 'p1', text: LONG, is_repost: false, is_reply: false }],
        cursor: 'LEGACY_CURSOR',
      },
      { items: [] },
    );

    await fetchPostsFromUnipile('provider-1', 'unipile-1', 'linkedin');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toContain('cursor=LEGACY_CURSOR');
  });

  it('caps the result at maxPosts and stops paginating', async () => {
    queuePages({
      items: Array.from({ length: 5 }, (_, i) => ({
        id: `p${i}`,
        text: LONG,
        is_repost: false,
        is_reply: false,
      })),
      next_cursor: 'MORE',
    });

    const result = await fetchPostsFromUnipile('provider-1', 'unipile-1', 'linkedin', 2);

    expect(result.samples).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
