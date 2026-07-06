import type { createClient } from '@insforge/sdk';
import { categorizeEngager } from '@/lib/hooks-intelligence/categorize';
import { loadIcpKeywordsForWorkspace } from '@/lib/social-graph/icp-keywords';
import { fetchPostReactions, socialGraphAvailable } from '@/lib/social-graph/unipile-reactions';
import type {
  WarmContactCategory,
  WarmContactRow,
  WarmContactsListResult,
  WarmContactsSyncResult,
} from '@/lib/social-graph/types';
import { SOCIAL_GRAPH_CACHE_TTL_SECONDS } from '@/lib/social-graph/read-cache';
import { enforceConnectLimit } from '@/lib/signals/outreach/enforce-limit';
import { generateWithVoicePipeline } from '@/lib/voice-pipeline';
import { loadCreatorVoiceContext } from '@/lib/voice-context';

type InsforgeClient = ReturnType<typeof createClient>;

interface PublishedPostRow {
  post_id: string;
  platform: string;
  provider_post_id: string;
  title?: string;
}

function toCategory(cat: ReturnType<typeof categorizeEngager>): WarmContactCategory {
  return cat;
}

/**
 * Pull reactions from recent published posts and upsert warm_contacts rows.
 * UseSocial pattern: reactions on YOUR posts → people worth a connect this week.
 */
export async function syncWarmContacts(
  client: InsforgeClient,
  userId: string,
  workspaceId: string | null,
  opts: { maxPosts?: number; icpKeywords?: string[] } = {},
): Promise<WarmContactsSyncResult> {
  const result: WarmContactsSyncResult = {
    postsScanned: 0,
    reactionsFetched: 0,
    contactsUpserted: 0,
    errors: [],
  };

  if (!socialGraphAvailable()) {
    result.errors.push('Social graph requires Unipile (UNIPILE_API_KEY + UNIPILE_DSN).');
    return result;
  }

  const maxPosts = opts.maxPosts ?? 10;
  const icpKeywords =
    opts.icpKeywords ??
    (workspaceId ? await loadIcpKeywordsForWorkspace(client, workspaceId) : []);

  const { data: jobs } = await client.database
    .from('publish_jobs')
    .select('post_id, platform, provider_post_id')
    .eq('user_id', userId)
    .eq('status', 'published')
    .not('provider_post_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(maxPosts);

  const published = (jobs ?? []) as PublishedPostRow[];
  if (published.length === 0) return result;

  const postIds = published.map((j) => j.post_id);
  const { data: posts } = await client.database
    .from('posts')
    .select('id, title')
    .eq('user_id', userId)
    .in('id', postIds);

  const titleById = new Map(
    ((posts ?? []) as { id: string; title: string }[]).map((p) => [p.id, p.title]),
  );

  const now = new Date().toISOString();

  for (const job of published) {
    result.postsScanned += 1;
    try {
      const reactions = await fetchPostReactions(
        userId,
        job.provider_post_id,
        job.platform,
        { limit: 100 },
      );
      result.reactionsFetched += reactions.length;

      for (const reaction of reactions) {
        const category = toCategory(
          categorizeEngager(
            {
              name: reaction.displayName,
              handle: reaction.publicIdentifier,
              bio: reaction.headline,
              engagementType: 'like',
            },
            icpKeywords,
          ),
        );

        const row = {
          user_id: userId,
          workspace_id: workspaceId,
          platform: job.platform,
          provider_profile_id: reaction.providerProfileId ?? null,
          public_identifier: reaction.publicIdentifier ?? null,
          display_name: reaction.displayName ?? null,
          headline: reaction.headline ?? null,
          profile_url: reaction.profileUrl ?? null,
          reaction_type: reaction.reactionType ?? 'like',
          source_post_id: job.post_id,
          source_post_title: titleById.get(job.post_id) ?? null,
          category,
          last_synced_at: now,
          updated_at: now,
        };

        let existing: { id: string; status: string } | null = null;
        if (row.provider_profile_id) {
          const { data } = await client.database
            .from('warm_contacts')
            .select('id, status')
            .eq('user_id', userId)
            .eq('platform', job.platform)
            .eq('provider_profile_id', row.provider_profile_id)
            .limit(1)
            .maybeSingle();
          existing = (data as { id: string; status: string } | null) ?? null;
        }
        if (!existing && row.public_identifier) {
          const { data } = await client.database
            .from('warm_contacts')
            .select('id, status')
            .eq('user_id', userId)
            .eq('platform', job.platform)
            .eq('public_identifier', row.public_identifier)
            .limit(1)
            .maybeSingle();
          existing = (data as { id: string; status: string } | null) ?? null;
        }

        if (existing) {
          if (existing.status === 'dismissed' || existing.status === 'sent') continue;

          const updates: Record<string, unknown> = {
            headline: row.headline,
            profile_url: row.profile_url,
            reaction_type: row.reaction_type,
            source_post_id: row.source_post_id,
            source_post_title: row.source_post_title,
            last_synced_at: now,
            updated_at: now,
          };
          if (existing.status === 'new') {
            updates.category = row.category;
          }

          await client.database
            .from('warm_contacts')
            .update(updates)
            .eq('id', existing.id);
        } else if (row.provider_profile_id || row.public_identifier) {
          await client.database.from('warm_contacts').insert([{ ...row, status: 'new' }]);
          result.contactsUpserted += 1;
        }
      }
    } catch (err) {
      result.errors.push(
        err instanceof Error ? err.message : `Failed on post ${job.post_id}`,
      );
    }
  }

  return result;
}

/**
 * Fetch a single warm contact owned by the user.
 */
export async function getWarmContact(
  client: InsforgeClient,
  userId: string,
  contactId: string,
): Promise<WarmContactRow | null> {
  const { data } = await client.database
    .from('warm_contacts')
    .select('*')
    .eq('id', contactId)
    .eq('user_id', userId)
    .maybeSingle();

  return (data as WarmContactRow | null) ?? null;
}

/**
 * List warm contacts grouped by ICP category for UI and agents.
 */
export async function listWarmContacts(
  client: InsforgeClient,
  userId: string,
  opts: {
    status?: string;
    category?: string;
    limit?: number;
    excludeDismissed?: boolean;
  } = {},
): Promise<WarmContactsListResult> {
  let query = client.database
    .from('warm_contacts')
    .select('*')
    .eq('user_id', userId)
    .order('last_synced_at', { ascending: false });

  if (opts.status) query = query.eq('status', opts.status);
  if (opts.category) query = query.eq('category', opts.category);
  if (opts.excludeDismissed !== false) {
    query = query.neq('status', 'dismissed');
  }

  const limit = Math.min(opts.limit ?? 100, 200);
  query = query.limit(limit);

  const { data, error } = await query;
  if (error) throw error;

  const contacts = (data ?? []) as WarmContactRow[];
  const buckets: Record<WarmContactCategory, WarmContactRow[]> = {
    ICP: [],
    Community: [],
    'Potential Lead': [],
    Other: [],
  };

  for (const c of contacts) {
    const key = (c.category as WarmContactCategory) in buckets ? c.category : 'Other';
    buckets[key as WarmContactCategory].push(c);
  }

  return {
    contacts,
    buckets,
    summary: {
      total: contacts.length,
      new: contacts.filter((c) => c.status === 'new').length,
      icp: buckets.ICP.length,
    },
    meta: {
      cache_ttl_seconds: SOCIAL_GRAPH_CACHE_TTL_SECONDS,
      last_sync_hint: 'Run sync to refresh reactions from your published posts.',
    },
  };
}

/**
 * Draft a LinkedIn connection note for a warm contact in the creator's voice.
 */
export async function draftWarmContactOutreach(
  client: InsforgeClient,
  userId: string,
  workspaceId: string | null,
  contactId: string,
): Promise<{ draft: string; contact: WarmContactRow | null }> {
  const { data: contact } = await client.database
    .from('warm_contacts')
    .select('*')
    .eq('id', contactId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!contact) return { draft: '', contact: null };

  const row = contact as WarmContactRow;
  const voice = await loadCreatorVoiceContext(client, userId, {
    workspaceId: workspaceId ?? undefined,
    platform: 'linkedin',
    lightweight: true,
    includeGtm: true,
  });

  const prompt = [
    'Write a short LinkedIn connection note (max 280 chars).',
    `They reacted to your post: "${row.source_post_title ?? 'recent post'}".`,
    row.headline ? `Their headline: ${row.headline}` : null,
    row.display_name ? `Name: ${row.display_name}` : null,
    'Reference their engagement naturally. Sound human. No em dashes. No "I came across your profile".',
  ]
    .filter(Boolean)
    .join('\n');

  const result = await generateWithVoicePipeline({
    userPrompt: prompt,
    profile: voice.profile,
    contextAdditions: voice.contextAdditions,
    platform: 'linkedin',
    contentType: 'reply',
    fast: true,
  });

  const draft = enforceConnectLimit(result.text.trim());

  await client.database
    .from('warm_contacts')
    .update({
      outreach_draft: draft,
      outreach_channel: 'linkedin_connect',
      status: 'drafted',
      updated_at: new Date().toISOString(),
    })
    .eq('id', contactId)
    .eq('user_id', userId);

  return { draft, contact: { ...row, outreach_draft: draft, status: 'drafted' } };
}

/**
 * Persists an edited connect note before send (human-in-the-loop review).
 */
export async function updateWarmContactDraft(
  client: InsforgeClient,
  userId: string,
  contactId: string,
  draft: string,
): Promise<WarmContactRow | null> {
  const contact = await getWarmContact(client, userId, contactId);
  if (!contact || contact.status === 'sent' || contact.status === 'dismissed') {
    return null;
  }

  const note = enforceConnectLimit(draft.trim());
  const { data } = await client.database
    .from('warm_contacts')
    .update({
      outreach_draft: note,
      outreach_channel: 'linkedin_connect',
      status: 'drafted',
      updated_at: new Date().toISOString(),
    })
    .eq('id', contactId)
    .eq('user_id', userId)
    .select('*')
    .maybeSingle();

  return (data as WarmContactRow | null) ?? null;
}

/**
 * Marks a warm contact as dismissed so sync won't resurrect it into the triage queue.
 */
export async function dismissWarmContact(
  client: InsforgeClient,
  userId: string,
  contactId: string,
): Promise<boolean> {
  const { data } = await client.database
    .from('warm_contacts')
    .update({
      status: 'dismissed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', contactId)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle();

  return Boolean(data?.id);
}

/**
 * Drafts connect notes for the top new ICP contacts (batch human-review flow).
 */
export async function bulkDraftIcpWarmContacts(
  client: InsforgeClient,
  userId: string,
  workspaceId: string | null,
  limit = 5,
): Promise<{ drafted: number; contactIds: string[]; errors: string[] }> {
  const { data } = await client.database
    .from('warm_contacts')
    .select('id')
    .eq('user_id', userId)
    .eq('category', 'ICP')
    .eq('status', 'new')
    .order('last_synced_at', { ascending: false })
    .limit(Math.min(limit, 10));

  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  const contactIds: string[] = [];
  const errors: string[] = [];

  for (const id of ids) {
    try {
      const result = await draftWarmContactOutreach(client, userId, workspaceId, id);
      if (result.draft) contactIds.push(id);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : `Failed on ${id}`);
    }
  }

  return { drafted: contactIds.length, contactIds, errors };
}
