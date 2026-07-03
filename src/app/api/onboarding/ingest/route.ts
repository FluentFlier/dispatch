import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId, ensureSoloWorkspace } from '@/lib/workspace';
import { guardAiRequest } from '@/lib/ai-guard';
import { errorResponse } from '@/lib/api-errors';
import {
  fetchPostsFromUnipile,
  resolveProviderUserId,
  selectSamplesForAnalysis,
  type OnboardingPlatform,
  type VoiceSample,
} from '@/lib/onboarding/import-posts';
import { buildCreatorBaseline } from '@/lib/onboarding/baseline';
import { synthesizePersonaFromAnalysis } from '@/lib/onboarding/synthesize-voice';
import { analyzeVoiceSamples } from '@/lib/voice-lab/analyze-samples';
import { persistImportedPosts } from '@/lib/voice-lab/persist-imported-posts';
import { syncBrainVoiceLab } from '@/lib/brain/sync';

const MIN_SAMPLES = 3;
const TARGET_PLATFORMS: OnboardingPlatform[] = ['linkedin', 'twitter'];

export interface OnboardingIngestResponse {
  baseline: ReturnType<typeof buildCreatorBaseline>;
  postsImported: number;
  platforms: string[];
  saved: boolean;
}

/**
 * POST /api/onboarding/ingest
 *
 * Connect-first onboarding pipeline: import posts from connected Unipile accounts,
 * analyze voice, synthesize persona, persist profile + baseline, return report.
 * Designed to beat Stanley's "analyze before you ask anything" moment.
 */
export async function POST(_request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!process.env.UNIPILE_API_KEY || !process.env.UNIPILE_DSN) {
    return NextResponse.json(
      { error: 'Social integration not configured. Connect accounts in Settings.' },
      { status: 503 },
    );
  }

  const guard = await guardAiRequest(user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);
  const persistWorkspaceId = workspaceId ?? (await ensureSoloWorkspace(user.id)).id;

  let query = client.database
    .from('social_accounts')
    .select('platform, unipile_account_id, account_id, account_name')
    .eq('user_id', user.id)
    .not('unipile_account_id', 'is', null)
    .in('platform', TARGET_PLATFORMS);

  if (workspaceId) query = query.eq('workspace_id', workspaceId);

  const { data: accounts, error: accountsError } = await query;

  if (accountsError || !accounts?.length) {
    return NextResponse.json(
      { error: 'Connect LinkedIn or X first, then try again.' },
      { status: 400 },
    );
  }

  const allSamples: VoiceSample[] = [];
  const connectedPlatforms: string[] = [];
  let displayName = user.email?.split('@')[0] ?? 'Creator';

  for (const account of accounts) {
    const platform = account.platform as OnboardingPlatform;
    if (!TARGET_PLATFORMS.includes(platform)) continue;

    const providerUserId = await resolveProviderUserId(
      account.unipile_account_id,
      account.account_id,
    );
    if (!providerUserId) continue;

    try {
      const { samples, rawItems } = await fetchPostsFromUnipile(
        providerUserId,
        account.unipile_account_id,
        platform,
      );

      if (samples.length > 0) {
        connectedPlatforms.push(platform === 'linkedin' ? 'LinkedIn' : 'X');
        allSamples.push(...samples);
        if (account.account_name) displayName = account.account_name;

        void persistImportedPosts({
          client,
          userId: user.id,
          workspaceId: persistWorkspaceId,
          platform,
          items: rawItems.filter(
            (item) =>
              item.id &&
              !item.is_repost &&
              !item.is_reply &&
              (item.text ?? item.commentary ?? '').trim().length > 20,
          ),
        }).catch((err) => {
          console.warn('[onboarding/ingest] background post persist failed:', err);
        });
      }
    } catch (err) {
      console.warn(`[onboarding/ingest] import failed for ${platform}:`, err);
    }
  }

  if (allSamples.length < MIN_SAMPLES) {
    return NextResponse.json(
      {
        error: `Need at least ${MIN_SAMPLES} posts to build your baseline. Found ${allSamples.length}. Post more or connect another account.`,
        postsImported: allSamples.length,
        platforms: connectedPlatforms,
      },
      { status: 400 },
    );
  }

  try {
    const analysisSamples = selectSamplesForAnalysis(allSamples, 20);
    const analysis = await analyzeVoiceSamples(analysisSamples);
    const persona = await synthesizePersonaFromAnalysis(analysis);

    const baseline = buildCreatorBaseline(analysis, {
      postsAnalyzed: allSamples.length,
      platforms: connectedPlatforms,
      displayName,
    });

    await persistOnboardingVoice(client, user.id, persistWorkspaceId, persona, baseline, analysisSamples);

    const response: OnboardingIngestResponse = {
      baseline,
      postsImported: allSamples.length,
      platforms: connectedPlatforms,
      saved: true,
    };

    return NextResponse.json(response);
  } catch (err) {
    return errorResponse('Ingest failed.', 500, err);
  }
}

async function persistOnboardingVoice(
  client: ReturnType<typeof getServerClient>,
  userId: string,
  workspaceId: string,
  persona: Awaited<ReturnType<typeof synthesizePersonaFromAnalysis>>,
  baseline: ReturnType<typeof buildCreatorBaseline>,
  samplePosts: VoiceSample[],
): Promise<void> {
  const { data: existingProfile } = await client.database
    .from('creator_profile')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  const profilePayload = {
    voice_description: persona.voice_description,
    voice_rules: persona.voice_rules,
    display_name: baseline.displayName,
    content_pillars: baseline.pillars,
    updated_at: new Date().toISOString(),
  };

  if (existingProfile) {
    await client.database
      .from('creator_profile')
      .update(profilePayload)
      .eq('user_id', userId);
  } else {
    await client.database.from('creator_profile').insert([{
      user_id: userId,
      workspace_id: workspaceId,
      bio_facts: '',
      ...profilePayload,
    }]);
  }

  const settings = [
    { key: 'vocabulary_fingerprint', value: JSON.stringify(persona.vocabulary_fingerprint) },
    { key: 'structural_patterns', value: JSON.stringify(persona.structural_patterns) },
    { key: 'persona_prompt_export', value: persona.exportable_prompt },
    { key: 'sample_posts', value: JSON.stringify(samplePosts.slice(0, 10)) },
    { key: 'onboarding_baseline', value: JSON.stringify(baseline) },
    { key: 'onboarding_suggested_topic', value: baseline.suggestedTopic },
  ];

  for (const setting of settings) {
    await client.database.from('user_settings').upsert({
      user_id: userId,
      workspace_id: workspaceId,
      key: setting.key,
      value: setting.value,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,key' });
  }

  try {
    await syncBrainVoiceLab(client, userId, {
      voice_description: persona.voice_description,
      voice_rules: persona.voice_rules,
      vocabulary_fingerprint: persona.vocabulary_fingerprint,
      structural_patterns: persona.structural_patterns,
    });
  } catch (err) {
    console.warn('[onboarding/ingest] brain sync failed (non-critical):', err);
  }
}
