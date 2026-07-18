import type { createClient } from '@insforge/sdk';
import type { SeriesRow } from './types';

type InsforgeClient = ReturnType<typeof createClient>;

/**
 * Loads one series scoped to the caller's user AND workspace. Returns null when
 * missing or out of scope - callers 404 without leaking existence across tenants.
 */
export async function loadSeries(
  client: InsforgeClient,
  seriesId: string,
  userId: string,
  workspaceId: string | null,
): Promise<SeriesRow | null> {
  let query = client.database
    .from('series')
    .select('*')
    .eq('id', seriesId)
    .eq('user_id', userId);
  if (workspaceId) query = query.eq('workspace_id', workspaceId);
  const { data, error } = await query.single();
  if (error || !data) return null;
  return data as SeriesRow;
}
