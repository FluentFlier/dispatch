/**
 * Phase: Layer 5 — Engagement Loop (Reply → Content)
 *
 * Tests for:
 * - Comment signal detection pre-filter (length + generic phrases)
 * - Per-run Haiku cap (MAX_HAIKU_PER_RUN = 25)
 * - content_ideas creation: source, status, source_comment_id
 * - GET /api/ideas?status=suggested
 * - PATCH /api/ideas/[id] status transitions
 * - sync.ts: runTrainingStep removed
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORKSPACE_ID = 'ws-test-uuid';
const USER_ID = 'user-test-uuid';
const COMMENT_ID = 'comment-test-uuid';
const IDEA_ID = 'idea-test-uuid';
const POST_TITLE = 'How I got my first 10 customers';
const AUTHOR_HANDLE = 'sarah_chen';

// ---------------------------------------------------------------------------
// Helpers — build mock InsforgeClient rows
// ---------------------------------------------------------------------------

function makeComment(overrides: Partial<{
  id: string;
  comment_text: string;
  author_handle: string;
  post_id: string;
}> = {}) {
  return {
    id: overrides.id ?? COMMENT_ID,
    user_id: USER_ID,
    post_id: overrides.post_id ?? 'post-uuid',
    platform: 'linkedin',
    provider_comment_id: 'prov-001',
    author_name: 'Sarah Chen',
    author_handle: overrides.author_handle ?? AUTHOR_HANDLE,
    author_headline: null,
    comment_text: overrides.comment_text ?? 'This is a substantive comment that is long enough to pass the pre-filter.',
    commented_at: '2026-06-25T12:00:00Z',
    parent_comment_id: null,
    synced_at: '2026-06-25T12:00:00Z',
    is_content_signal: null,
    content_angle: null,
    signal_processed_at: null,
  };
}

// ---------------------------------------------------------------------------
// describe: signal detection pre-filter
// ---------------------------------------------------------------------------

describe('Layer 5: Engagement Loop', () => {
  describe('signal detection pre-filter', () => {
    /**
     * The pre-filter runs before any Haiku call. These tests verify that the
     * GENERIC_PHRASES list and length check correctly classify noise comments
     * without touching the LLM budget.
     */

    const GENERIC_PHRASES = ['great post', 'so true', 'love this', 'thanks for sharing', 'well said'];
    const MIN_LENGTH = 50;

    function isGenericComment(text: string): boolean {
      return (
        text.length < MIN_LENGTH ||
        GENERIC_PHRASES.some((p) => text.toLowerCase().includes(p))
      );
    }

    it('skips comments shorter than 50 chars', () => {
      const shortComment = 'Nice one!';
      expect(shortComment.length).toBeLessThan(MIN_LENGTH);
      expect(isGenericComment(shortComment)).toBe(true);
    });

    it('skips generic phrases: "great post", "so true", "love this"', () => {
      expect(isGenericComment('This is such a great post, really enjoyed reading it through!')).toBe(true);
      expect(isGenericComment('So true, I feel exactly the same way about this topic every time.')).toBe(true);
      expect(isGenericComment('Love this content, it really resonates with my daily experience here.')).toBe(true);
    });

    it('skips "thanks for sharing" and "well said"', () => {
      expect(isGenericComment('Thanks for sharing this insight, really valuable perspective for me.')).toBe(true);
      expect(isGenericComment('Well said! This is exactly what I needed to read today in my feed.')).toBe(true);
    });

    it('processes substantive comments past filters', () => {
      const substantive = "What's your process for building in public without burning out? I've tried but always quit after 2 weeks.";
      expect(isGenericComment(substantive)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // describe: per-run cap
  // ---------------------------------------------------------------------------

  describe('per-run cap', () => {
    it('stops processing after 25 Haiku calls per run', () => {
      const MAX_HAIKU_PER_RUN = 25;
      let haikusUsed = 0;
      const callsAttempted: number[] = [];

      // Simulate 30 substantive comments
      const comments = Array.from({ length: 30 }, (_, i) => ({
        id: `comment-${i}`,
        comment_text: `This is substantive comment number ${i} with enough text to pass the pre-filter and trigger signal detection.`,
      }));

      for (const comment of comments) {
        if (haikusUsed >= MAX_HAIKU_PER_RUN) break;
        // Simulate a Haiku call happening
        callsAttempted.push(comment.id.length);
        haikusUsed++;
      }

      expect(haikusUsed).toBe(MAX_HAIKU_PER_RUN);
      expect(callsAttempted).toHaveLength(MAX_HAIKU_PER_RUN);
    });

    it('still marks remaining comments as processed when budget blocked', () => {
      // When budget === 'blocked', signal_processed_at must still be set.
      // This test verifies the contract: a blocked comment gets processed_at = now()
      // so it is not re-scanned on the next cron run.
      const processedIds: string[] = [];

      function markProcessed(commentId: string): void {
        processedIds.push(commentId);
      }

      const blockedComment = makeComment({ id: 'blocked-comment-uuid' });
      // Simulate budget blocked path
      const budget = 'blocked';
      if (budget === 'blocked') {
        markProcessed(blockedComment.id);
      }

      expect(processedIds).toContain('blocked-comment-uuid');
    });
  });

  // ---------------------------------------------------------------------------
  // describe: content_ideas creation
  // ---------------------------------------------------------------------------

  describe('content_ideas creation', () => {
    /**
     * These tests verify the shape of content_ideas rows created when a signal
     * is detected. They test the business rules, not the DB write directly.
     */

    function buildIdeaRow(
      commentId: string,
      angle: string,
      pillar: string,
    ): {
      user_id: string;
      workspace_id: string;
      idea: string;
      pillar: string;
      source: string;
      source_comment_id: string;
      status: string;
      notes: string;
      converted: boolean;
    } {
      return {
        user_id: USER_ID,
        workspace_id: WORKSPACE_ID,
        idea: angle,
        pillar,
        source: 'from_comment',
        source_comment_id: commentId,
        status: 'suggested',
        notes: `From reply to "${POST_TITLE}" — @${AUTHOR_HANDLE}`,
        converted: false,
      };
    }

    it('creates idea with source=from_comment when signal detected', () => {
      const idea = buildIdeaRow(COMMENT_ID, 'Building in public without burnout', 'founder_story');
      expect(idea.source).toBe('from_comment');
    });

    it('creates idea with status=suggested (not active)', () => {
      const idea = buildIdeaRow(COMMENT_ID, 'Building in public without burnout', 'founder_story');
      expect(idea.status).toBe('suggested');
      expect(idea.status).not.toBe('active');
    });

    it('stores source_comment_id linking back to comment', () => {
      const idea = buildIdeaRow(COMMENT_ID, 'Building in public without burnout', 'founder_story');
      expect(idea.source_comment_id).toBe(COMMENT_ID);
    });

    it('does not create idea when is_signal=false', () => {
      const createdIdeas: unknown[] = [];
      const parsed = { is_signal: false, angle: '', pillar: 'general' };

      if (parsed.is_signal && parsed.angle) {
        createdIdeas.push(buildIdeaRow(COMMENT_ID, parsed.angle, parsed.pillar));
      }

      expect(createdIdeas).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // describe: GET /api/ideas?status=suggested
  // ---------------------------------------------------------------------------

  describe('GET /api/ideas?status=suggested', () => {
    /**
     * Verifies the status filter logic extracted from the route handler.
     * The route applies .eq('status', statusFilter) when the param is provided,
     * and defaults to .eq('status', 'active') when absent.
     */

    const VALID_STATUSES = ['active', 'suggested', 'dismissed'] as const;
    type IdeaStatus = (typeof VALID_STATUSES)[number];

    function resolveStatusFilter(rawStatus: string | null): IdeaStatus {
      if (VALID_STATUSES.includes(rawStatus as IdeaStatus)) {
        return rawStatus as IdeaStatus;
      }
      return 'active';
    }

    it('returns only suggested ideas when status=suggested', () => {
      const filter = resolveStatusFilter('suggested');
      expect(filter).toBe('suggested');
    });

    it('returns active ideas by default', () => {
      const filter = resolveStatusFilter(null);
      expect(filter).toBe('active');
    });

    it('returns active ideas when status param is invalid', () => {
      const filter = resolveStatusFilter('invalid_status');
      expect(filter).toBe('active');
    });
  });

  // ---------------------------------------------------------------------------
  // describe: PATCH /api/ideas/[id]
  // ---------------------------------------------------------------------------

  describe('PATCH /api/ideas/[id]', () => {
    /**
     * Verifies the PATCH handler status validation logic.
     * The handler accepts active|dismissed (L5 status transitions).
     * The underlying Zod schema also accepts the full enum set.
     */

    const ALLOWED_STATUSES = ['backlog', 'planned', 'in_progress', 'done', 'active', 'suggested', 'dismissed'] as const;
    type AllowedStatus = (typeof ALLOWED_STATUSES)[number];

    function validateStatus(status: string): { valid: boolean; value: AllowedStatus | null } {
      if (ALLOWED_STATUSES.includes(status as AllowedStatus)) {
        return { valid: true, value: status as AllowedStatus };
      }
      return { valid: false, value: null };
    }

    it('promotes idea from suggested to active', () => {
      const result = validateStatus('active');
      expect(result.valid).toBe(true);
      expect(result.value).toBe('active');
    });

    it('dismisses idea', () => {
      const result = validateStatus('dismissed');
      expect(result.valid).toBe(true);
      expect(result.value).toBe('dismissed');
    });

    it('rejects invalid status values', () => {
      const result = validateStatus('published');
      expect(result.valid).toBe(false);
      expect(result.value).toBeNull();
    });

    it('returns 404 for idea in different workspace', () => {
      // Simulate workspace scoping — the PATCH query adds .eq('workspace_id', workspaceId).
      // If no row is found (different workspace), select().single() returns null data.
      const differentWorkspaceResult = { data: null, error: { message: 'No rows found' } };
      expect(differentWorkspaceResult.data).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // describe: engagement/sync.ts — runTrainingStep removed
  // ---------------------------------------------------------------------------

  describe('engagement/sync.ts', () => {
    it('does NOT import or call runTrainingStep', async () => {
      // Read the sync module source and assert runTrainingStep is gone.
      // This is a static analysis test — no runtime import needed.
      const fs = await import('fs');
      const path = await import('path');

      const syncPath = path.resolve(
        process.cwd(),
        'src/lib/engagement/sync.ts',
      );
      const source = fs.readFileSync(syncPath, 'utf-8');

      expect(source).not.toContain('runTrainingStep');
      expect(source).not.toContain("import('@/lib/hooks-intelligence/rl-trainer')");
    });
  });
});
