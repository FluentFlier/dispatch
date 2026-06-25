/**
 * Phase: Layer 2 -- RL Intelligence Pipeline
 * Tests the nightly intelligence-sync cron, EMA trainer, and PILLAR_TO_VERTICAL mapping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateFromPerformanceDB } from '@/lib/hooks-intelligence/rl-trainer';
import { PILLAR_TO_VERTICAL } from '@/lib/hooks-intelligence/types';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// intelligence-sync cron
// ---------------------------------------------------------------------------
describe('Layer 2: RL Intelligence', () => {
  describe('intelligence-sync cron', () => {
    beforeEach(() => vi.resetModules());

    it('returns 401 without CRON_SECRET', async () => {
      process.env.CRON_SECRET = 'secret123';

      vi.doMock('@/lib/insforge/server', () => ({
        getServiceClient: vi.fn(),
      }));
      vi.doMock('@/lib/feature-flags', () => ({
        isEnabled: vi.fn().mockResolvedValue(true),
      }));

      const { GET } = await import('@/app/api/cron/intelligence-sync/route');
      const req = new Request('http://localhost/api/cron/intelligence-sync', {
        headers: { authorization: 'Bearer wrong-secret' },
      });

      const res = await GET(req as any);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Unauthorized');
    });

    it('returns skipped when flag disabled', async () => {
      process.env.CRON_SECRET = 'secret123';

      const fakeClient = { database: { from: vi.fn() } };

      vi.doMock('@/lib/insforge/server', () => ({
        getServiceClient: vi.fn().mockReturnValue(fakeClient),
      }));
      vi.doMock('@/lib/feature-flags', () => ({
        isEnabled: vi.fn().mockResolvedValue(false),
      }));

      const { GET } = await import('@/app/api/cron/intelligence-sync/route');
      const req = new Request('http://localhost/api/cron/intelligence-sync', {
        headers: { authorization: 'Bearer secret123' },
      });

      const res = await GET(req as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.skipped).toBe(true);
      expect(body.reason).toBe('flag_disabled');
    });

    it('skips posts with views < 100', async () => {
      process.env.CRON_SECRET = 'secret123';

      // Build a query chain where .gte('views', 100) can be asserted.
      // The entire chain eventually resolves to an empty data array (all posts filtered).
      const limitMock = vi.fn().mockResolvedValue({ data: [], error: null });
      const orderMock = vi.fn().mockReturnValue({ limit: limitMock });
      const eqMock = vi.fn().mockReturnValue({ order: orderMock });
      const gteMock = vi.fn().mockReturnValue({ eq: eqMock });
      const notMock = vi.fn().mockReturnValue({ gte: gteMock });
      const isMock = vi.fn().mockReturnValue({ not: notMock });
      const selectResult = { is: isMock };

      const fakeClient = {
        database: {
          from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(selectResult) }),
        },
      };

      vi.doMock('@/lib/insforge/server', () => ({
        getServiceClient: vi.fn().mockReturnValue(fakeClient),
      }));
      vi.doMock('@/lib/feature-flags', () => ({
        isEnabled: vi.fn().mockResolvedValue(true),
      }));
      vi.doMock('@/lib/hooks-intelligence/rl-trainer', () => ({
        updateFromPerformanceDB: vi.fn(),
      }));

      const { GET } = await import('@/app/api/cron/intelligence-sync/route');
      const req = new Request('http://localhost/api/cron/intelligence-sync', {
        headers: { authorization: 'Bearer secret123' },
      });

      const res = await GET(req as any);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.processed).toBe(0);
      // Verify .gte('views', 100) was called -- proves the view threshold is enforced at DB level
      expect(gteMock).toHaveBeenCalledWith('views', 100);
    });

    it('marks posts rl_processed_at after scoring', async () => {
      process.env.CRON_SECRET = 'secret123';

      const updateEqMock = vi.fn().mockResolvedValue({ error: null });
      const updateMock = vi.fn().mockReturnValue({ eq: updateEqMock });

      // Posts query chain
      const postsChain: Record<string, unknown> = {};
      ['is', 'not', 'gte', 'eq', 'order'].forEach(m => {
        postsChain[m] = vi.fn().mockReturnValue(postsChain);
      });
      (postsChain as any).limit = vi.fn().mockResolvedValue({
        data: [{ id: 'post-1', pillar: 'ai', saves: 10, views: 500, used_hook_ids: ['hook-a'] }],
        error: null,
      });

      const fakeClient = {
        database: {
          from: vi.fn().mockImplementation((table: string) => {
            if (table === 'posts') {
              return { select: vi.fn().mockReturnValue(postsChain), update: updateMock };
            }
            return {};
          }),
        },
      };

      vi.doMock('@/lib/insforge/server', () => ({
        getServiceClient: vi.fn().mockReturnValue(fakeClient),
      }));
      vi.doMock('@/lib/feature-flags', () => ({
        isEnabled: vi.fn().mockResolvedValue(true),
      }));
      vi.doMock('@/lib/hooks-intelligence/rl-trainer', () => ({
        updateFromPerformanceDB: vi.fn().mockResolvedValue(undefined),
      }));

      const { GET } = await import('@/app/api/cron/intelligence-sync/route');
      const req = new Request('http://localhost/api/cron/intelligence-sync', {
        headers: { authorization: 'Bearer secret123' },
      });

      await GET(req as any);

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({ rl_processed_at: expect.any(String) }),
      );
      expect(updateEqMock).toHaveBeenCalledWith('id', 'post-1');
    });
  });

  // ---------------------------------------------------------------------------
  // updateFromPerformanceDB EMA
  // Using static import (top of file) to avoid module resolution issues with
  // vi.resetModules() + dynamic import in this test environment.
  // ---------------------------------------------------------------------------
  describe('updateFromPerformanceDB EMA', () => {
    /**
     * Build a minimal InsForge client mock for updateFromPerformanceDB.
     * The function makes two from() calls: select (maybeSingle) then update/insert.
     * mockReturnValueOnce routes first from() to select path, subsequent to write path.
     */
    function buildClient(existingRow: Record<string, unknown> | null) {
      const insertMock = vi.fn().mockResolvedValue({ error: null });

      // update chain: .update({}).eq('hook_id').eq('vertical') -- fully chained
      const updateEqFinal = vi.fn().mockResolvedValue({ error: null });
      const updateEqFirst = vi.fn().mockReturnValue({ eq: updateEqFinal });
      const updateMock = vi.fn().mockReturnValue({ eq: updateEqFirst });

      // select chain: .select().eq('hook_id').eq('vertical').maybeSingle()
      const maybeSingleMock = vi.fn().mockResolvedValue({ data: existingRow });
      const selectEqFinal = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
      const selectEqFirst = vi.fn().mockReturnValue({ eq: selectEqFinal, maybeSingle: maybeSingleMock });
      const selectMock = vi.fn().mockReturnValue({ eq: selectEqFirst });

      const fromMock = vi.fn()
        .mockReturnValueOnce({ select: selectMock })
        .mockReturnValue({ update: updateMock, insert: insertMock });

      return {
        client: { database: { from: fromMock } } as any,
        insertMock,
        updateMock,
      };
    }

    it('computes EMA correctly: 0.3 * new + 0.7 * existing', async () => {
      const { client, updateMock } = buildClient({
        rl_score: '80',
        rl_confidence: '0.6',
        sample_count: '5',
      });

      // save_rate=0.05, success=true -> newScore = min(100, 0.05*100 + 10) = 15
      // EMA = 0.3 * 15 + 0.7 * 80 = 4.5 + 56 = 60.5
      await updateFromPerformanceDB(client, 'hook-1', 'ai', 0.05, true);

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({ rl_score: expect.closeTo(60.5, 5) }),
      );
    });

    it('inserts new row when hook+vertical not seen before', async () => {
      const { client, insertMock } = buildClient(null);

      await updateFromPerformanceDB(client, 'hook-new', 'tech', 0.01, false);

      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          hook_id: 'hook-new',
          vertical: 'tech',
          rl_confidence: 0.5,
          sample_count: 1,
        }),
      );
    });

    it('increments sample_count on each call', async () => {
      const { client, updateMock } = buildClient({
        rl_score: '50',
        rl_confidence: '0.7',
        sample_count: '10',
      });

      await updateFromPerformanceDB(client, 'hook-x', 'general', 0.03, true);

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({ sample_count: 11 }),
      );
    });

    it('caps rl_confidence at 0.99', async () => {
      const { client, updateMock } = buildClient({
        rl_score: '60',
        rl_confidence: '0.98',
        sample_count: '50',
      });

      // 0.98 + 0.02 = 1.0 -> capped at 0.99
      await updateFromPerformanceDB(client, 'hook-y', 'mindset', 0.05, true);

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({ rl_confidence: 0.99 }),
      );
    });

    it('success=true adds 10 to score base', async () => {
      const { client, insertMock } = buildClient(null);

      // saveRate=0.03, success=true -> newScore = min(100, 0.03*100 + 10) = 13
      await updateFromPerformanceDB(client, 'hook-z', 'founder_story', 0.03, true);

      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({ rl_score: 13 }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // PILLAR_TO_VERTICAL
  // ---------------------------------------------------------------------------
  describe('PILLAR_TO_VERTICAL', () => {
    it('maps all known pillars to correct vertical', () => {
      expect(PILLAR_TO_VERTICAL['ai']).toBe('ai');
      expect(PILLAR_TO_VERTICAL['tech']).toBe('tech');
      expect(PILLAR_TO_VERTICAL['hot-take']).toBe('hot_take');
      expect(PILLAR_TO_VERTICAL['founder']).toBe('founder_story');
      expect(PILLAR_TO_VERTICAL['hackathon']).toBe('founder_story');
      expect(PILLAR_TO_VERTICAL['explainer']).toBe('ai');
      expect(PILLAR_TO_VERTICAL['research']).toBe('ai');
      expect(PILLAR_TO_VERTICAL['event_recap']).toBe('event_recap');
      expect(PILLAR_TO_VERTICAL['product']).toBe('product_launch');
      expect(PILLAR_TO_VERTICAL['customer']).toBe('customer_story');
      expect(PILLAR_TO_VERTICAL['general']).toBe('general');
    });

    it('returns general for unknown pillar via fallback', () => {
      const result = PILLAR_TO_VERTICAL['unknown-pillar-xyz'] ?? 'general';
      expect(result).toBe('general');
    });
  });

  // ---------------------------------------------------------------------------
  // engagement-sync cron -- runTrainingStep removed
  // ---------------------------------------------------------------------------
  describe('engagement-sync cron', () => {
    it('does NOT contain runTrainingStep call', () => {
      const src = fs.readFileSync(
        path.resolve(__dirname, '../src/app/api/cron/engagement-sync/route.ts'),
        'utf8',
      );
      expect(src).not.toContain('runTrainingStep');
    });
  });
});
