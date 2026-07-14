/**
 * Best-time-to-post engine.
 *
 * WHY: "when should I post?" should reflect BOTH how the platform's algorithm
 * behaves across millions of posts (the benchmark prior) AND the creator's own
 * results. With a benchmark prior we can always give a strong recommendation -
 * even for a brand-new account - and then shrink toward the creator's personal
 * data as they accumulate posts with real engagement.
 *
 * Pure module: takes posted rows + an optional platform prior and returns the
 * strongest weekday/hour windows.
 */
import type { TimingPrior } from '@/lib/analytics/algorithm-insights';

/** Minimum posts with a usable timestamp before we surface a PERSONAL-only recommendation. */
export const MIN_POSTS_FOR_TIMING = 5;

/** Minimum posts with non-zero engagement before personal data is trusted. */
export const MIN_ENGAGEMENT_POSTS_FOR_TIMING = 3;

/** Smoothing constant: how many benchmark "pseudo-posts" a bucket is worth before personal data dominates. */
const SHRINKAGE_K = 4;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface TimingPost {
  /** When the post went live (ISO string or Date). Rows without this are ignored. */
  postedAt: string | Date | null;
  /** A single engagement figure (e.g. views, or a weighted sum). */
  engagement: number;
}

/** Where a given window's ranking came from. */
export type TimingSource = 'personal' | 'benchmark' | 'blended';

export interface TimingWindow {
  /** 0-6 (Sunday-Saturday) for weekday windows; 0-23 for hour windows. */
  index: number;
  label: string;
  /** Number of the creator's own posts that fell in this window. */
  sampleSize: number;
  /** Average engagement across the creator's posts in this window (0 when none). */
  avgEngagement: number;
  /** Blended ranking score (benchmark average ≈ 1.0). Drives ordering. */
  score: number;
  /** Whether this window is ranked from personal data, the benchmark, or a blend. */
  source: TimingSource;
}

/** Overall basis for the recommendation set. */
export type TimingBasis = 'personal' | 'benchmark' | 'blended';

export interface TimingResult {
  insufficientData: boolean;
  sampleSize: number;
  basis: TimingBasis;
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
    .map(([index, { total, count }]) => {
      const avg = count > 0 ? total / count : 0;
      return {
        index,
        label: label(index),
        sampleSize: count,
        avgEngagement: avg,
        score: avg,
        source: 'personal' as TimingSource,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Blend the platform benchmark prior with the creator's per-bucket averages.
 *
 * For each bucket we shrink the creator's relative performance toward the
 * benchmark based on how many of their posts landed there:
 *   weightPersonal = count / (count + K)
 *   score = weightPersonal * personalRelative + (1 - weightPersonal) * benchmark
 * With zero personal posts the score is exactly the benchmark, so a new account
 * still gets the platform-optimal windows.
 */
function blendBuckets(
  size: number,
  prior: number[],
  buckets: Map<number, { total: number; count: number }>,
  overallMean: number,
  label: (i: number) => string,
  limit: number,
): TimingWindow[] {
  const windows: TimingWindow[] = [];
  for (let index = 0; index < size; index++) {
    const bucket = buckets.get(index) ?? { total: 0, count: 0 };
    const benchmark = prior[index] ?? 1;
    const avg = bucket.count > 0 ? bucket.total / bucket.count : 0;
    const personalRelative = overallMean > 0 && bucket.count > 0 ? avg / overallMean : benchmark;
    const weightPersonal = bucket.count / (bucket.count + SHRINKAGE_K);
    const score = weightPersonal * personalRelative + (1 - weightPersonal) * benchmark;

    let source: TimingSource;
    if (bucket.count === 0) source = 'benchmark';
    else if (weightPersonal >= 0.5) source = 'personal';
    else source = 'blended';

    windows.push({
      index,
      label: label(index),
      sampleSize: bucket.count,
      avgEngagement: avg,
      score,
      source,
    });
  }
  return windows.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Compute best posting windows from posted rows and, optionally, a platform
 * benchmark prior. When a prior is supplied the result is always populated
 * (benchmark-backed), blending in personal data as it accumulates.
 */
export function computeBestTimes(
  posts: TimingPost[],
  topN = 3,
  baseline?: TimingPrior,
): TimingResult {
  const usable = posts
    .map((p) => ({ at: toDate(p.postedAt), engagement: Number.isFinite(p.engagement) ? p.engagement : 0 }))
    .filter((p): p is { at: Date; engagement: number } => p.at !== null);

  const withEngagement = usable.filter((p) => p.engagement > 0);

  const weekdayBuckets = new Map<number, { total: number; count: number }>();
  const hourBuckets = new Map<number, { total: number; count: number }>();
  for (const { at, engagement } of withEngagement) {
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

  // --- Blended mode: a benchmark prior is available -----------------------
  if (baseline) {
    const overallMean =
      withEngagement.length > 0
        ? withEngagement.reduce((sum, p) => sum + p.engagement, 0) / withEngagement.length
        : 0;
    const basis: TimingBasis = withEngagement.length === 0 ? 'benchmark' : 'blended';

    return {
      insufficientData: false,
      sampleSize: withEngagement.length,
      basis,
      bestWeekdays: blendBuckets(7, baseline.weekday, weekdayBuckets, overallMean, (i) => WEEKDAYS[i], topN),
      bestHours: blendBuckets(24, baseline.hour, hourBuckets, overallMean, (i) => formatHour(i), topN),
    };
  }

  // --- Personal-only mode (back-compat): no prior supplied ----------------
  if (
    usable.length < MIN_POSTS_FOR_TIMING ||
    withEngagement.length < MIN_ENGAGEMENT_POSTS_FOR_TIMING
  ) {
    return {
      insufficientData: true,
      sampleSize: withEngagement.length > 0 ? withEngagement.length : usable.length,
      basis: 'personal',
      bestWeekdays: [],
      bestHours: [],
    };
  }

  const bestWeekdays = rankBuckets(weekdayBuckets, (i) => WEEKDAYS[i], topN).filter(
    (w) => w.avgEngagement >= 1,
  );
  const bestHours = rankBuckets(hourBuckets, (i) => formatHour(i), topN).filter(
    (w) => w.avgEngagement >= 1,
  );

  if (bestWeekdays.length === 0 || bestHours.length === 0) {
    return {
      insufficientData: true,
      sampleSize: withEngagement.length,
      basis: 'personal',
      bestWeekdays: [],
      bestHours: [],
    };
  }

  return {
    insufficientData: false,
    sampleSize: withEngagement.length,
    basis: 'personal',
    bestWeekdays,
    bestHours,
  };
}

/** Format a 0-23 hour as a friendly "9am"/"2pm" label. */
export function formatHour(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return '12am';
  if (h === 12) return '12pm';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}
