/**
 * Tests for POST /api/webhooks/unipile callback payloads.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const upsert = vi.fn().mockResolvedValue({ error: null });
const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
const snapshotDelete = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });

// Reconfigurable ownership-guard state (reset in beforeEach).
let otherOwners: Array<{ user_id: string; unipile_account_id?: string | null; account_id?: string | null }> = [];
// created_at is required: a snapshot is a time-boxed bind permit, and the route
// refuses (fails closed) on a missing or expired timestamp. The live column is
// NOT NULL DEFAULT now(), so a snapshot without one never exists in practice.
let pendingSnapshot: { account_ids: string[]; created_at?: string } | null = {
  account_ids: [],
  created_at: new Date().toISOString(),
};

vi.mock('@/lib/insforge/server', () => ({
  getServiceClient: vi.fn(() => ({
    database: {
      from: vi.fn((table: string) => {
        if (table === 'social_accounts') {
          return {
            upsert,
            update,
            // Ownership guard: which accounts other users already own.
            select: vi.fn().mockReturnValue({
              neq: vi.fn().mockResolvedValue({ data: otherOwners, error: null }),
            }),
          };
        }
        if (table === 'unipile_connect_snapshots') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: pendingSnapshot, error: null }),
              }),
            }),
            delete: snapshotDelete,
          };
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
  pruneDuplicateUnipileAccounts: vi.fn().mockResolvedValue(0),
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
    // Default: fresh connect - snapshot present, account is new, unclaimed.
    otherOwners = [];
    pendingSnapshot = { account_ids: [], created_at: new Date().toISOString() };
  });

  it('stores a social account from the documented hosted-auth callback payload', async () => {
    const { POST } = await import('@/app/api/webhooks/unipile/route');
    const res = await POST(makeRequest('http://localhost/api/webhooks/unipile?token=callback-secret', {
      status: 'CREATION_SUCCESS',
      account_id: 'acc_123',
      name: '11111111-1111-4111-8111-111111111111',
    }));

    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: 'ws_123',
        user_id: '11111111-1111-4111-8111-111111111111',
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
      name: '11111111-1111-4111-8111-111111111111',
    }));

    expect(res.status).toBe(401);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('refuses to bind when no pending connect snapshot exists (shared-key cross-wire guard)', async () => {
    pendingSnapshot = null;
    const { POST } = await import('@/app/api/webhooks/unipile/route');
    const res = await POST(makeRequest('http://localhost/api/webhooks/unipile?token=callback-secret', {
      status: 'RECONNECTED',
      account_id: 'acc_123',
      name: '11111111-1111-4111-8111-111111111111',
    }));

    expect(res.status).toBe(200);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('prefers the signed state over the display name for the user id', async () => {
    // `name` is documented as a display label; `state` is the field that exists
    // to carry the user id. If anything ever relabels the account, a bind must
    // not follow `name` to a wrong-but-plausible id.
    const { POST } = await import('@/app/api/webhooks/unipile/route');
    const res = await POST(makeRequest('http://localhost/api/webhooks/unipile?token=callback-secret', {
      status: 'CREATION_SUCCESS',
      account_id: 'acc_123',
      name: 'Ada Lovelace',
      state: '11111111-1111-4111-8111-111111111111',
    }));

    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalled();
  });

  it('refuses a hosted callback whose identity is not a user id', async () => {
    // Neither field is a uuid: this is not one of our hosted links, so binding
    // on it would write garbage into user_id.
    const { POST } = await import('@/app/api/webhooks/unipile/route');
    const res = await POST(makeRequest('http://localhost/api/webhooks/unipile?token=callback-secret', {
      status: 'CREATION_SUCCESS',
      account_id: 'acc_123',
      name: 'Ada Lovelace',
    }));

    expect(res.status).toBe(200);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('refuses to bind on an expired connect snapshot (no login happened)', async () => {
    // The reported bug: click Connect, abandon the LinkedIn login, and the
    // permit used to live forever - a later account appearing in the shared
    // tenant bound silently and the UI showed "Connected as <name>" with no
    // authentication. An aged permit must be refused and cleared.
    pendingSnapshot = {
      account_ids: [],
      created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    };
    const { POST } = await import('@/app/api/webhooks/unipile/route');
    const res = await POST(makeRequest('http://localhost/api/webhooks/unipile?token=callback-secret', {
      status: 'CREATION_SUCCESS',
      account_id: 'acc_123',
      name: '11111111-1111-4111-8111-111111111111',
    }));

    expect(res.status).toBe(200);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('refuses to bind an account that pre-existed the user connect', async () => {
    // account already present before this user connected
    pendingSnapshot = { account_ids: ['acc_123'], created_at: new Date().toISOString() };
    const { POST } = await import('@/app/api/webhooks/unipile/route');
    const res = await POST(makeRequest('http://localhost/api/webhooks/unipile?token=callback-secret', {
      status: 'CREATION_SUCCESS',
      account_id: 'acc_123',
      name: '11111111-1111-4111-8111-111111111111',
    }));

    expect(res.status).toBe(200);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('refuses to bind an account already owned by another user', async () => {
    otherOwners = [{ user_id: 'someone_else', unipile_account_id: 'acc_123', account_id: null }];
    const { POST } = await import('@/app/api/webhooks/unipile/route');
    const res = await POST(makeRequest('http://localhost/api/webhooks/unipile?token=callback-secret', {
      status: 'CREATION_SUCCESS',
      account_id: 'acc_123',
      name: '11111111-1111-4111-8111-111111111111',
    }));

    expect(res.status).toBe(200);
    expect(upsert).not.toHaveBeenCalled();
  });
});
