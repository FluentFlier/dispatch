import { describe, expect, it } from 'vitest';
import {
  ENGAGEMENT_SCHEDULE_MINUTES,
  INTER_CALL_DELAY_MS,
  randomMs,
  scheduleHumanizedEngagementAt,
} from '@/lib/signals/safety/humanize';
import { DEFAULT_SAFETY_SETTINGS } from '@/lib/signals/safety/limits';

describe('signal safety humanize', () => {
  it('randomMs stays within bounds', () => {
    expect(randomMs(100, 200, () => 0)).toBe(100);
    expect(randomMs(100, 200, () => 0.999)).toBeLessThan(200);
  });

  it('schedules engagement at least minDelayMinutes in the future', () => {
    const now = new Date('2026-07-07T16:00:00Z');
    const settings = {
      ...DEFAULT_SAFETY_SETTINGS,
      workspace_id: 'ws',
      working_hours_only: false,
    };
    const at = scheduleHumanizedEngagementAt(settings, {
      now,
      minDelayMinutes: ENGAGEMENT_SCHEDULE_MINUTES.min,
      maxDelayMinutes: ENGAGEMENT_SCHEDULE_MINUTES.min,
      randomFn: () => 0,
    });
    const deltaMin = (at.getTime() - now.getTime()) / 60_000;
    expect(deltaMin).toBeGreaterThanOrEqual(ENGAGEMENT_SCHEDULE_MINUTES.min - 0.01);
  });

  it('shifts scheduled time into working hours when required', () => {
    const now = new Date('2026-07-07T23:30:00Z'); // outside 14–22 UTC window
    const settings = {
      ...DEFAULT_SAFETY_SETTINGS,
      workspace_id: 'ws',
      working_hours_only: true,
      working_hours_utc_start: 14,
      working_hours_utc_end: 22,
    };
    const at = scheduleHumanizedEngagementAt(settings, { now, randomFn: () => 0.1 });
    expect(at.getUTCHours()).toBeGreaterThanOrEqual(14);
    expect(at.getUTCHours()).toBeLessThan(22);
  });

  it('inter-call delay is non-instant but serverless-safe (chained calls never fire back-to-back)', () => {
    expect(INTER_CALL_DELAY_MS.min).toBeGreaterThanOrEqual(2_000);
    expect(INTER_CALL_DELAY_MS.max).toBeGreaterThan(INTER_CALL_DELAY_MS.min);
    // Must stay well under typical serverless request budgets so the inline
    // lookup→send path can't time out.
    expect(INTER_CALL_DELAY_MS.max).toBeLessThanOrEqual(10_000);
  });

  it('awaitInterCallDelay resolves without hanging (real sleeps are no-ops under test)', async () => {
    const { awaitInterCallDelay } = await import('@/lib/signals/safety/humanize');
    await expect(awaitInterCallDelay(() => 0)).resolves.toBeUndefined();
  });
});
