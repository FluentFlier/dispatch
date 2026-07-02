import type { createClient } from '@insforge/sdk';
import type { SignalPlatform } from '@/lib/signals/types';
import type { ProfileState } from '@/lib/signals/profile/detect';

type InsforgeClient = ReturnType<typeof createClient>;

/** Reads the stored snapshot for a tracked profile, or null if never seen. */
export async function getProfileSnapshot(
  client: InsforgeClient,
  workspaceId: string,
  platform: SignalPlatform,
  profileKey: string,
): Promise<ProfileState | null> {
  const { data } = await client.database
    .from('signal_profile_snapshots')
    .select('profile_key, provider_id, full_name, headline')
    .eq('workspace_id', workspaceId)
    .eq('platform', platform)
    .eq('profile_key', profileKey)
    .maybeSingle();

  if (!data) return null;
  return {
    profileKey: data.profile_key as string,
    providerId: (data.provider_id as string) ?? undefined,
    fullName: (data.full_name as string) ?? undefined,
    headline: (data.headline as string) ?? undefined,
  };
}

/** Upserts the current snapshot for a tracked profile, refreshing captured_at. */
export async function putProfileSnapshot(
  client: InsforgeClient,
  workspaceId: string,
  platform: SignalPlatform,
  state: ProfileState,
): Promise<void> {
  const now = new Date().toISOString();
  await client.database.from('signal_profile_snapshots').upsert(
    {
      workspace_id: workspaceId,
      platform,
      profile_key: state.profileKey,
      provider_id: state.providerId ?? null,
      full_name: state.fullName ?? null,
      headline: state.headline ?? null,
      captured_at: now,
      updated_at: now,
    },
    { onConflict: 'workspace_id,platform,profile_key' },
  );
}
