/**
 * Best-time-to-post engine.
 *
 * WHY: with real (auto-synced) post metrics we can finally answer "when should
 * I post?" — a feature that was impossible while numbers were hand-entered.
 * This module is pure: it takes posted rows (a timestamp + an engagement score)
 * and returns the strongest weekday/hour windows, or a clear "not enough data"
 * signal below a minimum sample size.
 */

/** Minimum posts with a usable timestamp before we surface any recommendation. */
export const MIN_POSTS_FOR_TIMING = 5;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface TimingPost {
  /** When the post went live (ISO string or Date). Rows without this are ignored. */
  postedAt: string | Date | null;
  /** A single engagement figure (e.g. views, or a weighted sum). */
  engagement: number;
}

export interface TimingWindow {
  /** 0-6 (Sunday-Saturday) for weekday windows; 0-23 for hour windows. */
  index: number;
  label: string;
  /** Number of posts that fell in this window. */
  sampleSize: number;
  /** Average engagement across posts in this window. */
  avgEngagement: number;
}

export interface TimingResult {
  insufficientData: boolean;
  sampleSize: number;
  bestWeekdays: TimingWindow[];
  bestHours: TimingWindow[];
}

function toDate(value: string | Date | null): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Rank buckets by average engagement (desc), keeping only non-empty ones. */
function rankBuckets(
  buckets: Map<number, { total: number; count: number }>,
  label: (i: number) => string,
  limit: number,
): TimingWindow[] {
  return Array.from(buckets.entries())
    .map(([index, { total, count }]) => ({
      index,
      label: label(index),
      sampleSize: count,
      avgEngagement: count > 0 ? total / count : 0,
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement)
    .slice(0, limit);
}

/**
 * Compute best posting windows from posted rows. Uses local time of the
 * provided Date objects for weekday/hour bucketing.
 */
export function computeBestTimes(posts: TimingPost[], topN = 3): TimingResult {
  const usable = posts
    .map((p) => ({ at: toDate(p.postedAt), engagement: Number.isFinite(p.engagement) ? p.engagement : 0 }))
    .filter((p): p is { at: Date; engagement: number } => p.at !== null);

  if (usable.length < MIN_POSTS_FOR_TIMING) {
    return { insufficientData: true, sampleSize: usable.length, bestWeekdays: [], bestHours: [] };
  }

  const weekdayBuckets = new Map<number, { total: number; count: number }>();
  const hourBuckets = new Map<number, { total: number; count: number }>();

  for (const { at, engagement } of usable) {
    const wd = at.getDay();
    const hr = at.getHours();
    const w = weekdayBuckets.get(wd) ?? { total: 0, count: 0 };
    w.total += engagement;
    w.count += 1;
    weekdayBuckets.set(wd, w);
    const h = hourBuckets.get(hr) ?? { total: 0, count: 0 };
    h.total += engagement;
    h.count += 1;
    hourBuckets.set(hr, h);
  }

  return {
    insufficientData: false,
    sampleSize: usable.length,
    bestWeekdays: rankBuckets(weekdayBuckets, (i) => WEEKDAYS[i], topN),
    bestHours: rankBuckets(hourBuckets, (i) => formatHour(i), topN),
  };
}

/** Format a 0-23 hour as a friendly "9am"/"2pm" label. */
export function formatHour(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}
