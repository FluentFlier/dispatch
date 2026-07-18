import type { ClassifiedSignal } from '@/lib/signals/types';

export interface ProfileState {
  profileKey: string;
  providerId?: string;
  fullName?: string;
  headline?: string;
  description?: string;
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

export type TrackedEntity = 'person' | 'company';

const norm = (v: string | undefined | null): string =>
  (v ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

function fieldChangeSignal(
  field: 'headline' | 'fullName' | 'description',
  previous: ProfileState,
  current: ProfileState,
  entity: TrackedEntity,
): ClassifiedSignal | null {
  const prev = (previous[field] ?? '').trim();
  const next = (current[field] ?? '').trim();
  if (!next) return null; // no data - don't invent a change
  if (norm(prev) === norm(next)) return null;

  const who = current.fullName?.trim() || current.profileKey;
  const fieldLabel = field === 'fullName' ? 'name' : field === 'headline' ? (entity === 'company' ? 'tagline' : 'headline') : 'description';
  const dedupeField = field === 'fullName' ? 'name' : field;

  return {
    signalType: 'field_change',
    companyName: entity === 'company' ? who : extractCompanyFromHeadline(current.headline),
    personName: entity === 'person' ? who : undefined,
    acceleratorName: undefined,
    batch: undefined,
    signalSummary: prev
      ? `${entity === 'company' ? 'Company' : 'Profile'} ${fieldLabel} change: ${who} - "${prev}" -> "${next}"`
      : `${entity === 'company' ? 'Company' : 'Profile'} ${fieldLabel} set: ${who} - "${next}"`,
    confidence: 0.8,
    dedupeKey: `field_change|${dedupeField}|${current.profileKey.toLowerCase()}|${norm(next)}`,
    matchedKeywords: [],
  };
}

/**
 * Diffs all tracked fields between baseline and current state.
 * Person headline changes keep firing as role_change (existing behavior and
 * Slack labels preserved); every other tracked field fires field_change.
 * First sight (no baseline) returns [] - baseline only.
 */
export function detectFieldChanges(
  previous: ProfileState | null,
  current: ProfileState,
  entity: TrackedEntity,
): ClassifiedSignal[] {
  if (!previous) return [];
  const out: ClassifiedSignal[] = [];

  if (entity === 'person') {
    const role = detectRoleChange(previous, current);
    if (role) out.push(role);
  } else {
    const headline = fieldChangeSignal('headline', previous, current, entity);
    if (headline) out.push(headline);
  }

  const name = fieldChangeSignal('fullName', previous, current, entity);
  if (name) out.push(name);
  const description = fieldChangeSignal('description', previous, current, entity);
  if (description) out.push(description);

  return out;
}
