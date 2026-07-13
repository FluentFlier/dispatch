import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ai', () => ({ generateContent: vi.fn() }));
vi.mock('@/lib/ai-tiers', () => ({ resolveModel: vi.fn(() => undefined) }));

import { classifyPromptForMemory } from '@/lib/memory/classify-prompt';
import { generateContent } from '@/lib/ai';

const genMock = generateContent as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('classifyPromptForMemory', () => {
  it('parses a well-formed classifier response', async () => {
    genMock.mockResolvedValue(
      '{"topics":["forbes"],"time_scope":"specific","search_query":"Forbes 30 Under 30 Summit"}',
    );
    const plan = await classifyPromptForMemory('remember the Forbes event');
    expect(plan.time_scope).toBe('specific');
    expect(plan.search_query).toBe('Forbes 30 Under 30 Summit');
    expect(plan.topics).toEqual(['forbes']);
  });

  it('tolerates prose/fences around the JSON', async () => {
    genMock.mockResolvedValue('Sure!\n```json\n{"topics":[],"time_scope":"any","search_query":"growth"}\n```');
    const plan = await classifyPromptForMemory('write about growth');
    expect(plan.time_scope).toBe('any');
    expect(plan.search_query).toBe('growth');
  });

  it('falls back to the naive query on unparseable output', async () => {
    genMock.mockResolvedValue('no json here');
    const plan = await classifyPromptForMemory('some prompt text');
    expect(plan).toEqual({ topics: [], time_scope: 'any', search_query: 'some prompt text' });
  });

  it('falls back (never throws) when the model call errors', async () => {
    genMock.mockRejectedValue(new Error('LLM down'));
    const plan = await classifyPromptForMemory('another prompt');
    expect(plan.time_scope).toBe('any');
    expect(plan.search_query).toBe('another prompt');
  });

  it('coerces an invalid time_scope to "any"', async () => {
    genMock.mockResolvedValue('{"topics":[],"time_scope":"whenever","search_query":"x"}');
    const plan = await classifyPromptForMemory('p');
    expect(plan.time_scope).toBe('any');
  });
});
