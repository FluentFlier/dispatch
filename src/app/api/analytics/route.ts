import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient, getServiceClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { usage } from '@/lib/hooks-intelligence/usage-tracker';
import { postPillars } from '@/lib/pillars';
import { computeBestTimes, type TimingPost } from '@/lib/analytics/timing';
import { enrichPostsWithSyncCounts, postEngagementScore, resolvePublishedAt, countPostsWithMetrics } from '@/lib/analytics/post-metrics';
import { syncUserPostMetrics } from '@/lib/analytics/sync-user-metrics';
import { getAlgorithmInsights, normalizeInsightPlatform, type InsightPlatform } from '@/lib/analytics/algorithm-insights';
import type { Post } from '@/lib/types';

const POSTED_POSTS_LIMIT = 100;

function countByPostId(rows: Array<{ post_id: string }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.post_id, (counts.get(row.post_id) ?? 0) + 1);
  }
  return counts;
}

/** The platform most of the creator's posted content is on (defaults to LinkedIn). */
function pickDominantPlatform(posts: Array<{ platform?: string | null }>): InsightPlatform {
  const counts = new Map<InsightPlatform, number>();
  for (const p of posts) {
    const platform = normalizeInsightPlatform(p.platform);
    counts.set(platform, (counts.get(platform) ?? 0) + 1);
  }
  let best: InsightPlatform = 'linkedin';
  let bestCount = -1;
  counts.forEach((count, platform) => {
    if (count > bestCount) {
      best = platform;
      bestCount = count;
    }
  });
  return best;
}

function applyWorkspaceScope<T extends { eq: (col: string, val: string) => T; or: (filter: string) => T }>(
  query: T,
  workspaceId: string | null,
): T {
  if (!workspaceId) return query;
  // Legacy rows may have been written before workspace_id was stamped on every table.
  return query.or(`workspace_id.eq.${workspaceId},workspace_id.is.null`);
}

export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);

  let postsQuery = client.database.from('posts')
    .select('*')
    .eq('user_id', user.id)
    .eq('status', 'posted')
    .order('posted_date', { ascending: false })
    .limit(POSTED_POSTS_LIMIT);
  postsQuery = applyWorkspaceScope(postsQuery, workspaceId);

  let setsQuery = client.database.from('hashtag_sets')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  setsQuery = applyWorkspaceScope(setsQuery, workspaceId);

  let reviewsQuery = client.database.from('weekly_reviews')
    .select('*')
    .eq('user_id', user.id)
    .order('week_start', { ascending: false });
  reviewsQuery = applyWorkspaceScope(reviewsQuery, workspaceId);

  // Published jobs give a real publish timestamp (posts.posted_date is date-only),
  // which the best-time engine needs for hour-level windows.
  let jobsQuery = client.database.from('publish_jobs')
    .select('post_id, updated_at, created_at')
    .eq('user_id', user.id)
    .eq('status', 'published');
  jobsQuery = applyWorkspaceScope(jobsQuery, workspaceId);

  const [postsRes, setsRes, reviewsRes, leadsRes, jobsRes, reactionsRes, commentersRes] =
    await Promise.all([
      postsQuery,
      setsQuery,
      reviewsQuery,
      client.database.from('lead_categories')
        .select('category')
        .eq('user_id', user.id),
      jobsQuery,
      // Reaction/commenter aggregates are computed in JS: the SDK has no
      // GROUP BY, and per-user row counts stay small at these limits.
      client.database.from('post_reactions')
        .select('post_id, reaction_type')
        .eq('user_id', user.id)
        .limit(5000),
      client.database.from('post_comments')
        .select('post_id, author_name, author_handle, author_headline')
        .eq('user_id', user.id)
        .limit(5000),
    ]);

  if (postsRes.error) return NextResponse.json({ error: postsRes.error.message }, { status: 500 });
  if (setsRes.error) return NextResponse.json({ error: setsRes.error.message }, { status: 500 });
  if (reviewsRes.error) return NextResponse.json({ error: reviewsRes.error.message }, { status: 500 });
  if (leadsRes.error) return NextResponse.json({ error: leadsRes.error.message }, { status: 500 });

  let rawPosts = (postsRes.data ?? []) as Post[];

  // When posts exist but every metric is zero, pull live stats before rendering charts.
  if (rawPosts.length > 0 && countPostsWithMetrics(rawPosts) === 0) {
    try {
      const syncClient = process.env.INSFORGE_SERVICE_ROLE_KEY?.trim()
        ? getServiceClient()
        : client;
      const syncResult = await syncUserPostMetrics(syncClient, user.id);
      if (syncResult.updated > 0) {
        let refetchQuery = client.database.from('posts')
          .select('*')
          .eq('user_id', user.id)
          .eq('status', 'posted')
          .order('posted_date', { ascending: false })
          .limit(POSTED_POSTS_LIMIT);
        refetchQuery = applyWorkspaceScope(refetchQuery, workspaceId);
        const refetch = await refetchQuery;
        if (!refetch.error && refetch.data) {
          rawPosts = refetch.data as Post[];
        }
      }
    } catch {
      // Non-fatal: return whatever we already have.
    }
  }

  const posts = enrichPostsWithSyncCounts(
    rawPosts,
    countByPostId((reactionsRes.data ?? []) as Array<{ post_id: string }>),
    countByPostId((commentersRes.data ?? []) as Array<{ post_id: string }>),
  );
  const leadCounts: Record<string, number> = { ICP: 0, 'Potential Lead': 0, Community: 0, Other: 0 };
  for (const lead of leadsRes.data ?? []) {
    const category = (lead as { category?: string }).category;
    if (category && leadCounts[category] !== undefined) leadCounts[category]++;
  }

  // Aggregate views and saves by pillar. A multi-pillar post contributes its
  // full stats to EACH of its pillars (answers "how much reach touches pillar
  // X"), so secondary pillars are no longer invisible in the breakdown.
  const byPillar: Record<string, { views: number; saves: number; count: number }> = {};
  for (const post of posts) {
    const slugs = postPillars(post);
    const list = slugs.length > 0 ? slugs : ['uncategorized'];
    for (const pillar of list) {
      if (!byPillar[pillar]) byPillar[pillar] = { views: 0, saves: 0, count: 0 };
      byPillar[pillar].views += post.views ?? 0;
      byPillar[pillar].saves += post.saves ?? 0;
      byPillar[pillar].count += 1;
    }
  }

  const totalViews = posts.reduce((sum, p) => sum + (p.views ?? 0), 0);
  const totalSaves = posts.reduce((sum, p) => sum + (p.saves ?? 0), 0);

  // Best-time recommendation. Prefer the real publish timestamp; fall back to
  // the date-only posted_date. Engagement = views (our primary reach metric).
  // jobs errors are non-fatal here — timing simply falls back to posted_date.
  const jobTimeById = new Map<string, string>();
  for (const j of (jobsRes.data ?? []) as { post_id: string; updated_at: string; created_at?: string }[]) {
    jobTimeById.set(j.post_id, j.updated_at || j.created_at || '');
  }
  const timingPosts: TimingPost[] = posts.map((p) => ({
    postedAt: resolvePublishedAt(p, jobTimeById.get(p.id)),
    engagement: postEngagementScore(p),
  }));

  // Blend the platform algorithm benchmark (how millions of posts perform) with
  // this creator's own results, so best-times reflect the algorithm — not just
  // our handful of posts. Prior is chosen from the creator's dominant platform.
  const dominantPlatform = pickDominantPlatform(posts);
  const insights = getAlgorithmInsights(dominantPlatform);
  const bestTimes = computeBestTimes(timingPosts, 3, insights.timing);

  // Reaction-type distribution (LIKE/PRAISE/etc.).
  const reactionBreakdown: Record<string, number> = {};
  for (const row of (reactionsRes.data ?? []) as Array<{ reaction_type: string }>) {
    reactionBreakdown[row.reaction_type] = (reactionBreakdown[row.reaction_type] ?? 0) + 1;
  }

  // Top commenters ranked by comment count, deduped by handle-or-name.
  const commenterMap = new Map<
    string,
    { name: string; handle: string | null; headline: string | null; count: number }
  >();
  for (const row of (commentersRes.data ?? []) as Array<{
    author_name: string | null;
    author_handle: string | null;
    author_headline: string | null;
  }>) {
    const key = (row.author_handle ?? row.author_name ?? '').trim().toLowerCase();
    if (!key) continue;
    const existing = commenterMap.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      commenterMap.set(key, {
        name: row.author_name ?? row.author_handle ?? 'Unknown',
        handle: row.author_handle,
        headline: row.author_headline,
        count: 1,
      });
    }
  }
  const topCommenters = Array.from(commenterMap.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return NextResponse.json({
    userId: user.id,
    totalViews,
    totalSaves,
    postCount: posts.length,
    byPillar,
    recentPosts: posts,
    posts,
    hashtagSets: setsRes.data ?? [],
    reviews: reviewsRes.data ?? [],
    leadCounts,
    bestTimes,
    algorithm: {
      platform: insights.platform,
      model: insights.model,
      signals: insights.signals,
      rewards: insights.rewards,
      penalties: insights.penalties,
      timingHeadline: insights.timing.headline,
    },
    engagement: {
      reactionBreakdown,
      totalReactions: (reactionsRes.data ?? []).length,
      totalComments: (commentersRes.data ?? []).length,
      topCommenters,
    },
  });
}

export async function POST(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await usage.track(user.id, 'analytics', { source: 'analytics_page' });
  return NextResponse.json({ ok: true });
}
