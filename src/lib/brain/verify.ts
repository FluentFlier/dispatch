import type { createClient } from '@insforge/sdk';
import { BRAIN_SLUG } from './types';
import { getBrainPage, listBrainPages } from './pages';

type InsforgeClient = ReturnType<typeof createClient>;

export interface OnboardingBrainCheck {
  ok: boolean;
  voiceSynced: boolean;
  profileSynced: boolean;
  specsSynced: boolean;
  brainProvisioned: boolean;
  linkedinIntelSynced: boolean;
  backgroundIntelSynced: boolean;
  missing: string[];
}

export interface VerifyOnboardingBrainOptions {
  requireLinkedInIntel?: boolean;
  requireWebIntel?: boolean;
}

function parseBody(body: string): Record<string, unknown> {
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Confirms onboarding wrote voice, profile, and persona specs into the creator brain.
 */
export async function verifyOnboardingBrain(
  client: InsforgeClient,
  userId: string,
  workspaceId?: string,
  options: VerifyOnboardingBrainOptions = {},
): Promise<OnboardingBrainCheck> {
  const missing: string[] = [];
  const requireLinkedInIntel = Boolean(options.requireLinkedInIntel);
  const requireWebIntel = Boolean(options.requireWebIntel);

  const voicePage = await getBrainPage(client, userId, BRAIN_SLUG.voice, workspaceId);
  const profilePage = await getBrainPage(client, userId, BRAIN_SLUG.profile, workspaceId);

  const voiceBody = voicePage ? parseBody(voicePage.body) : {};
  const profileBody = profilePage ? parseBody(profilePage.body) : {};

  const voiceDescription =
    typeof voiceBody.voice_description === 'string' ? voiceBody.voice_description.trim() : '';
  const voiceRules =
    typeof voiceBody.voice_rules === 'string' ? voiceBody.voice_rules.trim() : '';

  const voiceSynced = Boolean(
    voiceDescription.length > 10 &&
      voiceRules.length > 5 &&
      voiceBody.status !== 'pending',
  );
  if (!voiceSynced) missing.push('voice');

  const displayName =
    typeof profileBody.display_name === 'string' ? profileBody.display_name.trim() : '';
  const pillars = profileBody.content_pillars;
  const hasPillars = Array.isArray(pillars)
    ? pillars.length > 0
    : Boolean(pillars && typeof pillars === 'object');

  const profileSynced = Boolean(displayName.length > 0 && hasPillars);
  if (!profileSynced) missing.push('profile');

  const bioFacts =
    typeof profileBody.bio_facts === 'string' ? profileBody.bio_facts.trim() : '';
  if (requireLinkedInIntel && bioFacts.length < 20) missing.push('bio_facts');

  const linkedinPage = await getBrainPage(client, userId, BRAIN_SLUG.linkedin, workspaceId);
  const linkedinBody = linkedinPage ? parseBody(linkedinPage.body) : {};
  const linkedinIntelSynced = Boolean(
    asString(linkedinBody.headline) || asString(linkedinBody.summary),
  );
  if (requireLinkedInIntel && !linkedinIntelSynced) missing.push('linkedin_intel');

  const backgroundPage = await getBrainPage(client, userId, BRAIN_SLUG.background, workspaceId);
  const backgroundBody = backgroundPage ? parseBody(backgroundPage.body) : {};
  const backgroundIntelSynced = Boolean(
    asString(backgroundBody.bioSummary) &&
      Array.isArray(backgroundBody.topics) &&
      (backgroundBody.topics as string[]).length > 0,
  );
  if (requireWebIntel && !backgroundIntelSynced) missing.push('background_intel');

  const { data: settings } = await client.database
    .from('user_settings')
    .select('key, value')
    .eq('user_id', userId)
    .in('key', ['vocabulary_fingerprint', 'structural_patterns', 'persona_prompt_export']);

  const keys = new Set((settings ?? []).map((row) => (row as { key: string }).key));
  const specsSynced =
    keys.has('vocabulary_fingerprint') &&
    keys.has('structural_patterns') &&
    keys.has('persona_prompt_export');
  if (!specsSynced) missing.push('specs');

  const pages = await listBrainPages(client, userId, workspaceId);
  const brainProvisioned = pages.length >= 2;
  if (!brainProvisioned) missing.push('brain_pages');

  return {
    ok: missing.length === 0,
    voiceSynced,
    profileSynced,
    specsSynced,
    brainProvisioned,
    linkedinIntelSynced,
    backgroundIntelSynced,
    missing,
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
