import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { draftOutboundComment, type EngagementTaskRow } from '@/lib/engagement/tasks';
import { guardAiRequest } from '@/lib/ai-guard';
import { errorResponse } from '@/lib/api-errors';
import { z } from 'zod';

/**
 * Outbound engagement queue API.
 *
 * GET   — list the user's queued/sent outbound tasks (newest first).
 * POST  — create a task: AI-drafts a comment in the creator's voice for a
 *         target post; the task waits in 'draft' until the user approves it.
 * PATCH — approve / skip / edit a draft. Only approved tasks are ever posted,
 *         and posting happens in the cron worker, never inline here.
 */

const CreateSchema = z
  .object({
    target_provider_post_id: z.string().min(1).max(500),
    target_post_url: z.string().url().max(1000).optional(),
    target_author_name: z.string().max(200).optional(),
    target_post_excerpt: z.string().min(1).max(5000),
    kind: z.enum(['comment', 'reaction']).default('comment'),
    reaction_type: z.string().max(30).optional(),
    platform: z.enum(['linkedin']).default('linkedin'),
    source: z.enum(['manual', 'signal', 'gtm_nurture']).default('manual'),
  })
  .strict();

const PatchSchema = z
  .object({
    id: z.string().uuid(),
    action: z.enum(['approve', 'skip', 'update']),
    comment_text: z.string().min(1).max(3000).optional(),
  })
  .strict();

export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const { data, error } = await client.database
    .from('engagement_tasks')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tasks: (data ?? []) as EngagementTaskRow[] });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const input = parsed.data;

  const client = getServerClient();

  try {
    let commentText: string | null = null;
    if (input.kind === 'comment') {
      // Drafting burns AI budget — apply the same guard as inbox drafting.
      const guard = await guardAiRequest(user.id);
      if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

      const draft = await draftOutboundComment(client, user.id, {
        targetPostExcerpt: input.target_post_excerpt,
        targetAuthorName: input.target_author_name,
        platform: input.platform,
      });
      commentText = draft.text;
    }

    const { data, error } = await client.database
      .from('engagement_tasks')
      .insert([
        {
          user_id: user.id,
          platform: input.platform,
          kind: input.kind,
          target_provider_post_id: input.target_provider_post_id,
          target_post_url: input.target_post_url ?? null,
          target_author_name: input.target_author_name ?? null,
          target_post_excerpt: input.target_post_excerpt.slice(0, 2000),
          source: input.source,
          comment_text: commentText,
          reaction_type: input.reaction_type ?? 'like',
          // Reactions carry no text to review; they go straight to approved.
          status: input.kind === 'comment' ? 'draft' : 'approved',
        },
      ])
      .select('*')
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, task: data as EngagementTaskRow });
  } catch (err) {
    return errorResponse('Could not create engagement task.', 500, err);
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const { id, action, comment_text } = parsed.data;

  const client = getServerClient();

  const patch: Record<string, unknown> = {};
  if (action === 'approve') patch.status = 'approved';
  if (action === 'skip') patch.status = 'skipped';
  if (comment_text) patch.comment_text = comment_text;
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  // Guard on current status so a task already picked up by the worker (or
  // already sent) can't be flipped back into the queue.
  const { data, error } = await client.database
    .from('engagement_tasks')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id)
    .in('status', ['draft', 'approved', 'failed'])
    .select('*');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []) as EngagementTaskRow[];
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Task not found or not editable' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, task: rows[0] });
}
