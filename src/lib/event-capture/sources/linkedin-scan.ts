import type { createClient } from '@insforge/sdk';
import { generateContent } from '@/lib/ai';
import { checkAndIncrementUsage } from '@/lib/ai-budget';
import { resolveModel } from '@/lib/ai-tiers';
import { fetchUnipileAccountDetails, unipoleFetch } from '@/lib/social/unipile';
import type { NormalizedEvent } from '@/lib/event-capture/sources/types';

type InsforgeClient = ReturnType<typeof createClient>;

/** Caps how many post ids we remember per workspace - Unipile only ever returns the 25 most recent anyway. */
const MAX_SCANNED_IDS = 50;

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
 * Removes posts whose id is already in `scannedIds`, so a post already
 * classified (positive or negative) on a prior cron run is never re-sent to
 * the LLM. Pure and unit tested independent of the DB/LLM calls.
 */
export function filterUnscannedPosts(items: UnipilePostItem[], scannedIds: Set<string>): UnipilePostItem[] {
  return items.filter((item) => item.id && !scannedIds.has(item.id));
}

/**
 * Resolves the workspace's connected LinkedIn Unipile account, fetches the
 * user's recent posts, and asks the LLM which announce a future event. Each
 * positive verdict becomes a NormalizedEvent (source 'linkedin', id
 * `li_<postId>`) with a synthetic 1-hour window on the inferred date. Returns []
 * on any failure - this is a best-effort fallback source so a single external
 * error can never crash the Stage 1 cron loop.
 *
 * Cost control: each classification is gated on the workspace's daily Haiku
 * budget (the scan stops for the run once blocked), and post ids already
 * classified on a prior run are skipped via the linkedin_scan_state cursor so a
 * quiet calendar never re-sends the same 25 posts to the LLM every hour.
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

  // 4. Load which post ids we've already classified for this workspace, so a
  // quiet calendar doesn't re-ask the LLM about the same 25 posts every hour.
  let scannedIds = new Set<string>();
  try {
    const { data: stateRow } = await client.database
      .from('linkedin_scan_state')
      .select('scanned_post_ids')
      .eq('workspace_id', owner.workspaceId)
      .maybeSingle();
    scannedIds = new Set((stateRow?.scanned_post_ids as string[] | undefined) ?? []);
  } catch (err) {
    // No state row yet or table unreachable - treat everything as unscanned, but
    // log so a persistently-unreachable cursor table is diagnosable (otherwise the
    // workspace silently re-classifies all 25 posts every run with no trail).
    console.warn('[linkedin-scan] failed to load scan state', { workspaceId: owner.workspaceId, err });
  }

  const candidates = items.filter((item) => !item.is_repost && !item.is_reply && item.id);
  const unscanned = filterUnscannedPosts(candidates, scannedIds);

  // 5. Classify each substantive unscanned post, stopping early if the
  // workspace's daily Haiku budget is exhausted mid-run.
  const events: NormalizedEvent[] = [];
  const newlyScanned: string[] = [];

  for (const item of unscanned) {
    const text = (item.text ?? item.commentary ?? '').trim();
    if (text.length < 20) continue;

    const budget = await checkAndIncrementUsage(client, owner.workspaceId, 'haiku');
    if (budget === 'blocked') break;

    newlyScanned.push(item.id as string);

    let verdict: LlmEventVerdict;
    try {
      verdict = parseEventFromLlm(await generateContent(text, undefined, SYSTEM, null, resolveModel('fast')));
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

  // 6. Persist the updated scanned-id set, capped to the most recent MAX_SCANNED_IDS.
  if (newlyScanned.length > 0) {
    const merged = [...Array.from(scannedIds), ...newlyScanned].slice(-MAX_SCANNED_IDS);
    try {
      await client.database
        .from('linkedin_scan_state')
        .upsert({ workspace_id: owner.workspaceId, scanned_post_ids: merged, updated_at: new Date().toISOString() }, { onConflict: 'workspace_id' });
    } catch (err) {
      console.warn('[linkedin-scan] failed to persist scan state', { workspaceId: owner.workspaceId, err });
    }
  }

  return events;
}
