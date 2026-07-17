/**
 * F1 SNOOZE + F10 SORT + F4/F5 FETCH GUARDS (leads rebuild audit).
 *
 * These encode EXPECTED behavior, not current behavior - red today is a
 * caught gap, not a broken test.
 *
 * F1: a snoozed lead (snoozed_until in the future) must be hidden from the
 * unified feed until the snooze expires. The pure merge/filter step is
 * mergeFeed, so the exclusion is asserted there.
 * F10: every sort option the FeedFilters UI offers ('score' | 'warm' |
 * 'recency') must actually be implemented by the controller's sortedCards
 * comparator - offering an unimplemented 'warm' sort is a silent no-op.
 * F4/F5: not unit-testable without a React harness - see it.todo.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mergeFeed } from '@/lib/signals/feed/store';
import type { UnifiedLeadCard } from '@/lib/signals/feed/normalize';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

/** Minimal card stub; snoozedUntil is the expected (rebuild) field. */
function card(p: Partial<UnifiedLeadCard> & { snoozedUntil?: string | null }): UnifiedLeadCard {
  return {
    id: 'c1',
    kind: 'directory',
    source: 'yc_directory',
    companyName: 'Acme',
    tagline: null,
    signalType: null,
    signalSummary: null,
    sourceUrl: null,
    batch: null,
    accelerator: null,
    contact: null,
    contactStatus: null,
    score: 10,
    status: 'new',
    detectedAt: '2026-07-01T00:00:00Z',
    ...p,
  } as UnifiedLeadCard;
}

describe('F1: snoozed leads are hidden from the feed until snoozed_until passes', () => {
  const future = new Date(Date.now() + 24 * 3_600_000).toISOString();
  const past = new Date(Date.now() - 24 * 3_600_000).toISOString();

  it('excludes a card whose snoozedUntil is in the future', () => {
    const out = mergeFeed(
      [card({ id: 'snoozed', snoozedUntil: future }), card({ id: 'active' })],
      [],
      {},
    );
    expect(out.map((c) => c.id)).toEqual(['active']);
  });

  it('includes a card whose snoozedUntil has already passed', () => {
    const out = mergeFeed([card({ id: 'woken', snoozedUntil: past })], [], {});
    expect(out.map((c) => c.id)).toContain('woken');
  });

  it.todo(
    'integration: listLeads must also exclude rows with snoozed_until > now at the DB layer, so snoozed leads never reach the feed regardless of caller',
  );
});

describe('F10: every offered FeedSort option is implemented', () => {
  it('sortedCards handles each FeedSort value FeedFilters offers (or the option must be removed)', () => {
    const filters = read('src/components/leads/FeedFilters.tsx');
    const controller = read('src/app/(dashboard)/leads/useLeadsController.tsx');

    const typeMatch = filters.match(/type FeedSort\s*=\s*([^;]+);/);
    if (!typeMatch) return; // no FeedSort type -> nothing offered, nothing to implement
    const options = Array.from(typeMatch[1].matchAll(/'([a-z_]+)'/g)).map((m) => m[1]);

    for (const opt of options) {
      if (opt === 'score') continue; // score is the default comparator branch
      expect(
        controller.includes(`'${opt}'`),
        `FeedSort option '${opt}' is offered in FeedFilters but useLeadsController's sort never handles it - implement it or stop offering it`,
      ).toBe(true);
    }
  });
});

describe('F4/F5: client fetch guards', () => {
  it.todo(
    'integration: a non-ok /api/leads/feed refetch must keep the previously rendered cards and surface an error, never blank the feed',
  );
});
