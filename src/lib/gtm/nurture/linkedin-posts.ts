import {
  getLinkedInUnipileAccountId,
  getWorkspaceLinkedInAccountId,
  parseLinkedInPublicIdentifier,
  resolveLinkedInProfile,
} from '@/lib/signals/outreach/unipile-linkedin';
import { parseUnipileError, unipileJsonGet } from '@/lib/signals/outreach/unipile-client';
import { fetchTheHogLinkedInPosts } from '@/lib/thehog/linkedin-posts';
import type { createClient } from '@insforge/sdk';
import type { SignalLeadWithContacts } from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

export interface ProspectPost {
  id: string;
  excerpt: string;
  url?: string;
  source: 'unipile' | 'thehog';
}

async function fetchUnipileProspectPosts(
  accountId: string,
  linkedinUrl: string,
  limit: number,
): Promise<ProspectPost[]> {
  const identifier = parseLinkedInPublicIdentifier(linkedinUrl);
  const profile = await resolveLinkedInProfile(accountId, identifier);
  const res = await unipileJsonGet(
    `/users/${encodeURIComponent(profile.providerId)}/posts?account_id=${encodeURIComponent(accountId)}&limit=${limit}`,
  );
  if (!res.ok) {
    throw new Error(await parseUnipileError(res));
  }

  const json = (await res.json()) as { items?: Array<Record<string, unknown>> };
  const out: ProspectPost[] = [];

  for (const item of json.items ?? []) {
    if (item.is_repost === true || item.is_reply === true) continue;
    const text = String(item.text ?? item.commentary ?? '').trim();
    const id = String(item.id ?? item.post_id ?? '');
    if (!id || text.length < 25) continue;
    out.push({
      id,
      excerpt: text.slice(0, 2000),
      url: `https://www.linkedin.com/feed/update/${encodeURIComponent(id)}/`,
      source: 'unipile',
    });
    if (out.length >= limit) break;
  }

  return out;
}

/**
 * Picks the best recent LinkedIn post for any identifier (a profile URL or a
 * public handle), trying Unipile first then falling back to The Hog. Shared by
 * both directory-lead nurture (via a lead's primary contact) and the engager
 * nurture engine (via a warm contact's handle), so engagers get the exact same
 * robust post lookup leads do.
 */
export async function fetchLinkedInPostForIdentifier(
  client: InsforgeClient,
  workspaceId: string,
  userId: string,
  linkedinIdentifier: string,
): Promise<ProspectPost | null> {
  const identifier = linkedinIdentifier.trim();
  if (!identifier) return null;

  const accountId =
    (await getLinkedInUnipileAccountId(client, userId, workspaceId)) ??
    (await getWorkspaceLinkedInAccountId(client, workspaceId));
  if (!accountId) return null;

  try {
    const unipilePosts = await fetchUnipileProspectPosts(accountId, identifier, 8);
    if (unipilePosts.length > 0) {
      return unipilePosts.sort((a, b) => b.excerpt.length - a.excerpt.length)[0];
    }
  } catch {
    // fall through to The Hog
  }

  const hogPosts = await fetchTheHogLinkedInPosts(identifier, 8);
  if (hogPosts.length === 0) return null;

  const best = hogPosts.sort((a, b) => b.text.length - a.text.length)[0];
  return {
    id: best.id,
    excerpt: best.text,
    url: best.url ?? `https://www.linkedin.com/feed/update/${encodeURIComponent(best.id)}/`,
    source: 'thehog',
  };
}

/**
 * Picks the top `limit` recent posts from a lead's primary contact (Unipile, then
 * The Hog), longest-first. Used to warm up across several of the prospect's posts
 * before connecting. Returns [] when there's no LinkedIn URL / connected account /
 * post to comment on.
 */
export async function fetchProspectLinkedInPosts(
  client: InsforgeClient,
  workspaceId: string,
  userId: string,
  lead: SignalLeadWithContacts,
  limit = 1,
): Promise<ProspectPost[]> {
  const contact = lead.primary_contact ?? lead.contacts?.[0];
  const linkedinUrl = contact?.linkedin_url?.trim();
  if (!linkedinUrl) return [];

  const accountId =
    (await getLinkedInUnipileAccountId(client, userId, workspaceId)) ??
    (await getWorkspaceLinkedInAccountId(client, workspaceId));
  if (!accountId) return [];

  try {
    const unipilePosts = await fetchUnipileProspectPosts(accountId, linkedinUrl, 8);
    if (unipilePosts.length > 0) {
      return unipilePosts.sort((a, b) => b.excerpt.length - a.excerpt.length).slice(0, limit);
    }
  } catch {
    // fall through to The Hog
  }

  const hogPosts = await fetchTheHogLinkedInPosts(linkedinUrl, 8);
  return hogPosts
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, limit)
    .map((best) => ({
      id: best.id,
      excerpt: best.text,
      url: best.url ?? `https://www.linkedin.com/feed/update/${encodeURIComponent(best.id)}/`,
      source: 'thehog' as const,
    }));
}

/** Picks the single best recent post (back-compat wrapper over the plural fetch). */
export async function fetchProspectLinkedInPost(
  client: InsforgeClient,
  workspaceId: string,
  userId: string,
  lead: SignalLeadWithContacts,
): Promise<ProspectPost | null> {
  return (await fetchProspectLinkedInPosts(client, workspaceId, userId, lead, 1))[0] ?? null;
}
