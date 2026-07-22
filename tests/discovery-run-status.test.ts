import { describe, expect, it } from 'vitest';
import {
  DISCOVERY_RUN_STORAGE_KEY,
  discoveryStatusMessage,
  readDiscoveryRunStatus,
  reconcileDiscoveryRunStatus,
  writeDiscoveryRunStatus,
} from '@/lib/leads/discovery-run-status';

function memoryStorage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: (key: string) => key === DISCOVERY_RUN_STORAGE_KEY ? value : null,
    setItem: (key: string, next: string) => {
      if (key === DISCOVERY_RUN_STORAGE_KEY) value = next;
    },
    value: () => value,
  };
}

describe('discovery run status', () => {
  it('persists a running search and explains that the tab must remain open', () => {
    const storage = memoryStorage();
    const status = writeDiscoveryRunStatus(storage, {
      state: 'running',
      startedAt: '2026-07-22T10:00:00.000Z',
    });

    expect(readDiscoveryRunStatus(storage)).toEqual(status);
    expect(discoveryStatusMessage(status)).toContain('Keep it open');
  });

  it('marks a leftover running search as unknown/interrupted, not failed or successful', () => {
    const storage = memoryStorage(JSON.stringify({
      state: 'running',
      startedAt: '2026-07-22T10:00:00.000Z',
    }));

    const status = reconcileDiscoveryRunStatus(storage, new Date('2026-07-22T10:05:00.000Z'));

    expect(status?.state).toBe('interrupted');
    expect(status?.message).toContain('may have completed');
    expect(readDiscoveryRunStatus(storage)?.state).toBe('interrupted');
  });

  it('does not rewrite a terminal result on a later visit', () => {
    const saved = {
      state: 'succeeded' as const,
      startedAt: '2026-07-22T10:00:00.000Z',
      finishedAt: '2026-07-22T10:01:00.000Z',
    };
    const storage = memoryStorage(JSON.stringify(saved));

    expect(reconcileDiscoveryRunStatus(storage)).toEqual(saved);
  });

  it('ignores malformed or unknown stored values', () => {
    expect(readDiscoveryRunStatus(memoryStorage('{broken'))).toBeNull();
    expect(readDiscoveryRunStatus(memoryStorage(JSON.stringify({ state: 'queued' })))).toBeNull();
  });
});
