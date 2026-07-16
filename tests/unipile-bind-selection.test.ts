import { describe, it, expect } from 'vitest';
import { pickAccountsToBind } from '@/lib/social/sync-unipile-accounts';

const li = (id: string, publicIdentifier?: string) => ({
  id,
  type: 'linkedin',
  name: id,
  connection_params: publicIdentifier ? { im: { publicIdentifier } } : undefined,
});
const x = (id: string) => ({ id, type: 'twitter', name: id });

describe('pickAccountsToBind', () => {
  it('binds the single new account not present in the snapshot', () => {
    const picked = pickAccountsToBind([li('old'), li('new')], new Set(['old']), new Set());
    expect(picked.map((a) => a.id)).toEqual(['new']);
  });

  it('binds nothing when the only account was already in the snapshot', () => {
    const picked = pickAccountsToBind([li('old')], new Set(['old']), new Set());
    expect(picked).toEqual([]);
  });

  it('excludes accounts owned by another user (the anti cross-wire guard)', () => {
    // 'stranger' is new vs snapshot but claimed by someone else → never bound.
    const picked = pickAccountsToBind([li('stranger')], new Set(), new Set(['stranger']));
    expect(picked).toEqual([]);
  });

  it('excludes a rotated account when its stable identity is already owned by another user', () => {
    const picked = pickAccountsToBind(
      [li('new-session-id', 'ava-chen')],
      new Set(),
      new Set(['ava-chen']),
    );
    expect(picked).toEqual([]);
  });

  it('defers to the webhook when two new accounts of a platform appear (ambiguous)', () => {
    const picked = pickAccountsToBind([li('a'), li('b')], new Set(), new Set());
    expect(picked).toEqual([]);
  });

  it('binds one-per-platform across different platforms in one connect', () => {
    const picked = pickAccountsToBind([li('li1'), x('x1')], new Set(), new Set());
    expect(picked.map((a) => a.id).sort()).toEqual(['li1', 'x1']);
  });

  it('dedupes repeated ids before counting', () => {
    const picked = pickAccountsToBind([li('dup'), li('dup')], new Set(), new Set());
    expect(picked.map((a) => a.id)).toEqual(['dup']);
  });
});
