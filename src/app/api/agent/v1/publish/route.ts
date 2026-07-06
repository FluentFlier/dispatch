import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import {
  assertAgentScope,
  getWorkspaceHint,
  resolveAgentAuth,
  resolveAgentWorkspaceId,
} from '@/lib/agent-auth/context';
import { assertCanPublish } from '@/lib/entitlements';
import { getSocialProviderMode } from '@/lib/env';
import { enqueuePublishJob, processPublishJob } from '@/lib/publish-queue';
import { incrementUsage } from '@/lib/usage';
import { trackEvent } from '@/lib/analytics';
import { z } from 'zod';

const PublishSchema = z.object({
  postId: z.string().uuid().optional(),
  platform: z.enum(['twitter', 'linkedin', 'instagram', 'threads']),
  content: z.string().min(1).max(25000),
  caption: z.string().max(25000).optional(),
  imageUrl: z.string().url().optional(),
  scheduledAt: z.string().datetime().optional(),
});

/**
 * POST /api/agent/v1/publish — publish or schedule a post (requires publish scope).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await resolveAgentAuth(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const scopeErr = assertAgentScope(auth, 'publish');
  if (scopeErr) return NextResponse.json({ error: scopeErr }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = PublishSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const entitlementCheck = await assertCanPublish(auth.userId);
  if (!entitlementCheck.ok) {
    return NextResponse.json(
      { error: entitlementCheck.error, entitlements: entitlementCheck.entitlements },
      { status: 402 },
    );
  }

  const { postId, platform, content, caption, imageUrl, scheduledAt } = parsed.data;

  if (platform === 'instagram' && !imageUrl) {
    return NextResponse.json({ error: 'Instagram requires an imageUrl' }, { status: 400 });
  }

  if (getSocialProviderMode() !== 'unipile') {
    return NextResponse.json(
      { error: 'Agent publish requires Unipile social provider mode' },
      { status: 503 },
    );
  }

  const client = getServiceClient();
  const workspaceId = await resolveAgentWorkspaceId(auth.userId, getWorkspaceHint(request));
  const publishContent = caption || content;
  const resolvedPostId = postId ?? randomUUID();

  if (!postId) {
    await client.database.from('posts').insert([
      {
        id: resolvedPostId,
        user_id: auth.userId,
        workspace_id: workspaceId ?? null,
        title: publishContent.slice(0, 80),
        pillar: 'general',
        platform,
        status: 'edited',
        caption: publishContent,
        script: publishContent,
        image_url: imageUrl ?? null,
        scheduled_publish_at: scheduledAt ?? null,
      },
    ]);
  } else if (scheduledAt) {
    await client.database
      .from('posts')
      .update({ scheduled_publish_at: scheduledAt })
      .eq('id', postId)
      .eq('user_id', auth.userId);
  }

  const { job, duplicate, error: enqueueError } = await enqueuePublishJob({
    userId: auth.userId,
    postId: resolvedPostId,
    platform,
    scheduledFor: scheduledAt ?? null,
    provider: 'unipile',
  });

  if (!job) {
    return NextResponse.json({ error: enqueueError ?? 'Failed to enqueue' }, { status: 500 });
  }

  if (scheduledAt) {
    await incrementUsage(auth.userId, 'scheduled_post', 1);
    return NextResponse.json({
      success: true,
      queued: true,
      jobId: job.id,
      duplicate,
      status: 'queued',
      postId: resolvedPostId,
    });
  }

  const { data: postRows } = await client.database
    .from('posts')
    .select('*')
    .eq('id', resolvedPostId)
    .eq('user_id', auth.userId)
    .limit(1);

  const post = postRows?.[0] as Record<string, unknown> | undefined;
  if (!post) {
    return NextResponse.json({ error: 'Post not found' }, { status: 404 });
  }

  const updated = await processPublishJob(job, post);
  if (updated.status !== 'published') {
    await trackEvent('publish_failed', { platform, userId: auth.userId, jobId: job.id, via: 'agent_api' });
    return NextResponse.json(
      { error: updated.last_error ?? 'Publishing failed', jobId: job.id, status: updated.status },
      { status: 500 },
    );
  }

  await incrementUsage(auth.userId, 'publish_post', 1);
  await trackEvent('first_publish_success', { platform, userId: auth.userId, provider: 'agent_api' });

  return NextResponse.json({
    success: true,
    jobId: job.id,
    postId: resolvedPostId,
    status: updated.status,
    provider_post_id: updated.provider_post_id,
    provider_url: updated.provider_url,
  });
}
