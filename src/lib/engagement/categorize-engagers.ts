/**
 * Turns synced engagement (post_comments + post_reactions) into persisted
 * lead_categories rows — the audience breakdown the analytics page already
 * reads but nothing populated until now.
 *
 * Completes the imagine import: dedupe every person who commented or reacted,
 * bucket them by headline/comment keywords (ICP / Potential Lead / Community /
 * Other), and replace the user's snapshot so analytics reflects the latest
 * synced window.
 */
import type { createClient } from '@insforge/sdk';
import {
  bucketEngagers,
  categorizeEngager,
  type Engager,
} from '@/lib/hooks-intelligence/categorize';

type InsforgeClient = ReturnType<typeof createClient>;

interface CommentSourceRow {
  post_id: string;
  author_name: string | null;
  author_handle: string | null;
  author_headline: string | null;
  comment_text: string;
}

interface ReactionSourceRow {
  post_id: string;
  author_name: string | null;
  author_handle: string | null;
  author_headline: string | null;
}

/** One deduped engager plus where we last saw them (for the drill-down). */
export interface CollectedEngager extends Engager {
  lastPostId: string;
}

/**
 * Dedupes engagement rows into unique people, preferring the richest signal:
 * a commenter who also reacted stays a 'comment' engager (comment text is the
 * strongest categorization input). Identity key mirrors reaction dedupe:
 * lowercased handle, falling back to name.
 */
export function collectEngagers(
  comments: CommentSourceRow[],
  reactions: ReactionSourceRow[],
): CollectedEngager[] {
  const byKey = new Map<string, CollectedEngager>();

  for (const c of comments) {
    const key = (c.author_handle ?? c.author_name ?? '').trim().toLowerCase();
    if (!key) continue;
    const existing = byKey.get(key);
    // Later comments overwrite earlier ones (queries order newest-first, so
    // first hit wins) — only insert when unseen.
    if (existing?.engagementType === 'comment') continue;
    byKey.set(key, {
      name: c.author_name ?? undefined,
      handle: c.author_handle ?? undefined,
      bio: [c.author_headline ?? '', c.comment_text].filter(Boolean).join(' '),
      engagementType: 'comment',
      lastPostId: c.post_id,
    });
  }

  for (const r of reactions) {
    const key = (r.author_handle ?? r.author_name ?? '').trim().toLowerCase();
    if (!key || byKey.has(key)) continue;
    byKey.set(key, {
      name: r.author_name ?? undefined,
      handle: r.author_handle ?? undefined,
      bio: r.author_headline ?? undefined,
      engagementType: 'like',
      lastPostId: r.post_id,
    });
  }

  return Array.from(byKey.values());
}

/**
 * Loads the user's content pillar names to use as ICP keywords, so "ICP"
 * matches people talking about what the creator actually posts about.
 * Missing profile is fine — the categorizer's built-in heuristics still apply.
 */
async function loadTargetKeywords(client: InsforgeClient, userId: string): Promise<string[]> {
  try {
    const { data } = await client.database
      .from('creator_profile')
      .select('content_pillars')
      .eq('user_id', userId)
      .maybeSingle();
    const raw = (data as { content_pillars?: unknown } | null)?.content_pillars;
    const pillars = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
    if (!Array.isArray(pillars)) return [];
    return pillars
      .map((p) => (p && typeof p === 'object' ? String((p as { name?: unknown }).name ?? '') : ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export interface RefreshLeadCategoriesResult {
  engagers: number;
  categorized: Record<string, number>;
}

/**
 * Rebuilds the lead_categories snapshot for a user from the last `sinceDays`
 * of synced engagement. Replace-not-merge: categories are derived data, so a
 * full rebuild keeps them consistent with re-categorization rule changes and
 * avoids unbounded row growth.
 */
export async function refreshLeadCategories(
  client: InsforgeClient,
  userId: string,
  sinceDays = 30,
): Promise<RefreshLeadCategoriesResult> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();

  const [commentsRes, reactionsRes, keywords] = await Promise.all([
    client.database
      .from('post_comments')
      .select('post_id, author_name, author_handle, author_headline, comment_text')
      .eq('user_id', userId)
      .gte('synced_at', since)
      .order('synced_at', { ascending: false })
      .limit(500),
    client.database
      .from('post_reactions')
      .select('post_id, author_name, author_handle, author_headline')
      .eq('user_id', userId)
      .gte('synced_at', since)
      .order('synced_at', { ascending: false })
      .limit(1000),
    loadTargetKeywords(client, userId),
  ]);

  const engagers = collectEngagers(
    (commentsRes.data ?? []) as CommentSourceRow[],
    (reactionsRes.data ?? []) as ReactionSourceRow[],
  );

  const buckets = bucketEngagers(engagers, keywords);

  // Replace the user's snapshot atomically enough for analytics reads: the
  // window between delete and insert only ever under-reports briefly.
  const { error: deleteError } = await client.database
    .from('lead_categories')
    .delete()
    .eq('user_id', userId);
  if (deleteError) throw new Error(deleteError.message);

  const rows = engagers.map((e) => ({
    user_id: userId,
    post_id: e.lastPostId,
    category: categorizeEngager(e, keywords),
    engager_handle: e.handle ?? e.name ?? null,
    reason: (e.bio ?? '').slice(0, 200) || null,
  }));

  if (rows.length > 0) {
    const { error: insertError } = await client.database.from('lead_categories').insert(rows);
    if (insertError) throw new Error(insertError.message);
  }

  return {
    engagers: engagers.length,
    categorized: Object.fromEntries(
      Object.entries(buckets).map(([category, list]) => [category, list.length]),
    ),
  };
}
