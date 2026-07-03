import type { LeadIntentFlags, SignalLeadContactRow } from '@/lib/signals/types';

/**
 * Company identity + change classification. These are the pure decisions behind
 * the "companies rename/pivot" pain: identity is anchored on stable keys
 * (external_id / domain), never the display name, so a rename auto-reconciles
 * instead of dropping the lead. Kept pure (no DB) so every scenario is testable.
 */

/**
 * Normalizes a website/URL to a bare host (the stable identity anchor). Strips
 * protocol, www, path, and lowercases so variants of one company collapse to the
 * same domain — this is what survives a rename.
 */
export function normalizeDomain(website?: string | null): string | null {
  if (!website) return null;
  try {
    const withProto = website.includes('://') ? website : `https://${website}`;
    const host = new URL(withProto).hostname.toLowerCase();
    return host.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

export type LeadChangeKind = 'new' | 'renamed' | 'pivoted' | 'unchanged';

export interface ExistingLeadShape {
  company_name: string;
  tags?: string[];
  tagline?: string | null;
  name_history?: string[];
}

export interface IncomingLeadShape {
  companyName: string;
  tags?: string[];
  tagline?: string;
}

/** Normalizes a company name for exact-match tiebreak (lowercase, strip legal suffix). */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[,.]/g, ' ')
    .replace(/\b(inc|llc|ltd|co|corp|company)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Stable anchor for dedupe/matching: external_id → domain → normalized name. */
export function anchorKey(input: {
  externalId?: string | null;
  domain?: string | null;
  website?: string | null;
  companyName: string;
}): string {
  if (input.externalId) return `ext:${input.externalId}`;
  const domain = input.domain ?? normalizeDomain(input.website);
  if (domain) return `dom:${domain}`;
  return `name:${normalizeName(input.companyName)}`;
}

/** True when two tag/tagline sets differ materially (drives a pivot decision). */
function contentShifted(existing: ExistingLeadShape, incoming: IncomingLeadShape): boolean {
  const a = new Set((existing.tags ?? []).map((t) => t.toLowerCase()));
  const b = (incoming.tags ?? []).map((t) => t.toLowerCase());
  const tagsDiffer = b.length > 0 && (b.length !== a.size || b.some((t) => !a.has(t)));
  const taglineDiffer =
    Boolean(incoming.tagline) && (existing.tagline ?? '').trim() !== incoming.tagline!.trim();
  return tagsDiffer || taglineDiffer;
}

/**
 * Classifies a re-scrape of a known anchor. Rename (name changed) auto-reconciles;
 * pivot (same name, shifted tags/tagline) triggers a re-score; else unchanged.
 * Returns `new` only when there is no existing row.
 */
export function classifyLeadChange(
  existing: ExistingLeadShape | null,
  incoming: IncomingLeadShape,
): { kind: LeadChangeKind; nameHistoryAdd?: string } {
  if (!existing) return { kind: 'new' };
  if (normalizeName(existing.company_name) !== normalizeName(incoming.companyName)) {
    return { kind: 'renamed', nameHistoryAdd: existing.company_name };
  }
  if (contentShifted(existing, incoming)) return { kind: 'pivoted' };
  return { kind: 'unchanged' };
}

/**
 * Strict company match (Q2 = no fuzzy): equal on external_id, OR equal
 * normalized domain, OR exact normalized name. Two different companies with
 * similar names but different domains never match — protects cold outreach.
 */
export function companiesMatch(
  a: { externalId?: string | null; domain?: string | null; website?: string | null; companyName: string },
  b: { externalId?: string | null; domain?: string | null; website?: string | null; companyName: string },
): boolean {
  if (a.externalId && b.externalId) return a.externalId === b.externalId;
  const da = a.domain ?? normalizeDomain(a.website);
  const db = b.domain ?? normalizeDomain(b.website);
  if (da && db) return da === db;
  return normalizeName(a.companyName) === normalizeName(b.companyName);
}

export interface ContactDecision {
  status: 'resolved' | 'no_contact';
  primaryIndex: number | null;
  via?: 'scraped';
}

/**
 * Contact-resolution decision from scraped data alone (step 1 of the ladder):
 * resolved if any contact carries a usable social identifier, preferring a
 * CEO/Founder title, else the first resolvable one. Enrichment (Apify/Unipile)
 * layers on after this in resolve-contact.ts.
 */
export function decideContactStatus(
  contacts: Array<Pick<SignalLeadContactRow, 'linkedin_url' | 'x_handle' | 'role'>>,
): ContactDecision {
  const resolvableIdx = contacts
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => Boolean(c.linkedin_url || c.x_handle));
  if (resolvableIdx.length === 0) return { status: 'no_contact', primaryIndex: null };

  const preferred =
    resolvableIdx.find(({ c }) => /ceo|founder/i.test(c.role ?? '')) ?? resolvableIdx[0];
  return { status: 'resolved', primaryIndex: preferred.i, via: 'scraped' };
}

/** Hard intent = signals strong enough to resurface even a dismissed lead. */
export function hasHardIntent(flags: LeadIntentFlags): boolean {
  return Boolean(flags.raised || flags.seeking_investors);
}

/**
 * Maps a post-watcher signal_type to lead intent flags. Funding is hard intent
 * (raised); role changes imply hiring/growth (soft); others carry no flag but
 * still count as an intent signal for an active lead.
 */
export function intentFromSignalType(signalType: string): LeadIntentFlags {
  switch (signalType) {
    case 'funding_round':
      return { raised: true };
    case 'role_change':
      return { hiring: true };
    default:
      return {};
  }
}

export interface ResurfaceInput {
  leadStatus: string;
  isFollowed: boolean;
  intentFlags: LeadIntentFlags;
  /** Whether this cycle saw a real intent signal (vs a plain re-scrape). */
  gotIntentSignal: boolean;
}

/**
 * Reactivation policy (Phase 8): a lead resurfaces when a real intent signal
 * arrives. A dismissed lead resurfaces only on HARD intent (raised /
 * seeking_investors), never on a soft re-scrape — and a followed company always
 * resurfaces on hard intent regardless of a prior dismiss (explicit user intent).
 */
export function shouldResurface(input: ResurfaceInput): { resurface: boolean; reason?: string } {
  if (!input.gotIntentSignal) return { resurface: false };
  const hard = hasHardIntent(input.intentFlags);

  if (input.leadStatus === 'dismissed') {
    if (hard) return { resurface: true, reason: input.isFollowed ? 'followed + hard intent' : 'hard intent' };
    return { resurface: false };
  }

  if (hard || input.isFollowed) {
    return { resurface: true, reason: input.intentFlags.raised ? 'raised' : 'intent' };
  }
  return { resurface: true, reason: 'intent' };
}
