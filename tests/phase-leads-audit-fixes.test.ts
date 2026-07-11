import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { feedViewState, draftAllOutcome } from '@/lib/leads/feed-view';

/**
 * WS3 — Audit fixes.
 * 3.1 A failed bootstrap fetch shows an error+retry, NOT the empty state.
 * 3.3 Draft-all reports failures instead of hiding them.
 * 3.5 The orphaned GET /api/signals/bootstrap route is removed.
 */

describe('WS3.1 feedViewState distinguishes error from empty', () => {
  it('shows loading while loading', () => {
    expect(feedViewState({ loading: true, loadError: false, cardCount: 0 })).toBe('loading');
  });

  it('shows an error (retry) when the fetch failed, even with zero cards', () => {
    expect(feedViewState({ loading: false, loadError: true, cardCount: 0 })).toBe('error');
  });

  it('shows setup when the leads engine is not provisioned', () => {
    expect(
      feedViewState({ loading: false, loadError: false, cardCount: 0, setupRequired: true }),
    ).toBe('setup');
  });

  it('shows the empty state only for a genuine empty feed (no error)', () => {
    expect(feedViewState({ loading: false, loadError: false, cardCount: 0 })).toBe('empty');
  });

  it('shows the list when there are cards', () => {
    expect(feedViewState({ loading: false, loadError: false, cardCount: 3 })).toBe('list');
  });
});

describe('WS3.3 draftAllOutcome reports failures', () => {
  it('reports success count only when nothing failed', () => {
    expect(draftAllOutcome(3, 0)).toEqual({ message: 'Drafted 3 messages.', type: 'success' });
  });

  it('reports both counts and is an error toast when some failed', () => {
    expect(draftAllOutcome(2, 1)).toEqual({ message: 'Drafted 2 messages, 1 failed.', type: 'error' });
  });

  it('pluralizes correctly for a single success', () => {
    expect(draftAllOutcome(1, 0).message).toBe('Drafted 1 message.');
  });
});

describe('WS3.5 orphaned signals bootstrap route is removed', () => {
  it('does not ship src/app/api/signals/bootstrap/route.ts', () => {
    const p = resolve(__dirname, '../src/app/api/signals/bootstrap/route.ts');
    expect(existsSync(p)).toBe(false);
  });

  it('nothing references /api/signals/bootstrap in the client', () => {
    const page = readFileSync(resolve(__dirname, '../src/app/(dashboard)/leads/page.tsx'), 'utf8');
    expect(page).not.toContain('/api/signals/bootstrap');
  });
});
