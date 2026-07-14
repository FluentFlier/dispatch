/**
 * Client-safe pillar de-duplication helpers (no server/dataset imports, so they
 * can be used in client components). Used to hide redundant pillar suggestions
 * like "AI" when the user already has "Artificial Intelligence".
 */

/**
 * Common abbreviation/synonym aliases, keyed and valued by canonical form.
 */
const PILLAR_ALIASES: Record<string, string> = {
  ai: 'artificial intelligence',
  ml: 'machine learning',
  ux: 'user experience',
  ui: 'user interface',
  asu: 'arizona state university',
  diy: 'do it yourself',
  saas: 'software as a service',
  b2b: 'business to business',
  b2c: 'business to consumer',
};

/**
 * Normalize a pillar name for equivalence checks: lowercase, "&"->"and", strip
 * punctuation, collapse spaces, then resolve known abbreviations
 * (AI -> artificial intelligence).
 */
export function canonicalPillarName(name: string): string {
  const n = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return PILLAR_ALIASES[n] ?? n;
}

/**
 * True when a suggested pillar is already covered by one of the user's existing
 * pillars (exact, or via alias/synonym) - used to hide redundant suggestions.
 */
export function isPillarCovered(existingNames: string[], suggestionName: string): boolean {
  const s = canonicalPillarName(suggestionName);
  return existingNames.some((e) => canonicalPillarName(e) === s);
}
