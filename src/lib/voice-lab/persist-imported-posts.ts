import { randomUUID } from 'crypto';
import type { getServerClient } from '@/lib/insforge/server';
import { buildIdempotencyKey } from '@/lib/publish-queue';
import { metricsPatchFromNormalized, hasPostMetrics } from '@/lib/analytics/post-metrics';
import {
  extractUnipilePostMetrics,
  extractUnipilePublishedAt,
} from '@/lib/platforms/linkedin-metrics';
import { writeToMemory, buildPostMemoryCustomId, buildImageMemoryCustomId } from '@/lib/memory/write';
import { describeImage } from '@/lib/llm';

/** Platforms whose Unipile post payloads carry engagement counters we can read. */
function unipileMetricsSupported(platform: string): boolean {
  return platform === 'linkedin' || platform === 'twitter';
}

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

export interface ImportedImage {
  url: string;
  description: string | null;
}

/** Cap on images described per post - bounds worst-case per-item latency/cost;
 * a post with more photos still keeps its full image list, just undescribed
 * past this count (rare - Unipile posts are almost always 1-4 images). */
const MAX_IMAGES_DESCRIBED = 4;

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

/** Every image attachment URL on a Unipile post (firstImageUrl only ever kept
 * the first, silently discarding the rest). */
export function allImageUrls(item: UnipileItem): string[] {
  return (item.attachments ?? [])
    .filter((a) => a.type === 'img' && Boolean(a.url))
    .map((a) => a.url as string);
}

/**
 * Describes every image on a post (bounded by MAX_IMAGES_DESCRIBED, run
 * concurrently so total latency is ~one vision call, not the sum). Best-effort:
 * describeImage never throws, so a failed/unsupported vision call just leaves
 * that image's description null rather than blocking the import.
 */
async function describeImages(urls: string[]): Promise<ImportedImage[]> {
  const toDescribe = urls.slice(0, MAX_IMAGES_DESCRIBED);
  const described = await Promise.all(
    toDescribe.map(async (url) => ({ url, description: await describeImage(url) })),
  );
  const rest = urls.slice(MAX_IMAGES_DESCRIBED).map((url) => ({ url, description: null }));
  return [...described, ...rest];
}

/**
 * Writes each described image as its OWN memory document (see
 * buildImageMemoryCustomId) rather than only appending it inside the parent
 * post's content - gives every photo an independent shot at surfacing on an
 * image/venue-specific query regardless of how the parent post's other chunks
 * rank for that query.
 */
function pushImageMemoryWrites(
  memoryWrites: Promise<boolean>[],
  client: Parameters<typeof writeToMemory>[0],
  images: ImportedImage[],
  ctx: { userId: string; workspaceId: string | null; platform: string; postId: string; postedDate: string },
): void {
  images.forEach((img, i) => {
    if (!img.description) return;
    memoryWrites.push(
      writeToMemory(client, {
        userId: ctx.userId,
        workspaceId: ctx.workspaceId,
        kind: 'post_image',
        content:
          `[Photo from your ${ctx.platform} post on ${ctx.postedDate || 'unknown date'}] — this ALREADY happened; reference as past.\n\n${img.description}`,
        customId: buildImageMemoryCustomId(ctx.postId, i),
        metadata: { platform: ctx.platform, posted_date: ctx.postedDate },
      }),
    );
  });
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

  // Memory writes are collected and run concurrently after the loop, not awaited
  // per-post. A bulk import can carry ~25 posts; serial awaits would sum their
  // latency (and if the memory store hung, 25x the timeout could blow the import
  // function's budget). Concurrent + awaited-at-end bounds total added time to ~one
  // write. writeToMemory never rejects, so allSettled always resolves.
  const memoryWrites: Promise<boolean>[] = [];

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
        .select('id, views, likes, saves, comments, shares, images')
        .eq('id', existingJob.post_id)
        .eq('user_id', userId)
        .maybeSingle();

      if (existingPost) {
        let repaired = false;

        if (unipileMetricsSupported(platform)) {
          const patch = metricsPatchFromNormalized(extractUnipilePostMetrics(item));
          if (!hasPostMetrics(existingPost) && Object.keys(patch).length > 0) {
            const publishedAt = extractUnipilePublishedAt(item);
            const postPatch: Record<string, string | number> = { ...patch };
            if (publishedAt) postPatch.posted_date = publishedAt.split('T')[0];
            await client.database.from('posts').update(postPatch).eq('id', existingJob.post_id);
            repaired = true;
          }
        }

        // Backfill images on posts imported before multi-image capture existed
        // (firstImageUrl() used to be the only thing kept - the rest of a
        // post's photos were silently discarded).
        const existingImages = (existingPost as { images?: ImportedImage[] }).images ?? [];
        const availableUrls = allImageUrls(item);
        if (existingImages.length === 0 && availableUrls.length > 0) {
          const images = await describeImages(availableUrls);
          await client.database.from('posts').update({ images }).eq('id', existingJob.post_id);
          repaired = true;

          const postedDate = extractUnipilePublishedAt(item)?.split('T')[0] ?? '';
          pushImageMemoryWrites(memoryWrites, client, images, {
            userId, workspaceId, platform, postId: existingJob.post_id, postedDate,
          });
        }

        if (repaired) {
          result.repaired++;
          continue;
        }
        result.skipped++;
        continue;
      }
    }

    // Unipile list payloads often include impression/reaction counters — seed
    // analytics immediately instead of waiting for a later metrics sync.
    const importedMetrics = unipileMetricsSupported(platform)
      ? metricsPatchFromNormalized(extractUnipilePostMetrics(item))
      : {};
    const importedPublishedAt = unipileMetricsSupported(platform)
      ? extractUnipilePublishedAt(item)
      : undefined;
    const images = await describeImages(allImageUrls(item));

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
      // Every image (image_url only ever kept the first), each with a cached
      // one-time vision description so generation can reference what was
      // actually in the photo without re-analyzing it on every draft.
      images,
      platform,
      status: 'posted',
      posted_date: importedPublishedAt?.split('T')[0] ?? new Date().toISOString().split('T')[0],
      ...importedMetrics,
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

    // L3: write imported history into memory so generation can reference posts
    // the user published on LinkedIn/X before they ever used the app. The dated
    // header is what lets a "remember the Forbes event" prompt know the event is
    // in the past instead of echoing the original present-tense post. Awaited so
    // the write is not dropped when this cron/route lambda freezes.
    const postedDate = importedPublishedAt?.split('T')[0] ?? '';
    memoryWrites.push(
      writeToMemory(client, {
        userId,
        workspaceId,
        kind: 'imported_post',
        content: `[Your ${platform} post from ${postedDate || 'unknown date'}] — this ALREADY happened; reference as past.\n\n${content}`,
        // item.id is the platform URN — same key the publish path uses so a
        // natively-published post and its later re-import never double-write.
        customId: buildPostMemoryCustomId(platform, item.id, postId),
        metadata: { platform, posted_date: postedDate },
      }),
    );
    pushImageMemoryWrites(memoryWrites, client, images, { userId, workspaceId, platform, postId, postedDate });
  }

  // Await all memory writes concurrently before returning so nothing is dropped
  // when the serverless function freezes, while keeping total added latency ~= one
  // write rather than the sum.
  await Promise.allSettled(memoryWrites);

  return result;
}
