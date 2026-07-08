import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId, ensureSoloWorkspace } from '@/lib/workspace';
import { guardAiRequest } from '@/lib/ai-guard';
import { errorResponse } from '@/lib/api-errors';
import { fetchOAuthDisplayName, resolveDisplayName } from '@/lib/user-display-name';
import {
  fetchPostsFromUnipile,
  resolveUnipileTarget,
  type OnboardingPlatform,
  type VoiceSample,
} from '@/lib/onboarding/import-posts';
import { buildCreatorBaseline, type CreatorBaseline } from '@/lib/onboarding/baseline';
import { synthesizePersonaFromAnalysis, type OnboardingPersona } from '@/lib/onboarding/synthesize-voice';
import { analyzeVoiceSamples } from '@/lib/voice-lab/analyze-samples';
import { importVoiceSamplesFromEmail } from '@/lib/voice-lab/import-from-email';
import { selectBalancedVoiceSamples } from '@/lib/voice-lab/select-voice-samples';
import { persistImportedPosts } from '@/lib/voice-lab/persist-imported-posts';
import { gatherCreatorIntel, type CreatorIntelBundle } from '@/lib/onboarding/creator-intel';
import { syncBrainVoiceLab, syncCreatorBrainFull } from '@/lib/brain/sync';
import { syncCreatorIntelToBrain } from '@/lib/brain/sync-intel';
import { verifyOnboardingBrain, type OnboardingBrainCheck } from '@/lib/brain/verify';
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
  brainCheck: OnboardingBrainCheck;
  /** True when we completed with a fallback voice because no posts/emails could be imported. */
  degraded?: boolean;
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

  let socialQuery = client.database
    .from('social_accounts')
    .select('platform, unipile_account_id')
    .eq('user_id', user.id)
    .not('unipile_account_id', 'is', null)
    .in('platform', TARGET_PLATFORMS);

  if (workspaceId) socialQuery = socialQuery.eq('workspace_id', workspaceId);

  const { data: connectedSocialAccounts } = await socialQuery;

  if (!connectedSocialAccounts?.length) {
    return NextResponse.json(
      {
        error: 'Connect at least LinkedIn or X before we can build your voice and brain.',
        postsImported: 0,
        emailsImported: 0,
        platforms: [],
      },
      { status: 400 },
    );
  }

  const unipileConfigured = Boolean(
    process.env.UNIPILE_API_KEY?.trim() && process.env.UNIPILE_DSN?.trim(),
  );

  const postSamples: VoiceSample[] = [];
  const connectedPlatforms: string[] = [];
  const persistJobs: Array<Promise<unknown>> = [];
  const oauthName =
    user.name ?? (await fetchOAuthDisplayName(cookies().get('content-os-token')?.value ?? ''));
  let displayName = resolveDisplayName({ oauthName });
  let linkedinConnected = false;
  let creatorIntel: CreatorIntelBundle = {
    linkedin: null,
    twitter: null,
    web: null,
    bioFacts: '',
  };

  const emailPromise = importVoiceSamplesFromEmail(client, user.id, persistWorkspaceId).catch((err) => {
    console.warn('[onboarding/ingest] email import failed:', err);
    return [] as VoiceSample[];
  });

  if (unipileConfigured) {
    let query = client.database
      .from('social_accounts')
      .select('platform, unipile_account_id, account_id, account_name')
      .eq('user_id', user.id)
      .not('unipile_account_id', 'is', null)
      .in('platform', TARGET_PLATFORMS);

    if (workspaceId) query = query.eq('workspace_id', workspaceId);

    const { data: accounts } = await query;
    const accountRows = accounts ?? [];

    linkedinConnected = accountRows.some((account) => account.platform === 'linkedin');

    for (const account of accountRows) {
      const platform = account.platform as OnboardingPlatform;
      if (!TARGET_PLATFORMS.includes(platform)) continue;

      const target = await resolveUnipileTarget(
        account.unipile_account_id,
        account.account_id,
        platform,
      );
      if (!target || target.providerUserIds.length === 0) continue;

      // Persist a recovered id when the stored one had rotated.
      if (target.refreshed) {
        let update = client.database
          .from('social_accounts')
          .update({ unipile_account_id: target.unipileAccountId })
          .eq('user_id', user.id)
          .eq('platform', platform);
        if (workspaceId) update = update.eq('workspace_id', workspaceId);
        await update;
      }

      try {
        const { samples, rawItems } = await fetchPostsFromUnipile(
          target.providerUserIds,
          target.unipileAccountId,
          platform,
        );

        if (samples.length > 0) {
          connectedPlatforms.push(platform === 'linkedin' ? 'LinkedIn' : 'X');
          postSamples.push(...samples);
          if (account.account_name) {
            displayName = resolveDisplayName({
              oauthName,
              socialAccountName: account.account_name,
            });
          }

          persistJobs.push(
            persistImportedPosts({
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
              console.warn('[onboarding/ingest] post persist failed:', err);
            }),
          );
        }
      } catch (err) {
        console.warn(`[onboarding/ingest] import failed for ${platform}:`, err);
      }
    }

    // Best-effort: profile/web enrichment is a heavy scrape + LLM step. It must
    // never throw the whole ingest into a 500 (which bounces the user back to the
    // connect step and loops) — degrade to the name/posts we already have.
    try {
      creatorIntel = await gatherCreatorIntel(
        accountRows.map((account) => ({
          platform: account.platform as OnboardingPlatform,
          unipile_account_id: account.unipile_account_id,
          account_id: account.account_id,
          account_name: account.account_name,
        })),
        displayName,
      );
      if (creatorIntel.linkedin?.fullName) {
        displayName = resolveDisplayName({
          oauthName,
          socialAccountName: creatorIntel.linkedin.fullName,
        });
      }
    } catch (err) {
      console.warn('[onboarding/ingest] creator intel failed — continuing:', err);
    }
  }

  await Promise.all(persistJobs);

  const emailSamples = await emailPromise;
  if (emailSamples.length > 0 && !connectedPlatforms.includes('Gmail')) {
    connectedPlatforms.push('Gmail');
  }

  const allSamples: VoiceSample[] = [...postSamples, ...emailSamples];
  const degraded = allSamples.length < MIN_SAMPLES;

  try {
    let analysisSamples: VoiceSample[] = [];
    let persona: OnboardingPersona;
    let baseline: CreatorBaseline;

    if (degraded) {
      // A connected account returned no importable posts/emails — common when X
      // exposes no public timeline via the provider. Never trap the user in a
      // loop: build a safe default voice from their name + profile intel so
      // onboarding completes. They can enrich it later in Voice Lab.
      console.warn('[onboarding/ingest] no importable samples — completing with fallback voice', {
        platforms: connectedPlatforms,
      });
      ({ persona, baseline } = buildFallbackVoice(displayName, creatorIntel.bioFacts, connectedPlatforms));
    } else {
      analysisSamples = selectBalancedVoiceSamples(allSamples, 25);
      const analysis = await analyzeVoiceSamples(analysisSamples);
      persona = await synthesizePersonaFromAnalysis(analysis);
      baseline = buildCreatorBaseline(analysis, {
        postsAnalyzed: postSamples.length,
        emailsAnalyzed: emailSamples.length,
        platforms: connectedPlatforms,
        displayName,
      });
    }

    const brainCheck = await persistOnboardingVoice(
      client,
      user.id,
      persistWorkspaceId,
      persona,
      baseline,
      postSamples,
      emailSamples,
      analysisSamples,
      creatorIntel,
      {
        // In the fallback path we have no scraped intel, so don't demand it.
        requireLinkedInIntel: linkedinConnected && !degraded,
        requireWebIntel: Boolean(creatorIntel.web) && !degraded,
      },
    );

    // One connected account must always get the user into the app. If the brain
    // did not fully sync we log it but still complete — the essentials (voice,
    // profile, specs) are persisted and can be re-synced from the dashboard.
    if (!brainCheck.ok) {
      console.warn('[onboarding/ingest] brain incomplete, completing anyway:', brainCheck.missing);
    }

    const response: OnboardingIngestResponse = {
      baseline,
      postsImported: postSamples.length,
      emailsImported: emailSamples.length,
      platforms: connectedPlatforms,
      saved: true,
      brainCheck,
      degraded,
    };

    return NextResponse.json(response);
  } catch (err) {
    return errorResponse('Ingest failed.', 500, err);
  }
}

/**
 * Builds a safe, valid default voice + baseline when we could not import any
 * posts or emails. This keeps a single connected account from getting stuck in
 * the onboarding loop: the persisted voice/profile/specs pass brain verification
 * so the user reaches the app, and voice can be refined later from real samples.
 */
function buildFallbackVoice(
  displayName: string,
  bioFacts: string,
  platforms: string[],
): { persona: OnboardingPersona; baseline: CreatorBaseline } {
  const name = displayName?.trim() || 'this creator';
  const context = bioFacts?.trim() ? ` ${bioFacts.trim().slice(0, 240)}` : '';
  const voiceDescription =
    `Writes with a clear, direct, and authentic voice. Favors plain language over jargon, ` +
    `short punchy sentences, and a confident but approachable tone.${context}`.trim();
  const voiceRuleList = [
    'DO: Write in plain, conversational language.',
    'DO: Lead with the main point.',
    'DO: Keep sentences short and concrete.',
    'DO: Sound human and specific, not corporate.',
    'NEVER: Use buzzwords or empty hype.',
    'NEVER: Bury the point under long preambles.',
    'NEVER: Overuse emojis or hashtags.',
  ];

  const persona: OnboardingPersona = {
    voice_description: voiceDescription,
    voice_rules: voiceRuleList.join('\n'),
    vocabulary_fingerprint: {
      uses_often: [],
      never_uses: ['synergy', 'leverage', 'circle back'],
      signature_phrases: [],
    },
    structural_patterns: {
      avg_sentence_length: 'short',
      paragraph_style: 'Short, punchy paragraphs',
      hook_pattern: 'Opens with a clear claim or question',
      closing_pattern: 'Ends with a takeaway or a question',
    },
    exportable_prompt:
      `Write as ${name}. Voice: clear, direct, authentic. Use plain language and short ` +
      `sentences, confident but approachable. Lead with the main point and avoid buzzwords ` +
      `or hype.${context ? ` Context:${context}` : ''}`.trim(),
  };

  const baseline: CreatorBaseline = {
    voiceSummary: voiceDescription,
    voiceRules: voiceRuleList,
    themes: ['Insights'],
    hookPattern: 'Opens with a clear claim or question',
    tone: 'Clear and direct',
    postsAnalyzed: 0,
    emailsAnalyzed: 0,
    platforms,
    displayName: name,
    suggestedTopic: 'Something I learned this week',
    pillars: [{ name: 'Insights', color: '#E07A5F', description: 'Your core ideas' }],
  };

  return { persona, baseline };
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
  creatorIntel: CreatorIntelBundle,
  verifyOptions: { requireLinkedInIntel: boolean; requireWebIntel: boolean },
): Promise<OnboardingBrainCheck> {
  const bioFacts = creatorIntel.bioFacts || baseline.voiceSummary;

  const { data: existingProfile } = await client.database
    .from('creator_profile')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  const profilePayload = {
    voice_description: persona.voice_description,
    voice_rules: persona.voice_rules,
    display_name: baseline.displayName,
    bio_facts: bioFacts,
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
      ...profilePayload,
    }]);
  }

  // onboarding_baseline + suggested_topic FIRST: these are what the resume path
  // (completeOnboardingFromStoredBaseline) needs, so if this write loop is cut
  // short (e.g. the function hits its time limit mid-way) a reload can still
  // finish onboarding instead of looping. The rest are enrichment.
  const settings = [
    { key: 'onboarding_baseline', value: JSON.stringify(baseline) },
    { key: 'onboarding_suggested_topic', value: baseline.suggestedTopic },
    { key: 'vocabulary_fingerprint', value: JSON.stringify(persona.vocabulary_fingerprint) },
    { key: 'structural_patterns', value: JSON.stringify(persona.structural_patterns) },
    { key: 'persona_prompt_export', value: persona.exportable_prompt },
    { key: 'sample_posts', value: JSON.stringify(postSamples.slice(0, 10)) },
    { key: 'sample_emails', value: JSON.stringify(emailSamples.slice(0, 8)) },
    { key: 'voice_analysis_samples', value: JSON.stringify(analysisSamples.slice(0, 12)) },
    { key: 'creator_intel_linkedin', value: JSON.stringify(creatorIntel.linkedin) },
    { key: 'creator_intel_twitter', value: JSON.stringify(creatorIntel.twitter) },
    { key: 'creator_intel_web', value: JSON.stringify(creatorIntel.web) },
    { key: 'creator_bio_facts', value: bioFacts },
  ];

  for (const setting of settings) {
    // Best-effort per setting: one failed write must not abort the rest (or the
    // whole ingest). Missing enrichment can be re-synced from the dashboard.
    try {
      await client.database.from('user_settings').upsert({
        user_id: userId,
        workspace_id: workspaceId,
        key: setting.key,
        value: setting.value,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,key' });
    } catch (err) {
      console.warn(`[onboarding/ingest] setting write failed (${setting.key}):`, err);
    }
  }

  try {
    await syncCreatorIntelToBrain(
      client,
      userId,
      workspaceId,
      creatorIntel,
      baseline.displayName,
      baseline.pillars,
    );
    await syncBrainVoiceLab(
      client,
      userId,
      {
        voice_description: persona.voice_description,
        voice_rules: persona.voice_rules,
        vocabulary_fingerprint: persona.vocabulary_fingerprint,
        structural_patterns: persona.structural_patterns,
      },
      workspaceId,
    );
    await syncCreatorBrainFull(client, userId, workspaceId);
  } catch (err) {
    console.warn('[onboarding/ingest] brain sync failed:', err);
  }

  let brainCheck = await verifyOnboardingBrain(client, userId, workspaceId, verifyOptions);
  if (!brainCheck.ok) {
    try {
      await syncCreatorIntelToBrain(
        client,
        userId,
        workspaceId,
        creatorIntel,
        baseline.displayName,
        baseline.pillars,
      );
      await syncBrainVoiceLab(
        client,
        userId,
        {
          voice_description: persona.voice_description,
          voice_rules: persona.voice_rules,
          vocabulary_fingerprint: persona.vocabulary_fingerprint,
          structural_patterns: persona.structural_patterns,
        },
        workspaceId,
      );
      await syncCreatorBrainFull(client, userId, workspaceId);
      brainCheck = await verifyOnboardingBrain(client, userId, workspaceId, verifyOptions);
    } catch (err) {
      console.warn('[onboarding/ingest] brain sync retry failed:', err);
    }
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

  return brainCheck;
}
