import type { createClient } from '@insforge/sdk';
import { PILLAR_TO_VERTICAL, type HookVertical } from '@/lib/hooks-intelligence/types';

type InsforgeClient = ReturnType<typeof createClient>;

/**
 * Counts actionable leads (ICP + Potential Lead) tied to a post for RL boost.
 * The lead_categories snapshot itself is populated by refreshLeadCategories in
 * categorize-engagers.ts (comments + reactions); this only reads counts.
 */
export async function countLeadsForPost(
  client: InsforgeClient,
  postId: string,
): Promise<number> {
  try {
    const { count } = await client.database
      .from('lead_categories')
      .select('*', { count: 'exact', head: true })
      .eq('post_id', postId)
      .in('category', ['ICP', 'Potential Lead']);

    return count ?? 0;
  } catch {
    return 0;
  }
}

export function pillarToVertical(pillar: string): HookVertical {
  return PILLAR_TO_VERTICAL[pillar] ?? 'general';
}
