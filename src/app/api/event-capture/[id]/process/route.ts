import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { isEnabled } from '@/lib/feature-flags';
import { checkAndIncrementUsage } from '@/lib/ai-budget';
import { loadCreatorVoiceContext } from '@/lib/voice-context';
import { generateWithVoicePipeline, type VoicePipelineResult } from '@/lib/voice-pipeline';
import { getBestHooksForContext } from '@/lib/hooks-intelligence';
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

  // Feature flag check.
  if (!await isEnabled(client, 'layer1_draft_generation')) {
    return NextResponse.json({ skipped: true, reason: 'flag_disabled' });
  }

  // --- Load the event capture ---
  const { data: captureData } = await client.database
    .from('event_captures')
    .select(
      'id, workspace_id, user_id, title, description, location, start_time, end_time, event_type, is_public_event, questions, answers',
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

  const researchContext = research?.raw_text
    ? `\nEvent research:\n${research.raw_text.slice(0, 2000)}`
    : '';

  const speakersContext = research?.speakers?.length
    ? `\nKey speakers: ${research.speakers.map((s) => `${s.name}${s.title ? ' (' + s.title + ')' : ''}`).join(', ')}`
    : '';

  const topicsContext = research?.key_topics?.length
    ? `\nKey topics covered: ${research.key_topics.join(', ')}`
    : '';

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
      const charLimit = PLATFORM_LIMITS[platform] ?? 3000;

      // Load best hooks for event recap context.
      const hooks = getBestHooksForContext(undefined as any, 4);
      const hookExamples = hooks.length
        ? `\nHigh-converting hook structures to adapt:\n${hooks.map((h, i) => `${i + 1}. "${h.text}"`).join('\n')}`
        : '';

      const userPrompt = `Write a ${platformLabel} post about this event you attended.

Event: ${capture.title}
Date: ${new Date(capture.start_time).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}${capture.location ? '\nLocation: ' + capture.location : ''}
Type: ${capture.event_type}${speakersContext}${topicsContext}${researchContext}

${questionsAndAnswers ? 'What happened / key insights:\n' + questionsAndAnswers : ''}${hookExamples}

Rules for ${platformLabel}:
- Max ${charLimit} characters
- No em dashes - use hyphens or rewrite
- Write in first person, past tense (you attended this event)
- Specific details > generic observations
- End with a clear takeaway or question to readers
Return ONLY the post text.`;

      const pipelineResult = await generateWithVoicePipeline({
        userPrompt,
        profile,
        contextAdditions,
        platform: platformLabel,
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

  // --- Update capture to 'drafted' ---
  await client.database
    .from('event_captures')
    .update({
      status: 'drafted',
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id);

  return NextResponse.json({
    ok: true,
    draftsGenerated: insertedPosts.length,
    platforms,
    posts: insertedPosts,
    primaryPostId: insertedPosts[0]?.id ?? null,
  });
}
