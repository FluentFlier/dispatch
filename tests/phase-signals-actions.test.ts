/**
 * Phase: Signals action pipeline
 *
 * Verifies runSignalActions maps the workspace safety posture onto the spec's
 * action modes: notify_only (default) → nothing; outreach_enabled → auto-draft;
 * auto_send_enabled → guarded auto-send, LinkedIn person-profiles only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/signals/safety/settings', () => ({ getSafetySettings: vi.fn() }));
vi.mock('@/lib/signals/safety/guard', () => ({ assertAutoSendAllowed: vi.fn() }));
vi.mock('@/lib/signals/safety/audit', () => ({ logSignalAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/signals/outreach/draft', () => ({ draftOutreachForEvent: vi.fn() }));
vi.mock('@/lib/signals/outreach/send', () => ({ sendSignalOutreach: vi.fn() }));
vi.mock('@/lib/signals/ingest/workspace-account', () => ({
  getWorkspacePollAccount: vi.fn(),
  getWorkspaceOwnerUserId: vi.fn(),
}));

import { getSafetySettings } from '@/lib/signals/safety/settings';
import { assertAutoSendAllowed } from '@/lib/signals/safety/guard';
import { draftOutreachForEvent } from '@/lib/signals/outreach/draft';
import { sendSignalOutreach } from '@/lib/signals/outreach/send';
import {
  getWorkspacePollAccount,
  getWorkspaceOwnerUserId,
} from '@/lib/signals/ingest/workspace-account';
import { runSignalActions } from '@/lib/signals/actions';
import type { SignalActionContext } from '@/lib/signals/actions';
import type { SignalEventWithPost } from '@/lib/signals/types';

const mockSettings = vi.mocked(getSafetySettings);
const mockGuard = vi.mocked(assertAutoSendAllowed);
const mockDraft = vi.mocked(draftOutreachForEvent);
const mockSend = vi.mocked(sendSignalOutreach);
const mockPollAccount = vi.mocked(getWorkspacePollAccount);
const mockOwner = vi.mocked(getWorkspaceOwnerUserId);

const WS = 'ws-1';
const client = {} as never;

function makeEvent(authorHandle: string | null = 'jane-doe'): SignalEventWithPost {
  return {
    id: 'evt-1',
    workspace_id: WS,
    raw_post_id: 'rp-1',
    signal_type: 'accelerator_join',
    company_name: 'Acme',
    person_name: 'Jane Doe',
    accelerator_name: 'Y Combinator',
    batch: 'S24',
    signal_summary: 'joined YC S24',
    confidence: 0.9,
    dedupe_key: 'k',
    status: 'pending',
    created_at: '',
    updated_at: '',
    raw_post: {
      id: 'rp-1',
      workspace_id: WS,
      source_id: 'src-1',
      platform: 'linkedin',
      external_post_id: 'p1',
      author_handle: authorHandle,
      author_name: 'Jane Doe',
      content: 'We joined YC S24',
      post_url: 'https://linkedin.com/posts/xyz',
      posted_at: null,
      raw_payload: null,
      created_at: '',
    },
  };
}

function settings(outreach: boolean, autoSend: boolean) {
  // Only outreach_enabled + auto_send_enabled are read by runSignalActions.
  return { outreach_enabled: outreach, auto_send_enabled: autoSend } as never;
}

const LINKEDIN_PERSON: SignalActionContext = { platform: 'linkedin', sourceType: 'person_profile' };

beforeEach(() => {
  mockDraft.mockResolvedValue({ draftText: 'hey congrats', voiceMatchScore: 90, event: null });
  mockSend.mockResolvedValue({ success: true });
  mockGuard.mockResolvedValue({ allowed: true, settings: {} as never });
  mockPollAccount.mockResolvedValue({ userId: 'u1', unipileAccountId: 'acc', platform: 'linkedin' });
  mockOwner.mockResolvedValue('owner1');
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('Phase: Signals action pipeline', () => {
  it('notify_only (outreach disabled): no draft, no send', async () => {
    mockSettings.mockResolvedValue(settings(false, false));
    await runSignalActions(client, WS, makeEvent(), LINKEDIN_PERSON);
    expect(mockDraft).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('notify_and_draft (outreach on, auto-send off): drafts, does not send', async () => {
    mockSettings.mockResolvedValue(settings(true, false));
    await runSignalActions(client, WS, makeEvent(), LINKEDIN_PERSON);
    expect(mockDraft).toHaveBeenCalledOnce();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('auto_send: drafts and sends for a LinkedIn person profile when the guard allows', async () => {
    mockSettings.mockResolvedValue(settings(true, true));
    await runSignalActions(client, WS, makeEvent('jane-doe'), LINKEDIN_PERSON);
    expect(mockDraft).toHaveBeenCalledOnce();
    expect(mockSend).toHaveBeenCalledOnce();
    const arg = mockSend.mock.calls[0][1];
    expect(arg.channel).toBe('linkedin_connect');
    expect(arg.linkedinIdentifier).toBe('jane-doe');
    expect(arg.messageText).toBe('hey congrats');
  });

  it('auto_send: never sends for company/accelerator sources (draft only)', async () => {
    mockSettings.mockResolvedValue(settings(true, true));
    await runSignalActions(client, WS, makeEvent(), { platform: 'linkedin', sourceType: 'company_page' });
    expect(mockDraft).toHaveBeenCalledOnce();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('auto_send: X person-profile now sends via x_dm', async () => {
    mockSettings.mockResolvedValue(settings(true, true));
    await runSignalActions(client, WS, makeEvent('founderhandle'), { platform: 'x', sourceType: 'person_profile' });
    expect(mockDraft).toHaveBeenCalledOnce();
    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend.mock.calls[0][1].channel).toBe('x_dm');
  });

  it('auto_send: skips send when the safety guard blocks (draft retained)', async () => {
    mockSettings.mockResolvedValue(settings(true, true));
    mockGuard.mockResolvedValue({ allowed: false, reason: 'cooldown', settings: {} as never });
    await runSignalActions(client, WS, makeEvent(), LINKEDIN_PERSON);
    expect(mockDraft).toHaveBeenCalledOnce();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('auto_send: skips send when no target identifier is on the post', async () => {
    mockSettings.mockResolvedValue(settings(true, true));
    await runSignalActions(client, WS, makeEvent(null), LINKEDIN_PERSON);
    expect(mockDraft).toHaveBeenCalledOnce();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('webhook ingest (no sourceType): drafts but never auto-sends', async () => {
    mockSettings.mockResolvedValue(settings(true, true));
    await runSignalActions(client, WS, makeEvent(), { platform: 'linkedin' });
    expect(mockDraft).toHaveBeenCalledOnce();
    expect(mockSend).not.toHaveBeenCalled();
  });

  // --- Explicit rule-driven action modes ---

  it('rule actionMode=notify_only overrides an outreach-enabled workspace (no draft)', async () => {
    mockSettings.mockResolvedValue(settings(true, true));
    await runSignalActions(client, WS, makeEvent(), { ...LINKEDIN_PERSON, actionMode: 'notify_only' });
    expect(mockDraft).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('rule actionMode=notify_and_draft downgrades an auto-send workspace (draft, no send)', async () => {
    mockSettings.mockResolvedValue(settings(true, true));
    await runSignalActions(client, WS, makeEvent(), { ...LINKEDIN_PERSON, actionMode: 'notify_and_draft' });
    expect(mockDraft).toHaveBeenCalledOnce();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('rule actionMode=auto_send drives a send even when the workspace default is draft-only', async () => {
    mockSettings.mockResolvedValue(settings(true, false));
    await runSignalActions(client, WS, makeEvent(), { ...LINKEDIN_PERSON, actionMode: 'auto_send' });
    expect(mockDraft).toHaveBeenCalledOnce();
    // Guard (mocked allow) is the real auto_send_enabled enforcement point.
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it('master gate: rule requests draft but outreach_enabled is off -> nothing happens', async () => {
    mockSettings.mockResolvedValue(settings(false, false));
    await runSignalActions(client, WS, makeEvent(), { ...LINKEDIN_PERSON, actionMode: 'auto_send' });
    expect(mockDraft).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('rule channels select the send channel (linkedin_dm)', async () => {
    mockSettings.mockResolvedValue(settings(true, true));
    await runSignalActions(client, WS, makeEvent(), {
      ...LINKEDIN_PERSON,
      actionMode: 'auto_send',
      channels: ['linkedin_dm'],
    });
    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend.mock.calls[0][1].channel).toBe('linkedin_dm');
  });

  it('rule channel=copy is not auto-sendable (draft only)', async () => {
    mockSettings.mockResolvedValue(settings(true, true));
    await runSignalActions(client, WS, makeEvent(), {
      ...LINKEDIN_PERSON,
      actionMode: 'auto_send',
      channels: ['copy'],
    });
    expect(mockDraft).toHaveBeenCalledOnce();
    expect(mockSend).not.toHaveBeenCalled();
  });
});
