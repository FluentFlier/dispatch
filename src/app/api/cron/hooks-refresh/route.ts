import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { mineNiche } from '@/lib/hooks-intelligence/mining';
import { logCronRun } from '@/lib/admin/cron-log';
import { logError, logInfo } from '@/lib/logger';

/**
 * GET /api/cron/hooks-refresh
 * Schedule: weekly (cron-job.org, same Bearer CRON_SECRET auth as other crons).
 *
 * Mines every active niche due for a refresh (never mined or > 7 days stale),
 * cheapest-first, stopping when the run's scrape spend reaches
 * HOOKS_MINING_WEEKLY_CAP_USD (default 5). Then decrements the per-hook burn-out
 * counter so internal_uses_7d tracks a rolling week.
 *
 * decrement_hook_uses() is NOT created by this route - it already shipped live
 * in migrations/20260711120500_hook-usage-fns.sql (halves internal_uses_7d, spec
 * 2.3 burn-out decay). This cron just calls it; re-declaring it here with a
 * hard reset-to-0 body would silently regress that already-shipped decay.
 *
 * Per-niche mining failures are isolated: one niche throwing does not stop the
 * loop or the counter decrement for the rest of the run.
 */

export interface RefreshNiche {
  id: string; label: string; seed_keywords: string[];
  status: string; active_user_count: number; last_mined_at: string | null;
}

const WEEK_MS = 7 * 86400000;

/** Active, in-use niches never mined or stale beyond 7 days. */
export function selectDueNiches(niches: RefreshNiche[], now: number): RefreshNiche[] {
  return niches.filter((n) =>
    n.status === 'active' &&
    n.active_user_count > 0 &&
    (n.last_mined_at === null || now - new Date(n.last_mined_at).getTime() >= WEEK_MS),
  );
}

/** True while there is budget left to mine another niche. */
export function budgetGate(spentUsd: number, capUsd: number): boolean {
  return spentUsd < capUsd;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const started = Date.now();
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const capUsd = Number(process.env.HOOKS_MINING_WEEKLY_CAP_USD ?? 5) || 5;
  const dryRun = request.nextUrl.searchParams.get('dry') === '1';
  const client = getServiceClient();

  const { data: nichesRaw, error: nichesError } = await client.database
    .from('niches')
    .select('id, label, seed_keywords, status, active_user_count, last_mined_at')
    .eq('status', 'active');
  if (nichesError) {
    logError('[hooks-refresh] failed to load niches', undefined, nichesError);
    await logCronRun({ jobName: 'hooks-refresh', status: 'error', durationMs: Date.now() - started, errorMessage: nichesError.message });
    return NextResponse.json({ error: nichesError.message }, { status: 500 });
  }
  const due = selectDueNiches((nichesRaw ?? []) as unknown as RefreshNiche[], Date.now());

  let spentUsd = 0;
  let failedCount = 0;
  const mined: Array<Record<string, unknown>> = [];
  for (const niche of due) {
    if (!budgetGate(spentUsd, capUsd)) {
      mined.push({ niche: niche.id, skipped: 'budget_exhausted' });
      continue;
    }
    const remainingUsd = capUsd - spentUsd;
    const maxResults = Math.min(200, Math.floor(remainingUsd / 0.005));
    if (maxResults < 10) {
      mined.push({ niche: niche.id, skipped: 'budget_exhausted' });
      continue;
    }
    if (dryRun) { mined.push({ niche: niche.id, wouldMine: maxResults }); continue; }
    try {
      const result = await mineNiche(client, niche, { maxResults });
      spentUsd += result.costUsd;
      mined.push({ niche: niche.id, accepted: result.accepted, costUsd: result.costUsd, rejections: result.rejections });
    } catch (err) {
      failedCount++;
      logError('[hooks-refresh] niche mining failed', { nicheId: niche.id }, err);
      mined.push({ niche: niche.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Rolling weekly decay of the burn-out counter (spec 2.4.3, halves
  // internal_uses_7d - see decrement_hook_uses in the migration referenced
  // above). Runs even if some niches failed to mine, so decay never stalls
  // behind an unrelated scrape error.
  if (!dryRun) {
    const { error: decError } = await (client.database as unknown as {
      rpc: (fn: string, params: Record<string, unknown>) => Promise<{ error: unknown }>;
    }).rpc('decrement_hook_uses', {});
    if (decError) logError('[hooks-refresh] decrement_hook_uses failed', undefined, decError);
  }

  const status = failedCount === 0 ? 'ok' : failedCount === due.length && due.length > 0 ? 'error' : 'partial';
  const summary = { dryRun, capUsd, spentUsd, nichesDue: due.length, nichesMined: mined.length, failedCount, mined };
  logInfo('[hooks-refresh] complete', summary);
  await logCronRun({ jobName: 'hooks-refresh', status, durationMs: Date.now() - started, summary });

  return NextResponse.json({ ok: failedCount === 0, ...summary });
}
