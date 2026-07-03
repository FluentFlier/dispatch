import type { createClient } from '@insforge/sdk';
import { assertOutreachAllowed } from '@/lib/signals/safety';
import { logSignalAudit } from '@/lib/signals/safety/audit';
import { getLead, logLeadEvent, updateLead } from '@/lib/signals/leads/store';
import {
  getLinkedInUnipileAccountId,
  resolveLinkedInProfile,
  sendLinkedInConnectionInvite,
} from '@/lib/signals/outreach/unipile-linkedin';
import { sendGmailEmail } from '@/lib/composio/actions/gmail';
import { getIntegration } from '@/lib/signals/integrations/store';
import type { OutreachChannel, SignalLeadWithContacts } from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

const CONNECT_NOTE_LIMIT = 300;

/** v1 lead channels: LinkedIn connection request (default) or cold email. */
export type LeadChannel = Extract<OutreachChannel, 'linkedin_connect' | 'gmail'>;

export interface SendLeadInput {
  workspaceId: string;
  userId: string;
  leadId: string;
  channel?: LeadChannel;
  messageText?: string;
  /** Required true to send a cold email (per-lead compliance opt-in). */
  emailOptIn?: boolean;
  now?: Date;
}

export interface SendLeadResult {
  success: boolean;
  error?: string;
  retryAfterSeconds?: number;
  externalId?: string;
  providerId?: string;
  lead?: SignalLeadWithContacts | null;
}

/**
 * Sends a directory lead's outreach through the SAME safety guard and provider
 * primitives as event outreach, keyed on lead_id. Kept separate from
 * sendSignalOutreach so the proven event path is untouched. assertOutreachAllowed
 * applies every gate (dry-run, working hours, cooldown, per-channel daily cap),
 * so both LinkedIn invites and cold emails are rate-limited and cooldown-spaced —
 * a code bug cannot spam because each send must clear the cooldown + daily cap.
 */
export async function sendLeadOutreach(
  client: InsforgeClient,
  input: SendLeadInput,
): Promise<SendLeadResult> {
  const { workspaceId, userId, leadId } = input;
  const channel: LeadChannel = input.channel ?? 'linkedin_connect';

  const guard = await assertOutreachAllowed(client, workspaceId, channel, { leadId, now: input.now });
  if (!guard.allowed) {
    return { success: false, error: guard.reason, retryAfterSeconds: guard.retryAfterSeconds };
  }

  const lead = await getLead(client, workspaceId, leadId);
  if (!lead) return { success: false, error: 'Lead not found.' };
  if (lead.contact_status === 'no_contact') {
    return { success: false, error: 'No reachable contact for this lead.' };
  }

  return channel === 'gmail'
    ? sendLeadEmail(client, input, lead)
    : sendLeadLinkedIn(client, input, lead);
}

// --- LinkedIn connection request ---

async function sendLeadLinkedIn(
  client: InsforgeClient,
  input: SendLeadInput,
  lead: SignalLeadWithContacts,
): Promise<SendLeadResult> {
  const { workspaceId, userId, leadId } = input;
  const contact = lead.primary_contact ?? lead.contacts?.[0] ?? null;
  const identifier = contact?.linkedin_url?.trim() || contact?.provider_id?.trim();
  if (!identifier) return { success: false, error: 'No LinkedIn identifier resolved for this lead.' };

  const messageText = (input.messageText ?? lead.outreach?.draft_text ?? '').trim();
  if (!messageText) return { success: false, error: 'Draft the message before sending.' };
  if (messageText.length > CONNECT_NOTE_LIMIT) {
    return { success: false, error: `Connection note exceeds ${CONNECT_NOTE_LIMIT} characters.` };
  }

  const accountId = await getLinkedInUnipileAccountId(client, userId, workspaceId);
  if (!accountId) return { success: false, error: 'Connect LinkedIn via Settings before sending outreach.' };

  await logSignalAudit(client, {
    workspace_id: workspaceId,
    action: 'outreach_send_attempt',
    channel: 'linkedin_connect',
    lead_id: leadId,
    social_account_id: accountId,
    metadata: { linkedin_identifier: identifier },
  });

  let profile;
  try {
    profile = await resolveLinkedInProfile(accountId, identifier);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markLeadOutreachFailed(client, workspaceId, leadId, 'linkedin_connect', msg);
    return { success: false, error: msg };
  }

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

  await logSignalAudit(client, {
    workspace_id: workspaceId,
    action: 'outreach_send_success',
    channel: 'linkedin_connect',
    lead_id: leadId,
    social_account_id: accountId,
    metadata: { external_id: sendResult.externalId, provider_id: profile.providerId },
  });

  await markLeadOutreachSent(client, workspaceId, leadId, 'linkedin_connect', messageText, {
    providerId: profile.providerId,
    identifier,
    externalId: sendResult.externalId,
  });
  await updateLead(client, workspaceId, leadId, { lead_status: 'sent' });
  await logLeadEvent(client, workspaceId, leadId, 'rescored', { action: 'sent', channel: 'linkedin_connect' });

  const updated = await getLead(client, workspaceId, leadId);
  return { success: true, externalId: sendResult.externalId, providerId: profile.providerId, lead: updated };
}

// --- Cold email (Phase 9) ---

async function sendLeadEmail(
  client: InsforgeClient,
  input: SendLeadInput,
  lead: SignalLeadWithContacts,
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
    return { success: false, error: 'Already contacted — not sending a second cold email.' };
  }

  const integration = await getIntegration(client, workspaceId, 'gmail');
  if (!integration?.enabled) return { success: false, error: 'Connect Gmail in Settings to send email.' };

  const bodyText = (input.messageText ?? lead.outreach?.draft_text ?? '').trim();
  if (!bodyText) return { success: false, error: 'Draft the message before sending.' };
  const body = withComplianceFooter(bodyText);
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
    metadata: { external_id: sendResult.messageId, recipient_email: to },
  });

  await markLeadOutreachSent(client, workspaceId, leadId, 'gmail', body, { identifier: to, externalId: sendResult.messageId });
  await updateLead(client, workspaceId, leadId, { lead_status: 'sent' });
  await logLeadEvent(client, workspaceId, leadId, 'rescored', { action: 'sent', channel: 'gmail' });

  const updated = await getLead(client, workspaceId, leadId);
  return { success: true, externalId: sendResult.messageId, lead: updated };
}

/** Appends CAN-SPAM/GDPR-minded sender identity + unsubscribe line to a cold email. */
export function withComplianceFooter(body: string): string {
  const sender = process.env.OUTREACH_SENDER_IDENTITY?.trim();
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
  await upsertLeadOutreach(client, leadId, {
    workspace_id: workspaceId,
    lead_id: leadId,
    channel,
    status: 'sent',
    final_text: finalText,
    linkedin_provider_id: ids.providerId ?? null,
    target_linkedin_identifier: ids.identifier,
    external_message_id: ids.externalId ?? null,
    sent_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

async function markLeadOutreachFailed(
  client: InsforgeClient,
  workspaceId: string,
  leadId: string,
  channel: OutreachChannel,
  error: string,
): Promise<void> {
  await upsertLeadOutreach(client, leadId, {
    workspace_id: workspaceId,
    lead_id: leadId,
    channel,
    status: 'failed',
    error,
    updated_at: new Date().toISOString(),
  });
}

/** Update-or-insert the single outreach row for a lead (unique on lead_id). */
async function upsertLeadOutreach(
  client: InsforgeClient,
  leadId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { data: existing } = await client.database
    .from('signal_outreach')
    .select('id')
    .eq('lead_id', leadId)
    .maybeSingle();
  if (existing?.id) {
    await client.database.from('signal_outreach').update(payload).eq('id', (existing as { id: string }).id);
  } else {
    await client.database.from('signal_outreach').insert(payload);
  }
}
