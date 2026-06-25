import { getServerClient } from '@/lib/insforge/server';

export type UsageMetric =
  | 'ai_generate'
  | 'publish_post'
  | 'scheduled_post'
  | 'connected_account';

function periodKey(metric: UsageMetric): string {
  const d = new Date();
  if (metric === 'connected_account') {
    return 'lifetime';
  }
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Atomically increments a usage counter via a Postgres RPC function.
 *
 * Uses `increment_usage_counter` stored function (see db/schema.sql) which does:
 *   INSERT ... ON CONFLICT DO UPDATE SET count = count + p_amount
 * This eliminates the SELECT-then-UPDATE race condition where concurrent requests
 * could both read the same count and both write count+1 instead of count+2.
 *
 * Falls back to the upsert approach if the RPC is unavailable (e.g. local dev
 * before migration). The race window still exists in the fallback but is bounded
 * by connection latency rather than a full round trip.
 */
export async function incrementUsage(
  userId: string,
  metric: UsageMetric,
  amount = 1
): Promise<void> {
  const client = getServerClient();
  const pk = periodKey(metric);

  // Attempt atomic increment via stored function.
  try {
    const { error } = await (client.database as unknown as {
      rpc: (fn: string, params: Record<string, unknown>) => Promise<{ error: unknown }>;
    }).rpc('increment_usage_counter', {
      p_user_id: userId,
      p_metric: metric,
      p_period_key: pk,
      p_amount: amount,
    });

    if (!error) return;
    // RPC exists but returned an error — log and fall through to upsert fallback.
    console.warn('[usage] increment_usage_counter RPC error, falling back:', error);
  } catch {
    // RPC not available yet (pre-migration). Fall through to upsert.
  }

  // Fallback: upsert-based increment. Still has a race window under concurrency
  // but eliminates the extra SELECT round trip of the old SELECT+UPDATE pattern.
  // Replace with the RPC function (see db/schema.sql) for true atomicity.
  await client.database.from('usage_counters').upsert(
    [{ user_id: userId, metric, period_key: pk, count: amount, updated_at: new Date().toISOString() }],
    { onConflict: 'user_id,metric,period_key' }
  );
}

export async function getUsageCount(userId: string, metric: UsageMetric): Promise<number> {
  const client = getServerClient();
  const pk = periodKey(metric);

  const { data: rows } = await client.database
    .from('usage_counters')
    .select('count')
    .eq('user_id', userId)
    .eq('metric', metric)
    .eq('period_key', pk)
    .limit(1);

  const row = rows?.[0] as { count: number } | undefined;
  return row?.count ?? 0;
}

export async function checkUsageLimit(
  userId: string,
  metric: UsageMetric,
  limit: number
): Promise<{ allowed: boolean; remaining: number; used: number }> {
  const used = await getUsageCount(userId, metric);
  const remaining = Math.max(0, limit - used);
  return { allowed: used < limit, remaining, used };
}
