/**
 * Phase: Leads watchlist dedup - send-path wiring (Task 10)
 *
 * Verifies sendLeadOutreach's duplicate-contact guard: checkPriorContact runs
 * before assertOutreachAllowed, auto-mode always blocks a contacted-elsewhere
 * lead, manual mode blocks unless overrideDuplicate is set, DNC is never
 * overridable, and a prior contact on THIS SAME lead (the connect -> DM
 * follow-up sequence) is exempt from the block.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SignalLeadWithContacts } from '@/lib/signals/types';

// --- Boundary mocks (declared before importing the SUT) ---

const checkPriorContact = vi.fn();
vi.mock('@/lib/signals/outreach/prior-contact', () => ({
  checkPriorContact: (...args: unknown[]) => checkPriorContact(...args),
}));

const assertOutreachAllowed = vi.fn();
const assertLinkedInProfileLookupAllowed = vi.fn();
vi.mock('@/lib/signals/safety', () => ({
  assertOutreachAllowed: (...a: unknown[]) => assertOutreachAllowed(...a),
  assertLinkedInProfileLookupAllowed: (...a: unknown[]) => assertLinkedInProfileLookupAllowed(...a),
}));

const awaitInterCallDelay = vi.fn();
vi.mock('@/lib/signals/safety/humanize', () => ({
  awaitInterCallDelay: (...a: unknown[]) => awaitInterCallDelay(...a),
}));

const logSignalAudit = vi.fn();
vi.mock('@/lib/signals/safety/audit', () => ({
  logSignalAudit: (...a: unknown[]) => logSignalAudit(...a),
}));

const getDirectorySettings = vi.fn();
const getLead = vi.fn();
const logLeadEvent = vi.fn();
const updateLead = vi.fn();
vi.mock('@/lib/signals/leads/store', () => ({
  getDirectorySettings: (...a: unknown[]) => getDirectorySettings(...a),
  getLead: (...a: unknown[]) => getLead(...a),
  logLeadEvent: (...a: unknown[]) => logLeadEvent(...a),
  updateLead: (...a: unknown[]) => updateLead(...a),
}));

const insertLeadMessage = vi.fn();
vi.mock('@/lib/signals/leads/messages', () => ({
  insertLeadMessage: (...a: unknown[]) => insertLeadMessage(...a),
}));

const checkDailyUsage = vi.fn();
const incrementDailyUsage = vi.fn();
vi.mock('@/lib/social/reliability', () => ({
  checkDailyUsage: (...a: unknown[]) => checkDailyUsage(...a),
  incrementDailyUsage: (...a: unknown[]) => incrementDailyUsage(...a),
}));

const getLinkedInUnipileAccountId = vi.fn();
const resolveLinkedInProfile = vi.fn();
const sendLinkedInConnectionInvite = vi.fn();
const sendLinkedInDirectMessage = vi.fn();
const sendLinkedInInMail = vi.fn();
vi.mock('@/lib/signals/outreach/unipile-linkedin', () => ({
  getLinkedInUnipileAccountId: (...a: unknown[]) => getLinkedInUnipileAccountId(...a),
  resolveLinkedInProfile: (...a: unknown[]) => resolveLinkedInProfile(...a),
  sendLinkedInConnectionInvite: (...a: unknown[]) => sendLinkedInConnectionInvite(...a),
  sendLinkedInDirectMessage: (...a: unknown[]) => sendLinkedInDirectMessage(...a),
  sendLinkedInInMail: (...a: unknown[]) => sendLinkedInInMail(...a),
}));

const getXUnipileAccountId = vi.fn();
const resolveXProfile = vi.fn();
const sendXDirectMessage = vi.fn();
vi.mock('@/lib/signals/outreach/unipile-x', () => ({
  getXUnipileAccountId: (...a: unknown[]) => getXUnipileAccountId(...a),
  resolveXProfile: (...a: unknown[]) => resolveXProfile(...a),
  sendXDirectMessage: (...a: unknown[]) => sendXDirectMessage(...a),
}));

const sendGmailEmail = vi.fn();
vi.mock('@/lib/composio/actions/gmail', () => ({
  sendGmailEmail: (...a: unknown[]) => sendGmailEmail(...a),
}));

const getIntegration = vi.fn();
vi.mock('@/lib/signals/integrations/store', () => ({
  getIntegration: (...a: unknown[]) => getIntegration(...a),
}));

const recordOutreachEdit = vi.fn();
vi.mock('@/lib/signals/outreach/edit-feedback', () => ({
  recordOutreachEdit: (...a: unknown[]) => recordOutreachEdit(...a),
}));

// SUT import must come after the mocks above.
import { sendLeadOutreach } from '@/lib/signals/outreach/send-lead';

// --- Fake InsForge client (same pattern as tests/gtm-outreach.test.ts) ---

type Row = Record<string, unknown>;
interface DbCall {
  table: string;
  op: 'select' | 'insert' | 'update' | 'upsert';
  payload?: unknown;
}

function makeClient() {
  const calls: DbCall[] = [];
  const database = {
    from(table: string) {
      let op: DbCall['op'] = 'select';
      let payload: unknown;
      const builder: Record<string, unknown> = {};
      const chain = () => builder;

      builder.select = () => builder;
      builder.insert = (p: unknown) => {
        op = 'insert';
        payload = p;
        calls.push({ table, op, payload });
        return builder;
      };
      builder.update = (p: unknown) => {
        op = 'update';
        payload = p;
        calls.push({ table, op, payload });
        return builder;
      };
      builder.eq = chain;
      builder.in = chain;
      builder.order = chain;
      builder.limit = chain;
      builder.maybeSingle = async (): Promise<Row> => ({ data: null });
      builder.then = (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: [], error: null });

      return builder;
    },
  };
  return { client: { database } as unknown as never, calls };
}

// --- Fixtures ---

const WS = 'ws1';
const USER = 'user1';
const LEAD_ID = 'lead1';

function makeLead(overrides: Partial<SignalLeadWithContacts> = {}): SignalLeadWithContacts {
  return {
    id: LEAD_ID,
    workspace_id: WS,
    source: 'yc_directory',
    external_id: 'acme',
    company_name: 'Acme AI',
    tagline: null,
    website: null,
    domain: null,
    batch: null,
    tags: [],
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
    outreach: { draft_text: 'hey there' } as never,
    primary_contact: {
      id: 'c1',
      lead_id: LEAD_ID,
      workspace_id: WS,
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
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getLead.mockResolvedValue(makeLead());
  assertOutreachAllowed.mockResolvedValue({ allowed: true });
  logSignalAudit.mockResolvedValue(undefined);
  updateLead.mockResolvedValue(undefined);
  logLeadEvent.mockResolvedValue(undefined);

  // Happy-path mocks for the linkedin_connect dispatch (only reached when a
  // test doesn't get blocked by the dedup guard).
  getLinkedInUnipileAccountId.mockResolvedValue('acct-123');
  checkDailyUsage.mockReturnValue({ allowed: true });
  assertLinkedInProfileLookupAllowed.mockResolvedValue({ allowed: true });
  resolveLinkedInProfile.mockResolvedValue({ providerId: 'prov-9' });
  awaitInterCallDelay.mockResolvedValue(undefined);
  sendLinkedInConnectionInvite.mockResolvedValue({ success: true, externalId: 'ext-1' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Phase: Leads watchlist dedup - send path wiring', () => {
  it('auto + contacted (different lead) -> blocked with duplicate_contact', async () => {
    checkPriorContact.mockResolvedValue({
      contacted: true,
      blockedByDnc: false,
      lastAt: '2026-07-01T00:00:00Z',
      channel: 'linkedin_connect',
      leadId: 'otherLead',
    });
    const { client } = makeClient();

    const result = await sendLeadOutreach(client, {
      workspaceId: WS,
      userId: USER,
      leadId: LEAD_ID,
      mode: 'auto',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('duplicate_contact');
    expect(result.duplicate?.leadId).toBe('otherLead');
    // Dedup check ran BEFORE the outreach guard.
    expect(assertOutreachAllowed).not.toHaveBeenCalled();
    expect(sendLinkedInConnectionInvite).not.toHaveBeenCalled();
    expect(logSignalAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'outreach_blocked', blocked_reason: 'duplicate_contact' }),
    );
  });

  it('manual + contacted (different lead) + no override -> blocked', async () => {
    checkPriorContact.mockResolvedValue({
      contacted: true,
      blockedByDnc: false,
      lastAt: '2026-07-01T00:00:00Z',
      channel: 'linkedin_connect',
      leadId: 'otherLead',
    });
    const { client } = makeClient();

    const result = await sendLeadOutreach(client, {
      workspaceId: WS,
      userId: USER,
      leadId: LEAD_ID,
      mode: 'manual',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('duplicate_contact');
    expect(assertOutreachAllowed).not.toHaveBeenCalled();
  });

  it('manual + contacted (different lead) + overrideDuplicate -> proceeds, audit metadata carries duplicate_override', async () => {
    checkPriorContact.mockResolvedValue({
      contacted: true,
      blockedByDnc: false,
      lastAt: '2026-07-01T00:00:00Z',
      channel: 'linkedin_connect',
      leadId: 'otherLead',
    });
    const { client } = makeClient();

    const result = await sendLeadOutreach(client, {
      workspaceId: WS,
      userId: USER,
      leadId: LEAD_ID,
      mode: 'manual',
      overrideDuplicate: true,
    });

    expect(result.success).toBe(true);
    expect(sendLinkedInConnectionInvite).toHaveBeenCalled();
    expect(logSignalAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'outreach_send_success',
        metadata: expect.objectContaining({ duplicate_override: true }),
      }),
    );
  });

  it('DNC + manual + overrideDuplicate -> STILL blocked (DNC never overridable)', async () => {
    checkPriorContact.mockResolvedValue({
      contacted: false,
      blockedByDnc: true,
    });
    const { client } = makeClient();

    const result = await sendLeadOutreach(client, {
      workspaceId: WS,
      userId: USER,
      leadId: LEAD_ID,
      mode: 'manual',
      overrideDuplicate: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('duplicate_contact');
    expect(result.duplicate?.blockedByDnc).toBe(true);
    expect(assertOutreachAllowed).not.toHaveBeenCalled();
    expect(sendLinkedInConnectionInvite).not.toHaveBeenCalled();
    expect(logSignalAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'outreach_blocked', blocked_reason: 'do_not_contact' }),
    );
  });

  it('same-lead prior contact -> NOT blocked (connect -> DM follow-up exemption)', async () => {
    checkPriorContact.mockResolvedValue({
      contacted: true,
      blockedByDnc: false,
      lastAt: '2026-07-01T00:00:00Z',
      channel: 'linkedin_connect',
      leadId: LEAD_ID,
    });
    const { client } = makeClient();

    const result = await sendLeadOutreach(client, {
      workspaceId: WS,
      userId: USER,
      leadId: LEAD_ID,
      mode: 'auto',
    });

    expect(result.success).toBe(true);
    expect(assertOutreachAllowed).toHaveBeenCalled();
    expect(sendLinkedInConnectionInvite).toHaveBeenCalled();
  });

  it('primary contact no email, secondary contact has email + DNC -> checkPriorContact called with secondary email', async () => {
    checkPriorContact.mockResolvedValue({
      contacted: false,
      blockedByDnc: true,
    });
    const { client } = makeClient();
    const leadWithSecondaryEmail = makeLead({
      primary_contact: {
        id: 'c1',
        lead_id: LEAD_ID,
        workspace_id: WS,
        name: 'Jane Doe',
        role: 'CEO',
        linkedin_url: 'https://linkedin.com/in/jane',
        x_handle: null,
        email: null, // No email on primary
        provider_id: null,
        resolution_source: 'scraped',
        enriched_via: null,
        is_primary: true,
        created_at: new Date().toISOString(),
      },
      contacts: [
        {
          id: 'c1',
          lead_id: LEAD_ID,
          workspace_id: WS,
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
        {
          id: 'c2',
          lead_id: LEAD_ID,
          workspace_id: WS,
          name: 'John Smith',
          role: 'CTO',
          linkedin_url: null,
          x_handle: null,
          email: 'john@acme.ai', // Secondary contact has email
          provider_id: null,
          resolution_source: 'enriched',
          enriched_via: null,
          is_primary: false,
          created_at: new Date().toISOString(),
        },
      ],
    });
    getLead.mockResolvedValue(leadWithSecondaryEmail);

    const result = await sendLeadOutreach(client, {
      workspaceId: WS,
      userId: USER,
      leadId: LEAD_ID,
      channel: 'gmail',
      mode: 'manual',
      emailOptIn: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('duplicate_contact');
    expect(result.duplicate?.blockedByDnc).toBe(true);
    // Verify checkPriorContact was called with identity containing the secondary contact's email
    expect(checkPriorContact).toHaveBeenCalledWith(
      expect.anything(),
      WS,
      expect.objectContaining({
        email: 'john@acme.ai',
      }),
    );
    expect(assertOutreachAllowed).not.toHaveBeenCalled();
  });
});
