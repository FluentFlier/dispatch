import type { createClient } from '@insforge/sdk';
import { generateContent } from '@/lib/ai';
import { fetchUnipileAccountDetails, unipoleFetch } from '@/lib/social/unipile';
import type { NormalizedEvent } from '@/lib/event-capture/sources/types';

type InsforgeClient = ReturnType<typeof createClient>;

/** The model's structured verdict about a single LinkedIn post. */
export interface LlmEventVerdict {
  /** True only when the author announces attending/speaking at a specific future event. */
  isFutureEvent: boolean;
  /** The event's name, if one was identified. */
  title?: string;
  /** Best-guess ISO date (YYYY-MM-DD) the event happens, if inferable. */
  date?: string;
  /** Venue or city, if mentioned. */
  location?: string;
}

/**
 * Extracts the model's JSON verdict from a raw LLM string. Tolerant of code
 * fences and surrounding prose - we only trust the first {...} block. Pure and
 * unit tested so the scan never depends on exact model formatting.
 *
 * WHY: LLMs frequently wrap JSON in prose or markdown fences; a strict
 * JSON.parse on the whole string would throw and silently drop valid verdicts.
 */
export function parseEventFromLlm(raw: string): LlmEventVerdict {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { isFutureEvent: false };
  try {
    const obj = JSON.parse(match[0]) as LlmEventVerdict;
    return {
      isFutureEvent: Boolean(obj.isFutureEvent),
      title: obj.title,
      date: obj.date,
      location: obj.location,
    };
  } catch {
    return { isFutureEvent: false };
  }
}

const SYSTEM = `You read one LinkedIn post and decide if the AUTHOR is announcing they will ATTEND or SPEAK AT a specific FUTURE professional event (conference, meetup, summit, demo day, podcast, panel, workshop).
Return ONLY JSON: {"isFutureEvent":boolean,"title":string,"date":string,"location":string}
- title: the event's name. date: best-guess ISO date YYYY-MM-DD or "". location: venue/city or "".
- Past events, generic musings, or product launches without an event = isFutureEvent:false.
- No em dashes.`;

/** Minimal shape of the LinkedIn account row we read from social_accounts. */
interface LinkedInAccountRow {
  unipile_account_id?: string | null;
  account_id?: string | null;
}

/** Minimal shape of a Unipile post item returned by GET /users/{id}/posts. */
interface UnipilePostItem {
  id?: string;
  text?: string;
  commentary?: string;
  is_repost?: boolean;
  is_reply?: boolean;
}

/**
 * Resolves the workspace's connected LinkedIn Unipile account, fetches the
 * user's recent posts, and asks the LLM which announce a future event. Each
 * positive verdict becomes a NormalizedEvent (source 'linkedin', id
 * `li_<postId>`) with a synthetic 1-hour window on the inferred date. Returns []
 * on any failure - this is a best-effort fallback source so a single external
 * error can never crash the Stage 1 cron loop.
 */
export async function scanLinkedInForEvents(
  client: InsforgeClient,
  owner: { workspaceId: string; userId: string },
  now: Date,
): Promise<NormalizedEvent[]> {
  // 1. Find the connected LinkedIn account for this workspace/user.
  let account: LinkedInAccountRow | null = null;
  try {
    const { data } = await client.database
      .from('social_accounts')
      .select('unipile_account_id, account_id')
      .eq('user_id', owner.userId)
      .eq('workspace_id', owner.workspaceId)
      .eq('platform', 'linkedin')
      .not('unipile_account_id', 'is', null)
      .maybeSingle();
    account = (data as LinkedInAccountRow | null) ?? null;
  } catch {
    return [];
  }

  const unipileAccountId = account?.unipile_account_id;
  if (!unipileAccountId) return [];

  // 2. Resolve the LinkedIn provider member id. Mirrors the precedence used by
  // /api/voice-lab/import-from-account: prefer the numeric/encoded member id
  // from Unipile's connection_params, then fall back to the stored account_id.
  let providerUserId: string | null = null;
  try {
    const full = await fetchUnipileAccountDetails(unipileAccountId);
    const im = full?.connection_params?.im;
    providerUserId =
      im?.memberId ?? im?.id ?? im?.objectUrn ?? im?.publicIdentifier ?? account?.account_id ?? null;
  } catch {
    providerUserId = account?.account_id ?? null;
  }
  if (!providerUserId) return [];

  // 3. Fetch the user's recent posts (same endpoint shape as import-from-account).
  let items: UnipilePostItem[] = [];
  try {
    const res = await unipoleFetch(
      `/users/${encodeURIComponent(providerUserId)}/posts?account_id=${encodeURIComponent(
        unipileAccountId,
      )}&limit=25`,
      { method: 'GET' },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as { items?: UnipilePostItem[] };
    items = json.items ?? [];
  } catch {
    return [];
  }

  // 4. Classify each substantive original post (skip reposts/replies/short text).
  const events: NormalizedEvent[] = [];
  for (const item of items) {
    if (!item.id || item.is_repost || item.is_reply) continue;
    const text = (item.text ?? item.commentary ?? '').trim();
    if (text.length < 20) continue;

    let verdict: LlmEventVerdict;
    try {
      verdict = parseEventFromLlm(await generateContent(text, undefined, SYSTEM, null));
    } catch {
      continue;
    }
    if (!verdict.isFutureEvent || !verdict.title) continue;

    // Synthetic window: inferred date (or now) at 18:00 UTC, 1 hour long, so the
    // downstream ingest/enrich treat it like any other timed event.
    const day = verdict.date ? new Date(`${verdict.date}T18:00:00Z`) : now;
    if (Number.isNaN(day.getTime())) continue;
    const end = new Date(day.getTime() + 60 * 60 * 1000);

    events.push({
      providerEventId: `li_${item.id}`,
      source: 'linkedin',
      title: verdict.title,
      description: text.slice(0, 500),
      location: verdict.location ?? null,
      startTime: day,
      endTime: end,
    });
  }

  return events;
}
