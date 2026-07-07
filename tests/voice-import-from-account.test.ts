/**
 * Tests for POST /api/voice-lab/import-from-account
 * Uses Unipile to fetch user's own posts for voice tone extraction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/insforge/server', () => ({
  getAuthenticatedUser: vi.fn(),
  getServerClient: vi.fn(),
  getServiceClient: vi.fn(),
}));
vi.mock('@/lib/workspace', () => ({
  ensureActiveWorkspaceId: vi.fn().mockResolvedValue('ws_123'),
  backfillNullWorkspaceSocialAccounts: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/social/unipile', () => ({
  unipoleFetch: vi.fn(),
  fetchUnipileAccountDetails: vi.fn(),
  mapPlatform: vi.fn(),
}));

import { getAuthenticatedUser, getServerClient, getServiceClient } from '@/lib/insforge/server';
import { backfillNullWorkspaceSocialAccounts, ensureActiveWorkspaceId } from '@/lib/workspace';
import { unipoleFetch, fetchUnipileAccountDetails } from '@/lib/social/unipile';
import { NextRequest } from 'next/server';

const mockUser = { id: 'user_123' };
const mockAccount = { unipile_account_id: 'unipile_abc123', account_id: 'ACoAABcDEFgH', account_name: 'Test User' };

const UNIPILE_POSTS_RESPONSE = {
  items: [
    { id: 'post1', text: 'This is an original LinkedIn post about building in public. It has substance.', is_repost: false, is_reply: false },
    { id: 'post2', text: 'This is a repost and should be filtered out.', is_repost: true, is_reply: false },
    { id: 'post3', text: '', is_repost: false, is_reply: false }, // empty - filtered
    { id: 'post4', text: 'A reply to someone else, should be filtered.', is_repost: false, is_reply: true },
    { id: 'post5', text: 'Another original post sharing thoughts on startup growth and product development.', is_repost: false, is_reply: false },
  ],
};

function mockDbChain(data: unknown, error = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
  };
}

function mockServerClient(account: unknown = mockAccount) {
  return {
    database: {
      from: vi.fn((table: string) => {
        if (table === 'social_accounts') return mockDbChain(account);
        if (table === 'publish_jobs') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            insert: vi.fn().mockResolvedValue({ error: null }),
            update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
          };
        }
        if (table === 'posts') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            insert: vi.fn().mockResolvedValue({ error: null }),
          };
        }
        return mockDbChain(null);
      }),
    },
  };
}

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/voice-lab/import-from-account', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/voice-lab/import-from-account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('UNIPILE_API_KEY', 'test-key');
    vi.stubEnv('UNIPILE_DSN', 'api.unipile.com:443');
    (getAuthenticatedUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
    (getServerClient as ReturnType<typeof vi.fn>).mockReturnValue(mockServerClient());
    (getServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mockServerClient());
    (fetchUnipileAccountDetails as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (unipoleFetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(UNIPILE_POSTS_RESPONSE),
      text: vi.fn().mockResolvedValue(''),
    });
  });

  it('returns 401 when not authenticated', async () => {
    (getAuthenticatedUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const { POST } = await import('@/app/api/voice-lab/import-from-account/route');
    const res = await POST(makeRequest({ platform: 'linkedin' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid platform', async () => {
    const { POST } = await import('@/app/api/voice-lab/import-from-account/route');
    const res = await POST(makeRequest({ platform: 'reddit' }));
    expect(res.status).toBe(400);
  });

  it('returns 404 when no Unipile account connected', async () => {
    (getServerClient as ReturnType<typeof vi.fn>).mockReturnValue({
      database: { from: vi.fn().mockReturnValue(mockDbChain(null)) },
    });
    const { POST } = await import('@/app/api/voice-lab/import-from-account/route');
    const res = await POST(makeRequest({ platform: 'linkedin' }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('No connected LinkedIn');
  });

  it('calls Unipile /users/{provider_id}/posts with provider ID in path and unipile ID as query param', async () => {
    const { POST } = await import('@/app/api/voice-lab/import-from-account/route');
    await POST(makeRequest({ platform: 'linkedin' }));
    expect(ensureActiveWorkspaceId).toHaveBeenCalledWith('user_123');
    expect(backfillNullWorkspaceSocialAccounts).toHaveBeenCalledWith('user_123', 'ws_123');
    expect(unipoleFetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/users\/ACoAABcDEFgH\/posts\?account_id=unipile_abc123/),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('returns 404 when account_id (provider user ID) is missing', async () => {
    (getServerClient as ReturnType<typeof vi.fn>).mockReturnValue({
      database: { from: vi.fn().mockReturnValue(mockDbChain({ unipile_account_id: 'unipile_abc123', account_id: null, account_name: 'Test' })) },
    });
    const { POST } = await import('@/app/api/voice-lab/import-from-account/route');
    const res = await POST(makeRequest({ platform: 'linkedin' }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('provider ID');
  });

  it('filters out reposts and replies, returns only original posts', async () => {
    const { POST } = await import('@/app/api/voice-lab/import-from-account/route');
    const res = await POST(makeRequest({ platform: 'linkedin' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // 5 items: 1 repost + 1 empty + 1 reply filtered = 2 original
    expect(body.samples).toHaveLength(2);
    expect(body.count).toBe(2);
  });

  it('labels samples with correct platform name for linkedin', async () => {
    const { POST } = await import('@/app/api/voice-lab/import-from-account/route');
    const res = await POST(makeRequest({ platform: 'linkedin' }));
    const body = await res.json();
    expect(body.samples[0].platform).toBe('LinkedIn');
  });

  it('labels samples with correct platform name for twitter', async () => {
    const { POST } = await import('@/app/api/voice-lab/import-from-account/route');
    const res = await POST(makeRequest({ platform: 'twitter' }));
    const body = await res.json();
    expect(body.samples[0].platform).toBe('Twitter/X');
  });

  it('includes sourceUrl for each sample', async () => {
    const { POST } = await import('@/app/api/voice-lab/import-from-account/route');
    const res = await POST(makeRequest({ platform: 'linkedin' }));
    const body = await res.json();
    expect(body.samples[0].sourceUrl).toContain('linkedin.com');
    expect(body.samples[0].sourceUrl).toContain('post1');
  });

  it('returns 503 when Unipile is not configured', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('UNIPILE_API_KEY', '');
    const { POST } = await import('@/app/api/voice-lab/import-from-account/route');
    const res = await POST(makeRequest({ platform: 'linkedin' }));
    expect(res.status).toBe(503);
  });

  it('returns 502 when Unipile API returns an error', async () => {
    (unipoleFetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      text: vi.fn().mockResolvedValue('Unauthorized'),
    });
    const { POST } = await import('@/app/api/voice-lab/import-from-account/route');
    const res = await POST(makeRequest({ platform: 'linkedin' }));
    expect(res.status).toBe(502);
  });

  it('handles commentary field as fallback for text field', async () => {
    (unipoleFetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        items: [
          { id: 'p1', commentary: 'Post using commentary field not text field.', is_repost: false, is_reply: false },
        ],
      }),
      text: vi.fn().mockResolvedValue(''),
    });
    const { POST } = await import('@/app/api/voice-lab/import-from-account/route');
    const res = await POST(makeRequest({ platform: 'linkedin' }));
    const body = await res.json();
    expect(body.samples[0].content).toBe('Post using commentary field not text field.');
  });

  it('handles content field as fallback for production Unipile post shapes', async () => {
    (unipoleFetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        items: [
          { id: 'p-content', content: 'Post using content field from the provider response.', is_repost: false, is_reply: false },
        ],
      }),
      text: vi.fn().mockResolvedValue(''),
    });
    const { POST } = await import('@/app/api/voice-lab/import-from-account/route');
    const res = await POST(makeRequest({ platform: 'linkedin' }));
    const body = await res.json();
    expect(body.samples[0].content).toBe('Post using content field from the provider response.');
    expect(body.fetchedCount).toBe(1);
  });

  it('returns empty samples array when all posts are filtered', async () => {
    (unipoleFetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        items: [
          { id: 'p1', text: 'short', is_repost: false, is_reply: false }, // under 20 chars
          { id: 'p2', text: 'also repost', is_repost: true, is_reply: false },
        ],
      }),
      text: vi.fn().mockResolvedValue(''),
    });
    const { POST } = await import('@/app/api/voice-lab/import-from-account/route');
    const res = await POST(makeRequest({ platform: 'linkedin' }));
    const body = await res.json();
    expect(body.samples).toHaveLength(0);
    expect(body.count).toBe(0);
    expect(body.fetchedCount).toBe(2);
    expect(body.filteredCount).toBe(2);
  });
});
