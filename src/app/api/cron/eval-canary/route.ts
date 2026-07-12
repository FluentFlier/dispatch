import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { isEnabled } from '@/lib/feature-flags';
import { trackEvent } from '@/lib/analytics';
import { CANARY_CASES } from '@/lib/eval-canary/cases';
import { runCanaryCase, shouldCanaryAlarm, type DailyCanaryRate } from '@/lib/eval-canary/runner';

/**
 * GET /api/cron/eval-canary
 * Schedule: cron-job.org, every 30 min 03:00-07:30 UTC (10 hits/day).
 * Each invocation runs up to CANARY_BATCH (default 5) not-yet-done cases for
 * today; 10 x 5 = the full 50 by ~08:00 UTC. Batching exists because one
 * serverless invocation cannot run 50 full pipeline generations.
 *
 * Budget: ~50 cases/day through chatCompletion (which enforces
 * LLM_DAILY_HARD_CAP) ~= $10-45/month. Kill switch: feature flag
 * 'phase4_eval_canary' or simply disable the cron-job.org job.
 */
export const maxDuration = 300; // Vercel Pro; on Hobby (60s cap) set CANARY_BATCH=1

const TODAY = () => new Date().toISOString().slice(0, 10);

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = getServiceClient();
  if (!await isEnabled(client, 'phase4_eval_canary')) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'flag_disabled' });
  }

  const runDate = TODAY();
  const batchSize = Math.max(1, Number(process.env.CANARY_BATCH) || 5);

  try {
    const { data: doneRows } = await client.database
      .from('canary_results')
      .select('case_id')
      .eq('run_date', runDate);
    const done = new Set((doneRows ?? []).map((r) => (r as { case_id: string }).case_id));
    const todo = CANARY_CASES.filter((c) => !done.has(c.id)).slice(0, batchSize);

    let ran = 0;
    let failedToRun = 0;
    for (const c of todo) {
      try {
        const r = await runCanaryCase(c);
        await client.database.from('canary_results').insert({
          run_date: runDate,
          case_id: c.id,
          hard_pass: r.hardPass,
          judge_pass: r.judgePass,
          detail: r.detail,
        });
        ran++;
      } catch (err) {
        // One broken case (provider 500, budget-cap LlmError) must not kill the
        // batch. Write a placeholder failure row so the case counts as done and
        // the day can always complete - a persistently-broken case then surfaces
        // as a sustained pass-rate drop (alarm fires, human sees detail.runError)
        // instead of silently pinning the day at 49/50 forever and disabling
        // drift detection. One transient throw is 1/50 = 2% for one day, below
        // the 3-point sustained-3-day alarm threshold, so it cannot false-alarm.
        // ponytail: no within-day retry for transient errors; silent-dark is the
        // worse failure, and the case runs fresh next day (rows are per run_date).
        failedToRun++;
        console.warn(`[eval-canary] case ${c.id} failed`, err);
        try {
          await client.database.from('canary_results').insert({
            run_date: runDate,
            case_id: c.id,
            hard_pass: false,
            judge_pass: false,
            detail: { runError: err instanceof Error ? err.message : String(err) },
          });
          ran++; // placeholder row counts toward day-completion
        } catch {
          // Unique-violation from a genuine double-fire: row already exists, leave it.
        }
      }
    }

    // Alarm evaluation once the day is complete.
    let alarm: { alarm: boolean; reason?: string } = { alarm: false };
    if (done.size + ran >= CANARY_CASES.length) {
      const since = new Date(Date.now() - 21 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const { data: rows } = await client.database
        .from('canary_results')
        .select('run_date, hard_pass, judge_pass')
        .gte('run_date', since);
      const byDay = new Map<string, { pass: number; total: number }>();
      for (const row of rows ?? []) {
        const r = row as { run_date: string; hard_pass: boolean; judge_pass: boolean };
        const d = byDay.get(r.run_date) ?? { pass: 0, total: 0 };
        d.total += 1;
        if (r.hard_pass && r.judge_pass) d.pass += 1;
        byDay.set(r.run_date, d);
      }
      const days: DailyCanaryRate[] = Array.from(byDay.entries()).map(([dstr, v]) => ({
        runDate: dstr,
        passRate: v.total ? v.pass / v.total : 0,
        caseCount: v.total,
      }));
      alarm = shouldCanaryAlarm(days, CANARY_CASES.length);
      if (alarm.alarm) {
        console.error(`[eval-canary] ALARM: ${alarm.reason}`);
        void trackEvent('canary_alarm', { reason: alarm.reason ?? 'unknown' });
        try {
          await client.database.from('pipeline_events').insert({
            request_id: `canary-${runDate}`,
            event: 'canary_alarm',
            detail: { reason: alarm.reason },
          });
        } catch {
          // Phase 3 table missing: alarm still lands in logs + analytics.
        }
      }
    }

    return NextResponse.json({
      ok: true, runDate, ran, failedToRun,
      doneToday: done.size + ran, total: CANARY_CASES.length, alarm,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'eval-canary failed' },
      { status: 500 },
    );
  }
}
