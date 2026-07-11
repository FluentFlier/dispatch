import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { mineNiche, COST_PER_RESULT_USD } from '@/lib/hooks-intelligence/mining';
import { embeddingsKey } from '@/lib/embeddings';
import { logCronRun } from '@/lib/admin/cron-log';
import { logError, logInfo } from '@/lib/logger';
import { type RefreshNiche, selectDueNiches, budgetGate } from '@/lib/hooks-intelligence/refresh-scheduler';

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

  // Pre-flight, before any Apify spend: mineNiche only needs the embeddings key
  // at filter 6 (after the scrape already happened), so without this check a
  // missing key burns the whole run's Apify budget on posts it will fail to
  // embed. Skipped entirely for dry runs, which never call mineNiche.
  if (!dryRun) {
    try {
      embeddingsKey();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logError('[hooks-refresh] skipping run: embeddings key missing', undefined, err);
      await logCronRun({ jobName: 'hooks-refresh', status: 'error', durationMs: Date.now() - started, errorMessage: reason });
      return NextResponse.json({ ok: false, skipped: 'embeddings_key_missing', reason }, { status: 200 });
    }
  }

  const { data: nichesRaw, error: nichesError } = await client.database
    .from('niches')
    .select('id, label, seed_keywords, status, active_user_count, last_mined_at, created_at')
    .in('status', ['active', 'pending']);
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
    const maxResults = Math.min(200, Math.floor(remainingUsd / COST_PER_RESULT_USD));
    if (maxResults < 10) {
      mined.push({ niche: niche.id, skipped: 'budget_exhausted' });
      continue;
    }
    if (dryRun) { mined.push({ niche: niche.id, wouldMine: maxResults }); continue; }
    try {
      const result = await mineNiche(client, niche, { maxResults });
      spentUsd += result.costUsd;
      // B2 fallback: mineNiche only flips pending->active once it reaches the
      // final upsert stage (it returns early on zero-fit/zero-humanish
      // batches without flipping). A pending niche that got a real mining
      // attempt should not stay stuck in 'pending' forever waiting for a
      // luckier week, so the cron flips it explicitly - idempotent with
      // mineNiche's own update when that path already ran.
      if (niche.status === 'pending') {
        await client.database.from('niches').update({ status: 'active' }).eq('id', niche.id);
      }
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
