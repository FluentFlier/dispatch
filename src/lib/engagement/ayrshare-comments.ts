import { getOrCreateAyrshareProfileKey } from '@/lib/social/ayrshare';

const AYRSHARE_BASE = 'https://api.ayrshare.com/api';

function getApiKey(): string | null {
  return process.env.AYRSHARE_API_KEY ?? null;
}

async function ayrshareFetch(
  path: string,
  options: RequestInit & { profileKey?: string } = {},
): Promise<Response> {
  const key = getApiKey();
  if (!key) throw new Error('AYRSHARE_API_KEY is not configured');

  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (options.profileKey) {
    headers['Profile-Key'] = options.profileKey;
  }
  const { profileKey: _pk, ...rest } = options;
  return fetch(`${AYRSHARE_BASE}${path}`, { ...rest, headers });
}

export interface AyrshareFetchedComment {
  provider_comment_id: string;
  comment_text: string;
  platform: string;
  author_name?: string;
  author_handle?: string;
  commented_at?: string;
}

function normalizePlatform(p: string): string {
  const n = p.toLowerCase();
  if (n === 'x') return 'twitter';
  return n;
}

function extractCommentsFromPayload(
  json: unknown,
  fallbackPlatform: string,
): AyrshareFetchedComment[] {
  const out: AyrshareFetchedComment[] = [];
  if (!json || typeof json !== 'object') return out;

  const root = json as Record<string, unknown>;
  const candidates: unknown[] = [];

  if (Array.isArray(root.comments)) candidates.push(...root.comments);
  if (Array.isArray(root.data)) candidates.push(...root.data);
  if (Array.isArray(root)) candidates.push(...(root as unknown[]));

  for (const item of candidates) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    const id =
      (c.commentId as string) ??
      (c.id as string) ??
      (c.comment_id as string);
    const text =
      (c.comment as string) ??
      (c.text as string) ??
      (c.message as string);
    if (!id || !text || typeof text !== 'string') continue;

    const platform = normalizePlatform(
      String(c.platform ?? c.socialNetwork ?? fallbackPlatform),
    );
    const author =
      (c.userName as string) ??
      (c.username as string) ??
      (c.from as string) ??
      (c.author as string);

    out.push({
      provider_comment_id: String(id),
      comment_text: text.trim(),
      platform,
      author_name: author ? String(author) : undefined,
      author_handle:
        (c.userHandle as string) ?? (c.handle as string) ?? undefined,
      commented_at:
        (c.created as string) ??
        (c.timestamp as string) ??
        (c.date as string) ??
        undefined,
    });
  }

  return out;
}

/**
 * Fetch comments for an Ayrshare post ID (from publish_jobs.provider_post_id).
 */
export async function fetchAyrsharePostComments(
  userId: string,
  ayrsharePostId: string,
  platform: string,
): Promise<AyrshareFetchedComment[]> {
  if (!getApiKey()) return [];

  const profileKey = await getOrCreateAyrshareProfileKey(userId);
  const res = await ayrshareFetch(`/comments/${encodeURIComponent(ayrsharePostId)}`, {
    method: 'GET',
    profileKey,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ayrshare get comments failed: ${res.status} ${body.slice(0, 200)}`);
  }

  const json = await res.json();
  return extractCommentsFromPayload(json, platform);
}

export async function sendAyrshareCommentReply(params: {
  userId: string;
  providerCommentId: string;
  platform: string;
  replyText: string;
  /** Use social network comment ID (typical for synced external comments) */
  searchPlatformId?: boolean;
}): Promise<{ provider_reply_id: string | null; stubbed: boolean }> {
  if (!getApiKey()) {
    return { provider_reply_id: null, stubbed: true };
  }

  const profileKey = await getOrCreateAyrshareProfileKey(params.userId);
  const platform =
    params.platform === 'twitter' ? 'twitter' : normalizePlatform(params.platform);

  const body: Record<string, unknown> = {
    platforms: [platform],
    comment: params.replyText,
  };
  if (params.searchPlatformId !== false) {
    body.searchPlatformId = true;
  }

  const res = await ayrshareFetch(
    `/comments/reply/${encodeURIComponent(params.providerCommentId)}`,
    {
      method: 'POST',
      profileKey,
      body: JSON.stringify(body),
    },
  );

  const json = (await res.json()) as {
    id?: string;
    commentId?: string;
    status?: string;
    message?: string;
    errors?: Array<{ message?: string }>;
  };

  if (!res.ok || json.status === 'error') {
    const err =
      json.errors?.[0]?.message ??
      json.message ??
      `Ayrshare reply failed (${res.status})`;
    throw new Error(err);
  }

  return {
    provider_reply_id: json.commentId ?? json.id ?? null,
    stubbed: false,
  };
}

export function ayrshareCommentsAvailable(): boolean {
  return Boolean(getApiKey());
}
