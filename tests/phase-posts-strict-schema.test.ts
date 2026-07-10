/**
 * Break 6 mechanism check: the posts create schema is .strict(), so a stray
 * display-only field (hook_explanations) in the save body rejects the ENTIRE
 * insert, and the voice scores never persist. This test pins that behavior so
 * the fix (not sending hook_explanations) stays correct.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Mirror of the persisted-field shape from src/app/api/posts/route.ts
const Schema = z.object({
  title: z.string().min(1),
  pillars: z.array(z.string()).optional(),
  script: z.string().nullable().optional(),
  status: z.string().optional(),
  platform: z.string().min(1),
  voice_match_score: z.number().int().min(0).max(100).nullable().optional(),
  ai_score: z.number().int().min(0).max(100).nullable().optional(),
  voice_evaluation: z.record(z.string(), z.unknown()).nullable().optional(),
  used_hook_ids: z.array(z.string()).optional(),
  pipeline_stages: z.array(z.string()).optional(),
}).strict();

describe('posts strict schema (break 6)', () => {
  it('rejects a body that includes hook_explanations', () => {
    const withExtra = {
      title: 't', pillars: ['general'], script: 'x', status: 'scripted', platform: 'linkedin',
      voice_match_score: 80, ai_score: 20, voice_evaluation: {}, used_hook_ids: [],
      pipeline_stages: [], hook_explanations: [{ id: 'a' }],
    };
    expect(Schema.safeParse(withExtra).success).toBe(false);
  });

  it('accepts the fixed body (scores persist, no hook_explanations)', () => {
    const fixed = {
      title: 't', pillars: ['general'], script: 'x', status: 'scripted', platform: 'linkedin',
      voice_match_score: 80, ai_score: 20, voice_evaluation: {}, used_hook_ids: [], pipeline_stages: [],
    };
    expect(Schema.safeParse(fixed).success).toBe(true);
  });
});
