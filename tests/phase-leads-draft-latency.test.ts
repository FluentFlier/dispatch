/**
 * Phase: Leads quality fixes - cold draft latency
 *
 * A cold first "Draft message" ran near the top of the 10-20s cap. Two
 * guarantees keep it in budget without dropping personalization:
 *  - the interactive first draft uses the FAST path (no evaluate/revise loop),
 *    not the heavy voice+critique loop (that is opt-in via Polish);
 *  - the one-time company-detail fetch is time-boxed and reused, so a slow YC
 *    page never blocks generation and the NEXT draft is instant.
 *
 * All external calls (YC fetch, updateLead) are mocked - no live spend.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/signals/ingest/yc-algolia', () => ({
  fetchYcCompanyDetail: vi.fn(),
}));
vi.mock('@/lib/signals/leads/store', () => ({
  updateLead: vi.fn().mockResolvedValue(undefined),
}));

import { fetchYcCompanyDetail } from '@/lib/signals/ingest/yc-algolia';
import { updateLead } from '@/lib/signals/leads/store';
import {
  draftPipelineOptions,
  ensureLeadCompanyDetail,
} from '@/lib/signals/outreach/draft-lead';
import type { SignalLeadWithContacts } from '@/lib/signals/types';

const dummyClient = {} as unknown as Parameters<typeof ensureLeadCompanyDetail>[0];

function ycLead(detail: SignalLeadWithContacts['company_detail']): SignalLeadWithContacts {
  return {
    id: 'l1',
    workspace_id: 'ws-1',
    source: 'yc_directory',
    external_id: 'flux',
    company_name: 'Flux Labs',
    company_detail: detail,
  } as SignalLeadWithContacts;
}

describe('Phase: Leads quality fixes - draft pipeline options (fast path on first draft)', () => {
  it('uses the FAST path (no heavy loop) for a first/regenerate draft', () => {
    const pipe = draftPipelineOptions(false);
    expect(pipe.fast).toBe(true);
    expect(pipe.maxIterations).toBe(1);
  });

  it('only runs the heavy voice+critique loop when Polish is explicitly requested', () => {
    const pipe = draftPipelineOptions(true);
    expect(pipe.fast).toBe(false);
    expect(pipe.maxIterations).toBeGreaterThan(1);
  });
});

describe('Phase: Leads quality fixes - ensureLeadCompanyDetail is reused + time-boxed', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it('reuses persisted detail without any fetch once fetchedAt is set (next draft is instant)', async () => {
    const persisted = {
      description: 'Realtime analytics',
      industries: ['AI'],
      teamSize: 8,
      fetchedAt: '2026-07-07T00:00:00Z',
    };
    const detail = await ensureLeadCompanyDetail(dummyClient, 'ws-1', ycLead(persisted));
    expect(detail).toEqual(persisted);
    expect(fetchYcCompanyDetail).not.toHaveBeenCalled();
    expect(updateLead).not.toHaveBeenCalled();
  });

  it('falls back to the seed detail (and does not persist) when a cold YC fetch exceeds the time box', async () => {
    // Fetch never resolves: the time box must win and the draft proceeds on the
    // seed/tagline context rather than blocking on the slow page.
    vi.mocked(fetchYcCompanyDetail).mockReturnValue(new Promise(() => {}) as never);
    const seed = { description: 'Realtime analytics', industries: ['AI'] }; // no fetchedAt

    vi.useFakeTimers();
    const pending = ensureLeadCompanyDetail(dummyClient, 'ws-1', ycLead(seed));
    // Advance past the time box so withTimeout resolves to the fallback.
    await vi.advanceTimersByTimeAsync(3000);
    const detail = await pending;

    expect(fetchYcCompanyDetail).toHaveBeenCalledTimes(1);
    expect(detail).toEqual(seed); // fell back to the persisted seed detail
    expect(updateLead).not.toHaveBeenCalled(); // nothing new to persist on timeout
  });

  it('does not fetch for a non-YC lead (no detail page to complete from)', async () => {
    const lead = { ...ycLead({ description: 'x' }), source: 'product_hunt' } as SignalLeadWithContacts;
    const detail = await ensureLeadCompanyDetail(dummyClient, 'ws-1', lead);
    expect(fetchYcCompanyDetail).not.toHaveBeenCalled();
    expect(detail).toEqual({ description: 'x' });
  });
});
