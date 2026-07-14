import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SignalLeadWithContacts } from '@/lib/signals/types';

/**
 * WS1.5 - Edit-feedback loop.
 *
 * - recordOutreachEdit stores the model -> user-edited pair only on a real change.
 * - loadEditStyleGuidance returns compact Before -> After few-shot lines.
 * - After edits exist for a workspace, the next draft prompt carries a
 *   "STYLE LEARNED FROM YOUR PAST EDITS" block reflecting them.
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
const fetchYcCompanyDetail = vi.fn();
vi.mock('@/lib/signals/ingest/yc-algolia', () => ({
  fetchYcCompanyDetail: (...a: unknown[]) => fetchYcCompanyDetail(...a),
}));

import { recordOutreachEdit, loadEditStyleGuidance } from '@/lib/signals/outreach/edit-feedback';
import { draftOutreachForLead } from '@/lib/signals/outreach/draft-lead';

/** Table-aware fake client: selects resolve `tables[name]`, inserts are recorded. */
function makeClient(tables: Record<string, unknown[]> = {}) {
  const inserts: Array<{ table: string; payload: unknown }> = [];
  const database = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = () => builder;
      builder.order = () => builder;
      builder.limit = () => Promise.resolve({ data: tables[table] ?? [] });
      builder.maybeSingle = async () => ({ data: (tables[table] ?? [])[0] ?? null });
      builder.insert = (p: unknown) => {
        inserts.push({ table, payload: p });
        return Promise.resolve({ error: null });
      };
      builder.update = () => ({ eq: () => Promise.resolve({ error: null }) });
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
    tags: ['fintech'],
    intent_flags: {},
    source_fact: {},
    company_detail: null,
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
  fetchYcCompanyDetail.mockResolvedValue(null);
});

afterEach(() => vi.restoreAllMocks());

describe('WS1.5 recordOutreachEdit captures only real changes', () => {
  it('stores a workspace-scoped edit when the user changed the draft', async () => {
    const { client, inserts } = makeClient();
    const wrote = await recordOutreachEdit(client, 'ws1', 'l1', 'Model draft here', 'User edited version');
    expect(wrote).toBe(true);
    const row = inserts.find((i) => i.table === 'signal_outreach_edits');
    expect(row).toBeDefined();
    const payload = row?.payload as Record<string, unknown>;
    expect(payload.workspace_id).toBe('ws1');
    expect(payload.original_text).toBe('Model draft here');
    expect(payload.edited_text).toBe('User edited version');
  });

  it('does NOT store when the text is unchanged', async () => {
    const { client, inserts } = makeClient();
    const wrote = await recordOutreachEdit(client, 'ws1', 'l1', 'Same text', 'Same text');
    expect(wrote).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it('does NOT store when the edited text is empty', async () => {
    const { client, inserts } = makeClient();
    const wrote = await recordOutreachEdit(client, 'ws1', 'l1', 'Model draft', '   ');
    expect(wrote).toBe(false);
    expect(inserts).toHaveLength(0);
  });
});

describe('WS1.5 loadEditStyleGuidance formats few-shot lines', () => {
  it('returns Before -> After lines for the workspace', async () => {
    const { client } = makeClient({
      signal_outreach_edits: [
        { original_text: 'Formal long intro', edited_text: 'hey quick note' },
        { original_text: 'Another generic line', edited_text: 'punchier line' },
      ],
    });
    const guidance = await loadEditStyleGuidance(client, 'ws1', 3);
    expect(guidance).toHaveLength(2);
    expect(guidance[0]).toContain('Formal long intro');
    expect(guidance[0]).toContain('hey quick note');
  });
});

describe('WS1.5 draft prompt reflects the edit history', () => {
  it('includes a STYLE LEARNED block after the workspace has edits', async () => {
    const { client } = makeClient({
      signal_outreach_edits: [
        { original_text: 'Overly formal AI-sounding paragraph.', edited_text: 'short and casual, first-name only' },
      ],
    });

    await draftOutreachForLead(client, 'u1', 'ws1', makeLead(), 'linkedin_connect');

    const prompt = (generateWithVoicePipeline.mock.calls[0][0] as { userPrompt: string }).userPrompt;
    expect(prompt).toContain('STYLE LEARNED FROM YOUR PAST EDITS');
    expect(prompt).toContain('short and casual, first-name only');
  });

  it('omits the STYLE LEARNED block when the workspace has no edits', async () => {
    const { client } = makeClient({ signal_outreach_edits: [] });

    await draftOutreachForLead(client, 'u1', 'ws1', makeLead(), 'linkedin_connect');

    const prompt = (generateWithVoicePipeline.mock.calls[0][0] as { userPrompt: string }).userPrompt;
    expect(prompt).not.toContain('STYLE LEARNED FROM YOUR PAST EDITS');
  });
});
