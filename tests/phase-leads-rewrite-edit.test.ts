import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SignalLeadWithContacts, LeadPlaybook } from '@/lib/signals/types';

/**
 * WS1.2 - Regenerate / rewrite-with-instruction / edit for draft and plan.
 *
 * - Rewrite instruction must reach the LLM prompt (draftOutreachForLead).
 * - Plan edit (why / angle / step labels) must merge and persist; step status
 *   toggle must still work; out-of-range step is rejected (applyPlaybookPatch).
 *
 * Every external boundary (LLM voice pipeline, budget gate, voice context, lead
 * store writes) is mocked. No live spend.
 */

// --- Boundary mocks (before importing the SUT) ---
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

import { draftOutreachForLead } from '@/lib/signals/outreach/draft-lead';
import { applyPlaybookPatch } from '@/lib/gtm/nurture/playbook-patch';

// Minimal fake InsForge client: saveLeadDraft does a select().eq().limit() then
// insert(); return no existing row so it takes the insert path.
function makeClient() {
  const inserts: unknown[] = [];
  const database = {
    from() {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.limit = () => Promise.resolve({ data: [] });
      builder.insert = (p: unknown) => {
        inserts.push(p);
        return Promise.resolve({ error: null });
      };
      return builder;
    },
  };
  return { client: { database } as unknown as never, inserts };
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
    tags: ['fintech', 'b2b'],
    intent_flags: { raised: true },
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
  generateWithVoicePipeline.mockResolvedValue({ text: 'A genuine note to Jane.', voice_match_score: 80 });
  loadCreatorVoiceContext.mockResolvedValue({ profile: null, contextAdditions: '' });
  checkAndIncrementUsage.mockResolvedValue('ok');
  updateLead.mockResolvedValue(undefined);
});

afterEach(() => vi.restoreAllMocks());

describe('WS1.2 rewrite-with-instruction reaches the prompt', () => {
  it('injects the rewrite instruction as a constraint block', async () => {
    const { client } = makeClient();
    await draftOutreachForLead(client, 'u1', 'ws1', makeLead(), 'linkedin_connect', {
      rewriteInstruction: 'shorter, more casual',
    });

    expect(generateWithVoicePipeline).toHaveBeenCalledTimes(1);
    const prompt = (generateWithVoicePipeline.mock.calls[0][0] as { userPrompt: string }).userPrompt;
    expect(prompt).toContain('REWRITE INSTRUCTION');
    expect(prompt).toContain('shorter, more casual');
  });

  it('omits the rewrite block on a plain regenerate (no instruction)', async () => {
    const { client } = makeClient();
    await draftOutreachForLead(client, 'u1', 'ws1', makeLead(), 'linkedin_connect');

    const prompt = (generateWithVoicePipeline.mock.calls[0][0] as { userPrompt: string }).userPrompt;
    expect(prompt).not.toContain('REWRITE INSTRUCTION');
  });
});

describe('WS1.2 plan edit + step toggle persist via applyPlaybookPatch', () => {
  const basePlaybook = (): LeadPlaybook => ({
    whyThem: 'Original why',
    angle: 'Original angle',
    steps: [
      { type: 'research', label: 'Research them', dueInDays: 0, status: 'pending' },
      { type: 'comment', label: 'Comment on post', dueInDays: 1, status: 'pending' },
      { type: 'connect', label: 'Send connect', dueInDays: 2, status: 'pending' },
      { type: 'dm', label: 'Follow-up DM', dueInDays: 4, status: 'pending' },
    ],
    generatedAt: new Date().toISOString(),
  });

  it('overwrites why / angle / step labels while keeping step type + status', () => {
    const result = applyPlaybookPatch(basePlaybook(), {
      edit: { whyThem: 'New why', angle: 'New angle', stepLabels: ['R', 'C', 'Connect now', 'DM'] },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.playbook.whyThem).toBe('New why');
    expect(result.playbook.angle).toBe('New angle');
    expect(result.playbook.steps[2].label).toBe('Connect now');
    // Type + status are preserved through a label edit.
    expect(result.playbook.steps[2].type).toBe('connect');
    expect(result.playbook.steps[2].status).toBe('pending');
  });

  it('edits only the provided fields (partial edit keeps the rest)', () => {
    const result = applyPlaybookPatch(basePlaybook(), { edit: { angle: 'Only angle changed' } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.playbook.angle).toBe('Only angle changed');
    expect(result.playbook.whyThem).toBe('Original why');
    expect(result.playbook.steps[0].label).toBe('Research them');
  });

  it('still toggles a single step status', () => {
    const result = applyPlaybookPatch(basePlaybook(), { stepIndex: 1, status: 'done' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.playbook.steps[1].status).toBe('done');
    expect(result.playbook.steps[0].status).toBe('pending');
  });

  it('rejects an out-of-range step index', () => {
    const result = applyPlaybookPatch(basePlaybook(), { stepIndex: 99, status: 'done' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/no such playbook step/i);
  });
});
