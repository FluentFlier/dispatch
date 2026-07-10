import { describe, it, expect, beforeEach } from 'vitest';

import {
  retryWithBackoff,
  isTransientError,
  HttpStatusError,
  checkDailyUsage,
  incrementDailyUsage,
  clearDailyUsage,
  dailyRandomMinute,
  isDailyRandomMinuteNow,
  getRandomDelayMs,
} from '@/lib/social/reliability';
import {
  buildPostIdCandidates,
  extractReactions,
} from '@/lib/engagement/unipile-reactions';
import { buildReactionAuthorKey } from '@/lib/engagement/sync';
import { collectEngagers } from '@/lib/engagement/categorize-engagers';
import { extractLinkedInMetrics } from '@/lib/platforms/linkedin-metrics';
import { isTaskClaimable } from '@/lib/engagement/tasks';
import { parseLinkedInPostTarget } from '@/lib/engagement/post-url';

describe('Phase: LinkedIn Engagement Pipeline', () => {
  // --- Reliability toolkit ---

  describe('retryWithBackoff', () => {
    const noSleep = async () => {};

    it('should return the result after transient 429 failures', async () => {
      let calls = 0;
      const result = await retryWithBackoff(
        async () => {
          calls++;
          if (calls < 3) throw new HttpStatusError(429, 'rate limited');
          return 'ok';
        },
        { sleep: noSleep },
      );
      expect(result).toBe('ok');
      expect(calls).toBe(3);
    });

    it('should NOT retry permanent 4xx errors', async () => {
      let calls = 0;
      await expect(
        retryWithBackoff(
          async () => {
            calls++;
            throw new HttpStatusError(404, 'not found');
          },
          { sleep: noSleep },
        ),
      ).rejects.toThrow('not found');
      expect(calls).toBe(1);
    });

    it('should give up after maxRetries transient failures', async () => {
      let calls = 0;
      await expect(
        retryWithBackoff(
          async () => {
            calls++;
            throw new HttpStatusError(500, 'server error');
          },
          { maxRetries: 2, sleep: noSleep },
        ),
      ).rejects.toThrow('server error');
      expect(calls).toBe(3); // initial + 2 retries
    });

    it('should classify network errors as transient', () => {
      expect(isTransientError(new TypeError('fetch failed'))).toBe(true);
      expect(isTransientError(new HttpStatusError(429, 'x'))).toBe(true);
      expect(isTransientError(new HttpStatusError(503, 'x'))).toBe(true);
      expect(isTransientError(new HttpStatusError(400, 'x'))).toBe(false);
      expect(isTransientError(new HttpStatusError(401, 'x'))).toBe(false);
    });
  });

  describe('daily usage tracker', () => {
    beforeEach(() => clearDailyUsage());

    it('should allow actions under the cap and block over it', () => {
      expect(checkDailyUsage('acct-1', 2, 100).allowed).toBe(true);
      incrementDailyUsage('acct-1', 99);
      expect(checkDailyUsage('acct-1', 2, 100).allowed).toBe(false);
      expect(checkDailyUsage('acct-1', 1, 100).allowed).toBe(true);
    });

    it('should reset counts on a new UTC day', () => {
      const day1 = new Date('2026-07-05T10:00:00Z');
      const day2 = new Date('2026-07-06T00:01:00Z');
      incrementDailyUsage('acct-2', 100, day1);
      expect(checkDailyUsage('acct-2', 1, 100, day1).allowed).toBe(false);
      expect(checkDailyUsage('acct-2', 1, 100, day2).allowed).toBe(true);
    });

    it('should track accounts independently', () => {
      incrementDailyUsage('acct-a', 100);
      expect(checkDailyUsage('acct-a', 1).allowed).toBe(false);
      expect(checkDailyUsage('acct-b', 1).allowed).toBe(true);
    });
  });

  describe('daily random minute scheduling', () => {
    it('should be deterministic for the same seed and date', () => {
      const now = new Date('2026-07-05T12:00:00Z');
      expect(dailyRandomMinute('seed-x', now)).toBe(dailyRandomMinute('seed-x', now));
    });

    it('should stay within 0-1439', () => {
      for (const seed of ['a', 'b', 'user-123', 'engagement']) {
        const minute = dailyRandomMinute(seed, new Date('2026-07-05T00:00:00Z'));
        expect(minute).toBeGreaterThanOrEqual(0);
        expect(minute).toBeLessThan(1440);
      }
    });

    it('should match only at the chosen minute', () => {
      const day = new Date('2026-07-05T00:00:00Z');
      const minute = dailyRandomMinute('seed-y', day);
      const at = new Date(Date.UTC(2026, 6, 5, Math.floor(minute / 60), minute % 60));
      const notAt = new Date(Date.UTC(2026, 6, 5, (Math.floor(minute / 60) + 1) % 24, minute % 60));
      expect(isDailyRandomMinuteNow('seed-y', at)).toBe(true);
      expect(isDailyRandomMinuteNow('seed-y', notAt)).toBe(false);
    });

    it('should produce delays within bounds', () => {
      for (let i = 0; i < 20; i++) {
        const d = getRandomDelayMs(150, 300);
        expect(d).toBeGreaterThanOrEqual(150);
        expect(d).toBeLessThanOrEqual(300);
      }
    });
  });

  // --- Reactions sync ---

  describe('buildPostIdCandidates', () => {
    it('should try four URN formats for numeric LinkedIn ids', () => {
      expect(buildPostIdCandidates('7212345678901234567')).toEqual([
        'urn:li:activity:7212345678901234567',
        '7212345678901234567',
        'urn:li:share:7212345678901234567',
        'urn:li:ugcPost:7212345678901234567',
      ]);
    });

    it('should pass non-numeric ids through untouched', () => {
      expect(buildPostIdCandidates('urn:li:activity:123')).toEqual(['urn:li:activity:123']);
      expect(buildPostIdCandidates('abc-unipile-id')).toEqual(['abc-unipile-id']);
    });
  });

  describe('extractReactions', () => {
    it('should parse the items array with nested author objects', () => {
      const parsed = extractReactions({
        items: [
          {
            value: 'PRAISE',
            author: { name: 'Jane Doe', public_identifier: 'janedoe', headline: 'CEO at Acme' },
          },
        ],
      });
      expect(parsed).toEqual([
        {
          reaction_type: 'PRAISE',
          author_name: 'Jane Doe',
          author_handle: 'janedoe',
          author_headline: 'CEO at Acme',
          author_profile_url: undefined,
          is_company: false,
        },
      ]);
    });

    it('should default reaction type to LIKE and skip authorless rows', () => {
      const parsed = extractReactions({
        data: [{ author: { name: 'Sam' } }, { value: 'LIKE' }],
      });
      expect(parsed).toHaveLength(1);
      expect(parsed[0].reaction_type).toBe('LIKE');
      expect(parsed[0].author_name).toBe('Sam');
    });

    it('should return empty for malformed payloads', () => {
      expect(extractReactions(null)).toEqual([]);
      expect(extractReactions('nope')).toEqual([]);
      expect(extractReactions({})).toEqual([]);
    });
  });

  describe('buildReactionAuthorKey', () => {
    it('should prefer handle over name and normalize case', () => {
      expect(buildReactionAuthorKey({ author_handle: 'JaneDoe', author_name: 'Jane' })).toBe('janedoe');
      expect(buildReactionAuthorKey({ author_name: ' Jane Doe ' })).toBe('jane doe');
      expect(buildReactionAuthorKey({})).toBe('');
    });
  });

  // --- Lead categorization ---

  describe('collectEngagers', () => {
    it('should dedupe the same person across comments and reactions, preferring the comment', () => {
      const engagers = collectEngagers(
        [
          {
            post_id: 'p1',
            author_name: 'Jane',
            author_handle: 'janedoe',
            author_headline: 'Founder',
            comment_text: 'How did you build this?',
          },
        ],
        [
          { post_id: 'p2', author_name: 'Jane', author_handle: 'JaneDoe', author_headline: 'Founder' },
          { post_id: 'p2', author_name: 'Bob', author_handle: 'bob', author_headline: 'Designer' },
        ],
      );
      expect(engagers).toHaveLength(2);
      const jane = engagers.find((e) => e.handle === 'janedoe');
      expect(jane?.engagementType).toBe('comment');
      expect(jane?.bio).toContain('How did you build this?');
      const bob = engagers.find((e) => e.handle === 'bob');
      expect(bob?.engagementType).toBe('like');
    });

    it('should skip rows with no identity', () => {
      const engagers = collectEngagers(
        [{ post_id: 'p1', author_name: null, author_handle: null, author_headline: null, comment_text: 'hi' }],
        [],
      );
      expect(engagers).toHaveLength(0);
    });
  });

  // --- LinkedIn metrics ---

  describe('extractLinkedInMetrics', () => {
    it('should prefer the analytics object', () => {
      expect(
        extractLinkedInMetrics({
          analytics: { impressions: 1200, reactions: 45, comments: 8, reposts: 3 },
        }),
      ).toEqual({ views: 1200, likes: 45, comments: 8, shares: 3 });
    });

    it('should fall back to flat counter fields', () => {
      expect(
        extractLinkedInMetrics({
          impressions_counter: 900,
          reaction_counter: 30,
          comment_counter: 5,
          repost_counter: 2,
        }),
      ).toEqual({ views: 900, likes: 30, comments: 5, shares: 2 });
    });

    it('should read Unipile v2 analytics.*_counter field names', () => {
      expect(
        extractLinkedInMetrics({
          analytics: {
            impressions_counter: 1200,
            reactions_counter: 45,
            comments_counter: 8,
            reposts_counter: 3,
          },
        }),
      ).toEqual({ views: 1200, likes: 45, comments: 8, shares: 3 });
    });

    it('should leave missing fields undefined so stored values are never zeroed', () => {
      const metrics = extractLinkedInMetrics({ analytics: { impressions: 100 } });
      expect(metrics.views).toBe(100);
      expect(metrics.likes).toBeUndefined();
      expect(metrics.comments).toBeUndefined();
      expect(metrics.shares).toBeUndefined();
    });

    it('should ignore zero impressions (LinkedIn often hides them as 0)', () => {
      const metrics = extractLinkedInMetrics({
        impressions_counter: 0,
        reaction_counter: 93,
        comment_counter: 4,
      });
      expect(metrics.views).toBeUndefined();
      expect(metrics.likes).toBe(93);
      expect(metrics.comments).toBe(4);
    });

    it('should map followers_gained_from_this_post onto follows', () => {
      expect(
        extractLinkedInMetrics({
          analytics: { followers_gained_from_this_post: 12, impressions: 500 },
          reaction_counter: 3,
        }),
      ).toMatchObject({ views: 500, likes: 3, follows: 12 });
    });

    it('should return empty metrics for malformed payloads', () => {
      expect(extractLinkedInMetrics(null)).toEqual({});
      expect(extractLinkedInMetrics({ analytics: { impressions: -5 } })).toEqual({
        views: undefined,
        likes: undefined,
        comments: undefined,
        shares: undefined,
        follows: undefined,
      });
    });
  });

  // --- Outbound engagement queue ---

  describe('isTaskClaimable', () => {
    const base = {
      status: 'approved' as const,
      scheduled_at: '2026-07-05T00:00:00Z',
      attempts: 0,
      max_attempts: 3,
      lease_expires_at: null,
    };
    const now = new Date('2026-07-05T12:00:00Z');

    it('should claim an approved, due, unleased task', () => {
      expect(isTaskClaimable(base, now)).toBe(true);
    });

    it('should never claim drafts or sent tasks (double-post guard)', () => {
      expect(isTaskClaimable({ ...base, status: 'draft' as never }, now)).toBe(false);
      expect(isTaskClaimable({ ...base, status: 'sent' as never }, now)).toBe(false);
      expect(isTaskClaimable({ ...base, status: 'processing' as never }, now)).toBe(false);
    });

    it('should respect future scheduling and attempt budget', () => {
      expect(isTaskClaimable({ ...base, scheduled_at: '2026-07-06T00:00:00Z' }, now)).toBe(false);
      expect(isTaskClaimable({ ...base, attempts: 3 }, now)).toBe(false);
    });

    it('should skip live leases but claim expired ones', () => {
      expect(
        isTaskClaimable({ ...base, lease_expires_at: '2026-07-05T12:05:00Z' }, now),
      ).toBe(false);
      expect(
        isTaskClaimable({ ...base, lease_expires_at: '2026-07-05T11:00:00Z' }, now),
      ).toBe(true);
    });
  });

  describe('parseLinkedInPostTarget', () => {
    it('should extract the activity URN from feed URLs', () => {
      expect(
        parseLinkedInPostTarget(
          'https://www.linkedin.com/feed/update/urn:li:activity:7212345678901234567/',
        ),
      ).toBe('urn:li:activity:7212345678901234567');
      expect(
        parseLinkedInPostTarget(
          'https://www.linkedin.com/posts/janedoe_topic-activity-7212345678901234567-Ab3d',
        ),
      ).toBe('urn:li:activity:7212345678901234567');
    });

    it('should accept raw numeric ids and reject junk', () => {
      expect(parseLinkedInPostTarget('7212345678901234567')).toBe(
        'urn:li:activity:7212345678901234567',
      );
      expect(parseLinkedInPostTarget('not a post')).toBeNull();
      expect(parseLinkedInPostTarget('')).toBeNull();
    });
  });
});
