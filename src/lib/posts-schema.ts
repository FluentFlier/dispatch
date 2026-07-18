import { z } from 'zod';

/**
 * Validation for creating a post (POST /api/posts).
 *
 * `.strict()` rejects unknown keys, but we explicitly accept a few ephemeral
 * display-only fields the generation UI passes back (`hook_explanations`,
 * `humanize_passes`). These have no column on `posts`; the route strips them
 * before insert so a forgiving client payload never 400s or writes a phantom
 * column.
 */
export const CreatePostSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  // Either a single pillar (legacy) or a pillars[] array; normalized server-side.
  pillar: z.string().min(1).optional(),
  pillars: z.array(z.string()).optional(),
  /** Per-pillar importance (slug -> 1-100); normalized server-side. */
  pillar_weights: z.record(z.string(), z.number()).optional(),
  platform: z.string().min(1, 'Platform is required'),
  status: z.string().optional(),
  script: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  hashtags: z.string().nullable().optional(),
  hook: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  scheduled_date: z.string().nullable().optional(),
  /** Exact publish instant for the auto-publish engine (ISO timestamp). */
  scheduled_publish_at: z.string().nullable().optional(),
  posted_date: z.string().nullable().optional(),
  series_id: z.string().nullable().optional(),
  series_position: z.number().nullable().optional(),
  views: z.number().nullable().optional(),
  likes: z.number().nullable().optional(),
  saves: z.number().nullable().optional(),
  comments: z.number().nullable().optional(),
  shares: z.number().nullable().optional(),
  follows_gained: z.number().nullable().optional(),
  variant_group_id: z.string().uuid().nullable().optional(),
  source_platform: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  voice_match_score: z.number().int().min(0).max(100).nullable().optional(),
  ai_score: z.number().int().min(0).max(100).nullable().optional(),
  voice_evaluation: z.record(z.string(), z.unknown()).nullable().optional(),
  used_hook_ids: z.array(z.string()).optional(),
  pipeline_stages: z.array(z.string()).optional(),
  // Ephemeral generation metadata the UI passes back for convenience. These have
  // no column on `posts`; accept them so full-save doesn't 400, then strip
  // before insert (see the POST handler) so we never write a phantom column.
  hook_explanations: z.array(z.unknown()).optional(),
  humanize_passes: z.array(z.string()).optional(),
}).strict().refine((d) => Boolean(d.pillar) || (d.pillars && d.pillars.length > 0), {
  message: 'At least one pillar is required',
  path: ['pillar'],
});
