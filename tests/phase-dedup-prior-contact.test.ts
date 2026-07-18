/**
 * Phase: Leads watchlist dedup - checkPriorContact (Task 9)
 *
 * Verifies the do-not-contact + prior-sent-outreach lookup that Task 10 wires
 * into sendLeadOutreach. The InsForge client is a fake in-memory table filter
 * (no real DB) so each test only asserts on checkPriorContact's own logic:
 * DNC hit, prior sent outreach (newest first), contact-but-never-sent, and
 * the zero-query short circuit for an empty identity.
 */
import { describe, it, expect, vi } from 'vitest';
import { checkPriorContact } from '@/lib/signals/outreach/prior-contact';

type Row = Record<string, unknown>;

/**
 * Fake InsForge client: `from(table)` returns a chainable builder that filters
 * an in-memory row array as `.eq`/`.ilike`/`.in`/`.order`/`.limit` are called,
 * and resolves to `{ data }` when awaited (thenable), same as the real
 * PostgREST-style builder used throughout src/lib/signals.
 */
function makeClient(tables: Record<string, Row[]>) {
  const fromSpy = vi.fn((table: string) => {
    let rows = (tables[table] ?? []).slice();
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, val: unknown) => {
        rows = rows.filter((r) => r[col] === val);
        return builder;
      },
      ilike: (col: string, val: unknown) => {
        rows = rows.filter((r) => String(r[col] ?? '').toLowerCase() === String(val).toLowerCase());
        return builder;
      },
      in: (col: string, vals: unknown[]) => {
        rows = rows.filter((r) => vals.includes(r[col]));
        return builder;
      },
      order: (col: string, opts: { ascending: boolean }) => {
        rows = [...rows].sort((a, b) => {
          const av = String(a[col]);
          const bv = String(b[col]);
          if (av === bv) return 0;
          const asc = av < bv ? -1 : 1;
          return opts.ascending ? asc : -asc;
        });
        return builder;
      },
      limit: (n: number) => {
        rows = rows.slice(0, n);
        return builder;
      },
      then: (resolve: (v: { data: Row[]; error: null }) => unknown) => resolve({ data: rows, error: null }),
    };
    return builder;
  });

  return {
    client: { database: { from: fromSpy } } as unknown as Parameters<typeof checkPriorContact>[0],
    fromSpy,
  };
}

const WS = 'ws1';

describe('Phase: Leads watchlist dedup - checkPriorContact', () => {
  it('DNC hit: blockedByDnc true, no prior sent outreach', async () => {
    const { client } = makeClient({
      do_not_contact: [{ id: 'dnc1', workspace_id: WS, email: 'jane@acme.com' }],
      signal_lead_contacts: [],
      signal_outreach: [],
    });

    const result = await checkPriorContact(client, WS, { email: 'JANE@ACME.COM' });

    expect(result.blockedByDnc).toBe(true);
    expect(result.contacted).toBe(false);
  });

  it('prior sent outreach: contacted true with the newest lastAt/channel/leadId', async () => {
    const { client } = makeClient({
      do_not_contact: [],
      signal_lead_contacts: [
        {
          id: 'c1',
          workspace_id: WS,
          lead_id: 'lead1',
          provider_id: null,
          linkedin_url: 'https://linkedin.com/in/jane',
          x_handle: null,
          email: null,
        },
      ],
      signal_outreach: [
        { id: 'o1', lead_id: 'lead1', channel: 'linkedin_connect', status: 'sent', created_at: '2026-07-01T00:00:00Z' },
        { id: 'o2', lead_id: 'lead1', channel: 'linkedin_dm', status: 'sent', created_at: '2026-07-10T00:00:00Z' },
      ],
    });

    // Trailing slash + differing case are normalized before compare.
    const result = await checkPriorContact(client, WS, { linkedinUrl: 'https://linkedin.com/in/jane/' });

    expect(result.contacted).toBe(true);
    expect(result.blockedByDnc).toBe(false);
    expect(result.lastAt).toBe('2026-07-10T00:00:00Z');
    expect(result.channel).toBe('linkedin_dm');
    expect(result.leadId).toBe('lead1');
  });

  it('contact match but no sent outreach: not contacted', async () => {
    const { client } = makeClient({
      do_not_contact: [],
      signal_lead_contacts: [
        { id: 'c2', workspace_id: WS, lead_id: 'lead2', provider_id: null, linkedin_url: null, x_handle: 'janedoe', email: null },
      ],
      signal_outreach: [{ id: 'o3', lead_id: 'lead2', channel: 'x_dm', status: 'draft', created_at: '2026-07-05T00:00:00Z' }],
    });

    const result = await checkPriorContact(client, WS, { xHandle: 'JaneDoe' });

    expect(result.contacted).toBe(false);
    expect(result.blockedByDnc).toBe(false);
    expect(result.lastAt).toBeUndefined();
  });

  it('empty identity: not contacted, not blocked, zero DB calls', async () => {
    const { client, fromSpy } = makeClient({
      do_not_contact: [{ id: 'dnc1', workspace_id: WS, email: 'jane@acme.com' }],
    });

    const result = await checkPriorContact(client, WS, {});

    expect(result).toEqual({ contacted: false, blockedByDnc: false });
    expect(fromSpy).not.toHaveBeenCalled();
  });
});
