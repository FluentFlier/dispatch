import { describe, it, expect, vi, beforeEach } from 'vitest';

const chatCompletion = vi.fn();
vi.mock('@/lib/llm', () => ({
  chatCompletion: (...args: unknown[]) => chatCompletion(...args),
}));

import { evaluateDraft, evaluationPasses } from '@/lib/voice-evaluator';

const PROFILE = {
  display_name: 'Ani',
  voice_description: 'punchy',
  voice_rules: 'no fluff',
  bio_facts: 'built Ada',
};

const CONTEXT = [
  'VOCABULARY FINGERPRINT:\nWords/phrases they use often: shipped, tbh',
  'VOICE EXAMPLES (match rhythm, tone, and structure; do not copy topics verbatim):\nExample 1:\nWe shipped it.',
  'CREATOR BRAIN (your long-term memory on Content OS):\nprivate snippet',
].join('\n\n');

const GOOD_SCORES = JSON.stringify({
  persona_fidelity: 9, uniqueness: 9, specificity: 9, so_what: 9,
  pain_resonance: 9, ai_slop: 2, revision_notes: '',
});

beforeEach(() => {
  chatCompletion.mockReset().mockResolvedValue(GOOD_SCORES);
});

describe('evaluateDraft voice evidence', () => {
  it('includes fingerprint + examples in the judge prompt, excludes brain', async () => {
    await evaluateDraft('draft', PROFILE, CONTEXT, 'post');
    const userPrompt = chatCompletion.mock.calls[0][1] as string;
    expect(userPrompt).toContain('VOCABULARY FINGERPRINT:');
    expect(userPrompt).toContain('We shipped it.');
    expect(userPrompt).not.toContain('private snippet');
  });

  it('judges cold: temperature 0.2, bounded tokens, json mode', async () => {
    await evaluateDraft('draft', PROFILE, CONTEXT, 'post');
    const opts = chatCompletion.mock.calls[0][2] as Record<string, unknown>;
    expect(opts.temperature).toBe(0.2);
    expect(opts.maxTokens).toBe(400);
    expect(opts.responseFormat).toBe('json');
  });

  it('honors a custom pass threshold', async () => {
    chatCompletion.mockResolvedValue(JSON.stringify({
      persona_fidelity: 7, uniqueness: 7, specificity: 7, so_what: 7,
      pain_resonance: 7, ai_slop: 3, revision_notes: 'x',
    }));
    const strict = await evaluateDraft('draft', PROFILE, CONTEXT, 'post');
    expect(strict.pass).toBe(false);
    const lenient = await evaluateDraft('draft', PROFILE, CONTEXT, 'post', 7);
    expect(lenient.pass).toBe(true);
  });
});

describe('evaluationPasses threshold param', () => {
  const m = {
    persona_fidelity: 7, uniqueness: 7, specificity: 7, so_what: 7,
    pain_resonance: 7, ai_slop: 3, revision_notes: '', pass: false,
  };
  it('default 8 fails a 7-across matrix; explicit 7 passes it', () => {
    expect(evaluationPasses(m)).toBe(false);
    expect(evaluationPasses(m, 7)).toBe(true);
  });
});
