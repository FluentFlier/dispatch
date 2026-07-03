/**
 * Phase: Calendar Capture End-to-End
 *
 * Proves the fixed Google Calendar pipeline actually captures a real user's
 * events, end to end: the exact Composio GOOGLECALENDAR_EVENTS_LIST item shape
 * -> normalizeGoogleEvents -> the capture-all filter -> ingestEvents -> rows in
 * event_captures. This is the regression guard for the July 2026 fixes that took
 * the live capture count from 0 to 15 (correct tool slug + version, capture-all
 * filter instead of the old conference/meetup allow-list, id-stable ingest).
 *
 * The fixtures mirror the account we debugged against: recurring class /
 * office-hours entries (which the OLD allow-list silently dropped), one public
 * event, one block-listed personal event, and one all-day entry.
 */
import { describe, it, expect } from 'vitest';
import { normalizeGoogleEvents } from '@/lib/composio/actions/calendar-read';
import { shouldCaptureEvent } from '@/lib/event-capture/filter';
import { ingestEvents } from '@/lib/event-capture/ingest';
import type { NormalizedEvent } from '@/lib/event-capture/sources/types';

/** now, set a few hours after the recent fixtures so they are inside the 48h recency window. */
const NOW = new Date('2026-07-03T00:00:00Z');

/** Raw Google Calendar items exactly as Composio returns them under data.items. */
const GOOGLE_ITEMS = [
  { id: 'oh1', summary: 'CSE 355 Office Hours',
    start: { dateTime: '2026-07-02T17:00:00Z' }, end: { dateTime: '2026-07-02T18:00:00Z' } },
  { id: 'cls1', summary: 'CSE 463: Introduction to Human Computer Interaction', location: '450 E Orange St, Tempe, AZ',
    start: { dateTime: '2026-07-02T22:00:00Z' }, end: { dateTime: '2026-07-02T23:15:00Z' } },
  { id: 'pitch1', summary: 'Startup Pitch Night', location: 'SkySong, Scottsdale',
    start: { dateTime: '2026-07-02T17:00:00Z' }, end: { dateTime: '2026-07-02T18:30:00Z' } },
  { id: 'lunch1', summary: 'Lunch with team',
    start: { dateTime: '2026-07-02T19:00:00Z' }, end: { dateTime: '2026-07-02T20:00:00Z' } },
  { id: 'allday1', summary: 'Spring Break', start: { date: '2026-07-02' }, end: { date: '2026-07-03' } },
];

/**
 * In-memory InsForge client for ingestEvents: every event is new (maybeSingle
 * returns null), captures the inserted event_captures rows and enqueued jobs.
 */
function memClient() {
  const captures: Array<Record<string, unknown>> = [];
  const jobs: Array<Record<string, unknown>> = [];
  let seq = 0;
  const client = {
    database: {
      from(table: string) {
        if (table === 'jobs') {
          return { insert: (row: Record<string, unknown>) => { jobs.push(row); return { data: null, error: null }; } };
        }
        const q: Record<string, unknown> = {};
        q.select = () => q;
        q.eq = () => q;
        q.maybeSingle = () => ({ data: null, error: null });
        q.insert = (row: Record<string, unknown>) => ({
          select: () => { const id = `cap_${++seq}`; captures.push({ id, ...row }); return { data: [{ id }], error: null }; },
        });
        return q;
      },
    },
  };
  return { client, captures, jobs };
}

describe('Phase: Calendar Capture End-to-End', () => {
  describe('normalizeGoogleEvents (Composio response -> NormalizedEvent)', () => {
    it('keeps timed events and drops the all-day entry', () => {
      const out = normalizeGoogleEvents(GOOGLE_ITEMS);
      expect(out.map((e) => e.providerEventId)).toEqual(['oh1', 'cls1', 'pitch1', 'lunch1']);
      expect(out.find((e) => e.providerEventId === 'allday1')).toBeUndefined();
      expect(out[1].title).toBe('CSE 463: Introduction to Human Computer Interaction');
      expect(out[1].location).toBe('450 E Orange St, Tempe, AZ');
    });
  });

  describe('capture-all filter (why office hours + classes now come through)', () => {
    it('captures office hours, a class, and a public event; blocks lunch', () => {
      const norm = normalizeGoogleEvents(GOOGLE_ITEMS);
      const byId = (id: string) => norm.find((e) => e.providerEventId === id)!;
      expect(shouldCaptureEvent(byId('oh1'), NOW)).toBe(true);   // office hours - dropped by the OLD allow-list
      expect(shouldCaptureEvent(byId('cls1'), NOW)).toBe(true);  // class - dropped by the OLD allow-list
      expect(shouldCaptureEvent(byId('pitch1'), NOW)).toBe(true);
      expect(shouldCaptureEvent(byId('lunch1'), NOW)).toBe(false); // block-listed personal event
    });

    it('a past event (>48h old) is dropped by default but captured on a manual reload (ignoreRecency)', () => {
      const oldOfficeHours: NormalizedEvent = {
        providerEventId: 'oh_june', source: 'google', title: 'CSE 355 Office Hours',
        startTime: new Date('2026-06-04T17:00:00Z'), endTime: new Date('2026-06-04T18:00:00Z'),
      };
      expect(shouldCaptureEvent(oldOfficeHours, NOW)).toBe(false); // hourly cron window
      expect(shouldCaptureEvent(oldOfficeHours, NOW, { ignoreRecency: true })).toBe(true); // manual reload window
    });
  });

  describe('ingestEvents (rows land in event_captures + enrich queued)', () => {
    it('captures the 3 real events, skips lunch, classifies types, and queues enrich for each', async () => {
      const norm = normalizeGoogleEvents(GOOGLE_ITEMS);
      const { client, captures, jobs } = memClient();

      const res = await ingestEvents(
        client as never,
        { workspaceId: 'ws-1', userId: 'u-1' },
        norm,
        NOW,
        'replace',
      );

      expect(res).toMatchObject({ created: 3, updated: 0 }); // office hours + class + pitch; lunch filtered out
      expect(captures.map((c) => c.provider_event_id)).toEqual(['oh1', 'cls1', 'pitch1']);

      const pitch = captures.find((c) => c.provider_event_id === 'pitch1')!;
      expect(pitch.event_type).toBe('pitch');
      expect(pitch.is_public_event).toBe(true);

      const office = captures.find((c) => c.provider_event_id === 'oh1')!;
      expect(office.event_type).toBe('other');
      expect(office.is_public_event).toBe(false);
      expect(office.status).toBe('detected');

      // One enrich_event job enqueued per captured event.
      expect(jobs).toHaveLength(3);
      expect(jobs.every((j) => j.type === 'enrich_event')).toBe(true);
    });
  });
});
