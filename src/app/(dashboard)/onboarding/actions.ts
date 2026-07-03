'use server';

import { getServerClient, getAuthenticatedUser } from '@/lib/insforge/server';
import type { ContentPillarConfig } from '@/types/database';
import type { CreatorBaseline } from '@/lib/onboarding/baseline';

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
  if (!workspaceId) throw new Error('No workspace found — please sign out and sign back in.');

  const pillars = baseline.pillars as ContentPillarConfig[];

  const { error: profileError } = await client.database
    .from('creator_profile')
    .upsert(
      {
        user_id: user.id,
        workspace_id: workspaceId,
        display_name: baseline.displayName.trim(),
        bio_facts: baseline.voiceSummary.trim(),
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
 * Minimal onboarding completion when Unipile is not ready yet — unblocks launch
 * so users can write while social keys are being configured.
 */
export async function completeOnboardingMinimal(displayName: string) {
  const user = await getAuthenticatedUser();
  if (!user) throw new Error('Not logged in');

  const name = displayName.trim() || user.email?.split('@')[0] || 'Creator';
  const client = getServerClient();

  const { data: workspaces } = await client.database
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id);

  const workspaceId = workspaces?.[0]?.workspace_id;
  if (!workspaceId) throw new Error('No workspace found — please sign out and sign back in.');

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
        content_pillars: [{ name: 'Insights', color: '#E07A5F', description: 'Your core ideas' }],
        onboarding_complete: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );

  if (profileError) throw new Error(profileError.message || 'Failed to save profile');

  return { success: true };
}
