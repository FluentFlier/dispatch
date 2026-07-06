import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId, ensureSoloWorkspace } from '@/lib/workspace';
import { guardAiRequest } from '@/lib/ai-guard';
import { errorResponse } from '@/lib/api-errors';
import { fetchOAuthDisplayName, resolveDisplayName } from '@/lib/user-display-name';
import {
  fetchPostsFromUnipile,
  resolveProviderUserId,
  type OnboardingPlatform,
  type VoiceSample,
} from '@/lib/onboarding/import-posts';
import { buildCreatorBaseline } from '@/lib/onboarding/baseline';
import { synthesizePersonaFromAnalysis } from '@/lib/onboarding/synthesize-voice';
import { analyzeVoiceSamples } from '@/lib/voice-lab/analyze-samples';
import { importVoiceSamplesFromEmail } from '@/lib/voice-lab/import-from-email';
import { selectBalancedVoiceSamples } from '@/lib/voice-lab/select-voice-samples';
import { persistImportedPosts } from '@/lib/voice-lab/persist-imported-posts';
import { syncBrainVoiceLab } from '@/lib/brain/sync';
import { storePersona } from '@/lib/supermemory';
import { captureVoiceDriftBaseline } from '@/lib/voice-drift';

/** Vercel: ingest runs Unipile + Gmail + 2 LLM calls — allow up to 5 min. */
export const maxDuration = 300;

const MIN_SAMPLES = 1;
const TARGET_PLATFORMS: OnboardingPlatform[] = ['linkedin', 'twitter'];

export interface OnboardingIngestResponse {
  baseline: ReturnType<typeof buildCreatorBaseline>;
  postsImported: number;
  emailsImported: number;
  platforms: string[];
  saved: boolean;
}

/**
 * POST /api/onboarding/ingest
 *
 * Multi-source voice pipeline: Unipile posts + Gmail sent emails → analyze →
 * Creator Baseline. Emails capture 1:1 voice; posts capture public voice.
 */
export async function POST(_request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const guard = await guardAiRequest(user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);
  const persistWorkspaceId = workspaceId ?? (await ensureSoloWorkspace(user.id)).id;

  const unipileConfigured = Boolean(
    process.env.UNIPILE_API_KEY?.trim() && process.env.UNIPILE_DSN?.trim(),
  );

  const postSamples: VoiceSample[] = [];
  const connectedPlatforms: string[] = [];
  const oauthName =
    user.name ?? (await fetchOAuthDisplayName(cookies().get('content-os-token')?.value ?? ''));
  let displayName = resolveDisplayName({ oauthName });

  if (unipileConfigured) {
    let query = client.database
      .from('social_accounts')
      .select('platform, unipile_account_id, account_id, account_name')
      .eq('user_id', user.id)
      .not('unipile_account_id', 'is', null)
      .in('platform', TARGET_PLATFORMS);

    if (workspaceId) query = query.eq('workspace_id', workspaceId);

    const { data: accounts } = await query;

    for (const account of accounts ?? []) {
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
          postSamples.push(...samples);
          if (account.account_name) displayName = resolveDisplayName({
            oauthName,
            socialAccountName: account.account_name,
          });

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
  }

  let emailSamples: VoiceSample[] = [];
  try {
    emailSamples = await importVoiceSamplesFromEmail(
      client,
      user.id,
      persistWorkspaceId,
    );
    if (emailSamples.length > 0 && !connectedPlatforms.includes('Gmail')) {
      connectedPlatforms.push('Gmail');
    }
  } catch (err) {
    console.warn('[onboarding/ingest] email import failed:', err);
  }

  const allSamples: VoiceSample[] = [...postSamples, ...emailSamples];

  if (allSamples.length < MIN_SAMPLES) {
    return NextResponse.json(
      {
        error:
          'Need at least one post or sent email to build your voice. Connect LinkedIn/X or Gmail, then try again.',
        postsImported: postSamples.length,
        emailsImported: emailSamples.length,
        platforms: connectedPlatforms,
      },
      { status: 400 },
    );
  }

  try {
    const analysisSamples = selectBalancedVoiceSamples(allSamples, 20);
    const analysis = await analyzeVoiceSamples(analysisSamples);
    const persona = await synthesizePersonaFromAnalysis(analysis);

    const baseline = buildCreatorBaseline(analysis, {
      postsAnalyzed: postSamples.length,
      emailsAnalyzed: emailSamples.length,
      platforms: connectedPlatforms,
      displayName,
    });

    await persistOnboardingVoice(
      client,
      user.id,
      persistWorkspaceId,
      persona,
      baseline,
      postSamples,
      emailSamples,
      analysisSamples,
    );

    const response: OnboardingIngestResponse = {
      baseline,
      postsImported: postSamples.length,
      emailsImported: emailSamples.length,
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
  postSamples: VoiceSample[],
  emailSamples: VoiceSample[],
  analysisSamples: VoiceSample[],
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
    { key: 'sample_posts', value: JSON.stringify(postSamples.slice(0, 10)) },
    { key: 'sample_emails', value: JSON.stringify(emailSamples.slice(0, 8)) },
    { key: 'voice_analysis_samples', value: JSON.stringify(analysisSamples.slice(0, 12)) },
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

  try {
    await storePersona(
      userId,
      persona.exportable_prompt,
      { source: 'onboarding_ingest', posts: postSamples.length, emails: emailSamples.length },
      workspaceId,
    );
  } catch (err) {
    console.warn('[onboarding/ingest] supermemory store failed (non-critical):', err);
  }

  await captureVoiceDriftBaseline(client, workspaceId, userId, 8, 3, 'linkedin');
}
