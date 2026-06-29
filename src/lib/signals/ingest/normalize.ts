import type { IngestedPost, SignalPlatform } from '@/lib/signals/types';

export function apifyItemToPost(
  item: Record<string, unknown>,
  platform: SignalPlatform,
  fallbackHandle: string,
): IngestedPost | null {
  const text = String(item.text ?? item.fullText ?? item.caption ?? '').trim();
  if (!text || text.length < 20) return null;

  const author =
    (item.author as { userName?: string; name?: string; username?: string } | undefined) ??
    (item.owner as { username?: string; userName?: string } | undefined);
  const authorHandle =
    author?.userName ?? author?.username ?? item.ownerUsername ?? fallbackHandle;
  const authorName =
    author && 'name' in author && author.name ? String(author.name) : undefined;
  const externalId = String(item.id ?? item.postId ?? `${Date.now()}-${authorHandle}`);

  let postUrl: string | undefined;
  if (platform === 'x') {
    postUrl = `https://x.com/${String(authorHandle).replace(/^@/, '')}/status/${externalId}`;
  } else if (item.url) {
    postUrl = String(item.url);
  }

  return {
    platform,
    externalPostId: externalId,
    authorHandle: String(authorHandle).replace(/^@/, ''),
    authorName: authorName ? String(authorName) : undefined,
    content: text,
    postUrl,
    postedAt: item.createdAt ? String(item.createdAt) : undefined,
    rawPayload: item,
  };
}

export function unipileItemToPost(
  item: Record<string, unknown>,
  platform: SignalPlatform,
  fallbackHandle: string,
): IngestedPost | null {
  const text = String(item.text ?? item.commentary ?? '').trim();
  if (!text || text.length < 20) return null;
  if (item.is_repost === true || item.is_reply === true) return null;

  const externalId = String(item.id ?? item.post_id ?? `${Date.now()}`);
  const authorHandle = fallbackHandle.replace(/^@/, '');

  let postUrl: string | undefined;
  if (platform === 'linkedin') {
    postUrl = `https://www.linkedin.com/feed/update/${encodeURIComponent(externalId)}/`;
  } else {
    postUrl = `https://x.com/i/web/status/${externalId}`;
  }

  return {
    platform,
    externalPostId: externalId,
    authorHandle,
    authorName: item.author_name ? String(item.author_name) : undefined,
    content: text,
    postUrl,
    postedAt: item.date ? String(item.date) : undefined,
    rawPayload: item,
  };
}

export function filterPostsSinceCursor(
  posts: IngestedPost[],
  lastSeenId: string | undefined,
  maxItems: number,
): IngestedPost[] {
  const capped = posts.slice(0, maxItems);
  if (!lastSeenId) return capped;

  const idx = capped.findIndex((p) => p.externalPostId === lastSeenId);
  if (idx <= 0) {
    // idx === 0: nothing new; idx === -1: cursor missing — take conservative slice
    return idx === 0 ? [] : capped.slice(0, Math.min(3, maxItems));
  }
  return capped.slice(0, idx);
}

export function newestPostId(posts: IngestedPost[]): string | undefined {
  return posts[0]?.externalPostId;
}
