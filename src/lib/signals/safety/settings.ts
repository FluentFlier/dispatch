import type { createClient } from '@insforge/sdk';
import {
  DEFAULT_SAFETY_SETTINGS,
  type SignalSafetySettings,
} from '@/lib/signals/safety/limits';

type InsforgeClient = ReturnType<typeof createClient>;

export async function getSafetySettings(
  client: InsforgeClient,
  workspaceId: string,
): Promise<SignalSafetySettings> {
  const { data } = await client.database
    .from('signal_safety_settings')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (data) return data as SignalSafetySettings;

  const row = { workspace_id: workspaceId, ...DEFAULT_SAFETY_SETTINGS };
  await client.database.from('signal_safety_settings').insert(row);
  return row as SignalSafetySettings;
}

export async function updateSafetySettings(
  client: InsforgeClient,
  workspaceId: string,
  patch: Partial<Omit<SignalSafetySettings, 'workspace_id'>>,
): Promise<SignalSafetySettings> {
  await getSafetySettings(client, workspaceId);
  const { data, error } = await client.database
    .from('signal_safety_settings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .select('*')
    .single();

  if (error) throw error;
  return data as SignalSafetySettings;
}
