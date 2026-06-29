import {
  parseLinkedInPublicIdentifier,
  resolveLinkedInProfile,
} from '@/lib/signals/outreach/unipile-linkedin';
import { parseUnipileError, unipileJsonGet } from '@/lib/signals/outreach/unipile-client';
import { unipileItemToPost } from '@/lib/signals/ingest/normalize';
import type { IngestedPost, SignalPlatform, SignalSourceRow } from '@/lib/signals/types';

function normalizeHandle(handleOrUrl: string): string {
  if (handleOrUrl.startsWith('http')) return handleOrUrl;
  return handleOrUrl.replace(/^@/, '');
}

function linkedInTarget(source: SignalSourceRow): string {
  const target = normalizeHandle(source.handle_or_url);
  if (target.startsWith('http')) return target;
  if (source.source_type === 'company_page') {
    return `https://linkedin.com/company/${target}`;
  }
  return `https://linkedin.com/in/${target}`;
}

function xTarget(source: SignalSourceRow): string {
  const target = normalizeHandle(source.handle_or_url);
  return target.startsWith('http') ? target : target.replace(/^@/, '');
}

async function fetchUnipilePosts(
  unipileAccountId: string,
  userOrProviderId: string,
  limit: number,
): Promise<Record<string, unknown>[]> {
  const path =
    `/users/${encodeURIComponent(userOrProviderId)}/posts` +
    `?account_id=${encodeURIComponent(unipileAccountId)}&limit=${limit}`;

  const res = await unipileJsonGet(path);
  if (!res.ok) {
    throw new Error(await parseUnipileError(res));
  }

  const json = (await res.json()) as { items?: Record<string, unknown>[] };
  return json.items ?? [];
}

export async function fetchPostsViaUnipile(
  source: SignalSourceRow,
  unipileAccountId: string,
  maxItems: number,
): Promise<IngestedPost[]> {
  const posts: IngestedPost[] = [];

  if (source.platform === 'linkedin') {
    const target = linkedInTarget(source);
    const identifier = parseLinkedInPublicIdentifier(target);
    const profile = await resolveLinkedInProfile(unipileAccountId, identifier);
    const items = await fetchUnipilePosts(unipileAccountId, profile.providerId, maxItems);
    for (const item of items) {
      const post = unipileItemToPost(item, 'linkedin', identifier);
      if (post) posts.push(post);
    }
    return posts;
  }

  const handle = xTarget(source);
  const items = await fetchUnipilePosts(unipileAccountId, handle, maxItems);
  for (const item of items) {
    const post = unipileItemToPost(item, 'x', handle);
    if (post) posts.push(post);
  }
  return posts;
}

export function unipileConfigured(): boolean {
  return Boolean(process.env.UNIPILE_API_KEY && process.env.UNIPILE_DSN);
}
