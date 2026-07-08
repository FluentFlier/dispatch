/**
 * Phase: Leads quality fixes - Unipile verify-at-resolve
 *
 * A contact's LinkedIn URL is read straight from source data (YC / TinyFish /
 * Apify) and can be stale and 404. verifyContactLinkedIn confirms it against the
 * workspace's connected Unipile account with ONE people-search call at resolve
 * time, writing linkedin_verified. It must never block resolution: no connected
 * account or a not-found result leaves the contact unverified, not unresolved.
 *
 * All Unipile calls are stubbed at the module boundary - no live spend.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/signals/outreach/unipile-linkedin', () => ({
  getWorkspaceLinkedInAccountId: vi.fn(),
  searchLinkedInPerson: vi.fn(),
}));

import {
  getWorkspaceLinkedInAccountId,
  searchLinkedInPerson,
} from '@/lib/signals/outreach/unipile-linkedin';
import { verifyContactLinkedIn } from '@/lib/signals/leads/resolve-contact';

/** Minimal fake InsForge client capturing the contacts-row update payload. */
function makeClient() {
  const eq = vi.fn().mockResolvedValue({ data: null, error: null });
  const update = vi.fn((_payload: Record<string, unknown>) => ({ eq }));
  const from = vi.fn(() => ({ update }));
  return {
    client: { database: { from } } as unknown as Parameters<typeof verifyContactLinkedIn>[0],
    update,
    eq,
    from,
  };
}

const CONTACT = { id: 'c1', name: 'Ava Chen', linkedin_url: 'https://www.linkedin.com/in/ava-chen' };

describe('Phase: Leads quality fixes - verifyContactLinkedIn', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets linkedin_verified=true + a timestamp only when Unipile confirms the person', async () => {
    vi.mocked(getWorkspaceLinkedInAccountId).mockResolvedValue('acc_1');
    vi.mocked(searchLinkedInPerson).mockResolvedValue({
      name: 'Ava Chen',
      role: 'CEO',
      linkedinUrl: 'https://www.linkedin.com/in/ava-chen',
    });
    const { client, update } = makeClient();

    const verified = await verifyContactLinkedIn(client, 'ws-1', CONTACT, 'Flux Labs');

    expect(verified).toBe(true);
    expect(searchLinkedInPerson).toHaveBeenCalledTimes(1);
    expect(searchLinkedInPerson).toHaveBeenCalledWith({
      name: 'Ava Chen',
      company: 'Flux Labs',
      accountId: 'acc_1',
    });
    expect(update).toHaveBeenCalledTimes(1);
    const payload = update.mock.calls[0][0];
    expect(payload.linkedin_verified).toBe(true);
    expect(typeof payload.linkedin_verified_at).toBe('string');
  });

  it('leaves linkedin_verified=false (never blocks) when Unipile finds nobody', async () => {
    vi.mocked(getWorkspaceLinkedInAccountId).mockResolvedValue('acc_1');
    vi.mocked(searchLinkedInPerson).mockResolvedValue(null);
    const { client, update } = makeClient();

    const verified = await verifyContactLinkedIn(client, 'ws-1', CONTACT, 'Flux Labs');

    expect(verified).toBe(false);
    const payload = update.mock.calls[0][0];
    expect(payload.linkedin_verified).toBe(false);
    expect(payload.linkedin_verified_at).toBeNull();
  });

  it('does not call Unipile search and writes nothing when no LinkedIn account is connected', async () => {
    vi.mocked(getWorkspaceLinkedInAccountId).mockResolvedValue(null);
    const { client, update } = makeClient();

    const verified = await verifyContactLinkedIn(client, 'ws-1', CONTACT, 'Flux Labs');

    expect(verified).toBe(false);
    expect(searchLinkedInPerson).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('returns false without touching Unipile when the contact has no LinkedIn URL', async () => {
    const { client } = makeClient();
    const verified = await verifyContactLinkedIn(
      client,
      'ws-1',
      { id: 'c2', name: 'No URL', linkedin_url: null },
      'Flux Labs',
    );
    expect(verified).toBe(false);
    expect(getWorkspaceLinkedInAccountId).not.toHaveBeenCalled();
  });

  it('degrades to unverified (false) when the Unipile search throws, never rethrowing into resolve', async () => {
    vi.mocked(getWorkspaceLinkedInAccountId).mockResolvedValue('acc_1');
    vi.mocked(searchLinkedInPerson).mockRejectedValue(new Error('unipile down'));
    const { client, update } = makeClient();

    const verified = await verifyContactLinkedIn(client, 'ws-1', CONTACT, 'Flux Labs');

    expect(verified).toBe(false);
    const payload = update.mock.calls[0][0];
    expect(payload.linkedin_verified).toBe(false);
  });
});
