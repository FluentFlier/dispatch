import { getServerClient } from '@/lib/insforge/server';
import { buildPostIdCandidates } from '@/lib/engagement/unipile-reactions';
import { resolveUnipileTarget, type OnboardingPlatform } from '@/lib/onboarding/import-posts';
import { HttpStatusError, retryWithBackoff, throwIfNotOk } from '@/lib/social/reliability';

/**
 * Unified comment fetched from Unipile's GET /posts/{social_id}/comments endpoint.
 */
export interface UnipileFetchedComment {
  provider_comment_id: string;
  comment_text: string;
  platform: string;
  author_name?: string;
  author_handle?: string;
  author_headline?: string;
  commented_at?: string;
}

function getUnipileBase(): string {
  const dsn = process.env.UNIPILE_DSN;
  if (!dsn) throw new Error('UNIPILE_DSN is not configured');
  return `https://${dsn.replace(/\/$/, '')}/api/v1`;
}

function getApiKey(): string | null {
  return process.env.UNIPILE_API_KEY ?? null;
}

async function unipoleFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const key = getApiKey();
  if (!key) throw new Error('UNIPILE_API_KEY is not configured');
  return fetch(`${getUnipileBase()}${path}`, {
    ...options,
    headers: {
      'X-API-KEY': key,
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    },
  });
}

function normalizePlatform(p: string): string {
  const n = p.toLowerCase();
  if (n === 'x' || n === 'twitter_v2') return 'twitter';
  return n;
}

export function extractComments(json: unknown, fallbackPlatform: string): UnipileFetchedComment[] {
  if (!json || typeof json !== 'object') return [];
  const root = json as Record<string, unknown>;

  const candidates: unknown[] = [];
  if (Array.isArray(root.items)) candidates.push(...root.items);
  if (Array.isArray(root.data)) candidates.push(...root.data);
  if (Array.isArray(root.comments)) candidates.push(...root.comments);

  const out: UnipileFetchedComment[] = [];
  for (const item of candidates) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;

    const id = String(c.id ?? c.comment_id ?? c.commentId ?? '');
    const text = String(c.text ?? c.comment ?? c.message ?? '');
    if (!id || !text) continue;

    const platform = normalizePlatform(
      String(c.provider ?? c.platform ?? c.socialNetwork ?? fallbackPlatform),
    );
    // A Unipile Comment's `author` is the display-NAME STRING (not an object like a
    // reaction's author); the rich fields live under `author_details`. Reading a
    // nested `author.name` therefore missed everything and left the commenter NULL
    // ("Someone" in the inbox). Handle both shapes so a payload variant can't regress it.
    const authorObj =
      c.author && typeof c.author === 'object' ? (c.author as Record<string, unknown>) : {};
    const details = (c.author_details ?? {}) as Record<string, unknown>;
    const authorName =
      (typeof c.author === 'string' ? c.author : undefined) ??
      (c.author_name as string) ??
      (authorObj.name as string) ??
      (details.name as string) ??
      undefined;
    // Comments carry no public_identifier - derive a handle from the /in/<slug> of
    // the profile url, falling back to the member id.
    const profileUrl = (details.profile_url as string) ?? (authorObj.profile_url as string) ?? undefined;
    const handleFromUrl = profileUrl?.match(/\/in\/([^/?#]+)/)?.[1];

    out.push({
      provider_comment_id: id,
      comment_text: text.trim(),
      platform,
      author_name: authorName,
      author_handle:
        (c.author_handle as string) ??
        (authorObj.public_identifier as string) ??
        handleFromUrl ??
        (details.id as string) ??
        undefined,
      author_headline:
        (c.author_headline as string) ??
        (details.headline as string) ??
        (authorObj.headline as string) ??
        undefined,
      // Unipile sends `date`; the old list only checked created_at/created/timestamp,
      // so commented_at was always NULL (breaking the inbox's chronological sort).
      commented_at:
        (c.created_at as string) ??
        (c.date as string) ??
        (c.posted_at as string) ??
        (c.created as string) ??
        (c.timestamp as string) ??
        undefined,
    });
  }
  return out;
}

/**
 * Resolves the Unipile account_id for a user+platform, SELF-HEALING a rotated id.
 *
 * WHY: Unipile re-issues account.id on every LinkedIn re-auth, so the id cached in
 * social_accounts goes stale. Comments/reactions used to return the raw stored id
 * blindly - a dead account_id made every GET /posts/{id}/comments 404, so every
 * imported post showed zero comments. Import/metrics/outreach already self-heal via
 * resolveUnipileTarget (matches on the stable identity in account_id); this brings
 * comments + reactions to parity. On Unipile being unreachable we fall back to the
 * stored id rather than blocking the sync entirely.
 */
export async function getUnipileAccountId(userId: string, platform: string): Promise<string | null> {
  const client = getServerClient();
  const { data } = await client.database
    .from('social_accounts')
    .select('unipile_account_id, account_id')
    .eq('user_id', userId)
    .eq('platform', platform)
    .limit(1)
    .maybeSingle();

  const row = data as { unipile_account_id: string | null; account_id: string | null } | null;
  if (!row?.unipile_account_id && !row?.account_id) return null;

  const op: OnboardingPlatform = normalizePlatform(platform) === 'twitter' ? 'twitter' : 'linkedin';
  const storedId = row.unipile_account_id ?? 'stale';
  try {
    const target = await resolveUnipileTarget(storedId, row.account_id, op);
    if (!target?.unipileAccountId) return row.unipile_account_id ?? null;
    if (target.refreshed) {
      // Persist the recovered live id so the next sync skips the round-trip.
      await client.database
        .from('social_accounts')
        .update({ unipile_account_id: target.unipileAccountId })
        .eq('user_id', userId)
        .eq('platform', platform);
    }
    return target.unipileAccountId;
  } catch {
    return row.unipile_account_id ?? null;
  }
}

/**
 * Resolves the LinkedIn post's `social_id` (a urn:li:ugcPost:… id) from the
 * activity id we store as provider_post_id.
 *
 * WHY: LinkedIn indexes a post's COMMENTS under its ugcPost social_id, whose
 * numeric core is DIFFERENT from the activity id (e.g. activity 7447798601738608640
 * ↔ ugcPost 7447798600476049410). Querying /posts/{activityId}/comments returns
 * HTTP 200 with an EMPTY list - a silent miss, so every comment sync recorded zero
 * even on posts with dozens of comments. The post-detail endpoint accepts the
 * activity id and hands back the real social_id, which we then use for comments.
 * Returns null when the post can't be resolved (caller falls back to raw candidates).
 */
async function resolveLinkedInSocialId(
  accountId: string,
  candidates: string[],
): Promise<string | null> {
  const params = new URLSearchParams({ account_id: accountId });
  for (const candidate of candidates) {
    try {
      const res = await unipoleFetch(
        `/posts/${encodeURIComponent(candidate)}?${params.toString()}`,
        { method: 'GET' },
      );
      if (!res.ok) continue;
      const json = (await res.json()) as { social_id?: string };
      if (json.social_id) return json.social_id;
    } catch {
      /* try the next id form */
    }
  }
  return null;
}

/**
 * Fetches comments for a post via Unipile GET /posts/{social_id}/comments.
 * social_id is stored in publish_jobs.provider_post_id after a successful publish.
 * For LinkedIn the stored id is the ACTIVITY id, but comments live under the
 * post's ugcPost social_id (see resolveLinkedInSocialId) - so we resolve that
 * first and try it ahead of the raw URN/id guesses.
 */
export async function fetchUnipilePostComments(
  userId: string,
  socialId: string,
  platform: string,
): Promise<UnipileFetchedComment[]> {
  if (!getApiKey()) return [];

  const accountId = await getUnipileAccountId(userId, platform);
  if (!accountId) return [];

  const params = new URLSearchParams({ account_id: accountId });

  // LinkedIn comments require the ugcPost social_id, which isn't derivable from
  // the stored activity id - resolve it and try it first. Twitter post ids work
  // directly, so skip the extra lookup there.
  const rawCandidates = buildPostIdCandidates(socialId);
  const candidates =
    normalizePlatform(platform) === 'linkedin'
      ? await (async () => {
          const resolved = await resolveLinkedInSocialId(accountId, rawCandidates);
          return resolved && !rawCandidates.includes(resolved)
            ? [resolved, ...rawCandidates]
            : rawCandidates;
        })()
      : rawCandidates;

  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      const res = await retryWithBackoff(async () =>
        throwIfNotOk(
          await unipoleFetch(
            `/posts/${encodeURIComponent(candidate)}/comments?${params.toString()}`,
            { method: 'GET' },
          ),
          'Unipile get comments',
        ),
      );
      return extractComments(await res.json(), platform);
    } catch (error) {
      lastError = error;
      if (error instanceof HttpStatusError && (error.status === 404 || error.status === 422)) {
        continue;
      }
      throw error;
    }
  }

  if (lastError instanceof HttpStatusError && (lastError.status === 404 || lastError.status === 422)) {
    return [];
  }
  if (lastError) throw lastError;
  return [];
}

/**
 * Sends a reply to a comment via Unipile POST /posts/{social_id}/comments.
 * comment_id targets a specific comment thread.
 */
export async function sendUnipileCommentReply(params: {
  userId: string;
  socialPostId: string;
  providerCommentId: string;
  platform: string;
  replyText: string;
}): Promise<{ provider_reply_id: string | null; stubbed: boolean }> {
  if (!getApiKey()) return { provider_reply_id: null, stubbed: true };

  const accountId = await getUnipileAccountId(params.userId, params.platform);
  if (!accountId) return { provider_reply_id: null, stubbed: true };

  const body = JSON.stringify({
    account_id: accountId,
    text: params.replyText,
    comment_id: params.providerCommentId,
  });

  // Same ugcPost-vs-activity id trap as fetch: a reply POSTed to the activity id
  // lands on the wrong post. Resolve the real social_id for LinkedIn and try first.
  const rawCandidates = buildPostIdCandidates(params.socialPostId);
  const candidates =
    normalizePlatform(params.platform) === 'linkedin'
      ? await (async () => {
          const resolved = await resolveLinkedInSocialId(accountId, rawCandidates);
          return resolved && !rawCandidates.includes(resolved)
            ? [resolved, ...rawCandidates]
            : rawCandidates;
        })()
      : rawCandidates;

  let lastError: unknown = null;
  for (const candidate of candidates) {
    const res = await unipoleFetch(
      `/posts/${encodeURIComponent(candidate)}/comments`,
      { method: 'POST', body },
    );

    const json = (await res.json()) as {
      id?: string;
      comment_id?: string;
      message?: string;
    };

    if (res.ok) {
      return {
        provider_reply_id: json.id ?? json.comment_id ?? null,
        stubbed: false,
      };
    }

    if (res.status === 404 || res.status === 422) {
      lastError = new Error(json.message ?? `Unipile reply failed (${res.status})`);
      continue;
    }

    throw new Error(json.message ?? `Unipile reply failed (${res.status})`);
  }

  if (lastError instanceof Error) throw lastError;
  return { provider_reply_id: null, stubbed: true };
}

export function unipileCommentsAvailable(): boolean {
  return Boolean(getApiKey()) && Boolean(process.env.UNIPILE_DSN);
}
