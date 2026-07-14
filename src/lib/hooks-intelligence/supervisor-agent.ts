/**
 * Content Intelligence Supervisor - hook context retrieval (stub).
 *
 * CURRENT STATE: This function returns hook examples from the local dataset only.
 * The RL training loop, generate node, and engagement categorization nodes are
 * NOT yet wired. Returning `status: 'hook-context-only'` so callers know exactly
 * what they are getting - previous version returned 'cycle-complete' and
 * `usageTracked: true` even though no generation or training occurred.
 *
 * NEXT WAVE: Wire the generate node (voice pipeline call), pass real performance
 * signals to runTrainingStep(), and connect the engage/optimize nodes.
 */

import { getHookContextForAgent } from './retriever';
import type { HookVertical } from './types';

export async function runContentIntelligenceSupervisor(
  userId: string,
  brief: string,
  vertical?: string
): Promise<{
  status: string;
  brief: string;
  vertical: string;
  researchContext: string;
  intelligence: { hooks: string };
  usageTracked: boolean;
}> {
  // Pull top hook examples from the local dataset for the given context.
  // This is the only node that currently runs end-to-end.
  const researchContext = getHookContextForAgent({
    query: brief,
    vertical: vertical as HookVertical | undefined,
    limit: 10,
    useRAG: true,
  });

  return {
    status: 'hook-context-only',
    brief,
    vertical: vertical ?? 'general',
    researchContext: researchContext.substring(0, 400),
    intelligence: { hooks: researchContext },
    // Not charging for a stub - the generate node that would consume quota is not running.
    usageTracked: false,
  };
}
