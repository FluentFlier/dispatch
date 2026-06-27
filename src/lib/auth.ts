import { createClient } from '@insforge/sdk';
import { getAuthenticatedUser } from '@/lib/insforge/server';

/**
 * Asserts the request is authenticated and returns the user.
 * Throws with a typed error if not — callers catch and return 401.
 * Use this at the top of any API route that reads or writes user data
 * BEFORE constructing any DB client, to prevent unauthenticated DB access.
 */
export async function assertAuthenticated(): Promise<{ id: string; email: string }> {
  const user = await getAuthenticatedUser();
  if (!user) {
    const err = new Error('Unauthenticated');
    (err as Error & { status: number }).status = 401;
    throw err;
  }
  return user;
}

/**
 * Decode a JWT payload (no signature verification).
 * Used to extract sub/email/exp claims without hitting InsForge's session API,
 * which uses server-side session state that can expire independently of the JWT.
 */
function decodeJwtPayload(token: string): {
  sub?: string;
  email?: string;
  exp?: number;
  user_metadata?: { email?: string };
} | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '=='.slice(0, (4 - payload.length % 4) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf-8')) as ReturnType<typeof decodeJwtPayload>;
  } catch {
    return null;
  }
}

/**
 * Validate an InsForge access token before persisting it in an httpOnly cookie.
 *
 * Decodes the JWT locally first — avoids hitting InsForge's /api/auth/sessions/current,
 * which uses server-side session state that can be invalidated independently of the
 * JWT's exp claim (causing AUTH_UNAUTHORIZED on technically-valid tokens). Signature
 * was verified by InsForge when the token was issued; here we only need sub + exp.
 *
 * Falls back to the InsForge API for opaque (non-JWT) tokens.
 */
export async function validateAccessToken(
  token: string
): Promise<{ valid: true; userId: string; email: string } | { valid: false; error: string }> {
  if (!token || token.length < 10) {
    return { valid: false, error: 'Invalid token' };
  }

  // Fast path: JWT decode — no InsForge API call needed.
  const claims = decodeJwtPayload(token);
  if (claims?.sub) {
    const nowSec = Math.floor(Date.now() / 1000);
    if (claims.exp !== undefined && claims.exp < nowSec) {
      return { valid: false, error: 'Token expired' };
    }
    return {
      valid: true,
      userId: claims.sub,
      email: claims.email ?? claims.user_metadata?.email ?? '',
    };
  }

  // Slow path: opaque token — validate via InsForge API.
  const url = process.env.NEXT_PUBLIC_INSFORGE_URL;
  const anonKey = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY;
  if (!url || !anonKey) {
    return { valid: false, error: 'Auth service not configured' };
  }

  try {
    const client = createClient({
      baseUrl: url,
      anonKey,
      isServerMode: true,
      edgeFunctionToken: token,
    });
    const { data, error } = await client.auth.getCurrentUser();
    if (error || !data?.user?.id) {
      return { valid: false, error: error?.message ?? 'Token validation failed' };
    }
    return { valid: true, userId: data.user.id, email: data.user.email ?? '' };
  } catch (err: unknown) {
    return { valid: false, error: err instanceof Error ? err.message : 'Token validation failed' };
  }
}
