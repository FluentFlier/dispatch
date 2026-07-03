import type { createClient } from '@insforge/sdk';
import { assertOutreachAllowed } from '@/lib/signals/safety';
import { logSignalAudit } from '@/lib/signals/safety/audit';
import { getLead, logLeadEvent, updateLead } from '@/lib/signals/leads/store';
import {
  getLinkedInUnipileAccountId,
  resolveLinkedInProfile,
  sendLinkedInConnectionInvite,
} from '@/lib/signals/outreach/unipile-linkedin';
import type { OutreachChannel, SignalLeadWithContacts } from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

const CONNECT_NOTE_LIMIT = 300;

export interface SendLeadInput {
  workspaceId: string;
  userId: string;
  leadId: string;
  /** Directory leads default to a LinkedIn connection request in v1. */
  channel?: Extract<OutreachChannel, 'linkedin_connect'>;
  messageText?: string;
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
 * Sends a directory lead's outreach through the SAME safety guard and Unipile
 * primitives as event outreach, but keyed on lead_id. Kept separate from
 * sendSignalOutreach so the proven event send path is untouched. Reuses
 * assertOutreachAllowed → all caps/cooldown/working-hours/dry-run gates apply,
 * and logs outreach_send_success with channel `linkedin_connect` so lead sends
 * count against the same daily/weekly LinkedIn invite limits.
 */
export async function sendLeadOutreach(
  client: InsforgeClient,
  input: SendLeadInput,
): Promise<SendLeadResult> {
  const { workspaceId, userId, leadId } = input;
  const channel: OutreachChannel = input.channel ?? 'linkedin_connect';

  // Safety gate first (reused, unchanged) — leadId flows into the block audit.
  const guard = await assertOutreachAllowed(client, workspaceId, channel, { leadId, now: input.now });
  if (!guard.allowed) {
    return { success: false, error: guard.reason, retryAfterSeconds: guard.retryAfterSeconds };
  }

  const lead = await getLead(client, workspaceId, leadId);
  if (!lead) return { success: false, error: 'Lead not found.' };
  if (lead.contact_status === 'no_contact') {
    return { success: false, error: 'No reachable contact for this lead.' };
  }

  const contact = lead.primary_contact ?? lead.contacts?.[0] ?? null;
  const identifier = contact?.linkedin_url?.trim() || contact?.provider_id?.trim();
  if (!identifier) {
    return { success: false, error: 'No LinkedIn identifier resolved for this lead.' };
  }

  const messageText = (input.messageText ?? lead.outreach?.draft_text ?? '').trim();
  if (!messageText) return { success: false, error: 'Draft the message before sending.' };
  if (messageText.length > CONNECT_NOTE_LIMIT) {
    return { success: false, error: `Connection note exceeds ${CONNECT_NOTE_LIMIT} characters.` };
  }

  const accountId = await getLinkedInUnipileAccountId(client, userId, workspaceId);
  if (!accountId) {
    return { success: false, error: 'Connect LinkedIn via Settings before sending outreach.' };
  }

  await logSignalAudit(client, {
    workspace_id: workspaceId,
    action: 'outreach_send_attempt',
    channel,
    lead_id: leadId,
    social_account_id: accountId,
    metadata: { linkedin_identifier: identifier },
  });

  let profile;
  try {
    profile = await resolveLinkedInProfile(accountId, identifier);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markLeadOutreachFailed(client, workspaceId, leadId, channel, msg);
    return { success: false, error: msg };
  }

  const sendResult = await sendLinkedInConnectionInvite(accountId, profile.providerId, messageText);
  if (!sendResult.success) {
    await logSignalAudit(client, {
      workspace_id: workspaceId,
      action: 'outreach_blocked',
      channel,
      lead_id: leadId,
      social_account_id: accountId,
      blocked_reason: sendResult.error,
    });
    await markLeadOutreachFailed(client, workspaceId, leadId, channel, sendResult.error ?? 'Send failed');
    return { success: false, error: sendResult.error, providerId: profile.providerId };
  }

  await logSignalAudit(client, {
    workspace_id: workspaceId,
    action: 'outreach_send_success',
    channel,
    lead_id: leadId,
    social_account_id: accountId,
    metadata: { external_id: sendResult.externalId, provider_id: profile.providerId },
  });

  await markLeadOutreachSent(client, workspaceId, leadId, channel, messageText, profile.providerId, identifier, sendResult.externalId);
  await updateLead(client, workspaceId, leadId, { lead_status: 'sent' });
  await logLeadEvent(client, workspaceId, leadId, 'rescored', { action: 'sent' });

  const updated = await getLead(client, workspaceId, leadId);
  return { success: true, externalId: sendResult.externalId, providerId: profile.providerId, lead: updated };
}

/** Upserts the lead's outreach row to `sent`. */
async function markLeadOutreachSent(
  client: InsforgeClient,
  workspaceId: string,
  leadId: string,
  channel: OutreachChannel,
  finalText: string,
  providerId: string,
  identifier: string,
  externalId?: string,
): Promise<void> {
  const payload = {
    workspace_id: workspaceId,
    lead_id: leadId,
    channel,
    status: 'sent',
    final_text: finalText,
    linkedin_provider_id: providerId,
    target_linkedin_identifier: identifier,
    external_message_id: externalId ?? null,
    sent_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await upsertLeadOutreach(client, leadId, payload);
}

/** Upserts the lead's outreach row to `failed` with the error. */
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
