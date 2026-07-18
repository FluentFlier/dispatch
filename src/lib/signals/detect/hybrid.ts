import { classifyPost, rejectStopwordCompanyName } from '@/lib/signals/classifier';
import { confirmSignalWithLLM } from '@/lib/signals/detect/llm-confirm';
import type { ClassifiedSignal, IngestedPost } from '@/lib/signals/types';

export interface HybridOptions {
  /** True when the post comes from a source the user explicitly tracks
   *  (account, company_page, person_profile). Only these pay for an LLM
   *  confirm on a keyword miss, keeping cost bounded. */
  highValueSource?: boolean;
  /** Workspace watchlist keywords (Task 6), merged into the accelerator pack. */
  extraKeywords?: string[];
}

export interface HybridResult {
  signal: ClassifiedSignal | null;
  /** True only when the keyword stage missed AND the LLM confirm stage actually
   *  ran. Callers use this (not "considered") to enforce a per-batch cost cap
   *  on real LLM calls. */
  escalated: boolean;
}

/**
 * Two-stage GTM detection. An obvious keyword hit passes immediately (no LLM).
 * On a keyword miss, a post from a high-value tracked source escalates to the
 * LLM confirm stage so novel phrasing on followed accounts is not lost; a miss
 * from any other source is dropped. Returns a ClassifiedSignal or null.
 */
export async function classifyPostHybrid(
  post: IngestedPost,
  opts: HybridOptions = {},
): Promise<ClassifiedSignal | null> {
  return (await classifyPostHybridWithMeta(post, opts)).signal;
}

/**
 * Like classifyPostHybrid but also reports whether the LLM-confirm stage ran,
 * so callers can enforce a cost cap on actual LLM calls (not on posts considered).
 */
export async function classifyPostHybridWithMeta(
  post: IngestedPost,
  opts: HybridOptions = {},
): Promise<HybridResult> {
  const keyword = classifyPost(post, opts.extraKeywords);
  if (keyword) {
    // Regex often cannot name the company on "we joined YC W26" style posts.
    // Recover it via the LLM ONLY when the keyword stage produced no company,
    // so cost stays bounded to the exact gap.
    if (!keyword.companyName) {
      const enriched = await confirmSignalWithLLM(post);
      if (enriched?.companyName) {
        return {
          signal: {
            ...keyword,
            // The LLM can return a bare stopword ("the") just as easily as the
            // regex path can, so route it through the same guard before it
            // ever reaches a signal.
            companyName: rejectStopwordCompanyName(enriched.companyName) ?? undefined,
            personName: keyword.personName ?? enriched.personName,
            acceleratorName: keyword.acceleratorName ?? enriched.acceleratorName,
            batch: keyword.batch ?? enriched.batch,
          },
          escalated: true,
        };
      }
      return { signal: keyword, escalated: true }; // LLM ran, found nothing new
    }
    return { signal: keyword, escalated: false };
  }
  if (!opts.highValueSource) return { signal: null, escalated: false };    // untracked miss -> drop
  const signal = await confirmSignalWithLLM(post);                        // tracked miss -> LLM decides
  return { signal, escalated: true };
}
