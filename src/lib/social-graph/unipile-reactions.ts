import { unipileCommentsAvailable } from '@/lib/engagement/unipile-comments';
import { buildPostIdCandidates } from '@/lib/engagement/unipile-reactions';
import { getUnipileAccountId } from '@/lib/engagement/unipile-comments';
import { retryWithBackoff, throwIfNotOk, HttpStatusError } from '@/lib/social/reliability';
import type { PostReaction } from '@/lib/social-graph/types';
import {
  getCachedRead,
  reactionsCacheKey,
  setCachedRead,
} from '@/lib/social-graph/read-cache';

function getUnipileBase(): string {
  const dsn = process.env.UNIPILE_DSN;
  if (!dsn) throw new Error('UNIPILE_DSN is not configured');
  return `https://${dsn.replace(/\/$/, '')}/api/v1`;
}

function extractReactions(json: unknown): PostReaction[] {
  if (!json || typeof json !== 'object') return [];
  const root = json as Record<string, unknown>;
  const items: unknown[] = Array.isArray(root.items)
    ? root.items
    : Array.isArray(root.data)
      ? root.data
      : [];

  const out: PostReaction[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const author = (row.author as Record<string, unknown> | undefined) ?? row;
    const name =
      (author.name as string) ??
      (author.display_name as string) ??
      (([author.first_name, author.last_name].filter(Boolean).join(' ')) || undefined);

    out.push({
      providerProfileId: String(author.id ?? author.provider_id ?? row.user_id ?? '') || undefined,
      publicIdentifier: (author.public_identifier as string) ?? (author.publicIdentifier as string),
      displayName: name,
      headline: (author.headline as string) ?? undefined,
      profileUrl: (author.profile_url as string) ?? (author.profileUrl as string),
      reactionType: String(row.reaction_type ?? row.type ?? row.value ?? 'like'),
    });
  }
  return out.filter((r) => r.displayName || r.publicIdentifier || r.providerProfileId);
}

/**
 * List reactions on a published post via Unipile (with 15m read cache).
 */
export async function fetchPostReactions(
  userId: string,
  socialPostId: string,
  platform: string,
  opts: { bypassCache?: boolean; limit?: number } = {},
): Promise<PostReaction[]> {
  if (!unipileCommentsAvailable()) return [];

  const cacheKey = reactionsCacheKey(userId, socialPostId, platform);
  if (!opts.bypassCache) {
    const cached = await getCachedRead<PostReaction[]>(cacheKey);
    if (cached) return cached;
  }

  const apiKey = process.env.UNIPILE_API_KEY;
  if (!apiKey) return [];

  const accountId = await getUnipileAccountId(userId, platform);
  if (!accountId) return [];

  const limit = String(Math.min(opts.limit ?? 100, 100));

  // LinkedIn post ids surface in several URN flavors and Unipile only accepts
  // the one the post was indexed under. Try each candidate in order, treating a
  // 404/422 as "wrong format, try the next" so one id-format mismatch no longer
  // silently drops every engager for a post.
  let lastError: unknown = null;
  for (const candidate of buildPostIdCandidates(socialPostId)) {
    const params = new URLSearchParams({ account_id: accountId, limit });
    try {
      const res = await retryWithBackoff(async () =>
        throwIfNotOk(
          await fetch(
            `${getUnipileBase()}/posts/${encodeURIComponent(candidate)}/reactions?${params}`,
            { headers: { 'X-API-KEY': apiKey, accept: 'application/json' } },
          ),
          'Unipile get reactions',
        ),
      );
      const reactions = extractReactions(await res.json());
      await setCachedRead(cacheKey, reactions);
      return reactions;
    } catch (error) {
      lastError = error;
      if (error instanceof HttpStatusError && (error.status === 404 || error.status === 422)) {
        continue;
      }
      throw error;
    }
  }

  // Every candidate 404'd - the post has no indexable reactions (or was
  // deleted). Cache the empty result so we don't retry the dead post each pass.
  if (lastError instanceof HttpStatusError && (lastError.status === 404 || lastError.status === 422)) {
    await setCachedRead(cacheKey, []);
    return [];
  }
  throw lastError ?? new Error('Unipile get reactions failed');
}

export { unipileCommentsAvailable as socialGraphAvailable };
