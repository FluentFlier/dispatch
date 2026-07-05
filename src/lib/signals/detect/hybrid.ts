import { classifyPost, scorePost } from '@/lib/signals/classifier';
import { confirmSignalWithLLM } from '@/lib/signals/detect/llm-confirm';
import type { ClassifiedSignal, IngestedPost } from '@/lib/signals/types';

// Borderline band: below the accept threshold but not clearly junk. Only these
// posts pay for an LLM call, keeping cost bounded while catching novel phrasing.
const BORDERLINE_LOW = 0.3;
const BORDERLINE_HIGH = 0.55; // SIGNAL_CONFIDENCE_THRESHOLD

/**
 * Two-stage GTM detection. Obvious keyword hits pass immediately (no LLM);
 * obvious junk is dropped immediately; only borderline posts escalate to the
 * LLM confirm stage. Returns a ClassifiedSignal or null.
 */
export async function classifyPostHybrid(post: IngestedPost): Promise<ClassifiedSignal | null> {
  const keyword = classifyPost(post);
  if (keyword) return keyword; // obvious hit

  const { bestScore } = scorePost(post);
  if (bestScore < BORDERLINE_LOW || bestScore >= BORDERLINE_HIGH) return null; // junk (or already handled)

  return confirmSignalWithLLM(post); // borderline - let the LLM decide
}
