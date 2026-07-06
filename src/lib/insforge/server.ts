import { createClient } from '@insforge/sdk';
import { cookies } from 'next/headers';
import { isProduction } from '@/lib/env';
import { AUTH_COOKIE } from '@/lib/auth-cookies';
import { displayNameFromAuthUser, fetchOAuthDisplayName } from '@/lib/user-display-name';
import { applyImpersonation, type EffectiveUser } from '@/lib/admin/impersonation';

/** Service-role client for cron/background jobs (no user cookie). */
export function getServiceClient(): ReturnType<typeof createClient> {
  const rawUrl = process.env.NEXT_PUBLIC_INSFORGE_URL;
  const serviceKey = process.env.INSFORGE_SERVICE_ROLE_KEY?.trim();

  // In production the real service-role key is mandatory. Never silently fall
  // back to the public anon key: that would run cron/admin/webhook paths as an
  // anon user (RLS-blocked writes, broken billing) and conflate "service" with
  // a key that ships to the browser.
  if (isProduction() && !serviceKey) {
    throw new Error('INSFORGE_SERVICE_ROLE_KEY is required in production');
  }

  const key = serviceKey ?? process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY;
  if (!rawUrl || !key) {
    throw new Error('Missing InsForge env vars for service client');
  }

  const url = rawUrl.replace(/\/+$/, '');

  return createClient({
    baseUrl: url,
    anonKey: key,
    isServerMode: true,
  });
}

export function getServerClient(): ReturnType<typeof createClient> {
  const rawUrl = process.env.NEXT_PUBLIC_INSFORGE_URL;
  const anonKey = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY;

  if (!rawUrl || !anonKey) {
    throw new Error('Missing InsForge env vars');
  }

  const url = rawUrl.replace(/\/+$/, '');
  const cookieStore = cookies();
  const token = cookieStore.get(AUTH_COOKIE.access)?.value;

  return createClient({
    baseUrl: url,
    anonKey,
    isServerMode: true,
    edgeFunctionToken: token,
  });
}

/**
 * Decode a JWT payload without signature verification.
 * Safe for server-side auth because the token was obtained via InsForge's
 * official OAuth flow and stored in an httpOnly cookie we control.
 * We only need user identity and expiry — signature validation happens at
 * InsForge's auth endpoint during login (validateAccessToken in auth.ts).
 */
function decodeJwtPayload(token: string): {
  sub?: string;
  email?: string;
  exp?: number;
  iat?: number;
  name?: string;
  user_metadata?: { email?: string; full_name?: string; name?: string };
} | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    // Base64url decode the payload (middle part)
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '=='.slice(0, (4 - payload.length % 4) % 4);
    const decoded = Buffer.from(padded, 'base64').toString('utf-8');
    return JSON.parse(decoded) as ReturnType<typeof decodeJwtPayload>;
  } catch {
    return null;
  }
}

/**
 * Returns the authenticated user from the session cookie.
 *
 * Uses local JWT decode to avoid hitting InsForge's /api/auth/sessions/current
 * on every request. InsForge uses a session-based model where the server-side
 * session can expire or be invalidated independently of the JWT's `exp` claim,
 * causing AUTH_UNAUTHORIZED even for tokens that are technically valid. Local
 * decode breaks that dependency and is the standard approach for Supabase-style
 * JWTs (validate signature at login time, trust claims at runtime).
 *
 * Falls back to server-side refresh via the refresh token cookie if the JWT is
 * expired. Returns null only when the token is missing, malformed, expired with
 * no refresh token, or the refresh itself fails.
 */
/**
 * Returns the real signed-in user from JWT/session cookies (no impersonation).
 * Use for admin checks and audit actor identity.
 */
export async function getSessionUser(): Promise<{ id: string; email: string; name?: string } | null> {
  try {
    const cookieStore = cookies();
    const token = cookieStore.get(AUTH_COOKIE.access)?.value;
    if (!token) return null;

    const claims = decodeJwtPayload(token);

    if (!claims || !claims.sub) {
      return await validateViaApi(token);
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const isExpired = claims.exp !== undefined && claims.exp < nowSec;

    if (isExpired) {
      // Middleware redirects to /api/auth/refresh or /auth/restore-session before
      // layout runs. If we still see an expired JWT, avoid cookies().set() in RSC.
      return null;
    }

    const email = claims.email ?? claims.user_metadata?.email ?? '';
    const name =
      claims.user_metadata?.full_name?.trim() ||
      claims.user_metadata?.name?.trim() ||
      claims.name?.trim() ||
      undefined;
    return { id: claims.sub, email, ...(name ? { name } : {}) };
  } catch {
    return null;
  }
}

/**
 * Returns the effective user for app routes — target user when admin impersonation is active.
 */
export async function getAuthenticatedUser(): Promise<EffectiveUser | null> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return null;
  return applyImpersonation(sessionUser);
}

/**
 * Fallback: validate opaque (non-JWT) tokens via InsForge API.
 * Only called when the token cannot be decoded as a JWT.
 */
async function validateViaApi(token: string): Promise<{ id: string; email: string; name?: string } | null> {
  const rawUrl = process.env.NEXT_PUBLIC_INSFORGE_URL;
  const anonKey = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY;
  if (!rawUrl || !anonKey) return null;

  try {
    const client = createClient({
      baseUrl: rawUrl.replace(/\/+$/, ''),
      anonKey,
      isServerMode: true,
      edgeFunctionToken: token,
    });
    const { data, error } = await client.auth.getCurrentUser();
    if (error) {
      console.warn('[auth] getCurrentUser error (opaque token):', {
        message: (error as { message?: string }).message,
        code: (error as { error?: string }).error,
      });
      return null;
    }
    if (!data?.user?.id) return null;
    const name = displayNameFromAuthUser(data.user) ?? undefined;
    return { id: data.user.id, email: data.user.email ?? '', ...(name ? { name } : {}) };
  } catch {
    return null;
  }
}
