import type { createClient } from '@insforge/sdk';
import { putBrainPage } from '@/lib/brain/pages';
import { BRAIN_SLUG } from '@/lib/brain/types';
import { ensureDefaultSources, ensureGtmPlaybook } from '@/lib/signals/store';
import { ingestManualPost } from '@/lib/signals/sync';
import { DEFAULT_GTM_PLAYBOOK } from '@/lib/signals/defaults';
import { updateSafetySettings } from '@/lib/signals/safety';

type InsforgeClient = ReturnType<typeof createClient>;

export const DEMO_PROFILE = {
  display_name: 'Alex Rivera',
  bio_facts:
    'Founder at a B2B fintech startup. Writes about GTM, YC batches, and founder-led sales. Based in SF.',
  voice_description:
    'Direct, warm, founder-to-founder. Short sentences. Specific details over hype. Never sounds like a sales bot.',
  voice_rules:
    'No em dashes. No "I hope this finds you well". Reference the signal specifically. 2-4 sentences max for outreach.',
  content_pillars: [
    { name: 'GTM', color: '#E07A5F', description: 'Founder-led outreach and signals' },
    { name: 'Fintech', color: '#81B29A', description: 'Banking and treasury for startups' },
  ],
} as const;

const DEMO_SIGNALS = [
  {
    platform: 'x' as const,
    author_handle: 'stripe-founder',
    author_name: 'Jordan Kim',
    content:
      'Excited to announce we joined Y Combinator W26! Building modern treasury for seed-stage fintech teams. Grateful to our early customers.',
  },
  {
    platform: 'x' as const,
    author_handle: 'payflowhq',
    author_name: 'Payflow',
    content:
      'We just raised a $6M seed round led by great partners. Shipping unified AP + corporate cards for startups this quarter.',
  },
  {
    platform: 'linkedin' as const,
    author_handle: 'novafinance',
    author_name: 'Nova Finance',
    content:
      'Thrilled to share that Nova Finance is joining the Techstars fintech batch. If you run finance at a Series A startup, say hi.',
  },
];

export interface DemoSeedResult {
  workspaceId: string;
  userId: string;
  profileUpdated: boolean;
  sourcesSeeded: number;
  signalsCreated: number;
  signalEventIds: string[];
}

/** Idempotent demo seed for a workspace (profile, sources, sample signals). */
export async function seedDemoWorkspace(
  client: InsforgeClient,
  userId: string,
  workspaceId: string,
): Promise<DemoSeedResult> {
  const { error: profileError } = await client.database.from('creator_profile').upsert(
    {
      user_id: userId,
      workspace_id: workspaceId,
      display_name: DEMO_PROFILE.display_name,
      bio_facts: DEMO_PROFILE.bio_facts,
      voice_description: DEMO_PROFILE.voice_description,
      voice_rules: DEMO_PROFILE.voice_rules,
      content_pillars: DEMO_PROFILE.content_pillars,
      onboarding_complete: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  if (profileError) {
    throw new Error(profileError.message || 'Failed to upsert demo profile');
  }

  await client.database.from('user_settings').upsert(
    [
      {
        user_id: userId,
        workspace_id: workspaceId,
        key: 'context_additions',
        value: DEMO_PROFILE.bio_facts,
      },
    ],
    { onConflict: 'user_id,key' },
  );

  await putBrainPage(client, userId, {
    slug: BRAIN_SLUG.gtm,
    title: 'GTM playbook',
    tags: ['gtm', 'signals', 'demo'],
    body: JSON.stringify({ ...DEFAULT_GTM_PLAYBOOK, status: 'ready' }, null, 2),
    workspaceId,
  });

  const sourcesSeeded = await ensureDefaultSources(client, workspaceId);
  await ensureGtmPlaybook(client, userId, workspaceId);

  await updateSafetySettings(client, workspaceId, {
    outreach_enabled: true,
    dry_run: true,
    working_hours_only: false,
  });

  const signalEventIds: string[] = [];
  let signalsCreated = 0;

  for (let i = 0; i < DEMO_SIGNALS.length; i++) {
    const sample = DEMO_SIGNALS[i];
    const result = await ingestManualPost(client, workspaceId, {
      platform: sample.platform,
      externalPostId: `demo-${workspaceId.slice(0, 8)}-${i}`,
      authorHandle: sample.author_handle,
      authorName: sample.author_name,
      content: sample.content,
      postUrl: sample.platform === 'linkedin' ? 'https://linkedin.com/feed' : 'https://x.com/demo',
    });
    if (result.created && result.eventId) {
      signalsCreated += 1;
      signalEventIds.push(result.eventId);
    }
  }

  return {
    workspaceId,
    userId,
    profileUpdated: true,
    sourcesSeeded,
    signalsCreated,
    signalEventIds,
  };
}
