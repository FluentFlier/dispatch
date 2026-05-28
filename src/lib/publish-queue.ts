import { createHash } from 'crypto';
import { getServerClient } from '@/lib/insforge/server';
import { getSocialProvider } from '@/lib/social';
import type { PublishPayload, SocialPlatform } from '@/lib/social/types';
import { incrementUsage } from '@/lib/usage';
import { logError, logInfo } from '@/lib/logger';

export type PublishJobStatus = 'queued' | 'processing' | 'published' | 'failed' | 'dead';

export interface PublishJobRow {
  id: string;
  user_id: string;
  post_id: string;
  platform: string;
  status: PublishJobStatus;
  idempotency_key: string;
  scheduled_for: string | null;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  provider: string;
  provider_post_id: string | null;
  provider_url: string | null;
}

export function buildIdempotencyKey(
  userId: string,
  postId: string,
  platform: string,
  scheduledFor?: string | null
): string {
  const raw = `${userId}:${postId}:${platform}:${scheduledFor ?? 'now'}`;
  return createHash('sha256').update(raw).digest('hex');
}

export async function enqueuePublishJob(params: {
  userId: string;
  postId: string;
  platform: SocialPlatform;
  scheduledFor?: string | null;
  provider?: 'ayrshare' | 'direct';
}): Promise<{ job: PublishJobRow | null; duplicate: boolean; error?: string }> {
  const client = getServerClient();
  const idempotencyKey = buildIdempotencyKey(
    params.userId,
    params.postId,
    params.platform,
    params.scheduledFor
  );

  const { data: existing } = await client.database
    .from('publish_jobs')
    .select('*')
    .eq('idempotency_key', idempotencyKey)
    .limit(1);

  if (existing?.[0]) {
    return { job: existing[0] as PublishJobRow, duplicate: true };
  }

  const provider = params.provider ?? getSocialProvider().name;

  const { data: inserted, error } = await client.database
    .from('publish_jobs')
    .insert([
      {
        user_id: params.userId,
        post_id: params.postId,
        platform: params.platform,
        status: 'queued',
        idempotency_key: idempotencyKey,
        scheduled_for: params.scheduledFor ?? null,
        provider,
      },
    ])
    .select('*')
    .single();

  if (error) {
    return { job: null, duplicate: false, error: error.message };
  }

  await client.database
    .from('posts')
    .update({ publish_job_id: (inserted as PublishJobRow).id })
    .eq('id', params.postId)
    .eq('user_id', params.userId);

  return { job: inserted as PublishJobRow, duplicate: false };
}

export async function processPublishJob(
  job: PublishJobRow,
  post: Record<string, unknown>
): Promise<PublishJobRow> {
  const client = getServerClient();
  const jobId = job.id;

  await client.database
    .from('publish_jobs')
    .update({
      status: 'processing',
      attempts: job.attempts + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);

  const content =
    (post.caption as string) ||
    (post.script as string) ||
    (post.hook as string) ||
    (post.title as string);

  const payload: PublishPayload = {
    platform: job.platform as SocialPlatform,
    text: content,
    imageUrl: (post.image_url as string) ?? null,
    scheduledAt: job.scheduled_for,
  };

  try {
    const provider = getSocialProvider();
    let result;

    if (provider.name === 'ayrshare') {
      result = await provider.publish(job.user_id, payload);
    } else {
      return {
        ...job,
        status: 'failed',
        last_error: 'Direct publish must run via /api/publish or cron',
      };
    }

    if (!result.success) {
      const attempts = job.attempts + 1;
      const status: PublishJobStatus =
        attempts >= job.max_attempts ? 'dead' : 'failed';

      await client.database
        .from('publish_jobs')
        .update({
          status,
          last_error: result.error ?? 'Publish failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId);

      return { ...job, status, last_error: result.error ?? null, attempts };
    }

    await client.database
      .from('publish_jobs')
      .update({
        status: 'published',
        provider_post_id: result.platformPostId ?? null,
        provider_url: result.url ?? null,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    await client.database
      .from('posts')
      .update({
        status: 'posted',
        posted_date: new Date().toISOString().split('T')[0],
        scheduled_publish_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.post_id)
      .eq('user_id', job.user_id);

    try {
      const { syncBrainPublishedPost } = await import('@/lib/brain/sync');
      await syncBrainPublishedPost(client, job.user_id, job.post_id);
    } catch {
      // Non-critical
    }

    await incrementUsage(job.user_id, 'publish_post', 1);
    logInfo('publish_job.success', { jobId, platform: job.platform });

    return {
      ...job,
      status: 'published',
      provider_post_id: result.platformPostId ?? null,
      provider_url: result.url ?? null,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logError('publish_job.error', { jobId }, err);

    const attempts = job.attempts + 1;
    const status: PublishJobStatus = attempts >= job.max_attempts ? 'dead' : 'failed';

    await client.database
      .from('publish_jobs')
      .update({
        status,
        last_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId);

    return { ...job, status, last_error: message, attempts };
  }
}

export async function listDuePublishJobs(limit = 25): Promise<PublishJobRow[]> {
  const client = getServerClient();
  const now = new Date().toISOString();

  const { data } = await client.database
    .from('publish_jobs')
    .select('*')
    .in('status', ['queued', 'failed'])
    .or(`scheduled_for.is.null,scheduled_for.lte.${now}`)
    .order('created_at', { ascending: true })
    .limit(limit);

  return (data ?? []) as PublishJobRow[];
}

export async function retryPublishJob(jobId: string, userId: string): Promise<boolean> {
  const client = getServerClient();
  const { error } = await client.database
    .from('publish_jobs')
    .update({
      status: 'queued',
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('user_id', userId)
    .in('status', ['failed', 'dead']);

  return !error;
}
