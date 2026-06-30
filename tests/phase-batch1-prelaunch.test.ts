import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Batch 1 pre-launch fixes:
 *  - B-8: AI-slop detector has a deterministic heuristic floor (never collapses to 50).
 *  - F1: GTM playbook is excluded from brain context unless includeGtm is set.
 */

describe('Batch 1: pre-launch fixes', () => {
  describe('B-8: aiScore heuristic floor', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    function mockHfThrowing() {
      vi.doMock('@huggingface/inference', () => ({
        HfInference: class {
          async textClassification(): Promise<never> {
            throw new Error('HF unavailable');
          }
        },
      }));
    }

    it('catches obvious slop via heuristic even when the ML model is down', async () => {
      mockHfThrowing();
      const { aiScore } = await import('@/lib/humanizer');

      const slop =
        "In today's fast-paced world, we must leverage robust, innovative, transformative solutions to foster holistic outcomes. Let's dive in. It's worth noting this is a game-changer.";
      const { score, flags } = await aiScore(slop);

      expect(score).toBeGreaterThan(70); // heuristic floor, not a neutral 50
      expect(flags).toContain('model_unavailable');
      expect(flags).toContain('detected_as_ai');
    });

    it('does not over-flag clean human text when the model is down', async () => {
      mockHfThrowing();
      const { aiScore } = await import('@/lib/humanizer');

      const clean = 'I shipped a small tool last week. Four people used it. Here is what broke.';
      const { score, flags } = await aiScore(clean);

      expect(score).toBeLessThan(30);
      expect(flags).toContain('model_unavailable');
      expect(flags).not.toContain('detected_as_ai');
    });

    it('returns the max of model and heuristic (heuristic rescues a weak model)', async () => {
      vi.doMock('@huggingface/inference', () => ({
        HfInference: class {
          // Model says mostly human (ChatGPT 0.1) but text is heavy slop.
          async textClassification() {
            return [
              { label: 'ChatGPT', score: 0.1 },
              { label: 'Human', score: 0.9 },
            ];
          }
        },
      }));
      const { aiScore } = await import('@/lib/humanizer');

      const slop =
        "In today's fast-paced world, leverage robust innovative transformative holistic solutions. Let's dive in. Game-changer.";
      const { score } = await aiScore(slop);

      expect(score).toBeGreaterThan(70); // heuristic beat the lenient model
    });
  });

  describe('F1: GTM excluded from brain context unless requested', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    function mockPages() {
      const bodies: Record<string, string> = {
        voice: JSON.stringify({ voice_description: 'Direct', voice_rules: 'No em dashes' }),
        gtm: JSON.stringify({ icp: 'Fintech founders', pitch: 'Rho treasury', cta_style: 'DM me' }),
      };
      vi.doMock('@/lib/brain/pages', () => ({
        getBrainPage: vi.fn(async (_c: unknown, _u: string, slug: string) =>
          bodies[slug] ? { body: bodies[slug] } : null,
        ),
        listBrainPages: vi.fn(async () => []),
      }));
    }

    it('omits the gtm playbook by default (no sales bleed in content posts)', async () => {
      mockPages();
      const { retrieveBrainContext } = await import('@/lib/brain/retrieve');
      const snippets = await retrieveBrainContext({} as never, 'user1');
      const joined = snippets.join('\n');
      expect(joined).toContain('[voice]');
      expect(joined).not.toContain('[gtm]');
      expect(joined).not.toContain('Rho treasury');
    });

    it('includes the gtm playbook when includeGtm is true (outreach)', async () => {
      mockPages();
      const { retrieveBrainContext } = await import('@/lib/brain/retrieve');
      const snippets = await retrieveBrainContext({} as never, 'user1', undefined, undefined, true);
      const joined = snippets.join('\n');
      expect(joined).toContain('[gtm]');
      expect(joined).toContain('Rho treasury');
    });
  });
});
