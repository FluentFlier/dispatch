/**
 * Tests for fetchUnipilePostComments (src/lib/engagement/unipile-comments.ts).
 *
 * Covers the threaded fetch: paginated top-level listing, per-parent reply
 * fetch tagged with parent_provider_comment_id, and is_own detection against
 * the account's provider user ids.
 *
 * Platform is 'twitter' throughout so buildPostIdCandidates yields a single
 * candidate and the LinkedIn social_id pre-resolution round-trip is skipped -
 * the threading logic under test is platform independent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/insforge/server', () => ({
  getServerClient: vi.fn(),
}));

vi.mock('@/lib/onboarding/import-posts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/onboarding/import-posts')>()),
  // identityVariants stays REAL - the ownership match is exactly what we assert.
  resolveUnipileTarget: vi.fn(),
}));

import { getServerClient } from '@/lib/insforge/server';
import { resolveUnipileTarget } from '@/lib/onboarding/import-posts';
import { fetchUnipilePostComments } from '@/lib/engagement/unipile-comments';

const SOCIAL_ID = 'tweet-abc'; // no digit run => exactly one post-id candidate

interface CommentPayload {
  id: string;
  text: string;
  author_handle?: string;
  author?: string;
  date?: string;
}

/** page key -> ordered pages. Key is the comment_id ('' for top level). */
type Pages = Record<string, Array<{ items: CommentPayload[]; next_cursor?: string }>>;

let pages: Pages = {};
/** comment ids whose reply fetch should blow up. */
let failingThreads = new Set<string>();
const requestedUrls: string[] = [];

function installFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requestedUrls.push(url);
      const query = new URL(url).searchParams;
      const commentId = query.get('comment_id') ?? '';
      if (failingThreads.has(commentId)) {
        return { ok: false, status: 404, text: async () => 'not found' } as unknown as Response;
      }
      const cursor = query.get('cursor');
      const list = pages[commentId] ?? [{ items: [] }];
      const index = cursor ? Number(cursor) : 0;
      const page = list[index] ?? { items: [] };
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: page.items, next_cursor: page.next_cursor }),
        text: async () => '',
      } as unknown as Response;
    }),
  );
}

function mockClient() {
  return {
    database: {
      from: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { unipile_account_id: 'acc_1', account_id: 'ACoAAOwner' },
          error: null,
        }),
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) }),
      })),
    },
  };
}

/** Sets which provider user ids count as "the account owner". */
function setOwnerIds(providerUserIds: string[]) {
  (resolveUnipileTarget as ReturnType<typeof vi.fn>).mockResolvedValue({
    unipileAccountId: 'acc_1',
    providerUserIds,
    refreshed: false,
  });
}

describe('fetchUnipilePostComments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('UNIPILE_API_KEY', 'test-key');
    vi.stubEnv('UNIPILE_DSN', 'api.unipile.com:443');
    pages = {};
    failingThreads = new Set();
    requestedUrls.length = 0;
    installFetch();
    (getServerClient as ReturnType<typeof vi.fn>).mockReturnValue(mockClient());
    setOwnerIds(['urn:li:person:ACoAAOwner']);
  });

  it('collects every page of the top-level comment listing', async () => {
    pages[''] = [
      { items: [{ id: 'c1', text: 'first' }, { id: 'c2', text: 'second' }], next_cursor: '1' },
      { items: [{ id: 'c3', text: 'third' }] },
    ];

    const comments = await fetchUnipilePostComments('u1', SOCIAL_ID, 'twitter');

    expect(comments.map((c) => c.provider_comment_id)).toEqual(['c1', 'c2', 'c3']);
    // page 1, page 2, then one reply listing per top-level comment
    expect(requestedUrls.some((u) => u.includes('cursor=1'))).toBe(true);
  });

  it('fetches each thread replies with comment_id and tags them with the parent id', async () => {
    pages[''] = [{ items: [{ id: 'c1', text: 'question?' }] }];
    pages['c1'] = [{ items: [{ id: 'r1', text: 'an answer' }] }];

    const comments = await fetchUnipilePostComments('u1', SOCIAL_ID, 'twitter');

    expect(requestedUrls.some((u) => u.includes('comment_id=c1'))).toBe(true);
    const reply = comments.find((c) => c.provider_comment_id === 'r1');
    expect(reply?.parent_provider_comment_id).toBe('c1');
    const parent = comments.find((c) => c.provider_comment_id === 'c1');
    expect(parent?.parent_provider_comment_id).toBeUndefined();
  });

  it("marks the owner's own reply is_own and a stranger's reply not", async () => {
    pages[''] = [{ items: [{ id: 'c1', text: 'question?', author_handle: 'someone-else' }] }];
    pages['c1'] = [
      { items: [
        { id: 'r-own', text: 'thanks!', author_handle: 'ACoAAOwner' },
        { id: 'r-other', text: 'me too', author_handle: 'random-person' },
      ] },
    ];

    const comments = await fetchUnipilePostComments('u1', SOCIAL_ID, 'twitter');
    const byId = new Map(comments.map((c) => [c.provider_comment_id, c]));

    expect(byId.get('r-own')?.is_own).toBe(true);
    expect(byId.get('r-other')?.is_own).toBe(false);
    expect(byId.get('c1')?.is_own).toBe(false);
  });

  it.each([
    ['bare member id', 'ACoAAOwner'],
    ['a LinkedIn URN', 'urn:li:person:ACoAAOwner'],
    ['a different case', 'acoaaowner'],
    ['an @handle', '@ACoAAOwner'],
    ['a /in/ profile url', 'https://www.linkedin.com/in/ACoAAOwner'],
  ])('matches ownership when the comment handle is %s', async (_label, handle) => {
    pages[''] = [{ items: [{ id: 'c1', text: 'my own note', author_handle: handle }] }];

    const [comment] = await fetchUnipilePostComments('u1', SOCIAL_ID, 'twitter');

    expect(comment.is_own).toBe(true);
  });

  it('matches ownership when the stored provider id is a bare id and the URN comes back on the comment', async () => {
    setOwnerIds(['ACoAAOwner']);
    pages[''] = [{ items: [{ id: 'c1', text: 'my own note', author_handle: 'urn:li:person:ACoAAOwner' }] }];

    const [comment] = await fetchUnipilePostComments('u1', SOCIAL_ID, 'twitter');

    expect(comment.is_own).toBe(true);
  });

  it('keeps the rest of the post in sync when one thread reply fetch fails', async () => {
    pages[''] = [{ items: [{ id: 'c-bad', text: 'thread that will not load' }, { id: 'c-ok', text: 'fine' }] }];
    pages['c-ok'] = [{ items: [{ id: 'r-ok', text: 'reply that loads' }] }];
    failingThreads.add('c-bad');

    const comments = await fetchUnipilePostComments('u1', SOCIAL_ID, 'twitter');

    expect(comments.map((c) => c.provider_comment_id).sort()).toEqual(['c-bad', 'c-ok', 'r-ok']);
  });
});
