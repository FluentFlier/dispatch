import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { loadCreatorVoiceContext } from '@/lib/voice-context';
import { generateWithVoicePipeline } from '@/lib/voice-pipeline';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { guardAiRequest } from '@/lib/ai-guard';
import { errorResponse } from '@/lib/api-errors';
import { z } from 'zod';

const AutoGenSchema = z.object({
  type: z.enum(['trend_reaction', 'scheduled', 'reply', 'original']),
  topic: z.string().optional(),
  platform: z.enum(['twitter', 'linkedin', 'instagram', 'threads']),
  trendId: z.string().optional(),
  context: z.string().optional(),
});

/**
 * Content types and their approval requirements:
 * - trend_reaction: auto-queue, can auto-publish if setting enabled
 * - reply: auto-queue, can auto-publish
 * - scheduled: auto-queue, needs approval
 * - original: always needs approval
 */
const AUTO_PUBLISH_TYPES = ['trend_reaction', 'reply'];

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = AutoGenSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const { type, topic, platform, context } = parsed.data;

  const guard = await guardAiRequest(user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);

  // Full context (workspace + platform) so trend/reply/scheduled posts get the
  // same story bank, L4 baseline, and signals as manual drafts — not a thinned,
  // user-only lookup.
  const { profile, contextAdditions } = await loadCreatorVoiceContext(client, user.id, {
    memoryQuery: topic ?? context,
    workspaceId: workspaceId ?? undefined,
    platform,
  });

  // Check auto-publish setting
  const { data: autoPublishSetting } = await client.database
    .from('user_settings')
    .select('value')
    .eq('user_id', user.id)
    .eq('key', 'auto_publish_reactions')
    .maybeSingle();

  const autoPublishEnabled = autoPublishSetting?.value === 'true';
  const shouldAutoPublish = autoPublishEnabled && AUTO_PUBLISH_TYPES.includes(type);

  // Platform-specific constraints
  const platformGuide: Record<string, string> = {
    twitter: 'Max 280 characters. Punchy, conversational. No hashtags unless absolutely necessary.',
    linkedin: 'Professional but human. 1-3 short paragraphs. Can use line breaks for emphasis. 1-3 relevant hashtags at end.',
    instagram: 'Caption style. Hook in first line. Use line breaks. 5-15 hashtags at end.',
    threads: 'Conversational, like twitter but can be longer. Thread-worthy if topic is deep.',
  };

  const typeGuide: Record<string, string> = {
    trend_reaction: 'Quick take on a trending topic. Be first, be bold, have a clear opinion.',
    reply: 'Engaging reply that adds value. Not sycophantic. Offer a new angle or insight.',
    scheduled: 'Planned content that follows the creator\'s content calendar and pillars.',
    original: 'Original thought leadership piece. Deep insight, personal angle, unique perspective.',
  };

  const prompt = `Write a ${type.replace('_', ' ')} post for ${platform}.

Topic: ${topic || 'Creator\'s choice based on their pillars'}
${context ? `Additional context: ${context}` : ''}

Platform rules: ${platformGuide[platform]}
Content type: ${typeGuide[type]}

Return ONLY the post text, ready to publish.`;

  try {
    // Route through the full voice pipeline (base -> hooks -> humanize -> voice ->
    // evaluate) so trend/reply/scheduled posts get the same voice QA as manual
    // drafts, instead of a single ungated generateContent call.
    const result = await generateWithVoicePipeline({
      userPrompt: prompt,
      profile,
      contextAdditions,
      platform,
      contentType: type === 'reply' ? 'reply' : 'post',
      hooksClient: client,
    });

    const content = result.text.trim();
    const hook = content.split('\n').find((l) => l.trim())?.trim() ?? (topic ?? 'Auto-generated post');
    const generated = {
      content,
      hook,
      hashtags: null as string | null,
      // Derive a confidence signal from the voice match score so downstream
      // consumers keep a 0-1 field.
      confidence: result.voice_match_score ? result.voice_match_score / 100 : null,
      reasoning: `Generated via voice pipeline (${result.stagesCompleted?.join(' -> ') ?? 'base'})`,
    };

    // Store in auto_generated_posts queue
    const { data: savedPost, error: saveError } = await client.database
      .from('posts')
      .insert([{
        user_id: user.id,
        workspace_id: workspaceId ?? null,
        title: hook.slice(0, 80),
        pillar: profile?.content_pillars?.[0]?.name || 'general',
        platform,
        status: shouldAutoPublish ? 'edited' : 'scripted',
        script: content,
        caption: content,
        hashtags: null,
        hook,
        // Persist voice scores so these posts feed the same flywheel as the rest.
        // Use ?? not || so a genuine 0 (e.g. ai_slop 0 = fully human, the BEST
        // score) is stored as 0, not nulled out of the metrics.
        voice_match_score: result.voice_match_score ?? null,
        ai_score: result.ai_score ?? null,
        voice_evaluation: result.evaluation ?? null,
        used_hook_ids: result.usedHookIds ?? [],
        pipeline_stages: result.stagesCompleted ?? [],
        notes: JSON.stringify({
          auto_generated: true,
          type,
          confidence: generated.confidence,
          reasoning: generated.reasoning,
          auto_publish: shouldAutoPublish,
        }),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }])
      .select()
      .single();

    if (saveError) {
      return errorResponse('Failed to save generated content.', 500, saveError);
    }

    return NextResponse.json({
      post: savedPost,
      generated,
      auto_publish: shouldAutoPublish,
    });
  } catch (err) {
    return errorResponse('Generation failed.', 500, err);
  }
}
