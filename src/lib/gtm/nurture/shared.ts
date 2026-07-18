/**
 * Shared nurture/outreach helpers used by both the GTM nurture engine and the
 * signals outreach senders, so playbook-step bookkeeping, DM scheduling, and
 * the single signal_outreach row per lead can never silently diverge.
 */
import type { createClient } from '@insforge/sdk';
import type { LeadPlaybook } from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

/** Marks one playbook step done (by type). Returns undefined when there is no playbook to update. */
export function markPlaybookStepDone(
  playbook: LeadPlaybook | Record<string, unknown> | null | undefined,
  type: LeadPlaybook['steps'][number]['type'],
): LeadPlaybook | undefined {
  const pb = playbook as LeadPlaybook | null | undefined;
  if (!pb?.steps) return undefined;
  return { ...pb, steps: pb.steps.map((s) => (s.type === type ? { ...s, status: 'done' as const } : s)) };
}

/** Follow-up DM fires ~5 days after the connect is sent (16:00 UTC). */
export function followUpDmDueAt(now: Date = new Date()): string {
  const due = new Date(now);
  due.setUTCDate(due.getUTCDate() + 5);
  due.setUTCHours(16, 0, 0, 0);
  return due.toISOString();
}

/**
 * Update-or-insert the single signal_outreach row for a lead (unique on
 * lead_id). InsForge quirk: explicit column list + a single .eq() filter
 * (no embed, no .order()). workspace_id/lead_id are stamped on insert.
 */
export async function upsertLeadOutreachRow(
  client: InsforgeClient,
  workspaceId: string,
  leadId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { data: existing } = await client.database
    .from('signal_outreach')
    .select('id')
    .eq('lead_id', leadId)
    .limit(1);

  if (existing && existing.length > 0) {
    const { error } = await client.database
      .from('signal_outreach')
      .update(patch)
      .eq('id', (existing[0] as { id: string }).id);
    if (error) throw error;
    return;
  }

  const { error } = await client.database
    .from('signal_outreach')
    .insert([{ workspace_id: workspaceId, lead_id: leadId, ...patch }]);
  if (error) throw error;
}
