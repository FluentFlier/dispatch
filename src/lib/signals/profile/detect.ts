import type { ClassifiedSignal } from '@/lib/signals/types';

export interface ProfileState {
  profileKey: string;
  providerId?: string;
  fullName?: string;
  headline?: string;
}

/** Normalize a headline for change comparison (case + whitespace insensitive). */
export function normalizeHeadline(headline: string | undefined | null): string {
  return (headline ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Extracts a company name from a LinkedIn headline. Matches "... at Company",
 * "@Company", or "Role, Company". Returns undefined when nothing proper-noun-ish
 * is found (so the caller falls back to the person, never an article).
 */
export function extractCompanyFromHeadline(headline: string | undefined): string | undefined {
  if (!headline) return undefined;
  const at = headline.match(/(?:\bat\b\s+|@\s*)([A-Z][A-Za-z0-9.&' -]{1,40})/);
  if (at?.[1]) return at[1].trim().replace(/[.,]+$/, '');
  return undefined;
}

/**
 * Detects a role change between a stored profile baseline and the current state.
 * Returns a role_change ClassifiedSignal when the headline changed and a prior
 * baseline exists; returns null when there is no baseline (first sight) or the
 * headline is unchanged. Never treats an empty new headline as a change (a failed
 * fetch should not fabricate a role change).
 */
export function detectRoleChange(
  previous: ProfileState | null,
  current: ProfileState,
): ClassifiedSignal | null {
  const newHeadline = (current.headline ?? '').trim();
  if (!newHeadline) return null; // no data - don't invent a change
  if (!previous) return null; // baseline only on first sight
  if (normalizeHeadline(previous.headline) === normalizeHeadline(newHeadline)) return null;

  const company = extractCompanyFromHeadline(newHeadline);
  const person = current.fullName?.trim() || current.profileKey;
  const prevHeadline = previous.headline?.trim();

  return {
    signalType: 'role_change',
    companyName: company,
    personName: person,
    acceleratorName: undefined,
    batch: undefined,
    signalSummary: prevHeadline
      ? `Role change: ${person} - "${prevHeadline}" -> "${newHeadline}"`
      : `Role change: ${person} - now "${newHeadline}"`,
    confidence: 0.8,
    // Dedupe on the NEW headline so the same change fires once, but a later,
    // different change produces a fresh signal.
    dedupeKey: `role_change|${current.profileKey.toLowerCase()}|${normalizeHeadline(newHeadline)}`,
    matchedKeywords: [],
  };
}
