/**
 * Leads rebuild audit - findings whose helpers do not exist yet and whose
 * flows are not unit-testable. Each it.todo names the exact assertion the
 * eventual test (unit once the helper lands, integration otherwise) must
 * make. Convert to real tests as the rebuild ships the pieces.
 */
import { describe, it, expect } from 'vitest';
import { descriptionCheckDue, DESCRIPTION_RECHECK_MS } from '@/lib/signals/leads/describe';

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
  it.todo(
    "unit (once the gate helper exists in src/lib/signals/leads/digest.ts): weekly + last scrape 2 days ago -> skipped; weekly + 8 days ago -> runs; 'manual' never auto-runs",
  );
});

describe('DRAFT AUTOSAVE: edited draft text persists server-side', () => {
  it.todo(
    'integration: editing outreach draft text in the UI must PATCH the signal_outreach row so the edit survives reload, not live only in client state',
  );
});

describe('INTENT FLAGS PORT: watched-company events surface on leads', () => {
  it.todo(
    'integration: after the signals teardown, an event on a followed/watched company must set the matching intent flag on its lead so the feed card still shows the signal',
  );
});
