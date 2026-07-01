import { describe, it, expect } from 'vitest';
import { ingestEvents } from '@/lib/event-capture/ingest';
import type { NormalizedEvent } from '@/lib/event-capture/sources/types';
import { normalizeGoogleEvents } from '@/lib/composio/actions/calendar-read';

function fakeClient(upsertReturnsId: string | null) {
  const inserted: any[] = [];
  const client: any = {
    database: {
      from(table: string) {
        return {
          upsert: () => ({ select: () => ({ data: upsertReturnsId ? [{ id: upsertReturnsId }] : [], error: null }) }),
          insert: (row: any) => { inserted.push({ table, row }); return { data: null, error: null }; },
        };
      },
    },
  };
  return { client, inserted };
}

describe('Phase: Event Capture Composio', () => {
  describe('ingestEvents', () => {
    const ev: NormalizedEvent = {
      providerEventId: 'evt_1', source: 'google', title: 'NVIDIA AI Meetup',
      startTime: new Date('2026-06-24T19:00:00Z'), endTime: new Date('2026-06-24T21:00:00Z'),
    };

    it('enqueues an enrich_event job when a capture is newly inserted', async () => {
      const { client, inserted } = fakeClient('cap_123');
      const now = new Date('2026-06-24T22:00:00Z');
      const count = await ingestEvents(client, { workspaceId: 'ws1', userId: 'u1' }, [ev], now);
      expect(count).toBe(1);
      expect(inserted).toContainEqual({ table: 'jobs', row: expect.objectContaining({ type: 'enrich_event', payload: { event_capture_id: 'cap_123' } }) });
    });

    it('does not enqueue when the event is a duplicate (no id returned)', async () => {
      const { client, inserted } = fakeClient(null);
      const now = new Date('2026-06-24T22:00:00Z');
      const count = await ingestEvents(client, { workspaceId: 'ws1', userId: 'u1' }, [ev], now);
      expect(count).toBe(0);
      expect(inserted.find((i) => i.table === 'jobs')).toBeUndefined();
    });

    it('skips events that fail the capture filter', async () => {
      const { client } = fakeClient('cap_x');
      const now = new Date('2026-06-24T22:00:00Z');
      const lunch: NormalizedEvent = { ...ev, providerEventId: 'evt_2', title: 'Lunch with team' };
      const count = await ingestEvents(client, { workspaceId: 'ws1', userId: 'u1' }, [lunch], now);
      expect(count).toBe(0);
    });
  });

  describe('normalizeGoogleEvents', () => {
    it('maps Google items to NormalizedEvent and drops all-day / malformed items', () => {
      const items = [
        { id: 'a', summary: 'AI Summit', location: 'SF',
          start: { dateTime: '2026-06-24T19:00:00Z' }, end: { dateTime: '2026-06-24T21:00:00Z' },
          attendees: [{ displayName: 'Sarah Chen', email: 's@x.com' }] },
        { id: 'b', summary: 'All day thing', start: { date: '2026-06-24' }, end: { date: '2026-06-25' } },
        { id: 'c', start: { dateTime: '2026-06-24T19:00:00Z' }, end: { dateTime: '2026-06-24T20:00:00Z' } },
      ];
      const out = normalizeGoogleEvents(items as any);
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ providerEventId: 'a', source: 'google', title: 'AI Summit', location: 'SF' });
      expect(out[0].attendees).toEqual([{ name: 'Sarah Chen' }]);
    });
  });
});
