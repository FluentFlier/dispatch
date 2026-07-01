/**
 * Small pure helpers for the LinkedIn composer/preview. Kept out of the
 * component so the string logic is unit-testable.
 */

/** Length after which a LinkedIn feed post collapses behind "...more". */
export const SEE_MORE_AT = 210;

/** Up to two uppercase initials from a name, falling back to "Y" (You). */
export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts.slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return initials || 'Y';
}

/** Ensure a user-typed URL has a scheme so it links correctly. */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
