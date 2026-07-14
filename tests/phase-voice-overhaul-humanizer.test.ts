import { describe, it, expect, vi, beforeEach } from 'vitest';

const chatCompletion = vi.fn();
vi.mock('@/lib/llm', () => ({
  chatCompletion: (...args: unknown[]) => chatCompletion(...args),
}));
const generateContent = vi.fn();
vi.mock('@/lib/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai')>();
  return { ...actual, generateContent: (...args: unknown[]) => generateContent(...args) };
});

import { deterministicPreClean, humanizePipeline } from '@/lib/humanizer';

beforeEach(() => {
  chatCompletion.mockReset().mockResolvedValue('cleaned');
  generateContent.mockReset().mockImplementation(async (prompt: string) => {
    // echo the draft back so pipeline output is deterministic
    const m = (prompt as string).match(/---\n([\s\S]*?)\n---/);
    return m ? m[1] : 'out';
  });
});

describe('deterministicPreClean', () => {
  it('BUG FIX: preserves paragraph breaks (double newlines)', () => {
    const out = deterministicPreClean('First para.\n\nSecond para.');
    expect(out).toBe('First para.\n\nSecond para.');
  });

  it('still collapses runs of spaces and 3+ newlines', () => {
    expect(deterministicPreClean('a  b\n\n\n\nc')).toBe('a b\n\nc');
  });

  it('never replaces a preserved creator word', () => {
    const out = deterministicPreClean('We leverage the tool.', ['leverage']);
    expect(out).toContain('leverage');
    const cleaned = deterministicPreClean('We leverage the tool.');
    expect(cleaned).not.toContain('leverage');
  });
});

describe('humanizePipeline preserve list', () => {
  it('passes uses_often + signature_phrases into the clean prompt', async () => {
    await humanizePipeline('text with robust ideas', {
      skipVoice: true,
      skipAudit: true,
      vocabulary: { uses_often: ['robust'], signature_phrases: ['ship it'] },
    });
    // humanizeClean now calls chatCompletion directly with role 'small'; the
    // preserve block rides in the system prompt (arg 0).
    const cleanSystem = chatCompletion.mock.calls[0][0] as string;
    expect(cleanSystem).toContain('PRESERVE THESE EXACTLY');
    expect(cleanSystem).toContain('robust');
    expect(cleanSystem).toContain('ship it');
    expect(chatCompletion.mock.calls[0][2]).toMatchObject({ role: 'small' });
  });
});
