/**
 * Morning-brief composer.
 *
 * WHY: Stanley's "drafts while you sleep / wake up to clarity" ritual. We
 * assemble a daily brief from data we ALREADY persist (detected trends,
 * yesterday's post metrics, the idea bank) so it costs zero AI calls and no
 * new tables - the brief is computed on demand when the creator opens the app
 * each morning.
 *
 * This module is intentionally pure (no I/O, no Date.now) so the selection and
 * date-window logic is fully unit-testable; callers pass the fetched rows and
 * the current time.
 */

/** A row from `detected_trends`. */
export interface TrendRow {
  topic: string;
  angle: string | null;
  draft_hook: string | null;
  best_platform: string | null;
  urgency: string | null;
  confidence: number | null;
  detected_at: string | null;
}

/** A posted row from `posts` with its manual/real metrics. */
export interface BriefPostRow {
  id?: string;
  title: string;
  posted_date: string | null;
  views: number | null;
  saves: number | null;
}

/** A row from `content_ideas` used as a ready-to-draft seed. */
export interface IdeaSeedRow {
  id: string;
  idea: string;
  pillar: string | null;
}

export interface MorningBriefTrend {
  topic: string;
  angle: string | null;
  hook: string | null;
  platform: string | null;
}

export interface MorningBriefYesterday {
  postCount: number;
  views: number;
  saves: number;
  /** Best-performing post from yesterday by views, if any. */
  topPost: { title: string; views: number } | null;
}

export interface MorningBriefIdea {
  id: string;
  idea: string;
  pillar: string | null;
}

/** The single most recent published post + its metrics, for the brief's snapshot. */
export interface MorningBriefRecentPost {
  id: string | null;
  title: string;
  postedDate: string | null;
  views: number;
  saves: number;
  /** True when this post went out yesterday (vs an older most-recent fallback). */
  isYesterday: boolean;
  /** True when this post is meaningfully out-performing the creator's recent norm. */
  isPerforming: boolean;
}

export interface MorningBrief {
  /** Human date label for the brief, e.g. "Tuesday, June 30". */
  dateLabel: string;
  topTrend: MorningBriefTrend | null;
  yesterday: MorningBriefYesterday | null;
  /** Most recent published post + metrics - shown even when nothing went out yesterday. */
  latestPost: MorningBriefRecentPost | null;
  ideas: MorningBriefIdea[];
  /** True when the brief has at least one of: trend, recent post, idea. */
  hasContent: boolean;
}

/** Max idea seeds surfaced in a single brief - keeps it skimmable. */
const MAX_IDEAS = 3;

/**
 * Freshness window for "today's trend". A trend older than this is stale and is
 * not surfaced as current - the refresh button re-scrapes for something fresher.
 * Kept at 3 days so the strip isn't empty between scrapes on low-volume niches.
 */
const TREND_MAX_AGE_DAYS = 3;

/** Absolute views floor for "performing well" before there's a baseline to compare against. */
const PERFORMING_VIEWS_FLOOR = 200; // ponytail: flat floor; per-creator average takes over once history exists.

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Format a Date as "Weekday, Month D" without pulling in a date library. */
function formatDateLabel(now: Date): string {
  return `${WEEKDAYS[now.getUTCDay()]}, ${MONTHS[now.getUTCMonth()]} ${now.getUTCDate()}`;
}

/** UTC yyyy-mm-dd for the day before `now`. */
function yesterdayKey(now: Date): string {
  const y = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return y.toISOString().slice(0, 10);
}

/**
 * Pick the trend to show as "today's trend": freshest first, so a fresh trend
 * always beats an older high-confidence one (the old confidence-first ranking
 * surfaced week-old trends as "today"). Trends older than TREND_MAX_AGE_DAYS or
 * with no detection timestamp are excluded outright; confidence only breaks ties
 * between equally-fresh trends.
 */
function pickTopTrend(trends: TrendRow[], now: Date): TrendRow | null {
  const cutoff = now.getTime() - TREND_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const fresh = trends.filter((t) => {
    if (!t.detected_at) return false;
    const ts = Date.parse(t.detected_at);
    return Number.isFinite(ts) && ts >= cutoff;
  });
  if (fresh.length === 0) return null;
  const sorted = [...fresh].sort((a, b) => {
    const da = a.detected_at ?? '';
    const db = b.detected_at ?? '';
    if (db !== da) return db.localeCompare(da);
    return (b.confidence ?? -1) - (a.confidence ?? -1);
  });
  return sorted[0];
}

/** Aggregate yesterday's posts into a metric summary, or null if none posted. */
function summarizeYesterday(posts: BriefPostRow[], now: Date): MorningBriefYesterday | null {
  const key = yesterdayKey(now);
  const ypts = posts.filter((p) => (p.posted_date ?? '').slice(0, 10) === key);
  if (ypts.length === 0) return null;

  let views = 0;
  let saves = 0;
  let topPost: { title: string; views: number } | null = null;
  for (const p of ypts) {
    const v = p.views ?? 0;
    views += v;
    saves += p.saves ?? 0;
    if (!topPost || v > topPost.views) topPost = { title: p.title, views: v };
  }
  return { postCount: ypts.length, views, saves, topPost };
}

/**
 * Most recent GENUINELY-published post, with its metrics, or null if none.
 *
 * Only posts with a real `posted_date` qualify. The previous fallback to "any
 * post" when none were dated surfaced drafts and queued-but-not-yet-uploaded
 * posts (status can flip to 'posted' before the publish job actually runs) as
 * "your latest post" - that was the bug. No publish date => never shown here.
 */
function pickLatestPost(posts: BriefPostRow[], now: Date): MorningBriefRecentPost | null {
  const dated = posts.filter((p) => p.posted_date);
  if (dated.length === 0) return null;
  const latest = [...dated].sort((a, b) =>
    (b.posted_date ?? '').localeCompare(a.posted_date ?? ''),
  )[0];
  const views = latest.views ?? 0;
  // "Performing well" is relative to the creator's own recent average so the
  // copy stays honest across very different follower counts; fall back to a flat
  // floor before there's any baseline to compare against.
  const others = dated.filter((p) => p !== latest).map((p) => p.views ?? 0);
  const avg = others.length ? others.reduce((s, v) => s + v, 0) / others.length : 0;
  const isPerforming = views > 0 && (avg > 0 ? views >= 1.5 * avg : views >= PERFORMING_VIEWS_FLOOR);
  return {
    id: latest.id ?? null,
    title: latest.title,
    postedDate: latest.posted_date,
    views,
    saves: latest.saves ?? 0,
    isYesterday: (latest.posted_date ?? '').slice(0, 10) === yesterdayKey(now),
    isPerforming,
  };
}

/**
 * Compose a morning brief from already-fetched rows. Pure: no network, no
 * clock access - the caller supplies `now`.
 */
export function composeMorningBrief(input: {
  now: Date;
  trends: TrendRow[];
  recentPosts: BriefPostRow[];
  ideas: IdeaSeedRow[];
}): MorningBrief {
  const trend = pickTopTrend(input.trends, input.now);
  const topTrend: MorningBriefTrend | null = trend
    ? { topic: trend.topic, angle: trend.angle, hook: trend.draft_hook, platform: trend.best_platform }
    : null;

  const yesterday = summarizeYesterday(input.recentPosts, input.now);
  const latestPost = pickLatestPost(input.recentPosts, input.now);

  const ideas: MorningBriefIdea[] = input.ideas
    .slice(0, MAX_IDEAS)
    .map((i) => ({ id: i.id, idea: i.idea, pillar: i.pillar }));

  return {
    dateLabel: formatDateLabel(input.now),
    topTrend,
    yesterday,
    latestPost,
    ideas,
    hasContent: Boolean(topTrend) || Boolean(latestPost) || ideas.length > 0,
  };
}
