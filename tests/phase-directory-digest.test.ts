import { describe, it, expect } from 'vitest';
import { assembleDigest, localHourAndDate, shouldRunDigest } from '@/lib/signals/leads/digest';
import { intentFromSignalType } from '@/lib/signals/leads/identity';
import type { SignalLeadWithContacts } from '@/lib/signals/types';

describe('Phase 7: Digest scheduling (timezone + idempotency)', () => {
  describe('localHourAndDate', () => {
    const instant = new Date('2026-07-02T13:30:00Z');
    it('converts a UTC instant to the workspace local hour', () => {
      expect(localHourAndDate(instant, 'UTC').hour).toBe(13);
      expect(localHourAndDate(instant, 'America/Los_Angeles')).toEqual({ hour: 6, date: '2026-07-02' });
      expect(localHourAndDate(instant, 'Asia/Kolkata').hour).toBe(19);
    });
    it('rolls the local date across the day boundary', () => {
      const lateUtc = new Date('2026-07-02T03:00:00Z'); // 2026-07-01 20:00 PDT
      expect(localHourAndDate(lateUtc, 'America/Los_Angeles').date).toBe('2026-07-01');
    });
    it('falls back to UTC for an invalid timezone', () => {
      expect(localHourAndDate(instant, 'Not/AZone').hour).toBe(13);
    });
  });

  describe('shouldRunDigest', () => {
    const base = { localDate: '2026-07-02', runHour: 6 };
    it('runs when local hour equals the run hour and not yet delivered', () => {
      expect(shouldRunDigest({ ...base, localHour: 6, deliveredLocalDate: null })).toBe(true);
    });
    it('does not run before the run hour', () => {
      expect(shouldRunDigest({ ...base, localHour: 5, deliveredLocalDate: null })).toBe(false);
    });
    it('catches up a missed hour (deploy downtime) later the same day', () => {
      expect(shouldRunDigest({ ...base, localHour: 9, deliveredLocalDate: null })).toBe(true);
    });
    it('is idempotent - skips when already delivered today', () => {
      expect(shouldRunDigest({ ...base, localHour: 9, deliveredLocalDate: '2026-07-02' })).toBe(false);
    });
    it('runs again the next local day', () => {
      expect(shouldRunDigest({ ...base, localHour: 6, deliveredLocalDate: '2026-07-01' })).toBe(true);
    });
  });

  describe('assembleDigest', () => {
    const lead = (company: string, rank: number): SignalLeadWithContacts =>
      ({ id: company, company_name: company, rank_score: rank, batch: 'S24', tagline: 't' } as unknown as SignalLeadWithContacts);
    it('counts all and returns the top N by rank desc', () => {
      const d = assembleDigest([lead('A', 0.2), lead('B', 0.9), lead('C', 0.5)], 2);
      expect(d.count).toBe(3);
      expect(d.top.map((l) => l.company_name)).toEqual(['B', 'C']);
    });
    it('handles an empty list', () => {
      expect(assembleDigest([], 15)).toEqual({ count: 0, top: [] });
    });
  });
});

describe('Phase 8: signal → intent mapping', () => {
  it('maps funding to hard intent (raised)', () => {
    expect(intentFromSignalType('funding_round')).toEqual({ raised: true });
  });
  it('maps role change to soft intent (hiring)', () => {
    expect(intentFromSignalType('role_change')).toEqual({ hiring: true });
  });
  it('maps unknown/other signals to no flag', () => {
    expect(intentFromSignalType('launch')).toEqual({});
    expect(intentFromSignalType('other')).toEqual({});
  });
});
