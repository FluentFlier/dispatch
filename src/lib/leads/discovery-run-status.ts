export type DiscoveryRunState = 'running' | 'succeeded' | 'failed' | 'interrupted';

export interface DiscoveryRunStatus {
  state: DiscoveryRunState;
  startedAt: string;
  finishedAt?: string;
  message?: string;
}

export const DISCOVERY_RUN_STORAGE_KEY = 'leads:discovery:last-run';

export function readDiscoveryRunStatus(storage: Pick<Storage, 'getItem' | 'setItem'>): DiscoveryRunStatus | null {
  try {
    const raw = storage.getItem(DISCOVERY_RUN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DiscoveryRunStatus>;
    if (!parsed.startedAt || !['running', 'succeeded', 'failed', 'interrupted'].includes(parsed.state ?? '')) {
      return null;
    }
    return parsed as DiscoveryRunStatus;
  } catch {
    return null;
  }
}

export function writeDiscoveryRunStatus(
  storage: Pick<Storage, 'setItem'>,
  status: DiscoveryRunStatus,
): DiscoveryRunStatus {
  try {
    storage.setItem(DISCOVERY_RUN_STORAGE_KEY, JSON.stringify(status));
  } catch {
    // Status is helpful UI, never a reason to block discovery.
  }
  return status;
}

/**
 * A `running` value left in browser storage means the page went away before it
 * observed a terminal response. The server may have completed, so we must not
 * call it failed or successful. Mark it interrupted and tell the user to check
 * the feed before starting another run.
 */
export function reconcileDiscoveryRunStatus(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  now = new Date(),
): DiscoveryRunStatus | null {
  const status = readDiscoveryRunStatus(storage);
  if (!status || status.state !== 'running') return status;
  return writeDiscoveryRunStatus(storage, {
    ...status,
    state: 'interrupted',
    finishedAt: now.toISOString(),
    message: 'Progress tracking stopped when this page closed. The search may have completed; refresh the feed to check.',
  });
}

export function discoveryStatusMessage(status: DiscoveryRunStatus | null): string | null {
  if (!status) return null;
  switch (status.state) {
    case 'running':
      return status.message ?? 'Discovery is running in this tab. Keep it open until the search finishes.';
    case 'succeeded':
      return status.message ?? 'Discovery finished. You can safely leave this page.';
    case 'failed':
      return status.message ?? 'Discovery did not finish. You can retry it.';
    case 'interrupted':
      return status.message ?? 'Progress tracking stopped. Refresh the feed to check for results before retrying.';
  }
}
