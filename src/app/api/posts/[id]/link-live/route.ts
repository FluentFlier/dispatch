import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { parseLinkedInPostTarget } from '@/lib/engagement/post-url';
import { errorResponse } from '@/lib/api-errors';

const BodySchema = z.object({ url: z.string().min(1).max(500) });

/** Extract the numeric tweet id from an X/Twitter status URL or a bare id. */
function parseXPostId(input: string): string | null {
  const t = input.trim();
  const m = t.match(/status(?:es)?\/(\d{5,25})/i);
  if (m) return m[1];
  if (/^\d{5,25}$/.test(t)) return t;
  return null;
}

/**
 * POST /api/posts/:id/link-live
 * Links a posted post to its live URL on the platform so its comments and
 * reactions can sync. Old posts (created/imported without going through the
 * app's publisher) have no publish_jobs row, so engagement sync -- which walks
 * publish_jobs by provider_post_id -- never reaches them. This resolves the
 * provider post id from a pasted URL and upserts the missing publish_jobs row.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'A post URL is required.' }, { status: 400 });
  }

  try {
    const client = getServerClient();
    // Explicit columns (InsForge select('*') + .eq() quirk).
    const { data: postRows } = await client.database
      .from('posts')
      .select('id, platform, publish_job_id, status, posted_date')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .limit(1);
    const post = postRows?.[0] as
      | { id: string; platform: string; publish_job_id: string | null; status: string; posted_date: string | null }
      | undefined;
    if (!post) return NextResponse.json({ error: 'Post not found' }, { status: 404 });

    const isX = post.platform === 'twitter' || post.platform === 'x';
    const providerPostId = isX ? parseXPostId(parsed.data.url) : parseLinkedInPostTarget(parsed.data.url);
    if (!providerPostId) {
      return NextResponse.json(
        { error: `That does not look like a ${isX ? 'X/Twitter' : 'LinkedIn'} post URL.` },
        { status: 422 },
      );
    }

    const nowIso = new Date().toISOString();
    const jobPayload = {
      user_id: user.id,
      post_id: post.id,
      platform: post.platform,
      status: 'published',
      provider: 'unipile',
      provider_post_id: providerPostId,
      provider_url: parsed.data.url.trim(),
      workspace_id: workspaceId,
      updated_at: nowIso,
    };

    // Reuse the existing job row if one is already attached; else create it.
    let jobId = post.publish_job_id;
    if (jobId) {
      await client.database.from('publish_jobs').update(jobPayload).eq('id', jobId);
    } else {
      const { data: inserted, error } = await client.database
        .from('publish_jobs')
        .insert([{ ...jobPayload, created_at: nowIso }])
        .select('id');
      if (error) throw error;
      jobId = (inserted?.[0] as { id: string } | undefined)?.id ?? null;
    }

    // A linked live post is, by definition, posted.
    await client.database
      .from('posts')
      .update({
        publish_job_id: jobId,
        status: 'posted',
        posted_date: post.posted_date ?? nowIso.slice(0, 10),
      })
      .eq('id', post.id);

    return NextResponse.json({ ok: true, provider_post_id: providerPostId });
  } catch (err) {
    return errorResponse('Could not link the post.', 500, err);
  }
}
