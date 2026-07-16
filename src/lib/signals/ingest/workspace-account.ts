import type { createClient } from '@insforge/sdk';
import { resolveUnipileTarget, type OnboardingPlatform } from '@/lib/onboarding/import-posts';
import type { SignalPlatform } from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

export interface WorkspacePollAccount {
  userId: string;
  unipileAccountId: string;
  platform: 'linkedin' | 'twitter';
}

/** First connected Unipile account in workspace for polling (cron has no user session). */
export async function getWorkspacePollAccount(
  client: InsforgeClient,
  workspaceId: string,
  platform: SignalPlatform,
): Promise<WorkspacePollAccount | null> {
  const dbPlatform = platform === 'x' ? 'twitter' : 'linkedin';

  const { data } = await client.database
    .from('social_accounts')
    .select('user_id, unipile_account_id, account_id, platform')
    .eq('workspace_id', workspaceId)
    .eq('platform', dbPlatform)
    .not('unipile_account_id', 'is', null)
    .limit(1)
    .maybeSingle();

  if (!data?.unipile_account_id || !data.user_id) return null;

  const target = await resolveUnipileTarget(
    data.unipile_account_id as string,
    (data.account_id as string | null) ?? null,
    dbPlatform as OnboardingPlatform,
  );
  if (!target?.unipileAccountId) return null;
  if (target.refreshed) {
    await client.database
      .from('social_accounts')
      .update({ unipile_account_id: target.unipileAccountId })
      .eq('workspace_id', workspaceId)
      .eq('platform', dbPlatform);
  }

  return {
    userId: data.user_id as string,
    unipileAccountId: target.unipileAccountId,
    platform: dbPlatform,
  };
}

/**
 * Resolves the workspace owner's user id. Used as the acting user for automated
 * drafting in cron context (no auth session) when no connected account is present.
 */
export async function getWorkspaceOwnerUserId(
  client: InsforgeClient,
  workspaceId: string,
): Promise<string | null> {
  const { data } = await client.database
    .from('workspaces')
    .select('owner_user_id')
    .eq('id', workspaceId)
    .maybeSingle();

  return (data?.owner_user_id as string) ?? null;
}
