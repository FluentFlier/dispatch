import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { updateFromEdits } from '@/lib/hooks-intelligence/rl-trainer';
import { z } from 'zod';

const FeedbackSchema = z.object({
  postId: z.string(),
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
 * Server-side edit feedback → hook RL trainer (keeps prod-mining off the client bundle).
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

  const { originalContent, editedContent, diffs } = parsed.data;
  if (diffs.totalChanges < 10) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  updateFromEdits([
    {
      originalHookText: originalContent.hook || originalContent.script || '',
      editedHookText: editedContent.hook || editedContent.script || '',
      magnitude: Math.min(100, Math.max(10, Math.round(diffs.totalChanges / 5))),
    },
  ]);

  return NextResponse.json({ ok: true });
}
