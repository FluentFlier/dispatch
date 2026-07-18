import type { createClient } from '@insforge/sdk';
import { getSafetyStatus } from '@/lib/signals/safety';
import { getDirectorySettings } from '@/lib/signals/leads/store';
import type { EngagementTaskRow } from '@/lib/engagement/tasks';
import type { SignalLeadRow } from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

export interface GtmTodaySnapshot {
  safety: Awaited<ReturnType<typeof getSafetyStatus>>;
  icpConfigured: boolean;
  pipeline: {
    discovered: number;
    engaging: number;
    connectReady: number;
    connectSent: number;
    dmReady: number;
    needsReply: number;
    sentToday: number;
  };
  connectsDue: Array<Pick<SignalLeadRow, 'id' | 'company_name' | 'rank_score' | 'next_action_at'>>;
  dmsDue: Array<Pick<SignalLeadRow, 'id' | 'company_name' | 'rank_score' | 'next_action_at'>>;
  needsReplyLeads: Array<
    Pick<SignalLeadRow, 'id' | 'company_name' | 'rank_score' | 'last_inbound_at'>
  >;
  commentDrafts: EngagementTaskRow[];
}

export async function buildGtmTodaySnapshot(
  client: InsforgeClient,
  workspaceId: string,
  userId: string,
): Promise<GtmTodaySnapshot> {
  const [safety, settings, stageRows, dueRows, dmDueRows, replyRows, tasksRes] = await Promise.all([
    getSafetyStatus(client, workspaceId),
    getDirectorySettings(client, workspaceId),
    client.database
      .from('signal_leads')
      .select('nurture_stage, needs_reply')
      .eq('workspace_id', workspaceId),
    client.database
      .from('signal_leads')
      .select('id, company_name, rank_score, next_action_at')
      .eq('workspace_id', workspaceId)
      .eq('nurture_stage', 'connect_ready')
      .lte('next_action_at', new Date().toISOString())
      .order('rank_score', { ascending: false })
      .limit(8),
    client.database
      .from('signal_leads')
      .select('id, company_name, rank_score, next_action_at')
      .eq('workspace_id', workspaceId)
      .eq('nurture_stage', 'dm_ready')
      .lte('next_action_at', new Date().toISOString())
      .order('rank_score', { ascending: false })
      .limit(8),
    client.database
      .from('signal_leads')
      .select('id, company_name, rank_score, last_inbound_at')
      .eq('workspace_id', workspaceId)
      .eq('needs_reply', true)
      .order('last_inbound_at', { ascending: false })
      .limit(8),
    client.database
      .from('engagement_tasks')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'draft')
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  const stages = (stageRows.data ?? []) as Array<{ nurture_stage: string | null; needs_reply?: boolean }>;
  const countStage = (s: string) => stages.filter((r) => r.nurture_stage === s).length;

  const icpConfigured = Boolean(
    settings?.icp_description?.trim() ||
      (settings?.icp_verticals?.length ?? 0) > 0 ||
      (settings?.icp_keywords?.length ?? 0) > 0,
  );

  return {
    safety,
    icpConfigured,
    pipeline: {
      discovered: countStage('discovered') + countStage('planned'),
      engaging: countStage('engaging'),
      connectReady: countStage('connect_ready'),
      connectSent: countStage('connect_sent'),
      dmReady: countStage('dm_ready'),
      needsReply: stages.filter((r) => r.needs_reply).length,
      sentToday: safety.usage.linkedin_invites_today,
    },
    connectsDue: (dueRows.data ?? []) as GtmTodaySnapshot['connectsDue'],
    dmsDue: (dmDueRows.data ?? []) as GtmTodaySnapshot['dmsDue'],
    needsReplyLeads: (replyRows.data ?? []) as GtmTodaySnapshot['needsReplyLeads'],
    commentDrafts: (tasksRes.data ?? []) as EngagementTaskRow[],
  };
}
