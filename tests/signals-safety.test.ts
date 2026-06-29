import { describe, expect, it } from 'vitest';
import {
  computeRequiredCooldownMs,
  DEFAULT_SAFETY_SETTINGS,
  isWithinWorkingHours,
  shouldPollSource,
} from '@/lib/signals/safety';

describe('signal safety', () => {
  it('enforces minimum poll interval', () => {
    const fiveMinAgo = new Date(Date.now() - 4 * 60_000).toISOString();
    expect(shouldPollSource(fiveMinAgo, 5, 5)).toBe(false);
    expect(shouldPollSource(fiveMinAgo, 3, 5)).toBe(false);

    const sixMinAgo = new Date(Date.now() - 6 * 60_000).toISOString();
    expect(shouldPollSource(sixMinAgo, 5, 5)).toBe(true);
  });

  it('respects working hours window', () => {
    const settings = {
      ...DEFAULT_SAFETY_SETTINGS,
      workspace_id: 'test',
      working_hours_only: true,
      working_hours_utc_start: 14,
      working_hours_utc_end: 22,
    };
    expect(isWithinWorkingHours(settings, new Date('2026-06-26T15:00:00Z'))).toBe(true);
    expect(isWithinWorkingHours(settings, new Date('2026-06-26T23:00:00Z'))).toBe(false);
  });

  it('adds jitter to cooldown', () => {
    const settings = {
      ...DEFAULT_SAFETY_SETTINGS,
      workspace_id: 'test',
      min_seconds_between_sends: 180,
      max_jitter_seconds: 60,
    };
    const ms = computeRequiredCooldownMs(settings, () => 0.5);
    expect(ms).toBe((180 + 30) * 1000);
  });
});
