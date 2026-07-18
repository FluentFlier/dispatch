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
    contact: pc
      ? { name: pc.name, role: pc.role, linkedin_url: pc.linkedin_url, x_handle: pc.x_handle, email: pc.email }
      : null,
    contactStatus: l.contact_status,
    score: (l.rank_score ?? l.fit_score ?? 0) + warmFeedBoost(l),
    status: l.needs_reply ? 'needs_reply' : l.lead_status,
    detectedAt: l.last_inbound_at ?? l.last_seen_at ?? l.first_seen_at,
    firstSeenAt: l.first_seen_at ?? null,
    nurtureStage: (l.nurture_stage as NurtureStage | null | undefined) ?? null,
    needsReply: l.needs_reply ?? false,
    snoozedUntil: l.snoozed_until ?? null,
  };
}
