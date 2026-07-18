/**
 * Leads rebuild audit - findings whose helpers do not exist yet and whose
 * flows are not unit-testable. Each it.todo names the exact assertion the
 * eventual test (unit once the helper lands, integration otherwise) must
 * make. Convert to real tests as the rebuild ships the pieces.
 */
import { describe, it, expect } from 'vitest';
import { descriptionCheckDue, DESCRIPTION_RECHECK_MS } from '@/lib/signals/leads/describe';
import { scrapeDueByFrequency } from '@/lib/signals/leads/digest';

describe('F3: description recheck TTL (no permanent latch)', () => {
  const now = Date.parse('2026-07-17T12:00:00Z');
  const daysAgo = (d: number) => new Date(now - d * 24 * 3_600_000).toISOString();

  it('a stored description is never re-fetched', () => {
    expect(descriptionCheckDue({ description: 'Acme does X.' }, now)).toBe(false);
  });

  it('never-checked lead is due', () => {
    expect(descriptionCheckDue({}, now)).toBe(true);
    expect(descriptionCheckDue(null, now)).toBe(true);
  });

  it('a check newer than the TTL skips, older than the TTL rechecks', () => {
    expect(descriptionCheckDue({ description_checked_at: daysAgo(2) }, now)).toBe(false);
    expect(descriptionCheckDue({ description_checked_at: daysAgo(8) }, now)).toBe(true);
    expect(DESCRIPTION_RECHECK_MS).toBe(7 * 24 * 3_600_000);
  });

  it('legacy boolean latch (no timestamp) counts as due so it self-migrates', () => {
    expect(descriptionCheckDue({ description_checked: true }, now)).toBe(true);
  });
});

describe('SCRAPE FREQUENCY: cron gate respects workspace scrape_frequency', () => {
  const now = Date.parse('2026-07-17T12:00:00Z');
  const daysAgo = (d: number) => new Date(now - d * 24 * 3_600_000).toISOString();

  it('weekly: 2 days since last scrape skips, 8 days runs', () => {
    expect(scrapeDueByFrequency('weekly', daysAgo(2), now)).toBe(false);
    expect(scrapeDueByFrequency('weekly', daysAgo(8), now)).toBe(true);
  });

  it('every_3_days: 2 days skips, 4 days runs', () => {
    expect(scrapeDueByFrequency('every_3_days', daysAgo(2), now)).toBe(false);
    expect(scrapeDueByFrequency('every_3_days', daysAgo(4), now)).toBe(true);
  });

  it('manual never auto-runs, even when never synced', () => {
    expect(scrapeDueByFrequency('manual', null, now)).toBe(false);
    expect(scrapeDueByFrequency('manual', daysAgo(30), now)).toBe(false);
  });

  it('never-synced workspace is always due (except manual)', () => {
    expect(scrapeDueByFrequency('daily', null, now)).toBe(true);
    expect(scrapeDueByFrequency('weekly', null, now)).toBe(true);
  });

  it('cron slop: a daily scrape 23.5h ago still counts as due', () => {
    expect(scrapeDueByFrequency('daily', new Date(now - 23.5 * 3_600_000).toISOString(), now)).toBe(true);
  });
});

describe('DRAFT AUTOSAVE: edited draft text persists server-side', () => {
  it.todo(
    'integration: editing outreach draft text in the UI must PATCH the signal_outreach row so the edit survives reload, not live only in client state',
  );
});

// INTENT FLAGS PORT is covered by tests/leads-intent-bridge.test.ts.
