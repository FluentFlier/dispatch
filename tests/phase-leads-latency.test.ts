import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SignalLeadWithContacts } from '@/lib/signals/types';
import { withTimeout } from '@/lib/util/timeout';

/**
 * WS1.3 — Latency budget for plan + draft.
 *
 * We cannot measure a live model (cost rule), so we assert the levers that cut
 * wall-clock:
 *   - the interactive draft uses the FAST pipeline (base + light humanize, no
 *     evaluate/revise loop); polish opts into the full loop;
 *   - the plan's best-effort post fetch is time-boxed (withTimeout);
 *   - latency is instrumented (logged) for both paths.
 * Every external boundary is mocked. No live spend.
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

import { draftOutreachForLead, draftPipelineOptions } from '@/lib/signals/outreach/draft-lead';

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

function makeLead(): SignalLeadWithContacts {
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

describe('WS1.3 draftPipelineOptions', () => {
  it('interactive default is the fast path (no evaluate/revise loop)', () => {
    expect(draftPipelineOptions(false)).toEqual({
      fast: true,
      maxIterations: 1,
      humanizeAlways: true,
      skipHooks: true,
    });
  });

  it('polish opts into the full quality loop', () => {
    expect(draftPipelineOptions(true)).toEqual({
      fast: false,
      maxIterations: 2,
      humanizeAlways: true,
      skipHooks: true,
    });
  });
});

describe('WS1.3 draftOutreachForLead threads the fast path + logs latency', () => {
  it('uses fast:true for the interactive first render', async () => {
    const { client } = makeClient();
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    await draftOutreachForLead(client, 'u1', 'ws1', makeLead(), 'linkedin_connect');

    const opts = generateWithVoicePipeline.mock.calls[0][0] as { fast: boolean; maxIterations: number };
    expect(opts.fast).toBe(true);
    expect(opts.maxIterations).toBe(1);
    // Latency instrumented.
    expect(infoSpy.mock.calls.some((c) => String(c[0]).includes('[latency] lead-draft'))).toBe(true);
  });

  it('uses the full loop when polish is set', async () => {
    const { client } = makeClient();
    await draftOutreachForLead(client, 'u1', 'ws1', makeLead(), 'linkedin_connect', { polish: true });

    const opts = generateWithVoicePipeline.mock.calls[0][0] as { fast: boolean; maxIterations: number };
    expect(opts.fast).toBe(false);
    expect(opts.maxIterations).toBe(2);
  });
});

describe('WS1.3 withTimeout time-boxes best-effort work', () => {
  it('returns the value when it settles inside the budget', async () => {
    const fast = Promise.resolve('post');
    await expect(withTimeout(fast, 100, null)).resolves.toBe('post');
  });

  it('falls back when the work exceeds the budget', async () => {
    const slow = new Promise<string>((r) => setTimeout(() => r('post'), 60));
    await expect(withTimeout(slow, 10, null)).resolves.toBeNull();
  });

  it('falls back on rejection instead of throwing', async () => {
    const failing = Promise.reject(new Error('boom'));
    await expect(withTimeout(failing, 100, null)).resolves.toBeNull();
  });
});
