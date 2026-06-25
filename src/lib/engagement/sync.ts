import type { createClient } from '@insforge/sdk';
import {
  ayrshareCommentsAvailable,
  fetchAyrsharePostComments,
  type AyrshareFetchedComment,
} from '@/lib/engagement/ayrshare-comments';
import type {
  ManualSyncComment,
  SyncEngagementInput,
  SyncEngagementResult,
} from '@/lib/engagement/types';

type InsforgeClient = ReturnType<typeof createClient>;

interface PublishJobRow {
  post_id: string;
  platform: string;
  provider_post_id: string;
}

async function resolveParentCommentId(
  client: InsforgeClient,
  userId: string,
  parentProviderId: string | undefined,
): Promise<string | null> {
  if (!parentProviderId) return null;
  const { data } = await client.database
    .from('post_comments')
    .select('id')
    .eq('user_id', userId)
    .eq('provider_comment_id', parentProviderId)
    .limit(1);
  return (data?.[0] as { id: string } | undefined)?.id ?? null;
}

async function upsertComment(
  client: InsforgeClient,
  userId: string,
  row: {
    post_id: string;
    platform: string;
    provider_comment_id: string;
    comment_text: string;
    author_name?: string;
    author_handle?: string;
    author_headline?: string;
    commented_at?: string;
    parent_comment_id?: string | null;
  },
): Promise<'inserted' | 'updated' | 'skipped'> {
  const { data: existing } = await client.database
    .from('post_comments')
    .select('id, comment_text, synced_at')
    .eq('user_id', userId)
    .eq('provider_comment_id', row.provider_comment_id)
    .limit(1);

  const hit = existing?.[0] as { id: string; comment_text: string } | undefined;

  if (hit) {
    if (hit.comment_text === row.comment_text) return 'skipped';
    const { error } = await client.database
      .from('post_comments')
      .update({
        comment_text: row.comment_text,
        author_name: row.author_name ?? null,
        author_handle: row.author_handle ?? null,
        author_headline: row.author_headline ?? null,
        commented_at: row.commented_at ?? null,
        synced_at: new Date().toISOString(),
      })
      .eq('id', hit.id)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
    return 'updated';
  }

  const { error } = await client.database.from('post_comments').insert([
    {
      user_id: userId,
      post_id: row.post_id,
      platform: row.platform,
      provider_comment_id: row.provider_comment_id,
      comment_text: row.comment_text,
      author_name: row.author_name ?? null,
      author_handle: row.author_handle ?? null,
      author_headline: row.author_headline ?? null,
      commented_at: row.commented_at ?? null,
      parent_comment_id: row.parent_comment_id ?? null,
    },
  ]);

  if (error) throw new Error(error.message);
  return 'inserted';
}

async function ingestManualComments(
  client: InsforgeClient,
  userId: string,
  manual: ManualSyncComment[],
): Promise<Pick<SyncEngagementResult, 'inserted' | 'updated' | 'skipped' | 'errors'>> {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const m of manual) {
    try {
      const { data: post } = await client.database
        .from('posts')
        .select('id')
        .eq('id', m.post_id)
        .eq('user_id', userId)
        .limit(1);

      if (!post?.[0]) {
        errors.push(`Post ${m.post_id} not found`);
        continue;
      }

      const parentId = await resolveParentCommentId(
        client,
        userId,
        m.parent_provider_comment_id,
      );

      const result = await upsertComment(client, userId, {
        post_id: m.post_id,
        platform: m.platform,
        provider_comment_id: m.provider_comment_id,
        comment_text: m.comment_text,
        author_name: m.author_name,
        author_handle: m.author_handle,
        author_headline: m.author_headline,
        commented_at: m.commented_at,
        parent_comment_id: parentId,
      });

      if (result === 'inserted') inserted++;
      else if (result === 'updated') updated++;
      else skipped++;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : 'Manual comment sync failed');
    }
  }

  return { inserted, updated, skipped, errors };
}

async function ingestProviderComments(
  client: InsforgeClient,
  userId: string,
  fetched: AyrshareFetchedComment[],
  postId: string,
  defaultPlatform: string,
): Promise<Pick<SyncEngagementResult, 'inserted' | 'updated' | 'skipped' | 'errors'>> {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const c of fetched) {
    try {
      const result = await upsertComment(client, userId, {
        post_id: postId,
        platform: c.platform || defaultPlatform,
        provider_comment_id: c.provider_comment_id,
        comment_text: c.comment_text,
        author_name: c.author_name,
        author_handle: c.author_handle,
        commented_at: c.commented_at,
      });
      if (result === 'inserted') inserted++;
      else if (result === 'updated') updated++;
      else skipped++;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : 'Provider comment upsert failed');
    }
  }

  return { inserted, updated, skipped, errors };
}

/**
 * Sync comments from manual dev payload and/or Ayrshare for published posts.
 */
export async function syncEngagementComments(
  client: InsforgeClient,
  userId: string,
  input: SyncEngagementInput = {},
): Promise<SyncEngagementResult> {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let provider_fetched = 0;
  const errors: string[] = [];

  if (input.manual?.length) {
    const manualResult = await ingestManualComments(client, userId, input.manual);
    inserted += manualResult.inserted;
    updated += manualResult.updated;
    skipped += manualResult.skipped;
    errors.push(...manualResult.errors);
  }

  const shouldFetch =
    input.fetchFromProvider !== false && ayrshareCommentsAvailable();

  if (shouldFetch) {
    let jobsQuery = client.database
      .from('publish_jobs')
      .select('post_id, platform, provider_post_id')
      .eq('user_id', userId)
      .eq('status', 'published')
      .not('provider_post_id', 'is', null);

    if (input.postIds?.length) {
      jobsQuery = jobsQuery.in('post_id', input.postIds);
    }

    const { data: jobs, error: jobsError } = await jobsQuery;
    if (jobsError) {
      errors.push(jobsError.message);
    } else {
      for (const job of (jobs ?? []) as PublishJobRow[]) {
        if (!job.provider_post_id) continue;
        try {
          const fetched = await fetchAyrsharePostComments(
            userId,
            job.provider_post_id,
            job.platform,
          );
          provider_fetched += fetched.length;
          const r = await ingestProviderComments(
            client,
            userId,
            fetched,
            job.post_id,
            job.platform,
          );
          inserted += r.inserted;
          updated += r.updated;
          skipped += r.skipped;
          errors.push(...r.errors);
        } catch (e) {
          errors.push(
            `Post ${job.post_id}: ${e instanceof Error ? e.message : 'Ayrshare fetch failed'}`,
          );
        }
      }
    }
  }

  const synced = inserted + updated;

  // RL training removed from sync — Layer 2 intelligence-sync handles it with real signals.
  // Proxy signals (synced_count / 200) would double-count once L2 nightly cron runs.
  // Lead categorization via bucketEngagers still runs during draftEngagementReplies where
  // it has access to the full comment context. Sync stays fast and single-purpose.

  return {
    synced,
    inserted,
    updated,
    skipped,
    provider_fetched,
    errors,
  };
}
