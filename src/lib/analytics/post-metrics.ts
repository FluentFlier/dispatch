import type { Post } from '@/lib/types';
import type { NormalizedMetrics } from '@/lib/platforms/twitter-metrics';

export interface ParsedLinkedInMetrics {
  views?: number;
  likes?: number;
  saves?: number;
  comments?: number;
  shares?: number;
}

/** Title shown in analytics tables and dropdowns. */
export function getPostDisplayTitle(post: Pick<Post, 'title' | 'caption' | 'hook'>): string {
  const title = post.title?.trim();
  if (title) return title;
  const caption = post.caption?.trim();
  if (caption) return caption.length > 80 ? `${caption.slice(0, 80)}…` : caption;
  const hook = post.hook?.trim();
  if (hook) return hook.length > 80 ? `${hook.slice(0, 80)}…` : hook;
  return 'Untitled post';
}

export function hasPostMetrics(post: Pick<Post, 'views' | 'likes' | 'saves' | 'comments' | 'shares'>): boolean {
  return (
    (post.views ?? 0) > 0 ||
    (post.likes ?? 0) > 0 ||
    (post.saves ?? 0) > 0 ||
    (post.comments ?? 0) > 0 ||
    (post.shares ?? 0) > 0
  );
}

function parseCount(raw: string): number | undefined {
  const n = parseInt(raw.replace(/,/g, ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Best-effort parser for stats copied from LinkedIn Analytics.
 * Matches common label patterns like "Impressions 1,234" or "Reactions: 45".
 */
export function parseLinkedInMetricsPaste(text: string): ParsedLinkedInMetrics {
  const result: ParsedLinkedInMetrics = {};
  const patterns: Array<[RegExp, keyof ParsedLinkedInMetrics]> = [
    [/impressions?\s*[:|-]?\s*([\d,]+)/i, 'views'],
    [/members?\s+reached\s*[:|-]?\s*([\d,]+)/i, 'views'],
    [/reactions?\s*[:|-]?\s*([\d,]+)/i, 'likes'],
    [/likes?\s*[:|-]?\s*([\d,]+)/i, 'likes'],
    [/saves?\s*[:|-]?\s*([\d,]+)/i, 'saves'],
    [/comments?\s*[:|-]?\s*([\d,]+)/i, 'comments'],
    [/reposts?\s*[:|-]?\s*([\d,]+)/i, 'shares'],
    [/shares?\s*[:|-]?\s*([\d,]+)/i, 'shares'],
  ];

  for (const [re, key] of patterns) {
    const match = text.match(re);
    if (!match) continue;
    const value = parseCount(match[1]);
    if (value !== undefined) result[key] = value;
  }

  return result;
}

/** Merge synced reaction/comment counts when stored post metrics are still zero. */
export function enrichPostsWithSyncCounts(
  posts: Post[],
  reactionsByPost: Map<string, number>,
  commentsByPost: Map<string, number>,
): Post[] {
  return posts.map((post) => {
    const syncedLikes = reactionsByPost.get(post.id) ?? 0;
    const syncedComments = commentsByPost.get(post.id) ?? 0;
    if (syncedLikes === 0 && syncedComments === 0) return post;

    return {
      ...post,
      likes: Math.max(post.likes ?? 0, syncedLikes),
      comments: Math.max(post.comments ?? 0, syncedComments),
    };
  });
}

export function countPostsWithMetrics(
  posts: Pick<Post, 'views' | 'likes' | 'saves' | 'comments' | 'shares'>[],
): number {
  return posts.filter(hasPostMetrics).length;
}

/** Primary reach metric for timing + charts: views, or engagement sum when views are hidden (LinkedIn). */
export function postEngagementScore(
  post: Pick<Post, 'views' | 'likes' | 'saves' | 'comments' | 'shares'>,
): number {
  if ((post.views ?? 0) > 0) return post.views ?? 0;
  return (post.likes ?? 0) + (post.comments ?? 0) + (post.shares ?? 0) + (post.saves ?? 0);
}

function isValidIso(value: string): boolean {
  return !Number.isNaN(new Date(value).getTime());
}

/**
 * Best publish timestamp for timing buckets. Prefer the real Unipile/publish time,
 * then scheduled time, then date-only posted_date at local noon (avoids midnight UTC clumping).
 */
export function resolvePublishedAt(
  post: Pick<Post, 'posted_date' | 'scheduled_publish_at' | 'created_at'>,
  jobPublishedAt?: string | null,
): string | null {
  if (jobPublishedAt && isValidIso(jobPublishedAt)) return jobPublishedAt;
  if (post.scheduled_publish_at && isValidIso(post.scheduled_publish_at)) {
    return post.scheduled_publish_at;
  }
  if (post.posted_date) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(post.posted_date)) {
      return `${post.posted_date}T12:00:00`;
    }
    if (isValidIso(post.posted_date)) return post.posted_date;
  }
  if (post.created_at && isValidIso(post.created_at)) return post.created_at;
  return null;
}

export function metricsPatchFromNormalized(metrics: NormalizedMetrics): Record<string, number> {
  const patch: Record<string, number> = {};
  if (typeof metrics.views === 'number') patch.views = metrics.views;
  if (typeof metrics.likes === 'number') patch.likes = metrics.likes;
  if (typeof metrics.saves === 'number') patch.saves = metrics.saves;
  if (typeof metrics.comments === 'number') patch.comments = metrics.comments;
  if (typeof metrics.shares === 'number') patch.shares = metrics.shares;
  return patch;
}
