import { describe, it, expect } from 'vitest';
import { shouldCaptureEvent } from '@/lib/event-capture/filter';

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
