import type { createClient } from '@insforge/sdk';
import { parseLinkedInPublicIdentifier } from '@/lib/signals/outreach/unipile-linkedin';
import { getLead, logLeadEvent, updateLead } from '@/lib/signals/leads/store';
import { insertLeadMessage, listLeadMessages, type SignalLeadMessageRow } from '@/lib/signals/leads/messages';
import { logInfo } from '@/lib/logger';

type InsforgeClient = ReturnType<typeof createClient>;

/** Normalized inbound message extracted from Unipile webhook payloads (v1 + v2). */
export interface ParsedInboundMessage {
  accountId: string;
  messageId: string | null;
  chatId: string | null;
  text: string;
  senderProviderId: string | null;
  senderPublicId: string | null;
  isFromSelf: boolean;
  sentAt: string;
  channel: 'linkedin_dm' | 'x_dm';
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function readBool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1;
}

function pickMessageObject(payload: Record<string, unknown>): Record<string, unknown> | null {
  const nested = payload.message ?? payload.payload ?? payload.data;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return null;
}

/** Parses Unipile v1 (`message_received`) and v2 (`message.new`) webhook bodies. */
export function parseUnipileInboundMessage(payload: Record<string, unknown>): ParsedInboundMessage | null {
  const eventType = readString(payload.event) ?? readString(payload.type);
  const isMessageEvent =
    eventType === 'message_received' ||
    eventType === 'message.new' ||
    eventType === 'message.created';

  const message = pickMessageObject(payload);
  if (!isMessageEvent && !message) return null;
  if (!message) return null;

  const accountId = readString(payload.account_id) ?? readString(payload.accountId);
  if (!accountId) return null;

  const text =
    readString(message.text) ??
    readString(message.body) ??
    readString(message.content) ??
    readString((message as { message?: string }).message);

  if (!text) return null;

  const sender =
    message.sender && typeof message.sender === 'object'
      ? (message.sender as Record<string, unknown>)
      : null;

  const senderProviderId =
    readString(message.sender_id) ??
    readString(message.sender_provider_id) ??
    readString(sender?.provider_id) ??
    readString(sender?.id);

  const senderPublicId =
    readString(message.sender_public_identifier) ??
    readString(sender?.public_identifier) ??
    (readString(sender?.profile_url)
      ? parseLinkedInPublicIdentifier(readString(sender?.profile_url)!)
      : null);

  const isFromSelf =
    readBool(message.is_sender) ||
    readBool(message.from_me) ||
    readBool(message.is_from_me);

  const provider = readString(message.provider) ?? readString(payload.provider) ?? 'linkedin';
  const channel: ParsedInboundMessage['channel'] = provider === 'twitter' || provider === 'x' ? 'x_dm' : 'linkedin_dm';

  return {
    accountId,
    messageId: readString(message.id) ?? readString(message.message_id),
    chatId: readString(message.chat_id) ?? readString(message.thread_id),
    text,
    senderProviderId,
    senderPublicId,
    isFromSelf,
    sentAt:
      readString(message.timestamp) ??
      readString(message.sent_at) ??
      readString(message.created_at) ??
      new Date().toISOString(),
    channel,
  };
}

async function resolveWorkspaceForAccount(
  client: InsforgeClient,
  unipileAccountId: string,
): Promise<{ workspaceId: string; userId: string } | null> {
  const { data } = await client.database
    .from('social_accounts')
    .select('workspace_id, user_id')
    .eq('unipile_account_id', unipileAccountId)
    .limit(1)
    .maybeSingle();

  if (!data?.workspace_id) return null;
  return {
    workspaceId: data.workspace_id as string,
    userId: data.user_id as string,
  };
}

/** Finds the best-matching lead for an inbound sender within a workspace. */
export async function findLeadForInboundSender(
  client: InsforgeClient,
  workspaceId: string,
  sender: { providerId: string | null; publicId: string | null },
): Promise<string | null> {
  if (sender.providerId) {
    const { data: outreachMatch } = await client.database
      .from('signal_outreach')
      .select('lead_id')
      .eq('workspace_id', workspaceId)
      .eq('linkedin_provider_id', sender.providerId)
      .not('lead_id', 'is', null)
      .limit(1)
      .maybeSingle();

    if (outreachMatch?.lead_id) return outreachMatch.lead_id as string;

    const { data: contactMatch } = await client.database
      .from('signal_lead_contacts')
      .select('lead_id')
      .eq('workspace_id', workspaceId)
      .eq('provider_id', sender.providerId)
      .limit(1)
      .maybeSingle();

    if (contactMatch?.lead_id) return contactMatch.lead_id as string;
  }

  if (sender.publicId) {
    const needle = sender.publicId.toLowerCase();
    const { data: contacts } = await client.database
      .from('signal_lead_contacts')
      .select('lead_id, linkedin_url')
      .eq('workspace_id', workspaceId)
      .not('linkedin_url', 'is', null)
      .limit(200);

    for (const row of contacts ?? []) {
      const url = (row as { linkedin_url?: string }).linkedin_url;
      if (!url) continue;
      const slug = parseLinkedInPublicIdentifier(url).toLowerCase();
      if (slug === needle) return (row as { lead_id: string }).lead_id;
    }
  }

  return null;
}

export interface InboundMessageResult {
  handled: boolean;
  skipped?: string;
  leadId?: string;
  workspaceId?: string;
}

/**
 * Stores an inbound Unipile message, matches it to a lead, and marks the lead
 * as needing a reply. Ignores messages sent by the connected account itself.
 */
export async function handleInboundUnipileMessage(
  client: InsforgeClient,
  payload: Record<string, unknown>,
): Promise<InboundMessageResult> {
  const parsed = parseUnipileInboundMessage(payload);
  if (!parsed) return { handled: false, skipped: 'not_a_message_event' };
  if (parsed.isFromSelf) return { handled: true, skipped: 'outbound_echo' };

  const scope = await resolveWorkspaceForAccount(client, parsed.accountId);
  if (!scope) return { handled: true, skipped: 'unknown_account' };

  const leadId = await findLeadForInboundSender(client, scope.workspaceId, {
    providerId: parsed.senderProviderId,
    publicId: parsed.senderPublicId,
  });

  if (!leadId) {
    logInfo('unipile inbound: no lead match', {
      workspaceId: scope.workspaceId,
      senderProviderId: parsed.senderProviderId,
    });
    return { handled: true, skipped: 'no_lead_match', workspaceId: scope.workspaceId };
  }

  const { inserted } = await insertLeadMessage(client, {
    workspaceId: scope.workspaceId,
    leadId,
    direction: 'inbound',
    channel: parsed.channel,
    body: parsed.text,
    externalMessageId: parsed.messageId,
    chatId: parsed.chatId,
    senderProviderId: parsed.senderProviderId,
    sentAt: parsed.sentAt,
  });

  if (!inserted) {
    return { handled: true, skipped: 'duplicate', leadId, workspaceId: scope.workspaceId };
  }

  await updateLead(client, scope.workspaceId, leadId, {
    needs_reply: true,
    nurture_stage: 'replied',
    last_inbound_at: parsed.sentAt,
    unipile_chat_id: parsed.chatId ?? undefined,
  });

  await logLeadEvent(client, scope.workspaceId, leadId, 'rescored', {
    action: 'inbound_reply',
    preview: parsed.text.slice(0, 160),
  });

  logInfo('unipile inbound: lead replied', { workspaceId: scope.workspaceId, leadId });
  return { handled: true, leadId, workspaceId: scope.workspaceId };
}

/** Builds conversation context for reply drafting (outbound history + prior draft). */
export async function buildLeadConversationContext(
  client: InsforgeClient,
  workspaceId: string,
  leadId: string,
): Promise<{ messages: SignalLeadMessageRow[]; lead: Awaited<ReturnType<typeof getLead>> }> {
  const [messages, lead] = await Promise.all([
    listLeadMessages(client, workspaceId, leadId),
    getLead(client, workspaceId, leadId),
  ]);
  return { messages, lead };
}
