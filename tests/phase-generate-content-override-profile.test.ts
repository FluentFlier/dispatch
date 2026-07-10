/**
 * Break 13: generateContent must not drop the creator profile when a
 * systemOverride is set. Event question generation always sets an override yet
 * passes a profile for personalization; previously the profile was discarded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const chatCompletion = vi.fn().mockResolvedValue('ok');
vi.mock('@/lib/llm', () => ({
  chatCompletion: (...args: unknown[]) => chatCompletion(...args),
  LlmError: class LlmError extends Error {},
}));

import { generateContent } from '@/lib/ai';

describe('generateContent + systemOverride keeps profile (break 13)', () => {
  beforeEach(() => chatCompletion.mockClear());

  it('appends the creator reference block under the override', async () => {
    await generateContent('Generate 5 questions', undefined, 'YOU GENERATE QUESTIONS.', {
      display_name: 'Ada Founder',
      bio: 'Building Ada.',
      bio_facts: 'Shipped 3 products.',
      voice_description: 'Blunt and warm.',
    });

    const systemPrompt = chatCompletion.mock.calls[0][0] as string;
    // Override stays authoritative (first) ...
    expect(systemPrompt.startsWith('YOU GENERATE QUESTIONS.')).toBe(true);
    // ... and the profile personalization is now present.
    expect(systemPrompt).toContain('Ada Founder');
    expect(systemPrompt).toContain('Shipped 3 products.');
    expect(systemPrompt).toContain('Blunt and warm.');
  });

  it('is a no-op for raw-override callers (no profile, no context)', async () => {
    await generateContent('Humanize this', undefined, 'HUMANIZER PROMPT.', null);
    const systemPrompt = chatCompletion.mock.calls[0][0] as string;
    expect(systemPrompt).toBe('HUMANIZER PROMPT.');
  });
});
