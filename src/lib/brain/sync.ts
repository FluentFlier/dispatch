import type { createClient } from '@insforge/sdk';
import { BRAIN_SLUG, type BrainProvisionResult } from './types';
import { getBrainPage, listBrainPages, putBrainPage } from './pages';

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
 */
export async function provisionCreatorBrain(
  client: InsforgeClient,
  userId: string,
): Promise<BrainProvisionResult> {
  const existing = await listBrainPages(client, userId);
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
  });

  await putBrainPage(client, userId, {
    slug: BRAIN_SLUG.profile,
    title: 'Profile',
    tags: ['profile', 'core'],
    body: JSON.stringify({ status: 'pending' }, null, 2),
  });

  await putBrainPage(client, userId, {
    slug: BRAIN_SLUG.wins,
    title: 'What works',
    tags: ['wins', 'performance'],
    body: JSON.stringify({ top_posts: [], note: 'Published posts with strong metrics appear here.' }, null, 2),
  });

  const pages = await listBrainPages(client, userId);
  return {
    ok: true,
    page_count: pages.length,
    slugs: pages.map((p) => p.slug),
    message: `Creator brain provisioned (${pages.length} pages on InsForge)`,
  };
}

export async function syncBrainFromProfile(
  client: InsforgeClient,
  userId: string,
): Promise<void> {
  const { data: profileRow } = await client.database
    .from('creator_profile')
    .select('display_name, bio, bio_facts, voice_description, voice_rules, content_pillars')
    .eq('user_id', userId)
    .maybeSingle();

  if (!profileRow) return;

  const profile = profileRow as ProfileRow;
  const pillars =
    typeof profile.content_pillars === 'string'
      ? JSON.parse(profile.content_pillars)
      : profile.content_pillars;

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
  });
}

export async function syncBrainPublishedPost(
  client: InsforgeClient,
  userId: string,
  postId: string,
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
  });

  await syncBrainWins(client, userId);
}

async function syncBrainWins(client: InsforgeClient, userId: string): Promise<void> {
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
  });
}

/** Full refresh: profile + all recent published posts */
export async function syncCreatorBrainFull(
  client: InsforgeClient,
  userId: string,
): Promise<{ synced_posts: number }> {
  await provisionCreatorBrain(client, userId);
  await syncBrainFromProfile(client, userId);

  const { data: recentPosted } = await client.database
    .from('posts')
    .select('id')
    .eq('user_id', userId)
    .eq('status', 'posted')
    .order('posted_date', { ascending: false })
    .limit(20);

  let synced = 0;
  for (const row of recentPosted ?? []) {
    await syncBrainPublishedPost(client, userId, row.id as string);
    synced++;
  }

  return { synced_posts: synced };
}

export async function syncBrainVoiceLab(
  client: InsforgeClient,
  userId: string,
  payload: {
    voice_description: string;
    voice_rules: string;
    vocabulary_fingerprint?: Record<string, unknown>;
    structural_patterns?: Record<string, unknown>;
  },
): Promise<void> {
  await provisionCreatorBrain(client, userId);

  const voicePage = await getBrainPage(client, userId, BRAIN_SLUG.voice);
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
  });

  await syncBrainFromProfile(client, userId);
}
