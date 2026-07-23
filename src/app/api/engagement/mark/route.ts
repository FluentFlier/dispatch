import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { errorResponse } from '@/lib/api-errors';
import { z } from 'zod';

const MarkSchema = z
  .object({
    commentIds: z.array(z.string().uuid()).min(1),
    /** true marks handled, false puts the comment back in the needs-a-reply pile. */
    handled: z.boolean(),
  })
  .strict();

/**
 * Mark comments as already handled, without sending anything.
 *
 * The creator often reacts to a comment on the platform, or answers it in a way
 * we cannot observe. Those comments otherwise read "Needs a reply" here forever
 * and the pile stops meaning anything. This is the Gmail-style escape hatch:
 * it parks the comment as handled, and it is reversible.
 *
 * Stored as a `skipped` row in comment_reply_queue - that status already meant
 * "not replying to this one" and nothing else wrote it.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = MarkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { commentIds, handled } = parsed.data;
  const client = getServerClient();

  try {
    const { data: existing } = await client.database
      .from('comment_reply_queue')
      .select('id, post_comment_id, status')
      .eq('user_id', user.id)
      .in('post_comment_id', commentIds);

    const rows = (existing ?? []) as Array<{ id: string; post_comment_id: string; status: string }>;
    const byComment = new Map(rows.map((r) => [r.post_comment_id, r]));

    let changed = 0;
    for (const commentId of commentIds) {
      const hit = byComment.get(commentId);

      if (!handled) {
        // Un-marking undoes our own park only. A reply that actually went out
        // stays sent - that is a fact about the platform, not a local flag.
        if (hit?.status === 'skipped') {
          await client.database
            .from('comment_reply_queue')
            .delete()
            .eq('id', hit.id)
            .eq('user_id', user.id);
          changed++;
        }
        continue;
      }

      if (hit) {
        if (hit.status === 'sent') continue;
        await client.database
          .from('comment_reply_queue')
          .update({ status: 'skipped', updated_at: new Date().toISOString() })
          .eq('id', hit.id)
          .eq('user_id', user.id);
        changed++;
        continue;
      }

      await client.database.from('comment_reply_queue').insert([
        {
          user_id: user.id,
          post_comment_id: commentId,
          draft_reply: '',
          status: 'skipped',
        },
      ]);
      changed++;
    }

    return NextResponse.json({ ok: true, changed });
  } catch (err) {
    return errorResponse('Could not update those comments.', 500, err);
  }
}
