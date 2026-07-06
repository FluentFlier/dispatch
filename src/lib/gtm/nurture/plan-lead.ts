import type { createClient } from '@insforge/sdk';
import { buildLeadPlaybook, connectDueAt } from '@/lib/gtm/nurture/playbook';
import type { LeadPlaybook, NurtureStage } from '@/lib/gtm/nurture/types';
import { draftOutreachForLead } from '@/lib/signals/outreach/draft-lead';
import { getLead, logLeadEvent, updateLead } from '@/lib/signals/leads/store';
import type { SignalLeadWithContacts } from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

export interface PlanLeadResult {
  lead: SignalLeadWithContacts;
  playbook: LeadPlaybook;
  connectDue: string;
}

/**
 * Generates playbook + connect draft and queues the lead for timed / auto send.
 */
export async function planLeadNurture(
  client: InsforgeClient,
  workspaceId: string,
  userId: string,
  leadId: string,
  opts?: { connectDueOverride?: Date },
): Promise<PlanLeadResult> {
  const lead = await getLead(client, workspaceId, leadId);
  if (!lead) throw new Error('Lead not found.');
  if (lead.contact_status === 'no_contact') {
    throw new Error('Resolve a contact before planning nurture.');
  }

  const playbook = buildLeadPlaybook(lead);
  await draftOutreachForLead(client, userId, workspaceId, lead, 'linkedin_connect');

  const due = opts?.connectDueOverride ?? connectDueAt(playbook);
  const nurtureStage: NurtureStage = 'connect_ready';

  await updateLead(client, workspaceId, leadId, {
    nurture_stage: nurtureStage,
    playbook: playbook as unknown as Record<string, unknown>,
    next_action_at: due.toISOString(),
    lead_status: 'drafted',
  } as Partial<SignalLeadWithContacts>);

  await logLeadEvent(client, workspaceId, leadId, 'rescored', {
    action: 'nurture_planned',
    nurture_stage: nurtureStage,
    connect_due: due.toISOString(),
  });

  const updated = await getLead(client, workspaceId, leadId);
  if (!updated) throw new Error('Lead missing after plan.');

  return { lead: updated, playbook, connectDue: due.toISOString() };
}
