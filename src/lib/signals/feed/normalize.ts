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

export type LeadQualityTier = 'urgent' | 'high' | 'medium' | 'low' | 'needs_contact' | 'needs_review';

/** Human-readable explanation of why a feed card is worth reviewing. */
export interface LeadQualityBreakdown {
  tier: LeadQualityTier;
  label: string;
  fitLabel: string;
  reachabilityLabel: string;
  timingLabel: string;
  reasons: string[];
  blockers: string[];
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
  /** ICP/signal fit without urgency boosts. Used for "Best fit" sorting. */
  fitScore?: number;
  /** Time/reply urgency, separated from fit so warm leads do not masquerade as better ICP matches. */
  urgencyScore?: number;
  /** Reachability from 0-1 based on usable channels, not just a contact name. */
  reachabilityScore?: number;
  score: number;
  quality?: LeadQualityBreakdown;
  nextActionLabel?: string;
  status: string;
  detectedAt: string;
  /** When this lead was first pulled into the workspace (import date shown on the card). */
  firstSeenAt?: string | null;
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

function clamp01(n: number | null | undefined): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function contactReachability(contact: UnifiedContact | null, contactStatus?: string | null): number {
  if (contactStatus === 'no_contact' || !contact) return 0;
  if (contact.linkedin_url || contact.x_handle || contact.email) return 1;
  return 0;
}

function sourceReason(source: UnifiedLeadCard['source'], batch?: string | null): string {
  if (source === 'yc_directory' || source === 'yc_launches') return batch ? `YC ${batch}` : 'YC company';
  if (source === 'product_hunt') return batch ? `Product Hunt ${batch}` : 'Product Hunt listing';
  if (source === 'web_discovery') return 'Found from ICP web discovery';
  if (source === 'manual') return 'Imported lead';
  if (source === 'linkedin') return 'LinkedIn signal';
  return 'X signal';
}

function fitLabel(score: number, signal = false): string {
  if (score >= 0.75) return signal ? 'High-confidence signal' : 'Strong ICP fit';
  if (score >= 0.45) return signal ? 'Possible signal' : 'Possible ICP fit';
  if (score > 0) return signal ? 'Low-confidence signal' : 'Weak ICP fit';
  return 'Unscored';
}

function reachabilityLabel(score: number): string {
  return score > 0 ? 'Contact ready' : 'Needs contact';
}

function directoryUrgency(l: SignalLeadWithContacts): number {
  if (l.needs_reply || l.nurture_stage === 'replied') return 1;
  if (l.nurture_stage === 'connect_sent' || l.nurture_stage === 'dm_sent') return 0.75;
  if (l.lead_status === 'drafted' || l.lead_status === 'approved') return 0.65;
  if (l.last_inbound_at) {
    const ageHours = (Date.now() - Date.parse(l.last_inbound_at)) / 3_600_000;
    if (ageHours < 48) return 0.85;
  }
  return l.digest_date === new Date().toISOString().slice(0, 10) ? 0.45 : 0.2;
}

function directoryTimingLabel(l: SignalLeadWithContacts): string {
  if (l.needs_reply || l.nurture_stage === 'replied') return 'Needs reply';
  if (l.nurture_stage === 'connect_sent' || l.nurture_stage === 'dm_sent') return 'Sequence active';
  if (l.lead_status === 'drafted') return 'Draft ready';
  if (l.digest_date === new Date().toISOString().slice(0, 10)) return 'New today';
  return 'In backlog';
}

function intentReasons(flags: SignalLeadWithContacts['intent_flags']): string[] {
  const out: string[] = [];
  if (flags?.raised) out.push('Raised-funding intent');
  if (flags?.hiring) out.push('Hiring signal');
  if (flags?.seeking_investors) out.push('Seeking investors');
  if (flags?.seeking_tools) out.push('Seeking tools');
  return out;
}

function directoryNextAction(l: SignalLeadWithContacts, reachable: number): string {
  if (l.needs_reply || l.nurture_stage === 'replied') return 'Reply';
  if (l.lead_status === 'sent') return 'Track reply';
  if (l.lead_status === 'drafted' || l.outreach?.draft_text) return 'Review draft';
  if (reachable <= 0) return 'Resolve contact';
  return 'Draft message';
}

function directoryQuality(l: SignalLeadWithContacts, reachable: number, urgency: number): LeadQualityBreakdown {
  const fit = clamp01(l.fit_score ?? l.rank_score);
  const reasons: string[] = [];
  const blockers: string[] = [];
  const neutralFit = Math.abs(fit - 0.5) < 0.001;

  if (neutralFit) reasons.push('Neutral ICP score - review fit or refine ICP');
  else reasons.push(`${fitLabel(fit)} (${fit.toFixed(2)})`);

  reasons.push(sourceReason(l.source, l.batch));
  const tags = (l.tags ?? []).slice(0, 2).filter(Boolean);
  if (tags.length > 0) reasons.push(`Tags: ${tags.join(', ')}`);
  reasons.push(...intentReasons(l.intent_flags));
  if (reachable <= 0) blockers.push('No reachable contact yet');

  let tier: LeadQualityTier = 'low';
  let label = 'Needs review';
  if (l.needs_reply || l.nurture_stage === 'replied') {
    tier = 'urgent';
    label = 'Needs reply';
  } else if (reachable <= 0 && fit >= 0.55) {
    tier = 'needs_contact';
    label = 'Good fit - needs contact';
  } else if (fit >= 0.75) {
    tier = 'high';
    label = 'Strong fit';
  } else if (fit >= 0.45) {
    tier = 'medium';
    label = 'Possible fit';
  } else {
    tier = 'needs_review';
    label = 'Needs review';
  }

  if (urgency >= 0.65 && label !== 'Needs reply') reasons.push(directoryTimingLabel(l));

  return {
    tier,
    label,
    fitLabel: fitLabel(fit),
    reachabilityLabel: reachabilityLabel(reachable),
    timingLabel: directoryTimingLabel(l),
    reasons: Array.from(new Set(reasons)).slice(0, 4),
    blockers,
  };
}

function signalQuality(e: SignalEventWithPost, reachable: number): LeadQualityBreakdown {
  const confidence = clamp01(e.confidence ?? 0);
  const reasons = [
    fitLabel(confidence, true),
    sourceReason((e.raw_post?.platform === 'linkedin' ? 'linkedin' : 'x'), e.batch),
  ];
  if (e.signal_summary) reasons.push(e.signal_summary);
  if (e.batch) reasons.push(e.batch);
  const blockers = reachable > 0 ? [] : ['No direct messaging channel yet'];

  return {
    tier: reachable > 0 ? (confidence >= 0.75 ? 'high' : 'medium') : 'needs_contact',
    label: reachable > 0 ? 'Live signal' : 'Signal - needs contact',
    fitLabel: fitLabel(confidence, true),
    reachabilityLabel: reachabilityLabel(reachable),
    timingLabel: 'New signal',
    reasons: Array.from(new Set(reasons.filter(Boolean))).slice(0, 4),
    blockers,
  };
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
  const contact =
    e.signal_type === 'keyword_match' && e.raw_post?.author_handle
      ? {
          name: e.person_name ?? e.raw_post.author_name ?? e.raw_post.author_handle,
          x_handle: e.raw_post.author_handle,
        }
      : e.person_name
        ? { name: e.person_name }
        : null;
  const fitScore = clamp01(e.confidence ?? 0);
  const reachabilityScore = contactReachability(contact, null);
  const urgencyScore = 0.5;
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
    contact,
    contactStatus: null,
    fitScore,
    urgencyScore,
    reachabilityScore,
    score: fitScore,
    quality: signalQuality(e, reachabilityScore),
    nextActionLabel: reachabilityScore > 0 ? 'Draft message' : 'Review signal',
    status: SIGNAL_STATUS_TO_LEAD_STATUS[e.status],
    detectedAt: e.created_at,
    firstSeenAt: e.created_at,
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
  const contact = pc
    ? { name: pc.name, role: pc.role, linkedin_url: pc.linkedin_url, x_handle: pc.x_handle, email: pc.email }
    : null;
  const fitScore = clamp01(l.fit_score ?? l.rank_score ?? 0);
  const urgencyScore = directoryUrgency(l);
  const reachabilityScore = contactReachability(contact, l.contact_status);
  const quality = directoryQuality(l, reachabilityScore, urgencyScore);
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
    contact,
    contactStatus: l.contact_status,
    fitScore,
    urgencyScore,
    reachabilityScore,
    score: (l.rank_score ?? l.fit_score ?? 0) + warmFeedBoost(l),
    quality,
    nextActionLabel: directoryNextAction(l, reachabilityScore),
    status: l.needs_reply ? 'needs_reply' : l.lead_status,
    detectedAt: l.last_inbound_at ?? l.last_seen_at ?? l.first_seen_at,
    firstSeenAt: l.first_seen_at ?? null,
    nurtureStage: (l.nurture_stage as NurtureStage | null | undefined) ?? null,
    needsReply: l.needs_reply ?? false,
  };
}
