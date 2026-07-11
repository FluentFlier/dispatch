/**
 * Phase: Evolving model — closed learning flywheel
 */
import { describe, it, expect, vi } from 'vitest';
import { getBestHooksForGeneration } from '@/lib/hooks-intelligence/resolve-hooks';
import { categorizeEngager } from '@/lib/hooks-intelligence/categorize';
import { pillarToVertical } from '@/lib/engagement/categorize-leads';
import { formatSignalTopicsBlock } from '@/lib/signals/content-bridge';

describe('Phase: Evolving model', () => {
  describe('resolve-hooks unified store', () => {
    it('falls back to static bootstrap when no DB client', async () => {
      const result = await getBestHooksForGeneration(undefined, {
        topicText: 'launching my product',
        vertical: 'indie_maker',
        limit: 3,
      });
      expect(result.hooks.length).toBeGreaterThan(0);
      expect(result.explanations.length).toBe(result.hooks.length);
      expect(result.explanations[0].source).toBe('static');
    });
  });

  describe('engagement categorization', () => {
    it('classifies founder handles as ICP', () => {
      expect(
        categorizeEngager({ handle: '@founder_jane', engagementType: 'comment' }, ['saas']),
      ).toBe('ICP');
    });
  });

  describe('pillarToVertical', () => {
    it('maps content pillars to hook verticals', () => {
      expect(pillarToVertical('ai')).toBe('ai');
      expect(pillarToVertical('unknown-pillar')).toBe('general');
    });
  });

  describe('signals content bridge', () => {
    it('formats signal topics for generation context', () => {
      const block = formatSignalTopicsBlock(['Trend: AI agents', 'Competitor launch']);
      expect(block).toContain('RECENT SIGNALS');
      expect(block).toContain('AI agents');
    });

    it('returns empty string when no topics', () => {
      expect(formatSignalTopicsBlock([])).toBe('');
    });
  });

  describe('updateFromEditsDB', () => {
    it('penalizes hook scores in DB', async () => {
      const updates: unknown[] = [];
      const mockClient = {
        database: {
          from: vi.fn((table: string) => {
            if (table === 'hook_performance') {
              return {
                select: () => ({
                  eq: () => ({
                    eq: () => ({
                      maybeSingle: () => Promise.resolve({ data: { rl_score: 70, rl_confidence: 0.8, sample_count: 2 } }),
                    }),
                  }),
                }),
                update: () => ({
                  eq: () => ({ eq: () => Promise.resolve({ error: null }) }),
                }),
                insert: () => Promise.resolve({ error: null }),
              };
            }
            if (table === 'edit_feedback_log') {
              return { insert: (row: unknown) => { updates.push(row); return Promise.resolve({ error: null }); } };
            }
            return {};
          }),
        },
      };

      const { updateFromEditsDB } = await import('@/lib/hooks-intelligence/rl-trainer');
      const count = await updateFromEditsDB(
        mockClient as never,
        ['hook_abc'],
        50,
        'indie_maker',
        'user-1',
        'post-1',
      );
      expect(count).toBe(1);
    });
  });
});
