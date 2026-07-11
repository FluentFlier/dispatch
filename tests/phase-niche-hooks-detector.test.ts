/**
 * Phase: Niche Hooks - desklib AI-text detector.
 * The mining chain rejects hooks with P(AI) > 0.8 (spec 2.3.4). We map the HF
 * text-classification response to a single AI-probability and stay resilient to
 * label casing / ordering differences across the Inference API.
 *
 * Contract (fix round 1): aiTextLikelihood returns { score, detector } so the
 * mining gate can never silently no-op. Any detector failure (API error,
 * unknown response shape, missing key) falls back to the deterministic
 * heuristicAiScore path with detector: 'heuristic', and every fallback is
 * logged via console.error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const textClassification = vi.fn();
vi.mock('@huggingface/inference', () => ({
  // Deviation from brief: mockImplementation needs a `function`, not an arrow
  // fn - huggingface.ts does `new HfInference(...)` at module scope (reused
  // client), and arrow functions have no [[Construct]] so `new` on the brief's
  // original arrow-fn mock throws "is not a constructor" for every test here,
  // independent of aiTextLikelihood's own logic. Same mocked shape/behavior.
  HfInference: vi.fn().mockImplementation(function () { return { textClassification }; }),
}));

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  textClassification.mockReset();
  process.env.HUGGINGFACE_API_KEY = 'hf_test';
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { errorSpy.mockRestore(); });

describe('aiTextLikelihood', () => {
  it('returns the AI-label probability with desklib provenance', async () => {
    textClassification.mockResolvedValue([
      { label: 'AI', score: 0.91 },
      { label: 'Human', score: 0.09 },
    ]);
    const { aiTextLikelihood } = await import('@/lib/huggingface');
    const res = await aiTextLikelihood('some text');
    expect(res.detector).toBe('desklib');
    expect(res.score).toBeCloseTo(0.91, 5);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('handles label casing and reversed order', async () => {
    textClassification.mockResolvedValue([
      { label: 'human', score: 0.7 },
      { label: 'ai', score: 0.3 },
    ]);
    const { aiTextLikelihood } = await import('@/lib/huggingface');
    const res = await aiTextLikelihood('x');
    expect(res.detector).toBe('desklib');
    expect(res.score).toBeCloseTo(0.3, 5);
  });

  it('falls back to the heuristic (with provenance + logged error) when the API errors', async () => {
    textClassification.mockRejectedValue(new Error('503'));
    const { aiTextLikelihood } = await import('@/lib/huggingface');
    const { heuristicAiScore } = await import('@/lib/humanizer');
    const text = 'In conclusion, let us delve into the tapestry of robust synergies.';
    const res = await aiTextLikelihood(text);
    expect(res.detector).toBe('heuristic');
    expect(res.score).toBeCloseTo(heuristicAiScore(text) / 100, 5);
    expect(res.score).toBeGreaterThanOrEqual(0);
    expect(res.score).toBeLessThanOrEqual(1);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('falls back to the heuristic and logs when the response is not an array', async () => {
    textClassification.mockResolvedValue({ error: 'model overloaded' });
    const { aiTextLikelihood } = await import('@/lib/huggingface');
    const { heuristicAiScore } = await import('@/lib/humanizer');
    const res = await aiTextLikelihood('plain text');
    expect(res.detector).toBe('heuristic');
    expect(res.score).toBeCloseTo(heuristicAiScore('plain text') / 100, 5);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('unexpected response shape'));
  });

  it('falls back to the heuristic and logs when no label matches AI or human patterns', async () => {
    textClassification.mockResolvedValue([
      { label: 'POSITIVE', score: 0.6 },
      { label: 'NEGATIVE', score: 0.4 },
    ]);
    const { aiTextLikelihood } = await import('@/lib/huggingface');
    const { heuristicAiScore } = await import('@/lib/humanizer');
    const res = await aiTextLikelihood('plain text');
    expect(res.detector).toBe('heuristic');
    expect(res.score).toBeCloseTo(heuristicAiScore('plain text') / 100, 5);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('unrecognized label set'));
  });
});
