/**
 * Reaction sync from Unipile's GET /posts/{social_id}/reactions endpoint.
 *
 * Reactions are the other half of engagement (comments alone under-count who
 * actually saw and responded to a post) and feed audience/lead categorization.
 */
import {
  retryWithBackoff,
  throwIfNotOk,
  HttpStatusError,
} from '@/lib/social/reliability';
import { getUnipileAccountId } from '@/lib/engagement/unipile-comments';

export interface UnipileFetchedReaction {
  reaction_type: string;
  author_name?: string;
  author_handle?: string;
  author_headline?: string;
  author_profile_url?: string;
  is_company?: boolean;
}

function getUnipileBase(): string {
  const dsn = process.env.UNIPILE_DSN;
  if (!dsn) throw new Error('UNIPILE_DSN is not configured');
  return `https://${dsn.replace(/\/$/, '')}/api/v1`;
}

function getApiKey(): string | null {
  return process.env.UNIPILE_API_KEY ?? null;
}

/**
 * Builds the candidate post-id formats to try, most-likely first.
 * WHY: LinkedIn post ids surface in several URN flavors and Unipile only
 * accepts the one the post was indexed under. Four formats show up in the
 * wild; trying them in order turns hard 404s into successful fetches.
 * Non-numeric ids (Unipile's own post ids) are returned as-is.
 */
export function buildPostIdCandidates(socialId: string): string[] {
  if (/^\d+$/.test(socialId)) {
    return [
      `urn:li:activity:${socialId}`,
      socialId,
      `urn:li:share:${socialId}`,
      `urn:li:ugcPost:${socialId}`,
    ];
  }
  // URN-form id (e.g. "urn:li:activity:123..."): try it verbatim first, then the
  // numeric core wrapped in the other URN flavors Unipile may have indexed it
  // under. Without this, an imported post stored as one URN flavor 404s forever
  // when comments live under a sibling flavor.
  const numeric = socialId.match(/(\d{5,})/)?.[1];
  if (numeric) {
    return [
      socialId,
      `urn:li:activity:${numeric}`,
      `urn:li:share:${numeric}`,
      `urn:li:ugcPost:${numeric}`,
      numeric,
    ].filter((v, i, a) => a.indexOf(v) === i);
  }
  return [socialId];
}

/**
 * Tolerant parser for Unipile reaction payloads. Field names vary across
 * providers/versions, so read from every known alias and skip malformed rows
 * instead of failing the whole sync.
 */
export function extractReactions(json: unknown): UnipileFetchedReaction[] {
  if (!json || typeof json !== 'object') return [];
  const root = json as Record<string, unknown>;

  const candidates: unknown[] = [];
  if (Array.isArray(root.items)) candidates.push(...root.items);
  if (Array.isArray(root.data)) candidates.push(...root.data);
  if (Array.isArray(root.reactions)) candidates.push(...root.reactions);

  const out: UnipileFetchedReaction[] = [];
  for (const item of candidates) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const author = (r.author ?? {}) as Record<string, unknown>;

    const reactionType = String(r.value ?? r.reaction_type ?? r.type ?? 'LIKE').toUpperCase();
    const name =
      (r.author_name as string) ?? (author.name as string) ?? (r.name as string) ?? undefined;
    const handle =
      (r.author_public_identifier as string) ??
      (author.public_identifier as string) ??
      (author.username as string) ??
      (r.author_id as string) ??
      (author.id as string) ??
      undefined;
    // Rows with no author identity at all can't be deduped or categorized.
    if (!name && !handle) continue;

    out.push({
      reaction_type: reactionType,
      author_name: name,
      author_handle: handle,
      author_headline:
        (r.author_headline as string) ?? (author.headline as string) ?? undefined,
      author_profile_url:
        (r.author_profile_url as string) ?? (author.profile_url as string) ?? undefined,
      is_company: Boolean(r.is_company ?? author.is_company ?? false),
    });
  }
  return out;
}

/**
 * Fetches reactions for a published post via Unipile, trying each known
 * post-id format until one succeeds. 404 on every format means the post has
 * no indexable reactions (or was deleted) — treated as empty, not an error,
 * so one dead post never aborts a sync batch.
 */
export async function fetchUnipilePostReactions(
  userId: string,
  socialId: string,
  platform: string,
): Promise<UnipileFetchedReaction[]> {
  const key = getApiKey();
  if (!key || !process.env.UNIPILE_DSN) return [];

  const accountId = await getUnipileAccountId(userId, platform);
  if (!accountId) return [];

  let lastError: unknown = null;
  for (const candidate of buildPostIdCandidates(socialId)) {
    try {
      const res = await retryWithBackoff(async () =>
        throwIfNotOk(
          await fetch(
            `${getUnipileBase()}/posts/${encodeURIComponent(candidate)}/reactions?account_id=${encodeURIComponent(accountId)}`,
            { headers: { 'X-API-KEY': key, accept: 'application/json' } },
          ),
          'Unipile get reactions',
        ),
      );
      return extractReactions(await res.json());
    } catch (error) {
      lastError = error;
      // 404/422 = wrong id format; fall through to the next candidate.
      if (error instanceof HttpStatusError && (error.status === 404 || error.status === 422)) {
        continue;
      }
      throw error;
    }
  }

  if (lastError instanceof HttpStatusError && (lastError.status === 404 || lastError.status === 422)) {
    return [];
  }
  throw lastError ?? new Error('Unipile get reactions failed');
}
