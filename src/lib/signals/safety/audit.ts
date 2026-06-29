import type { createClient } from '@insforge/sdk';
import type { OutreachAuditAction } from '@/lib/signals/safety/limits';

type InsforgeClient = ReturnType<typeof createClient>;

export interface AuditEntry {
  workspace_id: string;
  action: OutreachAuditAction;
  channel?: string;
  event_id?: string;
  social_account_id?: string;
  blocked_reason?: string;
  metadata?: Record<string, unknown>;
}

export async function logSignalAudit(
  client: InsforgeClient,
  entry: AuditEntry,
): Promise<void> {
  const { error } = await client.database.from('signal_outreach_audit').insert({
    workspace_id: entry.workspace_id,
    action: entry.action,
    channel: entry.channel ?? null,
    event_id: entry.event_id ?? null,
    social_account_id: entry.social_account_id ?? null,
    blocked_reason: entry.blocked_reason ?? null,
    metadata: entry.metadata ?? {},
  });

  if (error) {
    console.error('[signals/audit] failed to log', error.message);
  }
}

export async function countAuditActions(
  client: InsforgeClient,
  workspaceId: string,
  action: OutreachAuditAction,
  sinceIso: string,
  channel?: string,
): Promise<number> {
  let query = client.database
    .from('signal_outreach_audit')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('action', action)
    .gte('created_at', sinceIso);

  if (channel) query = query.eq('channel', channel);

  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export async function getLastSendTimestamp(
  client: InsforgeClient,
  workspaceId: string,
): Promise<string | null> {
  const { data } = await client.database
    .from('signal_outreach_audit')
    .select('created_at')
    .eq('workspace_id', workspaceId)
    .in('action', ['outreach_send_success'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data?.created_at as string) ?? null;
}
