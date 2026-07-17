import type { createClient } from '@insforge/sdk';
import { assertAutoSendAllowed, sleep } from '@/lib/signals/safety';
import { getLead, logLeadEvent, updateLead } from '@/lib/signals/leads/store';
import { draftOutreachForLead } from '@/lib/signals/outreach/draft-lead';
import { sendLeadOutreach } from '@/lib/signals/outreach/send-lead';
import { isLinkedInFirstDegree } from '@/lib/gtm/nurture/connection-check';
import { followUpDmDueAt, markPlaybookStepDone } from '@/lib/gtm/nurture/shared';
import { logInfo } from '@/lib/logger';

type InsforgeClient = ReturnType<typeof createClient>;

const MAX_DM_PREP = 5;
const MAX_DM_SEND = 2;

/**
 * For connect_sent leads past due: if 1st-degree, draft follow-up DM and queue send.
 */
export async function prepareDueFollowUpDms(
  client: InsforgeClient,
  workspaceId: string,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const { data, error } = await client.database
    .from('signal_leads')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('nurture_stage', 'connect_sent')
    .lte('next_action_at', now.toISOString())
    .limit(MAX_DM_PREP);

  if (error) throw error;

  let prepared = 0;
  for (const row of data ?? []) {
    const leadId = (row as { id: string }).id;
    const lead = await getLead(client, workspaceId, leadId);
    if (!lead) continue;

    const contact = lead.primary_contact ?? lead.contacts?.[0];
    const linkedinUrl = contact?.linkedin_url?.trim();
    if (!linkedinUrl) continue;

    const connected = await isLinkedInFirstDegree(
      client,
      userId,
      workspaceId,
      linkedinUrl,
      lead.outreach?.linkedin_provider_id,
    );

    if (!connected) {
      const retry = new Date(now);
      retry.setUTCDate(retry.getUTCDate() + 2);
      await updateLead(client, workspaceId, leadId, { next_action_at: retry.toISOString() });
      continue;
    }

    await draftOutreachForLead(client, userId, workspaceId, lead, 'linkedin_dm');

    await updateLead(client, workspaceId, leadId, {
      nurture_stage: 'dm_ready',
      playbook: markPlaybookStepDone(lead.playbook, 'connect'),
      next_action_at: now.toISOString(),
      lead_status: 'drafted',
    });

    await logLeadEvent(client, workspaceId, leadId, 'rescored', { action: 'dm_drafted' });
    prepared++;
  }

  return prepared;
}

/** Auto-send due LinkedIn DMs for dm_ready leads. */
export async function autoSendDueDms(
  client: InsforgeClient,
  workspaceId: string,
  userId: string,
  now: Date = new Date(),
): Promise<{ sent: number; blocked: number; errors: string[] }> {
  const { data, error } = await client.database
    .from('signal_leads')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('nurture_stage', 'dm_ready')
    .lte('next_action_at', now.toISOString())
    .limit(MAX_DM_SEND);

  if (error) throw error;

  let sent = 0;
  let blocked = 0;
  const errors: string[] = [];

  for (const row of data ?? []) {
    const leadId = (row as { id: string }).id;
    const guard = await assertAutoSendAllowed(client, workspaceId, 'linkedin_dm');
    if (!guard.allowed) {
      blocked++;
      errors.push(guard.reason ?? 'DM auto-send blocked.');
      break;
    }

    const lead = await getLead(client, workspaceId, leadId);
    if (!lead?.outreach?.draft_text) {
      errors.push(`${leadId}: missing DM draft`);
      continue;
    }

    const result = await sendLeadOutreach(client, {
      workspaceId,
      userId,
      leadId,
      channel: 'linkedin_dm',
    });

    if (!result.success) {
      if (result.retryAfterSeconds) blocked++;
      errors.push(result.error ?? 'DM send failed');
      if (result.retryAfterSeconds) break;
      continue;
    }

    const updatedPb = markPlaybookStepDone(lead.playbook, 'dm');

    await updateLead(client, workspaceId, leadId, {
      nurture_stage: 'dm_sent',
      playbook: updatedPb,
      next_action_at: followUpDmDueAt(now),
      lead_status: 'sent',
    });

    await logLeadEvent(client, workspaceId, leadId, 'rescored', { action: 'auto_dm_sent' });
    sent++;
    logInfo('gtm-nurture auto DM sent', { workspaceId, leadId });

    const jitter =
      guard.settings.min_seconds_between_sends * 1000 +
      Math.floor(Math.random() * guard.settings.max_jitter_seconds * 1000);
    await sleep(jitter);
  }

  return { sent, blocked, errors };
}
