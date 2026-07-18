/**
 * INTENT BRIDGE (signals port): a detected signal must land on the matching
 * lead - intent flag raised, last_signal_* stamped, dismissed leads
 * resurfaced, and a watched company without a lead row gets one created.
 * Covers the leads-rebuild-todos "INTENT FLAGS PORT" item with a minimal
 * fake InsForge client (no network, no mocks framework needed).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/signals/leads/store', () => ({
  logLeadEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/composio/config', () => ({ isComposioConfigured: () => false }));
vi.mock('@/lib/composio/actions/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/signals/integrations/store', () => ({ getIntegration: vi.fn() }));

import { applySignalToLeads } from '@/lib/signals/leads/intent-bridge';
import type { ClassifiedSignal } from '@/lib/signals/types';

interface TableData {
  signal_leads: Array<Record<string, unknown>>;
  signal_followed_companies: Array<Record<string, unknown>>;
}

/** Chainable fake for the small InsForge surface the bridge touches. */
function fakeClient(tables: TableData) {
  const updates: Array<{ table: string; patch: Record<string, unknown>; id: string }> = [];
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const database = {
    from(table: keyof TableData) {
      return {
        select() {
          return {
            eq() {
              return {
                limit: async () => ({ data: tables[table] ?? [], error: null }),
              };
            },
          };
        },
        insert(rows: Array<Record<string, unknown>>) {
          inserts.push({ table, row: rows[0] });
          return {
            select: async () => ({ data: [{ id: 'new-lead-1' }], error: null }),
          };
        },
        update(patch: Record<string, unknown>) {
          return {
            eq: async (_col: string, id: string) => {
              updates.push({ table, patch, id });
              return { error: null };
            },
          };
        },
      };
    },
  };
  return { client: { database } as never, updates, inserts };
}

const signal: ClassifiedSignal = {
  signalType: 'funding_round',
  companyName: 'Acme Robotics',
  signalSummary: 'Acme Robotics raised a seed round.',
  confidence: 0.9,
  dedupeKey: 'k1',
  matchedKeywords: [],
};

describe('applySignalToLeads', () => {
  it('stamps the matching lead: flag + last_signal_* fields', async () => {
    const { client, updates } = fakeClient({
      signal_leads: [
        { id: 'l1', company_name: 'Acme Robotics', domain: null, intent_flags: {}, lead_status: 'new' },
        { id: 'l2', company_name: 'Other Co', domain: null, intent_flags: {}, lead_status: 'new' },
      ],
      signal_followed_companies: [],
    });

    const res = await applySignalToLeads(client, 'ws1', signal);

    expect(res.matched).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe('l1');
    const flags = updates[0].patch.intent_flags as Record<string, unknown>;
    expect(flags.raised).toBe(true);
    expect(flags.last_signal_type).toBe('funding_round');
    expect(flags.last_signal_summary).toContain('seed round');
  });

  it('resurfaces a dismissed lead when a fresh signal lands', async () => {
    const { client, updates } = fakeClient({
      signal_leads: [
        { id: 'l1', company_name: 'Acme Robotics', domain: null, intent_flags: {}, lead_status: 'dismissed' },
      ],
      signal_followed_companies: [],
    });

    await applySignalToLeads(client, 'ws1', signal);
    expect(updates[0].patch.lead_status).toBe('resurfaced');
  });

  it('creates a lead for a watched company with no lead row', async () => {
    const { client, inserts, updates } = fakeClient({
      signal_leads: [],
      signal_followed_companies: [{ company_name: 'Acme Robotics', domain: 'acme.dev' }],
    });

    const res = await applySignalToLeads(client, 'ws1', signal);

    expect(res.created).toBe(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].row.company_name).toBe('Acme Robotics');
    expect(inserts[0].row.source).toBe('manual');
    expect(updates).toHaveLength(1);
  });

  it('does nothing for an unmatched, unwatched company', async () => {
    const { client, updates, inserts } = fakeClient({
      signal_leads: [{ id: 'l1', company_name: 'Other Co', domain: null, intent_flags: {}, lead_status: 'new' }],
      signal_followed_companies: [],
    });

    const res = await applySignalToLeads(client, 'ws1', signal);
    expect(res).toEqual({ matched: 0, created: 0 });
    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it('company-less signals are dropped', async () => {
    const { client, updates } = fakeClient({ signal_leads: [], signal_followed_companies: [] });
    const res = await applySignalToLeads(client, 'ws1', { ...signal, companyName: undefined });
    expect(res).toEqual({ matched: 0, created: 0 });
    expect(updates).toHaveLength(0);
  });
});
