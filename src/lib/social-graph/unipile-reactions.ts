import { unipileCommentsAvailable } from '@/lib/engagement/unipile-comments';
import { getServerClient } from '@/lib/insforge/server';
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

async function getUnipileAccountId(userId: string, platform: string): Promise<string | null> {
  const client = getServerClient();
  const normalized =
    platform.toLowerCase() === 'x' || platform.toLowerCase() === 'twitter_v2'
      ? 'twitter'
      : platform.toLowerCase();
  const { data } = await client.database
    .from('social_accounts')
    .select('unipile_account_id')
    .eq('user_id', userId)
    .eq('platform', normalized)
    .not('unipile_account_id', 'is', null)
    .limit(1)
    .maybeSingle();
  return (data?.unipile_account_id as string) ?? null;
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

  const params = new URLSearchParams({
    account_id: accountId,
    limit: String(Math.min(opts.limit ?? 100, 100)),
  });

  const res = await fetch(
    `${getUnipileBase()}/posts/${encodeURIComponent(socialPostId)}/reactions?${params}`,
    {
      headers: {
        'X-API-KEY': apiKey,
        accept: 'application/json',
      },
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Unipile reactions failed: ${res.status} ${body.slice(0, 200)}`);
  }

  const json = await res.json();
  const reactions = extractReactions(json);
  await setCachedRead(cacheKey, reactions);
  return reactions;
}

export { unipileCommentsAvailable as socialGraphAvailable };
