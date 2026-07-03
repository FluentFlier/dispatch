import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { isEnabled } from '@/lib/feature-flags';
import { enrichCapture } from '@/lib/event-capture/enrich';

// --- Types for DB rows ---

interface JobRow {
  id: string;
  workspace_id: string;
  payload: { event_capture_id: string };
  attempts: number;
  max_attempts: number;
}

/**
 * Stage 2 cron: drains enrich_event jobs to classify, research, and generate questions.
 *
 * Flow per job:
 *   1. Check feature flag (layer1_event_enrich).
 *   2. Claim pending jobs (mark processing) to prevent double-processing on overlapping runs.
 *   3. For each job:
 *      a. Skip if capture end_time > 48h ago (user has moved on).
 *      b. Check AI budget before Haiku call.
 *      c. If public event: run Serper+Jina research, store in event_research table.
 *      d. Generate 5 questions with Haiku.
 *      e. Update event_captures.status = 'questions_ready'.
 *      f. Mark job done.
 *   4. On error: increment attempts; fail permanently at max_attempts=3.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // --- Cron auth ---
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = getServiceClient();

  // --- Feature flag check ---
  if (!await isEnabled(client, 'layer1_event_enrich')) {
    return NextResponse.json({ skipped: true, reason: 'flag_disabled' });
  }

  // --- Claim pending jobs (LIMIT 20 per run across all workspaces) ---
  const { data: pendingJobs, error: fetchError } = await client.database
    .from('jobs')
    .select('id, workspace_id, payload, attempts, max_attempts')
    .eq('type', 'enrich_event')
    .eq('status', 'pending')
    .lt('attempts', 3)
    .order('created_at', { ascending: true })
    .limit(20);

  if (fetchError) {
    console.error('[event-enrich] Failed to fetch pending jobs', fetchError);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  const jobs = (pendingJobs ?? []) as JobRow[];

  if (jobs.length === 0) {
    return NextResponse.json({ ok: true, jobsProcessed: 0 });
  }

  // Mark all claimed jobs as processing before doing any work.
  // Prevents a second overlapping cron run from picking up the same jobs.
  await client.database
    .from('jobs')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .in('id', jobs.map((j) => j.id));

  const now = new Date();
  const results: Array<{ jobId: string; status: string }> = [];

  for (const job of jobs) {
    try {
      const outcome = await enrichCapture(client, job.payload.event_capture_id, now);

      // budget_blocked re-queues for a later run without burning an attempt;
      // every other outcome (including capture_not_found/skipped_too_old) is terminal.
      const jobStatus = outcome === 'budget_blocked' ? 'pending' : 'done';
      await client.database
        .from('jobs')
        .update({ status: jobStatus, updated_at: new Date().toISOString() })
        .eq('id', job.id);

      results.push({ jobId: job.id, status: outcome });
    } catch (err) {
      // Increment attempts — fail permanently at max_attempts to stop silent loops.
      const newAttempts = job.attempts + 1;
      const newStatus = newAttempts >= job.max_attempts ? 'failed' : 'pending';

      console.error('[event-enrich] Job error', { jobId: job.id, err });

      await client.database
        .from('jobs')
        .update({
          status: newStatus,
          attempts: newAttempts,
          last_error: String(err),
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id);

      results.push({ jobId: job.id, status: newStatus });
    }
  }

  return NextResponse.json({
    ok: true,
    jobsProcessed: jobs.length,
    results,
  });
}
