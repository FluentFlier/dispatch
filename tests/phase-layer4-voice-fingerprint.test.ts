/**
 * Phase: Layer 4 - Voice Fingerprint
 *
 * Tests for updateVoiceMetrics (EMA updater) and GET /api/voice-metrics.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VoiceEvaluationMatrix } from '@/lib/voice-evaluator';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const WORKSPACE_ID = 'ws-test-uuid';
const USER_ID = 'user-test-uuid';
const POST_ID = 'post-test-uuid';
const PLATFORM = 'linkedin';

const EVALUATION: VoiceEvaluationMatrix = {
  persona_fidelity: 8,
  uniqueness: 7,
  specificity: 8,
  so_what: 8,
  pain_resonance: 7,
  ai_slop: 2,
  revision_notes: '',
  pass: true,
};

const VOICE_MATCH_SCORE = 80;
const AI_SCORE = 20;

// ---------------------------------------------------------------------------
// updateVoiceMetrics tests
// ---------------------------------------------------------------------------

describe('Layer 4: Voice Fingerprint', () => {
  describe('updateVoiceMetrics', () => {
    beforeEach(() => vi.resetModules());

    it('returns early when layer4_voice_metrics flag disabled', async () => {
      vi.doMock('@/lib/feature-flags', () => ({
        isEnabled: vi.fn().mockResolvedValue(false),
      }));

      const insertMock = vi.fn();
      const updateMock = vi.fn();

      const fakeClient = {
        database: {
          from: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null }),
            insert: insertMock,
            update: updateMock,
          }),
        },
      };

      const { updateVoiceMetrics } = await import('@/lib/voice-metrics');
      await updateVoiceMetrics(
        fakeClient as never,
        WORKSPACE_ID,
        USER_ID,
        PLATFORM,
        EVALUATION,
        VOICE_MATCH_SCORE,
        AI_SCORE,
        POST_ID,
      );

      // Flag is disabled - no DB writes should occur
      expect(insertMock).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
    });

    it('inserts new row on first publish for a platform', async () => {
      vi.doMock('@/lib/feature-flags', () => ({
        isEnabled: vi.fn().mockResolvedValue(true),
      }));

      const insertMock = vi.fn().mockResolvedValue({ error: null });
      const maybeSingleMock = vi.fn().mockResolvedValue({ data: null });

      const fromMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: maybeSingleMock,
        insert: insertMock,
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis() }),
      });

      const fakeClient = { database: { from: fromMock } };

      const { updateVoiceMetrics } = await import('@/lib/voice-metrics');
      await updateVoiceMetrics(
        fakeClient as never,
        WORKSPACE_ID,
        USER_ID,
        PLATFORM,
        EVALUATION,
        VOICE_MATCH_SCORE,
        AI_SCORE,
        POST_ID,
      );

      // Called twice: once for platform, once for 'all'
      expect(insertMock).toHaveBeenCalledTimes(2);

      const firstCall = insertMock.mock.calls[0][0] as Record<string, unknown>;
      expect(firstCall.workspace_id).toBe(WORKSPACE_ID);
      expect(firstCall.user_id).toBe(USER_ID);
      expect(firstCall.platform).toBe(PLATFORM);
      expect(firstCall.avg_voice_match_score).toBe(VOICE_MATCH_SCORE);
      expect(firstCall.avg_ai_score).toBe(AI_SCORE);
      expect(firstCall.post_count).toBe(1);
      expect(firstCall.last_post_id).toBe(POST_ID);
    });

    it('EMA formula: new_avg = 0.3 * new + 0.7 * existing', async () => {
      vi.doMock('@/lib/feature-flags', () => ({
        isEnabled: vi.fn().mockResolvedValue(true),
      }));

      const existingRow = {
        avg_voice_match_score: '70',
        avg_ai_score: '30',
        avg_persona_fidelity: '70',
        avg_uniqueness: '60',
        avg_specificity: '70',
        avg_so_what: '70',
        avg_pain_resonance: '60',
        post_count: '5',
      };

      const updatePayloadCapture: Record<string, unknown>[] = [];
      const updateMock = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
        updatePayloadCapture.push(payload);
        return { eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) };
      });

      const fromMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: existingRow }),
        insert: vi.fn(),
        update: updateMock,
      });

      const fakeClient = { database: { from: fromMock } };

      const { updateVoiceMetrics } = await import('@/lib/voice-metrics');
      await updateVoiceMetrics(
        fakeClient as never,
        WORKSPACE_ID,
        USER_ID,
        PLATFORM,
        EVALUATION,
        VOICE_MATCH_SCORE,
        AI_SCORE,
        POST_ID,
      );

      expect(updatePayloadCapture.length).toBeGreaterThan(0);
      const payload = updatePayloadCapture[0];

      // EMA: 0.3 * 80 + 0.7 * 70 = 24 + 49 = 73
      expect(payload.avg_voice_match_score).toBeCloseTo(73, 5);
      // EMA: 0.3 * 20 + 0.7 * 30 = 6 + 21 = 27
      expect(payload.avg_ai_score).toBeCloseTo(27, 5);
    });

    it('updates both platform-specific AND all aggregate', async () => {
      vi.doMock('@/lib/feature-flags', () => ({
        isEnabled: vi.fn().mockResolvedValue(true),
      }));

      const insertMock = vi.fn().mockResolvedValue({ error: null });
      const maybeSingleMock = vi.fn().mockResolvedValue({ data: null });

      const fromMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: maybeSingleMock,
        insert: insertMock,
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis() }),
      });

      const fakeClient = { database: { from: fromMock } };

      const { updateVoiceMetrics } = await import('@/lib/voice-metrics');
      await updateVoiceMetrics(
        fakeClient as never,
        WORKSPACE_ID,
        USER_ID,
        PLATFORM,
        EVALUATION,
        VOICE_MATCH_SCORE,
        AI_SCORE,
        POST_ID,
      );

      // Platform row + 'all' aggregate = 2 inserts
      expect(insertMock).toHaveBeenCalledTimes(2);

      const platforms = insertMock.mock.calls.map(
        (call: Array<Record<string, unknown>>) => call[0].platform,
      );
      expect(platforms).toContain(PLATFORM);
      expect(platforms).toContain('all');
    });

    it('evaluation dimensions multiplied by 10 (0-10 scale -> 0-100)', async () => {
      vi.doMock('@/lib/feature-flags', () => ({
        isEnabled: vi.fn().mockResolvedValue(true),
      }));

      const insertMock = vi.fn().mockResolvedValue({ error: null });

      const fromMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        insert: insertMock,
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis() }),
      });

      const fakeClient = { database: { from: fromMock } };

      const { updateVoiceMetrics } = await import('@/lib/voice-metrics');
      await updateVoiceMetrics(
        fakeClient as never,
        WORKSPACE_ID,
        USER_ID,
        PLATFORM,
        EVALUATION,
        VOICE_MATCH_SCORE,
        AI_SCORE,
        POST_ID,
      );

      const payload = insertMock.mock.calls[0][0] as Record<string, unknown>;
      // EVALUATION.persona_fidelity = 8 → stored as 80
      expect(payload.avg_persona_fidelity).toBe(EVALUATION.persona_fidelity * 10);
      expect(payload.avg_uniqueness).toBe(EVALUATION.uniqueness * 10);
      expect(payload.avg_specificity).toBe(EVALUATION.specificity * 10);
      expect(payload.avg_so_what).toBe(EVALUATION.so_what * 10);
      expect(payload.avg_pain_resonance).toBe(EVALUATION.pain_resonance * 10);
    });

    it('increments post_count on every call', async () => {
      vi.doMock('@/lib/feature-flags', () => ({
        isEnabled: vi.fn().mockResolvedValue(true),
      }));

      const existingRow = {
        avg_voice_match_score: '75',
        avg_ai_score: '25',
        avg_persona_fidelity: '75',
        avg_uniqueness: '70',
        avg_specificity: '75',
        avg_so_what: '75',
        avg_pain_resonance: '70',
        post_count: '5',
      };

      const updatePayloads: Record<string, unknown>[] = [];
      const updateMock = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
        updatePayloads.push(payload);
        return { eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) };
      });

      const fromMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: existingRow }),
        insert: vi.fn(),
        update: updateMock,
      });

      const fakeClient = { database: { from: fromMock } };

      const { updateVoiceMetrics } = await import('@/lib/voice-metrics');
      await updateVoiceMetrics(
        fakeClient as never,
        WORKSPACE_ID,
        USER_ID,
        PLATFORM,
        EVALUATION,
        VOICE_MATCH_SCORE,
        AI_SCORE,
        POST_ID,
      );

      // Both platform and 'all' rows get post_count incremented
      expect(updatePayloads[0].post_count).toBe(6); // 5 + 1
    });

    it('updates last_post_id to current postId', async () => {
      vi.doMock('@/lib/feature-flags', () => ({
        isEnabled: vi.fn().mockResolvedValue(true),
      }));

      const existingRow = {
        avg_voice_match_score: '75',
        avg_ai_score: '25',
        avg_persona_fidelity: '75',
        avg_uniqueness: '70',
        avg_specificity: '75',
        avg_so_what: '75',
        avg_pain_resonance: '70',
        post_count: '3',
      };

      const updatePayloads: Record<string, unknown>[] = [];
      const updateMock = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
        updatePayloads.push(payload);
        return { eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) };
      });

      const fromMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: existingRow }),
        insert: vi.fn(),
        update: updateMock,
      });

      const fakeClient = { database: { from: fromMock } };

      const { updateVoiceMetrics } = await import('@/lib/voice-metrics');
      await updateVoiceMetrics(
        fakeClient as never,
        WORKSPACE_ID,
        USER_ID,
        PLATFORM,
        EVALUATION,
        VOICE_MATCH_SCORE,
        AI_SCORE,
        POST_ID,
      );

      expect(updatePayloads[0].last_post_id).toBe(POST_ID);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /api/voice-metrics
  // ---------------------------------------------------------------------------

  describe('GET /api/voice-metrics', () => {
    beforeEach(() => vi.resetModules());

    it('returns 401 without auth', async () => {
      vi.doMock('@/lib/insforge/server', () => ({
        getAuthenticatedUser: vi.fn().mockResolvedValue(null),
        getServerClient: vi.fn(),
      }));
      vi.doMock('@/lib/workspace', () => ({
        getActiveWorkspaceId: vi.fn(),
      }));

      const { GET } = await import('@/app/api/voice-metrics/route');
      const response = await GET();
      expect(response.status).toBe(401);

      const body = await response.json() as { error: string };
      expect(body.error).toBe('Unauthorized');
    });

    it('returns empty platforms object when no data', async () => {
      vi.doMock('@/lib/insforge/server', () => ({
        getAuthenticatedUser: vi.fn().mockResolvedValue({ id: USER_ID, email: 'test@test.com' }),
        getServerClient: vi.fn().mockReturnValue({
          database: {
            from: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          },
        }),
      }));
      vi.doMock('@/lib/workspace', () => ({
        getActiveWorkspaceId: vi.fn().mockResolvedValue(WORKSPACE_ID),
      }));

      const { GET } = await import('@/app/api/voice-metrics/route');
      const response = await GET();
      expect(response.status).toBe(200);

      const body = await response.json() as { platforms: Record<string, unknown> };
      expect(body.platforms).toEqual({});
    });

    it('returns correct structure with all breakdown dimensions', async () => {
      const dbRow = {
        platform: 'linkedin',
        avg_voice_match_score: '78.50',
        avg_ai_score: '12.00',
        avg_persona_fidelity: '82.00',
        avg_uniqueness: '71.00',
        avg_specificity: '79.00',
        avg_so_what: '81.00',
        avg_pain_resonance: '74.00',
        post_count: '12',
      };

      vi.doMock('@/lib/insforge/server', () => ({
        getAuthenticatedUser: vi.fn().mockResolvedValue({ id: USER_ID, email: 'test@test.com' }),
        getServerClient: vi.fn().mockReturnValue({
          database: {
            from: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockResolvedValue({ data: [dbRow], error: null }),
            }),
          },
        }),
      }));
      vi.doMock('@/lib/workspace', () => ({
        getActiveWorkspaceId: vi.fn().mockResolvedValue(WORKSPACE_ID),
      }));

      const { GET } = await import('@/app/api/voice-metrics/route');
      const response = await GET();
      expect(response.status).toBe(200);

      const body = await response.json() as {
        platforms: Record<string, {
          avg_voice_match_score: number;
          avg_ai_score: number;
          post_count: number;
          breakdown: Record<string, number>;
        }>;
      };

      expect(body.platforms).toHaveProperty('linkedin');
      const linkedin = body.platforms['linkedin'];
      expect(linkedin.avg_voice_match_score).toBeCloseTo(78.5);
      expect(linkedin.avg_ai_score).toBeCloseTo(12);
      expect(linkedin.post_count).toBe(12);
      expect(linkedin.breakdown).toMatchObject({
        persona_fidelity: 82,
        uniqueness: 71,
        specificity: 79,
        so_what: 81,
        pain_resonance: 74,
      });
    });
  });
});
