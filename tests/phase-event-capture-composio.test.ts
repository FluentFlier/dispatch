import { describe, it, expect } from 'vitest';
import { ingestEvents } from '@/lib/event-capture/ingest';
import type { NormalizedEvent } from '@/lib/event-capture/sources/types';

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
});
