import type { createClient } from '@insforge/sdk';
import type { CreatorProfileForPrompt } from '@/lib/ai';
import type { VocabularyFingerprint, StructuralPatterns } from '@/lib/voice-context';

type InsforgeClient = ReturnType<typeof createClient>;

/**
 * Cached context bundle for one generation thread. The full pipeline builds this
 * once on the first draft; regenerations reuse it so they skip the expensive
 * voice-context assembly (brain + Supermemory + story-bank reads) and, up to a
 * threshold, the full multi-call pipeline. See db/generation-context.sql.
 */
export interface GenerationContextBundle {
  id: string;
  userPrompt: string;
  contextAdditions?: string;
  profile: CreatorProfileForPrompt | null;
  vocabulary?: VocabularyFingerprint;
  structural?: StructuralPatterns;
  mentions?: string[];
  platform?: string;
  contentType?: string;
  lastDraft?: string;
  regenCount: number;
}

/** Number of light-path regenerations allowed before a full-pipeline reload. */
export const REGEN_LIGHT_LIMIT = 3;

interface SaveInput {
  userId: string;
  workspaceId?: string | null;
  userPrompt: string;
  contextAdditions?: string;
  profile: CreatorProfileForPrompt | null;
  vocabulary?: VocabularyFingerprint;
  structural?: StructuralPatterns;
  mentions?: string[];
  platform?: string;
  contentType?: string;
  lastDraft?: string;
}

/**
 * Persists a fresh context bundle (regen_count = 0) and returns its id, or null
 * on any failure. Best-effort: caching is an optimization, never a hard
 * dependency of generation, so a write failure must not fail the draft.
 */
export async function saveGenerationContext(
  client: InsforgeClient,
  input: SaveInput,
): Promise<string | null> {
  try {
    const { data, error } = await client.database
      .from('generation_context')
      .insert([
        {
          user_id: input.userId,
          workspace_id: input.workspaceId ?? null,
          platform: input.platform ?? null,
          content_type: input.contentType ?? 'post',
          user_prompt: input.userPrompt,
          context_additions: input.contextAdditions ?? null,
          profile_snapshot: input.profile ?? null,
          vocabulary: input.vocabulary ?? null,
          structural: input.structural ?? null,
          mentions: input.mentions ?? null,
          last_draft: input.lastDraft ?? null,
          regen_count: 0,
        },
      ])
      .select('id')
      .maybeSingle();
    if (error || !data) return null;
    return (data as { id: string }).id;
  } catch {
    return null;
  }
}

/** Loads a bundle by id, scoped to the owner. Returns null if absent/failed. */
export async function loadGenerationContext(
  client: InsforgeClient,
  id: string,
  userId: string,
): Promise<GenerationContextBundle | null> {
  try {
    const { data, error } = await client.database
      .from('generation_context')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    return {
      id: row.id as string,
      userPrompt: (row.user_prompt as string) ?? '',
      contextAdditions: (row.context_additions as string) ?? undefined,
      profile: (row.profile_snapshot as CreatorProfileForPrompt | null) ?? null,
      vocabulary: (row.vocabulary as VocabularyFingerprint) ?? undefined,
      structural: (row.structural as StructuralPatterns) ?? undefined,
      mentions: (row.mentions as string[]) ?? undefined,
      platform: (row.platform as string) ?? undefined,
      contentType: (row.content_type as string) ?? undefined,
      lastDraft: (row.last_draft as string) ?? undefined,
      regenCount: Number(row.regen_count ?? 0),
    };
  } catch {
    return null;
  }
}

/**
 * Records a regeneration: stores the new draft and either increments the count
 * (light path) or resets it to 0 (full-pipeline reload). Best-effort.
 */
export async function recordRegen(
  client: InsforgeClient,
  id: string,
  lastDraft: string,
  nextRegenCount: number,
): Promise<void> {
  try {
    await client.database
      .from('generation_context')
      .update({ last_draft: lastDraft, regen_count: nextRegenCount })
      .eq('id', id);
  } catch {
    // Best-effort; a failed count update at worst repeats a light regen.
  }
}
