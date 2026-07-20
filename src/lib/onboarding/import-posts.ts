import {
  unipoleFetch,
  fetchUnipileAccountDetails,
  listUnipileAccounts,
  type UnipileFullAccount,
} from '@/lib/social/unipile';
import { buildPostUrl } from '@/lib/voice-lab/persist-imported-posts';

export type OnboardingPlatform = 'linkedin' | 'twitter';

export interface VoiceSample {
  content: string;
  platform: string;
  sourceUrl?: string;
}


/**
 * The post a repost was built on. Unipile nests it under `repost_content`;
 * without it an imported repost is the creator's commentary with no subject.
 */
export interface UnipileRepostContent {
  id?: string;
  text?: string;
  date?: string;
  parsed_datetime?: string;
  author?: {
    name?: string;
    public_identifier?: string;
    id?: string;
    is_company?: boolean;
  };
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
  repost_content?: UnipileRepostContent;
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
 * LinkedIn vanity slugs in our DB are not always valid here - enrichment from
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

type UnipileIm = NonNullable<NonNullable<UnipileFullAccount['connection_params']>['im']>;

function normalizedIdentity(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  let token = trimmed;
  if (/^https?:\/\//i.test(token) || token.includes('linkedin.com/')) {
    try {
      const url = new URL(token.startsWith('http') ? token : `https://${token}`);
      token = url.pathname.split('/').filter(Boolean).at(-1) ?? token;
    } catch {
      token = token.replace(/\/+$/, '');
    }
  }

  return token.replace(/^@/, '').replace(/\/+$/, '').toLowerCase();
}

export function identityVariants(value?: string | null): string[] {
  return uniq([value, urnTail(value ?? undefined)])
    .map(normalizedIdentity)
    .filter(Boolean) as string[];
}

/**
 * Extract every candidate provider user id from an account's connection_params.im.
 *
 * Prefer LinkedIn member ids (ACo…/ADo…) over vanity publicIdentifiers - Unipile's
 * GET /users/{id}/posts often 422s ("invalid_recipient") on vanity slugs even when
 * the profile is valid, which previously made analytics list-backfill return empty.
 */
function imToProviderIds(im: UnipileIm | undefined, storedAccountId: string | null): string[] {
  return uniq([
    im?.id,
    im?.memberId,
    urnTail(im?.objectUrn),
    im?.objectUrn,
    urnTail(im?.entityUrn),
    im?.entityUrn,
    im?.publicIdentifier,
    storedAccountId,
  ]);
}

function accountIdentityTokens(account: UnipileFullAccount): Set<string> {
  const im = account.connection_params?.im;
  return new Set(
    [
      account.username,
      im?.id,
      im?.memberId,
      im?.objectUrn,
      im?.entityUrn,
      im?.publicIdentifier,
    ].flatMap(identityVariants),
  );
}

function accountMatchesStoredIdentity(account: UnipileFullAccount, storedAccountId: string | null): boolean {
  const storedTokens = identityVariants(storedAccountId);
  if (storedTokens.length === 0) return true;

  const accountTokens = accountIdentityTokens(account);
  return storedTokens.some((token) => accountTokens.has(token));
}

export async function resolveProviderUserIds(
  unipileAccountId: string,
  storedAccountId: string | null,
): Promise<string[]> {
  try {
    const fullAccount = await fetchUnipileAccountDetails(unipileAccountId);
    return imToProviderIds(fullAccount?.connection_params?.im, storedAccountId);
  } catch {
    return storedAccountId ? [storedAccountId] : [];
  }
}

export interface ResolvedUnipileTarget {
  /** The CURRENT Unipile account id (may differ from the stored one after rotation). */
  unipileAccountId: string;
  /** Ordered candidate provider user ids for GET /users/{id}/posts. */
  providerUserIds: string[];
  /** True when the stored id was stale and we recovered a new one - caller should persist. */
  refreshed: boolean;
}

/** True if a Unipile account's type matches our canonical platform name. */
function accountMatchesPlatform(account: UnipileFullAccount, platform: OnboardingPlatform): boolean {
  const type = (account.type ?? '').toLowerCase();
  if (platform === 'linkedin') return type === 'linkedin';
  return type === 'twitter' || type === 'x' || type === 'twitter_v2';
}

/**
 * Resolves the account to import from, self-healing a rotated unipile_account_id.
 *
 * Unipile re-issues `account.id` whenever a LinkedIn credential session re-auths,
 * so the id cached in social_accounts goes stale and GET /accounts/{id} 404s -
 * which previously surfaced to users as a spurious "disconnect and reconnect".
 * Instead we re-list accounts and match on the STABLE identity (publicIdentifier /
 * member id / username, captured in storedAccountId) to recover the live id.
 */
export async function resolveUnipileTarget(
  unipileAccountId: string,
  storedAccountId: string | null,
  platform: OnboardingPlatform,
): Promise<ResolvedUnipileTarget | null> {
  // 1. Stored id still valid - the common, fast path.
  const full = await fetchUnipileAccountDetails(unipileAccountId);
  if (full && accountMatchesPlatform(full, platform) && accountMatchesStoredIdentity(full, storedAccountId)) {
    return {
      unipileAccountId,
      providerUserIds: imToProviderIds(full.connection_params?.im, storedAccountId),
      refreshed: false,
    };
  }

  // 2. Stale id - re-resolve by stable identity against the live account list.
  if (!storedAccountId) return null;
  const accounts = await listUnipileAccounts();
  const match = accounts.find((account) => {
    if (!accountMatchesPlatform(account, platform)) return false;
    return accountMatchesStoredIdentity(account, storedAccountId);
  });

  if (!match) return null;
  return {
    unipileAccountId: match.id,
    providerUserIds: imToProviderIds(match.connection_params?.im, storedAccountId),
    refreshed: match.id !== unipileAccountId,
  };
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
      // Reposts are the creator's own commentary on someone else's post, and
      // that commentary is their voice - dropping them silently lost a large
      // slice of the account. Unipile puts the commentary in the item's own
      // text and the reshared body in a nested object we never read, so a bare
      // no-commentary reshare falls out of the length guard below on its own.
      // Replies stay excluded: they are conversation, not posts.
      if (item.is_reply) {
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
