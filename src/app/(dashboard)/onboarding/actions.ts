"use server";

import { getServerClient, getAuthenticatedUser } from "@/lib/insforge/server";

export async function completeOnboarding(data: {
  displayName: string;
  bio: string;
  voiceDescription: string;
  voiceRules: string;
  pillars: any[];
  contextAdditions?: string;
}) {
  const user = await getAuthenticatedUser();
  if (!user) throw new Error("Not logged in");

  const client = getServerClient();

  // The active workspace should be available via workspace_members
  const { data: workspaces } = await client.database
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', user.id);
    
  const workspaceId = workspaces?.[0]?.workspace_id;
  if (!workspaceId) throw new Error("No workspace found — please sign out and sign back in.");

  const pillars =
    data.pillars?.filter((p) => p?.name?.trim?.())?.length > 0
      ? data.pillars.filter((p) => p.name.trim().length > 0)
      : [{ name: 'My posts', color: '#E07A5F', description: data.bio.trim() || undefined }];

  const { error: profileError } = await client.database
    .from('creator_profile')
    .upsert(
      {
        user_id: user.id,
        workspace_id: workspaceId,
        display_name: data.displayName.trim(),
        bio_facts: data.bio.trim(),
        voice_description: data.voiceDescription.trim(),
        voice_rules: data.voiceRules.trim(),
        content_pillars: pillars,
        onboarding_complete: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

  if (profileError) throw new Error(profileError.message || 'Failed to save profile');

  if (data.contextAdditions?.trim()) {
    const { error: settingsError } = await client.database
      .from('user_settings')
      .upsert(
        {
          user_id: user.id,
          workspace_id: workspaceId,
          key: 'context_additions',
          value: data.contextAdditions.trim(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,key' }
      );
    if (settingsError) throw new Error(settingsError.message || 'Failed to save context');
  }

  return { success: true };
}
