/**
 * Lifetime of a pre-connect snapshot ("bind permit").
 *
 * A snapshot row records which Unipile accounts already existed in the shared
 * tenant at the moment a user clicked Connect. A later account that is NOT in
 * that set is treated as produced by this user's connect, which is the only
 * ownership signal the shared-subscription model gives us.
 *
 * That signal is only meaningful while the user's hosted auth link is live. The
 * link is minted with a 10-minute expiry, so a permit older than that cannot
 * correspond to an in-flight login. Keeping it valid forever is what allowed a
 * bind with no authentication: click Connect, abandon the LinkedIn login, and
 * days later any new account in the tenant would silently become yours.
 *
 * 15 minutes = the 10-minute link plus slack for webhook delivery and clock skew.
 */
export const CONNECT_SNAPSHOT_TTL_MS = 15 * 60 * 1000;

/**
 * True when a snapshot is too old to prove ownership (or has no usable
 * timestamp). Fails CLOSED: an unparseable or missing `created_at` counts as
 * expired, because an unknown-age permit is exactly the case we cannot trust.
 */
export function isSnapshotExpired(createdAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!createdAt) return true;
  const ts = Date.parse(createdAt);
  if (Number.isNaN(ts)) return true;
  return now - ts > CONNECT_SNAPSHOT_TTL_MS;
}
