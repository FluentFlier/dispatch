/**
 * Phase: X profile (bio) watchlist snapshots via Apify (Task 5)
 *
 * fetchXProfile fetches a single X user profile through Apify (mirrors the
 * LinkedIn profile-resolve helpers). checkProfileChange branches on
 * platform === 'x' && source_type === 'person_profile' to diff bio against
 * the stored baseline - bio rides the shared `headline` snapshot field, so
 * a bio change fires as `role_change` through the existing person-entity
 * detector.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const actorCall = vi.fn();
const datasetListItems = vi.fn();
const actor = vi.fn(() => ({ call: actorCall }));
const dataset = vi.fn(() => ({ listItems: datasetListItems }));

vi.mock('@/lib/signals/ingest/apify-fetch', () => ({
  createApifyClient: vi.fn(),
}));

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
  createSignalEvent: vi.fn(),
  getEvent: vi.fn(),
  upsertRawPost: vi.fn().mockResolvedValue('rp-1'),
}));
vi.mock('@/lib/signals/actions', () => ({ runSignalActions: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/signals/safety/audit', () => ({ logSignalAudit: vi.fn().mockResolvedValue(undefined) }));

import { createApifyClient } from '@/lib/signals/ingest/apify-fetch';
import { fetchXProfile } from '@/lib/signals/profile/x-profile';
import { getProfileSnapshot, putProfileSnapshot } from '@/lib/signals/profile/store';
import { createSignalEvent, getEvent } from '@/lib/signals/store';
import { runSignalActions } from '@/lib/signals/actions';
import { logSignalAudit } from '@/lib/signals/safety/audit';
import { checkProfileChange } from '@/lib/signals/profile/sync';
import type { SignalSourceRow } from '@/lib/signals/types';

const xSource: SignalSourceRow = {
  id: 'src-x',
  workspace_id: 'ws',
  platform: 'x',
  handle_or_url: 'founderhandle',
  source_type: 'person_profile',
  label: 'Founder',
  enabled: true,
  poll_interval_minutes: 30,
  last_polled_at: null,
  cursor_json: null,
  created_at: '',
  updated_at: '',
};

const client = {} as never;

beforeEach(() => {
  vi.mocked(createApifyClient).mockReturnValue({ actor, dataset } as never);
  actorCall.mockResolvedValue({ defaultDatasetId: 'ds-1' });
  datasetListItems.mockResolvedValue({ items: [] });
  vi.mocked(getEvent).mockResolvedValue({ id: 'e1' } as never);
  delete process.env.X_PROFILE_APIFY_ACTOR;
});

afterEach(() => vi.clearAllMocks());

describe('fetchXProfile', () => {
  it('returns null when APIFY_TOKEN is unset (createApifyClient returns null)', async () => {
    vi.mocked(createApifyClient).mockReturnValue(null);

    const result = await fetchXProfile('founderhandle');

    expect(result).toBeNull();
    expect(actorCall).not.toHaveBeenCalled();
  });

  it('maps the first dataset item, defaulting missing fields to undefined', async () => {
    datasetListItems.mockResolvedValue({
      items: [{ name: 'Jane Founder', bio: 'Building the future' }],
    });

    const result = await fetchXProfile('@founderhandle');

    expect(result).toEqual({ handle: 'founderhandle', name: 'Jane Founder', bio: 'Building the future' });
  });

  it('returns null when the dataset is empty', async () => {
    datasetListItems.mockResolvedValue({ items: [] });

    const result = await fetchXProfile('founderhandle');

    expect(result).toBeNull();
  });

  it('uses X_PROFILE_APIFY_ACTOR when set, else the apidojo default', async () => {
    process.env.X_PROFILE_APIFY_ACTOR = 'custom/actor';
    datasetListItems.mockResolvedValue({ items: [{ name: 'Jane' }] });

    await fetchXProfile('founderhandle');

    expect(actor).toHaveBeenCalledWith('custom/actor');
  });
});

describe('checkProfileChange x person_profile', () => {
  it('creates role_change event when bio changed vs baseline', async () => {
    vi.mocked(getProfileSnapshot).mockResolvedValue({
      profileKey: 'founderhandle',
      fullName: 'Jane Founder',
      headline: 'Old bio',
    });
    datasetListItems.mockResolvedValue({
      items: [{ name: 'Jane Founder', bio: 'New bio' }],
    });
    vi.mocked(createSignalEvent).mockResolvedValue({ created: true, eventId: 'e1' });

    const res = await checkProfileChange(client, 'ws', xSource, []);

    expect(res.signalCreated).toBe(true);
    expect(createSignalEvent).toHaveBeenCalledOnce();
    const classified = vi.mocked(createSignalEvent).mock.calls[0][3];
    expect(classified.signalType).toBe('role_change');
    expect(runSignalActions).toHaveBeenCalledOnce();
    expect(putProfileSnapshot).toHaveBeenCalledWith(
      client,
      'ws',
      'x',
      expect.objectContaining({ profileKey: 'founderhandle', headline: 'New bio' }),
    );
  });

  it('baselines silently on first sight', async () => {
    vi.mocked(getProfileSnapshot).mockResolvedValue(null);
    datasetListItems.mockResolvedValue({
      items: [{ name: 'Jane Founder', bio: 'Some bio' }],
    });

    const res = await checkProfileChange(client, 'ws', xSource, []);

    expect(res.signalCreated).toBe(false);
    expect(createSignalEvent).not.toHaveBeenCalled();
    expect(putProfileSnapshot).toHaveBeenCalledOnce();
  });

  it('logs and skips when fetchXProfile returns null (no APIFY_TOKEN)', async () => {
    vi.mocked(createApifyClient).mockReturnValue(null);

    const res = await checkProfileChange(client, 'ws', xSource, []);

    expect(res.signalCreated).toBe(false);
    expect(logSignalAudit).toHaveBeenCalledOnce();
    expect(putProfileSnapshot).not.toHaveBeenCalled();
  });
});
