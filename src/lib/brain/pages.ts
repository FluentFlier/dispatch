import type { createClient } from '@insforge/sdk';
import type { BrainPageRecord } from './types';

type InsforgeClient = ReturnType<typeof createClient>;

export async function listBrainPages(
  client: InsforgeClient,
  userId: string,
): Promise<BrainPageRecord[]> {
  const { data, error } = await client.database
    .from('creator_brain_pages')
    .select('id, user_id, slug, title, tags, body, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to list brain pages: ${error.message}`);
  }

  return (data ?? []) as BrainPageRecord[];
}

export async function getBrainPage(
  client: InsforgeClient,
  userId: string,
  slug: string,
): Promise<BrainPageRecord | null> {
  const { data, error } = await client.database
    .from('creator_brain_pages')
    .select('id, user_id, slug, title, tags, body, updated_at')
    .eq('user_id', userId)
    .eq('slug', slug)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get brain page: ${error.message}`);
  }

  return (data as BrainPageRecord | null) ?? null;
}

export async function putBrainPage(
  client: InsforgeClient,
  userId: string,
  opts: {
    slug: string;
    title: string;
    tags?: string[];
    body: string;
  },
): Promise<BrainPageRecord> {
  const now = new Date().toISOString();
  const { data, error } = await client.database
    .from('creator_brain_pages')
    .upsert(
      {
        user_id: userId,
        slug: opts.slug,
        title: opts.title,
        tags: opts.tags ?? [],
        body: opts.body,
        updated_at: now,
      },
      { onConflict: 'user_id,slug' },
    )
    .select('id, user_id, slug, title, tags, body, updated_at')
    .single();

  if (error || !data) {
    throw new Error(`Failed to save brain page: ${error?.message ?? 'unknown'}`);
  }

  return data as BrainPageRecord;
}

export async function getBrainStatus(
  client: InsforgeClient,
  userId: string,
): Promise<{ page_count: number; slugs: string[]; last_updated: string | null }> {
  const pages = await listBrainPages(client, userId);
  return {
    page_count: pages.length,
    slugs: pages.map((p) => p.slug),
    last_updated: pages[0]?.updated_at ?? null,
  };
}
