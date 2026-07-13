/** PKCE verifier key used by @insforge/sdk during OAuth sign-in. */
export const INSFORGE_PKCE_VERIFIER_KEY = 'insforge_pkce_verifier';

/**
 * Canonical origin OAuth must run on. Vercel gives every preview/deploy a unique
 * random hostname that InsForge can't allow-list, so we centralize auth here:
 * non-canonical origins bounce to this before OAuth starts (keeps PKCE same-origin).
 */
export const CANONICAL_AUTH_ORIGIN = 'https://contentos.us';

/** True if `origin` is one InsForge allow-lists for OAuth redirects. */
export function isAuthCapableOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
    return origin === CANONICAL_AUTH_ORIGIN || hostname === 'contentos.us';
  } catch {
    return false;
  }
}
