import type { createClient } from '@insforge/sdk';

type InsforgeClient = ReturnType<typeof createClient>;

export type LeadMessageDirection = 'inbound' | 'outbound';
export type LeadMessageChannel = 'linkedin_dm' | 'x_dm' | 'gmail';

export interface SignalLeadMessageRow {
  id: string;
  workspace_id: string;
  lead_id: string;
  direction: LeadMessageDirection;
  channel: LeadMessageChannel;
  body: string;
  external_message_id: string | null;
  chat_id: string | null;
  sender_provider_id: string | null;
  sent_at: string;
  created_at: string;
}

export interface InsertLeadMessageInput {
  workspaceId: string;
  leadId: string;
  direction: LeadMessageDirection;
  channel?: LeadMessageChannel;
  body: string;
  externalMessageId?: string | null;
  chatId?: string | null;
  senderProviderId?: string | null;
  sentAt?: string;
}

/** Lists thread messages for a lead, oldest first. */
export async function listLeadMessages(
  client: InsforgeClient,
  workspaceId: string,
  leadId: string,
  limit = 50,
): Promise<SignalLeadMessageRow[]> {
  const { data, error } = await client.database
    .from('signal_lead_messages')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('lead_id', leadId)
    .order('sent_at', { ascending: true })
    .limit(Math.min(limit, 100));

  if (error) throw error;
  return (data ?? []) as SignalLeadMessageRow[];
}

/** Inserts a message row; skips duplicate external_message_id (idempotent webhook). */
export async function insertLeadMessage(
  client: InsforgeClient,
  input: InsertLeadMessageInput,
): Promise<{ inserted: boolean; message: SignalLeadMessageRow | null }> {
  if (input.externalMessageId) {
    const { data: existing } = await client.database
      .from('signal_lead_messages')
      .select('*')
      .eq('external_message_id', input.externalMessageId)
      .limit(1);

    if (existing && existing.length > 0) {
      return { inserted: false, message: existing[0] as SignalLeadMessageRow };
    }
  }

  const row = {
    workspace_id: input.workspaceId,
    lead_id: input.leadId,
    direction: input.direction,
    channel: input.channel ?? 'linkedin_dm',
    body: input.body,
    external_message_id: input.externalMessageId ?? null,
    chat_id: input.chatId ?? null,
    sender_provider_id: input.senderProviderId ?? null,
    sent_at: input.sentAt ?? new Date().toISOString(),
  };

  const { data, error } = await client.database
    .from('signal_lead_messages')
    .insert([row])
    .select('*');

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === '23505' && input.externalMessageId) {
      return { inserted: false, message: null };
    }
    throw error;
  }

  return { inserted: true, message: (data?.[0] as SignalLeadMessageRow) ?? null };
}
