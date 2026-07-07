import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SignalLeadWithContacts, LeadCompanyDetail } from '@/lib/signals/types';

/**
 * WS1.4 — Feed scraped company context to the model.
 *
 * - The Algolia hit's long_description + industries are kept at ingest (mapHit).
 * - The draft prompt provably contains company description + headcount + industry.
 * - The rich detail is fetched at most once per lead and reused (no re-scrape).
 * All external boundaries mocked. No live spend.
 */

const generateWithVoicePipeline = vi.fn();
vi.mock('@/lib/voice-pipeline', () => ({
  generateWithVoicePipeline: (...a: unknown[]) => generateWithVoicePipeline(...a),
}));
const loadCreatorVoiceContext = vi.fn();
vi.mock('@/lib/voice-context', () => ({
  loadCreatorVoiceContext: (...a: unknown[]) => loadCreatorVoiceContext(...a),
}));
const checkAndIncrementUsage = vi.fn();
vi.mock('@/lib/ai-budget', () => ({
  checkAndIncrementUsage: (...a: unknown[]) => checkAndIncrementUsage(...a),
}));
const updateLead = vi.fn();
vi.mock('@/lib/signals/leads/store', () => ({
  updateLead: (...a: unknown[]) => updateLead(...a),
}));
// Partial-mock the ingest module: keep the real mapHit, stub only the network fetch.
const fetchYcCompanyDetail = vi.fn();
vi.mock('@/lib/signals/ingest/yc-algolia', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/signals/ingest/yc-algolia')>();
  return { ...actual, fetchYcCompanyDetail: (...a: unknown[]) => fetchYcCompanyDetail(...a) };
});

import { draftOutreachForLead } from '@/lib/signals/outreach/draft-lead';
import { mapHit } from '@/lib/signals/ingest/yc-algolia';

function makeClient() {
  const database = {
    from() {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.limit = () => Promise.resolve({ data: [] });
      builder.insert = () => Promise.resolve({ error: null });
      return builder;
    },
  };
  return { client: { database } as unknown as never };
}

function makeLead(companyDetail: LeadCompanyDetail | null = null): SignalLeadWithContacts {
  return {
    id: 'l1',
    workspace_id: 'ws1',
    source: 'yc_directory',
    external_id: 'acme',
    company_name: 'Acme AI',
    tagline: 'AI for finance teams',
    website: 'https://acme.ai',
    domain: 'acme.ai',
    batch: 'W24',
    tags: ['fintech'],
    intent_flags: {},
    source_fact: {},
    company_detail: companyDetail,
    name_history: [],
    fit_score: 0.8,
    rank_score: 0.9,
    contact_status: 'resolved',
    lead_status: 'new',
    first_seen_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
    digest_date: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    primary_contact: {
      id: 'c1',
      lead_id: 'l1',
      workspace_id: 'ws1',
      name: 'Jane Doe',
      role: 'CEO',
      linkedin_url: 'https://linkedin.com/in/jane',
      x_handle: null,
      email: null,
      provider_id: null,
      resolution_source: 'scraped',
      enriched_via: null,
      is_primary: true,
      created_at: new Date().toISOString(),
    },
  } as SignalLeadWithContacts;
}

beforeEach(() => {
  vi.clearAllMocks();
  generateWithVoicePipeline.mockResolvedValue({ text: 'A note.', voice_match_score: 80 });
  loadCreatorVoiceContext.mockResolvedValue({ profile: null, contextAdditions: '' });
  checkAndIncrementUsage.mockResolvedValue('ok');
  updateLead.mockResolvedValue(undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('WS1.4 mapHit keeps rich context', () => {
  it('keeps long_description and industries instead of discarding them', () => {
    const lead = mapHit({
      slug: 'acme',
      name: 'Acme AI',
      one_liner: 'AI for finance teams',
      long_description: 'Acme builds automated ledgers that reconcile books for fintech startups.',
      industries: ['Fintech', 'B2B'],
    });
    expect(lead).not.toBeNull();
    expect(lead?.longDescription).toContain('automated ledgers');
    expect(lead?.tags).toEqual(['Fintech', 'B2B']);
  });
});

describe('WS1.4 draft prompt carries description + headcount + industry', () => {
  it('injects the fetched company detail into the prompt', async () => {
    fetchYcCompanyDetail.mockResolvedValue({
      slug: 'acme',
      ycUrl: 'https://www.ycombinator.com/companies/acme',
      description: 'Acme builds automated ledgers for fintech startups.',
      teamSize: 12,
      industries: ['Fintech', 'B2B'],
      status: 'Active',
      photos: [],
      founders: [],
    });

    const { client } = makeClient();
    await draftOutreachForLead(client, 'u1', 'ws1', makeLead(null), 'linkedin_connect');

    const prompt = (generateWithVoicePipeline.mock.calls[0][0] as { userPrompt: string }).userPrompt;
    expect(prompt).toContain('automated ledgers'); // description
    expect(prompt).toContain('~12 people'); // headcount
    expect(prompt).toContain('Fintech'); // industry

    // The one-time fetch is persisted with a fetchedAt marker.
    expect(fetchYcCompanyDetail).toHaveBeenCalledTimes(1);
    const persisted = updateLead.mock.calls.find(
      (c) => (c[3] as { company_detail?: LeadCompanyDetail }).company_detail,
    );
    expect(persisted).toBeDefined();
    expect((persisted?.[3] as { company_detail: LeadCompanyDetail }).company_detail.fetchedAt).toBeTruthy();
  });
});

describe('WS1.4 repeat draft does not re-scrape', () => {
  it('reuses persisted detail (fetchedAt present) without calling fetch', async () => {
    const cached: LeadCompanyDetail = {
      description: 'Acme builds automated ledgers for fintech startups.',
      teamSize: 8,
      industries: ['Fintech'],
      status: 'Active',
      fetchedAt: new Date().toISOString(),
    };

    const { client } = makeClient();
    await draftOutreachForLead(client, 'u1', 'ws1', makeLead(cached), 'linkedin_connect');

    // No re-scrape on a lead that already has a full detail.
    expect(fetchYcCompanyDetail).not.toHaveBeenCalled();
    const prompt = (generateWithVoicePipeline.mock.calls[0][0] as { userPrompt: string }).userPrompt;
    expect(prompt).toContain('automated ledgers');
    expect(prompt).toContain('~8 people');
  });
});
