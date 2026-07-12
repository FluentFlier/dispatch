/**
 * Phase: Feedback Ops - canary alarm logic (spec 4.3).
 * Alarm = SUSTAINED drop: last 3 COMPLETE days each >= 3 points below the
 * median of up to 14 prior complete days. One bad day is noise (judge
 * variance, provider blip); three is drift (Anthropic Aug-Sep 2025 class).
 */
import { describe, it, expect } from 'vitest';
import { shouldCanaryAlarm, type DailyCanaryRate } from '@/lib/eval-canary/runner';

const day = (d: string, rate: number, count = 50): DailyCanaryRate => ({ runDate: d, passRate: rate, caseCount: count });
const baselineWeek = (rate: number): DailyCanaryRate[] =>
  ['01', '02', '03', '04', '05', '06', '07'].map((n) => day(`2026-07-${n}`, rate));

describe('shouldCanaryAlarm', () => {
  it('no alarm on steady rates', () => {
    const days = baselineWeek(0.94).concat([day('2026-07-08', 0.94), day('2026-07-09', 0.93), day('2026-07-10', 0.94)]);
    expect(shouldCanaryAlarm(days, 50).alarm).toBe(false);
  });
  it('no alarm on a single bad day', () => {
    const days = baselineWeek(0.94).concat([day('2026-07-08', 0.80), day('2026-07-09', 0.94), day('2026-07-10', 0.94)]);
    expect(shouldCanaryAlarm(days, 50).alarm).toBe(false);
  });
  it('ACCEPTANCE 4.5.2: alarms on 3 consecutive complete days >= 3pts under baseline', () => {
    const days = baselineWeek(0.94).concat([day('2026-07-08', 0.90), day('2026-07-09', 0.89), day('2026-07-10', 0.90)]);
    const r = shouldCanaryAlarm(days, 50);
    expect(r.alarm).toBe(true);
    expect(r.reason).toBeTruthy();
  });
  it('ignores incomplete days (partial batches must not trigger)', () => {
    const days = baselineWeek(0.94).concat([
      day('2026-07-08', 0.10, 5), day('2026-07-09', 0.10, 5), day('2026-07-10', 0.10, 5),
    ]);
    expect(shouldCanaryAlarm(days, 50).alarm).toBe(false);
  });
  it('no alarm with fewer than 4 complete days of history', () => {
    expect(shouldCanaryAlarm([day('2026-07-08', 0.5), day('2026-07-09', 0.5), day('2026-07-10', 0.5)], 50).alarm).toBe(false);
  });
});
