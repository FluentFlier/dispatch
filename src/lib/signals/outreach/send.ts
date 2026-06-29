import type { createClient } from '@insforge/sdk';
import { assertOutreachAllowed } from '@/lib/signals/safety';
import { logSignalAudit } from '@/lib/signals/safety/audit';
import { getEvent, updateEventStatus } from '@/lib/signals/store';
import type { OutreachChannel, SignalEventWithPost } from '@/lib/signals/types';
import {
  getInMailBalance,
  getLinkedInUnipileAccountId,
  resolveLinkedInProfile,
  sendLinkedInConnectionInvite,
  sendLinkedInDirectMessage,
  sendLinkedInInMail,
} from '@/lib/signals/outreach/unipile-linkedin';
import { sendGmailEmail } from '@/lib/composio/actions/gmail';
import { getIntegration } from '@/lib/signals/integrations/store';

type InsforgeClient = ReturnType<typeof createClient>;

export interface SendOutreachInput {
  workspaceId: string;
  userId: string;
  eventId: string;
  channel: OutreachChannel;
  linkedinIdentifier?: string;
  recipientEmail?: string;
  emailSubject?: string;
  messageText?: string;
}

export interface SendOutreachResult {
  success: boolean;
  error?: string;
  externalId?: string;
  providerId?: string;
  inmailCreditsRemaining?: number | null;
  event?: SignalEventWithPost | null;
}

async function markOutreachSent(
  client: InsforgeClient,
  workspaceId: string,
  eventId: string,
  channel: OutreachChannel,
  finalText: string,
  providerId: string,
  linkedinIdentifier: string,
  externalId?: string,
): Promise<void> {
  const { data: existing } = await client.database
    .from('signal_outreach')
    .select('id')
    .eq('event_id', eventId)
    .maybeSingle();

  const payload = {
    workspace_id: workspaceId,
    event_id: eventId,
    channel,
    status: 'sent',
    final_text: finalText,
    linkedin_provider_id: providerId,
    target_linkedin_identifier: linkedinIdentifier,
    external_message_id: externalId ?? null,
    sent_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (existing?.id) {
    await client.database.from('signal_outreach').update(payload).eq('id', existing.id);
  } else {
    await client.database.from('signal_outreach').insert(payload);
  }

  await updateEventStatus(client, workspaceId, eventId, 'sent');
}

async function markOutreachFailed(
  client: InsforgeClient,
  workspaceId: string,
  eventId: string,
  channel: OutreachChannel,
  error: string,
): Promise<void> {
  const { data: existing } = await client.database
    .from('signal_outreach')
    .select('id')
    .eq('event_id', eventId)
    .maybeSingle();

  if (existing?.id) {
    await client.database
      .from('signal_outreach')
      .update({ status: 'failed', error, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
  } else {
    await client.database.from('signal_outreach').insert({
      workspace_id: workspaceId,
      event_id: eventId,
      channel,
      status: 'failed',
      error,
    });
  }

  await updateEventStatus(client, workspaceId, eventId, 'failed');
}

function resolveMessageText(event: SignalEventWithPost, override?: string): string {
  const text = override?.trim() || event.outreach?.draft_text?.trim();
  if (!text) {
    throw new Error('No outreach message. Generate a draft first or provide message_text.');
  }
  return text;
}

export async function sendSignalOutreach(
  client: InsforgeClient,
  input: SendOutreachInput,
): Promise<SendOutreachResult> {
  const { workspaceId, userId, eventId, channel } = input;

  if (channel === 'copy') {
    return { success: false, error: 'Copy channel does not send via API.' };
  }

  if (channel === 'x_dm') {
    return { success: false, error: 'X DM send is not wired yet. Use copy for now.' };
  }

  const guard = await assertOutreachAllowed(client, workspaceId, channel, { eventId });
  if (!guard.allowed) {
    return { success: false, error: guard.reason ?? 'Outreach blocked by safety settings.' };
  }

  const event = await getEvent(client, workspaceId, eventId);
  if (!event) return { success: false, error: 'Signal not found.' };

  const messageText = resolveMessageText(event, input.messageText);

  if (channel === 'gmail') {
    const recipient = input.recipientEmail?.trim();
    if (!recipient) {
      return { success: false, error: 'recipient_email is required for Gmail outreach.' };
    }

    const integration = await getIntegration(client, workspaceId, 'gmail');
    if (!integration?.enabled) {
      return { success: false, error: 'Connect Gmail in Settings to send email.' };
    }

    const target = event.company_name || event.person_name || 'prospect';
    const subject = input.emailSubject?.trim() || `Re: ${target}`;

    await logSignalAudit(client, {
      workspace_id: workspaceId,
      action: 'outreach_send_attempt',
      channel,
      event_id: eventId,
      metadata: { recipient_email: recipient },
    });

    const sendResult = await sendGmailEmail(integration.composio_user_id, {
      to: recipient,
      subject,
      body: messageText,
    });

    if (!sendResult.success) {
      await markOutreachFailed(client, workspaceId, eventId, channel, sendResult.error ?? 'Send failed');
      return { success: false, error: sendResult.error };
    }

    await logSignalAudit(client, {
      workspace_id: workspaceId,
      action: 'outreach_send_success',
      channel,
      event_id: eventId,
      metadata: { external_id: sendResult.messageId, recipient_email: recipient },
    });

    await markOutreachSent(
      client,
      workspaceId,
      eventId,
      channel,
      messageText,
      recipient,
      recipient,
      sendResult.messageId,
    );

    const updatedEvent = await getEvent(client, workspaceId, eventId);
    return { success: true, externalId: sendResult.messageId, event: updatedEvent };
  }

  const linkedinIdentifier = input.linkedinIdentifier?.trim();
  if (!linkedinIdentifier) {
    return { success: false, error: 'linkedin_identifier is required for LinkedIn outreach.' };
  }

  const accountId = await getLinkedInUnipileAccountId(client, userId, workspaceId);
  if (!accountId) {
    return {
      success: false,
      error: 'Connect LinkedIn via Settings before sending outreach.',
    };
  }

  await logSignalAudit(client, {
    workspace_id: workspaceId,
    action: 'outreach_send_attempt',
    channel,
    event_id: eventId,
    social_account_id: accountId,
    metadata: { linkedin_identifier: linkedinIdentifier },
  });

  let profile;
  try {
    profile = await resolveLinkedInProfile(accountId, linkedinIdentifier);
    await logSignalAudit(client, {
      workspace_id: workspaceId,
      action: 'profile_lookup',
      channel,
      event_id: eventId,
      social_account_id: accountId,
      metadata: { provider_id: profile.providerId },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markOutreachFailed(client, workspaceId, eventId, channel, msg);
    return { success: false, error: msg };
  }

  let sendResult;
  if (channel === 'linkedin_connect') {
    sendResult = await sendLinkedInConnectionInvite(
      accountId,
      profile.providerId,
      messageText,
    );
  } else if (channel === 'linkedin_dm') {
    sendResult = await sendLinkedInInMail(accountId, profile.providerId, messageText);
    if (
      !sendResult.success &&
      sendResult.error &&
      /connection|not_allowed_inmail|insufficient_credits/i.test(sendResult.error)
    ) {
      sendResult = await sendLinkedInDirectMessage(accountId, profile.providerId, messageText);
    }
  } else {
    return { success: false, error: 'Unsupported channel.' };
  }

  if (!sendResult.success) {
    await logSignalAudit(client, {
      workspace_id: workspaceId,
      action: 'outreach_blocked',
      channel,
      event_id: eventId,
      social_account_id: accountId,
      blocked_reason: sendResult.error,
    });
    await markOutreachFailed(client, workspaceId, eventId, channel, sendResult.error ?? 'Send failed');
    return { success: false, error: sendResult.error, providerId: profile.providerId };
  }

  await logSignalAudit(client, {
    workspace_id: workspaceId,
    action: 'outreach_send_success',
    channel,
    event_id: eventId,
    social_account_id: accountId,
    metadata: { external_id: sendResult.externalId, provider_id: profile.providerId },
  });

  await markOutreachSent(
    client,
    workspaceId,
    eventId,
    channel,
    messageText,
    profile.providerId,
    linkedinIdentifier,
    sendResult.externalId,
  );

  const balance = channel === 'linkedin_dm' ? await getInMailBalance(accountId) : null;
  const updatedEvent = await getEvent(client, workspaceId, eventId);

  return {
    success: true,
    externalId: sendResult.externalId,
    providerId: profile.providerId,
    inmailCreditsRemaining: balance?.available ?? null,
    event: updatedEvent,
  };
}
