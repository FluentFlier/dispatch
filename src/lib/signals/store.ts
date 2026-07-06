import type { createClient } from '@insforge/sdk';
import { getBrainPage, putBrainPage } from '@/lib/brain/pages';
import { BRAIN_SLUG } from '@/lib/brain/types';
import { DEFAULT_GTM_PLAYBOOK, DEFAULT_GTM_SOURCES } from '@/lib/signals/defaults';
import { notifySlackForNewSignal } from '@/lib/signals/notifications/slack-alert';
import type {
  ClassifiedSignal,
  IngestedPost,
  SignalEventRow,
  SignalEventWithPost,
  SignalSourceRow,
} from '@/lib/signals/types';

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

  const rows = DEFAULT_GTM_SOURCES.map((s) => ({
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
    body: JSON.stringify({ ...DEFAULT_GTM_PLAYBOOK, status: 'ready' }, null, 2),
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

export async function listEvents(
  client: InsforgeClient,
  workspaceId: string,
  opts: { status?: string; limit?: number; signalType?: string } = {},
): Promise<SignalEventWithPost[]> {
  const limit = Math.min(opts.limit ?? 50, 100);
  // NOTE: do NOT chain .order() here. On this backend, select('*') + embedded
  // resources + .order() together collapse the result to a single row (each
  // alone is fine). We sort by created_at in JS after mapping instead.
  let query = client.database
    .from('signal_events')
    .select(`
      *,
      raw_post:signal_raw_posts(*),
      outreach:signal_outreach(*)
    `)
    .eq('workspace_id', workspaceId)
    .limit(limit);

  if (opts.status) query = query.eq('status', opts.status);
  if (opts.signalType) query = query.eq('signal_type', opts.signalType);

  const { data, error } = await query;
  if (error) throw error;

  const mapped = (data ?? []).map((row) => {
    const outreachArr = row.outreach as unknown[];
    return {
      ...(row as SignalEventRow),
      raw_post: row.raw_post as SignalEventWithPost['raw_post'],
      outreach: Array.isArray(outreachArr) ? (outreachArr[0] as SignalEventWithPost['outreach']) : row.outreach as SignalEventWithPost['outreach'],
    };
  });

  return mapped.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

/**
 * Lists signal events hydrated with their raw post, newest first, for the
 * unified leads feed (Task 6). Unlike `listEvents`, this has no status/type
 * filters (the feed store filters after normalizing both sources) and caps at
 * `opts.limit` rows (default 200, same ceiling as before this took a `limit`).
 * Uses explicit columns for the event row plus the same raw_post embed as
 * `listEvents` — no `select('*')` with an unfiltered `.order()` chained on,
 * since that combination has been observed to collapse embedded-resource
 * queries to a single row on this backend.
 */
export async function listEventsWithPosts(
  client: InsforgeClient,
  workspaceId: string,
  opts: { limit?: number } = {},
): Promise<SignalEventWithPost[]> {
  const limit = Math.min(opts.limit ?? 200, 200);
  const { data, error } = await client.database
    .from('signal_events')
    .select(`
      id, workspace_id, raw_post_id, signal_type, company_name, person_name,
      accelerator_name, batch, signal_summary, confidence, dedupe_key, status,
      created_at, updated_at,
      raw_post:signal_raw_posts(*)
    `)
    .eq('workspace_id', workspaceId)
    .limit(limit);

  if (error) throw error;

  const mapped = (data ?? []).map((row) => ({
    ...(row as SignalEventRow),
    raw_post: row.raw_post as unknown as SignalEventWithPost['raw_post'],
  }));

  return mapped.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

export async function getEvent(
  client: InsforgeClient,
  workspaceId: string,
  eventId: string,
): Promise<SignalEventWithPost | null> {
  const { data, error } = await client.database
    .from('signal_events')
    .select(`
      *,
      raw_post:signal_raw_posts(*),
      outreach:signal_outreach(*)
    `)
    .eq('workspace_id', workspaceId)
    .eq('id', eventId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  const outreachArr = data.outreach as unknown[];
  return {
    ...(data as SignalEventRow),
    raw_post: data.raw_post as SignalEventWithPost['raw_post'],
    outreach: Array.isArray(outreachArr) ? (outreachArr[0] as SignalEventWithPost['outreach']) : data.outreach as SignalEventWithPost['outreach'],
  };
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

export async function createSignalEvent(
  client: InsforgeClient,
  workspaceId: string,
  rawPostId: string,
  classified: ClassifiedSignal,
): Promise<{ created: boolean; eventId?: string }> {
  const { data: existing } = await client.database
    .from('signal_events')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('dedupe_key', classified.dedupeKey)
    .maybeSingle();

  if (existing?.id) return { created: false };

  const { data, error } = await client.database
    .from('signal_events')
    .insert({
      workspace_id: workspaceId,
      raw_post_id: rawPostId,
      signal_type: classified.signalType,
      company_name: classified.companyName ?? null,
      person_name: classified.personName ?? null,
      accelerator_name: classified.acceleratorName ?? null,
      batch: classified.batch ?? null,
      signal_summary: classified.signalSummary,
      confidence: classified.confidence,
      dedupe_key: classified.dedupeKey,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error) {
    if (error.message?.includes('duplicate') || error.code === '23505') {
      return { created: false };
    }
    throw error;
  }

  const eventId = data.id as string;
  const eventRow = {
    id: eventId,
    signal_type: classified.signalType,
    company_name: classified.companyName ?? null,
    person_name: classified.personName ?? null,
    batch: classified.batch ?? null,
    signal_summary: classified.signalSummary,
  };

  notifySlackForNewSignal(client, workspaceId, eventRow).catch((err) => {
    console.error('[signals/slack] alert failed', err);
  });

  return { created: true, eventId };
}

export async function updateEventStatus(
  client: InsforgeClient,
  workspaceId: string,
  eventId: string,
  status: string,
): Promise<void> {
  const { error } = await client.database
    .from('signal_events')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('id', eventId);

  if (error) throw error;
}

export async function saveOutreachDraft(
  client: InsforgeClient,
  workspaceId: string,
  eventId: string,
  draftText: string,
  channel: string = 'copy',
): Promise<void> {
  const { data: existing } = await client.database
    .from('signal_outreach')
    .select('id')
    .eq('event_id', eventId)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await client.database
      .from('signal_outreach')
      .update({
        draft_text: draftText,
        channel,
        status: 'draft',
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await client.database.from('signal_outreach').insert({
      workspace_id: workspaceId,
      event_id: eventId,
      channel,
      status: 'draft',
      draft_text: draftText,
    });
    if (error) throw error;
  }

  await updateEventStatus(client, workspaceId, eventId, 'drafted');
}
