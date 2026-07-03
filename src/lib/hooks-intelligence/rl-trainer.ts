/**
 * RL / Training Layer for Hook Intelligence (closed loop from Imagine architecture patterns + our gstack mining)
 *
 * - Base "policy": Scorer (multi-signal)
 * - Rewards:
 *   - Human edits (via edit-feedback: negative for heavy rewrites of weak patterns)
 *   - Performance (engagement rates, categorized leads from our engagement-categorizer)
 *   - Implicit: Usage in successful generations
 * - Training: Update scores, extract patterns for RAG/few-shots, evolve prompts.
 * - Optimizer: Cluster winning mined data, feed back to voice pipeline + agents.
 *
 * This + continuous GStack mining + RAG retriever = the "training" that makes Content-OS amazing.
 * No direct Imagine code; better, multi-platform, gstack-powered, integrated with existing Creator Brain/voice-eval.
 */

import { loadHookDataset, saveHookDataset } from './index';
import { retrieveBestExamples } from './retriever';
import { bucketEngagers } from './categorize';
import type { ExtractedHook } from './types';
import type { createClient } from '@insforge/sdk';

type InsforgeClient = ReturnType<typeof createClient>;

export interface PerformanceSignal {
  hookId?: string;
  engagementRate?: number; // likes+replies / impressions proxy
  leadsGenerated?: number; // from categorization
  categorized?: ReturnType<typeof bucketEngagers>;
  success?: boolean; // post performed well
}

/**
 * Core RL update: Reinforce from real signals.
 * Call this after publish + engagement sync.
 */
export function updateFromPerformance(signals: PerformanceSignal[]) {
  const dataset = loadHookDataset();
  let updates = 0;

  for (const sig of signals) {
    if (!sig.hookId || !dataset.scores[sig.hookId]) continue;

    const current = dataset.scores[sig.hookId];
    let delta = 0;

    if (sig.engagementRate !== undefined) {
      delta += (sig.engagementRate - 0.02) * 50; // reward above 2% baseline
    }
    if (sig.leadsGenerated !== undefined) {
      delta += sig.leadsGenerated * 2; // strong reward for ICP leads
    }
    if (sig.success) delta += 5;

    const newTotal = Math.max(0, Math.min(100, current.total + delta * 0.3));
    dataset.scores[sig.hookId] = { ...current, total: newTotal, confidence: Math.min(0.99, current.confidence + 0.05) };
    updates++;
  }

  if (updates > 0) {
    saveHookDataset(dataset);
    console.log(`[RL Trainer] Updated ${updates} hooks from performance signals.`);
  }
}

/**
 * From edit feedback (Imagine continuous learning): Penalize patterns that required heavy human rewrite.
 */
export function updateFromEdits(editDiffs: Array<{ originalHookText: string; editedHookText: string; magnitude: number }>) {
  const dataset = loadHookDataset();
  // Simple: Find similar hooks in dataset and slightly lower their scores if edits were large
  // In production: Embed and cluster, or use LLM to extract "what was wrong"
  for (const diff of editDiffs) {
    if (diff.magnitude < 30) continue; // minor edit, ignore

    const similar = retrieveBestExamples({ query: diff.originalHookText, limit: 3 });
    for (const h of similar) {
      if (dataset.scores[h.id]) {
        dataset.scores[h.id].total = Math.max(40, dataset.scores[h.id].total - diff.magnitude * 0.1);
      }
    }
  }
  saveHookDataset(dataset);
  console.log(`[RL Trainer] Adjusted scores from ${editDiffs.length} human edits.`);
}

/**
 * Optimizer: Extract winning patterns from top mined data for RAG + prompt evolution.
 * Run periodically from continuous loops.
 */
export function extractWinningPatterns(limit = 100): string[] {
  const dataset = loadHookDataset();
  const top = [...dataset.hooks]
    .sort((a, b) => (dataset.scores[b.id]?.total || 0) - (dataset.scores[a.id]?.total || 0))
    .slice(0, limit);

  // Simple extraction (upgrade with GStack research or clustering later)
  const patterns = new Set<string>();
  top.forEach(h => {
    // Heuristics for hook structures
    if (h.text.match(/^\d+ /)) patterns.add('Numbered list opener');
    if (h.text.includes('?')) patterns.add('Question hook');
    if (h.text.toLowerCase().includes('how i')) patterns.add('Story/result hook');
    if (h.text.includes(' vs ')) patterns.add('Comparison hook');
  });

  console.log('[RL Trainer] Extracted winning patterns for RAG/few-shots:', Array.from(patterns));
  return Array.from(patterns);
}

/**
 * Full training step: Call from continuous research loop after mining pass.
 */
export function runTrainingStep(performanceSignals: PerformanceSignal[] = [], editDiffs: any[] = []) {
  if (performanceSignals.length) updateFromPerformance(performanceSignals);
  if (editDiffs.length) updateFromEdits(editDiffs);
  const patterns = extractWinningPatterns();
  // Future: Feed patterns back to voice-prompts or agent system prompts via InsForge
  return { patternsUpdated: patterns.length };
}

/**
 * Write EMA RL score to hook_performance DB table for a single (hook_id, vertical) pair.
 * EMA alpha=0.3: new_ema = 0.3 * new_score + 0.7 * existing. Called by intelligence-sync nightly cron.
 * Never writes to the in-memory dataset — DB is the durable source of truth for learned scores.
 */
export async function updateFromPerformanceDB(
  client: InsforgeClient,
  hookId: string,
  vertical: string,
  saveRate: number,
  success: boolean,
  leadsGenerated = 0,
): Promise<void> {
  const alpha = 0.3;
  let newScore = success
    ? Math.min(100, saveRate * 100 + 10)
    : Math.max(0, saveRate * 100);

  // Boost hooks that generated ICP / potential leads from engagement categorization.
  if (leadsGenerated > 0) {
    newScore = Math.min(100, newScore + leadsGenerated * 3);
  }

  const { data: existing } = await client.database
    .from('hook_performance')
    .select('rl_score, rl_confidence, sample_count')
    .eq('hook_id', hookId)
    .eq('vertical', vertical)
    .maybeSingle();

  if (existing) {
    await client.database.from('hook_performance').update({
      rl_score: alpha * newScore + (1 - alpha) * Number(existing.rl_score),
      rl_confidence: Math.min(0.99, Number(existing.rl_confidence) + 0.02),
      sample_count: Number(existing.sample_count) + 1,
      rl_updated_at: new Date().toISOString(),
    }).eq('hook_id', hookId).eq('vertical', vertical);
  } else {
    await client.database.from('hook_performance').insert({
      hook_id: hookId,
      vertical,
      rl_score: newScore,
      rl_confidence: 0.5,
      sample_count: 1,
      rl_updated_at: new Date().toISOString(),
    });
  }
}

/**
 * Penalizes hook IDs in hook_performance when users heavily rewrite AI output.
 * Writes to the same DB table intelligence-sync reads — closes the edit feedback loop.
 */
export async function updateFromEditsDB(
  client: InsforgeClient,
  hookIds: string[],
  magnitude: number,
  vertical = 'general',
  userId?: string,
  postId?: string,
): Promise<number> {
  if (hookIds.length === 0 || magnitude < 10) return 0;

  const penalty = Math.min(25, magnitude * 0.15);
  let updated = 0;

  for (const hookId of hookIds) {
    const { data: existing } = await client.database
      .from('hook_performance')
      .select('rl_score, rl_confidence, sample_count')
      .eq('hook_id', hookId)
      .eq('vertical', vertical)
      .maybeSingle();

    if (existing) {
      await client.database.from('hook_performance').update({
        rl_score: Math.max(0, Number(existing.rl_score) - penalty),
        rl_confidence: Math.max(0.1, Number(existing.rl_confidence) - 0.03),
        rl_updated_at: new Date().toISOString(),
      }).eq('hook_id', hookId).eq('vertical', vertical);
    } else {
      await client.database.from('hook_performance').insert({
        hook_id: hookId,
        vertical,
        rl_score: Math.max(20, 50 - penalty),
        rl_confidence: 0.3,
        sample_count: 0,
        rl_updated_at: new Date().toISOString(),
      });
    }
    updated++;
  }

  if (userId) {
    try {
      await client.database.from('edit_feedback_log').insert([{
        user_id: userId,
        post_id: postId ?? null,
        hook_ids: hookIds,
        vertical,
        magnitude,
      }]);
    } catch {
      // table may not exist until migration applied
    }
  }

  return updated;
}
