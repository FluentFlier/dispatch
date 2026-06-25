import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { isEnabled } from '@/lib/feature-flags';
import { checkAndIncrementUsage } from '@/lib/ai-budget';
import { researchPublicEvent } from '@/lib/event-capture/research';
import { generateEventQuestions } from '@/lib/event-capture/questions';
import { isPublicEvent } from '@/lib/event-capture/filter';
import type { EventType } from '@/lib/event-capture/filter';

// --- Types for DB rows ---

interface JobRow {
  id: string;
  workspace_id: string;
  payload: { event_capture_id: string };
  attempts: number;
  max_attempts: number;
}

interface EventCaptureRow {
  id: string;
  workspace_id: string;
  user_id: string;
  title: string;
  location: string | null;
  start_time: string;
  end_time: string;
  event_type: EventType;
  is_public_event: boolean;
}

interface CreatorProfileRow {
  content_pillars: unknown;
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
  const MAX_AGE_MS = 48 * 60 * 60 * 1000;
  const results: Array<{ jobId: string; status: string }> = [];

  for (const job of jobs) {
    try {
      const captureId = job.payload.event_capture_id;

      // --- Load the event capture ---
      const { data: captureData } = await client.database
        .from('event_captures')
        .select('id, workspace_id, user_id, title, location, start_time, end_time, event_type, is_public_event')
        .eq('id', captureId)
        .single();

      if (!captureData) {
        // Capture deleted or missing — mark job done, don't retry.
        await client.database
          .from('jobs')
          .update({ status: 'done', updated_at: new Date().toISOString() })
          .eq('id', job.id);
        results.push({ jobId: job.id, status: 'capture_not_found' });
        continue;
      }

      const capture = captureData as EventCaptureRow;

      // --- Skip stale events ---
      const endTime = new Date(capture.end_time);
      if (now.getTime() - endTime.getTime() > MAX_AGE_MS) {
        await client.database
          .from('jobs')
          .update({ status: 'done', updated_at: new Date().toISOString() })
          .eq('id', job.id);
        results.push({ jobId: job.id, status: 'skipped_too_old' });
        continue;
      }

      // --- Check AI budget before Haiku call ---
      const budget = await checkAndIncrementUsage(client, capture.workspace_id, 'haiku');
      if (budget === 'blocked') {
        // Re-queue for tomorrow — don't increment attempts.
        await client.database
          .from('jobs')
          .update({ status: 'pending', updated_at: new Date().toISOString() })
          .eq('id', job.id);
        results.push({ jobId: job.id, status: 'budget_blocked' });
        continue;
      }

      // --- Update status to 'researching' ---
      await client.database
        .from('event_captures')
        .update({ status: 'researching', updated_at: new Date().toISOString() })
        .eq('id', captureId);

      // --- Research public events ---
      let researchSummary: string | null = null;
      let researchRawText: string | null = null;

      if (isPublicEvent(capture.event_type)) {
        try {
          const research = await researchPublicEvent(
            capture.title,
            capture.location,
            new Date(capture.start_time),
          );

          if (research) {
            researchSummary = research.summary;
            researchRawText = research.raw_text;

            // Store in event_research table (separate from event_captures to keep rows lean).
            await client.database.from('event_research').upsert(
              {
                event_capture_id: captureId,
                summary: research.summary,
                speakers: research.speakers,
                key_topics: research.key_topics,
                key_announcements: research.key_announcements,
                sources: research.sources,
                raw_text: research.raw_text,
              },
              { onConflict: 'event_capture_id' },
            );
          }
        } catch (researchErr) {
          // Research failure is non-fatal — continue with generic questions.
          console.warn('[event-enrich] Research failed', { captureId, err: researchErr });
        }
      }

      // --- Load creator content pillars for question anchoring ---
      let contentPillars: Array<{ name: string; description?: string }> | undefined;
      try {
        const { data: profileData } = await client.database
          .from('creator_profile')
          .select('content_pillars')
          .eq('user_id', capture.user_id)
          .eq('workspace_id', capture.workspace_id)
          .maybeSingle();

        if (profileData) {
          const row = profileData as CreatorProfileRow;
          const raw =
            typeof row.content_pillars === 'string'
              ? JSON.parse(row.content_pillars)
              : row.content_pillars;
          if (Array.isArray(raw)) {
            contentPillars = raw as Array<{ name: string; description?: string }>;
          }
        }
      } catch {
        // Profile optional — questions still generated without pillars.
      }

      // --- Generate 5 questions with Haiku ---
      const questions = await generateEventQuestions({
        title: capture.title,
        startDate: capture.start_time,
        location: capture.location,
        eventType: capture.event_type,
        isPublicEvent: capture.is_public_event,
        researchSummary,
        researchRawText,
        contentPillars,
      });

      // --- Save questions and advance status ---
      await client.database
        .from('event_captures')
        .update({
          questions,
          status: 'questions_ready',
          updated_at: new Date().toISOString(),
        })
        .eq('id', captureId);

      // --- Mark job done ---
      await client.database
        .from('jobs')
        .update({ status: 'done', updated_at: new Date().toISOString() })
        .eq('id', job.id);

      results.push({ jobId: job.id, status: 'done' });
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
