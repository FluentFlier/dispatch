import { describe, it, expect } from 'vitest';
import {
  enrichPostsWithSyncCounts,
  getPostDisplayTitle,
  hasPostMetrics,
  parseLinkedInMetricsPaste,
  resolvePublishedAt,
} from '@/lib/analytics/post-metrics';
import type { Post } from '@/lib/types';

const basePost = (overrides: Partial<Post> = {}): Post => ({
  id: 'p1',
  user_id: 'u1',
  title: '',
  pillar: 'founder',
  platform: 'linkedin',
  status: 'posted',
  script: null,
  caption: 'My caption about startups',
  hashtags: null,
  hook: null,
  notes: null,
  scheduled_date: null,
  posted_date: '2026-06-01',
  views: 0,
  likes: 0,
  saves: 0,
  comments: 0,
  shares: 0,
  follows_gained: 0,
  voice_match_score: null,
  ai_score: null,
  voice_evaluation: null,
  series_id: null,
  series_position: null,
  variant_group_id: null,
  source_platform: null,
  scheduled_publish_at: null,
  image_url: null,
  created_at: '2026-06-01',
  updated_at: '2026-06-01',
  ...overrides,
});

describe('analytics post-metrics', () => {
  describe('getPostDisplayTitle', () => {
    it('prefers title, then caption, then hook', () => {
      expect(getPostDisplayTitle({ title: 'Title', caption: 'Cap', hook: 'Hook' })).toBe('Title');
      expect(getPostDisplayTitle({ title: '', caption: 'Cap', hook: 'Hook' })).toBe('Cap');
      expect(getPostDisplayTitle({ title: '', caption: null, hook: 'Hook' })).toBe('Hook');
    });
  });

  describe('hasPostMetrics', () => {
    it('is true when any metric is positive', () => {
      expect(hasPostMetrics(basePost({ likes: 3 }))).toBe(true);
      expect(hasPostMetrics(basePost())).toBe(false);
    });
  });

  describe('parseLinkedInMetricsPaste', () => {
    it('parses common LinkedIn analytics labels', () => {
      const text = `
        Impressions 1,234
        Reactions: 45
        Comments 8
        Reposts 3
        Saves 2
      `;
      expect(parseLinkedInMetricsPaste(text)).toEqual({
        views: 1234,
        likes: 45,
        comments: 8,
        shares: 3,
        saves: 2,
      });
    });
  });

  describe('enrichPostsWithSyncCounts', () => {
    it('fills likes/comments from synced engagement when post metrics are zero', () => {
      const posts = [basePost({ id: 'a' }), basePost({ id: 'b', likes: 10 })];
      const reactions = new Map([['a', 12]]);
      const comments = new Map([['a', 4]]);
      const enriched = enrichPostsWithSyncCounts(posts, reactions, comments);
      expect(enriched[0].likes).toBe(12);
      expect(enriched[0].comments).toBe(4);
      expect(enriched[1].likes).toBe(10);
    });
  });

  describe('resolvePublishedAt', () => {
    it('uses job timestamp first and treats date-only posted_date as noon', () => {
      expect(
        resolvePublishedAt(
          { posted_date: '2026-06-15', scheduled_publish_at: null, created_at: '2026-01-01' },
          '2026-06-15T18:30:00Z',
        ),
      ).toBe('2026-06-15T18:30:00Z');
      expect(
        resolvePublishedAt(
          { posted_date: '2026-06-15', scheduled_publish_at: null, created_at: '2026-01-01' },
          null,
        ),
      ).toBe('2026-06-15T12:00:00');
    });
  });
});
