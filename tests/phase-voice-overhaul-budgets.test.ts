import { describe, it, expect, vi, beforeEach } from 'vitest';

const chatCompletion = vi.fn();
vi.mock('@/lib/llm', () => ({
  chatCompletion: (...args: unknown[]) => chatCompletion(...args),
}));

import { analyzeVoiceSamples } from '@/lib/voice-lab/analyze-samples';

const VALID = JSON.stringify({
  analysis: { tone: 'dry' },
  voice_summary: 's',
  voice_rules: ['DO: x'],
  gap_questions: [],
});

beforeEach(() => {
  chatCompletion.mockReset().mockResolvedValue(VALID);
});

describe('analyzeVoiceSamples call shape', () => {
  it('asks for json with a 2048-token budget at low temperature', async () => {
    await analyzeVoiceSamples([{ content: 'post one', platform: 'linkedin' }]);
    const opts = chatCompletion.mock.calls[0][2] as Record<string, unknown>;
    expect(opts.responseFormat).toBe('json');
    expect(opts.maxTokens).toBe(2048);
    expect(opts.temperature).toBe(0.3);
  });
});
