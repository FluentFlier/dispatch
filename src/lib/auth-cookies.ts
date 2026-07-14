/** Shared httpOnly session cookie names and options for Content OS auth. */
export const AUTH_COOKIE = {
  access: 'content-os-token',
  refresh: 'content-os-refresh',
} as const;

/** 30 days - longer than typical JWT exp so refresh can run before cookie disappears. */
export const AUTH_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 30;

export const AUTH_COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: AUTH_COOKIE_MAX_AGE_SEC,
};

/**
 * Decode JWT exp (seconds since epoch). Returns null for opaque/non-JWT tokens.
 */
export function decodeJwtExpSec(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '=='.slice(0, (4 - (payload.length % 4)) % 4);
    const decoded =
      typeof atob === 'function'
        ? atob(padded)
        : Buffer.from(padded, 'base64').toString('utf-8');
    const claims = JSON.parse(decoded) as { exp?: number };
    return typeof claims.exp === 'number' ? claims.exp : null;
  } catch {
    return null;
  }
}

/**
 * True when token is a JWT whose exp is in the past (with small clock skew).
 * Opaque tokens return false so server-side validation can handle them.
 */
export function isJwtExpired(token: string, skewSec = 30): boolean {
  const exp = decodeJwtExpSec(token);
  if (exp === null) return false;
  return exp < Math.floor(Date.now() / 1000) + skewSec;
}
