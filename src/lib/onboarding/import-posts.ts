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
  content?: string;
  body?: string;
  title?: string;
  is_repost?: boolean;
  is_reply?: boolean;
  attachments?: Array<{
    type?: string;
    url?: string;
  }>;
}

interface UnipilePostsResponse {
  items?: UnipilePostItem[];
  cursor?: string;
  next_cursor?: string;
}

const PAGE_SIZE = 25;
const MAX_POSTS_PER_PLATFORM = 150;

export interface FetchPostsResult {
  samples: VoiceSample[];
  rawItems: UnipilePostItem[];
  fetchedCount: number;
  filteredCount: number;
}

function postText(item: UnipilePostItem): string {
  return String(
    item.text ??
    item.commentary ??
    item.content ??
    item.body ??
    item.title ??
    '',
  ).trim();
}

/**
 * Resolves the provider user ID Unipile expects for /users/{id}/posts.
 * LinkedIn vanity slugs in our DB are not always valid here — enrichment from
 * connection_params.im is required for reliable imports.
 */
export async function resolveProviderUserId(
  unipileAccountId: string,
  storedAccountId: string | null,
): Promise<string | null> {
  const ids = await resolveProviderUserIds(unipileAccountId, storedAccountId);
  return ids[0] ?? null;
}

function uniq(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((v) => v?.trim()).filter(Boolean) as string[]));
}

function urnTail(value?: string): string | null {
  if (!value?.includes(':')) return null;
  return value.split(':').filter(Boolean).at(-1) ?? null;
}

export async function resolveProviderUserIds(
  unipileAccountId: string,
  storedAccountId: string | null,
): Promise<string[]> {
  try {
    const fullAccount = await fetchUnipileAccountDetails(unipileAccountId);
    const im = fullAccount?.connection_params?.im;
    return uniq([
      im?.publicIdentifier,
      im?.memberId,
      im?.id,
      urnTail(im?.objectUrn),
      im?.objectUrn,
      urnTail(im?.entityUrn),
      im?.entityUrn,
      storedAccountId,
    ]);
  } catch {
    return storedAccountId ? [storedAccountId] : [];
  }
}

/**
 * Paginates Unipile post fetch until cursor exhausted or cap reached.
 * Filters reposts/replies and very short content for voice analysis quality.
 */
export async function fetchPostsFromUnipile(
  providerUserId: string | string[],
  unipileAccountId: string,
  platform: OnboardingPlatform,
  maxPosts = MAX_POSTS_PER_PLATFORM,
): Promise<FetchPostsResult> {
  const providerUserIds = Array.isArray(providerUserId) ? providerUserId : [providerUserId];
  let lastError: Error | null = null;
  let bestEmptyResult: FetchPostsResult | null = null;

  for (const candidate of providerUserIds) {
    try {
      const result = await fetchPostsForProviderUser(candidate, unipileAccountId, platform, maxPosts);
      if (result.samples.length > 0 || result.rawItems.length > 0 || result.fetchedCount > 0) return result;
      bestEmptyResult = result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error('Failed to fetch posts');
    }
  }

  if (lastError && !bestEmptyResult && providerUserIds.length > 0) throw lastError;
  return bestEmptyResult ?? { samples: [], rawItems: [], fetchedCount: 0, filteredCount: 0 };
}

async function fetchPostsForProviderUser(
  providerUserId: string,
  unipileAccountId: string,
  platform: OnboardingPlatform,
  maxPosts: number,
): Promise<FetchPostsResult> {
  const platformLabel = platform === 'linkedin' ? 'LinkedIn' : 'Twitter/X';
  const samples: VoiceSample[] = [];
  const rawItems: UnipilePostItem[] = [];
  let cursor: string | undefined;
  let fetchedCount = 0;
  let filteredCount = 0;

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
    fetchedCount += items.length;

    for (const item of items) {
      if (item.is_repost || item.is_reply) {
        filteredCount++;
        continue;
      }
      const content = postText(item);
      if (content.length <= 20) {
        filteredCount++;
        continue;
      }

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

  return { samples, rawItems, fetchedCount, filteredCount };
}

/**
 * Picks up to `limit` samples biased toward longer, more voice-rich posts.
 */
export function selectSamplesForAnalysis(samples: VoiceSample[], limit = 20): VoiceSample[] {
  return [...samples]
    .sort((a, b) => b.content.length - a.content.length)
    .slice(0, limit);
}
