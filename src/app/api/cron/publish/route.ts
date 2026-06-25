import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { getSocialProviderMode } from '@/lib/env';
import {
  listDuePublishJobs,
  processPublishJob,
  enqueuePublishJob,
  resetStuckProcessingJobs,
} from '@/lib/publish-queue';
import { logInfo, logError } from '@/lib/logger';
import { trackEvent } from '@/lib/analytics';

/**
 * GET /api/cron/publish: process publish queue + legacy scheduled posts.
 * Protected by CRON_SECRET Bearer token.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const client = getServiceClient();
    const results: Array<{ type: string; id: string; success: boolean; error?: string }> = [];

    // 0. Reset any jobs stuck in 'processing' from a previous timed-out run
    //    so they re-enter the queue as 'failed' and get retried.
    const resetCount = await resetStuckProcessingJobs(10);
    if (resetCount > 0) logInfo('cron.publish.reset_stuck', { resetCount });

    // 1. Process durable publish_jobs queue
    const jobs = await listDuePublishJobs(25);
    for (const job of jobs) {
      if (job.attempts >= job.max_attempts) continue;

      const { data: postRows } = await client.database
        .from('posts')
        .select('*')
        .eq('id', job.post_id)
        .eq('user_id', job.user_id)
        .limit(1);

      const post = postRows?.[0];
      if (!post) {
        results.push({ type: 'job', id: job.id, success: false, error: 'Post not found' });
        continue;
      }

      const updated = await processPublishJob(job, post as Record<string, unknown>);
      const success = updated.status === 'published';
      if (!success) {
        await trackEvent('publish_failed', {
          jobId: job.id,
          platform: job.platform,
          userId: job.user_id,
        });
      }
      results.push({
        type: 'job',
        id: job.id,
        success,
        error: updated.last_error ?? undefined,
      });
    }

    // 2. Legacy: posts with scheduled_publish_at (enqueue then process in ayrshare mode)
    const now = new Date().toISOString();
    const { data: duePosts } = await client.database
      .from('posts')
      .select('*')
      .lte('scheduled_publish_at', now)
      .neq('status', 'posted')
      .is('publish_job_id', null)
      .limit(25);

    const providerMode = getSocialProviderMode();

    for (const post of duePosts ?? []) {
      const postId = post.id as string;
      const userId = post.user_id as string;
      const platform = post.platform as 'twitter' | 'linkedin' | 'instagram' | 'threads';

      if (providerMode === 'ayrshare') {
        const { job, error } = await enqueuePublishJob({
          userId,
          postId,
          platform,
          scheduledFor: null,
          provider: 'ayrshare',
        });

        if (!job) {
          results.push({ type: 'post', id: postId, success: false, error });
          continue;
        }

        const updated = await processPublishJob(job, post as Record<string, unknown>);
        results.push({
          type: 'post',
          id: postId,
          success: updated.status === 'published',
          error: updated.last_error ?? undefined,
        });
      } else {
        // Direct mode: mark for manual processing via /api/publish (legacy cron path removed)
        results.push({
          type: 'post',
          id: postId,
          success: false,
          error: 'Direct scheduled publish: use publish API or enable Ayrshare',
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    logInfo('cron.publish.complete', {
      jobs: jobs.length,
      legacy: duePosts?.length ?? 0,
      succeeded: successCount,
    });

    return NextResponse.json({
      processed: results.length,
      succeeded: successCount,
      failed: results.length - successCount,
      results,
    });
  } catch (err: unknown) {
    logError('cron.publish.error', {}, err);
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
