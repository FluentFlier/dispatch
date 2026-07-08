/**
 * Phase: Real Analytics + Timing
 *
 * Covers the pure, verifiable core: platform metric mappers (X + Instagram)
 * and the best-time engine. Live API calls and the cron orchestrator are not
 * exercised here (they need real OAuth tokens); the mappers below are exactly
 * what those calls feed into.
 */
import { describe, it, expect } from 'vitest';
import { mapTweetPublicMetrics } from '@/lib/platforms/twitter-metrics';
import { mapInstagramInsights } from '@/lib/platforms/instagram-metrics';
import {
  computeBestTimes,
  formatHour,
  MIN_POSTS_FOR_TIMING,
  type TimingPost,
} from '@/lib/analytics/timing';

describe('Phase: Real Analytics + Timing', () => {
  describe('mapTweetPublicMetrics', () => {
    it('maps X terminology onto normalized metrics', () => {
      const out = mapTweetPublicMetrics({
        impression_count: 1000,
        like_count: 50,
        reply_count: 8,
        retweet_count: 5,
        quote_count: 2,
        bookmark_count: 12,
      });
      expect(out).toEqual({ views: 1000, likes: 50, comments: 8, shares: 7, saves: 12 });
    });

    it('omits metrics that the tier did not return (never zeroes them)', () => {
      // Lower tiers omit impressions + bookmarks.
      const out = mapTweetPublicMetrics({ like_count: 3, reply_count: 1, retweet_count: 0, quote_count: 0 });
      expect(out).toEqual({ likes: 3, comments: 1, shares: 0 });
      expect(out.views).toBeUndefined();
      expect(out.saves).toBeUndefined();
    });

    it('returns empty object for missing metrics', () => {
      expect(mapTweetPublicMetrics(undefined)).toEqual({});
    });
  });

  describe('mapInstagramInsights', () => {
    it('maps views (total_value shape) + saved + node like/comment counts', () => {
      // `views` is a newer total_value-typed metric; `saved` uses legacy values[].
      const out = mapInstagramInsights(
        [
          { name: 'views', total_value: { value: 800 } },
          { name: 'reach', values: [{ value: 500 }] },
          { name: 'saved', values: [{ value: 20 }] },
        ],
        { like_count: 40, comments_count: 6 },
      );
      expect(out).toEqual({ views: 800, saves: 20, likes: 40, comments: 6 });
    });

    it('falls back to reach when views is absent', () => {
      const out = mapInstagramInsights(
        [{ name: 'reach', values: [{ value: 300 }] }],
        undefined,
      );
      expect(out.views).toBe(300);
    });

    it('never reads the deprecated impressions metric', () => {
      const out = mapInstagramInsights(
        [{ name: 'impressions', values: [{ value: 999 }] }],
        undefined,
      );
      expect(out.views).toBeUndefined();
    });

    it('returns empty object when nothing is available', () => {
      expect(mapInstagramInsights(undefined, undefined)).toEqual({});
    });
  });

  describe('computeBestTimes', () => {
    it('flags insufficient data below the sample threshold', () => {
      const posts: TimingPost[] = [
        { postedAt: '2026-06-29T09:00:00', engagement: 100 },
      ];
      const res = computeBestTimes(posts);
      expect(res.insufficientData).toBe(true);
      expect(res.sampleSize).toBe(1);
      expect(res.bestWeekdays).toHaveLength(0);
    });

    it('ignores rows with no/invalid timestamp', () => {
      const posts: TimingPost[] = [
        { postedAt: null, engagement: 999 },
        { postedAt: 'not-a-date', engagement: 999 },
        ...Array.from({ length: MIN_POSTS_FOR_TIMING }, () => ({
          postedAt: '2026-06-29T09:00:00',
          engagement: 10,
        })),
      ];
      const res = computeBestTimes(posts);
      expect(res.insufficientData).toBe(false);
      expect(res.sampleSize).toBe(MIN_POSTS_FOR_TIMING);
    });

    it('flags insufficient data when engagement is all zero', () => {
      const posts: TimingPost[] = Array.from({ length: MIN_POSTS_FOR_TIMING }, (_, i) => ({
        postedAt: `2026-06-${String(i + 1).padStart(2, '0')}T09:00:00`,
        engagement: 0,
      }));
      const res = computeBestTimes(posts);
      expect(res.insufficientData).toBe(true);
      expect(res.bestWeekdays).toHaveLength(0);
    });

    it('ranks the highest-average window first', () => {
      // Mondays average far higher than Tuesdays.
      const posts: TimingPost[] = [
        { postedAt: '2026-06-29T09:00:00', engagement: 1000 }, // Mon
        { postedAt: '2026-07-06T09:00:00', engagement: 900 },  // Mon
        { postedAt: '2026-06-30T09:00:00', engagement: 10 },   // Tue
        { postedAt: '2026-07-07T09:00:00', engagement: 20 },   // Tue
        { postedAt: '2026-07-08T09:00:00', engagement: 30 },   // Wed
      ];
      const res = computeBestTimes(posts);
      expect(res.insufficientData).toBe(false);
      expect(res.bestWeekdays[0].label).toBe('Monday');
      expect(res.bestWeekdays[0].avgEngagement).toBe(950);
    });
  });

  describe('formatHour', () => {
    it('formats 12h clock with am/pm', () => {
      expect(formatHour(0)).toBe('12am');
      expect(formatHour(9)).toBe('9am');
      expect(formatHour(12)).toBe('12pm');
      expect(formatHour(18)).toBe('6pm');
    });
  });
});
