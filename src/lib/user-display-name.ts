import { createClient } from '@insforge/sdk';

/** InsForge user shape from getCurrentUser / JWT metadata. */
export interface InsforgeAuthUserLike {
  email?: string | null;
  profile?: { name?: string | null } | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Extracts a human display name from InsForge auth user / JWT metadata.
 * Prefers OAuth profile name over email-derived guesses.
 */
export function displayNameFromAuthUser(user: InsforgeAuthUserLike | null | undefined): string | null {
  if (!user) return null;

  const profileName = user.profile?.name?.trim();
  if (profileName) return profileName;

  const meta = user.metadata ?? {};
  const fullName =
    (typeof meta.full_name === 'string' ? meta.full_name : null) ??
    (typeof meta.name === 'string' ? meta.name : null);
  if (fullName?.trim()) return fullName.trim();

  return null;
}

/**
 * Returns true when display_name looks like it was auto-derived from email local-part.
 */
export function isEmailDerivedDisplayName(displayName: string, email: string): boolean {
  const trimmed = displayName.trim();
  if (!trimmed || !email.includes('@')) return false;
  const local = email.split('@')[0]?.trim().toLowerCase();
  if (!local) return false;
  return trimmed.toLowerCase() === local;
}

/**
 * Resolves the best display name: social account name > OAuth name > neutral fallback.
 * Never uses the email local-part as a display name.
 */
export function resolveDisplayName(opts: {
  oauthName?: string | null;
  socialAccountName?: string | null;
  fallback?: string;
}): string {
  const social = opts.socialAccountName?.trim();
  if (social) return social;

  const oauth = opts.oauthName?.trim();
  if (oauth) return oauth;

  return opts.fallback?.trim() || 'Creator';
}

/**
 * Fetches the OAuth display name from InsForge using the user's access token.
 */
export async function fetchOAuthDisplayName(accessToken: string): Promise<string | null> {
  const rawUrl = process.env.NEXT_PUBLIC_INSFORGE_URL;
  const anonKey = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY;
  if (!rawUrl || !anonKey || !accessToken) return null;

  try {
    const client = createClient({
      baseUrl: rawUrl.replace(/\/+$/, ''),
      anonKey,
      isServerMode: true,
      edgeFunctionToken: accessToken,
    });
    const { data } = await client.auth.getCurrentUser();
    return displayNameFromAuthUser(data?.user ?? null);
  } catch {
    return null;
  }
}

/**
 * When a profile still has an email-derived placeholder, replace it with OAuth name.
 */
export async function syncProfileDisplayNameFromOAuth(
  client: ReturnType<typeof import('@/lib/insforge/server').getServiceClient>,
  userId: string,
  email: string,
  oauthName: string,
): Promise<void> {
  const trimmed = oauthName.trim();
  if (!trimmed) return;

  const { data: profile } = await client.database
    .from('creator_profile')
    .select('display_name')
    .eq('user_id', userId)
    .maybeSingle();

  if (!profile) return;

  const current = (profile.display_name as string) ?? '';
  const shouldUpdate =
    !current.trim() ||
    current.trim() === 'Creator' ||
    isEmailDerivedDisplayName(current, email);

  if (!shouldUpdate) return;

  await client.database
    .from('creator_profile')
    .update({ display_name: trimmed, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
}
