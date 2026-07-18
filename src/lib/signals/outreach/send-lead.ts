import type { createClient } from '@insforge/sdk';
import { assertOutreachAllowed, assertLinkedInProfileLookupAllowed } from '@/lib/signals/safety';
import { awaitInterCallDelay } from '@/lib/signals/safety/humanize';
import { logSignalAudit } from '@/lib/signals/safety/audit';
import { getDirectorySettings, getLead, logLeadEvent, updateLead } from '@/lib/signals/leads/store';
import { insertLeadMessage } from '@/lib/signals/leads/messages';
import {
  checkDailyUsage,
  incrementDailyUsage,
} from '@/lib/social/reliability';
import {
  getLinkedInUnipileAccountId,
  resolveLinkedInProfile,
  sendLinkedInConnectionInvite,
  sendLinkedInDirectMessage,
  sendLinkedInInMail,
} from '@/lib/signals/outreach/unipile-linkedin';
import { getXUnipileAccountId, resolveXProfile, sendXDirectMessage } from '@/lib/signals/outreach/unipile-x';
import { sendGmailEmail } from '@/lib/composio/actions/gmail';
import { getIntegration } from '@/lib/signals/integrations/store';
import { recordOutreachEdit } from '@/lib/signals/outreach/edit-feedback';
import { checkPriorContact, type ContactIdentity, type PriorContactResult } from '@/lib/signals/outreach/prior-contact';
import { followUpDmDueAt, markPlaybookStepDone, upsertLeadOutreachRow } from '@/lib/gtm/nurture/shared';
import { LINKEDIN_CONNECT_NOTE_LIMIT } from '@/lib/leads/constants';
import type { OutreachChannel, SignalLeadWithContacts } from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

/** v1 lead channels: LinkedIn connection (default), LinkedIn DM, X DM, or cold email. */
export type LeadChannel = Extract<
  OutreachChannel,
  'linkedin_connect' | 'linkedin_dm' | 'x_dm' | 'gmail'
>;

export interface SendLeadInput {
  workspaceId: string;
  userId: string;
  leadId: string;
  channel?: LeadChannel;
  messageText?: string;
  /** Required true to send a cold email (per-lead compliance opt-in). */
  emailOptIn?: boolean;
  now?: Date;
  /** 'auto' (cron/nurture sends) always blocks a duplicate; 'manual' (user-approved) warns and can be overridden. */
  mode: 'auto' | 'manual';
  /** Manual-mode only: proceed despite a prior-contact match. Never overrides a do_not_contact block. */
  overrideDuplicate?: boolean;
}

export interface SendLeadResult {
  success: boolean;
  error?: string;
  retryAfterSeconds?: number;
  externalId?: string;
  providerId?: string;
  lead?: SignalLeadWithContacts | null;
  duplicate?: PriorContactResult;
}

/**
 * Sends a directory lead's outreach through the SAME safety guard and provider
 * primitives as event outreach, keyed on lead_id. Kept separate from
 * sendSignalOutreach so the proven event path is untouched. assertOutreachAllowed
 * applies every gate (dry-run, working hours, cooldown, per-channel daily cap),
 * so both LinkedIn invites and cold emails are rate-limited and cooldown-spaced -
 * a code bug cannot spam because each send must clear the cooldown + daily cap.
 */
export async function sendLeadOutreach(
  client: InsforgeClient,
  input: SendLeadInput,
): Promise<SendLeadResult> {
  const { workspaceId, userId, leadId, mode } = input;
  const channel: LeadChannel = input.channel ?? 'linkedin_connect';

  const lead = await getLead(client, workspaceId, leadId);
  if (!lead) return { success: false, error: 'Lead not found.' };

  // Duplicate/do-not-contact guard (Task 10). Runs BEFORE assertOutreachAllowed
  // so a blocked send never touches the cooldown/cap counters. A prior contact
  // on THIS SAME lead is exempt - that's the connect -> DM follow-up sequence,
  // not a re-contact, and is already governed by the signal_outreach_lead_unique
  // DB constraint.
  const contact = lead.primary_contact ?? lead.contacts?.[0] ?? null;
  const identity: ContactIdentity = {
    linkedinProviderId: contact?.provider_id ?? undefined,
    linkedinUrl: contact?.linkedin_url ?? undefined,
    xHandle: contact?.x_handle ?? undefined,
    email: (contact?.email ?? lead.contacts?.find((c) => c.email)?.email) ?? undefined,
  };
  const duplicate = await checkPriorContact(client, workspaceId, identity);
  const contactedElsewhere = duplicate.contacted && duplicate.leadId !== leadId;

  if (duplicate.blockedByDnc) {
    await logSignalAudit(client, {
      workspace_id: workspaceId,
      action: 'outreach_blocked',
      channel,
      lead_id: leadId,
      blocked_reason: 'do_not_contact',
    });
    return { success: false, error: 'duplicate_contact', duplicate };
  }

  const duplicateOverride = contactedElsewhere && mode === 'manual' && input.overrideDuplicate === true;
  if (contactedElsewhere && !duplicateOverride) {
    await logSignalAudit(client, {
      workspace_id: workspaceId,
      action: 'outreach_blocked',
      channel,
      lead_id: leadId,
      blocked_reason: 'duplicate_contact',
    });
    return { success: false, error: 'duplicate_contact', duplicate };
  }

  const guard = await assertOutreachAllowed(client, workspaceId, channel, { leadId, now: input.now });
  if (!guard.allowed) {
    return { success: false, error: guard.reason, retryAfterSeconds: guard.retryAfterSeconds };
  }

  if (lead.contact_status === 'no_contact') {
    return { success: false, error: 'No reachable contact for this lead.' };
  }

  const result = await (channel === 'gmail'
    ? sendLeadEmail(client, input, lead, duplicateOverride)
    : channel === 'x_dm'
      ? sendLeadX(client, input, lead, duplicateOverride)
      : channel === 'linkedin_dm'
        ? sendLeadLinkedInDm(client, input, lead, duplicateOverride)
        : sendLeadLinkedIn(client, input, lead, duplicateOverride));

  // Edit-feedback loop: when the user rewrote the model draft before sending,
  // capture the model -> edited pair (workspace-scoped) so future drafts learn
  // the user's style. Best-effort; never blocks or fails the send.
  if (result.success && input.messageText) {
    await recordOutreachEdit(client, workspaceId, leadId, lead.outreach?.draft_text ?? null, input.messageText);
  }

  return result;
}

// --- LinkedIn connection request ---

async function sendLeadLinkedIn(
  client: InsforgeClient,
  input: SendLeadInput,
  lead: SignalLeadWithContacts,
  duplicateOverride = false,
): Promise<SendLeadResult> {
  const { workspaceId, userId, leadId } = input;
  const contact = lead.primary_contact ?? lead.contacts?.[0] ?? null;
  const identifier = contact?.linkedin_url?.trim() || contact?.provider_id?.trim();
  if (!identifier) return { success: false, error: 'No LinkedIn identifier resolved for this lead.' };

  const messageText = (input.messageText ?? lead.outreach?.draft_text ?? '').trim();
  if (!messageText) return { success: false, error: 'Draft the message before sending.' };
  if (messageText.length > LINKEDIN_CONNECT_NOTE_LIMIT) {
    return { success: false, error: `Connection note exceeds ${LINKEDIN_CONNECT_NOTE_LIMIT} characters.` };
  }

  const accountId = await getLinkedInUnipileAccountId(client, userId, workspaceId);
  if (!accountId) return { success: false, error: 'Connect LinkedIn via Settings before sending outreach.' };

  const usage = checkDailyUsage(accountId, 1);
  if (!usage.allowed) {
    return {
      success: false,
      error: 'Daily LinkedIn action budget reached for this account. Try again tomorrow (UTC).',
    };
  }

  const lookupGuard = await assertLinkedInProfileLookupAllowed(client, workspaceId, { leadId });
  if (!lookupGuard.allowed) {
    return { success: false, error: lookupGuard.reason };
  }

  await logSignalAudit(client, {
    workspace_id: workspaceId,
    action: 'outreach_send_attempt',
    channel: 'linkedin_connect',
    lead_id: leadId,
    social_account_id: accountId,
    // Surface whether the target LinkedIn was verified against Unipile at
    // resolve time. Unverified does NOT block the send (per product decision),
    // but it is recorded so an auto-send to an unchecked URL is never silent.
    metadata: { linkedin_identifier: identifier, linkedin_verified: contact?.linkedin_verified === true },
  });

  let profile;
  try {
    profile = await resolveLinkedInProfile(accountId, identifier);
    await logSignalAudit(client, {
      workspace_id: workspaceId,
      action: 'profile_lookup',
      channel: 'linkedin_connect',
      lead_id: leadId,
      social_account_id: accountId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markLeadOutreachFailed(client, workspaceId, leadId, 'linkedin_connect', msg);
    return { success: false, error: msg };
  }

  await awaitInterCallDelay();

  const sendResult = await sendLinkedInConnectionInvite(accountId, profile.providerId, messageText);
  if (!sendResult.success) {
    await logSignalAudit(client, {
      workspace_id: workspaceId,
      action: 'outreach_blocked',
      channel: 'linkedin_connect',
      lead_id: leadId,
      social_account_id: accountId,
      blocked_reason: sendResult.error,
    });
    await markLeadOutreachFailed(client, workspaceId, leadId, 'linkedin_connect', sendResult.error ?? 'Send failed');
    return { success: false, error: sendResult.error, providerId: profile.providerId };
  }

  incrementDailyUsage(accountId, 1);

  await logSignalAudit(client, {
    workspace_id: workspaceId,
    action: 'outreach_send_success',
    channel: 'linkedin_connect',
    lead_id: leadId,
    social_account_id: accountId,
    metadata: {
      external_id: sendResult.externalId,
      provider_id: profile.providerId,
      ...(duplicateOverride ? { duplicate_override: true } : {}),
    },
  });

  await markLeadOutreachSent(client, workspaceId, leadId, 'linkedin_connect', messageText, {
    providerId: profile.providerId,
    identifier,
    externalId: sendResult.externalId,
  });
  // Advance the sequence so a manual connect approval also queues the follow-up
  // DM step (the auto path re-sets these; harmless). Approval-gated sequences
  // rely on this so the next step surfaces after each approved send.
  await updateLead(client, workspaceId, leadId, {
    lead_status: 'sent',
    nurture_stage: 'connect_sent',
    next_action_at: followUpDmDueAt(),
    playbook: markPlaybookStepDone(lead.playbook, 'connect'),
  });
  await logLeadEvent(client, workspaceId, leadId, 'rescored', { action: 'sent', channel: 'linkedin_connect' });

  const updated = await getLead(client, workspaceId, leadId);
  return { success: true, externalId: sendResult.externalId, providerId: profile.providerId, lead: updated };
}

// --- LinkedIn direct message (1st-degree or InMail fallback) ---

async function sendLeadLinkedInDm(
  client: InsforgeClient,
  input: SendLeadInput,
  lead: SignalLeadWithContacts,
  duplicateOverride = false,
): Promise<SendLeadResult> {
  const { workspaceId, userId, leadId } = input;
  const contact = lead.primary_contact ?? lead.contacts?.[0] ?? null;
  const identifier =
    lead.outreach?.linkedin_provider_id?.trim() ||
    contact?.linkedin_url?.trim() ||
    contact?.provider_id?.trim();
  if (!identifier) return { success: false, error: 'No LinkedIn identifier resolved for this lead.' };

  const messageText = (input.messageText ?? lead.outreach?.draft_text ?? '').trim();
  if (!messageText) return { success: false, error: 'Draft the message before sending.' };

  const accountId = await getLinkedInUnipileAccountId(client, userId, workspaceId);
  if (!accountId) return { success: false, error: 'Connect LinkedIn via Settings before sending outreach.' };

  const usage = checkDailyUsage(accountId, 1);
  if (!usage.allowed) {
    return {
      success: false,
      error: 'Daily LinkedIn action budget reached for this account. Try again tomorrow (UTC).',
    };
  }

  const lookupGuard = await assertLinkedInProfileLookupAllowed(client, workspaceId, { leadId });
  if (!lookupGuard.allowed) {
    return { success: false, error: lookupGuard.reason };
  }

  await logSignalAudit(client, {
    workspace_id: workspaceId,
    action: 'outreach_send_attempt',
    channel: 'linkedin_dm',
    lead_id: leadId,
    social_account_id: accountId,
    // Surface whether the target LinkedIn was verified against Unipile at
    // resolve time. Unverified does NOT block the send (per product decision),
    // but it is recorded so an auto-send to an unchecked URL is never silent.
    metadata: { linkedin_identifier: identifier, linkedin_verified: contact?.linkedin_verified === true },
  });

  let profile;
  try {
    profile = await resolveLinkedInProfile(accountId, identifier);
    await logSignalAudit(client, {
      workspace_id: workspaceId,
      action: 'profile_lookup',
      channel: 'linkedin_dm',
      lead_id: leadId,
      social_account_id: accountId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markLeadOutreachFailed(client, workspaceId, leadId, 'linkedin_dm', msg);
    return { success: false, error: msg };
  }

  await awaitInterCallDelay();

  let sendResult = await sendLinkedInInMail(accountId, profile.providerId, messageText);
  if (
    !sendResult.success &&
    sendResult.error &&
    /connection|not_allowed_inmail|insufficient_credits/i.test(sendResult.error)
  ) {
    sendResult = await sendLinkedInDirectMessage(accountId, profile.providerId, messageText);
  }

  if (!sendResult.success) {
    await logSignalAudit(client, {
      workspace_id: workspaceId,
      action: 'outreach_blocked',
      channel: 'linkedin_dm',
      lead_id: leadId,
      social_account_id: accountId,
      blocked_reason: sendResult.error,
    });
    await markLeadOutreachFailed(client, workspaceId, leadId, 'linkedin_dm', sendResult.error ?? 'Send failed');
    return { success: false, error: sendResult.error, providerId: profile.providerId };
  }

  incrementDailyUsage(accountId, 1);

  await logSignalAudit(client, {
    workspace_id: workspaceId,
    action: 'outreach_send_success',
    channel: 'linkedin_dm',
    lead_id: leadId,
    social_account_id: accountId,
    metadata: {
      external_id: sendResult.externalId,
      provider_id: profile.providerId,
      ...(duplicateOverride ? { duplicate_override: true } : {}),
    },
  });

  await markLeadOutreachSent(client, workspaceId, leadId, 'linkedin_dm', messageText, {
    providerId: profile.providerId,
    identifier,
    externalId: sendResult.externalId,
  });
  await insertLeadMessage(client, {
    workspaceId,
    leadId,
    direction: 'outbound',
    channel: 'linkedin_dm',
    body: messageText,
    externalMessageId: sendResult.externalId ?? null,
    chatId: sendResult.externalId ?? null,
    senderProviderId: profile.providerId,
  }).catch(() => undefined);
  await updateLead(client, workspaceId, leadId, {
    lead_status: 'sent',
    nurture_stage: 'dm_sent',
    playbook: markPlaybookStepDone(lead.playbook, 'dm'),
  });
  await logLeadEvent(client, workspaceId, leadId, 'rescored', { action: 'sent', channel: 'linkedin_dm' });

  const updated = await getLead(client, workspaceId, leadId);
  return { success: true, externalId: sendResult.externalId, providerId: profile.providerId, lead: updated };
}

// --- X direct message ---

async function sendLeadX(
  client: InsforgeClient,
  input: SendLeadInput,
  lead: SignalLeadWithContacts,
  duplicateOverride = false,
): Promise<SendLeadResult> {
  const { workspaceId, userId, leadId } = input;
  const contact = lead.primary_contact ?? lead.contacts?.[0] ?? null;
  const xHandle = contact?.x_handle?.trim();
  if (!xHandle) return { success: false, error: 'No X handle resolved for this lead.' };

  const messageText = (input.messageText ?? lead.outreach?.draft_text ?? '').trim();
  if (!messageText) return { success: false, error: 'Draft the message before sending.' };

  const accountId = await getXUnipileAccountId(client, userId, workspaceId);
  if (!accountId) return { success: false, error: 'Connect X via Settings before sending outreach.' };

  await logSignalAudit(client, {
    workspace_id: workspaceId,
    action: 'outreach_send_attempt',
    channel: 'x_dm',
    lead_id: leadId,
    social_account_id: accountId,
    metadata: { x_identifier: xHandle },
  });

  let profile;
  try {
    profile = await resolveXProfile(accountId, xHandle);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markLeadOutreachFailed(client, workspaceId, leadId, 'x_dm', msg);
    return { success: false, error: msg };
  }

  const sendResult = await sendXDirectMessage(accountId, profile.providerId, messageText);
  if (!sendResult.success) {
    await logSignalAudit(client, {
      workspace_id: workspaceId,
      action: 'outreach_blocked',
      channel: 'x_dm',
      lead_id: leadId,
      social_account_id: accountId,
      blocked_reason: sendResult.error,
    });
    await markLeadOutreachFailed(client, workspaceId, leadId, 'x_dm', sendResult.error ?? 'Send failed');
    return { success: false, error: sendResult.error, providerId: profile.providerId };
  }

  await logSignalAudit(client, {
    workspace_id: workspaceId,
    action: 'outreach_send_success',
    channel: 'x_dm',
    lead_id: leadId,
    social_account_id: accountId,
    metadata: {
      external_id: sendResult.externalId,
      provider_id: profile.providerId,
      ...(duplicateOverride ? { duplicate_override: true } : {}),
    },
  });

  await markLeadOutreachSent(client, workspaceId, leadId, 'x_dm', messageText, {
    providerId: profile.providerId,
    identifier: xHandle,
    externalId: sendResult.externalId,
  });
  await updateLead(client, workspaceId, leadId, { lead_status: 'sent' });
  await logLeadEvent(client, workspaceId, leadId, 'rescored', { action: 'sent', channel: 'x_dm' });

  const updated = await getLead(client, workspaceId, leadId);
  return { success: true, externalId: sendResult.externalId, providerId: profile.providerId, lead: updated };
}

// --- Cold email (Phase 9) ---

async function sendLeadEmail(
  client: InsforgeClient,
  input: SendLeadInput,
  lead: SignalLeadWithContacts,
  duplicateOverride = false,
): Promise<SendLeadResult> {
  const { workspaceId, leadId } = input;

  // Compliance gate: an explicit per-lead opt-in is required for a cold email.
  if (input.emailOptIn !== true) {
    return { success: false, error: 'Confirm the cold-email opt-in before sending.' };
  }

  const contact = lead.primary_contact ?? lead.contacts?.find((c) => c.email) ?? null;
  const to = contact?.email?.trim() || lead.contacts?.find((c) => c.email)?.email?.trim();
  if (!to) return { success: false, error: 'No email address for this lead.' };

  if (lead.outreach?.status === 'sent') {
    return { success: false, error: 'Already contacted - not sending a second cold email.' };
  }

  const integration = await getIntegration(client, workspaceId, 'gmail');
  if (!integration?.enabled) return { success: false, error: 'Connect Gmail in Settings to send email.' };

  const bodyText = (input.messageText ?? lead.outreach?.draft_text ?? '').trim();
  if (!bodyText) return { success: false, error: 'Draft the message before sending.' };
  const settings = await getDirectorySettings(client, workspaceId);
  const body = withComplianceFooter(bodyText, settings.sender_identity);
  const subject = `Quick note for ${lead.company_name}`;

  await logSignalAudit(client, {
    workspace_id: workspaceId,
    action: 'outreach_send_attempt',
    channel: 'gmail',
    lead_id: leadId,
    metadata: { recipient_email: to },
  });

  const sendResult = await sendGmailEmail(integration.composio_user_id, { to, subject, body });
  if (!sendResult.success) {
    await logSignalAudit(client, {
      workspace_id: workspaceId,
      action: 'outreach_blocked',
      channel: 'gmail',
      lead_id: leadId,
      blocked_reason: sendResult.error,
    });
    await markLeadOutreachFailed(client, workspaceId, leadId, 'gmail', sendResult.error ?? 'Send failed');
    return { success: false, error: sendResult.error };
  }

  await logSignalAudit(client, {
    workspace_id: workspaceId,
    action: 'outreach_send_success',
    channel: 'gmail',
    lead_id: leadId,
    metadata: {
      external_id: sendResult.messageId,
      recipient_email: to,
      ...(duplicateOverride ? { duplicate_override: true } : {}),
    },
  });

  await markLeadOutreachSent(client, workspaceId, leadId, 'gmail', body, { identifier: to, externalId: sendResult.messageId });
  await updateLead(client, workspaceId, leadId, { lead_status: 'sent' });
  await logLeadEvent(client, workspaceId, leadId, 'rescored', { action: 'sent', channel: 'gmail' });

  const updated = await getLead(client, workspaceId, leadId);
  return { success: true, externalId: sendResult.messageId, lead: updated };
}

/**
 * Appends the CAN-SPAM/GDPR-minded footer to a cold email. Sender identity is a
 * per-workspace setting (passed in); if blank it falls back to a global
 * OUTREACH_SENDER_IDENTITY env default, and if that is also unset the footer
 * carries just the unsubscribe line. Users can set, leave blank, or use the env
 * default as a placeholder.
 */
export function withComplianceFooter(body: string, senderIdentity?: string | null): string {
  const sender = (senderIdentity?.trim() || process.env.OUTREACH_SENDER_IDENTITY?.trim()) ?? '';
  const identityLine = sender ? `\n\nSent by ${sender}.` : '';
  return `${body}${identityLine}\n\nNot relevant? Reply "unsubscribe" and I won't reach out again.`;
}

// --- Outreach row helpers ---

async function markLeadOutreachSent(
  client: InsforgeClient,
  workspaceId: string,
  leadId: string,
  channel: OutreachChannel,
  finalText: string,
  ids: { providerId?: string; identifier: string; externalId?: string },
): Promise<void> {
  // Bookkeeping after a real provider send: never let a DB write failure
  // convert a successful send into a reported failure (pre-refactor behavior).
  await upsertLeadOutreachRow(client, workspaceId, leadId, {
    channel,
    status: 'sent',
    final_text: finalText,
    linkedin_provider_id: ids.providerId ?? null,
    target_linkedin_identifier: ids.identifier,
    external_message_id: ids.externalId ?? null,
    sent_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).catch(() => undefined);
}

async function markLeadOutreachFailed(
  client: InsforgeClient,
  workspaceId: string,
  leadId: string,
  channel: OutreachChannel,
  error: string,
): Promise<void> {
  await upsertLeadOutreachRow(client, workspaceId, leadId, {
    channel,
    status: 'failed',
    error,
    updated_at: new Date().toISOString(),
  }).catch(() => undefined);
}
