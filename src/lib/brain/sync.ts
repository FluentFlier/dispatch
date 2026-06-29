import type { createClient } from '@insforge/sdk';
import { BRAIN_SLUG, type BrainProvisionResult } from './types';
import { getBrainPage, listBrainPages, putBrainPage } from './pages';
import { isEnabled } from '@/lib/feature-flags';

type InsforgeClient = ReturnType<typeof createClient>;

interface ProfileRow {
  display_name: string;
  bio: string | null;
  bio_facts: string;
  voice_description: string;
  voice_rules: string;
  content_pillars: unknown;
}

interface PostRow {
  id: string;
  title: string;
  pillar: string;
  platform: string;
  caption: string | null;
  script: string | null;
  hook: string | null;
  views: number | null;
  likes: number | null;
  posted_date: string | null;
}

/**
 * Provision empty brain namespace for a new creator.
 * InsForge-first: no GBrain server required for users.
 * When workspaceId is provided, all stub pages are tagged to that workspace
 * so the brain is isolated from other workspaces from the start.
 */
export async function provisionCreatorBrain(
  client: InsforgeClient,
  userId: string,
  workspaceId?: string,
): Promise<BrainProvisionResult> {
  const existing = await listBrainPages(client, userId, workspaceId);
  if (existing.length >= 2) {
    return {
      ok: true,
      page_count: existing.length,
      slugs: existing.map((p) => p.slug),
      message: 'Brain already provisioned',
    };
  }

  await putBrainPage(client, userId, {
    slug: BRAIN_SLUG.voice,
    title: 'Voice',
    tags: ['voice', 'core'],
    body: JSON.stringify({ status: 'pending', note: 'Complete Voice Lab or onboarding to populate.' }, null, 2),
    workspaceId,
  });

  await putBrainPage(client, userId, {
    slug: BRAIN_SLUG.profile,
    title: 'Profile',
    tags: ['profile', 'core'],
    body: JSON.stringify({ status: 'pending' }, null, 2),
    workspaceId,
  });

  await putBrainPage(client, userId, {
    slug: BRAIN_SLUG.wins,
    title: 'What works',
    tags: ['wins', 'performance'],
    body: JSON.stringify({ top_posts: [], note: 'Published posts with strong metrics appear here.' }, null, 2),
    workspaceId,
  });

  await putBrainPage(client, userId, {
    slug: BRAIN_SLUG.gtm,
    title: 'GTM playbook',
    tags: ['gtm', 'signals', 'outreach'],
    body: JSON.stringify(
      {
        status: 'pending',
        icp: '',
        pitch: '',
        objections: '',
        proof_points: '',
        cta_style: '',
        note: 'Fill ICP, pitch, and objection handling for Signals cold outreach.',
      },
      null,
      2,
    ),
    workspaceId,
  });

  const pages = await listBrainPages(client, userId, workspaceId);
  return {
    ok: true,
    page_count: pages.length,
    slugs: pages.map((p) => p.slug),
    message: `Creator brain provisioned (${pages.length} pages on InsForge)`,
  };
}

/**
 * Syncs the creator's profile data into their brain pages (voice + profile slugs).
 * When workspaceId is provided, pages are written to the workspace namespace
 * so agency clients each maintain independent voice and profile brain pages.
 */
export async function syncBrainFromProfile(
  client: InsforgeClient,
  userId: string,
  workspaceId?: string,
): Promise<void> {
  const { data: profileRow } = await client.database
    .from('creator_profile')
    .select('display_name, bio, bio_facts, voice_description, voice_rules, content_pillars')
    .eq('user_id', userId)
    .maybeSingle();

  if (!profileRow) return;

  const profile = profileRow as ProfileRow;

  // Guard against malformed JSON in content_pillars — a parse error here would
  // crash the entire brain sync silently, leaving voice context stale with no
  // indication of why it stopped updating.
  let pillars: unknown = profile.content_pillars;
  if (typeof profile.content_pillars === 'string') {
    try {
      pillars = JSON.parse(profile.content_pillars);
    } catch {
      console.warn('[brain/sync] content_pillars JSON parse failed for user', userId, '— using empty array');
      pillars = [];
    }
  }

  await putBrainPage(client, userId, {
    slug: BRAIN_SLUG.voice,
    title: `${profile.display_name}: voice`,
    tags: ['voice', 'core'],
    body: JSON.stringify(
      {
        voice_description: profile.voice_description,
        voice_rules: profile.voice_rules,
        synced_at: new Date().toISOString(),
      },
      null,
      2,
    ),
    workspaceId,
  });

  await putBrainPage(client, userId, {
    slug: BRAIN_SLUG.profile,
    title: `${profile.display_name}: profile`,
    tags: ['profile', 'core'],
    body: JSON.stringify(
      {
        display_name: profile.display_name,
        bio: profile.bio,
        bio_facts: profile.bio_facts,
        content_pillars: pillars,
        synced_at: new Date().toISOString(),
      },
      null,
      2,
    ),
    workspaceId,
  });
}

/**
 * Syncs a single published post into the brain and — when the feature flag is on —
 * writes it to Supermemory so future generation can reference "you wrote about this".
 * The Supermemory write is intentionally non-blocking: a Supermemory outage must
 * never fail the publish operation. workspaceId scopes both the brain page and the
 * Supermemory container tag so agency workspaces stay isolated.
 */
export async function syncBrainPublishedPost(
  client: InsforgeClient,
  userId: string,
  postId: string,
  workspaceId?: string,
): Promise<void> {
  const { data: postRow } = await client.database
    .from('posts')
    .select('id, title, pillar, platform, caption, script, hook, views, likes, posted_date')
    .eq('id', postId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!postRow) return;

  const post = postRow as PostRow;
  const content = [post.hook, post.script, post.caption].filter(Boolean).join('\n\n').trim();
  if (!content) return;

  await putBrainPage(client, userId, {
    slug: BRAIN_SLUG.post(postId),
    title: `${post.title} (${post.platform})`,
    tags: ['published', post.platform, post.pillar],
    body: JSON.stringify(
      {
        post_id: post.id,
        platform: post.platform,
        pillar: post.pillar,
        content: content.slice(0, 4000),
        views: post.views,
        likes: post.likes,
        posted_date: post.posted_date,
        synced_at: new Date().toISOString(),
      },
      null,
      2,
    ),
    workspaceId,
  });

  // syncBrainWins is intentionally NOT called here — it runs a top-5 query and
  // was previously called inside this per-post function, causing N top-5 queries
  // when publishing N posts. Call it once at the end of syncCreatorBrainFull().

  // L3: non-blocking Supermemory write — publish must succeed even if Supermemory is down.
  // Flag check happens after putBrainPage (publish already complete above) so skipping
  // memory writes never impacts publish latency or success.
  if (!(await isEnabled(client, 'layer3_memory_writes'))) return;
  try {
    const { addMemory } = await import('@/lib/supermemory');
    await addMemory({
      content: [
        `Published ${post.platform} post (${post.pillar}):`,
        content,
        post.views ? `Performance: ${post.views} views, ${post.likes ?? 0} likes` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      containerTags: [
        workspaceId ? `workspace_${workspaceId}` : `user_${userId}`,
        'published_post',
        post.platform,
        post.pillar,
      ],
      // customId is idempotent — re-running sync for the same post is safe.
      customId: `post_${postId}`,
      metadata: {
        type: 'published_post',
        platform: post.platform,
        pillar: post.pillar,
        views: post.views ?? 0,
        posted_date: post.posted_date ?? '',
      },
    });
  } catch (err) {
    console.error('[brain/sync] addMemory failed (non-blocking):', err);
  }
}

async function syncBrainWins(
  client: InsforgeClient,
  userId: string,
  workspaceId?: string,
): Promise<void> {
  const { data: topPosts } = await client.database
    .from('posts')
    .select('id, title, platform, pillar, caption, script, hook, views, likes, posted_date')
    .eq('user_id', userId)
    .eq('status', 'posted')
    .order('views', { ascending: false, nullsFirst: false })
    .limit(5);

  const wins = (topPosts ?? []).map((p) => {
    const row = p as PostRow;
    const snippet = [row.hook, row.caption].filter(Boolean).join(' ').slice(0, 200);
    return {
      post_id: row.id,
      title: row.title,
      platform: row.platform,
      pillar: row.pillar,
      views: row.views,
      likes: row.likes,
      snippet,
    };
  });

  await putBrainPage(client, userId, {
    slug: BRAIN_SLUG.wins,
    title: 'What works',
    tags: ['wins', 'performance'],
    body: JSON.stringify({ top_posts: wins, synced_at: new Date().toISOString() }, null, 2),
    workspaceId,
  });
}

/**
 * Full brain refresh: provisions, syncs profile, syncs all recent published posts,
 * and updates wins page. workspaceId scopes all writes to the correct workspace
 * namespace so agency clients don't share brain content.
 */
export async function syncCreatorBrainFull(
  client: InsforgeClient,
  userId: string,
  workspaceId?: string,
): Promise<{ synced_posts: number }> {
  await provisionCreatorBrain(client, userId, workspaceId);
  await syncBrainFromProfile(client, userId, workspaceId);

  const { data: recentPosted } = await client.database
    .from('posts')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'posted')
    .order('posted_date', { ascending: false })
    .limit(20);

  let synced = 0;
  for (const row of recentPosted ?? []) {
    await syncBrainPublishedPost(client, userId, row.id as string, workspaceId);
    synced++;
  }

  // Run syncBrainWins once here after all posts are synced, not inside each
  // syncBrainPublishedPost call (which caused N redundant top-5 queries).
  await syncBrainWins(client, userId, workspaceId);

  return { synced_posts: synced };
}

/**
 * Syncs Voice Lab output into the brain voice page.
 * When workspaceId is provided, the voice page is scoped to that workspace
 * so agency clients each maintain an independent voice fingerprint.
 */
export async function syncBrainVoiceLab(
  client: InsforgeClient,
  userId: string,
  payload: {
    voice_description: string;
    voice_rules: string;
    vocabulary_fingerprint?: Record<string, unknown>;
    structural_patterns?: Record<string, unknown>;
  },
  workspaceId?: string,
): Promise<void> {
  await provisionCreatorBrain(client, userId, workspaceId);

  const voicePage = await getBrainPage(client, userId, BRAIN_SLUG.voice, workspaceId);
  let existing: Record<string, unknown> = {};
  if (voicePage?.body) {
    try {
      existing = JSON.parse(voicePage.body) as Record<string, unknown>;
    } catch {
      existing = {};
    }
  }

  await putBrainPage(client, userId, {
    slug: BRAIN_SLUG.voice,
    title: 'Voice',
    tags: ['voice', 'core'],
    body: JSON.stringify(
      {
        ...existing,
        voice_description: payload.voice_description,
        voice_rules: payload.voice_rules,
        vocabulary_fingerprint: payload.vocabulary_fingerprint,
        structural_patterns: payload.structural_patterns,
        synced_at: new Date().toISOString(),
      },
      null,
      2,
    ),
    workspaceId,
  });

  await syncBrainFromProfile(client, userId, workspaceId);
}
