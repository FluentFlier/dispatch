/**
 * Phase: Leads quality fixes - contact dedupe
 *
 * insertContactsForLead had no existence check and re-ran on every re-scrape and
 * on cross-source domain merges, so the same founder piled up ~4x per lead. It
 * now inserts only founders not already present (matched on linkedin_url or
 * lower(name)) and only marks a primary on a lead that has no contacts yet.
 *
 * The InsForge client is a fake - no DB writes, no external calls.
 */
import { describe, it, expect, vi } from 'vitest';
import { insertContactsForLead } from '@/lib/signals/leads/store';
import type { IngestedLead } from '@/lib/signals/types';

type ExistingContact = { name: string | null; linkedin_url: string | null };

/** Fake InsForge client: select returns `existing`, insert appends to insertCalls. */
function makeClient(existing: ExistingContact[]) {
  const insertCalls: Array<Array<Record<string, unknown>>> = [];
  const from = vi.fn(() => ({
    select: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve({ data: existing, error: null })) })),
    insert: vi.fn((rows: Array<Record<string, unknown>>) => {
      insertCalls.push(rows);
      return Promise.resolve({ error: null });
    }),
  }));
  return {
    client: { database: { from } } as unknown as Parameters<typeof insertContactsForLead>[0],
    insertCalls,
  };
}

function lead(founders: IngestedLead['founders']): IngestedLead {
  return { source: 'yc_directory', externalId: 'flux', companyName: 'Flux Labs', founders };
}

describe('Phase: Leads quality fixes - insertContactsForLead dedupe', () => {
  it('inserts all founders on a fresh lead and marks only the first as primary', async () => {
    const { client, insertCalls } = makeClient([]);
    await insertContactsForLead(client, 'ws-1', 'l1', lead([
      { name: 'Ava Chen', role: 'CEO', linkedinUrl: 'https://li/ava' },
      { name: 'Bob Lee', role: 'CTO', linkedinUrl: 'https://li/bob' },
    ]));
    expect(insertCalls).toHaveLength(1);
    const rows = insertCalls[0];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'Ava Chen', is_primary: true });
    expect(rows[1]).toMatchObject({ name: 'Bob Lee', is_primary: false });
  });

  it('does not re-insert a founder already present (matched by linkedin_url) on a re-scrape', async () => {
    const { client, insertCalls } = makeClient([{ name: 'Ava Chen', linkedin_url: 'https://li/ava' }]);
    await insertContactsForLead(client, 'ws-1', 'l1', lead([
      { name: 'Ava Chen', role: 'CEO', linkedinUrl: 'https://li/ava' }, // dupe
      { name: 'Bob Lee', role: 'CTO', linkedinUrl: 'https://li/bob' }, // new
    ]));
    expect(insertCalls).toHaveLength(1);
    const rows = insertCalls[0];
    expect(rows).toHaveLength(1);
    // Only the new founder is inserted, and it does NOT steal the primary flag.
    expect(rows[0]).toMatchObject({ name: 'Bob Lee', is_primary: false });
  });

  it('matches on lower(name) even when the incoming URL differs (renamed profile)', async () => {
    const { client, insertCalls } = makeClient([{ name: 'Ava Chen', linkedin_url: null }]);
    await insertContactsForLead(client, 'ws-1', 'l1', lead([
      { name: 'ava chen', role: 'CEO', linkedinUrl: 'https://li/ava-new' },
    ]));
    // Same person by name → skipped entirely, no insert call.
    expect(insertCalls).toHaveLength(0);
  });

  it('inserts nothing when every founder is already present (repeated resolve is a no-op)', async () => {
    const { client, insertCalls } = makeClient([
      { name: 'Ava Chen', linkedin_url: 'https://li/ava' },
      { name: 'Bob Lee', linkedin_url: 'https://li/bob' },
    ]);
    await insertContactsForLead(client, 'ws-1', 'l1', lead([
      { name: 'Ava Chen', linkedinUrl: 'https://li/ava' },
      { name: 'Bob Lee', linkedinUrl: 'https://li/bob' },
    ]));
    expect(insertCalls).toHaveLength(0);
  });

  it('collapses duplicates within a single scrape batch (same founder listed twice)', async () => {
    const { client, insertCalls } = makeClient([]);
    await insertContactsForLead(client, 'ws-1', 'l1', lead([
      { name: 'Ava Chen', linkedinUrl: 'https://li/ava' },
      { name: 'Ava Chen', linkedinUrl: 'https://li/ava' },
    ]));
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toHaveLength(1);
    expect(insertCalls[0][0]).toMatchObject({ name: 'Ava Chen', is_primary: true });
  });

  it('is a no-op when the lead has no founders', async () => {
    const { client, insertCalls } = makeClient([]);
    await insertContactsForLead(client, 'ws-1', 'l1', lead([]));
    expect(insertCalls).toHaveLength(0);
  });
});
