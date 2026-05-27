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
 * Increment usage counter (upsert). Falls back to in-memory allow on DB errors in dev.
 */
export async function incrementUsage(
  userId: string,
  metric: UsageMetric,
  amount = 1
): Promise<void> {
  const client = getServerClient();
  const pk = periodKey(metric);

  const { data: rows } = await client.database
    .from('usage_counters')
    .select('id, count')
    .eq('user_id', userId)
    .eq('metric', metric)
    .eq('period_key', pk)
    .limit(1);

  const existing = rows?.[0] as { id: string; count: number } | undefined;

  if (existing?.id) {
    await client.database
      .from('usage_counters')
      .update({ count: (existing.count as number) + amount, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    return;
  }

  await client.database.from('usage_counters').insert([
    {
      user_id: userId,
      metric,
      period_key: pk,
      count: amount,
    },
  ]);
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
