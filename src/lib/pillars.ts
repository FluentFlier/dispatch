/**
 * Shared helpers for multi-pillar posts.
 *
 * A post carries a `pillars` array AND a single `pillar` (always kept in sync as
 * pillars[0]). The primary `pillar` exists for backward compatibility so every
 * existing reader keeps working; new UI reads/writes the full `pillars` array.
 */

/**
 * Normalizes pillar input into a consistent { pillar, pillars } pair: trims,
 * de-dupes, and keeps the first as the primary. Accepts either an array
 * (preferred) or a legacy single pillar, and always returns at least one.
 */
export function normalizePillars(input: {
  pillar?: string | null;
  pillars?: string[] | null;
}): { pillar: string; pillars: string[] } {
  const fromArray = (input.pillars ?? [])
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean);
  const unique = Array.from(new Set(fromArray));

  if (unique.length > 0) {
    return { pillar: unique[0], pillars: unique };
  }

  const single = input.pillar?.trim();
  if (single) return { pillar: single, pillars: [single] };

  return { pillar: 'general', pillars: ['general'] };
}

/**
 * Returns a post's pillars as an array, tolerating older rows that only have the
 * single `pillar` field (pre-migration or legacy writers).
 */
export function postPillars(post: { pillar?: string | null; pillars?: string[] | null }): string[] {
  if (Array.isArray(post.pillars) && post.pillars.length > 0) return post.pillars;
  return post.pillar ? [post.pillar] : [];
}
