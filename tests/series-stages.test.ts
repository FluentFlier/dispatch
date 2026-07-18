import { describe, it, expect } from 'vitest';
import {
  SERIES_STAGES,
  resolveSeriesStage,
  isPublishable,
  seriesProgress,
} from '@/lib/series-stages';
import type { Post } from '@/lib/types';

const post = (overrides: Partial<Post> = {}): Post => ({
  id: 'p1',
  user_id: 'u1',
  title: 'Part',
  pillar: 'founder',
  platform: 'linkedin',
  status: 'idea',
  script: null,
  caption: null,
  hashtags: null,
  hook: null,
  notes: null,
  scheduled_date: null,
  posted_date: null,
  views: null,
  likes: null,
  saves: null,
  comments: null,
  shares: null,
  follows_gained: null,
  voice_match_score: null,
  ai_score: null,
  voice_evaluation: null,
  series_id: 's1',
  series_position: 1,
  variant_group_id: null,
  source_platform: null,
  scheduled_publish_at: null,
  image_url: null,
  created_at: '',
  updated_at: '',
  ...overrides,
});

describe('resolveSeriesStage', () => {
  it('maps each production state to the right stage index', () => {
    expect(resolveSeriesStage(post())).toBe(0); // planned
    expect(resolveSeriesStage(post({ status: 'scripted' }))).toBe(1);
    expect(resolveSeriesStage(post({ script: 'a draft' }))).toBe(1); // script implies scripted
    expect(resolveSeriesStage(post({ status: 'filmed' }))).toBe(2);
    expect(resolveSeriesStage(post({ status: 'edited' }))).toBe(3);
    expect(resolveSeriesStage(post({ caption: 'my caption' }))).toBe(4);
    expect(resolveSeriesStage(post({ scheduled_date: '2026-08-01' }))).toBe(5);
    expect(resolveSeriesStage(post({ status: 'posted' }))).toBe(6);
  });

  it('lets a later stage win over an earlier one', () => {
    // Posted beats everything, even with no caption/schedule.
    expect(resolveSeriesStage(post({ status: 'posted', caption: null, scheduled_date: null }))).toBe(6);
    // Scheduled beats captioned.
    expect(resolveSeriesStage(post({ caption: 'x', scheduled_date: '2026-08-01' }))).toBe(5);
  });

  it('has one stage per index', () => {
    expect(SERIES_STAGES).toHaveLength(7);
  });
});

describe('isPublishable', () => {
  it('is true once there is any content to publish', () => {
    expect(isPublishable(post())).toBe(false);
    expect(isPublishable(post({ hook: 'a hook' }))).toBe(true);
    expect(isPublishable(post({ caption: 'a caption' }))).toBe(true);
  });
});

describe('seriesProgress', () => {
  it('counts posted and in-production parts against the total', () => {
    const parts = [
      post({ status: 'posted' }),
      post({ status: 'edited' }),
      post({ status: 'idea' }), // planned only -> not counted as in production
    ];
    expect(seriesProgress(parts, 5)).toEqual({ posted: 1, inProduction: 1, total: 5 });
  });
});
