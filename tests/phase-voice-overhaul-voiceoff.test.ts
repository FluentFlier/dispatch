import { describe, it, expect, vi, beforeEach } from 'vitest';

const chatCompletion = vi.fn().mockResolvedValue('draft text');
vi.mock('@/lib/llm', () => ({
  chatCompletion: (...args: unknown[]) => chatCompletion(...args),
}));
// 400+ chars so it clears the linkedin platform_length hard check (Gate A
// now runs on the voice-off path too) - a short fixture here would trigger
// an unwanted targeted-revise call and this test isn't testing that gate.
const HUMANIZED_TEXT = 'humanized text about shipping the onboarding flow after careful review and testing across the team. '.repeat(5).trim();
const humanizePipeline = vi.fn().mockResolvedValue({ text: HUMANIZED_TEXT, passes: ['pre_clean', 'clean', 'audit'] });
vi.mock('@/lib/humanizer', () => ({
  humanizePipeline: (...args: unknown[]) => humanizePipeline(...args),
}));
vi.mock('@/lib/hooks-intelligence/resolve-hooks', () => ({
  getBestHooksForGeneration: vi.fn().mockResolvedValue({ hooks: [], explanations: [] }),
}));
vi.mock('@/lib/content-pipeline/compact', () => ({
  isCompactMode: () => false,
  runCompactPipeline: vi.fn(),
}));

import { runContentPipeline } from '@/lib/content-pipeline';

beforeEach(() => {
  humanizePipeline.mockClear();
  chatCompletion.mockClear();
});

describe('voice-off prose still gets humanized', () => {
  it('runs the humanize pass for a voice-off post', async () => {
    const result = await runContentPipeline({
      userPrompt: 'write about shipping',
      profile: null,
      useVoice: false,
      platform: 'linkedin',
      contentType: 'post',
    });
    expect(humanizePipeline).toHaveBeenCalledTimes(1);
    expect(result.stagesCompleted).toEqual(['base', 'humanize']);
    expect(result.text).toBe(HUMANIZED_TEXT);
  });

  it('fast voice-off skips the heavy pass unless humanizeAlways', async () => {
    await runContentPipeline({
      userPrompt: 'x',
      profile: null,
      useVoice: false,
      fast: true,
      contentType: 'post',
    });
    expect(humanizePipeline).not.toHaveBeenCalled();
  });
});
