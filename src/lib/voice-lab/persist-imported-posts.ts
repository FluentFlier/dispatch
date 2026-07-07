import { randomUUID } from 'crypto';
import type { getServerClient } from '@/lib/insforge/server';
import { buildIdempotencyKey } from '@/lib/publish-queue';

// Extracted from the import-from-account route so it can be unit-tested
// directly. Next.js route modules may only export HTTP handlers, so this
// fire-and-forget persistence helper lives here instead.

/** One media attachment on a Unipile post (LinkedIn returns type 'img' with a url). */
export interface UnipileAttachment {
  type?: string;
  url?: string;
}

export interface UnipileItem {
  id?: string;
  text?: string;
  commentary?: string;
  content?: string;
  body?: string;
  title?: string;
  provider?: string;
  is_repost?: boolean;
  is_reply?: boolean;
  attachments?: UnipileAttachment[];
}

export interface PersistImportedPostsResult {
  created: number;
  repaired: number;
  skipped: number;
  failed: number;
}

function importedPostText(item: UnipileItem): string {
  return String(
    item.text ??
    item.commentary ??
    item.content ??
    item.body ??
    item.title ??
    '',
  ).trim();
}

/** Builds the canonical public post URL for a Unipile-imported post. */
export function buildPostUrl(platform: string, postId: string): string {
  if (platform === 'linkedin') {
    return `https://www.linkedin.com/feed/update/${postId}/`;
  }
  return `https://x.com/i/web/status/${postId}`;
}

/**
 * Returns the first image attachment URL on a Unipile post, or null. Imported
 * posts carried only their text before this; without the image the reconstructed
 * post looked blank/plain versus the original LinkedIn post.
 */
export function firstImageUrl(item: UnipileItem): string | null {
  const img = item.attachments?.find((a) => a.type === 'img' && Boolean(a.url));
  return img?.url ?? null;
}

/**
 * Persists Unipile-imported posts + publish_jobs rows so the engagement-sync
 * cron can call Unipile GET /posts/{social_id}/comments for each one.
 * Skips any post already tracked (idempotent by idempotency_key).
 */
export async function persistImportedPosts({
  client,
  userId,
  workspaceId,
  platform,
  items,
}: {
  client: ReturnType<typeof getServerClient>;
  userId: string;
  workspaceId: string | null;
  platform: string;
  items: UnipileItem[];
}): Promise<PersistImportedPostsResult> {
  const result: PersistImportedPostsResult = { created: 0, repaired: 0, skipped: 0, failed: 0 };

  for (const item of items) {
    if (!item.id) continue;
    const content = importedPostText(item);
    if (!content) {
      result.failed++;
      continue;
    }
    const idempotencyKey = buildIdempotencyKey(userId, item.id, platform, null);

    const { data: existingJobs } = await client.database
      .from('publish_jobs')
      .select('id, post_id')
      .eq('idempotency_key', idempotencyKey)
      .limit(1);

    const existingJob = existingJobs?.[0] as { id: string; post_id: string } | undefined;
    if (existingJob?.post_id) {
      const { data: existingPost } = await client.database
        .from('posts')
        .select('id')
        .eq('id', existingJob.post_id)
        .eq('user_id', userId)
        .maybeSingle();

      if (existingPost) {
        result.skipped++;
        continue;
      }
    }

    // Create a posts row for this historically-published post
    const postId = randomUUID();
    const { error: postErr } = await client.database.from('posts').insert([{
      id: postId,
      user_id: userId,
      workspace_id: workspaceId,
      title: content.slice(0, 80),
      script: content,
      // posts.pillar is NOT NULL with no default; imported historical posts
      // aren't authored against a pillar, so seed the codebase-wide 'general'
      // fallback (same value used by auto-generate/publish) to satisfy the
      // constraint instead of silently dropping every imported post.
      // Set BOTH pillar (primary) and pillars[] (array): the Library and Calendar
      // views filter on pillars[], so an empty array makes imported posts invisible.
      pillar: 'general',
      pillars: ['general'],
      // Carry the first image so the reconstructed post shows media, not just text.
      image_url: firstImageUrl(item),
      platform,
      status: 'posted',
      posted_date: new Date().toISOString().split('T')[0],
    }]);

    if (postErr) {
      console.warn('[import-from-account] post insert failed:', postErr.message);
      result.failed++;
      continue;
    }

    const jobPayload = {
      user_id: userId,
      workspace_id: workspaceId,
      post_id: postId,
      platform,
      status: 'published',
      provider: 'unipile',
      provider_post_id: item.id,
      provider_url: buildPostUrl(platform, item.id),
      idempotency_key: idempotencyKey,
      attempts: 1,
      max_attempts: 3,
      scheduled_for: null,
      last_error: null,
    };

    const { error: jobErr } = existingJob
      ? await client.database
        .from('publish_jobs')
        .update({ ...jobPayload, updated_at: new Date().toISOString() })
        .eq('id', existingJob.id)
      : await client.database.from('publish_jobs').insert([jobPayload]);

    if (jobErr) {
      console.warn('[import-from-account] publish_job insert failed:', jobErr.message);
      result.failed++;
      continue;
    }

    if (existingJob) result.repaired++;
    else result.created++;
  }

  return result;
}
