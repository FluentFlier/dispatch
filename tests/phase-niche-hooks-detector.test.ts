/**
 * Phase: Niche Hooks - desklib AI-text detector.
 * The mining chain rejects hooks with P(AI) > 0.8 (spec 2.3.4). We map the HF
 * text-classification response to a single AI-probability and stay resilient to
 * label casing / ordering differences across the Inference API.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const textClassification = vi.fn();
vi.mock('@huggingface/inference', () => ({
  // Deviation from brief: mockImplementation needs a `function`, not an arrow
  // fn - huggingface.ts does `new HfInference(...)` at module scope (reused
  // client), and arrow functions have no [[Construct]] so `new` on the brief's
  // original arrow-fn mock throws "is not a constructor" for every test here,
  // independent of aiTextLikelihood's own logic. Same mocked shape/behavior.
  HfInference: vi.fn().mockImplementation(function () { return { textClassification }; }),
}));

beforeEach(() => { textClassification.mockReset(); process.env.HUGGINGFACE_API_KEY = 'hf_test'; });

describe('aiTextLikelihood', () => {
  it('returns the AI-label probability', async () => {
    textClassification.mockResolvedValue([
      { label: 'AI', score: 0.91 },
      { label: 'Human', score: 0.09 },
    ]);
    const { aiTextLikelihood } = await import('@/lib/huggingface');
    expect(await aiTextLikelihood('some text')).toBeCloseTo(0.91, 5);
  });
  it('handles label casing and reversed order', async () => {
    textClassification.mockResolvedValue([
      { label: 'human', score: 0.7 },
      { label: 'ai', score: 0.3 },
    ]);
    const { aiTextLikelihood } = await import('@/lib/huggingface');
    expect(await aiTextLikelihood('x')).toBeCloseTo(0.3, 5);
  });
  it('fails open (returns 0) when the API errors, so mining never hard-crashes on the detector', async () => {
    textClassification.mockRejectedValue(new Error('503'));
    const { aiTextLikelihood } = await import('@/lib/huggingface');
    expect(await aiTextLikelihood('x')).toBe(0);
  });
});
