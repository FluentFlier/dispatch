/**
 * Production Mining Service for Content-OS (scalable SaaS)
 * 
 * Dev: gstack (free, fast prototyping via browser-skills + continuous loops; see scripts/).
 * Prod: Apify actors (reliable, anti-bot X/LinkedIn scraping at 10k+ scale for hooks + engagement).
 * 
 * Stores to InsForge DB (hook_examples + social_listening_runs).
 * Triggers RL training after each run.
 * Cost-controlled via maxResults + USE_APIFY flag.
 * 
 * Architecture: Imagine-inspired agentic collection + our RL/RAG + GStack dev velocity.
 * No direct code copied.
 */

import { ApifyClient } from 'apify-client';
import { getServiceClient } from '@/lib/insforge/server';
import { addHooksToDataset, scoreHook } from './index';
import { runTrainingStep } from './rl-trainer';
import type { ExtractedHook } from './types';

interface MiningConfig {
  platform: 'x' | 'linkedin';
  targets: string[]; // handles (e.g. "levelsio") or search queries
  maxResults?: number;
  vertical?: string;
}

const APIFY_TOKEN = process.env.APIFY_TOKEN;

export class ProdMiningService {
  private apify: ApifyClient | null = null;

  constructor() {
    if (APIFY_TOKEN) {
      this.apify = new ApifyClient({ token: APIFY_TOKEN });
    }
  }

  private isProd(): boolean {
    return process.env.USE_APIFY === 'true' || process.env.NODE_ENV === 'production';
  }

  async mine(config: MiningConfig, orgOrUserId: string) {
    const client = getServiceClient();
    const max = Math.min(config.maxResults || 40, 100); // cost guard

    if (!this.isProd() || !this.apify) {
      console.log('[ProdMining] Dev / no Apify token: falling back to gstack scripts (run scripts/research-hooks.ts or continuous-research-loop.sh)');
      // Optional: could spawn the tsx script here for hybrid dev, but explicit scripts are preferred for control.
      return { status: 'dev-gstack-fallback', message: 'See scripts/ for high-volume mining' };
    }

    console.log(`[ProdMining] Apify ${config.platform} mining for ${config.targets.length} targets (max ${max})`);

    let items: any[] = [];

    try {
      if (config.platform === 'x') {
        // Reliable public actor for X posts (profile + search capable)
        const run = await this.apify.actor('apify/twitter-scraper').call({
          startUrls: config.targets.map(t => ({
            url: t.startsWith('http') ? t : `https://x.com/${t.replace('@', '')}`,
          })),
          maxItems: max,
          // Add more filters if needed: onlyTweetsWithMedia, etc.
        });

        const { items: datasetItems } = await this.apify.dataset(run.defaultDatasetId).listItems();
        items = datasetItems || [];
      } else {
        // LinkedIn: use a solid Apify actor (example; user can swap)
        const run = await this.apify.actor('apify/linkedin-posts-scraper').call({
          profileUrls: config.targets.map(t => t.startsWith('http') ? t : `https://linkedin.com/in/${t}`),
          maxPosts: max,
        });
        const { items: datasetItems } = await this.apify.dataset(run.defaultDatasetId).listItems();
        items = datasetItems || [];
      }
    } catch (err) {
      console.error('[ProdMining] Apify run failed:', err);
      return { status: 'apify-error', error: String(err) };
    }

    // Normalize to our ExtractedHook + hook_examples shape
    const now = new Date().toISOString();
    const hooks: ExtractedHook[] = [];

    for (const it of items) {
      const text = (it.text || it.fullText || it.caption || '').trim();
      if (!text || text.length < 25) continue;

      const author = it.author?.userName || it.author?.name || it.ownerUsername || config.targets[0] || 'unknown';
      const engagement = {
        likes: it.likeCount ?? it.likes ?? it.favoriteCount ?? 0,
        replies: it.replyCount ?? it.comments ?? 0,
        reposts: it.retweetCount ?? it.reposts ?? 0,
        views: it.viewCount ?? it.views ?? 0,
      };

      const hook: ExtractedHook = {
        id: `apify-${it.id || Date.now()}-${author}`.slice(0, 80),
        text: text.substring(0, 1800),
        author: String(author).replace(/^@/, ''),
        platform: config.platform === 'linkedin' ? 'linkedin' : 'x',
        verticals: [ (config.vertical as any) || 'general' ],
        engagement,
        minedAt: now,
      };
      hooks.push(hook);
    }

    if (hooks.length === 0) {
      return { status: 'apify-no-results', count: 0 };
    }

    // Score locally
    const scored = hooks.map(h => {
      const sc = scoreHook(h);
      return {
        ...h,
        score_total: Math.round(sc.total),
        score_details: { source: 'apify-prod', engagement: h.engagement },
      };
    });

    // Persist to InsForge (production source of truth)
    const { error: dbErr } = await client.database.from('hook_examples').upsert(
      scored.map(h => ({
        id: h.id,
        text: h.text,
        author: h.author,
        platform: h.platform,
        verticals: h.verticals,
        engagement: h.engagement,
        score_total: h.score_total,
        score_details: h.score_details,
        mined_at: now,
      })),
      { onConflict: 'id' }
    );

    if (dbErr) {
      console.warn('[ProdMining] DB upsert warning (continuing with local RAG):', dbErr.message);
    }

    // Immediate RAG availability (local dataset for this process + voice pipeline)
    addHooksToDataset(hooks);

    // Audit log
    await client.database.from('social_listening_runs').insert({
      accounts_checked: config.targets.length,
      new_hooks_found: hooks.length,
      // run metadata can be extended
    });

    // Close the loop: feed new high-signal data into RL
    runTrainingStep([], []); // patterns will be re-extracted; performance signals come from engagement sync

    console.log(`[ProdMining] Stored ${hooks.length} hooks from Apify. Intelligence updated.`);

    return {
      status: 'prod-apify-success',
      count: hooks.length,
      costEstimate: `~$${(hooks.length * 0.012).toFixed(2)}`,
      sample: hooks.slice(0, 2).map(h => h.text.substring(0, 80)),
    };
  }

  /**
   * Cron / scheduled entrypoint for a single workspace (or default watchlist when id empty).
   */
  async scheduledMineForOrg(orgId: string, verticals: string[] = ['indie_maker', 'ai']) {
    const client = getServiceClient();
    const { getWorkspaceWatchlistTargets } = await import('./workspace-watchlist');
    const workspaceId = orgId.trim() || null;
    const { handles, source } = await getWorkspaceWatchlistTargets(client, workspaceId);
    const targets = handles.slice(0, 25);

    const results: Array<Record<string, unknown>> = [];
    for (const v of verticals) {
      const r = await this.mine({ platform: 'x', targets: targets.slice(0, 15), maxResults: 30, vertical: v }, orgId || 'default');
      results.push({ vertical: v, watchlistSource: source, ...r });
    }

    // One more training pass after the batch
    runTrainingStep();

    return {
      orgId: orgId || 'default',
      watchlistSource: source,
      results,
      totalNew: results.reduce((s, r) => s + (typeof r.count === 'number' ? r.count : 0), 0),
    };
  }

  /**
   * Daily mining across workspaces with custom watchlists. Falls back to one
   * default pass when no workspace-specific lists exist.
   */
  async scheduledMineAllWorkspaces(opts?: { maxWorkspaces?: number; verticals?: string[] }) {
    const client = getServiceClient();
    const maxWs = opts?.maxWorkspaces ?? 10;
    const verticals = opts?.verticals ?? ['indie_maker', 'ai'];

    let workspaceIds: string[] = [];
    try {
      const { data } = await client.database
        .from('workspace_watchlists')
        .select('workspace_id')
        .eq('enabled', true);
      workspaceIds = Array.from(
        new Set((data ?? []).map((row: { workspace_id: string }) => row.workspace_id)),
      );
    } catch (err) {
      console.warn('[ProdMining] workspace_watchlists query failed:', err);
    }

    if (workspaceIds.length === 0) {
      const single = await this.scheduledMineForOrg('', verticals);
      return { workspaces: 0, mode: 'default' as const, results: [single], totalNew: single.totalNew };
    }

    const results = [];
    for (const wsId of workspaceIds.slice(0, maxWs)) {
      results.push(await this.scheduledMineForOrg(wsId, verticals));
    }

    return {
      workspaces: results.length,
      mode: 'per-workspace' as const,
      results,
      totalNew: results.reduce((s, r) => s + r.totalNew, 0),
    };
  }
}

export const prodMining = new ProdMiningService();
