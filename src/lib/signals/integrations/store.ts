import type { createClient } from '@insforge/sdk';
import type { ComposioToolkit } from '@/lib/composio/config';

type InsforgeClient = ReturnType<typeof createClient>;

export interface SignalIntegrationConfig {
  slack_channel_id?: string;
  slack_channel_name?: string;
  notify_on_new_signal?: boolean;
  // Selected Google Calendar for event capture (Phase E writes this). Distinct
  // from the calendar_id column on the legacy calendar_connections table.
  calendar_id?: string;
}

export interface SignalIntegrationRow {
  id: string;
  workspace_id: string;
  toolkit: ComposioToolkit;
  composio_user_id: string;
  connected_by_user_id: string | null;
  enabled: boolean;
  config: SignalIntegrationConfig;
  created_at: string;
  updated_at: string;
}

export async function getIntegration(
  client: InsforgeClient,
  workspaceId: string,
  toolkit: ComposioToolkit,
): Promise<SignalIntegrationRow | null> {
  const { data } = await client.database
    .from('signal_integrations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('toolkit', toolkit)
    .maybeSingle();

  return (data as SignalIntegrationRow | null) ?? null;
}

export async function listIntegrations(
  client: InsforgeClient,
  workspaceId: string,
): Promise<SignalIntegrationRow[]> {
  const { data } = await client.database
    .from('signal_integrations')
    .select('*')
    .eq('workspace_id', workspaceId);

  return (data as SignalIntegrationRow[]) ?? [];
}

export async function upsertIntegration(
  client: InsforgeClient,
  input: {
    workspaceId: string;
    toolkit: ComposioToolkit;
    composioUserId: string;
    connectedByUserId: string;
    enabled?: boolean;
    config?: SignalIntegrationConfig;
  },
): Promise<SignalIntegrationRow> {
  const existing = await getIntegration(client, input.workspaceId, input.toolkit);

  const payload = {
    workspace_id: input.workspaceId,
    toolkit: input.toolkit,
    composio_user_id: input.composioUserId,
    connected_by_user_id: input.connectedByUserId,
    enabled: input.enabled ?? true,
    config: input.config ?? existing?.config ?? {},
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { data, error } = await client.database
      .from('signal_integrations')
      .update(payload)
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw error;
    return data as SignalIntegrationRow;
  }

  const { data, error } = await client.database
    .from('signal_integrations')
    .insert(payload)
    .select('*')
    .single();
  if (error) throw error;
  return data as SignalIntegrationRow;
}

export async function patchIntegrationConfig(
  client: InsforgeClient,
  workspaceId: string,
  toolkit: ComposioToolkit,
  patch: Partial<SignalIntegrationConfig> & { enabled?: boolean },
): Promise<SignalIntegrationRow | null> {
  const existing = await getIntegration(client, workspaceId, toolkit);
  if (!existing) return null;

  const { enabled, ...configPatch } = patch;
  const { data, error } = await client.database
    .from('signal_integrations')
    .update({
      config: { ...existing.config, ...configPatch },
      ...(enabled !== undefined ? { enabled } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id)
    .select('*')
    .single();

  if (error) throw error;
  return data as SignalIntegrationRow;
}
