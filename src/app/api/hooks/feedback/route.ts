import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { updateFromEdits, updateFromEditsDB } from '@/lib/hooks-intelligence/rl-trainer';
import { pillarToVertical } from '@/lib/engagement/categorize-leads';
import { trackEvent } from '@/lib/analytics';
import { applyEditPenaltyToArms } from '@/lib/hooks-intelligence/rewards';
import { z } from 'zod';

const FeedbackSchema = z.object({
  postId: z.string(),
  pillar: z.string().optional(),
  used_hook_ids: z.array(z.string()).optional(),
  originalContent: z.object({
    hook: z.string().optional(),
    script: z.string().optional(),
    caption: z.string().optional(),
  }),
  editedContent: z.object({
    hook: z.string().optional(),
    script: z.string().optional(),
    caption: z.string().optional(),
  }),
  diffs: z.object({ totalChanges: z.number() }).passthrough(),
});

/**
 * POST /api/hooks/feedback
 * Server-side edit feedback → hook_performance DB + file fallback.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = FeedbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid feedback payload' }, { status: 400 });
  }

  const { originalContent, editedContent, diffs, postId, pillar, used_hook_ids } = parsed.data;
  if (diffs.totalChanges < 10) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const magnitude = Math.min(100, Math.max(10, Math.round(diffs.totalChanges / 5)));
  const vertical = pillarToVertical(pillar ?? 'general');

  const client = getServerClient();
  let hookIds = used_hook_ids ?? [];

  if (hookIds.length === 0) {
    const { data: post } = await client.database
      .from('posts')
      .select('used_hook_ids, pillar')
      .eq('id', postId)
      .eq('user_id', user.id)
      .maybeSingle();
    hookIds = (post as { used_hook_ids?: string[] } | null)?.used_hook_ids ?? [];
  }

  let dbUpdated = 0;
  if (hookIds.length > 0) {
    dbUpdated = await updateFromEditsDB(client, hookIds, magnitude, vertical, user.id, postId);
  }

  // Phase 4: half-weight negative to Thompson arms. An edit is a weaker
  // signal than a flop, so beta += 0.5 (vs 1.0 for a below-median post).
  // Threshold 30 matches the "heavy rewrite" bar used in rl-trainer.
  let armsPenalized = 0;
  if (hookIds.length > 0 && magnitude >= 30) {
    try {
      armsPenalized = await applyEditPenaltyToArms(client, hookIds);
    } catch (err) {
      console.warn('[hooks/feedback] hook_arms edit penalty failed (Phase 2 migration applied?)', err);
    }
  }

  // Legacy file-based RL for bootstrap hooks not yet in DB.
  updateFromEdits([
    {
      originalHookText: originalContent.hook || originalContent.script || '',
      editedHookText: editedContent.hook || editedContent.script || '',
      magnitude,
    },
  ]);

  void trackEvent('edit_feedback_submitted', {
    post_id: postId,
    magnitude,
    hooks_penalized: dbUpdated,
    arms_penalized: armsPenalized,
  });

  return NextResponse.json({ ok: true, dbUpdated, armsPenalized, hookIds: hookIds.length });
}
