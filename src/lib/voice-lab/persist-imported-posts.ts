import { randomUUID } from 'crypto';
import type { getServerClient } from '@/lib/insforge/server';
import { buildIdempotencyKey } from '@/lib/publish-queue';

// Extracted from the import-from-account route so it can be unit-tested
// directly. Next.js route modules may only export HTTP handlers, so this
// fire-and-forget persistence helper lives here instead.

export interface UnipileItem {
  id?: string;
  text?: string;
  commentary?: string;
  provider?: string;
  is_repost?: boolean;
  is_reply?: boolean;
}

/** Builds the canonical public post URL for a Unipile-imported post. */
export function buildPostUrl(platform: string, postId: string): string {
  if (platform === 'linkedin') {
    return `https://www.linkedin.com/feed/update/${postId}/`;
  }
  return `https://x.com/i/web/status/${postId}`;
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
}): Promise<void> {
  for (const item of items) {
    if (!item.id) continue;
    const content = (item.text ?? item.commentary ?? '').trim();
    const idempotencyKey = buildIdempotencyKey(userId, item.id, platform, null);

    // Skip if already tracked
    const { data: existing } = await client.database
      .from('publish_jobs')
      .select('id')
      .eq('idempotency_key', idempotencyKey)
      .limit(1);

    if (existing?.[0]) continue;

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
      platform,
      status: 'posted',
      posted_date: new Date().toISOString().split('T')[0],
    }]);

    if (postErr) {
      console.warn('[import-from-account] post insert failed:', postErr.message);
      continue;
    }

    // Create the publish_job row with provider_post_id so comments sync works
    const { error: jobErr } = await client.database.from('publish_jobs').insert([{
      user_id: userId,
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
    }]);

    if (jobErr) {
      console.warn('[import-from-account] publish_job insert failed:', jobErr.message);
    }
  }
}
