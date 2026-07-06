import type { createClient } from '@insforge/sdk';
import { queueLeadCommentTask } from '@/lib/gtm/nurture/comment-task';
import { fetchProspectLinkedInPost } from '@/lib/gtm/nurture/linkedin-posts';
import { buildLeadPlaybook, connectDueAt } from '@/lib/gtm/nurture/playbook';
import type { LeadPlaybook, NurtureStage } from '@/lib/signals/types';
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
  const targetPost = await fetchProspectLinkedInPost(client, workspaceId, userId, lead);

  if (targetPost) {
    const { playbook: queuedPlaybook } = await queueLeadCommentTask(
      client,
      workspaceId,
      userId,
      lead,
      playbook,
      targetPost,
    );
    const connectDue = opts?.connectDueOverride ?? connectDueAt(queuedPlaybook);

    await logLeadEvent(client, workspaceId, leadId, 'rescored', {
      action: 'nurture_planned',
      nurture_stage: 'engaging',
      target_post_id: targetPost.id,
      connect_due: connectDue.toISOString(),
    });

    const updated = await getLead(client, workspaceId, leadId);
    if (!updated) throw new Error('Lead missing after plan.');

    return { lead: updated, playbook: queuedPlaybook, connectDue: connectDue.toISOString() };
  }

  await draftOutreachForLead(client, userId, workspaceId, lead, 'linkedin_connect');

  const skippedCommentPlaybook: LeadPlaybook = {
    ...playbook,
    steps: playbook.steps.map((s) =>
      s.type === 'research' || s.type === 'comment'
        ? { ...s, status: 'skipped' as const }
        : s,
    ),
    hookContext: `${playbook.hookContext ?? ''} No recent post found — connect directly.`,
  };

  const due = opts?.connectDueOverride ?? connectDueAt(skippedCommentPlaybook);
  const nurtureStage: NurtureStage = 'connect_ready';

  await updateLead(client, workspaceId, leadId, {
    nurture_stage: nurtureStage,
    playbook: skippedCommentPlaybook,
    next_action_at: due.toISOString(),
    lead_status: 'drafted',
  });

  await logLeadEvent(client, workspaceId, leadId, 'rescored', {
    action: 'nurture_planned',
    nurture_stage: nurtureStage,
    connect_due: due.toISOString(),
    skipped_comment: true,
  });

  const updated = await getLead(client, workspaceId, leadId);
  if (!updated) throw new Error('Lead missing after plan.');

  return { lead: updated, playbook: skippedCommentPlaybook, connectDue: due.toISOString() };
}
