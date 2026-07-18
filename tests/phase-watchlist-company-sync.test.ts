/**
 * Phase: company_page watchlist sync (Task 4)
 *
 * checkProfileChange now also tracks LinkedIn company pages: a changed
 * tagline/name/description against the stored baseline produces a
 * field_change signal (role_change stays person-only). Non-LinkedIn sources
 * are still skipped entirely.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/signals/ingest/unipile-fetch', () => ({ unipileConfigured: vi.fn() }));
vi.mock('@/lib/signals/ingest/workspace-account', () => ({ getWorkspacePollAccount: vi.fn() }));
vi.mock('@/lib/signals/outreach/unipile-linkedin', () => ({
  resolveLinkedInCompany: vi.fn(),
  resolveLinkedInProfile: vi.fn(),
  parseLinkedInPublicIdentifier: (s: string) => s,
}));
vi.mock('@/lib/signals/profile/store', () => ({
  getProfileSnapshot: vi.fn(),
  putProfileSnapshot: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/signals/store', () => ({
  upsertRawPost: vi.fn().mockResolvedValue('rp-1'),
}));
vi.mock('@/lib/signals/leads/intent-bridge', () => ({ applySignalToLeads: vi.fn() }));
vi.mock('@/lib/signals/safety/audit', () => ({ logSignalAudit: vi.fn().mockResolvedValue(undefined) }));

import { unipileConfigured } from '@/lib/signals/ingest/unipile-fetch';
import { getWorkspacePollAccount } from '@/lib/signals/ingest/workspace-account';
import { resolveLinkedInCompany, resolveLinkedInProfile } from '@/lib/signals/outreach/unipile-linkedin';
import { getProfileSnapshot, putProfileSnapshot } from '@/lib/signals/profile/store';
import { applySignalToLeads } from '@/lib/signals/leads/intent-bridge';
import { checkProfileChange } from '@/lib/signals/profile/sync';
import type { SignalSourceRow } from '@/lib/signals/types';

const companySource: SignalSourceRow = {
  id: 'src-co',
  workspace_id: 'ws',
  platform: 'linkedin',
  handle_or_url: 'acme-inc',
  source_type: 'company_page',
  label: 'Acme',
  enabled: true,
  poll_interval_minutes: 30,
  last_polled_at: null,
  cursor_json: null,
  created_at: '',
  updated_at: '',
};

const client = {} as never;

beforeEach(() => {
  vi.mocked(unipileConfigured).mockReturnValue(true);
  vi.mocked(getWorkspacePollAccount).mockResolvedValue({
    userId: 'u1',
    unipileAccountId: 'acc',
    platform: 'linkedin',
  });
  vi.mocked(resolveLinkedInCompany).mockResolvedValue({
    providerId: 'co-pid',
    name: 'Acme Inc',
    tagline: 'New tagline',
    description: undefined,
  });
  vi.mocked(applySignalToLeads).mockResolvedValue({ matched: 1, created: 0 });
});

afterEach(() => vi.clearAllMocks());

describe('checkProfileChange company_page', () => {
  it('applies a field_change signal when company tagline changed vs baseline', async () => {
    vi.mocked(getProfileSnapshot).mockResolvedValue({
      profileKey: 'acme-inc',
      fullName: 'Acme Inc',
      headline: 'Old tagline',
    });

    const res = await checkProfileChange(client, 'ws', companySource);

    expect(res.signalCreated).toBe(true);
    expect(applySignalToLeads).toHaveBeenCalledOnce();
    const classified = vi.mocked(applySignalToLeads).mock.calls[0][2];
    expect(classified.signalType).toBe('field_change');
    expect(putProfileSnapshot).toHaveBeenCalledOnce();
    expect(putProfileSnapshot).toHaveBeenCalledWith(
      client,
      'ws',
      'linkedin',
      expect.objectContaining({ profileKey: 'acme-inc', headline: 'New tagline' }),
    );
  });

  it('baselines silently on first sight', async () => {
    vi.mocked(getProfileSnapshot).mockResolvedValue(null);

    const res = await checkProfileChange(client, 'ws', companySource);

    expect(res.signalCreated).toBe(false);
    expect(applySignalToLeads).not.toHaveBeenCalled();
    expect(putProfileSnapshot).toHaveBeenCalledOnce();
  });

  it('still ignores non-linkedin sources', async () => {
    const xSource: SignalSourceRow = { ...companySource, platform: 'x', source_type: 'account' };

    const res = await checkProfileChange(client, 'ws', xSource);

    expect(res.signalCreated).toBe(false);
    expect(resolveLinkedInCompany).not.toHaveBeenCalled();
    expect(resolveLinkedInProfile).not.toHaveBeenCalled();
    expect(getWorkspacePollAccount).not.toHaveBeenCalled();
  });
});
