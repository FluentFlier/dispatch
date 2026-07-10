/**
 * Pipeline wiring guarantees (regression net for docs/PIPELINE_WIRING_AUDIT.md).
 *
 * Drives the real runContentPipeline with a spy chatCompletion and asserts the
 * WIRED behavior of the core breaks so a future refactor that silently un-wires
 * them fails here:
 *   - break 1  : fingerprint + voice examples reach the BASE stage system prompt
 *   - break 12 : a systemOverride still carries the task/@mention/substance block
 *   - break 3  : the revise loop edits the CURRENT DRAFT (no "rewrite from scratch")
 *   - break 4  : a final-iteration revise is re-evaluated (score matches output)
 *   - break 5  : an evaluator parse_error is a neutral skip, not a forced revise
 *   - break 11 : a model override is threaded into every generation stage
 *
 * chatCompletion call order (hooks + humanize mocked out): [0]=base, [1]=voice,
 * [2..]=revise. runHookStage returns baseText without an LLM call when hooks=[].
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const chatCompletion = vi.fn();
vi.mock('@/lib/llm', () => ({
  chatCompletion: (...args: unknown[]) => chatCompletion(...args),
  LlmError: class LlmError extends Error {},
}));
vi.mock('@/lib/ai', () => ({
  buildSystemPrompt: vi.fn().mockReturnValue('VOICE_SYSTEM'),
}));
vi.mock('@/lib/humanizer', () => ({
  humanizePipeline: vi.fn().mockImplementation(async (text: string) => ({ text, passes: ['clean'] })),
}));
vi.mock('@/lib/hooks-intelligence/resolve-hooks', () => ({
  getBestHooksForGeneration: vi.fn().mockResolvedValue({ hooks: [], explanations: [] }),
}));
vi.mock('@/lib/voice-prompts', () => ({ buildVoiceComposeHints: vi.fn().mockReturnValue('') }));
vi.mock('@/lib/pillars', () => ({ profilePillarWeights: vi.fn().mockReturnValue({}) }));

const evaluateDraft = vi.fn();
vi.mock('@/lib/voice-evaluator', () => ({
  evaluateDraft: (...args: unknown[]) => evaluateDraft(...args),
  // Real-shaped: pass mirrors the matrix's own pass flag.
  evaluationPasses: (m: { pass?: boolean }) => m.pass === true,
}));

import { runContentPipeline } from '@/lib/content-pipeline';
import { generateWithVoicePipeline } from '@/lib/voice-pipeline';

const PROFILE = {
  display_name: 'Ani',
  voice_description: 'punchy founder',
  voice_rules: 'no em dashes',
  content_pillars: [],
} as never;

// A realistic assembled context string with the voice signal present.
const CONTEXT = [
  'BACKGROUND FACTS (use specific details):\nBuilt Ada.',
  'VOCABULARY FINGERPRINT:\nWords/phrases they use often: shipped, honestly',
  'VOICE EXAMPLES (match rhythm):\nExample 1 (linkedin):\nWe shipped fast.\n\nHonestly it was messy.',
  'EMAIL VOICE (how they write 1:1):\nEmail 1: hey team',
].join('\n\n');

const pass = { persona_fidelity: 9, uniqueness: 9, specificity: 9, so_what: 9, pain_resonance: 9, ai_slop: 1, revision_notes: '', pass: true };
const fail = { persona_fidelity: 4, uniqueness: 4, specificity: 4, so_what: 4, pain_resonance: 4, ai_slop: 2, revision_notes: 'be punchier', pass: false };
const skip = { ...pass, parse_error: true };

beforeEach(() => {
  chatCompletion.mockReset();
  chatCompletion.mockResolvedValue('a draft');
  evaluateDraft.mockReset();
});

describe('Pipeline wiring guarantees', () => {
  it('break 1: fingerprint + voice examples reach the BASE stage system prompt', async () => {
    evaluateDraft.mockResolvedValue(pass);
    await runContentPipeline({ userPrompt: 'write about launch', profile: PROFILE, contextAdditions: CONTEXT });

    const baseSystem = chatCompletion.mock.calls[0][0] as string;
    expect(baseSystem).toContain('VOCABULARY FINGERPRINT');
    expect(baseSystem).toContain('shipped, honestly');
    expect(baseSystem).toContain('VOICE EXAMPLES');
    // Break 27: the later paragraph of a multi-paragraph example survives too.
    expect(baseSystem).toContain('Honestly it was messy.');
    // Email voice is withheld from substance.
    expect(baseSystem).not.toContain('EMAIL VOICE');
  });

  it('break 12: systemOverride keeps the task hint + @mentions + substance', async () => {
    evaluateDraft.mockResolvedValue(pass);
    await runContentPipeline({
      userPrompt: 'write about launch',
      profile: PROFILE,
      contextAdditions: CONTEXT,
      systemOverride: 'YOU ARE A GHOSTWRITER.',
      platform: 'linkedin',
      mentions: ['acme'],
    });

    const baseSystem = chatCompletion.mock.calls[0][0] as string;
    expect(baseSystem).toContain('YOU ARE A GHOSTWRITER.'); // override authoritative
    expect(baseSystem).toContain('@acme');                  // mentions survive
    expect(baseSystem).toContain('Platform: linkedin');     // task hint survives
    expect(baseSystem).toContain('VOCABULARY FINGERPRINT'); // substance survives
  });

  it('break 3: revise edits the CURRENT DRAFT, never "rewrite from scratch"', async () => {
    evaluateDraft.mockResolvedValueOnce(fail).mockResolvedValue(pass);
    await runContentPipeline({ userPrompt: 'write about launch', profile: PROFILE, contextAdditions: CONTEXT });

    // Base=0, voice=1, revise=2.
    const reviseUserPrompt = chatCompletion.mock.calls[2][1] as string;
    expect(reviseUserPrompt).toContain('CURRENT DRAFT');
    // The current draft text is echoed in for edit-in-place (not discarded).
    expect(reviseUserPrompt).toContain('a draft');
    // Edit-in-place guard present; the OLD behavior opened with "Rewrite from scratch."
    expect(reviseUserPrompt).toContain('Do not rewrite from scratch');
    expect(reviseUserPrompt).not.toMatch(/^Rewrite from scratch/);
  });

  it('break 4: a final-iteration revise is re-evaluated (score matches output)', async () => {
    // Fails every eval -> revises on both iterations -> re-evaluates the final text.
    evaluateDraft.mockResolvedValue(fail);
    const res = await runContentPipeline({ userPrompt: 'x', profile: PROFILE, contextAdditions: CONTEXT, maxIterations: 2 });

    // 2 in-loop evals + 1 final re-eval after the last revise.
    expect(evaluateDraft).toHaveBeenCalledTimes(3);
    expect(res.revised).toBe(true);
  });

  it('break 5: evaluator parse_error is a neutral skip, not a destructive revise', async () => {
    evaluateDraft.mockResolvedValue(skip);
    await runContentPipeline({ userPrompt: 'x', profile: PROFILE, contextAdditions: CONTEXT, maxIterations: 2 });

    // One eval, loop breaks on parse_error: base + voice only, no revise call.
    expect(evaluateDraft).toHaveBeenCalledTimes(1);
    expect(chatCompletion).toHaveBeenCalledTimes(2); // base + voice, NO revise
  });

  it('break 30: voice-off / fast paths report revised=false (no revise ran)', async () => {
    evaluateDraft.mockResolvedValue(pass);
    // Voice off -> substance only, no revise loop.
    const off = await runContentPipeline({ userPrompt: 'x', profile: PROFILE, useVoice: false });
    expect(off.revised).toBe(false);
    // Fast mode -> base + light humanize, no revise loop.
    const fast = await runContentPipeline({ userPrompt: 'x', profile: PROFILE, fast: true });
    expect(fast.revised).toBe(false);
  });

  it('break 11: preferOpenAi threads the smart model tier into every generation stage', async () => {
    // preferOpenAi maps to the existing 'smart' tier (LLM_MODEL_SMART), not a new env.
    vi.stubEnv('LLM_MODEL_SMART', 'smart-model');
    evaluateDraft.mockResolvedValueOnce(fail).mockResolvedValue(pass);
    await generateWithVoicePipeline({
      userPrompt: 'x',
      profile: PROFILE,
      contextAdditions: CONTEXT,
      preferOpenAi: true,
    });

    // base(0), voice(1), revise(2) all carry { model: 'smart-model' }.
    for (const call of chatCompletion.mock.calls) {
      expect((call[2] as { model?: string })?.model).toBe('smart-model');
    }
    vi.unstubAllEnvs();
  });
});
