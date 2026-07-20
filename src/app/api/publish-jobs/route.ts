import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { retryPublishJob } from '@/lib/publish-queue';

export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);

  let query = client.database
    .from('publish_jobs')
    .select('id, post_id, platform, status, scheduled_for, attempts, max_attempts, last_error, provider_post_id, provider_url, created_at, updated_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(50);
  if (workspaceId) query = query.eq('workspace_id', workspaceId);

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Publish jobs carry only post_id - pull the post titles in one extra query
  // (InsForge embeds are unreliable here) so the timeline can name each post.
  const jobs = data ?? [];
  const postIds = Array.from(new Set(jobs.map((j) => j.post_id).filter(Boolean)));
  let titleById: Record<string, string | null> = {};
  if (postIds.length > 0) {
    const { data: posts } = await client.database
      .from('posts')
      .select('id, title')
      .in('id', postIds);
    titleById = Object.fromEntries((posts ?? []).map((p) => [p.id, p.title]));
  }
  const withTitles = jobs.map((j) => ({ ...j, title: titleById[j.post_id] ?? null }));

  return NextResponse.json({ jobs: withTitles });
}

const RetrySchema = z.object({
  jobId: z.string().uuid(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = RetrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const ok = await retryPublishJob(parsed.data.jobId, user.id);
  if (!ok) {
    return NextResponse.json({ error: 'Job not found or cannot retry' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
