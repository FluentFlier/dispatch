import { describe, it, expect, vi, afterEach } from 'vitest';
import { shouldCaptureEvent } from '@/lib/event-capture/filter';
import { ingestEvents, cancelMissingEvents } from '@/lib/event-capture/ingest';
import type { NormalizedEvent } from '@/lib/event-capture/sources/types';
import { resolveWindow, RELOAD_PRESETS } from '@/lib/event-capture/window';

describe('resolveWindow', () => {
  const now = new Date('2026-07-02T12:00:00Z');

  it('maps last_week to [-7d, now]', () => {
    const w = resolveWindow({ preset: 'last_week' }, now);
    expect(w.timeMax.toISOString()).toBe(now.toISOString());
    expect(w.timeMin.toISOString()).toBe(new Date('2026-06-25T12:00:00Z').toISOString());
  });

  it('maps next_month to [now, +30d]', () => {
    const w = resolveWindow({ preset: 'next_month' }, now);
    expect(w.timeMin.toISOString()).toBe(now.toISOString());
    expect(w.timeMax.toISOString()).toBe(new Date('2026-08-01T12:00:00Z').toISOString());
  });

  it('uses explicit custom dates', () => {
    const w = resolveWindow({ preset: 'custom', from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' }, now);
    expect(w.timeMin.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(w.timeMax.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('exposes a labelled preset list for the UI', () => {
    expect(RELOAD_PRESETS.map((p) => p.id)).toEqual([
      'last_week', 'last_month', 'last_year', 'next_week', 'next_month', 'next_year', 'custom',
    ]);
  });
});

describe('Phase: Calendar Connect + Reload', () => {
  describe('shouldCaptureEvent ignoreRecency', () => {
    const now = new Date('2026-07-02T12:00:00Z');
    const oldConf = {
      title: 'AI Summit',
      startTime: new Date('2026-01-02T18:00:00Z'),
      endTime: new Date('2026-01-02T20:00:00Z'),
    };
    const futureConf = {
      title: 'DevConf Keynote',
      startTime: new Date('2026-10-02T18:00:00Z'),
      endTime: new Date('2026-10-02T20:00:00Z'),
    };

    it('rejects old + future events by default (recency guard on)', () => {
      expect(shouldCaptureEvent(oldConf, now)).toBe(false);
      expect(shouldCaptureEvent(futureConf, now)).toBe(false);
    });

    it('captures old + future pro events when ignoreRecency is set', () => {
      expect(shouldCaptureEvent(oldConf, now, { ignoreRecency: true })).toBe(true);
      expect(shouldCaptureEvent(futureConf, now, { ignoreRecency: true })).toBe(true);
    });

    it('still enforces duration + block list when ignoreRecency is set', () => {
      const lunch = { title: 'Lunch with team', startTime: new Date('2026-01-02T18:00:00Z'), endTime: new Date('2026-01-02T19:00:00Z') };
      const tooShort = { title: 'Quick sync conference', startTime: new Date('2026-01-02T18:00:00Z'), endTime: new Date('2026-01-02T18:10:00Z') };
      expect(shouldCaptureEvent(lunch, now, { ignoreRecency: true })).toBe(false);
      expect(shouldCaptureEvent(tooShort, now, { ignoreRecency: true })).toBe(false);
    });
  });
});

/**
 * Fake InsForge client backed by an in-memory row array. Supports the exact
 * chain ingestEvents uses: select().eq().eq().maybeSingle(), insert().select(),
 * update().eq().select(), and jobs insert(). Also supports the cancel chain
 * (neq/gte/lte + select returning data, update().in()) used in Task 3.
 */
function memClient(initialRows: any[] = []) {
  const rows: any[] = [...initialRows];
  const jobs: any[] = [];
  let idSeq = initialRows.length;
  const client: any = {
    database: {
      from(table: string) {
        if (table === 'jobs') {
          return { insert: (row: any) => { jobs.push(row); return { data: null, error: null }; } };
        }
        const q: any = { _filters: {} };
        q.eq = (col: string, val: any) => { q._filters[col] = val; return q; };
        q.neq = (col: string, val: any) => { q._neq = { col, val }; return q; };
        q.gte = (col: string, val: any) => { (q._range ??= {}).gte = { col, val }; return q; };
        q.lte = (col: string, val: any) => { (q._range ??= {}).lte = { col, val }; return q; };
        q.maybeSingle = () => {
          const found = rows.find((r) => Object.entries(q._filters).every(([k, v]) => r[k] === v));
          return { data: found ?? null, error: null };
        };
        // For the cancel lookup the chain is select().eq().neq().gte().lte(),
        // so the terminal data/error are read on q AFTER the filters are set.
        // Compute them lazily via getters so filter order does not matter.
        const filtered = () => rows.filter((r) =>
          Object.entries(q._filters).every(([k, v]) => r[k] === v) &&
          (!q._neq || r[q._neq.col] !== q._neq.val) &&
          (!q._range?.gte || r[q._range.gte.col] >= q._range.gte.val) &&
          (!q._range?.lte || r[q._range.lte.col] <= q._range.lte.val),
        );
        Object.defineProperty(q, 'data', { get: () => filtered() });
        Object.defineProperty(q, 'error', { get: () => null });
        q.select = () => q;
        q.insert = (row: any) => ({
          select: () => {
            const id = `cap_${++idSeq}`;
            rows.push({ id, ...row });
            return { data: [{ id }], error: null };
          },
        });
        q.update = (patch: any) => ({
          eq: (col: string, val: any) => ({
            select: () => {
              const r = rows.find((x) => x[col] === val);
              if (r) Object.assign(r, patch);
              return { data: r ? [{ id: r.id }] : [], error: null };
            },
          }),
          in: (col: string, vals: any[]) => {
            for (const r of rows) if (vals.includes(r[col])) Object.assign(r, patch);
            return { data: null, error: null };
          },
        });
        return q;
      },
    },
  };
  return { client, rows, jobs };
}

const nowT2 = new Date('2026-07-02T12:00:00Z');
const confT2: NormalizedEvent = {
  providerEventId: 'evt_1', source: 'google', title: 'AI Summit',
  startTime: new Date('2026-07-01T18:00:00Z'), endTime: new Date('2026-07-01T20:00:00Z'),
};

describe('ingestEvents mode + id stability', () => {
  it('inserts a new event and returns created:1', async () => {
    const { client, jobs } = memClient();
    const res = await ingestEvents(client, { workspaceId: 'ws1', userId: 'u1' }, [confT2], nowT2);
    expect(res).toEqual({ created: 1, updated: 0 });
    expect(jobs).toHaveLength(1);
  });

  it('incremental: unchanged existing event is a no-op (no update, no enrich)', async () => {
    const { client, jobs } = memClient([{
      id: 'cap_1', workspace_id: 'ws1', provider_event_id: 'evt_1', source: 'google',
      title: 'AI Summit', description: null, location: null, attendees: null,
      start_time: confT2.startTime.toISOString(), end_time: confT2.endTime.toISOString(),
      event_type: 'conference', is_public_event: true, status: 'detected',
    }]);
    const res = await ingestEvents(client, { workspaceId: 'ws1', userId: 'u1' }, [confT2], nowT2, 'incremental');
    expect(res).toEqual({ created: 0, updated: 0 });
    expect(jobs).toHaveLength(0);
  });

  it('incremental: changed title updates in place, preserves advanced status, keeps id', async () => {
    const { client, rows, jobs } = memClient([{
      id: 'cap_1', workspace_id: 'ws1', provider_event_id: 'evt_1', source: 'google',
      title: 'Old title', description: null, location: null, attendees: null,
      start_time: confT2.startTime.toISOString(), end_time: confT2.endTime.toISOString(),
      event_type: 'conference', is_public_event: true, status: 'drafted',
    }]);
    const res = await ingestEvents(client, { workspaceId: 'ws1', userId: 'u1' }, [confT2], nowT2, 'incremental');
    expect(res).toEqual({ created: 0, updated: 1 });
    expect(rows[0].id).toBe('cap_1');
    expect(rows[0].title).toBe('AI Summit');
    expect(rows[0].status).toBe('drafted');
    expect(jobs).toHaveLength(1);
  });

  it('replace: overwrites all fields, resets status to detected, keeps id', async () => {
    const { client, rows, jobs } = memClient([{
      id: 'cap_1', workspace_id: 'ws1', provider_event_id: 'evt_1', source: 'google',
      title: 'AI Summit', description: 'user edit', location: null, attendees: null,
      start_time: confT2.startTime.toISOString(), end_time: confT2.endTime.toISOString(),
      event_type: 'conference', is_public_event: true, status: 'drafted',
    }]);
    const res = await ingestEvents(client, { workspaceId: 'ws1', userId: 'u1' }, [confT2], nowT2, 'replace');
    expect(res).toEqual({ created: 0, updated: 1 });
    expect(rows[0].id).toBe('cap_1');
    expect(rows[0].description).toBeNull();
    expect(rows[0].status).toBe('detected');
    expect(jobs).toHaveLength(1);
  });
});

describe('cancelMissingEvents', () => {
  const window = { timeMin: new Date('2026-07-01T00:00:00Z'), timeMax: new Date('2026-07-03T00:00:00Z') };
  const baseRow = (over: any) => ({
    id: 'x', workspace_id: 'ws1', source: 'google', status: 'detected',
    provider_event_id: 'p', start_time: '2026-07-02T10:00:00Z', ...over,
  });

  it('cancels in-window google rows missing from the provider set, keeps present ones', async () => {
    const { client, rows } = memClient([
      baseRow({ id: 'a', provider_event_id: 'still_here' }),
      baseRow({ id: 'b', provider_event_id: 'deleted' }),
      baseRow({ id: 'c', provider_event_id: 'out_of_window', start_time: '2026-08-01T10:00:00Z' }),
    ]);
    const present = new Set(['still_here', 'out_of_window']);
    const cancelled = await cancelMissingEvents(client, { workspaceId: 'ws1' }, window, present);
    expect(cancelled).toBe(1);
    expect(rows.find((r) => r.id === 'b').status).toBe('cancelled');
    expect(rows.find((r) => r.id === 'a').status).toBe('detected');
    expect(rows.find((r) => r.id === 'c').status).toBe('detected');
  });
});

describe('resyncCalendar fetch-failure safety (I-1 regression)', () => {
  const integration: any = {
    workspace_id: 'ws1', connected_by_user_id: 'u1', composio_user_id: 'cu1',
    config: { calendar_id: 'primary' },
  };
  const window = { timeMin: new Date('2025-07-02T12:00:00Z'), timeMax: new Date('2026-07-02T12:00:00Z') };

  afterEach(() => { vi.resetModules(); vi.clearAllMocks(); });

  it('does NOT cancel events and reports an error when the calendar fetch fails', async () => {
    const cancelMissingEvents = vi.fn().mockResolvedValue(0);
    const ingestEvents = vi.fn().mockResolvedValue({ created: 0, updated: 0 });
    vi.doMock('@/lib/composio/actions/calendar-read', () => ({
      findCalendarEvents: vi.fn().mockResolvedValue({ ok: false, events: [], error: 'Composio timeout' }),
    }));
    vi.doMock('@/lib/event-capture/ingest', () => ({ ingestEvents, cancelMissingEvents }));

    const { resyncCalendar } = await import('@/lib/event-capture/resync');
    const res = await resyncCalendar({} as any, integration, window, new Date('2026-07-02T12:00:00Z'));

    expect(cancelMissingEvents).not.toHaveBeenCalled();      // the whole point: no destructive sweep on failure
    expect(res.cancelled).toBe(0);
    expect(res.errors.length).toBeGreaterThan(0);
    expect(res.errors[0]).toContain('Composio timeout');
  });

  it('cancels normally when the fetch succeeds', async () => {
    const cancelMissingEvents = vi.fn().mockResolvedValue(2);
    const ingestEvents = vi.fn().mockResolvedValue({ created: 1, updated: 0 });
    vi.doMock('@/lib/composio/actions/calendar-read', () => ({
      findCalendarEvents: vi.fn().mockResolvedValue({ ok: true, events: [{ providerEventId: 'e1' }] }),
    }));
    vi.doMock('@/lib/event-capture/ingest', () => ({ ingestEvents, cancelMissingEvents }));

    const { resyncCalendar } = await import('@/lib/event-capture/resync');
    const res = await resyncCalendar({} as any, integration, window, new Date('2026-07-02T12:00:00Z'));

    expect(cancelMissingEvents).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ created: 1, cancelled: 2, errors: [] });
  });
});
