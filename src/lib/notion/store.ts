import { getServiceClient } from '@/lib/insforge/server';
import type { NotionMcpConnectionRow } from './types';

export async function getNotionConnection(workspaceId: string): Promise<NotionMcpConnectionRow | null> {
  const { data, error } = await getServiceClient().database
    .from('notion_mcp_connections')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (error) throw new Error(`Could not load Notion connection: ${error.message}`);
  return (data as NotionMcpConnectionRow | null) ?? null;
}

export async function saveNotionConnection(
  payload: Omit<NotionMcpConnectionRow, 'id' | 'created_at' | 'updated_at' | 'last_synced_at' | 'last_sync_error' | 'source_urls'>,
): Promise<NotionMcpConnectionRow> {
  const existing = await getNotionConnection(payload.workspace_id);
  const { data, error } = await getServiceClient().database
    .from('notion_mcp_connections')
    .upsert([{
      ...payload,
      source_urls: existing?.source_urls ?? [],
      last_synced_at: existing?.last_synced_at ?? null,
      last_sync_error: null,
    }], { onConflict: 'workspace_id' })
    .select('*')
    .single();

  if (error || !data) throw new Error(`Could not save Notion connection: ${error?.message ?? 'unknown error'}`);
  return data as NotionMcpConnectionRow;
}

export async function updateNotionConnection(
  workspaceId: string,
  patch: Partial<NotionMcpConnectionRow>,
): Promise<NotionMcpConnectionRow> {
  const { id: _id, created_at: _created, ...safePatch } = patch;
  const { data, error } = await getServiceClient().database
    .from('notion_mcp_connections')
    .update(safePatch)
    .eq('workspace_id', workspaceId)
    .select('*')
    .single();

  if (error || !data) throw new Error(`Could not update Notion connection: ${error?.message ?? 'unknown error'}`);
  return data as NotionMcpConnectionRow;
}

export async function deleteNotionConnection(workspaceId: string): Promise<void> {
  const { error } = await getServiceClient().database
    .from('notion_mcp_connections')
    .delete()
    .eq('workspace_id', workspaceId);
  if (error) throw new Error(`Could not disconnect Notion: ${error.message}`);
}
