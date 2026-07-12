/**
 * Phase: Guardrail Consolidation - enforcement core + full pipeline wiring.
 * candidateScore/selectBest/targetedRevise/escalateOnce are pure/mockable
 * pieces tested directly here; the full runContentPipeline integration is
 * tested in the second describe block below.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CheckResult } from '@/lib/content-pipeline/checks';
import type { VoiceEvaluationMatrix } from '@/lib/voice-evaluator';

const hardPass = (id: string): CheckResult => ({ id, severity: 'hard', pass: true });
const hardFail = (id: string, fixHint = 'fix it', evidence = 'bad text'): CheckResult =>
  ({ id, severity: 'hard', pass: false, fixHint, evidence });

const evalMatrix = (overrides: Partial<VoiceEvaluationMatrix> = {}): VoiceEvaluationMatrix => ({
  persona_fidelity: 8, uniqueness: 8, specificity: 8, so_what: 8, pain_resonance: 8,
  ai_slop: 2, revision_notes: '', pass: true, ...overrides,
});

describe('Phase: Guardrail Consolidation - enforce.ts core', () => {
  describe('candidateScore + selectBest', () => {
    it('hard pass count dominates the score - a candidate with more passing hard checks always wins', async () => {
      const { candidateScore } = await import('@/lib/content-pipeline/enforce');
      const worseChecks = { text: 'a', checkResults: [hardPass('em_dash'), hardFail('markdown')], evaluation: evalMatrix({ persona_fidelity: 10, uniqueness: 10, specificity: 10, so_what: 10, pain_resonance: 10 }) };
      const betterChecks = { text: 'b', checkResults: [hardPass('em_dash'), hardPass('markdown')], evaluation: evalMatrix({ persona_fidelity: 1, uniqueness: 1, specificity: 1, so_what: 1, pain_resonance: 1 }) };
      expect(candidateScore(betterChecks)).toBeGreaterThan(candidateScore(worseChecks));
    });

    it('selectBest picks the highest-scoring candidate', async () => {
      const { selectBest } = await import('@/lib/content-pipeline/enforce');
      const a = { text: 'a', checkResults: [hardFail('em_dash')] };
      const b = { text: 'b', checkResults: [hardPass('em_dash')] };
      expect(selectBest([a, b]).text).toBe('b');
    });

    it('selectBest returns the only candidate when there is one', async () => {
      const { selectBest } = await import('@/lib/content-pipeline/enforce');
      const only = { text: 'only', checkResults: [hardPass('em_dash')] };
      expect(selectBest([only]).text).toBe('only');
    });
  });

  describe('buildTargetedRevisePrompt', () => {
    it('lists only the failed checks evidence + fixHint, not passing checks', async () => {
      const { buildTargetedRevisePrompt } = await import('@/lib/content-pipeline/enforce');
      const prompt = buildTargetedRevisePrompt('the draft text', [hardFail('em_dash', 'remove the dash', 'bad - text')]);
      expect(prompt).toContain('the draft text');
      expect(prompt).toContain('remove the dash');
      expect(prompt).toContain('bad - text');
      expect(prompt).not.toContain('markdown');
    });
  });

  describe('targetedRevise', () => {
    const chatCompletion = vi.fn();
    beforeEach(() => {
      vi.resetModules();
      chatCompletion.mockReset();
      vi.doMock('@/lib/llm', () => ({ chatCompletion: (...a: unknown[]) => chatCompletion(...a) }));
      vi.doMock('@/lib/content-pipeline/events', () => ({ emitPipelineEvent: vi.fn().mockResolvedValue(undefined) }));
    });

    it('is a no-op (no LLM call) when all hard checks already pass', async () => {
      vi.doMock('@/lib/content-pipeline/checks', async () => {
        const actual = await vi.importActual<typeof import('@/lib/content-pipeline/checks')>('@/lib/content-pipeline/checks');
        return actual;
      });
      const { targetedRevise } = await import('@/lib/content-pipeline/enforce');
      const ctx = { contentType: 'post', userPrompt: 'x' } as const;
      const result = await targetedRevise('a clean draft with nothing wrong in it whatsoever today', ctx, undefined, 'req_test', 'test-stage');
      expect(result.revisedForChecks).toBe(false);
      expect(chatCompletion).not.toHaveBeenCalled();
    });

    it('calls chatCompletion once and returns the revised text when a hard check fails', async () => {
      chatCompletion.mockResolvedValue('fixed draft text');
      const { targetedRevise } = await import('@/lib/content-pipeline/enforce');
      const ctx = { contentType: 'post', userPrompt: 'x' } as const;
      const result = await targetedRevise('bad — draft with an em dash', ctx, undefined, 'req_test', 'test-stage');
      expect(chatCompletion).toHaveBeenCalledTimes(1);
      expect(result.revisedForChecks).toBe(true);
      expect(result.text).toBe('fixed draft text');
    });

    it('ships the unrevised draft (never throws) when the revise call fails', async () => {
      // A below-threshold draft is the exact population enforcement rescues;
      // a transient revise-call failure must not turn it into a 500.
      chatCompletion.mockRejectedValue(new Error('provider 500'));
      const { targetedRevise } = await import('@/lib/content-pipeline/enforce');
      const ctx = { contentType: 'post', userPrompt: 'x' } as const;
      const result = await targetedRevise('bad — draft with an em dash', ctx, undefined, 'req_test', 'test-stage');
      expect(result.revisedForChecks).toBe(false);
      expect(result.text).toBe('bad — draft with an em dash'); // original, unrevised
    });
  });

  describe('escalateOnce', () => {
    beforeEach(() => {
      vi.resetModules();
      vi.doMock('@/lib/content-pipeline/events', () => ({ emitPipelineEvent: vi.fn().mockResolvedValue(undefined) }));
    });

    it('returns null (no-op) when no smart model tier is configured', async () => {
      vi.doMock('@/lib/ai-tiers', () => ({ resolveModel: vi.fn().mockReturnValue(undefined) }));
      vi.doMock('@/lib/llm-budget', () => ({ checkGlobalLlmBudget: vi.fn().mockResolvedValue('disabled') }));
      const { escalateOnce } = await import('@/lib/content-pipeline/enforce');
      const regenerate = vi.fn();
      const result = await escalateOnce(regenerate, 'req_test', 'test-stage');
      expect(result).toBeNull();
      expect(regenerate).not.toHaveBeenCalled();
    });

    it('returns null when the smart tier is configured but the global budget is blocked', async () => {
      vi.doMock('@/lib/ai-tiers', () => ({ resolveModel: vi.fn().mockReturnValue('smart-model') }));
      vi.doMock('@/lib/llm-budget', () => ({ checkGlobalLlmBudget: vi.fn().mockResolvedValue('blocked') }));
      const { escalateOnce } = await import('@/lib/content-pipeline/enforce');
      const regenerate = vi.fn();
      const result = await escalateOnce(regenerate, 'req_test', 'test-stage');
      expect(result).toBeNull();
      expect(regenerate).not.toHaveBeenCalled();
    });

    it('calls regenerate with the smart model id and returns its text when configured and budget ok', async () => {
      vi.doMock('@/lib/ai-tiers', () => ({ resolveModel: vi.fn().mockReturnValue('smart-model') }));
      vi.doMock('@/lib/llm-budget', () => ({ checkGlobalLlmBudget: vi.fn().mockResolvedValue('ok') }));
      const { escalateOnce } = await import('@/lib/content-pipeline/enforce');
      const regenerate = vi.fn().mockResolvedValue('escalated text');
      const result = await escalateOnce(regenerate, 'req_test', 'test-stage');
      expect(regenerate).toHaveBeenCalledWith('smart-model');
      expect(result).toBe('escalated text');
    });

    it('returns null (never throws) when the regenerate call itself fails', async () => {
      // llm.ts does NOT fail over on a non-quota 500; escalation must swallow
      // it so a finished-but-below-threshold generation still ships best-of.
      vi.doMock('@/lib/ai-tiers', () => ({ resolveModel: vi.fn().mockReturnValue('smart-model') }));
      vi.doMock('@/lib/llm-budget', () => ({ checkGlobalLlmBudget: vi.fn().mockResolvedValue('ok') }));
      const { escalateOnce } = await import('@/lib/content-pipeline/enforce');
      const regenerate = vi.fn().mockRejectedValue(new Error('smart model 500'));
      const result = await escalateOnce(regenerate, 'req_test', 'test-stage');
      expect(result).toBeNull();
    });
  });
});

describe('Phase: Guardrail Consolidation - full pipeline enforcement wiring', () => {
  const chatCompletion = vi.fn();
  const evaluateDraft = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    chatCompletion.mockReset();
    evaluateDraft.mockReset();
    vi.doMock('@/lib/llm', () => ({
      chatCompletion: (...a: unknown[]) => chatCompletion(...a),
      LlmError: class LlmError extends Error {},
    }));
    vi.doMock('@/lib/ai', () => ({ buildSystemPrompt: vi.fn().mockReturnValue('VOICE_SYSTEM') }));
    vi.doMock('@/lib/humanizer', () => ({
      humanizePipeline: vi.fn().mockImplementation(async (text: string) => ({ text, passes: ['clean'] })),
    }));
    vi.doMock('@/lib/hooks-intelligence/resolve-hooks', () => ({
      getBestHooksForGeneration: vi.fn().mockResolvedValue({ hooks: [], explanations: [] }),
    }));
    vi.doMock('@/lib/voice-prompts', () => ({ buildVoiceComposeHints: vi.fn().mockReturnValue('') }));
    vi.doMock('@/lib/pillars', () => ({ profilePillarWeights: vi.fn().mockReturnValue({}) }));
    vi.doMock('@/lib/voice-evaluator', () => ({
      evaluateDraft: (...a: unknown[]) => evaluateDraft(...a),
      evaluationPasses: (m: { pass?: boolean }) => m.pass === true,
    }));
    process.env.LLM_PIPELINE_MODE = 'full';
    delete process.env.LLM_MODEL_SMART;
  });

  const PROFILE = { display_name: 'Ani', voice_description: 'punchy', voice_rules: 'no em dashes', content_pillars: [] } as never;
  const pass = { persona_fidelity: 9, uniqueness: 9, specificity: 9, so_what: 9, pain_resonance: 9, ai_slop: 1, revision_notes: '', pass: true };

  // 460+ chars (LinkedIn's 400-char platform_length floor), no em dash, no markdown,
  // single flowing paragraph structure - passes every hard check.
  const CLEAN = 'We shipped the new onboarding flow after three weeks of watching users get stuck on step two. '.repeat(5).trim();

  it('a clean draft that passes every hard check makes zero extra enforcement LLM calls', async () => {
    evaluateDraft.mockResolvedValue(pass);
    chatCompletion.mockResolvedValue(CLEAN);
    const { runContentPipeline } = await import('@/lib/content-pipeline');
    await runContentPipeline({ userPrompt: 'write about onboarding', profile: PROFILE, platform: 'linkedin' });
    // base(0) + voice(1) only - Gate A and Gate B found nothing to fix.
    expect(chatCompletion).toHaveBeenCalledTimes(2);
  });

  it('a draft with an em dash triggers exactly one targeted revise call (Gate A)', async () => {
    evaluateDraft.mockResolvedValue(pass);
    chatCompletion
      .mockResolvedValueOnce('bad — draft with an em dash, otherwise long enough to pass length checks easily today. '.repeat(3))
      .mockResolvedValue(CLEAN); // every subsequent call (targeted revise, voice) returns clean text
    const { runContentPipeline } = await import('@/lib/content-pipeline');
    const result = await runContentPipeline({ userPrompt: 'write about onboarding', profile: PROFILE, platform: 'linkedin' });
    expect(result.text).not.toMatch(/[—–]/);
    expect(result.flags).not.toContain('hard_check_failed');
  });

  it('still-failing hard checks after escalation ship the best candidate with a hard_check_failed flag', async () => {
    process.env.LLM_MODEL_SMART = 'smart-model';
    evaluateDraft.mockResolvedValue(pass);
    // Every generation call returns a too-short LinkedIn post - never passes platform_length,
    // even through targeted revise and escalation.
    chatCompletion.mockResolvedValue('too short');
    const { runContentPipeline } = await import('@/lib/content-pipeline');
    const result = await runContentPipeline({ userPrompt: 'x', profile: PROFILE, platform: 'linkedin' });
    expect(result.flags).toContain('hard_check_failed');
    expect(result.flags).toContain('platform_length');
    // base + Gate A revise + voice + Gate B escalation = 4 calls, never more
    // (escalation is bounded to exactly once regardless of outcome).
    expect(chatCompletion.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it('voice-off path runs Gate A and ships with hard_check_failed when it cannot be fixed, no escalation', async () => {
    chatCompletion.mockResolvedValue('too short');
    const { runContentPipeline } = await import('@/lib/content-pipeline');
    const result = await runContentPipeline({ userPrompt: 'x', profile: PROFILE, platform: 'linkedin', useVoice: false });
    expect(result.flags).toContain('hard_check_failed');
    expect(evaluateDraft).not.toHaveBeenCalled();
  });
});

describe('Phase: Guardrail Consolidation - compact pipeline enforcement wiring', () => {
  const chatCompletion = vi.fn();
  const evaluateDraft = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    chatCompletion.mockReset();
    evaluateDraft.mockReset();
    // The sibling "full pipeline" describe above registers PARTIAL doMocks
    // for '@/lib/voice-prompts' (buildVoiceComposeHints only) and
    // '@/lib/humanizer' (humanizePipeline only). vi.doMock registrations are
    // NOT cleared by vi.resetModules() - they leak across describe blocks in
    // the same file. compact.ts calls PLATFORM_PLAYBOOKS, CONTENT_TYPE_HINTS,
    // and deterministicPreClean directly (index.ts's full pipeline does not
    // call the latter two the same way), so the leaked partial mocks break
    // it. Unmock so this block always gets the real modules.
    vi.doUnmock('@/lib/voice-prompts');
    vi.doUnmock('@/lib/humanizer');
    vi.doMock('@/lib/llm', () => ({
      chatCompletion: (...a: unknown[]) => chatCompletion(...a),
      LlmError: class LlmError extends Error {},
    }));
    vi.doMock('@/lib/voice-evaluator', () => ({
      evaluateDraft: (...a: unknown[]) => evaluateDraft(...a),
      evaluationPasses: (m: { pass?: boolean }) => m.pass === true,
    }));
    process.env.LLM_PIPELINE_MODE = 'compact';
    delete process.env.LLM_MODEL_SMART;
  });

  const PROFILE = { display_name: 'Ani', voice_description: 'punchy', voice_rules: 'no em dashes', content_pillars: [] } as never;
  const pass = { persona_fidelity: 9, uniqueness: 9, specificity: 9, so_what: 9, pain_resonance: 9, ai_slop: 1, revision_notes: '', pass: true };
  // 460+ chars (LinkedIn's 400-char platform_length floor) - repeat(4) (375
  // chars) is UNDER the floor and false-fails platform_length, same fixture
  // bug class as Task 3 Step 8: fix the mock's return value, not checks.ts.
  const CLEAN = 'We shipped the new onboarding flow after three weeks of watching users get stuck on step two. '.repeat(5).trim();

  it('clean output makes exactly the 2 base compact calls, no enforcement calls added', async () => {
    evaluateDraft.mockResolvedValue(pass);
    chatCompletion.mockResolvedValue(CLEAN);
    const { runContentPipeline } = await import('@/lib/content-pipeline');
    await runContentPipeline({ userPrompt: 'write about onboarding', profile: PROFILE, platform: 'linkedin', model: '8b-model' });
    expect(chatCompletion).toHaveBeenCalledTimes(2);
  });

  it('hard check failure after call 2 triggers exactly one targeted revise call', async () => {
    evaluateDraft.mockResolvedValue(pass);
    chatCompletion
      .mockResolvedValueOnce(CLEAN) // call 1: draft
      .mockResolvedValueOnce('bad — text with an em dash, still long enough otherwise to pass every length floor easily. '.repeat(3)) // call 2: edit pass (broken)
      .mockResolvedValue(CLEAN); // call 3: targeted revise (fixed)
    const { runContentPipeline } = await import('@/lib/content-pipeline');
    const result = await runContentPipeline({ userPrompt: 'x', profile: PROFILE, platform: 'linkedin', model: '8b-model' });
    expect(chatCompletion).toHaveBeenCalledTimes(3);
    expect(result.text).not.toMatch(/[—–]/);
  });

  it('escalates once and ships best-of when still failing after targeted revise, flags hard_check_failed if unresolved', async () => {
    process.env.LLM_MODEL_SMART = 'smart-model';
    evaluateDraft.mockResolvedValue({ ...pass, pass: false });
    chatCompletion.mockResolvedValue('too short'); // every call, including escalation, still fails platform_length
    const { runContentPipeline } = await import('@/lib/content-pipeline');
    const result = await runContentPipeline({ userPrompt: 'x', profile: PROFILE, platform: 'linkedin', model: '8b-model' });
    expect(result.flags).toContain('hard_check_failed');
    // call1 + call2(edit) + targeted-revise + escalation(edit on smart model) = 4, never more.
    expect(chatCompletion.mock.calls.length).toBeLessThanOrEqual(4);
  });
});
