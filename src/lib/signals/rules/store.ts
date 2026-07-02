import type { createClient } from '@insforge/sdk';
import type { SignalActionMode, SignalRuleRow } from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

export interface RuleInput {
  name: string;
  platform?: 'x' | 'linkedin' | 'any' | null;
  conditions?: Record<string, unknown>;
  action_mode?: SignalActionMode;
  channels?: string[];
  enabled?: boolean;
}

/** List a workspace's trigger rules in created_at order (deterministic first-match). */
export async function listRules(
  client: InsforgeClient,
  workspaceId: string,
): Promise<SignalRuleRow[]> {
  const { data, error } = await client.database
    .from('signal_rules')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as SignalRuleRow[];
}

/** Create a trigger rule for a workspace. */
export async function createRule(
  client: InsforgeClient,
  workspaceId: string,
  input: RuleInput,
): Promise<SignalRuleRow> {
  const { data, error } = await client.database
    .from('signal_rules')
    .insert({
      workspace_id: workspaceId,
      name: input.name,
      platform: input.platform ?? 'any',
      conditions: input.conditions ?? {},
      action_mode: input.action_mode ?? 'notify_and_draft',
      channels: input.channels ?? ['dashboard'],
      enabled: input.enabled ?? true,
    })
    .select('*')
    .single();

  if (error) throw error;
  return data as SignalRuleRow;
}

/** Patch a trigger rule (workspace-scoped). Returns null if the rule does not exist. */
export async function updateRule(
  client: InsforgeClient,
  workspaceId: string,
  ruleId: string,
  patch: Partial<RuleInput>,
): Promise<SignalRuleRow | null> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.platform !== undefined) update.platform = patch.platform;
  if (patch.conditions !== undefined) update.conditions = patch.conditions;
  if (patch.action_mode !== undefined) update.action_mode = patch.action_mode;
  if (patch.channels !== undefined) update.channels = patch.channels;
  if (patch.enabled !== undefined) update.enabled = patch.enabled;

  const { data, error } = await client.database
    .from('signal_rules')
    .update(update)
    .eq('workspace_id', workspaceId)
    .eq('id', ruleId)
    .select('*')
    .maybeSingle();

  if (error) throw error;
  return (data as SignalRuleRow) ?? null;
}

/** Delete a trigger rule (workspace-scoped). */
export async function deleteRule(
  client: InsforgeClient,
  workspaceId: string,
  ruleId: string,
): Promise<void> {
  const { error } = await client.database
    .from('signal_rules')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('id', ruleId);

  if (error) throw error;
}
