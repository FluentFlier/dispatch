'use server';

import { getServerClient, getAuthenticatedUser } from '@/lib/insforge/server';
import type { ContentPillarConfig } from '@/types/database';
import type { CreatorBaseline } from '@/lib/onboarding/baseline';
import { displayNameFromAuthUser, resolveDisplayName } from '@/lib/user-display-name';
import { trackEvent, type AnalyticsEvent } from '@/lib/analytics';
import { DEFAULT_PILLARS } from '@/lib/onboarding/derive-pillars';

/**
 * Marks onboarding complete after connect-first baseline flow.
 * Voice + pillars are already saved by /api/onboarding/ingest.
 */
export async function completeOnboardingFromBaseline(baseline: CreatorBaseline) {
  const user = await getAuthenticatedUser();
  if (!user) throw new Error('Not logged in');

  const client = getServerClient();

  const { data: workspaces } = await client.database
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id);

  const workspaceId = workspaces?.[0]?.workspace_id;
  if (!workspaceId) throw new Error('No workspace found - please sign out and sign back in.');

  const pillars = baseline.pillars as ContentPillarConfig[];

  const { error: profileError } = await client.database
    .from('creator_profile')
    .upsert(
      {
        user_id: user.id,
        workspace_id: workspaceId,
        display_name: baseline.displayName.trim(),
        // bio_facts deliberately omitted: /api/onboarding/ingest already wrote the real
        // background-facts value for this row, and CreatorBaseline has no bio_facts field
        // to overwrite it with, so leave the existing column value untouched here.
        voice_description: baseline.voiceSummary.trim(),
        voice_rules: baseline.voiceRules.join('\n'),
        content_pillars: pillars,
        onboarding_complete: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );

  if (profileError) throw new Error(profileError.message || 'Failed to save profile');

  return { success: true, suggestedTopic: baseline.suggestedTopic };
}

/**
 * Completes onboarding when ingest already ran but the user never clicked through
 * (e.g. interrupted session or older funnel).
 */
export async function completeOnboardingFromStoredBaseline() {
  const user = await getAuthenticatedUser();
  if (!user) throw new Error('Not logged in');

  const client = getServerClient();
  const { data: setting } = await client.database
    .from('user_settings')
    .select('value')
    .eq('user_id', user.id)
    .eq('key', 'onboarding_baseline')
    .maybeSingle();

  if (!setting?.value) {
    throw new Error('No saved baseline found');
  }

  let baseline: CreatorBaseline;
  try {
    baseline = JSON.parse(setting.value) as CreatorBaseline;
  } catch {
    throw new Error('Saved baseline is invalid');
  }

  return completeOnboardingFromBaseline(baseline);
}

/**
 * Completes onboarding without an ingest baseline: the user skipped connect, or
 * ingest failed or timed out. Pillars are derived from the setup one-liner when
 * available, so a skipping user still gets a usable profile.
 */
export async function completeOnboardingMinimal(
  displayName: string,
  pillars?: ContentPillarConfig[],
) {
  const user = await getAuthenticatedUser();
  if (!user) throw new Error('Not logged in');

  const oauthName = displayNameFromAuthUser(user);
  const name = resolveDisplayName({
    oauthName,
    fallback: displayName.trim() || 'Creator',
  });
  const client = getServerClient();

  const { data: workspaces } = await client.database
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id);

  const workspaceId = workspaces?.[0]?.workspace_id;
  if (!workspaceId) throw new Error('No workspace found - please sign out and sign back in.');

  const resolvedPillars = pillars && pillars.length > 0 ? pillars : DEFAULT_PILLARS;

  const { error: profileError } = await client.database
    .from('creator_profile')
    .upsert(
      {
        user_id: user.id,
        workspace_id: workspaceId,
        display_name: name,
        bio_facts: '',
        voice_description: '',
        voice_rules: '',
        content_pillars: resolvedPillars,
        onboarding_complete: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );

  if (profileError) throw new Error(profileError.message || 'Failed to save profile');

  return { success: true as const };
}

/**
 * Persists the setup one-liner as personal context BEFORE onboarding completes,
 * so it survives the connect redirect. `context_additions` is the existing
 * canonical personal-context store shown in Settings, and is what Leads reads as
 * durable-context seed - one store, no second source of truth.
 */
export async function saveOnboardingContext(displayName: string, focus: string): Promise<void> {
  const user = await getAuthenticatedUser();
  if (!user) throw new Error('Not logged in');

  const client = getServerClient();
  const trimmedFocus = focus.trim();
  const trimmedName = displayName.trim();

  if (trimmedFocus) {
    await client.database.from('user_settings').upsert(
      {
        user_id: user.id,
        key: 'context_additions',
        value: trimmedFocus,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,key' },
    );
  }

  if (trimmedName) {
    await client.database.from('user_settings').upsert(
      {
        user_id: user.id,
        key: 'onboarding_display_name',
        value: trimmedName,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,key' },
    );
  }
}

/** Server-side funnel event bridge: analytics runs on the server, the wizard is a client component. */
export async function trackOnboardingEvent(
  event: AnalyticsEvent,
  properties: Record<string, string | number | boolean> = {},
): Promise<void> {
  await trackEvent(event, properties);
}
