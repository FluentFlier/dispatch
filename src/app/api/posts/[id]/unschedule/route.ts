import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';

/**
 * POST /api/posts/[id]/unschedule
 * Clears all scheduling fields on the post and cancels any pending publish_job.
 * Idempotent - safe to call even if the post was never scheduled.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const postId = params.id;

  // Verify ownership and get publish_job_id
  const { data: post, error: fetchError } = await client.database
    .from('posts')
    .select('id, user_id, publish_job_id')
    .eq('id', postId)
    .eq('user_id', user.id)
    .single();

  if (fetchError || !post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  }

  // Cancel any pending publish job (queued or failed only - don't touch processing/published)
  const jobId = post.publish_job_id as string | null;
  if (jobId) {
    await client.database
      .from('publish_jobs')
      .update({
        status: 'dead',
        last_error: 'Cancelled by user (unscheduled from calendar)',
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .eq('user_id', user.id)
      .in('status', ['queued', 'failed']);
  }

  // Clear all scheduling fields
  const { data: updated, error: updateError } = await client.database
    .from('posts')
    .update({
      scheduled_date: null,
      scheduled_publish_at: null,
      publish_job_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', postId)
    .eq('user_id', user.id)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ post: updated });
}
