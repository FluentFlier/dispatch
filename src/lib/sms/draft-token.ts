import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Stateless, signed magic-link tokens for SMS draft editing.
 *
 * WHY stateless HMAC (no DB row): the token itself carries the draft id, owner,
 * and expiry, signed with a server secret. A recipient can open the link
 * without logging in, but cannot forge or tamper with it, and it expires on its
 * own - no `draft_tokens` table to maintain or clean up.
 *
 * Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256).
 */

export interface DraftTokenPayload {
  /** The post/draft this link edits. */
  postId: string;
  /** Owner user id - inbound replies must match this. */
  userId: string;
  /** Unix seconds expiry. */
  exp: number;
}

/** Default token lifetime: 7 days. */
export const DRAFT_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Resolve the signing secret. Falls back to TOKEN_ENCRYPTION_KEY so the feature
 * works wherever token encryption is already configured; a dedicated
 * DRAFT_TOKEN_SECRET takes precedence when set.
 */
function getSecret(): string {
  const secret = process.env.DRAFT_TOKEN_SECRET || process.env.TOKEN_ENCRYPTION_KEY;
  if (!secret) throw new Error('DRAFT_TOKEN_SECRET (or TOKEN_ENCRYPTION_KEY) is required to sign draft tokens');
  return secret;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

/**
 * Create a signed token for a draft. `nowSeconds` is injectable for testing;
 * defaults to the current time.
 */
export function signDraftToken(
  payload: Omit<DraftTokenPayload, 'exp'>,
  ttlSeconds: number = DRAFT_TOKEN_TTL_SECONDS,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const full: DraftTokenPayload = { ...payload, exp: nowSeconds + ttlSeconds };
  const body = b64url(JSON.stringify(full));
  const sig = sign(body, getSecret());
  return `${body}.${sig}`;
}

/**
 * Verify a token's signature and expiry. Returns the payload when valid, or
 * null for any tampering, malformed input, or expiry. `nowSeconds` is
 * injectable for testing.
 */
export function verifyDraftToken(
  token: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): DraftTokenPayload | null {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;

  let expectedSig: string;
  try {
    expectedSig = sign(body, getSecret());
  } catch {
    return null;
  }

  // Constant-time comparison to avoid signature timing leaks.
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: DraftTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (
    typeof payload?.postId !== 'string' ||
    typeof payload?.userId !== 'string' ||
    typeof payload?.exp !== 'number'
  ) {
    return null;
  }
  if (payload.exp < nowSeconds) return null;

  return payload;
}
