import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/insforge/server', () => ({
  getAuthenticatedUser: vi.fn(),
  getServerClient: vi.fn(),
}));
vi.mock('@/lib/crypto', () => ({
  decryptToken: vi.fn((t: string) => `decrypted_${t}`),
}));
vi.mock('@/lib/workspace', () => ({
  getActiveWorkspaceId: vi.fn().mockResolvedValue('ws_123'),
}));
vi.mock('twitter-api-v2', () => ({
  TwitterApi: vi.fn().mockImplementation(() => ({
    v2: {
      userTimeline: vi.fn().mockResolvedValue({
        data: {
          data: [
            { id: 'tweet1', text: 'This is my first original tweet about building products.' },
            { id: 'tweet2', text: 'RT @someone: this is a retweet and should be filtered' },
            { id: 'tweet3', text: '@user this is a reply and should be filtered' },
            { id: 'tweet4', text: 'Another original tweet sharing my thoughts on startups.' },
          ],
        },
      }),
    },
  })),
}));

import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { NextRequest } from 'next/server';

const mockUser = { id: 'user_123' };
const mockAccount = {
  access_token: 'encrypted_token',
  account_id: 'acct_456',
  account_name: 'Test User',
  connection_method: 'oauth',
};

function mockDbChain(data: unknown, error = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
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
    (getAuthenticatedUser as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
    (getServerClient as ReturnType<typeof vi.fn>).mockReturnValue({
      database: { from: vi.fn().mockReturnValue(mockDbChain(mockAccount)) },
    });
  });

  it('returns 401 when not authenticated', async () => {
    (getAuthenticatedUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const { POST } = await import('@/app/api/voice-lab/import-from-account/route');
    const res = await POST(makeRequest({ platform: 'twitter' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid platform', async () => {
    const { POST } = await import('@/app/api/voice-lab/import-from-account/route');
    const res = await POST(makeRequest({ platform: 'reddit' }));
    expect(res.status).toBe(400);
  });

  it('returns 404 when account not connected', async () => {
    (getServerClient as ReturnType<typeof vi.fn>).mockReturnValue({
      database: { from: vi.fn().mockReturnValue(mockDbChain(null)) },
    });
    const { POST } = await import('@/app/api/voice-lab/import-from-account/route');
    const res = await POST(makeRequest({ platform: 'twitter' }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('No connected');
  });

  it('fetches X posts and filters retweets and replies', async () => {
    const { POST } = await import('@/app/api/voice-lab/import-from-account/route');
    const res = await POST(makeRequest({ platform: 'twitter' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.samples).toHaveLength(2);
    expect(body.samples[0].platform).toBe('Twitter/X');
    expect(body.samples.every((s: { content: string }) => !s.content.startsWith('RT @'))).toBe(true);
  });

  it('includes sourceUrl for each X sample', async () => {
    const { POST } = await import('@/app/api/voice-lab/import-from-account/route');
    const res = await POST(makeRequest({ platform: 'twitter' }));
    const body = await res.json();
    expect(body.samples[0].sourceUrl).toMatch(/x\.com\/i\/web\/status/);
  });
});
