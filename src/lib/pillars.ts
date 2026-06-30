/**
 * Shared helpers for multi-pillar posts + pillar weighting.
 *
 * A post carries a `pillars` array AND a single `pillar` (kept in sync as the
 * primary). Each pillar can also carry an importance weight (1-100) in
 * `pillar_weights` ({ slug: weight }), so downstream AI generation and hook
 * retrieval know which topics matter most ("mainly X, also touches Y, Z").
 *
 * The primary `pillar` exists for backward compatibility so every existing
 * reader keeps working; it is always the highest-weight pillar (ties broken by
 * original order), and `pillars` is ordered primary-first to match.
 */

/** Neutral default weight when a pillar has no explicit importance set. */
export const DEFAULT_PILLAR_WEIGHT = 50;

/** Weight assigned to the primary pillar when backfilling legacy single-pillar rows. */
export const PRIMARY_BACKFILL_WEIGHT = 70;
/** Weight assigned to secondary pillars when backfilling legacy rows. */
export const SECONDARY_BACKFILL_WEIGHT = 40;

/** A pillar paired with its importance weight. */
export interface WeightedPillar {
  slug: string;
  weight: number;
}

/**
 * Canonicalizes a pillar slug so variant spellings resolve to one value:
 * lowercases, trims, converts underscores/whitespace to hyphens, and collapses
 * repeats. This makes resolution tolerant of legacy `hot_take` vs `hot-take`
 * and of raw display names ("Hot Take") accidentally used as slugs.
 */
export function normalizePillarSlug(slug: string): string {
  return slug
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Clamps an arbitrary numeric input into the valid 1-100 weight range. */
export function clampWeight(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : DEFAULT_PILLAR_WEIGHT;
  return Math.min(100, Math.max(1, v));
}

/**
 * Returns a post/idea's pillars as a normalized array, tolerating older rows
 * that only have the single `pillar` field (pre-migration or legacy writers).
 * Slugs are canonicalized so reads are immune to underscore/hyphen drift.
 */
export function postPillars(item: { pillar?: string | null; pillars?: string[] | null }): string[] {
  const arr =
    Array.isArray(item.pillars) && item.pillars.length > 0
      ? item.pillars
      : item.pillar
        ? [item.pillar]
        : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    if (typeof raw !== 'string') continue;
    const slug = normalizePillarSlug(raw);
    if (slug && !seen.has(slug)) {
      seen.add(slug);
      out.push(slug);
    }
  }
  return out;
}

/**
 * Reads a row's `pillar_weights` map, canonicalizing keys and clamping values.
 * Returns an empty map when none are stored.
 */
export function pillarWeights(item: { pillar_weights?: Record<string, number> | null }): Record<string, number> {
  const raw = item.pillar_weights;
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw)) {
    const slug = normalizePillarSlug(k);
    if (slug) out[slug] = clampWeight(v);
  }
  return out;
}

/**
 * Returns a row's pillars paired with weights, sorted by importance (highest
 * first; ties keep original order). Missing weights fall back to an optional
 * profile-level weight map, then to the neutral default. This is the canonical
 * source for "which pillars, in what priority" used by UI, analytics, and AI.
 */
export function weightedPillars(
  item: { pillar?: string | null; pillars?: string[] | null; pillar_weights?: Record<string, number> | null },
  profileWeights?: Record<string, number> | null,
): WeightedPillar[] {
  const slugs = postPillars(item);
  const explicit = pillarWeights(item);
  const profile = profileWeights ?? {};
  return slugs
    .map((slug, index) => ({
      slug,
      weight: explicit[slug] ?? profile[slug] ?? DEFAULT_PILLAR_WEIGHT,
      index,
    }))
    .sort((a, b) => (b.weight - a.weight) || (a.index - b.index))
    .map(({ slug, weight }) => ({ slug, weight }));
}

/**
 * Normalizes pillar input into a consistent { pillar, pillars, pillar_weights }
 * triple for persistence: canonicalizes + de-dupes slugs, attaches weights
 * (defaulting missing ones), orders pillars primary-first by weight, and keeps
 * `pillar` = the highest-weight pillar for backward compatibility.
 *
 * Accepts either a `pillars` array (preferred) or a legacy single `pillar`, and
 * always returns at least one pillar.
 */
export function normalizePillars(input: {
  pillar?: string | null;
  pillars?: string[] | null;
  pillar_weights?: Record<string, number> | null;
}): { pillar: string; pillars: string[]; pillar_weights: Record<string, number> } {
  const slugs = postPillars(input);
  const base = slugs.length > 0 ? slugs : ['general'];

  const explicit = pillarWeights(input);
  const ordered = base
    .map((slug, index) => ({ slug, weight: explicit[slug] ?? DEFAULT_PILLAR_WEIGHT, index }))
    .sort((a, b) => (b.weight - a.weight) || (a.index - b.index));

  const pillars = ordered.map((p) => p.slug);
  const pillar_weights: Record<string, number> = {};
  for (const p of ordered) pillar_weights[p.slug] = p.weight;

  return { pillar: pillars[0], pillars, pillar_weights };
}

/**
 * Extracts a { slug: weight } map from a creator profile's content_pillars
 * config (each entry is { name, weight? }). Names are slugified to match how
 * post/idea pillars are stored. Used as the profile-level default that posts
 * inherit when they don't set their own per-pillar weight.
 */
export function profilePillarWeights(
  contentPillars: Array<{ name?: string; weight?: number }> | null | undefined,
): Record<string, number> {
  if (!Array.isArray(contentPillars)) return {};
  const out: Record<string, number> = {};
  for (const p of contentPillars) {
    if (!p?.name) continue;
    const slug = normalizePillarSlug(p.name);
    if (slug) out[slug] = clampWeight(p.weight ?? DEFAULT_PILLAR_WEIGHT);
  }
  return out;
}
