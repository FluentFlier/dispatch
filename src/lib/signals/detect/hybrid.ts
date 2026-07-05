import { classifyPost } from '@/lib/signals/classifier';
import { confirmSignalWithLLM } from '@/lib/signals/detect/llm-confirm';
import type { ClassifiedSignal, IngestedPost } from '@/lib/signals/types';

export interface HybridOptions {
  /** True when the post comes from a source the user explicitly tracks
   *  (account, company_page, person_profile). Only these pay for an LLM
   *  confirm on a keyword miss, keeping cost bounded. */
  highValueSource?: boolean;
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
  const keyword = classifyPost(post);
  if (keyword) return keyword;              // obvious keyword hit
  if (!opts.highValueSource) return null;   // untracked miss -> drop
  return confirmSignalWithLLM(post);        // tracked miss -> LLM decides
}
