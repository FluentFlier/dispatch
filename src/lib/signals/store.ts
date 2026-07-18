import type { createClient } from '@insforge/sdk';
import { getBrainPage, putBrainPage } from '@/lib/brain/pages';
import { BRAIN_SLUG } from '@/lib/brain/types';
import { gtmPlaybookForWorkspace, gtmSourcesForWorkspace } from '@/lib/signals/defaults';
import type { IngestedPost, SignalSourceRow } from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

export async function ensureDefaultSources(
  client: InsforgeClient,
  workspaceId: string,
): Promise<number> {
  const { data: existing } = await client.database
    .from('signal_sources')
    .select('id')
    .eq('workspace_id', workspaceId)
    .limit(1);

  if (existing && existing.length > 0) return 0;

  // Neutral set for a generic workspace; the fuller Rho/Dylan watchlist only
  // when this workspace is the configured design partner.
  const rows = gtmSourcesForWorkspace(workspaceId).map((s) => ({
    workspace_id: workspaceId,
    platform: s.platform,
    handle_or_url: s.handle_or_url,
    source_type: s.source_type,
    label: s.label,
    enabled: true,
  }));

  const { error } = await client.database.from('signal_sources').insert(rows);
  if (error) throw error;
  return rows.length;
}

/** Seed GTM playbook brain page for Signals outreach (once per workspace). */
export async function ensureGtmPlaybook(
  client: InsforgeClient,
  userId: string,
  workspaceId: string,
): Promise<boolean> {
  const existing = await getBrainPage(client, userId, BRAIN_SLUG.gtm, workspaceId);
  if (existing?.body && !existing.body.includes('"status":"pending"')) return false;

  await putBrainPage(client, userId, {
    slug: BRAIN_SLUG.gtm,
    title: 'GTM playbook',
    tags: ['gtm', 'signals', 'outreach'],
    // Neutral starter for a generic workspace; the Rho sales playbook only for
    // the configured design-partner workspace. No tenant's pitch leaks to others.
    body: JSON.stringify({ ...gtmPlaybookForWorkspace(workspaceId), status: 'ready' }, null, 2),
    workspaceId,
  });
  return true;
}

export async function listSources(
  client: InsforgeClient,
  workspaceId: string,
): Promise<SignalSourceRow[]> {
  const { data, error } = await client.database
    .from('signal_sources')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as SignalSourceRow[];
}

export async function upsertRawPost(
  client: InsforgeClient,
  workspaceId: string,
  sourceId: string | null,
  post: IngestedPost,
): Promise<string> {
  const { data, error } = await client.database
    .from('signal_raw_posts')
    .upsert(
      {
        workspace_id: workspaceId,
        source_id: sourceId,
        platform: post.platform,
        external_post_id: post.externalPostId,
        author_handle: post.authorHandle ?? null,
        author_name: post.authorName ?? null,
        content: post.content,
        post_url: post.postUrl ?? null,
        posted_at: post.postedAt ?? null,
        raw_payload: post.rawPayload ?? {},
      },
      { onConflict: 'workspace_id,platform,external_post_id' },
    )
    .select('id')
    .single();

  if (error) throw error;
  return data.id as string;
}
