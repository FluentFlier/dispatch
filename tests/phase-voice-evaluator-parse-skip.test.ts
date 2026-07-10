/**
 * Phase: Voice evaluator parse-error handling (audit break 5)
 *
 * A transient JSON/LLM glitch is NOT a quality failure. When the evaluator
 * response can't be parsed, evaluateDraft must return a neutral "skip revision"
 * outcome (pass=true + parse_error=true) so the pipeline keeps the current draft
 * instead of forcing a destructive from-scratch rewrite off a fake failing score.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const chatCompletion = vi.fn();
vi.mock('@/lib/llm', () => ({
  chatCompletion: (...args: unknown[]) => chatCompletion(...args),
  LlmError: class LlmError extends Error {},
}));

import { evaluateDraft } from '@/lib/voice-evaluator';

describe('Phase: voice evaluator parse-error skip (break 5)', () => {
  beforeEach(() => chatCompletion.mockReset());

  it('returns a neutral skip (pass + parse_error) when the response has no JSON', async () => {
    chatCompletion.mockResolvedValue('Sorry, I cannot evaluate this right now.');
    const matrix = await evaluateDraft('some draft', null);
    expect(matrix.parse_error).toBe(true);
    expect(matrix.pass).toBe(true); // stops the revise loop rather than nuking the draft
  });

  it('returns a neutral skip when the JSON is malformed', async () => {
    chatCompletion.mockResolvedValue('{ "persona_fidelity": 9, oops not json');
    const matrix = await evaluateDraft('some draft', null);
    expect(matrix.parse_error).toBe(true);
    expect(matrix.pass).toBe(true);
  });

  it('parses a real evaluation and does NOT set parse_error', async () => {
    chatCompletion.mockResolvedValue(
      'Here is the score:\n{"persona_fidelity":9,"uniqueness":9,"specificity":9,"so_what":9,"pain_resonance":9,"ai_slop":2,"revision_notes":""}',
    );
    const matrix = await evaluateDraft('some draft', null);
    expect(matrix.parse_error).toBeUndefined();
    expect(matrix.pass).toBe(true);
    expect(matrix.persona_fidelity).toBe(9);
  });

  it('a genuine low score still fails (not skipped)', async () => {
    chatCompletion.mockResolvedValue(
      '{"persona_fidelity":3,"uniqueness":4,"specificity":3,"so_what":4,"pain_resonance":3,"ai_slop":7,"revision_notes":"too generic"}',
    );
    const matrix = await evaluateDraft('some draft', null);
    expect(matrix.parse_error).toBeUndefined();
    expect(matrix.pass).toBe(false);
  });
});
