import type { createClient } from '@insforge/sdk';
import { assertOutreachAllowed } from '@/lib/signals/safety/guard';
import { logSignalAudit } from '@/lib/signals/safety/audit';
import {
  getLinkedInUnipileAccountId,
  resolveLinkedInProfile,
  sendLinkedInConnectionInvite,
  sendLinkedInDirectMessage,
} from '@/lib/signals/outreach/unipile-linkedin';
import { enforceConnectLimit } from '@/lib/signals/outreach/enforce-limit';
import { getWarmContact } from '@/lib/social-graph/warm-contacts';

type InsforgeClient = ReturnType<typeof createClient>;

export interface SendWarmContactResult {
  ok: boolean;
  status: 'sent' | 'blocked' | 'error';
  message: string;
  retryAfterSeconds?: number;
  externalId?: string;
}

/**
 * Sends a LinkedIn connect invite for a warm contact using Unipile, gated by
 * Signals safety settings (cooldowns, caps, dry-run, working hours).
 */
export async function sendWarmContactConnect(
  client: InsforgeClient,
  workspaceId: string,
  userId: string,
  contactId: string,
  opts: { noteOverride?: string } = {},
): Promise<SendWarmContactResult> {
  const contact = await getWarmContact(client, userId, contactId);
  if (!contact) {
    return { ok: false, status: 'error', message: 'Warm contact not found' };
  }

  if (contact.platform !== 'linkedin') {
    return {
      ok: false,
      status: 'error',
      message: 'Connect invites are only supported for LinkedIn warm contacts',
    };
  }

  if (contact.status === 'sent') {
    return { ok: false, status: 'error', message: 'Connection invite already sent' };
  }

  if (contact.status === 'dismissed') {
    return { ok: false, status: 'error', message: 'Contact was dismissed' };
  }

  const guard = await assertOutreachAllowed(client, workspaceId, 'linkedin_connect');
  if (!guard.allowed) {
    return {
      ok: false,
      status: 'blocked',
      message: guard.reason ?? 'Outreach blocked by safety settings',
      retryAfterSeconds: guard.retryAfterSeconds,
    };
  }

  const rawNote = opts.noteOverride ?? contact.outreach_draft;
  if (!rawNote?.trim()) {
    return {
      ok: false,
      status: 'error',
      message: 'Draft a connect note before sending',
    };
  }

  const note = enforceConnectLimit(rawNote.trim());

  const accountId = await getLinkedInUnipileAccountId(client, userId, workspaceId);
  if (!accountId) {
    return {
      ok: false,
      status: 'error',
      message: 'Connect LinkedIn via Settings before sending outreach',
    };
  }

  let providerId = contact.provider_profile_id;
  if (!providerId && contact.public_identifier) {
    const resolved = await resolveLinkedInProfile(accountId, contact.public_identifier);
    providerId = resolved.providerId;
    await client.database
      .from('warm_contacts')
      .update({
        provider_profile_id: providerId,
        public_identifier: resolved.publicIdentifier ?? contact.public_identifier,
      })
      .eq('id', contactId)
      .eq('user_id', userId);
  }

  if (!providerId) {
    return {
      ok: false,
      status: 'error',
      message: 'Could not resolve LinkedIn profile for this contact',
    };
  }

  await logSignalAudit(client, {
    workspace_id: workspaceId,
    action: 'outreach_send_attempt',
    channel: 'linkedin_connect',
    social_account_id: accountId,
    metadata: { warm_contact_id: contactId, source: 'warm_contacts' },
  });

  const sendResult = await sendLinkedInConnectionInvite(accountId, providerId, note);
  if (!sendResult.success) {
    const message = sendResult.error ?? 'Send failed';
    await logSignalAudit(client, {
      workspace_id: workspaceId,
      action: 'outreach_blocked',
      channel: 'linkedin_connect',
      blocked_reason: message,
      metadata: { warm_contact_id: contactId, source: 'warm_contacts' },
    });
    return { ok: false, status: 'error', message };
  }

  await logSignalAudit(client, {
    workspace_id: workspaceId,
    action: 'outreach_send_success',
    channel: 'linkedin_connect',
    social_account_id: accountId,
    metadata: { warm_contact_id: contactId, source: 'warm_contacts', external_id: sendResult.externalId },
  });

  await client.database
    .from('warm_contacts')
    .update({
      status: 'sent',
      outreach_draft: note,
      updated_at: new Date().toISOString(),
    })
    .eq('id', contactId)
    .eq('user_id', userId);

  return {
    ok: true,
    status: 'sent',
    message: 'Connection invite sent',
    externalId: sendResult.externalId,
  };
}

/**
 * Sends a LinkedIn DM to a warm contact (used as the accepted-connection
 * follow-up in the engager nurture sequence), gated by the same Signals safety
 * envelope as connects. Unlike connect, this does NOT flip status to 'sent'
 * (that terminal state means "connect invite sent"); the engager nurture engine
 * owns the nurture_stage transition to 'dm_sent'.
 */
export async function sendWarmContactDm(
  client: InsforgeClient,
  workspaceId: string,
  userId: string,
  contactId: string,
  opts: { messageOverride?: string } = {},
): Promise<SendWarmContactResult> {
  const contact = await getWarmContact(client, userId, contactId);
  if (!contact) {
    return { ok: false, status: 'error', message: 'Warm contact not found' };
  }

  if (contact.platform !== 'linkedin') {
    return { ok: false, status: 'error', message: 'DMs are only supported for LinkedIn warm contacts' };
  }

  if (contact.status === 'dismissed') {
    return { ok: false, status: 'error', message: 'Contact was dismissed' };
  }

  const guard = await assertOutreachAllowed(client, workspaceId, 'linkedin_dm');
  if (!guard.allowed) {
    return {
      ok: false,
      status: 'blocked',
      message: guard.reason ?? 'Outreach blocked by safety settings',
      retryAfterSeconds: guard.retryAfterSeconds,
    };
  }

  const message = (opts.messageOverride ?? contact.outreach_draft)?.trim();
  if (!message) {
    return { ok: false, status: 'error', message: 'Draft a DM before sending' };
  }

  const accountId = await getLinkedInUnipileAccountId(client, userId, workspaceId);
  if (!accountId) {
    return {
      ok: false,
      status: 'error',
      message: 'Connect LinkedIn via Settings before sending outreach',
    };
  }

  let providerId = contact.provider_profile_id;
  if (!providerId && contact.public_identifier) {
    const resolved = await resolveLinkedInProfile(accountId, contact.public_identifier);
    providerId = resolved.providerId;
    await client.database
      .from('warm_contacts')
      .update({
        provider_profile_id: providerId,
        public_identifier: resolved.publicIdentifier ?? contact.public_identifier,
      })
      .eq('id', contactId)
      .eq('user_id', userId);
  }

  if (!providerId) {
    return { ok: false, status: 'error', message: 'Could not resolve LinkedIn profile for this contact' };
  }

  await logSignalAudit(client, {
    workspace_id: workspaceId,
    action: 'outreach_send_attempt',
    channel: 'linkedin_dm',
    social_account_id: accountId,
    metadata: { warm_contact_id: contactId, source: 'warm_contacts' },
  });

  const sendResult = await sendLinkedInDirectMessage(accountId, providerId, message);
  if (!sendResult.success) {
    const failure = sendResult.error ?? 'Send failed';
    await logSignalAudit(client, {
      workspace_id: workspaceId,
      action: 'outreach_blocked',
      channel: 'linkedin_dm',
      blocked_reason: failure,
      metadata: { warm_contact_id: contactId, source: 'warm_contacts' },
    });
    return { ok: false, status: 'error', message: failure };
  }

  await logSignalAudit(client, {
    workspace_id: workspaceId,
    action: 'outreach_send_success',
    channel: 'linkedin_dm',
    social_account_id: accountId,
    metadata: { warm_contact_id: contactId, source: 'warm_contacts', external_id: sendResult.externalId },
  });

  await client.database
    .from('warm_contacts')
    .update({ outreach_draft: message, updated_at: new Date().toISOString() })
    .eq('id', contactId)
    .eq('user_id', userId);

  return { ok: true, status: 'sent', message: 'DM sent', externalId: sendResult.externalId };
}
