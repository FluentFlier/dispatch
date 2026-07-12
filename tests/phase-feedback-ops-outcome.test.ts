/**
 * Phase: Feedback Ops - generation outcome recording (spec 4.2 + dashboard feed).
 * The outcome helper re-runs the FREE deterministic checks on the final text
 * (observation only - Phase 3 owns enforcement) and must never throw: a
 * failed outcome write is a lost metric, not a failed generation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildOutcomeDetail } from '@/lib/observability/generation-outcome';
import { PROMPT_VERSION } from '@/lib/content-pipeline';

describe('PROMPT_VERSION', () => {
  it('is exported and dated (bumped on any prompt string change, see RUNBOOK)', () => {
    expect(PROMPT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });
});

describe('buildOutcomeDetail', () => {
  const input = {
    userPrompt: 'Write about our launch',
    contentType: 'post' as const,
    platform: 'linkedin',
    profile: null,
  };
  const result = {
    text: 'We shipped. Here is what happened - full story below.\n\n' +
      'The team rebuilt onboarding around one screen and tested it with real users before launch. Support tickets stopped piling up within the first week. That was the whole point of the rework.\n\n' +
      'The lesson for us was that boring reliability sells itself. We spent nothing on ads and let the product do the talking. Next quarter we double down on the same play.\n\n' +
      'What would you simplify first?',
    voice_match_score: 8.1,
    ai_score: 0.2,
    revised: false,
    flags: [] as string[],
    iterations: 1,
    stagesCompleted: ['base', 'hooks', 'humanize', 'voice', 'evaluate'],
  };

  it('captures mode, iterations, scores, and check failures', () => {
    const d = buildOutcomeDetail(input as never, result as never);
    expect(d.promptVersion).toBe(PROMPT_VERSION);
    expect(d.iterations).toBe(1);
    expect(d.voiceMatchScore).toBe(8.1);
    expect(Array.isArray(d.hardCheckFailures)).toBe(true);
    expect(Array.isArray(d.softCheckFailures)).toBe(true);
    expect(d.mode).toBe('full');
  });

  it('flags em-dash output as a hard check failure (observation, not enforcement)', () => {
    const dirty = { ...result, text: result.text + '\n\nGreat work — truly.' };
    const d = buildOutcomeDetail(input as never, dirty as never);
    expect(d.hardCheckFailures).toContain('em_dash');
  });

  it('marks compact mode from stagesCompleted', () => {
    const compact = { ...result, stagesCompleted: ['base', 'humanize'] };
    const d = buildOutcomeDetail(input as never, compact as never);
    expect(d.mode).toBe('compact_or_partial');
  });
});

/**
 * recordGenerationOutcome sink wiring: writes ONE pipeline_events row with
 * event='generation_complete' (the dashboard DENOMINATOR - not a degradation),
 * routes through the shared throw-safe emitPipelineEvent, and is inert under
 * EVALS_MODE like every other event.
 */
describe('recordGenerationOutcome', () => {
  const emitPipelineEvent = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    emitPipelineEvent.mockReset().mockResolvedValue(undefined);
    vi.doMock('@/lib/content-pipeline/events', () => ({ emitPipelineEvent }));
    // Langfuse no-op (no keys) - updateSpanAttrs returns without touching anything.
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
  });

  const input = { userPrompt: 'x', contentType: 'post' as const, platform: 'linkedin', profile: null };
  const result = {
    text: 'We shipped the onboarding rework and it worked. '.repeat(12).trim(),
    voice_match_score: 7, ai_score: 0.1, revised: false, flags: [],
    iterations: 1, stagesCompleted: ['base', 'hooks', 'humanize', 'voice', 'evaluate'],
  };

  it('emits exactly one generation_complete event carrying the check-summary detail', async () => {
    const { recordGenerationOutcome } = await import('@/lib/observability/generation-outcome');
    await recordGenerationOutcome('req_out_1', input as never, result as never);
    expect(emitPipelineEvent).toHaveBeenCalledTimes(1);
    const call = emitPipelineEvent.mock.calls[0][0];
    expect(call.event).toBe('generation_complete');
    expect(call.requestId).toBe('req_out_1');
    expect(call.detail.mode).toBe('full');
    expect(Array.isArray(call.detail.hardCheckFailures)).toBe(true);
    expect(call.detail.promptVersion).toBe(PROMPT_VERSION);
  });

  it('never throws even if the event sink rejects (lost metric, not lost generation)', async () => {
    emitPipelineEvent.mockRejectedValue(new Error('sink down'));
    const { recordGenerationOutcome } = await import('@/lib/observability/generation-outcome');
    await expect(recordGenerationOutcome('req_out_2', input as never, result as never)).resolves.toBeUndefined();
  });
});

/**
 * Span WIRING (spec 4.2): the four main-path stage calls plus the outcome
 * record are each wrapped in withSpan, and the whole run in a 'generation'
 * root. Spans are DORMANT without Langfuse keys (absent in CI), so we spy on
 * withSpan itself - proving the wrapper is called per stage, not that a live
 * span exports. withSpan stays a transparent passthrough here, so the Phase 3
 * enforcement call-count contract is untouched (asserted separately in
 * phase-guardrail-enforcement-full.test.ts, still green with spans layered on).
 */
describe('pipeline span wiring', () => {
  const chatCompletion = vi.fn();
  const evaluateDraft = vi.fn();
  const spanNames: string[] = [];

  beforeEach(() => {
    vi.resetModules();
    chatCompletion.mockReset();
    evaluateDraft.mockReset();
    spanNames.length = 0;
    vi.doMock('@/lib/observability/langfuse', () => ({
      withSpan: (name: string, _attrs: unknown, fn: () => unknown) => {
        spanNames.push(name);
        return fn();
      },
      flushAfterResponse: vi.fn(),
    }));
    vi.doMock('@/lib/observability/generation-outcome', () => ({
      recordGenerationOutcome: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock('@/lib/llm', () => ({
      chatCompletion: (...a: unknown[]) => chatCompletion(...a),
      LlmError: class LlmError extends Error {},
    }));
    vi.doMock('@/lib/ai', () => ({ buildSystemPrompt: vi.fn().mockReturnValue('VOICE_SYSTEM') }));
    vi.doMock('@/lib/humanizer', () => ({
      humanizePipeline: vi.fn().mockImplementation(async (text: string) => ({ text, passes: ['clean'] })),
    }));
    vi.doMock('@/lib/hooks-intelligence/resolve-hooks', () => ({
      getBestHooksForGeneration: vi.fn().mockResolvedValue({ hooks: [{ id: 'h1', text: 'Hook.', author: 'a' }], explanations: [] }),
    }));
    vi.doMock('@/lib/voice-prompts', () => ({
      buildVoiceComposeHints: vi.fn().mockReturnValue(''),
      PLATFORM_PLAYBOOKS: {}, CONTENT_TYPE_HINTS: {},
    }));
    vi.doMock('@/lib/pillars', () => ({ profilePillarWeights: vi.fn().mockReturnValue({}) }));
    vi.doMock('@/lib/voice-evaluator', () => ({
      evaluateDraft: (...a: unknown[]) => evaluateDraft(...a),
      evaluationPasses: (m: { pass?: boolean }) => m.pass === true,
    }));
    process.env.LLM_PIPELINE_MODE = 'full';
  });

  const PROFILE = { display_name: 'Ani', voice_description: 'punchy', voice_rules: 'x', content_pillars: [] } as never;
  const pass = { persona_fidelity: 9, uniqueness: 9, specificity: 9, so_what: 9, pain_resonance: 9, ai_slop: 1, revision_notes: '', pass: true };
  const CLEAN = 'We shipped the new onboarding flow after three weeks of watching users get stuck on step two. '.repeat(5).trim();

  it('wraps each stage exactly once under a generation root', async () => {
    evaluateDraft.mockResolvedValue(pass);
    chatCompletion.mockResolvedValue(CLEAN);
    const { runContentPipeline } = await import('@/lib/content-pipeline');
    // forceHooks so the (mocked) hook stage runs and its span is observable.
    await runContentPipeline({ userPrompt: 'write about onboarding', profile: PROFILE, platform: 'linkedin', forceHooks: true });

    expect(spanNames.filter((n) => n === 'generation')).toHaveLength(1);
    expect(spanNames.filter((n) => n === 'stage:base')).toHaveLength(1);
    expect(spanNames.filter((n) => n === 'stage:hooks')).toHaveLength(1);
    expect(spanNames.filter((n) => n === 'stage:humanize')).toHaveLength(1);
    expect(spanNames.filter((n) => n === 'stage:voice')).toHaveLength(1);
    // Clean draft passes on the first eval, so exactly one evaluate span.
    expect(spanNames.filter((n) => n === 'stage:evaluate')).toHaveLength(1);
  });
});
