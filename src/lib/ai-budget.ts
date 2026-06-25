import type { createClient } from '@insforge/sdk';

type InsforgeClient = ReturnType<typeof createClient>;

// Per-workspace per-day caps. Starter-tier defaults — adjust per plan via workspace_limits when needed.
const DAILY_LIMITS: Record<string, { warn: number; hard: number }> = {
  haiku:  { warn: 80, hard: 100 },
  sonnet: { warn: 20, hard: 25  },
};

export type BudgetStatus = 'ok' | 'warn' | 'blocked';

/**
 * Checks and increments daily AI usage for a workspace.
 * Call before every Claude Haiku or Sonnet invocation in cron/background code.
 * Returns 'blocked' when the hard cap is hit — skip the AI call for that workspace today.
 * Returns 'warn' at 80% — log it and continue.
 * Returns 'ok' below warn threshold.
 */
export async function checkAndIncrementUsage(
  client: InsforgeClient,
  workspaceId: string,
  model: 'haiku' | 'sonnet',
): Promise<BudgetStatus> {
  const today = new Date().toISOString().split('T')[0];

  // Insert the row only if it doesn't exist — ignoreDuplicates prevents resetting
  // an existing call_count to 0 on conflict (a silent counter-reset bug).
  await client.database
    .from('daily_ai_usage')
    .upsert(
      { workspace_id: workspaceId, date: today, model, call_count: 0 },
      { onConflict: 'workspace_id,date,model', ignoreDuplicates: true },
    );

  const { data } = await client.database
    .from('daily_ai_usage')
    .select('call_count')
    .eq('workspace_id', workspaceId)
    .eq('date', today)
    .eq('model', model)
    .single();

  const count = data?.call_count ?? 0;
  const { warn, hard } = DAILY_LIMITS[model];

  if (count >= hard) {
    console.warn('[ai-budget] hard cap hit', { workspaceId, model, count });
    return 'blocked';
  }

  await client.database
    .from('daily_ai_usage')
    .update({ call_count: count + 1 })
    .eq('workspace_id', workspaceId)
    .eq('date', today)
    .eq('model', model);

  if (count >= warn) {
    console.warn('[ai-budget] warn threshold reached', { workspaceId, model, count });
    return 'warn';
  }
  return 'ok';
}
