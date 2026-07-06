import { unipoleFetch, fetchUnipileAccountDetails } from '@/lib/social/unipile';
import { buildPostUrl } from '@/lib/voice-lab/persist-imported-posts';

export type OnboardingPlatform = 'linkedin' | 'twitter';

export interface VoiceSample {
  content: string;
  platform: string;
  sourceUrl?: string;
}

interface UnipilePostItem {
  id?: string;
  text?: string;
  commentary?: string;
  is_repost?: boolean;
  is_reply?: boolean;
}

interface UnipilePostsResponse {
  items?: UnipilePostItem[];
  cursor?: string;
  next_cursor?: string;
}

const PAGE_SIZE = 25;
const MAX_POSTS_PER_PLATFORM = 150;

/**
 * Resolves the provider user ID Unipile expects for /users/{id}/posts.
 * LinkedIn vanity slugs in our DB are not always valid here — enrichment from
 * connection_params.im is required for reliable imports.
 */
export async function resolveProviderUserId(
  unipileAccountId: string,
  storedAccountId: string | null,
): Promise<string | null> {
  try {
    const fullAccount = await fetchUnipileAccountDetails(unipileAccountId);
    const im = fullAccount?.connection_params?.im;
    return (
      im?.memberId ??
      im?.id ??
      im?.objectUrn ??
      im?.publicIdentifier ??
      storedAccountId ??
      null
    );
  } catch {
    return storedAccountId ?? null;
  }
}

/**
 * Paginates Unipile post fetch until cursor exhausted or cap reached.
 * Filters reposts/replies and very short content for voice analysis quality.
 */
export async function fetchPostsFromUnipile(
  providerUserId: string,
  unipileAccountId: string,
  platform: OnboardingPlatform,
  maxPosts = MAX_POSTS_PER_PLATFORM,
): Promise<{ samples: VoiceSample[]; rawItems: UnipilePostItem[] }> {
  const platformLabel = platform === 'linkedin' ? 'LinkedIn' : 'Twitter/X';
  const samples: VoiceSample[] = [];
  const rawItems: UnipilePostItem[] = [];
  let cursor: string | undefined;

  while (samples.length < maxPosts) {
    const params = new URLSearchParams({
      account_id: unipileAccountId,
      limit: String(PAGE_SIZE),
    });
    if (cursor) params.set('cursor', cursor);

    const res = await unipoleFetch(
      `/users/${encodeURIComponent(providerUserId)}/posts?${params.toString()}`,
      { method: 'GET' },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Failed to fetch posts (${res.status}): ${errText.slice(0, 200)}`);
    }

    const json = (await res.json()) as UnipilePostsResponse;
    const items = json.items ?? [];

    for (const item of items) {
      if (item.is_repost || item.is_reply) continue;
      const content = (item.text ?? item.commentary ?? '').trim();
      if (content.length <= 20) continue;

      rawItems.push(item);
      samples.push({
        content,
        platform: platformLabel,
        sourceUrl: item.id ? buildPostUrl(platform, item.id) : undefined,
      });

      if (samples.length >= maxPosts) break;
    }

    const nextCursor = json.next_cursor ?? json.cursor;
    if (!nextCursor || items.length === 0) break;
    cursor = nextCursor;
  }

  return { samples, rawItems };
}

/**
 * Picks up to `limit` samples biased toward longer, more voice-rich posts.
 */
export function selectSamplesForAnalysis(samples: VoiceSample[], limit = 20): VoiceSample[] {
  return [...samples]
    .sort((a, b) => b.content.length - a.content.length)
    .slice(0, limit);
}
