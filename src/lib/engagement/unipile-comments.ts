import { getServerClient } from '@/lib/insforge/server';

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
 * Resolves the Unipile account_id for a user+platform from the social_accounts table.
 */
async function getUnipileAccountId(userId: string, platform: string): Promise<string | null> {
  const client = getServerClient();
  const { data } = await client.database
    .from('social_accounts')
    .select('unipile_account_id')
    .eq('user_id', userId)
    .eq('platform', platform)
    .not('unipile_account_id', 'is', null)
    .limit(1)
    .maybeSingle();
  return (data as { unipile_account_id: string } | null)?.unipile_account_id ?? null;
}

/**
 * Fetches comments for a post via Unipile GET /posts/{social_id}/comments.
 * social_id is stored in publish_jobs.provider_post_id after a successful publish.
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
  const res = await unipoleFetch(
    `/posts/${encodeURIComponent(socialId)}/comments?${params.toString()}`,
    { method: 'GET' },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Unipile get comments failed: ${res.status} ${body.slice(0, 200)}`);
  }

  const json = await res.json();
  return extractComments(json, platform);
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

  const res = await unipoleFetch(
    `/posts/${encodeURIComponent(params.socialPostId)}/comments`,
    {
      method: 'POST',
      body: JSON.stringify({
        account_id: accountId,
        text: params.replyText,
        comment_id: params.providerCommentId,
      }),
    },
  );

  const json = (await res.json()) as {
    id?: string;
    comment_id?: string;
    message?: string;
  };

  if (!res.ok) {
    throw new Error(json.message ?? `Unipile reply failed (${res.status})`);
  }

  return {
    provider_reply_id: json.id ?? json.comment_id ?? null,
    stubbed: false,
  };
}

export function unipileCommentsAvailable(): boolean {
  return Boolean(getApiKey()) && Boolean(process.env.UNIPILE_DSN);
}
