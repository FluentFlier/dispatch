import type { createClient } from '@insforge/sdk';
import { checkAndIncrementUsage } from '@/lib/ai-budget';
import {
  researchPublicEvent,
  researchCacheKey,
  getCachedResearch,
  putCachedResearch,
} from '@/lib/event-capture/research';
import { generateEventQuestions } from '@/lib/event-capture/questions';
import { isPublicEvent } from '@/lib/event-capture/filter';
import type { EventType } from '@/lib/event-capture/filter';

type InsforgeClient = ReturnType<typeof createClient>;

const MAX_AGE_MS = 48 * 60 * 60 * 1000;

export type EnrichOutcome = 'questions_ready' | 'skipped_too_old' | 'budget_blocked' | 'capture_not_found';

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
 * Stage 2 enrichment for one event_capture: research (if public) + question
 * generation, advancing status to 'questions_ready'. Shared by the event-enrich
 * cron (job-queue driven, prod) and the manual resync route (direct call, so a
 * local reload doesn't sit on 'detected' waiting for a cron that never runs on
 * localhost). Callers own job-queue bookkeeping — this function only touches
 * event_captures / event_research / creator_profile.
 */
export async function enrichCapture(client: InsforgeClient, captureId: string, now: Date): Promise<EnrichOutcome> {
  const { data: captureData } = await client.database
    .from('event_captures')
    .select('id, workspace_id, user_id, title, location, start_time, end_time, event_type, is_public_event')
    .eq('id', captureId)
    .single();

  if (!captureData) return 'capture_not_found';
  const capture = captureData as EventCaptureRow;

  const endTime = new Date(capture.end_time);
  if (now.getTime() - endTime.getTime() > MAX_AGE_MS) return 'skipped_too_old';

  const budget = await checkAndIncrementUsage(client, capture.workspace_id, 'haiku');
  if (budget === 'blocked') return 'budget_blocked';

  await client.database
    .from('event_captures')
    .update({ status: 'researching', updated_at: new Date().toISOString() })
    .eq('id', captureId);

  let researchSummary: string | null = null;
  let researchRawText: string | null = null;

  if (isPublicEvent(capture.event_type)) {
    try {
      const cacheKey = researchCacheKey(capture.title, capture.location, new Date(capture.start_time));
      let research = await getCachedResearch(client, cacheKey);
      if (!research) {
        research = await researchPublicEvent(capture.title, capture.location, new Date(capture.start_time));
        if (research) await putCachedResearch(client, cacheKey, research);
      }
      if (research) {
        researchSummary = research.summary;
        researchRawText = research.raw_text;
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
      console.warn('[event-capture:enrich] Research failed', { captureId, err: researchErr });
    }
  }

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
      const raw = typeof row.content_pillars === 'string' ? JSON.parse(row.content_pillars) : row.content_pillars;
      if (Array.isArray(raw)) contentPillars = raw as Array<{ name: string; description?: string }>;
    }
  } catch {
    // Profile optional — questions still generated without pillars.
  }

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

  await client.database
    .from('event_captures')
    .update({ questions, status: 'questions_ready', updated_at: new Date().toISOString() })
    .eq('id', captureId);

  return 'questions_ready';
}
