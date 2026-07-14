import { describe, it, expect, vi, beforeEach } from 'vitest';

// generateContent is the LLM classifier call; mock it at the module boundary so
// the deterministic floor can be tested without a live model.
vi.mock('@/lib/ai', () => ({ generateContent: vi.fn() }));
vi.mock('@/lib/ai-tiers', () => ({ resolveModel: vi.fn(() => null) }));

import { classifyPromptForMemory } from '@/lib/memory/classify-prompt';
import { generateContent } from '@/lib/ai';

const SPECIFIC = 'Reflect on the Forbes 30 Under 30 summit where I met Anirudh Manjesh.';

describe('classifyPromptForMemory deterministic floor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('falls to a SPECIFIC entity-rich plan when the LLM call throws', async () => {
    vi.mocked(generateContent).mockRejectedValue(new Error('429'));
    const plan = await classifyPromptForMemory(SPECIFIC);
    expect(plan.time_scope).toBe('specific');
    expect(plan.search_query).toContain('Forbes');
    expect(plan.search_query).toContain('Anirudh');
  });

  it('upgrades a misclassified "any" to specific + merges entities', async () => {
    vi.mocked(generateContent).mockResolvedValue(
      JSON.stringify({ topics: ['event'], time_scope: 'any', search_query: 'summit recap' }),
    );
    const plan = await classifyPromptForMemory(SPECIFIC);
    expect(plan.time_scope).toBe('specific');
    expect(plan.search_query).toContain('summit');
    expect(plan.search_query).toContain('Forbes');
  });

  it('leaves a genuinely generic prompt as "any"', async () => {
    vi.mocked(generateContent).mockResolvedValue(
      JSON.stringify({ topics: ['hiring'], time_scope: 'any', search_query: 'hiring' }),
    );
    const plan = await classifyPromptForMemory('Write a LinkedIn post about hiring junior engineers.');
    expect(plan.time_scope).toBe('any');
  });
});
