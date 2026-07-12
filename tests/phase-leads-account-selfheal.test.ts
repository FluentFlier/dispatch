/**
 * Phase: Leads Unipile account self-heal
 *
 * Unipile re-issues account.id on every LinkedIn session re-auth (~daily), so the
 * unipile_account_id cached in social_accounts 404s and every leads outreach /
 * verification call fails with a spurious "Account not found" until the user
 * reconnects. getLinkedInUnipileAccountId / getWorkspaceLinkedInAccountId now
 * re-resolve the live id by the stable identity (mirroring publish/metrics-sync)
 * and persist it — while falling back to the stored id when Unipile is unreachable
 * so unconfigured environments behave exactly as before.
 *
 * resolveUnipileTarget is stubbed at the module boundary — no live Unipile spend.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/onboarding/import-posts', () => ({
  resolveUnipileTarget: vi.fn(),
}));

import { resolveUnipileTarget } from '@/lib/onboarding/import-posts';
import {
  getLinkedInUnipileAccountId,
  getWorkspaceLinkedInAccountId,
} from '@/lib/signals/outreach/unipile-linkedin';

type Row = { unipile_account_id: string | null; account_id: string | null } | null;

/**
 * Fake InsForge client: the select chain resolves via maybeSingle(), the update
 * chain is awaited directly (ends on .eq). Records update payloads + eq filters.
 */
function makeClient(selectData: Row) {
  const updateCalls: Array<Record<string, unknown>> = [];
  const eqArgs: Array<[string, unknown]> = [];

  const builder: Record<string, unknown> = {
    select: vi.fn(() => builder),
    update: vi.fn((payload: Record<string, unknown>) => {
      updateCalls.push(payload);
      return builder;
    }),
    eq: vi.fn((col: string, val: unknown) => {
      eqArgs.push([col, val]);
      return builder;
    }),
    not: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve({ data: selectData, error: null })),
    // Awaited update chain resolves here.
    then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null }),
  };

  const from = vi.fn(() => builder);
  return {
    client: { database: { from } } as unknown as Parameters<typeof getLinkedInUnipileAccountId>[0],
    updateCalls,
    eqArgs,
  };
}

describe('Phase: Leads Unipile account self-heal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the stored id unchanged and persists nothing when it is still live', async () => {
    vi.mocked(resolveUnipileTarget).mockResolvedValue({
      unipileAccountId: 'acc_stored',
      providerUserIds: ['prov_1'],
      refreshed: false,
    });
    const { client, updateCalls } = makeClient({ unipile_account_id: 'acc_stored', account_id: 'ava-chen' });

    const id = await getLinkedInUnipileAccountId(client, 'user-1');

    expect(id).toBe('acc_stored');
    expect(updateCalls).toHaveLength(0);
  });

  it('heals a rotated id and persists the recovered one back (user scope)', async () => {
    vi.mocked(resolveUnipileTarget).mockResolvedValue({
      unipileAccountId: 'acc_fresh',
      providerUserIds: ['prov_1'],
      refreshed: true,
    });
    const { client, updateCalls, eqArgs } = makeClient({
      unipile_account_id: 'acc_stale',
      account_id: 'ava-chen',
    });

    const id = await getLinkedInUnipileAccountId(client, 'user-1');

    expect(id).toBe('acc_fresh');
    expect(resolveUnipileTarget).toHaveBeenCalledWith('acc_stale', 'ava-chen', 'linkedin');
    expect(updateCalls).toEqual([{ unipile_account_id: 'acc_fresh' }]);
    // Persist targets the exact stale row, scoped by the user.
    expect(eqArgs).toContainEqual(['unipile_account_id', 'acc_stale']);
    expect(eqArgs).toContainEqual(['user_id', 'user-1']);
  });

  it('falls back to the stored id (no regression) when Unipile cannot confirm', async () => {
    vi.mocked(resolveUnipileTarget).mockResolvedValue(null);
    const { client, updateCalls } = makeClient({ unipile_account_id: 'acc_stale', account_id: null });

    const id = await getLinkedInUnipileAccountId(client, 'user-1');

    expect(id).toBe('acc_stale');
    expect(updateCalls).toHaveLength(0);
  });

  it('falls back to the stored id when the heal lookup throws', async () => {
    vi.mocked(resolveUnipileTarget).mockRejectedValue(new Error('unipile down'));
    const { client, updateCalls } = makeClient({ unipile_account_id: 'acc_stale', account_id: 'ava-chen' });

    const id = await getLinkedInUnipileAccountId(client, 'user-1');

    expect(id).toBe('acc_stale');
    expect(updateCalls).toHaveLength(0);
  });

  it('returns null without touching Unipile when no LinkedIn account is connected', async () => {
    const { client } = makeClient(null);

    const id = await getLinkedInUnipileAccountId(client, 'user-1');

    expect(id).toBeNull();
    expect(resolveUnipileTarget).not.toHaveBeenCalled();
  });

  it('heals + persists on the workspace-scoped getter too', async () => {
    vi.mocked(resolveUnipileTarget).mockResolvedValue({
      unipileAccountId: 'acc_fresh',
      providerUserIds: ['prov_1'],
      refreshed: true,
    });
    const { client, updateCalls, eqArgs } = makeClient({
      unipile_account_id: 'acc_stale',
      account_id: 'ava-chen',
    });

    const id = await getWorkspaceLinkedInAccountId(client, 'ws-1');

    expect(id).toBe('acc_fresh');
    expect(updateCalls).toEqual([{ unipile_account_id: 'acc_fresh' }]);
    expect(eqArgs).toContainEqual(['workspace_id', 'ws-1']);
  });
});
