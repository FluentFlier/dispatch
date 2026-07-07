import type { createClient } from '@insforge/sdk';
import { queueLeadCommentTask } from '@/lib/gtm/nurture/comment-task';
import { fetchProspectLinkedInPost } from '@/lib/gtm/nurture/linkedin-posts';
import { buildLeadPlaybook, connectDueAt } from '@/lib/gtm/nurture/playbook';
import type { LeadPlaybook, NurtureStage } from '@/lib/signals/types';
import { draftOutreachForLead } from '@/lib/signals/outreach/draft-lead';
import { getLead, logLeadEvent, updateLead } from '@/lib/signals/leads/store';
import { withTimeout } from '@/lib/util/timeout';
import type { SignalLeadWithContacts } from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

/**
 * Time budget for the best-effort prospect-post lookup. If it misses, we fall
 * straight through to the template (connect-directly) plan rather than block the
 * interactive plan on a slow external fetch.
 */
const PLAN_POST_FETCH_TIMEOUT_MS = 3500;

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
  const startedAt = Date.now();
  const lead = await getLead(client, workspaceId, leadId);
  if (!lead) throw new Error('Lead not found.');
  if (lead.contact_status === 'no_contact') {
    throw new Error('Resolve a contact before planning nurture.');
  }

  const playbook = buildLeadPlaybook(lead);
  // Best-effort, time-boxed: a slow LinkedIn post fetch must not stall the plan.
  const targetPost = await withTimeout(
    fetchProspectLinkedInPost(client, workspaceId, userId, lead),
    PLAN_POST_FETCH_TIMEOUT_MS,
    null,
  );

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

    console.info(
      `[latency] lead-plan workspace=${workspaceId} lead=${leadId} path=comment ms=${Date.now() - startedAt}`,
    );
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

  console.info(
    `[latency] lead-plan workspace=${workspaceId} lead=${leadId} path=connect-direct ms=${Date.now() - startedAt}`,
  );
  return { lead: updated, playbook: skippedCommentPlaybook, connectDue: due.toISOString() };
}
