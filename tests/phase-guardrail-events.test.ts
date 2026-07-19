/**
 * Phase: Guardrail Consolidation - pipeline_events emitter.
 * Fire-and-forget: swallows every failure so a broken sink never fails a
 * generation. getServiceClient is lazily imported (same pattern as
 * llm-budget.ts) so this module is safe to import from the promptfoo eval
 * CLI, which runs outside the Next.js runtime.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Phase: Guardrail Consolidation - events.ts', () => {
  beforeEach(() => vi.resetModules());

  it('inserts a row with request_id, user_id, event, and detail', async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    const fromMock = vi.fn().mockReturnValue({ insert: insertMock });
    vi.doMock('@/lib/insforge/server', () => ({
      getServiceClient: vi.fn().mockReturnValue({ database: { from: fromMock } }),
    }));
    const { emitPipelineEvent } = await import('@/lib/content-pipeline/events');
    await emitPipelineEvent({ requestId: 'req_1', userId: 'user_1', event: 'escalated', detail: { stage: 'voice', to_model: 'smart' } });

    expect(fromMock).toHaveBeenCalledWith('pipeline_events');
    expect(insertMock).toHaveBeenCalledWith([
      { request_id: 'req_1', user_id: 'user_1', event: 'escalated', detail: { stage: 'voice', to_model: 'smart' } },
    ]);
  });

  it('never throws when the insert errors, and counts the swallow', async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: { message: 'db down' } });
    vi.doMock('@/lib/insforge/server', () => ({
      getServiceClient: vi.fn().mockReturnValue({ database: { from: vi.fn().mockReturnValue({ insert: insertMock }) } }),
    }));
    const { emitPipelineEvent, getSwallowedEventErrorCount, resetSwallowedEventErrorCount } = await import('@/lib/content-pipeline/events');
    resetSwallowedEventErrorCount();
    await expect(emitPipelineEvent({ requestId: 'req_2', event: 'hard_check_failed' })).resolves.toBeUndefined();
    expect(getSwallowedEventErrorCount()).toBe(1);
  });

  it('never throws when getServiceClient itself throws (non-Next runtime, e.g. the eval CLI)', async () => {
    vi.doMock('@/lib/insforge/server', () => ({
      getServiceClient: vi.fn().mockImplementation(() => { throw new Error('next/headers unavailable'); }),
    }));
    const { emitPipelineEvent, getSwallowedEventErrorCount, resetSwallowedEventErrorCount } = await import('@/lib/content-pipeline/events');
    resetSwallowedEventErrorCount();
    await expect(emitPipelineEvent({ requestId: 'req_3', event: 'compact_mode' })).resolves.toBeUndefined();
    expect(getSwallowedEventErrorCount()).toBe(1);
  });

  it('EVALS_MODE short-circuits before any DB call (guards the promptfoo CLI)', async () => {
    const getServiceClient = vi.fn();
    vi.doMock('@/lib/insforge/server', () => ({ getServiceClient }));
    const prev = process.env.EVALS_MODE;
    process.env.EVALS_MODE = '1';
    try {
      const { emitPipelineEvent, getSwallowedEventErrorCount, resetSwallowedEventErrorCount } = await import('@/lib/content-pipeline/events');
      resetSwallowedEventErrorCount();
      await expect(emitPipelineEvent({ requestId: 'req_eval', event: 'compact_mode' })).resolves.toBeUndefined();
      // Deliberate no-op: never touches the client, and is NOT counted as a swallowed error.
      expect(getServiceClient).not.toHaveBeenCalled();
      expect(getSwallowedEventErrorCount()).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.EVALS_MODE;
      else process.env.EVALS_MODE = prev;
    }
  });

  it('defaults detail to an empty object when omitted', async () => {
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    vi.doMock('@/lib/insforge/server', () => ({
      getServiceClient: vi.fn().mockReturnValue({ database: { from: vi.fn().mockReturnValue({ insert: insertMock }) } }),
    }));
    const { emitPipelineEvent } = await import('@/lib/content-pipeline/events');
    await emitPipelineEvent({ requestId: 'req_4', event: 'judge_parse_error' });
    expect(insertMock).toHaveBeenCalledWith([
      { request_id: 'req_4', user_id: null, event: 'judge_parse_error', detail: {} },
    ]);
  });
});

describe('Phase: Guardrail Consolidation - forced-failure event chain (spec 3.5.2)', () => {
  const chatCompletion = vi.fn();
  const evaluateDraft = vi.fn();
  const emitted: Array<{ requestId: string; event: string }> = [];

  beforeEach(() => {
    vi.resetModules();
    chatCompletion.mockReset();
    evaluateDraft.mockReset();
    emitted.length = 0;
    vi.doMock('@/lib/llm', () => ({
      chatCompletion: (...a: unknown[]) => chatCompletion(...a),
      LlmError: class LlmError extends Error {},
    }));
    vi.doMock('@/lib/content-pipeline/events', () => ({
      emitPipelineEvent: vi.fn().mockImplementation(async (input: { requestId: string; event: string }) => {
        emitted.push({ requestId: input.requestId, event: input.event });
      }),
    }));
    vi.doMock('@/lib/ai', () => ({ buildSystemPrompt: vi.fn().mockReturnValue('VOICE_SYSTEM') }));
    vi.doMock('@/lib/humanizer', () => ({
      humanizePipeline: vi.fn().mockImplementation(async (text: string) => ({ text, passes: ['clean'] })),
    }));
    vi.doMock('@/lib/hooks-intelligence/resolve-hooks', () => ({
      getBestHooksForGeneration: vi.fn().mockResolvedValue({ hooks: [], explanations: [], usedStaticFallback: false }),
    }));
    vi.doMock('@/lib/voice-prompts', () => ({ buildVoiceComposeHints: vi.fn().mockReturnValue('') }));
    vi.doMock('@/lib/pillars', () => ({ profilePillarWeights: vi.fn().mockReturnValue({}) }));
    vi.doMock('@/lib/voice-evaluator', () => ({
      evaluateDraft: (...a: unknown[]) => evaluateDraft(...a),
      evaluationPasses: (m: { pass?: boolean }) => m.pass === true,
    }));
    process.env.LLM_PIPELINE_MODE = 'full';
    process.env.LLM_MODEL_SMART = 'smart-model';
  });

  const PROFILE = { display_name: 'Ani', voice_description: 'punchy', voice_rules: 'x', content_pillars: [] } as never;
  const pass = { persona_fidelity: 9, uniqueness: 9, specificity: 9, so_what: 9, pain_resonance: 9, ai_slop: 1, revision_notes: '', pass: true };

  it('an em-dash-loving system override produces targeted_revise -> escalated events under one request_id', async () => {
    evaluateDraft.mockResolvedValue(pass);
    // Every generation call keeps returning em-dash text - Gate A revise and
    // Gate B escalation both fail to clean it, forcing the full chain.
    chatCompletion.mockResolvedValue('bad \u2014 text with an em dash every single time, long enough to pass length checks. '.repeat(3));

    const { runContentPipeline } = await import('@/lib/content-pipeline');
    const result = await runContentPipeline({
      userPrompt: 'x', profile: PROFILE, platform: 'linkedin',
      systemOverride: 'Use plenty of em dashes - they add drama.',
    });

    const requestIds = new Set(emitted.map((e) => e.requestId));
    expect(requestIds.size).toBe(1); // every event for this one call shares a request_id
    const events = emitted.map((e) => e.event);
    expect(events).toContain('targeted_revise');
    expect(events).toContain('escalated');
    expect(result.flags).toContain('hard_check_failed');
  });
});
