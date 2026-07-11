import { describe, it, expect } from 'vitest';
import { CreatePostSchema } from '@/lib/posts-schema';

describe('CreatePostSchema (full save-to-library payload)', () => {
  // Mirrors the body GenerateOutput.tsx sends on full save. This used to 400
  // because the schema was .strict() and rejected hook_explanations.
  const fullSaveBody = {
    title: 'My generated post',
    pillars: ['hot-take'],
    platform: 'linkedin',
    script: 'body text',
    status: 'scripted',
    voice_match_score: 82,
    ai_score: 40,
    voice_evaluation: { tone: 'ok' },
    used_hook_ids: ['h1', 'h2'],
    hook_explanations: [
      { id: 'h1', text: 'hook', author: 'a', rlScore: 1, source: 's', reason: 'r' },
    ],
    pipeline_stages: ['draft', 'humanize'],
  };

  it('accepts the full-save payload including ephemeral fields', () => {
    const parsed = CreatePostSchema.safeParse(fullSaveBody);
    expect(parsed.success).toBe(true);
  });

  it('still requires at least one pillar', () => {
    const { pillars: _pillars, ...noPillar } = fullSaveBody;
    const parsed = CreatePostSchema.safeParse(noPillar);
    expect(parsed.success).toBe(false);
  });

  it('rejects unknown columns (strict) that are neither real nor ephemeral', () => {
    const parsed = CreatePostSchema.safeParse({ ...fullSaveBody, totally_made_up: 1 });
    expect(parsed.success).toBe(false);
  });
});
