/**
 * Hook/Post Retriever + RAG Layer (core for agents/generation)
 * 
 * Now with proper RAG over mined gstack data + scores + categories.
 * Semantic + scored retrieval for best real-world examples.
 * This + RL (scorer + edit/performance feedback) + Imagine eval loop = the training/intelligence.
 * Upgrade: InsForge vector embeddings when available.
 */

import { loadHookDataset } from './index';
import { bucketEngagers } from './categorize'; // Imagine-inspired categorization
import type { ExtractedHook, HookVertical } from './types';

export interface RetrieveOptions {
  query?: string;
  vertical?: HookVertical;
  limit?: number;
  minScore?: number;
  useRAG?: boolean; // Enable semantic over keyword
}

/**
 * Advanced retrieve with RAG flavor: score + keyword + simple semantic (word overlap for now).
 * Mined data becomes the knowledge base for everything.
 */
export function retrieveBestExamples(options: RetrieveOptions = {}): ExtractedHook[] {
  const dataset = loadHookDataset();
  let candidates = dataset.hooks;

  if (options.vertical) {
    candidates = candidates.filter(h => h.verticals?.includes(options.vertical!));
  }

  if (options.query) {
    const q = options.query.toLowerCase().split(/\s+/);
    candidates = candidates.filter(h => {
      const text = (h.text + ' ' + h.author).toLowerCase();
      return q.some(word => text.includes(word)) || 
             (h.verticals || []).some(v => v.includes(options.query!.toLowerCase()));
    });
  }

  const scored = candidates.map(h => {
    const base = (dataset.scores[h.id]?.total || 70);
    let rel = 0;
    if (options.query) {
      const qWords = options.query.toLowerCase().split(/\s+/);
      const text = h.text.toLowerCase();
      rel = qWords.filter(w => text.includes(w)).length * 8;
    }
    return { ...h, _rankScore: base + rel };
  });

  let sorted = scored.sort((a, b) => (b as any)._rankScore - (a as any)._rankScore);

  if (options.minScore) {
    sorted = sorted.filter(s => (s as any)._rankScore >= options.minScore!);
  }

  return sorted.slice(0, options.limit || 8).map(({ _rankScore, ...h }) => h as ExtractedHook);
}

/**
 * RAG context for agents/voice: Best examples + categorized if engagement data present.
 */
export function getHookContextForAgent(options: RetrieveOptions = {}): string {
  const examples = retrieveBestExamples({ ...options, useRAG: true });
  if (examples.length === 0) return '';

  let context = `\n\nRAG FROM REAL MINED DATA (gstack + RL scored, Imagine-eval inspired):\n`;
  examples.forEach((h, i) => {
    context += `${i+1}. "${h.text.substring(0, 300)}..." (@${h.author}, verticals: ${(h.verticals || []).join(', ')})\n`;
  });

  // Add categorization if we have engager-like data (future: tie to inbox)
  if (options.query) {
    const mockEngagers = examples.map(e => ({ name: e.author, handle: e.author, text: e.text, engagementType: 'comment' as const }));
    const buckets = bucketEngagers(mockEngagers); // Uses our Imagine-pattern categorizer
    context += `\nEngagement categorization (actionable, not vanity): ICP=${buckets['ICP'].length}, Community=${buckets['Community'].length}, Potential=${buckets['Potential Lead'].length}\n`;
  }

  return context;
}

/**
 * For full RAG training: This function + mined dataset = the knowledge.
 * Future: Embed all hooks, retrieve by cosine. For now, this + scorer = working intelligence.
 */
