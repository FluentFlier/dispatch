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

export interface MorningBrief {
  /** Human date label for the brief, e.g. "Tuesday, June 30". */
  dateLabel: string;
  topTrend: MorningBriefTrend | null;
  yesterday: MorningBriefYesterday | null;
  ideas: MorningBriefIdea[];
  /** True when the brief has at least one of: trend, yesterday activity, idea. */
  hasContent: boolean;
}

/** Max idea seeds surfaced in a single brief - keeps it skimmable. */
const MAX_IDEAS = 3;

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
 * Pick the most relevant trend: highest confidence, breaking ties by most
 * recently detected. Trends with no confidence sort last.
 */
function pickTopTrend(trends: TrendRow[]): TrendRow | null {
  if (trends.length === 0) return null;
  const sorted = [...trends].sort((a, b) => {
    const ca = a.confidence ?? -1;
    const cb = b.confidence ?? -1;
    if (cb !== ca) return cb - ca;
    return (b.detected_at ?? '').localeCompare(a.detected_at ?? '');
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
 * Compose a morning brief from already-fetched rows. Pure: no network, no
 * clock access - the caller supplies `now`.
 */
export function composeMorningBrief(input: {
  now: Date;
  trends: TrendRow[];
  recentPosts: BriefPostRow[];
  ideas: IdeaSeedRow[];
}): MorningBrief {
  const trend = pickTopTrend(input.trends);
  const topTrend: MorningBriefTrend | null = trend
    ? { topic: trend.topic, angle: trend.angle, hook: trend.draft_hook, platform: trend.best_platform }
    : null;

  const yesterday = summarizeYesterday(input.recentPosts, input.now);

  const ideas: MorningBriefIdea[] = input.ideas
    .slice(0, MAX_IDEAS)
    .map((i) => ({ id: i.id, idea: i.idea, pillar: i.pillar }));

  return {
    dateLabel: formatDateLabel(input.now),
    topTrend,
    yesterday,
    ideas,
    hasContent: Boolean(topTrend) || Boolean(yesterday) || ideas.length > 0,
  };
}
