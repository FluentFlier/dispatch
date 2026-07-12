import type { createClient } from '@insforge/sdk';
import { classifyPostHybrid, classifyPostHybridWithMeta } from '@/lib/signals/detect/hybrid';
import { classifyKeywordPost } from '@/lib/signals/detect/keyword-match';
import {
  filterPostsSinceCursor,
  filterSearchPostsSinceCursor,
  newestPostId,
  newestPostedAt,
} from '@/lib/signals/ingest/normalize';
import { createSignalEvent, getEvent, upsertRawPost } from '@/lib/signals/store';
import { runSignalActions } from '@/lib/signals/actions';
import { resolveRuleAction } from '@/lib/signals/rules/match';
import { listRules } from '@/lib/signals/rules/store';
import { logInfo } from '@/lib/logger';
import type {
  IngestedPost,
  SignalRuleRow,
  SignalSourceRow,
  SignalSourceType,
} from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

export interface ProcessBatchResult {
  postsIngested: number;
  signalsCreated: number;
  errors: string[];
}

/** Per-batch ceiling on actual LLM confirm calls. Two distinct paths reach the
 *  LLM and both count against this cap: (1) keyword-miss posts from a
 *  high-value source, escalated so the LLM can decide, and (2) company-less
 *  keyword HITS (any source), escalated purely for company-name recovery.
 *  Bounds cost when a single chatty tracked account floods a batch, or a
 *  batch is full of "we joined YC" posts with no named company. The
 *  company-recovery path's effective ceiling per batch is also bounded by
 *  `maxItems` (default 15 fresh posts per run), independent of this cap. This
 *  cap counts recovery calls but never blocks them (see the loop below); it
 *  only gates the keyword-miss escalation path. */
const MAX_LLM_CONFIRMS_PER_BATCH = 10;

// Source types the user explicitly tracks (follows). Only these are worth an
// LLM confirm on a keyword miss; keyword_search results and unknown sources
// stay keyword-only to keep cost bounded.
const HIGH_VALUE_SOURCE_TYPES: ReadonlySet<SignalSourceType> = new Set<SignalSourceType>([
  'account',
  'company_page',
  'person_profile',
]);

/**
 * Determines whether a source is "high value" for the hybrid classifier,
 * i.e. worth paying for an LLM confirm on a keyword miss. True for sources
 * the user explicitly tracks (account, company_page, person_profile); false
 * for keyword_search or an absent/unknown source type.
 */
function isHighValueSource(sourceType: SignalSourceType | undefined | null): boolean {
  return !!sourceType && HIGH_VALUE_SOURCE_TYPES.has(sourceType);
}

export async function processIngestedPosts(
  client: InsforgeClient,
  workspaceId: string,
  source: SignalSourceRow,
  posts: IngestedPost[],
  opts: {
    dryRun?: boolean;
    maxItems?: number;
    rules?: SignalRuleRow[];
    /** Workspace ICP description; enables the keyword-match relevance gate. */
    icpDescription?: string | null;
  } = {},
): Promise<ProcessBatchResult> {
  const result: ProcessBatchResult = {
    postsIngested: 0,
    signalsCreated: 0,
    errors: [],
  };

  const cursor = (source.cursor_json ?? {}) as {
    last_seen_post_id?: string;
    last_seen_posted_at?: string;
  };
  const maxItems = opts.maxItems ?? 5;
  const isKeywordSource = source.source_type === 'keyword_search';

  // Keyword-search result sets overlap run-to-run and the anchor post can drop
  // out of the window, so those sources use a time-window cursor instead of
  // last_seen_post_id anchoring.
  let fresh = isKeywordSource
    ? filterSearchPostsSinceCursor(posts, cursor.last_seen_posted_at, maxItems)
    : filterPostsSinceCursor(posts, cursor.last_seen_post_id, maxItems);

  // Keyword sources: drop already-ingested posts before spending relevance-LLM
  // calls or attempting duplicate events (the overlap window re-fetches posts
  // near the cursor by design; the raw-post unique index makes this cheap).
  if (isKeywordSource && fresh.length > 0 && !opts.dryRun) {
    try {
      const { data: seen } = await client.database
        .from('signal_raw_posts')
        .select('external_post_id')
        .eq('workspace_id', workspaceId)
        .eq('platform', source.platform)
        .in('external_post_id', fresh.map((p) => p.externalPostId));
      const seenIds = new Set((seen ?? []).map((r) => String(r.external_post_id)));
      fresh = fresh.filter((p) => !seenIds.has(p.externalPostId));
    } catch (err) {
      // Pre-dedupe is an optimization; on failure the dedupe_key still guards.
      logInfo('keyword pre-dedupe query failed; relying on dedupe_key', {
        sourceId: source.id,
        error: String(err),
      });
    }
  }

  const sourceIsHighValue = isHighValueSource(source.source_type);
  let llmConfirmsUsed = 0;
  let llmConfirmsSkippedByCap = 0;

  for (const post of fresh) {
    // `highValueSource` only gates the keyword-MISS escalation path below, so
    // gating it on the cap here only ever throttles that specific (bounded)
    // case. It has no effect on company-less keyword HITS: those escalate for
    // company-name recovery regardless of this flag (see hybrid.ts), and DO
    // consume the cap once the LLM call actually happens - the cap counts
    // that usage but never blocks the recovery attempt itself.
    const capAvailable = llmConfirmsUsed < MAX_LLM_CONFIRMS_PER_BATCH;
    const highValueSource = sourceIsHighValue && capAvailable;

    // Keyword sources bypass the GTM classifier entirely: the X search already
    // matched the post, so detection is deterministic, with an optional
    // ICP-relevance LLM gate that shares the batch LLM cap.
    let classified;
    let escalated = false;
    if (isKeywordSource) {
      const relevanceWillRun = Boolean(opts.icpDescription?.trim()) && capAvailable;
      classified = await classifyKeywordPost(post, source, {
        icpDescription: opts.icpDescription,
        skipRelevance: !capAvailable,
      });
      if (relevanceWillRun) escalated = true;
    } else {
      ({ signal: classified, escalated } = await classifyPostHybridWithMeta(post, { highValueSource }));
    }
    if (escalated) {
      // A real LLM call happened: count it against the cap.
      llmConfirmsUsed += 1;
    } else if (sourceIsHighValue && !capAvailable && classified === null) {
      // The cap blocked escalation AND this was a genuine keyword miss (a
      // keyword hit would have returned a non-null signal regardless of the
      // forced highValueSource: false). This is the case the skip log exists
      // to surface: a novel-phrasing post that the LLM would have judged, but
      // the batch's LLM budget was already spent.
      llmConfirmsSkippedByCap += 1;
    }
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

  if (llmConfirmsSkippedByCap > 0) {
    logInfo('LLM confirm cap reached for batch; remaining keyword-miss posts skipped', {
      sourceId: source.id,
      cap: MAX_LLM_CONFIRMS_PER_BATCH,
      skipped: llmConfirmsSkippedByCap,
    });
  }

  const latestId = newestPostId(posts) ?? cursor.last_seen_post_id;
  const latestPostedAt = isKeywordSource
    ? (newestPostedAt(posts) ?? cursor.last_seen_posted_at)
    : undefined;
  if ((latestId || latestPostedAt) && !opts.dryRun) {
    await client.database
      .from('signal_sources')
      .update({
        cursor_json: {
          ...cursor,
          ...(latestId ? { last_seen_post_id: latestId } : {}),
          ...(latestPostedAt ? { last_seen_posted_at: latestPostedAt } : {}),
        },
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
  // Webhook/manual ingest has no SignalSourceRow (only an optional bare
  // sourceId), so there is no source_type to check here. Treat as not
  // high-value: a keyword miss is dropped rather than escalated to the LLM.
  const classified = await classifyPostHybrid(post, { highValueSource: false });
  if (!classified) return { created: false };

  const rawPostId = await upsertRawPost(client, workspaceId, sourceId, post);
  const res = await createSignalEvent(client, workspaceId, rawPostId, classified);

  // Webhook/manual ingest: run the action pipeline too. No source_type here, so
  // auto-send stays off (draft-only); the person-profile gate in runSignalActions
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
