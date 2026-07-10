import type { createClient } from '@insforge/sdk';
import type { BrainPageRecord } from './types';

type InsforgeClient = ReturnType<typeof createClient>;

/**
 * Lists all brain pages for a user, optionally scoped to a workspace.
 * When workspaceId is provided the query adds a workspace_id filter so
 * agency clients cannot read each other's brain pages. Callers without
 * a workspaceId (legacy / personal accounts) continue to work unchanged.
 */
export async function listBrainPages(
  client: InsforgeClient,
  userId: string,
  workspaceId?: string,
): Promise<BrainPageRecord[]> {
  let query = client.database
    .from('creator_brain_pages')
    .select('id, user_id, slug, title, tags, body, updated_at')
    .eq('user_id', userId);

  // Workspace-scope: filter to the specific workspace when provided so
  // agency workspaces never bleed into each other.
  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId);
  }

  const { data, error } = await query.order('updated_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to list brain pages: ${error.message}`);
  }

  return (data ?? []) as BrainPageRecord[];
}

/**
 * Fetches a single brain page by slug for a user, optionally scoped to a workspace.
 * workspaceId is optional for backwards compatibility — existing callers without it
 * continue to work, but new callers should always pass it to enforce isolation.
 */
export async function getBrainPage(
  client: InsforgeClient,
  userId: string,
  slug: string,
  workspaceId?: string,
): Promise<BrainPageRecord | null> {
  let query = client.database
    .from('creator_brain_pages')
    .select('id, user_id, slug, title, tags, body, updated_at')
    .eq('user_id', userId)
    .eq('slug', slug);

  // Workspace-scope: narrow to workspace when provided so callers cannot
  // inadvertently read a page belonging to another workspace.
  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new Error(`Failed to get brain page: ${error.message}`);
  }

  return (data as BrainPageRecord | null) ?? null;
}

/**
 * Creates or updates a brain page for a user, optionally associating it with
 * a workspace. When workspaceId is provided it is stored in workspace_id so
 * the page belongs exclusively to that workspace's namespace.
 */
export async function putBrainPage(
  client: InsforgeClient,
  userId: string,
  opts: {
    slug: string;
    title: string;
    tags?: string[];
    body: string;
    workspaceId?: string;
  },
): Promise<BrainPageRecord> {
  const now = new Date().toISOString();

  // Build upsert payload — include workspace_id only when the caller provides
  // it so that personal/legacy rows (no workspaceId) are not accidentally
  // assigned a null workspace_id that would break existing RLS policies.
  const upsertPayload: Record<string, unknown> = {
    user_id: userId,
    slug: opts.slug,
    title: opts.title,
    tags: opts.tags ?? [],
    body: opts.body,
    updated_at: now,
  };

  if (opts.workspaceId) {
    upsertPayload.workspace_id = opts.workspaceId;
  }

  const { data, error } = await client.database
    .from('creator_brain_pages')
    // Workspace-scoped conflict target (break 21). Matches the composite unique
    // constraint creator_brain_pages_user_ws_slug_key (UNIQUE NULLS NOT DISTINCT
    // on user_id, workspace_id, slug), so a user in two workspaces holds distinct
    // same-slug pages instead of the second silently overwriting the first.
    .upsert(upsertPayload, { onConflict: 'user_id,workspace_id,slug' })
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
