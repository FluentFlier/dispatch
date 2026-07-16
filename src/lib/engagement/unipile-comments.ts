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

function extractComments(json: unknown, fallbackPlatform: string): UnipileFetchedComment[] {
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
    const author =
      (c.author_name as string) ??
      (c.userName as string) ??
      (c.username as string) ??
      (c.from as string) ??
      undefined;

    out.push({
      provider_comment_id: id,
      comment_text: text.trim(),
      platform,
      author_name: author,
      author_handle:
        (c.author_handle as string) ?? (c.userHandle as string) ?? undefined,
      commented_at:
        (c.created_at as string) ??
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
    if (!target?.unipileAccountId) return null;
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
    return null;
  }
}

/**
 * Fetches comments for a post via Unipile GET /posts/{social_id}/comments.
 * social_id is stored in publish_jobs.provider_post_id after a successful publish.
 * Tries the same URN/id candidates as reaction sync - numeric LinkedIn activity
 * ids only work when wrapped as urn:li:activity:… for many Unipile endpoints.
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
  let lastError: unknown = null;

  for (const candidate of buildPostIdCandidates(socialId)) {
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

  let lastError: unknown = null;
  for (const candidate of buildPostIdCandidates(params.socialPostId)) {
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
