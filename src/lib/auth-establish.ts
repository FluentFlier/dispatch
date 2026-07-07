import { validateAccessToken } from '@/lib/auth';
import { ensureSoloWorkspace } from '@/lib/workspace';
import { getServiceClient } from '@/lib/insforge/server';
import { logInfo, logWarn } from '@/lib/logger';
import { fetchOAuthDisplayName, syncProfileDisplayNameFromOAuth } from '@/lib/user-display-name';

/** PKCE verifier key used by @insforge/sdk during OAuth sign-in. */
export const INSFORGE_PKCE_VERIFIER_KEY = 'insforge_pkce_verifier';

export interface EstablishedSession {
  userId: string;
  email: string;
}

/**
 * Validate tokens, provision workspace, and sync display name after sign-in.
 * Shared by POST /api/auth and POST /api/auth/oauth/exchange.
 */
export async function establishAuthenticatedSession(
  accessToken: string,
): Promise<EstablishedSession | { error: string }> {
  const validation = await validateAccessToken(accessToken);
  if (!validation.valid) {
    return { error: validation.error };
  }

  try {
    await ensureSoloWorkspace(validation.userId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('duplicate') && !msg.includes('unique') && !msg.includes('already exists')) {
      logWarn('auth.workspace_provision_failed', { userId: validation.userId, error: msg });
    }
  }

  void (async () => {
    const oauthName = await fetchOAuthDisplayName(accessToken);
    if (!oauthName || !validation.email) return;
    try {
      await syncProfileDisplayNameFromOAuth(
        getServiceClient(),
        validation.userId,
        validation.email,
        oauthName,
      );
    } catch (err) {
      logWarn('auth.display_name_sync_failed', {
        userId: validation.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();

  logInfo('auth.session_created', { userId: validation.userId });
  return { userId: validation.userId, email: validation.email };
}
