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
