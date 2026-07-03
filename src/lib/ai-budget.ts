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
 *
 * Uses the `check_and_increment_ai_usage` Postgres RPC (see db/schema.sql) which
 * does the read-check-write as a single atomic UPDATE ... WHERE count < hard_cap
 * RETURNING, so concurrent callers for the same workspace (e.g. a manual reload's
 * parallel enrichCapture fan-out) serialize on the row instead of all reading the
 * same pre-increment count and all passing the cap. Falls back to the old
 * SELECT-then-UPDATE path (racy, but bounded) if the RPC is unavailable.
 */
export async function checkAndIncrementUsage(
  client: InsforgeClient,
  workspaceId: string,
  model: 'haiku' | 'sonnet',
): Promise<BudgetStatus> {
  const { warn, hard } = DAILY_LIMITS[model];

  try {
    const { data, error } = await (client.database as unknown as {
      rpc: (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
    }).rpc('check_and_increment_ai_usage', {
      p_workspace_id: workspaceId,
      p_model: model,
      p_hard_cap: hard,
      p_warn_cap: warn,
    });

    if (!error && data) {
      const row = (Array.isArray(data) ? data[0] : data) as { status: BudgetStatus; call_count: number } | undefined;
      if (row?.status) {
        if (row.status === 'blocked') console.warn('[ai-budget] hard cap hit', { workspaceId, model, count: row.call_count });
        if (row.status === 'warn') console.warn('[ai-budget] warn threshold reached', { workspaceId, model, count: row.call_count });
        return row.status;
      }
    }
    console.warn('[ai-budget] RPC returned no row, falling back to racy path', { workspaceId, model, error });
  } catch {
    // RPC not available yet (pre-migration) — fall through to the racy fallback.
  }

  const today = new Date().toISOString().split('T')[0];

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
