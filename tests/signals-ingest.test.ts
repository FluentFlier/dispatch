import { describe, expect, it } from 'vitest';
import {
  filterPostsSinceCursor,
  newestPostId,
  unipileItemToPost,
} from '@/lib/signals/ingest/normalize';
import type { IngestedPost } from '@/lib/signals/types';

describe('signals ingest normalize', () => {
  it('filters posts newer than cursor', () => {
    const posts: IngestedPost[] = [
      { platform: 'x', externalPostId: '3', content: 'newest post with enough chars' },
      { platform: 'x', externalPostId: '2', content: 'middle post with enough chars' },
      { platform: 'x', externalPostId: '1', content: 'older post with enough chars' },
    ];

    expect(filterPostsSinceCursor(posts, '2', 5).map((p) => p.externalPostId)).toEqual(['3']);
    expect(filterPostsSinceCursor(posts, '3', 5)).toEqual([]);
  });

  it('returns capped batch when cursor missing', () => {
    const posts: IngestedPost[] = [
      { platform: 'x', externalPostId: 'a', content: 'first post with enough characters' },
      { platform: 'x', externalPostId: 'b', content: 'second post with enough characters' },
    ];
    expect(filterPostsSinceCursor(posts, undefined, 1)).toHaveLength(1);
    expect(newestPostId(posts)).toBe('a');
  });

  it('skips reposts from unipile items', () => {
    const post = unipileItemToPost(
      { id: 'p1', text: 'Excited to join YC W25 batch today!', is_repost: true },
      'linkedin',
      'founder',
    );
    expect(post).toBeNull();
  });
});
