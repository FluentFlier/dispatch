import type { createClient } from '@insforge/sdk';

type InsforgeClient = ReturnType<typeof createClient>;

export interface LoopHealthMetrics {
  postsWithHooks: number;
  postsRlProcessed: number;
  postsPendingRl: number;
  hookPerformanceRows: number;
  voiceMetricsRows: number;
  leadCategoriesRows: number;
  editFeedbackRows: number;
  minedHookExamples: number;
  flywheelStatus: 'closed' | 'partial' | 'open';
  recommendations: string[];
}

async function tableCount(client: InsforgeClient, table: string): Promise<number> {
  try {
    const { count } = await client.database.from(table).select('*', { count: 'exact', head: true });
    return count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Aggregates flywheel health metrics for ops dashboard and /api/intelligence/health.
 */
export async function buildLoopHealthMetrics(
  client: InsforgeClient | null,
): Promise<LoopHealthMetrics> {
  const empty: LoopHealthMetrics = {
    postsWithHooks: 0,
    postsRlProcessed: 0,
    postsPendingRl: 0,
    hookPerformanceRows: 0,
    voiceMetricsRows: 0,
    leadCategoriesRows: 0,
    editFeedbackRows: 0,
    minedHookExamples: 0,
    flywheelStatus: 'open',
    recommendations: ['Apply migrations: bash scripts/apply-all-intelligence.sh'],
  };

  if (!client) return empty;

  const recommendations: string[] = [];

  const hookPerformanceRows = await tableCount(client, 'hook_performance');
  const voiceMetricsRows = await tableCount(client, 'workspace_voice_metrics');
  const leadCategoriesRows = await tableCount(client, 'lead_categories');
  const editFeedbackRows = await tableCount(client, 'edit_feedback_log');
  const minedHookExamples = await tableCount(client, 'hook_examples');

  let postsWithHooks = 0;
  let postsRlProcessed = 0;
  try {
    const { count: withHooks } = await client.database
      .from('posts')
      .select('*', { count: 'exact', head: true })
      .not('used_hook_ids', 'is', null);
    postsWithHooks = withHooks ?? 0;

    const { count: processed } = await client.database
      .from('posts')
      .select('*', { count: 'exact', head: true })
      .not('rl_processed_at', 'is', null);
    postsRlProcessed = processed ?? 0;
  } catch {
    postsWithHooks = 0;
    postsRlProcessed = 0;
  }

  const postsPendingRl = Math.max(0, postsWithHooks - postsRlProcessed);

  if (hookPerformanceRows === 0) {
    recommendations.push('Publish posts with hooks and wait for intelligence-sync cron');
  }
  if (minedHookExamples === 0) {
    recommendations.push('Enable Apify: APIFY_TOKEN + USE_APIFY=true');
  }
  if (postsWithHooks === 0) {
    recommendations.push('Generate content via /generate to capture used_hook_ids');
  }
  if (editFeedbackRows === 0) {
    recommendations.push('Edit AI drafts — feedback trains hook scores via /api/hooks/feedback');
  }

  let flywheelStatus: LoopHealthMetrics['flywheelStatus'] = 'open';
  if (hookPerformanceRows > 0 && postsWithHooks > 0 && minedHookExamples > 0) {
    flywheelStatus = postsRlProcessed > 0 ? 'closed' : 'partial';
  } else if (postsWithHooks > 0 || hookPerformanceRows > 0) {
    flywheelStatus = 'partial';
  }

  return {
    postsWithHooks,
    postsRlProcessed,
    postsPendingRl,
    hookPerformanceRows,
    voiceMetricsRows,
    leadCategoriesRows,
    editFeedbackRows,
    minedHookExamples,
    flywheelStatus,
    recommendations,
  };
}
