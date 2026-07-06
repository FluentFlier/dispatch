import type { createClient } from '@insforge/sdk';
import { categorizeEngager } from '@/lib/hooks-intelligence/categorize';
import { PILLAR_TO_VERTICAL, type HookVertical } from '@/lib/hooks-intelligence/types';

type InsforgeClient = ReturnType<typeof createClient>;

export interface CategorizeLeadsResult {
  categorized: number;
  icp: number;
  potentialLeads: number;
}

/**
 * Buckets recent post commenters into lead_categories for actionable analytics
 * and downstream hook RL (lead counts boost hook scores in intelligence-sync).
 */
export async function categorizeRecentEngagers(
  client: InsforgeClient,
  userId: string,
  options: { sinceHours?: number; targetKeywords?: string[] } = {},
): Promise<CategorizeLeadsResult> {
  const sinceHours = options.sinceHours ?? 48;
  const since = new Date(Date.now() - sinceHours * 3600_000).toISOString();

  const { data: comments, error } = await client.database
    .from('post_comments')
    .select('id, post_id, author_name, author_handle, author_headline, comment_text, commented_at')
    .eq('user_id', userId)
    .gte('commented_at', since)
    .order('commented_at', { ascending: false })
    .limit(200);

  if (error || !comments?.length) {
    return { categorized: 0, icp: 0, potentialLeads: 0 };
  }

  let categorized = 0;
  let icp = 0;
  let potentialLeads = 0;
  const keywords = options.targetKeywords ?? [];

  for (let i = 0; i < comments.length; i++) {
    const row = comments[i] as {
      post_id: string;
      author_name?: string;
      author_handle?: string;
      author_headline?: string;
      comment_text?: string;
    };
    const handle = row.author_handle ?? `unknown_${i}`;
    const category = categorizeEngager(
      {
        name: row.author_name,
        handle: row.author_handle,
        bio: row.author_headline ?? row.comment_text?.slice(0, 120),
        engagementType: 'comment',
      },
      keywords,
    );

    try {
      const { data: existing } = await client.database
        .from('lead_categories')
        .select('id')
        .eq('user_id', userId)
        .eq('post_id', row.post_id)
        .eq('engager_handle', handle)
        .limit(1);

      if (existing?.length) continue;

      await client.database.from('lead_categories').insert([{
        user_id: userId,
        post_id: row.post_id,
        category,
        engager_handle: handle,
        reason: `Auto-categorized from comment sync (${category})`,
      }]);
      categorized++;
      if (category === 'ICP') icp++;
      if (category === 'Potential Lead') potentialLeads++;
    } catch {
      // lead_categories table may not exist until migration
    }
  }

  return { categorized, icp, potentialLeads };
}

/**
 * Counts actionable leads (ICP + Potential Lead) tied to a post for RL boost.
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
