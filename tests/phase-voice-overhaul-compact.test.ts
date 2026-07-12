import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const chatCompletion = vi.fn();
vi.mock('@/lib/llm', () => ({
  chatCompletion: (...args: unknown[]) => chatCompletion(...args),
}));
const evaluateDraft = vi.fn();
vi.mock('@/lib/voice-evaluator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/voice-evaluator')>();
  return { ...actual, evaluateDraft: (...args: unknown[]) => evaluateDraft(...args) };
});

import { isCompactMode, runCompactPipeline } from '@/lib/content-pipeline/compact';

// 400+ chars so it clears the linkedin platform_length hard check (compact
// mode now runs Gate A/B enforcement after the edit pass, this task) -
// 'a drafted post' was 14 chars and tripped an unwanted targeted-revise call
// that these tests' exact chatCompletion call counts aren't testing for.
const DRAFT_TEXT = 'We shipped the thing today after three weeks of steady testing across the whole team, and it finally landed clean without any surprises along the way. '.repeat(3).trim();

const PROFILE = { display_name: 'Ani', voice_description: 'punchy', voice_rules: 'DO: short' };
const CONTEXT = [
  'BACKGROUND FACTS (use specific details, never genericize):\nBuilt Ada.',
  'VOICE EXAMPLES (match rhythm, tone, and structure; do not copy topics verbatim):\nExample 1:\nWe shipped it.',
  'EMAIL VOICE (how they write 1:1 - match warmth, explanation style, sign-offs):\nEmail 1:\nHey.',
].join('\n\n');

beforeEach(() => {
  chatCompletion.mockReset().mockResolvedValue(DRAFT_TEXT);
  evaluateDraft.mockReset().mockResolvedValue({
    persona_fidelity: 8, uniqueness: 8, specificity: 8, so_what: 8,
    pain_resonance: 8, ai_slop: 2, revision_notes: '', pass: true,
  });
  delete process.env.LLM_PIPELINE_MODE;
  delete process.env.LLM_MODEL;
});
afterEach(() => {
  delete process.env.LLM_PIPELINE_MODE;
  delete process.env.LLM_MODEL;
});

describe('isCompactMode', () => {
  it('env override wins both ways', () => {
    process.env.LLM_PIPELINE_MODE = 'compact';
    process.env.LLM_MODEL = 'gpt-4o';
    expect(isCompactMode()).toBe(true);
    process.env.LLM_PIPELINE_MODE = 'full';
    process.env.LLM_MODEL = 'meta-llama/Llama-3.1-8B-Instruct';
    expect(isCompactMode()).toBe(false);
  });

  it('auto-detects small models by size suffix', () => {
    expect(isCompactMode('meta-llama/Llama-3.1-8B-Instruct')).toBe(true);
    expect(isCompactMode('qwen-2.5-7b-instruct')).toBe(true);
    expect(isCompactMode('gpt-4o')).toBe(false);
    expect(isCompactMode('llama-3.3-70b-versatile')).toBe(false);
  });
});

describe('runCompactPipeline', () => {
  it('voice-on: exactly 2 generation calls + 1 evaluation, voice evidence in call 1, no email voice', async () => {
    const result = await runCompactPipeline({
      userPrompt: 'write about launch day',
      profile: PROFILE,
      contextAdditions: CONTEXT,
      platform: 'linkedin',
      contentType: 'post',
      useVoice: true,
      vocabulary: { uses_often: ['shipped'] },
    });
    expect(chatCompletion).toHaveBeenCalledTimes(2);
    const draftSystem = chatCompletion.mock.calls[0][0] as string;
    expect(draftSystem).toContain('VOICE EVIDENCE');
    expect(draftSystem).toContain('We shipped it.');
    expect(draftSystem).not.toContain('EMAIL VOICE');
    const editSystem = chatCompletion.mock.calls[1][0] as string;
    expect(editSystem).toContain('PRESERVE');
    expect(evaluateDraft).toHaveBeenCalledTimes(1);
    // compact mode relaxes the pass threshold to 7 (5th arg)
    expect(evaluateDraft.mock.calls[0][4]).toBe(7);
    expect(result.stagesCompleted).toEqual(['base', 'humanize', 'evaluate']);
  });

  it('voice-off: 2 calls, no persona, no evaluation', async () => {
    const result = await runCompactPipeline({
      userPrompt: 'write about launch day',
      profile: null,
      useVoice: false,
      platform: 'linkedin',
      contentType: 'post',
    });
    expect(chatCompletion).toHaveBeenCalledTimes(2);
    expect(evaluateDraft).not.toHaveBeenCalled();
    expect(result.stagesCompleted).toEqual(['base', 'humanize']);
  });

  it('fast mode: single call, no edit pass, no evaluation', async () => {
    await runCompactPipeline({
      userPrompt: 'x', profile: PROFILE, useVoice: true, fast: true, contentType: 'post',
    });
    expect(chatCompletion).toHaveBeenCalledTimes(1);
    expect(evaluateDraft).not.toHaveBeenCalled();
  });
});
