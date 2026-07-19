/**
 * Phase: Morning-Brief Ritual
 *
 * The brief is composed by a pure function from already-persisted rows
 * (detected trends, recent posts, idea bank). These tests lock the selection,
 * date-window, and empty-state logic that the dashboard card renders.
 */
import { describe, it, expect } from 'vitest';
import {
  composeMorningBrief,
  type TrendRow,
  type BriefPostRow,
  type IdeaSeedRow,
} from '@/lib/rituals/morning-brief';

// Fixed reference "now": Tuesday 2026-06-30 (UTC). Yesterday = 2026-06-29.
const NOW = new Date('2026-06-30T14:00:00.000Z');

function trend(partial: Partial<TrendRow>): TrendRow {
  return {
    topic: 'A trend',
    angle: null,
    draft_hook: null,
    best_platform: null,
    urgency: null,
    confidence: null,
    detected_at: null,
    ...partial,
  };
}

describe('Phase: Morning-Brief Ritual', () => {
  describe('trend selection', () => {
    it('picks the freshest trend, not the highest-confidence one', () => {
      // A fresh low-confidence trend must beat an older high-confidence one -
      // "today's trend" is about recency, not raw confidence.
      const brief = composeMorningBrief({
        now: NOW,
        trends: [
          trend({ topic: 'stale-strong', confidence: 0.9, detected_at: '2026-06-29T00:00:00Z' }),
          trend({ topic: 'fresh-weak', confidence: 0.3, detected_at: '2026-06-30T09:00:00Z' }),
        ],
        recentPosts: [],
        ideas: [],
      });
      expect(brief.topTrend?.topic).toBe('fresh-weak');
    });

    it('breaks freshness ties by confidence', () => {
      const brief = composeMorningBrief({
        now: NOW,
        trends: [
          trend({ topic: 'lower', confidence: 0.4, detected_at: '2026-06-30T09:00:00Z' }),
          trend({ topic: 'higher', confidence: 0.8, detected_at: '2026-06-30T09:00:00Z' }),
        ],
        recentPosts: [],
        ideas: [],
      });
      expect(brief.topTrend?.topic).toBe('higher');
    });

    it('excludes stale trends older than the 3-day window', () => {
      const brief = composeMorningBrief({
        now: NOW,
        trends: [trend({ topic: 'last-year', confidence: 0.99, detected_at: '2025-06-30T00:00:00Z' })],
        recentPosts: [],
        ideas: [],
      });
      expect(brief.topTrend).toBeNull();
    });

    it('excludes trends with no detection timestamp', () => {
      const brief = composeMorningBrief({
        now: NOW,
        trends: [trend({ topic: 'undated', confidence: 0.9, detected_at: null })],
        recentPosts: [],
        ideas: [],
      });
      expect(brief.topTrend).toBeNull();
    });

    it('returns null trend when none exist', () => {
      const brief = composeMorningBrief({ now: NOW, trends: [], recentPosts: [], ideas: [] });
      expect(brief.topTrend).toBeNull();
    });
  });

  describe('latest-post snapshot', () => {
    it('never surfaces a post with no publish date (draft / not-yet-uploaded)', () => {
      const brief = composeMorningBrief({
        now: NOW,
        trends: [],
        recentPosts: [{ title: 'Queued but not live', posted_date: null, views: 0, saves: 0 }],
        ideas: [],
      });
      expect(brief.latestPost).toBeNull();
    });

    it('flags a post out-performing the recent average as performing', () => {
      const brief = composeMorningBrief({
        now: NOW,
        trends: [],
        recentPosts: [
          { title: 'Breakout', posted_date: '2026-06-29', views: 1000, saves: 20 },
          { title: 'Older 1', posted_date: '2026-06-20', views: 100, saves: 2 },
          { title: 'Older 2', posted_date: '2026-06-18', views: 200, saves: 3 },
        ],
        ideas: [],
      });
      expect(brief.latestPost?.title).toBe('Breakout');
      expect(brief.latestPost?.isPerforming).toBe(true);
    });

    it('does not flag an average post as performing', () => {
      const brief = composeMorningBrief({
        now: NOW,
        trends: [],
        recentPosts: [
          { title: 'Meh', posted_date: '2026-06-29', views: 100, saves: 1 },
          { title: 'Older 1', posted_date: '2026-06-20', views: 100, saves: 2 },
          { title: 'Older 2', posted_date: '2026-06-18', views: 120, saves: 3 },
        ],
        ideas: [],
      });
      expect(brief.latestPost?.isPerforming).toBe(false);
    });
  });

  describe('yesterday summary', () => {
    const posts: BriefPostRow[] = [
      { title: 'Yesterday A', posted_date: '2026-06-29', views: 100, saves: 5 },
      { title: 'Yesterday B', posted_date: '2026-06-29T09:00:00Z', views: 300, saves: 10 },
      { title: 'Today', posted_date: '2026-06-30', views: 999, saves: 99 },
      { title: 'Older', posted_date: '2026-06-27', views: 50, saves: 1 },
    ];

    it('aggregates only yesterday and finds the top post', () => {
      const brief = composeMorningBrief({ now: NOW, trends: [], recentPosts: posts, ideas: [] });
      expect(brief.yesterday).toEqual({
        postCount: 2,
        views: 400,
        saves: 15,
        topPost: { title: 'Yesterday B', views: 300 },
      });
    });

    it('returns null when nothing was posted yesterday', () => {
      const brief = composeMorningBrief({
        now: NOW,
        trends: [],
        recentPosts: [{ title: 'Today only', posted_date: '2026-06-30', views: 10, saves: 0 }],
        ideas: [],
      });
      expect(brief.yesterday).toBeNull();
    });

    it('treats null metrics as zero', () => {
      const brief = composeMorningBrief({
        now: NOW,
        trends: [],
        recentPosts: [{ title: 'No metrics', posted_date: '2026-06-29', views: null, saves: null }],
        ideas: [],
      });
      expect(brief.yesterday).toEqual({
        postCount: 1,
        views: 0,
        saves: 0,
        topPost: { title: 'No metrics', views: 0 },
      });
    });
  });

  describe('idea seeds', () => {
    const ideas: IdeaSeedRow[] = Array.from({ length: 5 }, (_, i) => ({
      id: `id-${i}`,
      idea: `Idea ${i}`,
      pillar: i % 2 === 0 ? 'founder' : null,
    }));

    it('caps ideas at 3', () => {
      const brief = composeMorningBrief({ now: NOW, trends: [], recentPosts: [], ideas });
      expect(brief.ideas).toHaveLength(3);
      expect(brief.ideas[0]).toEqual({ id: 'id-0', idea: 'Idea 0', pillar: 'founder' });
    });
  });

  describe('hasContent + date label', () => {
    it('is false when everything is empty', () => {
      const brief = composeMorningBrief({ now: NOW, trends: [], recentPosts: [], ideas: [] });
      expect(brief.hasContent).toBe(false);
    });

    it('is true when any section has content', () => {
      const brief = composeMorningBrief({
        now: NOW,
        trends: [],
        recentPosts: [],
        ideas: [{ id: 'x', idea: 'Only idea', pillar: null }],
      });
      expect(brief.hasContent).toBe(true);
    });

    it('formats the date label', () => {
      const brief = composeMorningBrief({ now: NOW, trends: [], recentPosts: [], ideas: [] });
      expect(brief.dateLabel).toBe('Tuesday, June 30');
    });
  });
});
