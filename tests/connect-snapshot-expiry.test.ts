import { describe, it, expect } from 'vitest';
import { CONNECT_SNAPSHOT_TTL_MS, isSnapshotExpired } from '@/lib/social/connect-snapshot';

/**
 * A connect snapshot is the ONLY thing standing between "this user clicked
 * Connect and authenticated" and "some account showed up in the shared Unipile
 * tenant". It used to have no expiry, which meant an abandoned connect left a
 * permanent bind permit: a later automatic sync would attach whatever account
 * had since appeared, and the UI reported "Connected as <someone>" with no
 * login having happened. These cases pin the expiry so that cannot come back.
 */
describe('isSnapshotExpired', () => {
  const now = Date.parse('2026-07-19T12:00:00.000Z');
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();

  it('accepts a permit from an in-flight connect', () => {
    expect(isSnapshotExpired(at(0), now)).toBe(false);
    expect(isSnapshotExpired(at(60_000), now)).toBe(false);
    expect(isSnapshotExpired(at(CONNECT_SNAPSHOT_TTL_MS - 1_000), now)).toBe(false);
  });

  it('rejects a permit older than the hosted link lifetime', () => {
    expect(isSnapshotExpired(at(CONNECT_SNAPSHOT_TTL_MS + 1_000), now)).toBe(true);
    // The abandoned-connect case that produced a login-free bind.
    expect(isSnapshotExpired(at(3 * 24 * 60 * 60 * 1000), now)).toBe(true);
  });

  it('fails closed on a missing or unparseable timestamp', () => {
    // An unknown-age permit is exactly the one we cannot trust, so it must not
    // default to "still valid".
    expect(isSnapshotExpired(null, now)).toBe(true);
    expect(isSnapshotExpired(undefined, now)).toBe(true);
    expect(isSnapshotExpired('', now)).toBe(true);
    expect(isSnapshotExpired('not a date', now)).toBe(true);
  });
});
