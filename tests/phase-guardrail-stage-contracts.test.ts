/**
 * Phase: Guardrail Consolidation - stage contracts (spec 3.4).
 * Text non-empty, <= 6000 char ceiling, not a lone JSON blob when prose is
 * expected; 30s per-stage timeout. A violation emits a typed
 * stage_contract_violation event instead of a bare catch or a silent ship.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateStageOutput, withStageTimeout } from '@/lib/content-pipeline/stage-contract';

describe('validateStageOutput', () => {
  it('passes normal prose', () => {
    expect(validateStageOutput('A perfectly ordinary post about shipping software.')).toEqual({ ok: true });
  });
  it('fails empty text', () => {
    expect(validateStageOutput('   ').ok).toBe(false);
  });
  it('fails text over the 6000 char ceiling', () => {
    expect(validateStageOutput('a'.repeat(6001)).ok).toBe(false);
  });
  it('passes text at exactly the 6000 char ceiling', () => {
    expect(validateStageOutput('a'.repeat(6000)).ok).toBe(true);
  });
  it('fails a lone JSON object when prose was expected', () => {
    expect(validateStageOutput('{"persona_fidelity": 8, "notes": "looks fine"}').ok).toBe(false);
  });
  it('fails a lone JSON array', () => {
    expect(validateStageOutput('["one", "two", "three"]').ok).toBe(false);
  });
  it('passes prose that happens to contain braces mid-sentence', () => {
    expect(validateStageOutput('We use {curly} braces sometimes in code snippets we quote.').ok).toBe(true);
  });
});

describe('withStageTimeout', () => {
  it('resolves normally when the promise finishes before the timeout', async () => {
    await expect(withStageTimeout(Promise.resolve('ok'), 50, 'base')).resolves.toBe('ok');
  });
  it('rejects with a stage-labeled error when the promise exceeds the timeout', async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve('too late'), 100));
    await expect(withStageTimeout(slow, 10, 'base')).rejects.toThrow(/base.*10ms/);
  });
});

describe('callStageChecked', () => {
  const chatCompletion = vi.fn();
  const emitPipelineEvent = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.resetModules();
    chatCompletion.mockReset();
    emitPipelineEvent.mockClear();
    vi.doMock('@/lib/llm', () => ({ chatCompletion: (...a: unknown[]) => chatCompletion(...a) }));
    vi.doMock('@/lib/content-pipeline/events', () => ({ emitPipelineEvent }));
  });

  // vi.doMock registers in the file-wide module registry, not scoped to this
  // describe block - without unmocking, the stubbed '@/lib/llm' (chatCompletion
  // only, no backoffMs) would leak into the later "backoffMs audit" tests below.
  afterEach(() => {
    vi.doUnmock('@/lib/llm');
    vi.doUnmock('@/lib/content-pipeline/events');
    vi.resetModules();
  });

  it('returns the raw output when it satisfies the stage contract', async () => {
    chatCompletion.mockResolvedValue('a perfectly normal post about shipping.');
    const { callStageChecked } = await import('@/lib/content-pipeline/stage-contract');
    const out = await callStageChecked('sys', 'user', {}, 'base', 'req_1', '');
    expect(out).toBe('a perfectly normal post about shipping.');
    expect(emitPipelineEvent).not.toHaveBeenCalled();
  });

  it('truncates and emits a violation event when output exceeds the length ceiling', async () => {
    chatCompletion.mockResolvedValue('a'.repeat(6500));
    const { callStageChecked } = await import('@/lib/content-pipeline/stage-contract');
    const out = await callStageChecked('sys', 'user', {}, 'base', 'req_1', 'previous');
    expect(out.length).toBe(6000);
    expect(emitPipelineEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'stage_contract_violation', requestId: 'req_1' }));
  });

  it('falls back to the previous stage text and emits a violation event on empty output', async () => {
    chatCompletion.mockResolvedValue('   ');
    const { callStageChecked } = await import('@/lib/content-pipeline/stage-contract');
    const out = await callStageChecked('sys', 'user', {}, 'voice', 'req_1', 'the last good draft');
    expect(out).toBe('the last good draft');
    expect(emitPipelineEvent).toHaveBeenCalledWith(expect.objectContaining({ event: 'stage_contract_violation' }));
  });

  it('caps maxTokens at the stage ceiling even when a caller asks for more', async () => {
    chatCompletion.mockResolvedValue('fine');
    const { callStageChecked } = await import('@/lib/content-pipeline/stage-contract');
    await callStageChecked('sys', 'user', { maxTokens: 4000 }, 'base', 'req_1', '');
    expect(chatCompletion.mock.calls[0][2].maxTokens).toBe(1200);
  });
});

describe('llm.ts backoffMs audit (spec 3.4)', () => {
  it('never returns less than 1000ms even when the provider hints 0s', async () => {
    const { backoffMs } = await import('@/lib/llm');
    for (let i = 0; i < 20; i++) {
      expect(backoffMs(0, '0', '')).toBeGreaterThanOrEqual(1000);
    }
  });

  it('applies jitter - repeated calls with the same inputs are not all identical', async () => {
    const { backoffMs } = await import('@/lib/llm');
    const samples = Array.from({ length: 10 }, () => backoffMs(0, null, ''));
    expect(new Set(samples).size).toBeGreaterThan(1);
  });

  it('stays within the documented [1000, 1250] range for attempt 0 with no hints', async () => {
    const { backoffMs } = await import('@/lib/llm');
    const v = backoffMs(0, null, '');
    expect(v).toBeGreaterThanOrEqual(1000);
    expect(v).toBeLessThanOrEqual(1250);
  });

  it('never exceeds MAX_BACKOFF_MS (12000) even at a high attempt count', async () => {
    const { backoffMs } = await import('@/lib/llm');
    expect(backoffMs(10, null, '')).toBeLessThanOrEqual(12000);
  });
});
