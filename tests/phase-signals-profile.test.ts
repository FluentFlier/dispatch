/**
 * Phase: Signals role_change detection
 *
 * Headline diffing turns a tracked LinkedIn profile's title/company change into a
 * role_change signal. First sight records a baseline only; a changed headline vs
 * the baseline produces the signal and lands it on the matching lead via the
 * intent bridge.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Pure detection logic (no mocks needed) ---
import {
  detectRoleChange,
  extractCompanyFromHeadline,
  normalizeHeadline,
} from '@/lib/signals/profile/detect';
import type { ProfileState } from '@/lib/signals/profile/detect';

describe('Phase: role_change detection (pure)', () => {
  const prev: ProfileState = { profileKey: 'jane-doe', headline: 'CTO at Acme', fullName: 'Jane Doe' };

  it('no previous snapshot -> null (baseline only)', () => {
    expect(detectRoleChange(null, { profileKey: 'jane-doe', headline: 'CEO at Acme' })).toBeNull();
  });

  it('unchanged headline -> null (case/space insensitive)', () => {
    expect(detectRoleChange(prev, { profileKey: 'jane-doe', headline: '  cto  AT  acme ' })).toBeNull();
  });

  it('empty new headline -> null (failed fetch is not a change)', () => {
    expect(detectRoleChange(prev, { profileKey: 'jane-doe', headline: '' })).toBeNull();
  });

  it('changed headline -> role_change signal with company + dedupe key', () => {
    const sig = detectRoleChange(prev, {
      profileKey: 'jane-doe',
      headline: 'Co-founder & CEO at NewCo',
      fullName: 'Jane Doe',
    });
    expect(sig).not.toBeNull();
    expect(sig?.signalType).toBe('role_change');
    expect(sig?.personName).toBe('Jane Doe');
    expect(sig?.companyName).toBe('NewCo');
    expect(sig?.dedupeKey).toBe('role_change|jane-doe|co-founder & ceo at newco');
  });

  it('extractCompanyFromHeadline handles "at X" and "@X"', () => {
    expect(extractCompanyFromHeadline('CEO at Stripe')).toBe('Stripe');
    expect(extractCompanyFromHeadline('Building @Ramp')).toBe('Ramp');
    expect(extractCompanyFromHeadline('just vibing')).toBeUndefined();
  });

  it('normalizeHeadline collapses case and whitespace', () => {
    expect(normalizeHeadline('  CEO   at  Acme ')).toBe('ceo at acme');
  });
});

// --- Orchestration (mocked dependencies) ---
vi.mock('@/lib/signals/ingest/unipile-fetch', () => ({ unipileConfigured: vi.fn() }));
vi.mock('@/lib/signals/ingest/workspace-account', () => ({ getWorkspacePollAccount: vi.fn() }));
vi.mock('@/lib/signals/outreach/unipile-linkedin', () => ({
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
import { resolveLinkedInProfile } from '@/lib/signals/outreach/unipile-linkedin';
import { getProfileSnapshot, putProfileSnapshot } from '@/lib/signals/profile/store';
import { upsertRawPost } from '@/lib/signals/store';
import { applySignalToLeads } from '@/lib/signals/leads/intent-bridge';
import { checkProfileChange } from '@/lib/signals/profile/sync';
import type { SignalSourceRow } from '@/lib/signals/types';

const source: SignalSourceRow = {
  id: 'src-1',
  workspace_id: 'ws',
  platform: 'linkedin',
  handle_or_url: 'jane-doe',
  source_type: 'person_profile',
  label: 'Jane',
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
  vi.mocked(resolveLinkedInProfile).mockResolvedValue({
    providerId: 'pid',
    firstName: 'Jane',
    lastName: 'Doe',
    headline: 'CEO at NewCo',
  });
  vi.mocked(applySignalToLeads).mockResolvedValue({ matched: 1, created: 0 });
});

afterEach(() => vi.clearAllMocks());

describe('Phase: role_change orchestration', () => {
  it('first sight: stores baseline, creates no signal', async () => {
    vi.mocked(getProfileSnapshot).mockResolvedValue(null);
    const res = await checkProfileChange(client, 'ws', source);
    expect(res.signalCreated).toBe(false);
    expect(putProfileSnapshot).toHaveBeenCalledOnce();
    expect(applySignalToLeads).not.toHaveBeenCalled();
  });

  it('headline change: applies the signal to leads and updates the snapshot', async () => {
    // fullName matches the current resolved name so only the headline diff fires -
    // detectFieldChanges (Task 4) also diffs fullName/description, and a baseline
    // missing fullName would otherwise fire a second field_change signal here.
    vi.mocked(getProfileSnapshot).mockResolvedValue({
      profileKey: 'jane-doe',
      headline: 'CTO at Acme',
      fullName: 'Jane Doe',
    });
    const res = await checkProfileChange(client, 'ws', source);
    expect(res.signalCreated).toBe(true);
    expect(upsertRawPost).toHaveBeenCalledOnce();
    expect(applySignalToLeads).toHaveBeenCalledOnce();
    expect(putProfileSnapshot).toHaveBeenCalledOnce();
  });

  it('no Unipile: skips entirely (no fetch)', async () => {
    vi.mocked(unipileConfigured).mockReturnValue(false);
    const res = await checkProfileChange(client, 'ws', source);
    expect(res.signalCreated).toBe(false);
    expect(resolveLinkedInProfile).not.toHaveBeenCalled();
  });

  it('non-person source: no-op', async () => {
    const res = await checkProfileChange(client, 'ws', { ...source, source_type: 'company_page' });
    expect(res.signalCreated).toBe(false);
    expect(resolveLinkedInProfile).not.toHaveBeenCalled();
  });
});
