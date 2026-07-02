import type { createClient } from '@insforge/sdk';
import { classifyPost } from '@/lib/signals/classifier';
import {
  filterPostsSinceCursor,
  newestPostId,
} from '@/lib/signals/ingest/normalize';
import { createSignalEvent, getEvent, upsertRawPost } from '@/lib/signals/store';
import { runSignalActions } from '@/lib/signals/actions';
import { resolveRuleAction } from '@/lib/signals/rules/match';
import { listRules } from '@/lib/signals/rules/store';
import type { IngestedPost, SignalRuleRow, SignalSourceRow } from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

export interface ProcessBatchResult {
  postsIngested: number;
  signalsCreated: number;
  errors: string[];
}

export async function processIngestedPosts(
  client: InsforgeClient,
  workspaceId: string,
  source: SignalSourceRow,
  posts: IngestedPost[],
  opts: { dryRun?: boolean; maxItems?: number; rules?: SignalRuleRow[] } = {},
): Promise<ProcessBatchResult> {
  const result: ProcessBatchResult = {
    postsIngested: 0,
    signalsCreated: 0,
    errors: [],
  };

  const cursor = (source.cursor_json ?? {}) as { last_seen_post_id?: string };
  const maxItems = opts.maxItems ?? 5;
  const fresh = filterPostsSinceCursor(posts, cursor.last_seen_post_id, maxItems);

  for (const post of fresh) {
    const classified = classifyPost(post);
    if (!classified) continue;

    if (opts.dryRun) {
      result.signalsCreated += 1;
      continue;
    }

    try {
      const rawPostId = await upsertRawPost(client, workspaceId, source.id, post);
      result.postsIngested += 1;
      const { created, eventId } = await createSignalEvent(client, workspaceId, rawPostId, classified);
      if (created) {
        result.signalsCreated += 1;
        // Run the action pipeline (draft / guarded auto-send) per matched trigger
        // rule, falling back to the workspace default when no rule applies.
        if (eventId) {
          const event = await getEvent(client, workspaceId, eventId);
          if (event) {
            const resolution = resolveRuleAction(
              opts.rules ?? [],
              { platform: source.platform, sourceType: source.source_type },
              classified,
            );
            await runSignalActions(client, workspaceId, event, {
              platform: source.platform,
              sourceType: source.source_type,
              actionMode: resolution.actionMode ?? undefined,
              channels: resolution.channels,
            });
          }
        }
      }
    } catch (err) {
      result.errors.push(`ingest: ${String(err)}`);
    }
  }

  const latestId = newestPostId(posts) ?? cursor.last_seen_post_id;
  if (latestId && !opts.dryRun) {
    await client.database
      .from('signal_sources')
      .update({
        cursor_json: { ...cursor, last_seen_post_id: latestId },
        updated_at: new Date().toISOString(),
      })
      .eq('id', source.id);
  }

  return result;
}

/** Ingest a single post (webhook / manual seed). */
export async function ingestSinglePost(
  client: InsforgeClient,
  workspaceId: string,
  post: IngestedPost,
  sourceId: string | null = null,
): Promise<{ created: boolean; eventId?: string }> {
  const classified = classifyPost(post);
  if (!classified) return { created: false };

  const rawPostId = await upsertRawPost(client, workspaceId, sourceId, post);
  const res = await createSignalEvent(client, workspaceId, rawPostId, classified);

  // Webhook/manual ingest: run the action pipeline too. No source_type here, so
  // auto-send stays off (draft-only) — the person-profile gate in runSignalActions
  // requires a known source type.
  if (res.created && res.eventId) {
    const event = await getEvent(client, workspaceId, res.eventId);
    if (event) {
      const rules = await listRules(client, workspaceId);
      const resolution = resolveRuleAction(rules, { platform: post.platform }, classified);
      await runSignalActions(client, workspaceId, event, {
        platform: post.platform,
        actionMode: resolution.actionMode ?? undefined,
        channels: resolution.channels,
      });
    }
  }

  return res;
}
