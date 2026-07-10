import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { isEnabled } from '@/lib/feature-flags';
import { checkAndIncrementUsage } from '@/lib/ai-budget';
import { loadCreatorVoiceContext, fetchL4BaselineBlock } from '@/lib/voice-context';
import { generateWithVoicePipeline, type VoicePipelineResult } from '@/lib/voice-pipeline';
import { getBestHooksForContext } from '@/lib/hooks-intelligence';
import { PILLAR_TO_VERTICAL } from '@/lib/hooks-intelligence/types';
import { profilePillarWeights } from '@/lib/pillars';
import { buildQuestionsAndAnswers, resolvePostPillar } from '@/lib/event-capture/draft-context';

interface RouteParams {
  params: { id: string };
}

interface EventCaptureForProcess {
  id: string;
  workspace_id: string;
  user_id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string;
  event_type: string;
  is_public_event: boolean;
  attendees: Array<{ name: string }> | null;
  questions: string[] | null;
  answers: Record<string, string> | null;
}

interface SocialAccountRow {
  platform: string;
  unipile_account_id: string | null;
}

interface EventResearchRow {
  summary: string | null;
  speakers: Array<{ name: string; title?: string; handle?: string }> | null;
  key_topics: string[] | null;
  key_announcements: string[] | null;
  sources: string[] | null;
  raw_text: string | null;
}

// Max chars per platform for draft validation.
const PLATFORM_LIMITS: Record<string, number> = {
  linkedin: 3000,
  twitter: 280,
  x: 280,
};

/**
 * POST /api/event-capture/[id]/process
 * Internal route (protected by x-internal-secret header = CRON_SECRET).
 * Triggered by fire-and-forget from /answers or /auto-draft — never called directly by users.
 *
 * Orchestrates background draft generation:
 *   1. Loads which platforms the user has connected via Unipile.
 *   2. Loads creator voice context and event research.
 *   3. Checks AI budget per platform (Sonnet).
 *   4. Runs generateWithVoicePipeline for each connected platform in parallel.
 *   5. Inserts posts with event_capture_id + status='scripted'.
 *   6. Updates capture status to 'drafted'.
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  // Internal route auth — must match CRON_SECRET.
  const internalSecret = request.headers.get('x-internal-secret');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || internalSecret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = getServiceClient();

  // Feature flag check. The caller (/answers or /auto-draft) already flipped the
  // capture to 'drafting' before firing this route, and the 3s detail poll waits
  // on that. If we skip here without reverting, the capture is stranded at
  // 'drafting' and the poll spins forever. Revert to 'questions_ready' so the
  // user can retry once the flag is on.
  if (!await isEnabled(client, 'layer1_draft_generation')) {
    await client.database
      .from('event_captures')
      .update({ status: 'questions_ready', updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .eq('status', 'drafting');
    return NextResponse.json({ skipped: true, reason: 'flag_disabled' });
  }

  // --- Load the event capture ---
  const { data: captureData } = await client.database
    .from('event_captures')
    .select(
      'id, workspace_id, user_id, title, description, location, start_time, end_time, event_type, is_public_event, attendees, questions, answers',
    )
    .eq('id', params.id)
    .single();

  if (!captureData) {
    return NextResponse.json({ error: 'Capture not found' }, { status: 404 });
  }

  const capture = captureData as EventCaptureForProcess;

  // --- Load connected social platforms via Unipile ---
  // Generate drafts ONLY for platforms the user has connected — never create X drafts
  // if the user hasn't connected X (spec constraint #7).
  const { data: socialAccounts } = await client.database
    .from('social_accounts')
    .select('platform, unipile_account_id')
    .eq('workspace_id', capture.workspace_id)
    .eq('user_id', capture.user_id)
    .not('unipile_account_id', 'is', null);

  const connectedAccounts = (socialAccounts ?? []) as SocialAccountRow[];
  const connectedPlatforms = connectedAccounts
    .map((a) => a.platform.toLowerCase())
    .filter((p) => ['linkedin', 'twitter', 'x'].includes(p));

  // Fall back to LinkedIn only if no platforms connected — better 1 draft than 0.
  const platforms = connectedPlatforms.length > 0 ? connectedPlatforms : ['linkedin'];

  // --- Load event research ---
  const { data: researchData } = await client.database
    .from('event_research')
    .select('summary, speakers, key_topics, key_announcements, sources, raw_text')
    .eq('event_capture_id', params.id)
    .maybeSingle();

  const research = researchData as EventResearchRow | null;

  // --- Load creator voice context ---
  const { profile, contextAdditions } = await loadCreatorVoiceContext(
    client,
    capture.user_id,
    {
      workspaceId: capture.workspace_id,
      memoryQuery: capture.title,
    },
  );

  // --- Build event context for generation ---
  // Index-keyed pairing carries the user's answers into the written post.
  const questionsAndAnswers = buildQuestionsAndAnswers(capture.questions, capture.answers);

  // When structured extraction failed (no speakers/topics/announcements), the
  // raw_text is just noisy SERP filler and the summary silently degraded to the
  // title. Label it as unverified so the model does not present it as fact —
  // instead of thin research looking identical to a rich, successful enrichment.
  const researchIsThin =
    !!research &&
    !(research.speakers?.length || research.key_topics?.length || research.key_announcements?.length);

  // Prefer the clean extracted summary (was a dead select) as the research lead
  // when enrichment actually succeeded; the raw_text follows as supporting detail.
  const summaryContext = research?.summary && !researchIsThin
    ? `\nWhat this event was about: ${research.summary}`
    : '';

  const researchContext = research?.raw_text
    ? `\n${researchIsThin
        ? 'Unverified web snippets (may be noisy - rely on the answers above and do not state these as facts unless corroborated)'
        : 'Event research'}:\n${research.raw_text.slice(0, 2000)}`
    : '';

  const speakersContext = research?.speakers?.length
    ? `\nKey speakers: ${research.speakers.map((s) => `${s.name}${s.title ? ' (' + s.title + ')' : ''}`).join(', ')}`
    : '';

  const topicsContext = research?.key_topics?.length
    ? `\nKey topics covered: ${research.key_topics.join(', ')}`
    : '';

  // Specific, name-level details captured at ingest/enrich but never reaching the
  // model before: who was there, what the event was about, what was announced.
  const attendeesContext = capture.attendees?.length
    ? `\nPeople there: ${capture.attendees.map((a) => a.name).filter(Boolean).join(', ')}`
    : '';

  const descriptionContext = capture.description?.trim()
    ? `\nEvent description: ${capture.description.trim().slice(0, 500)}`
    : '';

  const announcementsContext = research?.key_announcements?.length
    ? `\nKey announcements: ${research.key_announcements.join('; ')}`
    : '';

  // Derive the creator's top hook vertical so event-recap hooks are anchored to
  // their niche instead of being fetched with an undefined vertical (which
  // silently returned an empty set).
  const pillarWeights = profilePillarWeights(profile?.content_pillars);
  const topPillar = Object.entries(pillarWeights).sort((a, b) => b[1] - a[1])[0]?.[0];
  const eventVertical = topPillar ? PILLAR_TO_VERTICAL[topPillar] : undefined;

  // --- Generate drafts in parallel for each connected platform ---
  interface PlatformDraft {
    platform: string;
    result: VoicePipelineResult;
  }

  const generationResults = await Promise.allSettled<PlatformDraft>(
    platforms.map(async (platform) => {
      // Check per-platform AI budget before each Sonnet call.
      const budget = await checkAndIncrementUsage(client, capture.workspace_id, 'sonnet');
      if (budget === 'blocked') {
        throw new Error(`Sonnet budget blocked for workspace ${capture.workspace_id}`);
      }

      const platformLabel = platform === 'twitter' ? 'Twitter/X' : 'LinkedIn';
      // The pipeline gates PLATFORM_PLAYBOOKS on lowercase enums (linkedin|twitter).
      // Pass the enum (mapping x -> twitter), not the human label, or the playbook
      // is silently skipped for event drafts. The label is only for the task hint.
      const platformEnum = platform === 'x' || platform === 'twitter' ? 'twitter' : 'linkedin';
      const charLimit = PLATFORM_LIMITS[platform] ?? 3000;

      // Load best hooks for event recap context, anchored to the creator's
      // top vertical (was called with an undefined vertical before).
      const hooks = getBestHooksForContext(eventVertical, 4);
      const hookExamples = hooks.length
        ? `\nHigh-converting hook structures to adapt:\n${hooks.map((h, i) => `${i + 1}. "${h.text}"`).join('\n')}`
        : '';

      const userPrompt = `Write a ${platformLabel} post about this event you attended.

Event: ${capture.title}
Date: ${new Date(capture.start_time).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}${capture.location ? '\nLocation: ' + capture.location : ''}
Type: ${capture.event_type}${descriptionContext}${summaryContext}${attendeesContext}${speakersContext}${topicsContext}${announcementsContext}${researchContext}

${questionsAndAnswers ? 'What happened / key insights:\n' + questionsAndAnswers : ''}${hookExamples}

Rules for ${platformLabel}:
- Max ${charLimit} characters
- No em dashes - use hyphens or rewrite
- Write in first person, past tense (you attended this event)
- Specific details > generic observations
- End with a clear takeaway or question to readers
Return ONLY the post text.`;

      // Context is loaded once (no platform), so append this platform's L4 quality
      // baseline per draft (break 25) — cheap single-row fetch, not a full reload.
      const l4Block = await fetchL4BaselineBlock(client, capture.workspace_id, platformEnum);
      const draftContext = l4Block ? `${contextAdditions}${l4Block}` : contextAdditions;

      const pipelineResult = await generateWithVoicePipeline({
        userPrompt,
        profile,
        contextAdditions: draftContext,
        platform: platformEnum,
        contentType: 'post',
        fast: false,
      });

      // Validate character count per platform.
      const trimmedText = pipelineResult.text.trim();
      const finalText = trimmedText.length > charLimit
        ? trimmedText.slice(0, charLimit)
        : trimmedText;

      return { platform, result: { ...pipelineResult, text: finalText } };
    }),
  );

  // --- Insert posts for successful generations ---
  const successfulDrafts: PlatformDraft[] = generationResults
    .filter((r): r is PromiseFulfilledResult<PlatformDraft> => r.status === 'fulfilled')
    .map((r) => r.value);

  const postInserts = successfulDrafts.map(({ platform, result }) => ({
      workspace_id: capture.workspace_id,
      user_id: capture.user_id,
      event_capture_id: params.id,
      platform,
      // posts.pillar is NOT NULL — use the creator's first content pillar, else
      // 'general'. Without this the insert 23502-fails and no draft ever reaches
      // the Write section.
      pillar: resolvePostPillar(profile),
      script: result.text,
      caption: result.text,
      hook: result.text.split('\n')[0].slice(0, 200),
      title: capture.title.slice(0, 80),
      status: 'scripted' as const,
      voice_match_score: result.voice_match_score,
      notes: JSON.stringify({
        event_generated: true,
        event_type: capture.event_type,
        voice_match_score: result.voice_match_score,
        ai_score: result.ai_score,
        revised: result.revised,
        iterations: result.iterations,
      }),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

  let insertedPosts: Array<{ id: string; platform: string }> = [];
  if (postInserts.length > 0) {
    const { data: inserted, error: insertError } = await client.database
      .from('posts')
      .insert(postInserts)
      .select('id, platform');

    if (insertError) {
      // Do NOT swallow: reporting ok:true here means the UI shows "drafted" while
      // no post exists (the pillar NOT-NULL failure looked exactly like this).
      console.error('[event-capture/process] Post insert error', insertError);
      // Revert 'drafting' -> 'questions_ready' so the 3s detail poll stops and the
      // user can retry, instead of stranding forever (this route is fire-and-forget,
      // so a 500 never reaches the caller's .catch). Same fix as the flag-skip exit.
      await client.database
        .from('event_captures')
        .update({ status: 'questions_ready', updated_at: new Date().toISOString() })
        .eq('id', params.id)
        .eq('status', 'drafting');
      return NextResponse.json(
        { ok: false, error: 'Could not save the generated draft.', detail: insertError.message },
        { status: 500 },
      );
    }
    insertedPosts = (inserted ?? []) as Array<{ id: string; platform: string }>;
  }

  // Log any platform failures (X outage should not block LinkedIn draft).
  generationResults
    .filter((r) => r.status === 'rejected')
    .forEach((r) => {
      const reason = (r as PromiseRejectedResult).reason;
      console.warn('[event-capture/process] Platform generation failed', reason);
    });

  // No draft was produced (every platform generation failed or was budget-blocked).
  // Do NOT mark 'drafted' with zero posts — that leaves the inbox showing a done
  // capture with nothing in it. Revert so the capture stays actionable + retryable.
  if (insertedPosts.length === 0) {
    await client.database
      .from('event_captures')
      .update({ status: 'questions_ready', updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .eq('status', 'drafting');
    return NextResponse.json(
      { ok: false, error: 'No drafts could be generated.', draftsGenerated: 0 },
      { status: 502 },
    );
  }

  // --- Update capture to 'drafted' ---
  const { error: statusError } = await client.database
    .from('event_captures')
    .update({
      status: 'drafted',
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id);

  if (statusError) {
    // Drafts DO exist but the status flip failed, so the 3s poll would spin on
    // 'drafting'. Log loudly (the row is recoverable — primaryPostId is returned).
    console.error('[event-capture/process] Failed to mark capture drafted (drafts exist)', {
      id: params.id,
      statusError,
    });
  }

  return NextResponse.json({
    ok: true,
    draftsGenerated: insertedPosts.length,
    platforms,
    posts: insertedPosts,
    primaryPostId: insertedPosts[0]?.id ?? null,
  });
}
