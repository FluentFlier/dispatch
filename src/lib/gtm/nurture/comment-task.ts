import type { createClient } from '@insforge/sdk';
import { draftOutboundComment } from '@/lib/engagement/tasks';
import { connectDueAt } from '@/lib/gtm/nurture/playbook';
import { draftOutreachForLead } from '@/lib/signals/outreach/draft-lead';
import { getLead, updateLead } from '@/lib/signals/leads/store';
import { assertOutreachAllowed } from '@/lib/signals/safety/guard';
import { scheduleHumanizedEngagementAt } from '@/lib/signals/safety/humanize';
import { getSafetySettings } from '@/lib/signals/safety/settings';
import type { LeadPlaybook, SignalLeadWithContacts } from '@/lib/signals/types';
import type { ProspectPost } from '@/lib/gtm/nurture/linkedin-posts';
import { logError } from '@/lib/logger';

type InsforgeClient = ReturnType<typeof createClient>;

function markStepDone(playbook: LeadPlaybook, type: LeadPlaybook['steps'][number]['type']): LeadPlaybook {
  return {
    ...playbook,
    steps: playbook.steps.map((s) => (s.type === type ? { ...s, status: 'done' as const } : s)),
  };
}

/**
 * Drafts a voice comment and queues an engagement_tasks row linked to the lead.
 */
export async function queueLeadCommentTask(
  client: InsforgeClient,
  workspaceId: string,
  userId: string,
  lead: SignalLeadWithContacts,
  playbook: LeadPlaybook,
  targetPost: ProspectPost,
): Promise<{ taskId: string; playbook: LeadPlaybook; scheduledAt: string }> {
  const contact = lead.primary_contact ?? lead.contacts?.[0];
  const draft = await draftOutboundComment(client, userId, {
    targetPostExcerpt: targetPost.excerpt,
    targetAuthorName: contact?.name ?? lead.company_name,
    platform: 'linkedin',
    fast: true,
  });

  const settings = await getSafetySettings(client, workspaceId);
  const scheduledAt = scheduleHumanizedEngagementAt(settings, {
    minDelayMinutes: 60,
    maxDelayMinutes: 480,
  });
  const autoApprove = settings.auto_send_enabled && settings.outreach_enabled && !settings.dry_run;

  const { data, error } = await client.database
    .from('engagement_tasks')
    .insert([
      {
        user_id: userId,
        workspace_id: workspaceId,
        lead_id: lead.id,
        platform: 'linkedin',
        kind: 'comment',
        target_provider_post_id: targetPost.id,
        target_post_url: targetPost.url ?? null,
        target_author_name: contact?.name ?? lead.company_name,
        target_post_excerpt: targetPost.excerpt.slice(0, 2000),
        source: 'gtm_nurture',
        comment_text: draft.text,
        status: autoApprove ? 'approved' : 'draft',
        scheduled_at: scheduledAt.toISOString(),
      },
    ])
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(error?.message ?? 'Could not queue comment task.');
  }

  const updatedPlaybook: LeadPlaybook = {
    ...markStepDone(playbook, 'research'),
    targetPost: {
      id: targetPost.id,
      excerpt: targetPost.excerpt.slice(0, 500),
      url: targetPost.url,
      source: targetPost.source,
    },
    commentTaskId: data.id as string,
    hookContext: `${playbook.hookContext ?? ''} Comment drafted on their recent post.`,
  };

  await updateLead(client, workspaceId, lead.id, {
    nurture_stage: 'engaging',
    playbook: updatedPlaybook,
    next_action_at: scheduledAt.toISOString(),
  });

  return { taskId: data.id as string, playbook: updatedPlaybook, scheduledAt: scheduledAt.toISOString() };
}

export interface LeadCommentActionResult {
  taskId: string;
  commentText: string;
  status: 'approved' | 'draft';
  scheduledAt: string;
  post: { id: string; excerpt: string; url: string | null };
}

/**
 * One-off comment from the leads feed. Guarded + scheduled at a random future
 * time inside working hours so comments never fire in instant bursts.
 */
export async function queueLeadCommentAction(
  client: InsforgeClient,
  workspaceId: string,
  userId: string,
  lead: SignalLeadWithContacts,
  targetPost: ProspectPost,
): Promise<LeadCommentActionResult> {
  const guard = await assertOutreachAllowed(client, workspaceId, 'linkedin_comment', {
    leadId: lead.id,
  });
  if (!guard.allowed) {
    throw new Error(guard.reason ?? 'Comment blocked by safety settings.');
  }

  const contact = lead.primary_contact ?? lead.contacts?.[0];
  const draft = await draftOutboundComment(client, userId, {
    targetPostExcerpt: targetPost.excerpt,
    targetAuthorName: contact?.name ?? lead.company_name,
    platform: 'linkedin',
    fast: true,
  });

  const settings = await getSafetySettings(client, workspaceId);
  const live = settings.outreach_enabled && !settings.dry_run;
  const status: 'approved' | 'draft' = live ? 'approved' : 'draft';
  const scheduledAt = scheduleHumanizedEngagementAt(settings).toISOString();

  const { data, error } = await client.database
    .from('engagement_tasks')
    .insert([
      {
        user_id: userId,
        workspace_id: workspaceId,
        lead_id: lead.id,
        platform: 'linkedin',
        kind: 'comment',
        target_provider_post_id: targetPost.id,
        target_post_url: targetPost.url ?? null,
        target_author_name: contact?.name ?? lead.company_name,
        target_post_excerpt: targetPost.excerpt.slice(0, 2000),
        source: 'lead_manual',
        comment_text: draft.text,
        status,
        scheduled_at: scheduledAt,
      },
    ])
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(error?.message ?? 'Could not queue comment.');
  }

  return {
    taskId: data.id as string,
    commentText: draft.text,
    status,
    scheduledAt,
    post: { id: targetPost.id, excerpt: targetPost.excerpt.slice(0, 500), url: targetPost.url ?? null },
  };
}

/** After comment posts, draft connect note and advance lead to connect_ready. */
export async function advanceLeadAfterComment(
  client: InsforgeClient,
  workspaceId: string,
  userId: string,
  leadId: string,
): Promise<void> {
  const lead = await getLead(client, workspaceId, leadId);
  if (!lead) return;

  const pb = (lead.playbook ?? null) as LeadPlaybook | null;
  if (!pb) return;

  const updatedPb = markStepDone(pb, 'comment');
  const due = connectDueAt(updatedPb);

  await draftOutreachForLead(client, userId, workspaceId, lead, 'linkedin_connect');

  await updateLead(client, workspaceId, leadId, {
    nurture_stage: 'connect_ready',
    playbook: updatedPb,
    next_action_at: due.toISOString(),
    lead_status: 'drafted',
  });
}

/** Moves engaging leads forward once their GTM nurture comment task has sent. */
export async function advanceLeadsAfterSentComments(
  client: InsforgeClient,
  workspaceId: string,
  userId: string,
): Promise<number> {
  const { data, error } = await client.database
    .from('engagement_tasks')
    .select('lead_id')
    .eq('workspace_id', workspaceId)
    .eq('source', 'gtm_nurture')
    .eq('status', 'sent')
    .not('lead_id', 'is', null)
    .limit(20);

  if (error) throw error;

  let advanced = 0;
  for (const row of data ?? []) {
    const leadId = (row as { lead_id: string }).lead_id;
    const { data: leadRow } = await client.database
      .from('signal_leads')
      .select('nurture_stage')
      .eq('workspace_id', workspaceId)
      .eq('id', leadId)
      .maybeSingle();

    if ((leadRow as { nurture_stage?: string } | null)?.nurture_stage !== 'engaging') continue;

    try {
      await advanceLeadAfterComment(client, workspaceId, userId, leadId);
      advanced++;
    } catch (err) {
      logError('gtm-nurture comment advance failed', {
        leadId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return advanced;
}
