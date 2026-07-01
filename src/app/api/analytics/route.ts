import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { usage } from '@/lib/hooks-intelligence/usage-tracker';
import { postPillars } from '@/lib/pillars';
import { computeBestTimes, type TimingPost } from '@/lib/analytics/timing';

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
    .limit(30);
  if (workspaceId) postsQuery = postsQuery.eq('workspace_id', workspaceId);

  let setsQuery = client.database.from('hashtag_sets')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  if (workspaceId) setsQuery = setsQuery.eq('workspace_id', workspaceId);

  let reviewsQuery = client.database.from('weekly_reviews')
    .select('*')
    .eq('user_id', user.id)
    .order('week_start', { ascending: false });
  if (workspaceId) reviewsQuery = reviewsQuery.eq('workspace_id', workspaceId);

  // Published jobs give a real publish timestamp (posts.posted_date is date-only),
  // which the best-time engine needs for hour-level windows.
  let jobsQuery = client.database.from('publish_jobs')
    .select('post_id, updated_at')
    .eq('user_id', user.id)
    .eq('status', 'published');
  if (workspaceId) jobsQuery = jobsQuery.eq('workspace_id', workspaceId);

  const [postsRes, setsRes, reviewsRes, leadsRes, jobsRes] = await Promise.all([
    postsQuery,
    setsQuery,
    reviewsQuery,
    client.database.from('lead_categories')
      .select('category')
      .eq('user_id', user.id),
    jobsQuery,
  ]);

  if (postsRes.error) return NextResponse.json({ error: postsRes.error.message }, { status: 500 });
  if (setsRes.error) return NextResponse.json({ error: setsRes.error.message }, { status: 500 });
  if (reviewsRes.error) return NextResponse.json({ error: reviewsRes.error.message }, { status: 500 });
  if (leadsRes.error) return NextResponse.json({ error: leadsRes.error.message }, { status: 500 });

  const posts = postsRes.data ?? [];
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

  const totalViews = posts.reduce((sum: number, p: { views?: number }) => sum + (p.views ?? 0), 0);
  const totalSaves = posts.reduce((sum: number, p: { saves?: number }) => sum + (p.saves ?? 0), 0);

  // Best-time recommendation. Prefer the real publish timestamp; fall back to
  // the date-only posted_date. Engagement = views (our primary reach metric).
  // jobs errors are non-fatal here — timing simply falls back to posted_date.
  const jobTimeById = new Map<string, string>();
  for (const j of (jobsRes.data ?? []) as { post_id: string; updated_at: string }[]) {
    jobTimeById.set(j.post_id, j.updated_at);
  }
  const timingPosts: TimingPost[] = posts.map((p: { id: string; posted_date: string | null; views?: number }) => ({
    postedAt: jobTimeById.get(p.id) ?? p.posted_date,
    engagement: p.views ?? 0,
  }));
  const bestTimes = computeBestTimes(timingPosts);

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
  });
}

export async function POST(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await usage.track(user.id, 'analytics', { source: 'analytics_page' });
  return NextResponse.json({ ok: true });
}
