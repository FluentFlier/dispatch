/**
 * Unified feed normalizer.
 *
 * The Leads feed mixes two very different data sources: real-time signal
 * events (posts detected on X/LinkedIn) and directory leads (YC/Product Hunt
 * company records). The feed endpoint and UI should not need to know which
 * source a card came from, so this module maps both shapes into one
 * `UnifiedLeadCard` that downstream code can render generically.
 */

import type {
  NurtureStage, SignalEventStatus, SignalEventWithPost, SignalLeadWithContacts, SignalType,
} from '@/lib/signals/types';

/** Contact info surfaced on a unified card, regardless of which source it came from. */
export interface UnifiedContact {
  name?: string | null;
  role?: string | null;
  linkedin_url?: string | null;
  x_handle?: string | null;
  email?: string | null;
}

/** Common shape both signal events and directory leads are normalized into for the feed. */
export interface UnifiedLeadCard {
  id: string;
  kind: 'signal' | 'directory' | 'engager';
  source: 'x' | 'linkedin' | 'web_discovery' | 'yc_directory' | 'yc_launches' | 'product_hunt' | 'manual';
  companyName: string | null;
  tagline: string | null;
  signalType: SignalType | null;
  signalSummary: string | null;
  sourceUrl: string | null;
  batch: string | null;
  accelerator: string | null;
  contact: UnifiedContact | null;
  contactStatus: string | null;
  score: number;
  status: string;
  detectedAt: string;
  /** Nurture sequence stage for engager cards; absent for signal/directory cards. */
  nurtureStage?: NurtureStage | null;
  /** True when the prospect replied and is waiting on you. */
  needsReply?: boolean;
}

/**
 * Maps a signal event's `SignalEventStatus` into the `LeadStatus` vocabulary
 * the feed UI actually filters on. Signal events and directory leads are two
 * distinct sources feeding one filter (see `FeedFilters` / `mergeFeed`), so
 * without this explicit map a `pending` signal event would never match the
 * UI's default `status: 'new'` tab and would silently vanish from the feed.
 * `failed` is treated as `new` too: a failed signal still needs attention and
 * must stay visible, not disappear. `drafted`/`sent`/`dismissed` are shared
 * vocabulary already and pass through unchanged.
 */
const SIGNAL_STATUS_TO_LEAD_STATUS: Record<SignalEventStatus, string> = {
  pending: 'new',
  failed: 'new',
  drafted: 'drafted',
  sent: 'sent',
  dismissed: 'dismissed',
};

/**
 * Junk company-name guard. Detection can mis-extract a stopword or fragment as a
 * company (e.g. a tweet "…we joined YC W26" yielding "the"). Such a value is not
 * a real name - treat it as absent so the card falls through to person/author
 * instead of headlining garbage.
 */
const NAME_STOPWORDS = new Set([
  'the', 'a', 'an', 'we', 'our', 'us', 'this', 'that', 'it', 'i', 'my', 'they',
  'building', 'startup', 'company', 'team', 'and', 'to', 'of', 'for',
]);
function isJunkName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (n.length < 2) return true;
  if (NAME_STOPWORDS.has(n)) return true;
  if (!/[a-z0-9]/i.test(n)) return true; // no alphanumerics at all
  return false;
}
function firstValidName(...candidates: Array<string | undefined>): string | undefined {
  for (const c of candidates) {
    const v = c?.trim();
    if (v && !isJunkName(v)) return v;
  }
  return undefined;
}

/**
 * Maps a real-time signal event (a detected X/LinkedIn post) into a unified
 * feed card. Falls back to 'x' when the source platform is unknown so the
 * card always has a valid `source`, since raw_post can be missing if the
 * post row was purged or never hydrated.
 */
export function normalizeEvent(e: SignalEventWithPost): UnifiedLeadCard {
  const platform = e.raw_post?.platform ?? 'x';
  // Detection doesn't always resolve a company (un-named accelerator/funding
  // posts), and stale rows can carry junk fragments in company_name. Rather
  // than render a blank or garbage headline, fall back through the next-best
  // identifiers so the card always shows something a human can act on.
  const companyName = firstValidName(
    e.company_name ?? undefined,
    e.person_name ?? undefined,
    e.raw_post?.author_name ?? undefined,
    e.raw_post?.author_handle?.replace(/^@/, ''),
  ) || 'Unknown company';
  return {
    id: e.id,
    kind: 'signal',
    source: platform === 'linkedin' ? 'linkedin' : 'x',
    companyName,
    tagline: null,
    signalType: e.signal_type,
    signalSummary: e.signal_summary,
    sourceUrl: e.raw_post?.post_url ?? null,
    batch: e.batch,
    accelerator: e.accelerator_name,
    // Keyword matches carry the author's X handle as a real messaging channel:
    // the poster IS the lead, so the card should be contact-ready for the X-DM
    // flow. Other signal types keep the name-only contact (no channel implied).
    contact:
      e.signal_type === 'keyword_match' && e.raw_post?.author_handle
        ? {
            name: e.person_name ?? e.raw_post.author_name ?? e.raw_post.author_handle,
            x_handle: e.raw_post.author_handle,
          }
        : e.person_name
          ? { name: e.person_name }
          : null,
    contactStatus: null,
    score: e.confidence ?? 0,
    status: SIGNAL_STATUS_TO_LEAD_STATUS[e.status],
    detectedAt: e.created_at,
  };
}

/**
 * Maps a directory lead (YC/Product Hunt company record, with its hydrated
 * primary contact) into a unified feed card. Prefers rank_score (the
 * post-ICP-scoring rank) over fit_score, falling back to 0 when neither is
 * set.
 */
function warmFeedBoost(l: SignalLeadWithContacts): number {
  let boost = 0;
  if (l.needs_reply) boost += 50;
  if (l.nurture_stage === 'replied') boost += 15;
  if (l.nurture_stage === 'connect_sent' || l.nurture_stage === 'dm_sent') boost += 8;
  if (l.last_inbound_at) {
    const ageHours = (Date.now() - Date.parse(l.last_inbound_at)) / 3_600_000;
    if (ageHours < 48) boost += 10;
  }
  return boost;
}

export function normalizeLead(l: SignalLeadWithContacts): UnifiedLeadCard {
  const pc = l.primary_contact ?? null;
  // A Product Hunt listing and a YC "launch" post ARE launch events, so they
  // carry the 'launch' signal type - this lets the "Launched" feed filter match
  // scraped directory leads instead of returning nothing. Funding / role-change
  // / accelerator-join can't be inferred from a directory record, so those
  // signal types stay exclusive to the live Signal engine (normalizeEvent).
  const signalType: SignalType | null =
    l.source === 'product_hunt' || l.source === 'yc_launches' ? 'launch' : null;
  return {
    id: l.id,
    kind: 'directory',
    source: l.source,
    companyName: l.company_name,
    tagline: l.tagline,
    signalType,
    signalSummary: l.tagline,
    sourceUrl: l.website,
    batch: l.batch,
    accelerator: l.source === 'yc_directory' || l.source === 'yc_launches' ? 'Y Combinator' : null,
    contact: pc
      ? { name: pc.name, role: pc.role, linkedin_url: pc.linkedin_url, x_handle: pc.x_handle, email: pc.email }
      : null,
    contactStatus: l.contact_status,
    score: (l.rank_score ?? l.fit_score ?? 0) + warmFeedBoost(l),
    status: l.needs_reply ? 'needs_reply' : l.lead_status,
    detectedAt: l.last_inbound_at ?? l.last_seen_at ?? l.first_seen_at,
    nurtureStage: (l.nurture_stage as NurtureStage | null | undefined) ?? null,
    needsReply: l.needs_reply ?? false,
  };
}
