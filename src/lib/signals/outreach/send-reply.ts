import type { createClient } from '@insforge/sdk';
import { assertOutreachAllowed } from '@/lib/signals/safety';
import { awaitInterCallDelay } from '@/lib/signals/safety/humanize';
import { logSignalAudit } from '@/lib/signals/safety/audit';
import { getLead, logLeadEvent, updateLead } from '@/lib/signals/leads/store';
import { insertLeadMessage } from '@/lib/signals/leads/messages';
import { incrementDailyUsage } from '@/lib/social/reliability';
import {
  getLinkedInUnipileAccountId,
  resolveLinkedInProfile,
  sendLinkedInChatMessage,
  sendLinkedInDirectMessage,
} from '@/lib/signals/outreach/unipile-linkedin';
import { recordOutreachEdit } from '@/lib/signals/outreach/edit-feedback';
import { upsertLeadOutreachRow } from '@/lib/gtm/nurture/shared';
import type { SignalLeadWithContacts } from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

export interface SendLeadReplyInput {
  workspaceId: string;
  userId: string;
  leadId: string;
  messageText?: string;
  now?: Date;
}

export interface SendLeadReplyResult {
  success: boolean;
  error?: string;
  retryAfterSeconds?: number;
  externalId?: string;
  lead?: SignalLeadWithContacts | null;
}

/**
 * Sends a reply in an active LinkedIn thread. Prefers the stored chat_id from
 * the inbound webhook; falls back to opening a DM via provider id.
 */
export async function sendLeadReply(
  client: InsforgeClient,
  input: SendLeadReplyInput,
): Promise<SendLeadReplyResult> {
  const { workspaceId, userId, leadId } = input;
  const guard = await assertOutreachAllowed(client, workspaceId, 'linkedin_dm', {
    leadId,
    now: input.now,
  });
  if (!guard.allowed) {
    return { success: false, error: guard.reason, retryAfterSeconds: guard.retryAfterSeconds };
  }

  const lead = await getLead(client, workspaceId, leadId);
  if (!lead) return { success: false, error: 'Lead not found.' };

  const messageText = (input.messageText ?? lead.outreach?.draft_text ?? '').trim();
  if (!messageText) return { success: false, error: 'Draft the reply before sending.' };

  const accountId = await getLinkedInUnipileAccountId(client, userId, workspaceId);
  if (!accountId) {
    return { success: false, error: 'Connect LinkedIn via Settings before sending replies.' };
  }

  await logSignalAudit(client, {
    workspace_id: workspaceId,
    action: 'outreach_send_attempt',
    channel: 'linkedin_dm',
    lead_id: leadId,
    social_account_id: accountId,
    metadata: { kind: 'reply', chat_id: lead.unipile_chat_id ?? null },
  });

  await awaitInterCallDelay();

  let sendResult;
  const chatId = lead.unipile_chat_id?.trim();
  if (chatId) {
    sendResult = await sendLinkedInChatMessage(accountId, chatId, messageText);
  } else {
    const contact = lead.primary_contact ?? lead.contacts?.[0] ?? null;
    const identifier =
      contact?.linkedin_url?.trim() ||
      lead.outreach?.target_linkedin_identifier?.trim() ||
      null;
    if (!identifier) {
      return { success: false, error: 'No LinkedIn profile to reply to.' };
    }
    const profile = await resolveLinkedInProfile(accountId, identifier);
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
    return { success: false, error: sendResult.error ?? 'Reply send failed.' };
  }

  incrementDailyUsage(accountId, 1);

  await insertLeadMessage(client, {
    workspaceId,
    leadId,
    direction: 'outbound',
    channel: 'linkedin_dm',
    body: messageText,
    externalMessageId: sendResult.externalId ?? null,
    chatId: chatId ?? null,
  });

  const nowIso = new Date().toISOString();
  // Bookkeeping after a real provider send: a DB write failure must not turn
  // an already-sent reply into an error (pre-refactor behavior).
  await upsertLeadOutreachRow(client, workspaceId, leadId, {
    final_text: messageText,
    status: 'sent',
    sent_at: nowIso,
    draft_text: messageText,
  }).catch(() => undefined);

  await updateLead(client, workspaceId, leadId, {
    needs_reply: false,
    nurture_stage: 'in_conversation',
    lead_status: 'sent',
  });

  await logLeadEvent(client, workspaceId, leadId, 'rescored', {
    action: 'reply_sent',
    preview: messageText.slice(0, 160),
  });

  await logSignalAudit(client, {
    workspace_id: workspaceId,
    action: 'outreach_send_success',
    channel: 'linkedin_dm',
    lead_id: leadId,
    social_account_id: accountId,
    metadata: { kind: 'reply', external_id: sendResult.externalId },
  });

  if (input.messageText && lead.outreach?.draft_text) {
    await recordOutreachEdit(
      client,
      workspaceId,
      leadId,
      lead.outreach.draft_text,
      input.messageText,
    );
  }

  const updated = await getLead(client, workspaceId, leadId);
  return { success: true, externalId: sendResult.externalId, lead: updated };
}
