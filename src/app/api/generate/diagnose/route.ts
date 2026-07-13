import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { isCompactMode } from '@/lib/content-pipeline/compact';
import { loadCreatorVoiceContext } from '@/lib/voice-context';
import { memoryScopeTag } from '@/lib/memory/write';

/**
 * GET /api/generate/diagnose
 *
 * Ground-truth diagnostic for "why is the post generic / present-tense". Reports,
 * for the authed user, WHICH path generation actually takes and WHETHER the
 * context that should shape a post is really reaching it — so we stop guessing:
 *   - model + whether the full pipeline runs or the compact (small-model) reroute
 *   - whether Supermemory is configured and how many of THIS user's memories exist
 *   - whether a "Forbes"-style query actually retrieves anything
 *   - which voice/memory sources landed (context_completeness)
 *
 * Returns no secrets — only presence booleans and the (non-secret) model id.
 */
export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);

  const pipeline = {
    model: process.env.LLM_MODEL ?? '(unset → defaults to Llama-8B, which forces compact)',
    pipelineModeEnv: process.env.LLM_PIPELINE_MODE ?? '(unset → auto-detect by model size)',
    isCompactMode: isCompactMode(),
    note: isCompactMode()
      ? 'COMPACT: 2-call small-model path. Skips the hook stage and the voice/evaluate/escalate loop — hooks stay weak. Set LLM_MODEL to a capable model or LLM_PIPELINE_MODE=full for the full pipeline.'
      : 'FULL: base → hooks → humanize → voice → evaluate → escalate.',
  };

  const supermemoryConfigured = Boolean(process.env.SUPERMEMORY_API_KEY?.trim());
  let memory: Record<string, unknown> = { supermemoryConfigured };
  if (supermemoryConfigured) {
    try {
      const { listMemories, searchUserContext } = await import('@/lib/supermemory');
      const scopeTag = memoryScopeTag(user.id, workspaceId ?? null);
      const { memories } = await listMemories([scopeTag], 100, 1);
      const forbes = await searchUserContext(user.id, 'Forbes 30 Under 30 event', 5, workspaceId ?? undefined);
      memory = {
        supermemoryConfigured,
        scopeTag,
        totalMemoriesFirstPage: memories.length,
        sampleCustomIds: memories.slice(0, 5).map((m) => m.customId ?? '(none)'),
        forbesQueryHits: forbes.length,
        forbesTopSnippet: forbes[0]?.content?.slice(0, 160) ?? null,
      };
    } catch (err) {
      memory = { supermemoryConfigured, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // Run the real context load so completeness reflects exactly what generation sees.
  let completeness: unknown = null;
  let memoryBlockInPrompt = false;
  try {
    const ctx = await loadCreatorVoiceContext(client, user.id, {
      memoryQuery: 'Forbes 30 Under 30 event',
      workspaceId: workspaceId ?? undefined,
      platform: 'linkedin',
    });
    completeness = ctx.completeness;
    memoryBlockInPrompt = ctx.contextAdditions.includes('PAST CONTENT YOU HAVE ALREADY PUBLISHED');
  } catch (err) {
    completeness = { error: err instanceof Error ? err.message : String(err) };
  }

  return NextResponse.json({
    userId: user.id,
    workspaceId: workspaceId ?? null,
    pipeline,
    memory,
    voiceAndMemoryContext: { completeness, memoryBlockReachesPrompt: memoryBlockInPrompt },
    verdict: buildVerdict(pipeline.isCompactMode, memory, memoryBlockInPrompt),
  });
}

function buildVerdict(
  compact: boolean,
  memory: Record<string, unknown>,
  memoryInPrompt: boolean,
): string[] {
  const out: string[] = [];
  if (compact) {
    out.push('Running COMPACT mode (small model): weak hooks (no hook stage) and generic prose are expected here. This is the #1 quality cap.');
  }
  if (!memory.supermemoryConfigured) {
    out.push('SUPERMEMORY_API_KEY is NOT set: memory retrieval is fully off, so past posts can never inform generation (the tense fix has nothing to act on).');
  } else if ((memory.forbesQueryHits as number | undefined) === 0) {
    out.push('Supermemory is on but the Forbes post is NOT in memory (0 hits): run the backfill (scripts/backfill-memory.ts) or the post was never imported.');
  }
  if (!memoryInPrompt) {
    out.push('The dated memory block did NOT reach the prompt for a Forbes query — either no memory retrieved or the query missed.');
  }
  if (out.length === 0) out.push('Full pipeline + memory both look wired and populated. If quality is still low, it is a model-capability or prompt issue, not a wiring gap.');
  return out;
}
