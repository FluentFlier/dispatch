/**
 * Leads rebuild audit - findings whose helpers do not exist yet and whose
 * flows are not unit-testable. Each it.todo names the exact assertion the
 * eventual test (unit once the helper lands, integration otherwise) must
 * make. Convert to real tests as the rebuild ships the pieces.
 */
import { describe, it } from 'vitest';

describe('F3: description recheck TTL (no permanent latch)', () => {
  it.todo(
    'unit (once the helper exists): a description check must be recorded as description_checked_at (timestamp), not a boolean latch - a check older than 7 days makes the lead eligible for recheck, a newer one skips it',
  );
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
