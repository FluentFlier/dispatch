import type { createClient } from '@insforge/sdk';
import { DEFAULT_WATCHLIST } from './watchlist';

type InsforgeClient = ReturnType<typeof createClient>;

export interface WorkspaceWatchlistEntry {
  id: string;
  workspace_id: string;
  handle: string;
  platform: string;
  verticals: string[];
  priority: number;
  enabled: boolean;
}

/**
 * Loads enabled hook-mining handles for a workspace, falling back to DEFAULT_WATCHLIST.
 */
export async function getWorkspaceWatchlistTargets(
  client: InsforgeClient | undefined,
  workspaceId: string | null | undefined,
): Promise<{ handles: string[]; source: 'workspace' | 'default' }> {
  if (!client || !workspaceId) {
    return {
      handles: DEFAULT_WATCHLIST.accounts
        .sort((a, b) => b.priority - a.priority)
        .slice(0, 25)
        .map((a) => a.handle),
      source: 'default',
    };
  }

  try {
    const { data, error } = await client.database
      .from('workspace_watchlists')
      .select('handle, priority')
      .eq('workspace_id', workspaceId)
      .eq('enabled', true)
      .order('priority', { ascending: false })
      .limit(25);

    if (error || !data?.length) {
      return {
        handles: DEFAULT_WATCHLIST.accounts
          .sort((a, b) => b.priority - a.priority)
          .slice(0, 25)
          .map((a) => a.handle),
        source: 'default',
      };
    }

    return {
      handles: (data as Array<{ handle: string }>).map((row) => row.handle.replace(/^@+/, '')),
      source: 'workspace',
    };
  } catch {
    return {
      handles: DEFAULT_WATCHLIST.accounts.map((a) => a.handle),
      source: 'default',
    };
  }
}
