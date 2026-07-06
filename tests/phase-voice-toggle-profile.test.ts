/**
 * Phase: Voice Toggle + Profile
 *
 * Verifies the generation pipeline honors the "use my voice" opt-out: when
 * off, the creator profile must NOT reach the prompt and the voice-QA loop is
 * skipped; when on (default), the profile is used and evaluation runs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/llm', () => ({
  chatCompletion: vi.fn().mockResolvedValue('a generated draft'),
  LlmError: class LlmError extends Error {},
}));
vi.mock('@/lib/ai', () => ({
  buildSystemPrompt: vi.fn().mockReturnValue('SYSTEM'),
}));
vi.mock('@/lib/voice-evaluator', () => ({
  evaluateDraft: vi.fn().mockResolvedValue({
    persona_fidelity: 8, ai_slop: 1, pass: true, revision_notes: '',
  }),
  evaluationPasses: vi.fn().mockReturnValue(true),
}));
vi.mock('@/lib/humanizer', () => ({
  humanizePipeline: vi.fn().mockImplementation(async (text: string) => ({ text, passes: ['pre_clean', 'clean'] })),
  aiScore: vi.fn().mockResolvedValue({ score: 20, flags: [] }),
  humanize: vi.fn().mockResolvedValue('humanized'),
}));
vi.mock('@/lib/hooks-intelligence/resolve-hooks', () => ({
  getBestHooksForGeneration: vi.fn().mockResolvedValue({ hooks: [], explanations: [] }),
}));
vi.mock('@/lib/hooks-intelligence', () => ({ getBestHooksForContext: vi.fn().mockReturnValue([]) }));
vi.mock('@/lib/voice-prompts', () => ({ buildVoiceComposeHints: vi.fn().mockReturnValue('') }));
vi.mock('@/lib/pillars', () => ({ profilePillarWeights: vi.fn().mockReturnValue({}) }));

import { generateWithVoicePipeline } from '@/lib/voice-pipeline';
import { buildSystemPrompt } from '@/lib/ai';
import { evaluateDraft } from '@/lib/voice-evaluator';

const PROFILE = {
  display_name: 'Ani',
  voice_description: 'punchy founder voice',
  voice_rules: 'no em dashes',
  content_pillars: '[]',
} as never;

beforeEach(() => vi.clearAllMocks());

describe('Phase: Voice Toggle', () => {
  it('drops the profile and skips voice QA when useVoice is false', async () => {
    const res = await generateWithVoicePipeline({
      userPrompt: 'write a post about shipping fast',
      profile: PROFILE,
      useVoice: false,
    });
    // Base stage uses neutral strategist prompt — not buildSystemPrompt.
    expect(buildSystemPrompt).not.toHaveBeenCalled();
    expect(evaluateDraft).not.toHaveBeenCalled();
    expect(res.stagesCompleted).toEqual(['base']);
    expect(res.text).toBe('a generated draft');
    expect(res.voice_match_score).toBe(0);
  });

  it('uses the profile and runs voice QA by default', async () => {
    await generateWithVoicePipeline({
      userPrompt: 'write a post',
      profile: PROFILE,
    });
    // 2nd arg (merged context) is undefined here because the mocked compose
    // hints/hooks are empty; the key assertion is the profile is passed.
    expect(buildSystemPrompt).toHaveBeenCalledWith(PROFILE, undefined);
    expect(evaluateDraft).toHaveBeenCalled();
    expect(evaluateDraft).toHaveBeenCalledWith(expect.any(String), PROFILE, undefined, expect.any(String));
  });

  it('still skips voice QA in fast mode even with voice on', async () => {
    const res = await generateWithVoicePipeline({
      userPrompt: 'quick draft',
      profile: PROFILE,
      fast: true,
    });
    expect(evaluateDraft).not.toHaveBeenCalled();
    expect(buildSystemPrompt).not.toHaveBeenCalled();
    expect(res.stagesCompleted).toEqual(['base']);
  });
});
