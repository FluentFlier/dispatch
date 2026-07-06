import type { createClient } from '@insforge/sdk';
import type { CreatorIntelBundle } from '@/lib/onboarding/creator-intel';
import { BRAIN_SLUG } from './types';
import { putBrainPage } from './pages';
import { provisionCreatorBrain, syncBrainFromProfile } from './sync';

type InsforgeClient = ReturnType<typeof createClient>;

/**
 * Writes LinkedIn profile, web research, and merged bio facts into the creator brain.
 */
export async function syncCreatorIntelToBrain(
  client: InsforgeClient,
  userId: string,
  workspaceId: string,
  intel: CreatorIntelBundle,
  displayName: string,
  contentPillars: unknown,
): Promise<void> {
  await provisionCreatorBrain(client, userId, workspaceId);

  if (intel.linkedin) {
    await putBrainPage(client, userId, {
      slug: BRAIN_SLUG.linkedin,
      title: 'LinkedIn profile',
      tags: ['linkedin', 'profile', 'core'],
      body: JSON.stringify(
        {
          ...intel.linkedin,
          synced_at: new Date().toISOString(),
        },
        null,
        2,
      ),
      workspaceId,
    });
  }

  if (intel.twitter) {
    await putBrainPage(client, userId, {
      slug: BRAIN_SLUG.twitter,
      title: 'X profile',
      tags: ['twitter', 'profile', 'core'],
      body: JSON.stringify(
        {
          ...intel.twitter,
          synced_at: new Date().toISOString(),
        },
        null,
        2,
      ),
      workspaceId,
    });
  }

  if (intel.web) {
    await putBrainPage(client, userId, {
      slug: BRAIN_SLUG.background,
      title: 'Background research',
      tags: ['background', 'research', 'core'],
      body: JSON.stringify(
        {
          ...intel.web,
          synced_at: new Date().toISOString(),
        },
        null,
        2,
      ),
      workspaceId,
    });
  }

  await client.database
    .from('creator_profile')
    .update({
      display_name: displayName,
      bio_facts: intel.bioFacts,
      content_pillars: contentPillars,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  await putBrainPage(client, userId, {
    slug: BRAIN_SLUG.profile,
    title: `${displayName}: profile`,
    tags: ['profile', 'core'],
    body: JSON.stringify(
      {
        display_name: displayName,
        bio_facts: intel.bioFacts,
        content_pillars: contentPillars,
        linkedin_headline: intel.linkedin?.headline ?? null,
        linkedin_summary: intel.linkedin?.summary ?? null,
        web_topics: intel.web?.topics ?? [],
        synced_at: new Date().toISOString(),
      },
      null,
      2,
    ),
    workspaceId,
  });

  await syncBrainFromProfile(client, userId, workspaceId);
}
