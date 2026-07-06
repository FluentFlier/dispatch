/**
 * Extracts a LinkedIn post identifier from user-pasted input: a full post URL,
 * a bare URN, or a raw numeric activity id. Client-safe (no server deps).
 *
 * WHY: users grab targets by copying a post link from LinkedIn; the queue and
 * Unipile need the activity URN behind that link.
 */
export function parseLinkedInPostTarget(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Already a URN (urn:li:activity:..., urn:li:share:..., urn:li:ugcPost:...)
  const urnMatch = trimmed.match(/urn:li:(?:activity|share|ugcPost):\d+/i);
  if (urnMatch) return urnMatch[0];

  // Feed/post URLs embed the activity id: ...-activity-7212345... or /activity/7212345
  const activityMatch = trimmed.match(/activity[-/:](\d{10,25})/i);
  if (activityMatch) return `urn:li:activity:${activityMatch[1]}`;

  // Raw numeric id
  if (/^\d{10,25}$/.test(trimmed)) return `urn:li:activity:${trimmed}`;

  return null;
}
