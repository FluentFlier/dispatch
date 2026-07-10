import { describe, it, expect, vi, beforeEach } from 'vitest';

const chatCompletion = vi.fn().mockResolvedValue('draft text');
vi.mock('@/lib/llm', () => ({
  chatCompletion: (...args: unknown[]) => chatCompletion(...args),
}));
const humanizePipeline = vi.fn().mockResolvedValue({ text: 'humanized text', passes: ['pre_clean', 'clean', 'audit'] });
vi.mock('@/lib/humanizer', () => ({
  humanizePipeline: (...args: unknown[]) => humanizePipeline(...args),
}));
vi.mock('@/lib/hooks-intelligence/resolve-hooks', () => ({
  getBestHooksForGeneration: vi.fn().mockResolvedValue({ hooks: [], explanations: [] }),
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
    expect(result.text).toBe('humanized text');
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
