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
    it('picks the highest-confidence trend', () => {
      const brief = composeMorningBrief({
        now: NOW,
        trends: [
          trend({ topic: 'low', confidence: 0.3 }),
          trend({ topic: 'high', confidence: 0.9 }),
          trend({ topic: 'mid', confidence: 0.6 }),
        ],
        recentPosts: [],
        ideas: [],
      });
      expect(brief.topTrend?.topic).toBe('high');
    });

    it('breaks confidence ties by most recent detection', () => {
      const brief = composeMorningBrief({
        now: NOW,
        trends: [
          trend({ topic: 'older', confidence: 0.5, detected_at: '2026-06-28T00:00:00Z' }),
          trend({ topic: 'newer', confidence: 0.5, detected_at: '2026-06-29T00:00:00Z' }),
        ],
        recentPosts: [],
        ideas: [],
      });
      expect(brief.topTrend?.topic).toBe('newer');
    });

    it('returns null trend when none exist', () => {
      const brief = composeMorningBrief({ now: NOW, trends: [], recentPosts: [], ideas: [] });
      expect(brief.topTrend).toBeNull();
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
