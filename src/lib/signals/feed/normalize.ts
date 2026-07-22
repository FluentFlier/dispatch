/**
 * Unified feed normalizer.
 *
 * Maps directory leads (and engager cards elsewhere) into one
 * `UnifiedLeadCard` the feed UI renders generically. The retired signal-events
 * source is gone; detected signals now live ON the lead (intent flags via the
 * intent bridge) and surface here through last_signal_*.
 */

import type {
  NurtureStage, SignalLeadWithContacts, SignalType,
} from '@/lib/signals/types';
import { icpFitPhrase } from '@/lib/signals/leads/summary';

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
  /** ICP fit without urgency boosts. Used for "Best fit" sorting. */
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
  /** Hidden from the feed until this timestamp (directory leads only). */
  snoozedUntil?: string | null;
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

function clamp01(n: number | null | undefined): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Reachability is about having a channel you can actually message, not about
 * having a contact name. A hydrated contact with no LinkedIn / X / email is a
 * blocker to surface, not a lead you can act on.
 */
function contactReachability(contact: UnifiedContact | null, contactStatus?: string | null): number {
  if (contactStatus === 'no_contact' || !contact) return 0;
  return contact.linkedin_url || contact.x_handle || contact.email ? 1 : 0;
}

function sourceReason(source: UnifiedLeadCard['source'], batch?: string | null): string {
  if (source === 'yc_directory' || source === 'yc_launches') return batch ? `YC ${batch}` : 'YC company';
  if (source === 'product_hunt') return batch ? `Product Hunt ${batch}` : 'Product Hunt listing';
  if (source === 'web_discovery') return 'Found from ICP web discovery';
  if (source === 'manual') return 'Imported lead';
  if (source === 'linkedin') return 'LinkedIn signal';
  return 'X signal';
}

function reachabilityLabel(score: number): string {
  return score > 0 ? 'Contact ready' : 'Needs contact';
}

/**
 * How time-sensitive this lead is, kept apart from fit. A replied prospect is
 * urgent regardless of ICP score; a strong ICP match sitting in the backlog is
 * not. Mixing the two into one number is what made "Score" sorting misleading.
 */
function directoryUrgency(l: SignalLeadWithContacts): number {
  if (l.needs_reply || l.nurture_stage === 'replied') return 1;
  if (l.last_inbound_at && (Date.now() - Date.parse(l.last_inbound_at)) / 3_600_000 < 48) return 0.85;
  if (l.nurture_stage === 'connect_sent' || l.nurture_stage === 'dm_sent') return 0.75;
  if (l.lead_status === 'drafted' || l.lead_status === 'approved') return 0.65;
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

/**
 * Why this card is worth reviewing, in words. Tiers follow `icpFitPhrase`'s
 * thresholds so the feed card and the "Why pursue" line in the detail panel
 * never disagree, and an unscored lead makes no ICP claim at all.
 */
function directoryQuality(l: SignalLeadWithContacts, reachable: number, urgency: number): LeadQualityBreakdown {
  const fit = clamp01(l.fit_score);
  const fitPhrase = icpFitPhrase(fit);
  const reasons: string[] = [fitPhrase ? `${fitPhrase} (${Math.round(fit * 100)}% ICP fit)` : 'Not scored against your ICP yet'];

  reasons.push(sourceReason(l.source, l.batch));
  const tags = (l.tags ?? []).slice(0, 2).filter(Boolean);
  if (tags.length > 0) reasons.push(`Tags: ${tags.join(', ')}`);
  reasons.push(...intentReasons(l.intent_flags));

  let tier: LeadQualityTier;
  let label: string;
  if (l.needs_reply || l.nurture_stage === 'replied') {
    tier = 'urgent';
    label = 'Needs reply';
  } else if (reachable <= 0 && fit >= 0.7) {
    tier = 'needs_contact';
    label = 'Strong match - needs contact';
  } else if (fit >= 0.7) {
    tier = 'high';
    label = 'Strong match';
  } else if (fit >= 0.4) {
    tier = 'medium';
    label = 'Partial match';
  } else if (fit > 0) {
    tier = 'low';
    label = 'Weak match';
  } else {
    tier = 'needs_review';
    label = 'Needs review';
  }

  if (urgency >= 0.65 && tier !== 'urgent') reasons.push(directoryTimingLabel(l));

  return {
    tier,
    label,
    fitLabel: fitPhrase ?? 'Not scored',
    reachabilityLabel: reachabilityLabel(reachable),
    timingLabel: directoryTimingLabel(l),
    reasons: Array.from(new Set(reasons)).slice(0, 4),
    blockers: reachable <= 0 ? ['No reachable contact yet'] : [],
  };
}

export function normalizeLead(l: SignalLeadWithContacts): UnifiedLeadCard {
  const pc = l.primary_contact ?? null;
  // Ported signals (intent bridge) take precedence: a detected funding /
  // accelerator / role-change / keyword signal on the lead surfaces as the
  // card's signal. Otherwise a Product Hunt listing / YC "launch" post IS a
  // launch event, so those sources carry the 'launch' type - this keeps the
  // "Launched" feed filter matching scraped directory leads.
  const flags = l.intent_flags ?? {};
  const portedType = (flags.last_signal_type as SignalType | undefined) ?? null;
  const signalType: SignalType | null =
    portedType ??
    (l.source === 'product_hunt' || l.source === 'yc_launches' ? 'launch' : null);
  const contact = pc
    ? { name: pc.name, role: pc.role, linkedin_url: pc.linkedin_url, x_handle: pc.x_handle, email: pc.email }
    : null;
  const fitScore = clamp01(l.fit_score);
  const urgencyScore = directoryUrgency(l);
  const reachabilityScore = contactReachability(contact, l.contact_status);
  return {
    id: l.id,
    kind: 'directory',
    source: l.source,
    companyName: l.company_name,
    tagline: l.tagline,
    signalType,
    signalSummary: (portedType ? flags.last_signal_summary : null) ?? l.tagline,
    sourceUrl: l.website,
    batch: l.batch,
    accelerator: l.source === 'yc_directory' || l.source === 'yc_launches' ? 'Y Combinator' : null,
    contact,
    contactStatus: l.contact_status,
    fitScore,
    urgencyScore,
    reachabilityScore,
    score: (l.rank_score ?? l.fit_score ?? 0) + warmFeedBoost(l),
    quality: directoryQuality(l, reachabilityScore, urgencyScore),
    nextActionLabel: directoryNextAction(l, reachabilityScore),
    status: l.needs_reply ? 'needs_reply' : l.lead_status,
    detectedAt: l.last_inbound_at ?? l.last_seen_at ?? l.first_seen_at,
    firstSeenAt: l.first_seen_at ?? null,
    nurtureStage: (l.nurture_stage as NurtureStage | null | undefined) ?? null,
    needsReply: l.needs_reply ?? false,
    snoozedUntil: l.snoozed_until ?? null,
  };
}
