import type { createClient } from '@insforge/sdk';
import { assertAutoSendAllowed, sleep } from '@/lib/signals/safety';
import { getSafetySettings } from '@/lib/signals/safety/settings';
import { getLead, listLeads, logLeadEvent, updateLead } from '@/lib/signals/leads/store';
import { sendLeadOutreach } from '@/lib/signals/outreach/send-lead';
import { getWorkspaceOwnerUserId } from '@/lib/signals/ingest/workspace-account';
import { planLeadNurture } from '@/lib/gtm/nurture/plan-lead';
import type { NurtureProcessResult } from '@/lib/gtm/nurture/types';
import { logError, logInfo } from '@/lib/logger';

type InsforgeClient = ReturnType<typeof createClient>;

const MAX_PREPARE_PER_RUN = 5;
const MAX_SEND_PER_RUN = 3;

/**
 * Auto-prepares new ICP leads (playbook + connect draft) when auto-send is armed.
 */
export async function autoPrepareLeads(
  client: InsforgeClient,
  workspaceId: string,
  userId: string,
): Promise<number> {
  const settings = await getSafetySettings(client, workspaceId);
  if (!settings.auto_send_enabled || !settings.outreach_enabled || settings.dry_run) {
    return 0;
  }

  const leads = await listLeads(client, workspaceId, { status: 'new', limit: 50 });
  const candidates = leads.filter(
    (l) =>
      l.contact_status === 'resolved' &&
      (!l.nurture_stage || l.nurture_stage === 'discovered') &&
      !l.playbook,
  );

  let prepared = 0;
  for (const lead of candidates.slice(0, MAX_PREPARE_PER_RUN)) {
    try {
      await planLeadNurture(client, workspaceId, userId, lead.id);
      prepared++;
    } catch (err) {
      logError('gtm-nurture prepare failed', {
        leadId: lead.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return prepared;
}

/**
 * Sends due LinkedIn connection requests under auto-send + safety caps.
 */
export async function autoSendDueConnects(
  client: InsforgeClient,
  workspaceId: string,
  userId: string,
  now: Date = new Date(),
): Promise<{ sent: number; blocked: number; errors: string[] }> {
  const settings = await getSafetySettings(client, workspaceId);
  if (!settings.auto_send_enabled || !settings.outreach_enabled || settings.dry_run) {
    return { sent: 0, blocked: 0, errors: [] };
  }

  const { data, error } = await client.database
    .from('signal_leads')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('nurture_stage', 'connect_ready')
    .lte('next_action_at', now.toISOString())
    .in('lead_status', ['new', 'drafted', 'approved', 'resurfaced'])
    .order('rank_score', { ascending: false })
    .limit(MAX_SEND_PER_RUN);

  if (error) throw error;

  const ids = (data ?? []).map((r: { id: string }) => r.id);
  let sent = 0;
  let blocked = 0;
  const errors: string[] = [];

  for (const leadId of ids) {
    const guard = await assertAutoSendAllowed(client, workspaceId, 'linkedin_connect');
    if (!guard.allowed) {
      blocked++;
      errors.push(guard.reason ?? 'Auto-send blocked.');
      break;
    }

    const lead = await getLead(client, workspaceId, leadId);
    if (!lead?.outreach?.draft_text) {
      errors.push(`${leadId}: missing connect draft`);
      continue;
    }

    try {
      const result = await sendLeadOutreach(client, {
        workspaceId,
        userId,
        leadId,
        channel: 'linkedin_connect',
      });

      if (!result.success) {
        if (result.retryAfterSeconds) blocked++;
        errors.push(result.error ?? 'Send failed');
        if (result.retryAfterSeconds) break;
        continue;
      }

      const dmDue = new Date(now);
      dmDue.setUTCDate(dmDue.getUTCDate() + 5);

      await updateLead(client, workspaceId, leadId, {
        nurture_stage: 'connect_sent',
        next_action_at: dmDue.toISOString(),
        lead_status: 'sent',
      });

      await logLeadEvent(client, workspaceId, leadId, 'rescored', {
        action: 'auto_connect_sent',
      });

      sent++;
      logInfo('gtm-nurture auto connect sent', { workspaceId, leadId });

      const jitter =
        guard.settings.min_seconds_between_sends * 1000 +
        Math.floor(Math.random() * guard.settings.max_jitter_seconds * 1000);
      await sleep(jitter);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { sent, blocked, errors };
}

/** Full nurture cron pass for one workspace. */
export async function runGtmNurtureForWorkspace(
  client: InsforgeClient,
  workspaceId: string,
): Promise<NurtureProcessResult> {
  const userId = (await getWorkspaceOwnerUserId(client, workspaceId)) ?? null;
  if (!userId) {
    return { prepared: 0, connectsSent: 0, blocked: 0, errors: ['No workspace owner.'] };
  }

  const prepared = await autoPrepareLeads(client, workspaceId, userId);
  const send = await autoSendDueConnects(client, workspaceId, userId);

  return {
    prepared,
    connectsSent: send.sent,
    blocked: send.blocked,
    errors: send.errors,
  };
}
