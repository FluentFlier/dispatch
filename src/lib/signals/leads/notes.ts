import type { createClient } from '@insforge/sdk';

type InsforgeClient = ReturnType<typeof createClient>;

export interface SignalLeadNoteRow {
  id: string;
  workspace_id: string;
  lead_id: string;
  user_id: string;
  body: string;
  created_at: string;
}

export async function listLeadNotes(
  client: InsforgeClient,
  workspaceId: string,
  leadId: string,
): Promise<SignalLeadNoteRow[]> {
  const { data, error } = await client.database
    .from('signal_lead_notes')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('lead_id', leadId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as SignalLeadNoteRow[];
}

export async function addLeadNote(
  client: InsforgeClient,
  workspaceId: string,
  leadId: string,
  userId: string,
  body: string,
): Promise<SignalLeadNoteRow> {
  const trimmed = body.trim();
  if (!trimmed) throw new Error('Note body is required.');

  const { data, error } = await client.database
    .from('signal_lead_notes')
    .insert([{ workspace_id: workspaceId, lead_id: leadId, user_id: userId, body: trimmed }])
    .select('*')
    .single();
  if (error) throw error;
  return data as SignalLeadNoteRow;
}
