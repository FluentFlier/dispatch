import type { createClient } from '@insforge/sdk';
import { resolveUnipileSyncTarget } from '@/lib/analytics/linkedin-metrics-sync';
import { fetchPostsFromUnipile, type OnboardingPlatform } from '@/lib/onboarding/import-posts';
import { persistImportedPosts } from '@/lib/voice-lab/persist-imported-posts';
import { ensureActiveWorkspaceId } from '@/lib/workspace';
import { logError, logInfo } from '@/lib/logger';

type InsforgeClient = ReturnType<typeof createClient>;

/** Keep the per-run fetch small — new posts are few and the cron runs every 6h. */
const MAX_REIMPORT = 25;

/** Platforms whose posts we pull from Unipile on the metrics cron. */
const REIMPORT_PLATFORMS: OnboardingPlatform[] = ['linkedin', 'twitter'];

/**
 * Pulls the user's latest posts for one platform and persists any not already
 * tracked. persistImportedPosts is idempotent by idempotency_key, so this only
 * ever adds genuinely new posts — this is what makes newly-published posts show
 * up without the user re-running onboarding.
 */
export async function reimportRecentPosts(
  client: InsforgeClient,
  userId: string,
  platform: OnboardingPlatform,
): Promise<number> {
  if (!process.env.UNIPILE_API_KEY?.trim() || !process.env.UNIPILE_DSN?.trim()) return 0;

  const target = await resolveUnipileSyncTarget(client, userId, platform);
  if (!target) return 0;

  let workspaceId: string | null = null;
  try {
    workspaceId = await ensureActiveWorkspaceId(userId);
  } catch {
    // Fall through with null — persistImportedPosts tolerates a null workspace.
  }

  try {
    const { rawItems } = await fetchPostsFromUnipile(
      target.providerUserIds,
      target.unipileAccountId,
      platform,
      MAX_REIMPORT,
    );
    if (rawItems.length === 0) return 0;

    const persisted = await persistImportedPosts({
      client,
      userId,
      workspaceId,
      platform,
      items: rawItems.filter((item) => item.id),
    });
    if (persisted.created > 0) {
      logInfo('[reimport] new posts imported', { userId, platform, created: persisted.created });
    }
    return persisted.created;
  } catch (e) {
    logError('[reimport] failed', { userId, platform }, e);
    return 0;
  }
}

/** Reimport new posts across every Unipile-backed platform (LinkedIn + X). */
export async function reimportRecentPostsAllPlatforms(
  client: InsforgeClient,
  userId: string,
): Promise<number> {
  let created = 0;
  for (const platform of REIMPORT_PLATFORMS) {
    created += await reimportRecentPosts(client, userId, platform);
  }
  return created;
}

/** Back-compat wrapper. */
export function reimportRecentLinkedInPosts(client: InsforgeClient, userId: string) {
  return reimportRecentPosts(client, userId, 'linkedin');
}
