import type { createClient } from '@insforge/sdk';
import {
  getSignalsIngestMode,
  SIGNALS_MAX_POSTS_PER_SOURCE,
  signalsApifyEnabled,
} from '@/lib/signals/ingest/config';
import {
  createApifyClient,
  fetchKeywordPostsViaApify,
  fetchPostsViaApify,
} from '@/lib/signals/ingest/apify-fetch';
import { getDirectorySettings } from '@/lib/signals/leads/store';
import { processIngestedPosts, ingestSinglePost } from '@/lib/signals/ingest/process-batch';
import { fetchPostsViaUnipile, unipileConfigured } from '@/lib/signals/ingest/unipile-fetch';
import { getWorkspacePollAccount } from '@/lib/signals/ingest/workspace-account';
import {
  ensureDefaultSources,
  listSources,
} from '@/lib/signals/store';
import { listRules } from '@/lib/signals/rules/store';
import { checkProfileChange } from '@/lib/signals/profile/sync';
import {
  getSafetySettings,
  logSignalAudit,
  shouldPollSource,
  sleep,
} from '@/lib/signals/safety';
import type { IngestedPost, SignalSourceRow } from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

export interface SyncResult {
  workspaceId: string;
  sourcesPolled: number;
  postsIngested: number;
  signalsCreated: number;
  ingestMode: string;
  errors: string[];
}

async function fetchPostsForSource(
  client: InsforgeClient,
  workspaceId: string,
  source: SignalSourceRow,
  maxItems: number,
): Promise<IngestedPost[]> {
  const mode = getSignalsIngestMode();

  if (mode === 'webhook') {
    return [];
  }

  // Keyword monitoring runs an X *search*, which only Apify supports (Unipile
  // has no search endpoint). v1 is X-only; LinkedIn keyword sources are a no-op.
  if (source.source_type === 'keyword_search') {
    if (source.platform !== 'x') return [];
    const apify = createApifyClient();
    if (!apify || (mode !== 'apify' && !signalsApifyEnabled())) {
      throw new Error(
        'Keyword monitoring requires Apify: set SIGNALS_USE_APIFY=true and APIFY_TOKEN',
      );
    }
    return fetchKeywordPostsViaApify(source, apify, maxItems);
  }

  const tryUnipile = mode === 'unipile' || mode === 'auto';
  if (tryUnipile && unipileConfigured()) {
    const account = await getWorkspacePollAccount(client, workspaceId, source.platform);
    if (account) {
      return fetchPostsViaUnipile(source, account.unipileAccountId, maxItems);
    }
    if (mode === 'unipile') {
      throw new Error(
        `No connected ${source.platform === 'x' ? 'X' : 'LinkedIn'} account for Unipile polling`,
      );
    }
  }

  const tryApify = mode === 'apify' || (mode === 'auto' && signalsApifyEnabled());
  if (tryApify) {
    const apify = createApifyClient();
    if (!apify) {
      throw new Error('SIGNALS_USE_APIFY=true but APIFY_TOKEN is not set');
    }
    return fetchPostsViaApify(source, apify, maxItems);
  }

  return [];
}

/**
 * Poll enabled sources, classify posts, create signal events.
 * Default ingest: Unipile (connected account) → optional Apify → webhook-only.
 */
export async function syncWorkspaceSignals(
  client: InsforgeClient,
  workspaceId: string,
  opts: { maxItemsPerSource?: number; dryRun?: boolean } = {},
): Promise<SyncResult> {
  const maxItems = Math.min(opts.maxItemsPerSource ?? SIGNALS_MAX_POSTS_PER_SOURCE, 15);
  const mode = getSignalsIngestMode();
  const result: SyncResult = {
    workspaceId,
    sourcesPolled: 0,
    postsIngested: 0,
    signalsCreated: 0,
    ingestMode: mode,
    errors: [],
  };

  if (mode === 'webhook') {
    result.errors.push(
      'SIGNALS_INGEST_MODE=webhook - polling disabled. Use POST /api/signals/ingest (Clay/Zapier) or manual seed.',
    );
    return result;
  }

  await ensureDefaultSources(client, workspaceId);
  const safety = await getSafetySettings(client, workspaceId);
  const sources = (await listSources(client, workspaceId)).filter((s) => s.enabled);
  // Load trigger rules once per run; the batch matches each signal against them.
  const rules = await listRules(client, workspaceId);

  const canPoll =
    (unipileConfigured() && mode !== 'apify') || (signalsApifyEnabled() && mode !== 'unipile');

  if (!canPoll && mode === 'auto') {
    result.errors.push(
      'No ingest provider: connect LinkedIn/X via Unipile, set SIGNALS_USE_APIFY=true, or use webhook ingest.',
    );
    return result;
  }

  const eligible = sources
    .filter((s) =>
      shouldPollSource(
        s.last_polled_at,
        s.poll_interval_minutes,
        safety.min_poll_interval_minutes,
      ),
    )
    .slice(0, safety.max_sources_per_sync_run);

  // ICP context for the keyword-match relevance gate. Loaded once per run, and
  // only when a keyword source is actually up for polling; a load failure just
  // skips the gate (matches surface at baseline confidence).
  let icpDescription: string | null = null;
  if (eligible.some((s) => s.source_type === 'keyword_search')) {
    try {
      icpDescription = (await getDirectorySettings(client, workspaceId)).icp_description;
    } catch {
      icpDescription = null;
    }
  }

  for (let i = 0; i < eligible.length; i++) {
    const source = eligible[i];
    let posts: IngestedPost[] = [];

    try {
      posts = await fetchPostsForSource(client, workspaceId, source, maxItems);
      result.sourcesPolled += 1;
      await logSignalAudit(client, {
        workspace_id: workspaceId,
        action: 'poll_source',
        channel: source.platform,
        metadata: {
          source_id: source.id,
          handle: source.handle_or_url,
          posts: posts.length,
          ingest_mode: mode,
        },
      });
      await client.database
        .from('signal_sources')
        .update({ last_polled_at: new Date().toISOString() })
        .eq('id', source.id);
    } catch (err) {
      result.errors.push(`${source.label ?? source.handle_or_url}: ${String(err)}`);
      continue;
    }

    const batch = await processIngestedPosts(client, workspaceId, source, posts, {
      dryRun: opts.dryRun,
      maxItems,
      rules,
      icpDescription,
    });
    result.postsIngested += batch.postsIngested;
    result.signalsCreated += batch.signalsCreated;
    result.errors.push(...batch.errors);

    // Profile-change detection: diff the tracked person/company's LinkedIn fields
    // against the stored baseline. Skipped in dry-run and for non-tracked-profile
    // / non-LinkedIn sources (the helper guards internally).
    if (
      !opts.dryRun &&
      source.platform === 'linkedin' &&
      ['person_profile', 'company_page'].includes(source.source_type)
    ) {
      try {
        const profileResult = await checkProfileChange(client, workspaceId, source, rules);
        if (profileResult.signalCreated) result.signalsCreated += 1;
      } catch (err) {
        result.errors.push(`profile-change ${source.handle_or_url}: ${String(err)}`);
      }
    }

    if (i < eligible.length - 1 && safety.delay_between_polls_ms > 0) {
      await sleep(safety.delay_between_polls_ms);
    }
  }

  return result;
}

/** Dev/demo ingest without polling providers */
export async function ingestManualPost(
  client: InsforgeClient,
  workspaceId: string,
  post: IngestedPost,
): Promise<{ created: boolean; eventId?: string }> {
  return ingestSinglePost(client, workspaceId, post, null);
}
