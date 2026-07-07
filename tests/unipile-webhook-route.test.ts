/**
 * Tests for POST /api/webhooks/unipile callback payloads.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const upsert = vi.fn().mockResolvedValue({ error: null });
const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });

vi.mock('@/lib/insforge/server', () => ({
  getServiceClient: vi.fn(() => ({
    database: {
      from: vi.fn((table: string) => {
        if (table === 'social_accounts') {
          return { upsert, update };
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          gte: vi.fn().mockReturnThis(),
          lte: vi.fn().mockResolvedValue({ data: [], error: null }),
          upsert,
        };
      }),
    },
  })),
}));

vi.mock('@/lib/social/unipile', () => ({
  fetchUnipileAccountDetails: vi.fn().mockResolvedValue({
    id: 'acc_123',
    type: 'LINKEDIN',
    name: 'Ada Lovelace',
    connection_params: {
      im: {
        username: 'ada',
        publicIdentifier: 'ACoAAExample',
      },
    },
  }),
  mapPlatform: vi.fn((provider: string) => provider.toLowerCase() === 'linkedin' ? 'linkedin' : null),
}));

vi.mock('@/lib/workspace', () => ({
  ensureSoloWorkspace: vi.fn().mockResolvedValue({ id: 'ws_123' }),
}));

function makeRequest(url: string, body: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/webhooks/unipile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRON_SECRET', 'callback-secret');
  });

  it('stores a social account from the documented hosted-auth callback payload', async () => {
    const { POST } = await import('@/app/api/webhooks/unipile/route');
    const res = await POST(makeRequest('http://localhost/api/webhooks/unipile?token=callback-secret', {
      status: 'CREATION_SUCCESS',
      account_id: 'acc_123',
      name: 'user_123',
    }));

    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: 'ws_123',
        user_id: 'user_123',
        platform: 'linkedin',
        unipile_account_id: 'acc_123',
        account_name: 'Ada Lovelace',
        account_id: 'ACoAAExample',
      }),
      { onConflict: 'user_id,platform' },
    );
  });

  it('rejects hosted-auth callbacks with the wrong token in production', async () => {
    const { POST } = await import('@/app/api/webhooks/unipile/route');
    const res = await POST(makeRequest('http://localhost/api/webhooks/unipile?token=wrong', {
      status: 'CREATION_SUCCESS',
      account_id: 'acc_123',
      name: 'user_123',
    }));

    expect(res.status).toBe(401);
    expect(upsert).not.toHaveBeenCalled();
  });
});
