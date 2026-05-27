import { createClient } from '@insforge/sdk';

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
