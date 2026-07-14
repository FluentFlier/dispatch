/**
 * Phase: Braindump box wired into generation
 *
 * The braindump "thoughts" must always reach the prompt (and thus the LLM), the
 * topic must survive, and the whole prompt must stay within the API's 10000-char
 * limit - the braindump is truncated last rather than the whole prompt failing.
 */
import { describe, it, expect } from 'vitest';
import { assembleGeneratePrompt, MAX_PROMPT_LEN } from '@/lib/generate-prompt';

describe('Phase: Braindump prompt assembly', () => {
  it('includes both the topic and the thoughts', () => {
    const p = assembleGeneratePrompt({
      base: 'Write a post.',
      topic: 'AI regulation',
      thoughts: 'mention the EU AI Act and cite the 2026 timeline',
      lengthHint: 'Target ~200 words.',
    });
    expect(p).toContain('AI regulation');
    expect(p).toContain('EU AI Act');
    expect(p).toContain('Target ~200 words.');
    expect(p).toContain('DETAILS AND THOUGHTS');
  });

  it('works with only thoughts (no topic)', () => {
    const p = assembleGeneratePrompt({ base: 'Write a post.', thoughts: 'here are my raw notes' });
    expect(p).toContain('here are my raw notes');
  });

  it('omits blocks that are empty', () => {
    const p = assembleGeneratePrompt({ base: 'Write a post.' });
    expect(p).toBe('Write a post.');
    expect(p).not.toContain('DETAILS AND THOUGHTS');
    expect(p).not.toContain('WRITE ABOUT THIS SUBJECT');
  });

  it('never exceeds the API length cap, truncating the braindump last', () => {
    const p = assembleGeneratePrompt({
      base: 'Write a post.',
      topic: 'a topic',
      thoughts: 'x'.repeat(50_000),
      lengthHint: 'Target ~200 words.',
    });
    expect(p.length).toBeLessThanOrEqual(MAX_PROMPT_LEN);
    // The essential parts survive even when the braindump is huge.
    expect(p).toContain('a topic');
  });

  it('trims surrounding whitespace on inputs', () => {
    const p = assembleGeneratePrompt({ base: 'Base.', topic: '  spaced  ', thoughts: '  notes  ' });
    expect(p).toContain('spaced');
    expect(p).toContain('notes');
    expect(p).not.toContain('  spaced  ');
  });
});
