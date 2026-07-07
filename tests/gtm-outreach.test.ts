import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SignalEventWithPost, OutreachChannel } from '@/lib/signals/types';
import type { SignalSafetySettings } from '@/lib/signals/safety/limits';
import { DEFAULT_SAFETY_SETTINGS } from '@/lib/signals/safety/limits';
import { DEFAULT_GTM_PLAYBOOK } from '@/lib/signals/defaults';

/**
 * GTM / Signals outreach verification suite.
 *
 * These are VERIFICATION tests against the existing draft + send loop. They mock
 * every external boundary (LLM voice pipeline, Unipile LinkedIn, Composio Gmail,
 * InsForge DB) and assert the real behavior of:
 *   - src/lib/signals/outreach/draft.ts  (playbook injection + persistence)
 *   - src/lib/signals/outreach/send.ts   (transport dispatch + success/failure writes)
 *   - src/lib/signals/safety/guard.ts    (dry_run / disabled / cap gating)
 *
 * IMPORTANT: one test in the draft path documents a REAL BUG (GTM playbook never
 * reaches the LLM prompt). See the "GTM PLAYBOOK INJECTION" describe block.
 */

// --- Boundary mocks (declared before importing the SUT) ---

// Capture every call into the voice pipeline so we can inspect what reaches the LLM.
const generateWithVoicePipeline = vi.fn();
vi.mock('@/lib/voice-pipeline', () => ({
  generateWithVoicePipeline: (...args: unknown[]) => generateWithVoicePipeline(...args),
}));

// Capture every call into brain retrieval so we can assert whether includeGtm is set.
const retrieveBrainContext = vi.fn();
vi.mock('@/lib/brain/retrieve', () => ({
  retrieveBrainContext: (...args: unknown[]) => retrieveBrainContext(...args),
}));

// Transport clients for the send path.
const sendGmailEmail = vi.fn();
vi.mock('@/lib/composio/actions/gmail', () => ({
  sendGmailEmail: (...args: unknown[]) => sendGmailEmail(...args),
}));

const sendLinkedInConnectionInvite = vi.fn();
const sendLinkedInInMail = vi.fn();
const sendLinkedInDirectMessage = vi.fn();
const resolveLinkedInProfile = vi.fn();
const getLinkedInUnipileAccountId = vi.fn();
const getInMailBalance = vi.fn();
vi.mock('@/lib/signals/outreach/unipile-linkedin', () => ({
  sendLinkedInConnectionInvite: (...a: unknown[]) => sendLinkedInConnectionInvite(...a),
  sendLinkedInInMail: (...a: unknown[]) => sendLinkedInInMail(...a),
  sendLinkedInDirectMessage: (...a: unknown[]) => sendLinkedInDirectMessage(...a),
  resolveLinkedInProfile: (...a: unknown[]) => resolveLinkedInProfile(...a),
  getLinkedInUnipileAccountId: (...a: unknown[]) => getLinkedInUnipileAccountId(...a),
  getInMailBalance: (...a: unknown[]) => getInMailBalance(...a),
}));

const getXUnipileAccountId = vi.fn();
const resolveXProfile = vi.fn();
const sendXDirectMessage = vi.fn();
vi.mock('@/lib/signals/outreach/unipile-x', () => ({
  getXUnipileAccountId: (...a: unknown[]) => getXUnipileAccountId(...a),
  resolveXProfile: (...a: unknown[]) => resolveXProfile(...a),
  sendXDirectMessage: (...a: unknown[]) => sendXDirectMessage(...a),
}));

const getIntegration = vi.fn();
vi.mock('@/lib/signals/integrations/store', () => ({
  getIntegration: (...a: unknown[]) => getIntegration(...a),
}));

// The draft path pulls voice profile/settings + brain via loadCreatorVoiceContext.
// We do NOT mock that function: we exercise the real one (with retrieveBrainContext
// mocked) so the test proves whether GTM actually flows through to the prompt.

// SUT imports must come after the mocks above.
import { draftOutreachForEvent } from '@/lib/signals/outreach/draft';
import { sendSignalOutreach } from '@/lib/signals/outreach/send';
import { assertOutreachAllowed } from '@/lib/signals/safety/guard';

// --- Fake InsForge client ---

type MaybeSingle = { data: unknown; error?: unknown };
type CountResult = { count: number; error?: null };

/**
 * Minimal chainable fake of the InsForge query builder. Each `.from(table)`
 * consults a handler map so individual tests control exactly what each table
 * returns. Insert/update calls are recorded for assertions.
 */
interface DbCall {
  table: string;
  op: 'select' | 'insert' | 'update' | 'upsert';
  payload?: unknown;
}

interface FakeDbOptions {
  // Rows returned from a maybeSingle()/single() select, keyed by table.
  selectSingle?: Record<string, unknown>;
  // count returned for count/head selects (used by audit cap lookups), keyed by table.
  count?: Record<string, number>;
}

function makeClient(opts: FakeDbOptions = {}) {
  const calls: DbCall[] = [];
  const selectSingle = opts.selectSingle ?? {};
  const count = opts.count ?? {};

  const database = {
    from(table: string) {
      let op: DbCall['op'] = 'select';
      let payload: unknown;
      let isHeadCount = false;

      const builder: Record<string, unknown> = {};
      const chain = () => builder;

      builder.select = (_cols?: unknown, selOpts?: { count?: string; head?: boolean }) => {
        if (selOpts?.head) isHeadCount = true;
        return builder;
      };
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
      builder.upsert = (p: unknown) => {
        op = 'upsert';
        payload = p;
        calls.push({ table, op, payload });
        return builder;
      };
      builder.eq = chain;
      builder.in = chain;
      builder.gte = chain;
      builder.not = chain;
      builder.order = chain;
      builder.limit = chain;

      builder.maybeSingle = async (): Promise<MaybeSingle | CountResult> => {
        if (isHeadCount) return { count: count[table] ?? 0, error: null };
        return { data: selectSingle[table] ?? null };
      };
      builder.single = async (): Promise<MaybeSingle> => ({ data: selectSingle[table] ?? null });

      // Some count queries resolve without maybeSingle (awaited directly).
      builder.then = (resolve: (v: CountResult) => unknown) =>
        resolve({ count: count[table] ?? 0, error: null });

      return builder;
    },
  };

  return { client: { database } as unknown as never, calls };
}

function makeSettings(overrides: Partial<SignalSafetySettings> = {}): Record<string, unknown> {
  return { workspace_id: 'ws1', ...DEFAULT_SAFETY_SETTINGS, ...overrides };
}

function makeEvent(overrides: Partial<SignalEventWithPost> = {}): SignalEventWithPost {
  return {
    id: 'evt1',
    workspace_id: 'ws1',
    raw_post_id: 'rp1',
    signal_type: 'accelerator_join',
    company_name: 'Acme',
    person_name: 'Jane Doe',
    accelerator_name: 'Y Combinator',
    batch: 'S25',
    signal_summary: 'Acme joined YC S25',
    confidence: 0.9,
    dedupe_key: 'k1',
    status: 'pending',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    raw_post: {
      id: 'rp1',
      workspace_id: 'ws1',
      source_id: null,
      platform: 'linkedin',
      external_post_id: 'x1',
      author_handle: null,
      author_name: 'Jane Doe',
      content: 'Thrilled to share Acme is joining YC S25!',
      post_url: 'https://linkedin.com/posts/1',
      posted_at: null,
      raw_payload: {},
      created_at: '2026-07-01T00:00:00Z',
    },
    outreach: null,
    ...overrides,
  };
}

const WS = 'ws1';
const USER = 'user1';

beforeEach(() => {
  vi.clearAllMocks();
  generateWithVoicePipeline.mockResolvedValue({
    text: 'Congrats on YC S25, Jane. Would love to show you Rho.',
    voice_match_score: 82,
    ai_score: 10,
    revised: false,
    flags: [],
    iterations: 1,
  });
  retrieveBrainContext.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// DRAFT PATH
// ---------------------------------------------------------------------------

describe('Phase: GTM Outreach — draft path', () => {
  describe('draftOutreachForEvent: persistence + return shape', () => {
    it('persists the LLM draft text to signal_outreach.draft_text', async () => {
      // No existing signal_outreach row -> insert path in saveOutreachDraft.
      const { client, calls } = makeClient({
        selectSingle: {
          creator_profile: null,
          signal_events: makeEvent(),
        },
      });

      const result = await draftOutreachForEvent(
        client,
        USER,
        WS,
        makeEvent(),
        'linkedin_connect',
      );

      // draft_text is written via signal_outreach insert (no existing row).
      const outreachWrite = calls.find(
        (c) => c.table === 'signal_outreach' && (c.op === 'insert' || c.op === 'update'),
      );
      expect(outreachWrite).toBeDefined();
      const payload = outreachWrite?.payload as Record<string, unknown>;
      expect(payload.draft_text).toBe(
        'Congrats on YC S25, Jane. Would love to show you Rho.',
      );
      expect(payload.status).toBe('draft');
      expect(payload.channel).toBe('linkedin_connect');

      // Draft text + a voice-match score are returned to the caller.
      expect(result.draftText).toBe(
        'Congrats on YC S25, Jane. Would love to show you Rho.',
      );
      expect(result.voiceMatchScore).toBe(82);
    });

    it('builds a prompt that references the specific signal (company, batch, accelerator)', async () => {
      const { client } = makeClient({
        selectSingle: { creator_profile: null, signal_events: makeEvent() },
      });

      await draftOutreachForEvent(client, USER, WS, makeEvent(), 'linkedin_connect');

      expect(generateWithVoicePipeline).toHaveBeenCalledTimes(1);
      const input = generateWithVoicePipeline.mock.calls[0][0] as { userPrompt: string };
      expect(input.userPrompt).toContain('Acme');
      expect(input.userPrompt).toContain('S25');
      expect(input.userPrompt).toContain('Y Combinator');
    });
  });

  describe('GTM PLAYBOOK INJECTION (documents a real bug)', () => {
    /**
     * CONTRACT (per spec + retrieve.ts docstring): outreach drafts MUST include the
     * GTM playbook (ICP/pitch/CTA) so the LLM writes a sales-aware message. The path
     * is: draftOutreachForEvent -> loadCreatorVoiceContext({ includeGtm: true }) ->
     * retrieveBrainContext(..., includeGtm=true) -> GTM snippet in contextAdditions ->
     * generateWithVoicePipeline.
     *
     * ACTUAL BEHAVIOR (BUG): draft.ts calls loadCreatorVoiceContext WITHOUT includeGtm,
     * AND with lightweight:true — which skips brain retrieval entirely. So the GTM
     * playbook never reaches the prompt. These assertions encode the CORRECT contract
     * and therefore FAIL against current code, documenting the defect.
     *
     * See draft.ts lines 64-68 and voice-context.ts lines 234-250.
     */
    it('passes includeGtm=true into brain retrieval for outreach drafts', async () => {
      const { client } = makeClient({
        selectSingle: { creator_profile: null, signal_events: makeEvent() },
      });

      await draftOutreachForEvent(client, USER, WS, makeEvent(), 'linkedin_connect');

      // retrieveBrainContext(client, userId, query, workspaceId, includeGtm)
      expect(retrieveBrainContext).toHaveBeenCalled();
      const brainCall = retrieveBrainContext.mock.calls[0];
      // 5th positional arg (index 4) is includeGtm.
      expect(brainCall[4]).toBe(true);
    });

    it('includes GTM playbook (ICP/pitch/CTA) text in what is sent to the LLM', async () => {
      // Simulate brain retrieval returning the seeded GTM playbook snippet.
      retrieveBrainContext.mockResolvedValue([
        `[gtm]\nICP: ${DEFAULT_GTM_PLAYBOOK.icp}\nPitch: ${DEFAULT_GTM_PLAYBOOK.pitch}\nCTA style: ${DEFAULT_GTM_PLAYBOOK.cta_style}`,
      ]);

      const { client } = makeClient({
        selectSingle: { creator_profile: null, signal_events: makeEvent() },
      });

      await draftOutreachForEvent(client, USER, WS, makeEvent(), 'linkedin_connect');

      expect(generateWithVoicePipeline).toHaveBeenCalledTimes(1);
      const input = generateWithVoicePipeline.mock.calls[0][0] as { contextAdditions?: string };
      const ctx = input.contextAdditions ?? '';
      // The seeded GTM pitch must reach the prompt context. Asserted against the
      // default playbook itself (not a hardcoded brand string) so this stays
      // valid now that the neutral default replaced the Rho-specific pitch.
      expect(ctx).toContain(DEFAULT_GTM_PLAYBOOK.pitch);
    });
  });
});

// ---------------------------------------------------------------------------
// SEND PATH — safety gating
// ---------------------------------------------------------------------------

describe('Phase: GTM Outreach — send safety gates', () => {
  it('BLOCKS when outreach_enabled=false and records an outreach_blocked audit row', async () => {
    const { client, calls } = makeClient({
      selectSingle: {
        signal_safety_settings: makeSettings({ outreach_enabled: false }),
      },
    });

    const guard = await assertOutreachAllowed(client, WS, 'linkedin_connect', {
      eventId: 'evt1',
    });

    expect(guard.allowed).toBe(false);
    expect(guard.reason).toMatch(/disabled/i);
    // An audit row with action outreach_blocked was inserted.
    const audit = calls.find(
      (c) => c.table === 'signal_outreach_audit' && c.op === 'insert',
    );
    expect(audit).toBeDefined();
    expect((audit?.payload as Record<string, unknown>).action).toBe('outreach_blocked');
  });

  it('BLOCKS when dry_run=true (drafts only, no transport)', async () => {
    const { client, calls } = makeClient({
      selectSingle: {
        signal_safety_settings: makeSettings({ outreach_enabled: true, dry_run: true }),
      },
    });

    const guard = await assertOutreachAllowed(client, WS, 'linkedin_connect', {
      eventId: 'evt1',
    });

    expect(guard.allowed).toBe(false);
    expect(guard.reason).toMatch(/dry-run/i);
    const audit = calls.find(
      (c) => c.table === 'signal_outreach_audit' && c.op === 'insert',
    );
    expect((audit?.payload as Record<string, unknown>).action).toBe('outreach_blocked');
  });

  it('BLOCKS when the daily LinkedIn invite cap is exceeded', async () => {
    // Enabled + not dry-run + inside working hours, but audit count is over cap.
    const settings = makeSettings({
      outreach_enabled: true,
      dry_run: false,
      working_hours_only: false,
      max_linkedin_invites_per_day: 5,
    });
    const { client } = makeClient({
      selectSingle: { signal_safety_settings: settings },
      // countAuditActions reads signal_outreach_audit via head-count select.
      count: { signal_outreach_audit: 5 },
    });

    const guard = await assertOutreachAllowed(client, WS, 'linkedin_connect', {
      eventId: 'evt1',
      now: new Date('2026-07-01T12:00:00Z'),
    });

    expect(guard.allowed).toBe(false);
    expect(guard.reason).toMatch(/daily linkedin invite cap/i);
  });

  it('sendSignalOutreach returns block reason and does NOT call transport when guard blocks', async () => {
    const { client } = makeClient({
      selectSingle: {
        signal_safety_settings: makeSettings({ outreach_enabled: false }),
      },
    });

    const res = await sendSignalOutreach(client, {
      workspaceId: WS,
      userId: USER,
      eventId: 'evt1',
      channel: 'linkedin_connect',
      linkedinIdentifier: 'janedoe',
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/disabled/i);
    // No LinkedIn transport was invoked.
    expect(sendLinkedInConnectionInvite).not.toHaveBeenCalled();
    expect(resolveLinkedInProfile).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SEND PATH — allowed sends (transport dispatch)
// ---------------------------------------------------------------------------

describe('Phase: GTM Outreach — allowed send dispatch', () => {
  /** Settings that let a send through the guard cleanly. */
  function allowSettings(): Record<string, unknown> {
    return makeSettings({
      outreach_enabled: true,
      dry_run: false,
      working_hours_only: false,
      max_linkedin_invites_per_day: 100,
      max_linkedin_invites_per_week: 200,
      max_linkedin_inmail_per_day: 100,
    });
  }

  it('x_dm: resolves the X profile and invokes the X DM transport', async () => {
    const { client } = makeClient({
      selectSingle: {
        signal_safety_settings: allowSettings(),
        signal_events: makeEvent({ outreach: { draft_text: 'hey there' } as never }),
      },
    });
    getXUnipileAccountId.mockResolvedValue('x-acct');
    resolveXProfile.mockResolvedValue({ providerId: 'xprov' });
    sendXDirectMessage.mockResolvedValue({ success: true, externalId: 'xext' });

    const res = await sendSignalOutreach(client, {
      workspaceId: WS,
      userId: USER,
      eventId: 'evt1',
      channel: 'x_dm',
      linkedinIdentifier: 'founderhandle',
    });

    expect(res.success).toBe(true);
    expect(res.externalId).toBe('xext');
    expect(sendXDirectMessage).toHaveBeenCalledWith('x-acct', 'xprov', 'hey there');
    expect(sendLinkedInConnectionInvite).not.toHaveBeenCalled();
  });

  it('linkedin_connect: invokes the connection-invite transport and marks the record sent', async () => {
    const { client, calls } = makeClient({
      selectSingle: {
        signal_safety_settings: allowSettings(),
        signal_events: makeEvent({ outreach: { draft_text: 'hey there' } as never }),
        // signal_outreach maybeSingle -> no existing row (insert on mark-sent).
      },
    });
    getLinkedInUnipileAccountId.mockResolvedValue('acct-123');
    resolveLinkedInProfile.mockResolvedValue({ providerId: 'prov-9' });
    sendLinkedInConnectionInvite.mockResolvedValue({ success: true, externalId: 'ext-1' });

    const res = await sendSignalOutreach(client, {
      workspaceId: WS,
      userId: USER,
      eventId: 'evt1',
      channel: 'linkedin_connect',
      linkedinIdentifier: 'janedoe',
    });

    expect(res.success).toBe(true);
    expect(res.externalId).toBe('ext-1');
    // Correct transport for the channel.
    expect(sendLinkedInConnectionInvite).toHaveBeenCalledWith('acct-123', 'prov-9', 'hey there');
    expect(sendLinkedInInMail).not.toHaveBeenCalled();

    // Record updated to status='sent' with external_message_id.
    const sentWrite = calls.find(
      (c) =>
        c.table === 'signal_outreach' &&
        (c.op === 'insert' || c.op === 'update') &&
        (c.payload as Record<string, unknown>).status === 'sent',
    );
    expect(sentWrite).toBeDefined();
    const payload = sentWrite?.payload as Record<string, unknown>;
    expect(payload.external_message_id).toBe('ext-1');

    // A success audit row was written.
    const successAudit = calls.find(
      (c) =>
        c.table === 'signal_outreach_audit' &&
        c.op === 'insert' &&
        (c.payload as Record<string, unknown>).action === 'outreach_send_success',
    );
    expect(successAudit).toBeDefined();
  });

  it('gmail: invokes sendGmailEmail and marks sent on success', async () => {
    const { client, calls } = makeClient({
      selectSingle: {
        signal_safety_settings: allowSettings(),
        signal_events: makeEvent({ outreach: { draft_text: 'cold email body' } as never }),
      },
    });
    getIntegration.mockResolvedValue({ enabled: true, composio_user_id: 'composio-1' });
    sendGmailEmail.mockResolvedValue({ success: true, messageId: 'gmail-42' });

    const res = await sendSignalOutreach(client, {
      workspaceId: WS,
      userId: USER,
      eventId: 'evt1',
      channel: 'gmail',
      recipientEmail: 'jane@acme.com',
    });

    expect(res.success).toBe(true);
    expect(res.externalId).toBe('gmail-42');
    expect(sendGmailEmail).toHaveBeenCalledWith(
      'composio-1',
      expect.objectContaining({ to: 'jane@acme.com', body: 'cold email body' }),
    );
    const sentWrite = calls.find(
      (c) =>
        c.table === 'signal_outreach' &&
        (c.payload as Record<string, unknown>).status === 'sent',
    );
    expect(sentWrite).toBeDefined();
  });

  it('copy channel: returns cleanly without any transport call', async () => {
    const { client } = makeClient();

    const res = await sendSignalOutreach(client, {
      workspaceId: WS,
      userId: USER,
      eventId: 'evt1',
      channel: 'copy',
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/does not send via api/i);
    expect(sendGmailEmail).not.toHaveBeenCalled();
    expect(sendLinkedInConnectionInvite).not.toHaveBeenCalled();
  });

  it('x_dm channel: without a connected X account returns a connect-X error (no transport)', async () => {
    const { client } = makeClient({
      selectSingle: {
        signal_safety_settings: allowSettings(),
        signal_events: makeEvent({ outreach: { draft_text: 'hey there' } as never }),
      },
    });
    getXUnipileAccountId.mockResolvedValue(null);

    const res = await sendSignalOutreach(client, {
      workspaceId: WS,
      userId: USER,
      eventId: 'evt1',
      channel: 'x_dm',
      linkedinIdentifier: 'founderhandle',
    });

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/connect x/i);
    expect(sendXDirectMessage).not.toHaveBeenCalled();
    expect(sendLinkedInConnectionInvite).not.toHaveBeenCalled();
  });

  it('linkedin failure: records outreach_blocked + failed status, surfaces the error', async () => {
    const { client, calls } = makeClient({
      selectSingle: {
        signal_safety_settings: allowSettings(),
        signal_events: makeEvent({ outreach: { draft_text: 'hey there' } as never }),
      },
    });
    getLinkedInUnipileAccountId.mockResolvedValue('acct-123');
    resolveLinkedInProfile.mockResolvedValue({ providerId: 'prov-9' });
    sendLinkedInConnectionInvite.mockResolvedValue({ success: false, error: 'rate_limited' });

    const res = await sendSignalOutreach(client, {
      workspaceId: WS,
      userId: USER,
      eventId: 'evt1',
      channel: 'linkedin_connect',
      linkedinIdentifier: 'janedoe',
    });

    expect(res.success).toBe(false);
    expect(res.error).toBe('rate_limited');
    const failedWrite = calls.find(
      (c) =>
        c.table === 'signal_outreach' &&
        (c.payload as Record<string, unknown>).status === 'failed',
    );
    expect(failedWrite).toBeDefined();
  });
});
