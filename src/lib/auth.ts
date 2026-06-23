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
 * Validate an InsForge access token before persisting it in an httpOnly cookie.
 */
export async function validateAccessToken(
  token: string
): Promise<{ valid: true; userId: string; email: string } | { valid: false; error: string }> {
  const url = process.env.NEXT_PUBLIC_INSFORGE_URL;
  const anonKey = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY;

  if (!url || !anonKey) {
    return { valid: false, error: 'Auth service not configured' };
  }

  if (!token || token.length < 10) {
    return { valid: false, error: 'Invalid token' };
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

    return {
      valid: true,
      userId: data.user.id,
      email: data.user.email ?? '',
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Token validation failed';
    return { valid: false, error: message };
  }
}
