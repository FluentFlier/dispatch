import type { createClient } from '@insforge/sdk';
import { queueLeadCommentTasks } from '@/lib/gtm/nurture/comment-task';
import { fetchProspectLinkedInPosts } from '@/lib/gtm/nurture/linkedin-posts';
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

/**
 * How many of the prospect's recent posts to warm up on before connecting. The
 * comment tasks are staggered across days (see queueLeadCommentTasks), so this is
 * a warm-up cadence, not a burst.
 */
const WARMUP_POST_COUNT = 3;

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

  // Contactless plan: no person resolved yet (no_contact, or unresolved with no
  // contact row). Previously this threw ('Resolve a contact…'), so the button
  // 422'd and the user saw "Plan outreach doesn't work". Instead produce a
  // research-first plan that starts by finding the right person, and DON'T draft
  // a connect note (there's no one to send to). The 'planned' stage keeps it out
  // of the auto-connect funnel until a contact exists.
  const hasContact =
    lead.contact_status !== 'no_contact' && Boolean(lead.primary_contact ?? lead.contacts?.[0]);
  if (!hasContact) {
    const base = buildLeadPlaybook(lead);
    const playbook: LeadPlaybook = {
      ...base,
      steps: [
        {
          type: 'research',
          label: `Find the right person to reach at ${lead.company_name}`,
          dueInDays: 0,
          status: 'pending',
        },
        ...base.steps.filter((s) => s.type !== 'research'),
      ],
      hookContext: `No contact resolved yet - identify a person at ${lead.company_name} first.`,
    };
    await updateLead(client, workspaceId, leadId, { nurture_stage: 'planned', playbook });
    await logLeadEvent(client, workspaceId, leadId, 'rescored', {
      action: 'nurture_planned',
      nurture_stage: 'planned',
      no_contact: true,
    });
    const updated = await getLead(client, workspaceId, leadId);
    if (!updated) throw new Error('Lead missing after plan.');
    console.info(
      `[latency] lead-plan workspace=${workspaceId} lead=${leadId} path=contactless ms=${Date.now() - startedAt}`,
    );
    return { lead: updated, playbook, connectDue: '' };
  }

  const playbook = buildLeadPlaybook(lead);
  // Best-effort, time-boxed: a slow LinkedIn post fetch must not stall the plan.
  const targetPosts = await withTimeout(
    fetchProspectLinkedInPosts(client, workspaceId, userId, lead, WARMUP_POST_COUNT),
    PLAN_POST_FETCH_TIMEOUT_MS,
    [],
  );

  if (targetPosts.length > 0) {
    const { playbook: queuedPlaybook } = await queueLeadCommentTasks(
      client,
      workspaceId,
      userId,
      lead,
      playbook,
      targetPosts,
    );
    // Draft the connect note UP FRONT so a manual warm-up (comment, then connect)
    // is never blocked waiting on the comment to auto-send - dry-run / manual mode
    // never fires that send, which previously stranded the lead at `engaging` with
    // no draft (approve then 422s). Drafting is not sending: assertOutreachAllowed
    // still gates the actual connect send.
    await draftOutreachForLead(client, userId, workspaceId, lead, 'linkedin_connect');
    const connectDue = opts?.connectDueOverride ?? connectDueAt(queuedPlaybook);

    await logLeadEvent(client, workspaceId, leadId, 'rescored', {
      action: 'nurture_planned',
      nurture_stage: 'engaging',
      target_post_id: targetPosts[0].id,
      comment_count: targetPosts.length,
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
    hookContext: `${playbook.hookContext ?? ''} No recent post found - connect directly.`,
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
