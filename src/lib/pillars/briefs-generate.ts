import type { createClient } from '@insforge/sdk';
import { chatCompletion } from '@/lib/llm';
import { checkAndIncrementUsage } from '@/lib/ai-budget';
import { isBuiltInPillar } from '@/lib/pillars/briefs';

type InsforgeClient = ReturnType<typeof createClient>;

/**
 * Server-only pillar-brief generation + backfill. Kept apart from briefs.ts so
 * the pure resolver stays client-safe (this file pulls in the LLM stack).
 */

/**
 * Generates a short "how to write for this pillar" brief in the same shape as
 * the built-in briefs, so a custom/emergent pillar steers generation as much as
 * a built-in one. Budget-gated, best-effort - returns null on any block/error
 * so pillar creation never depends on it.
 */
export async function generatePillarBrief(
  client: InsforgeClient,
  workspaceId: string,
  name: string,
  description?: string | null,
): Promise<string | null> {
  const budget = await checkAndIncrementUsage(client, workspaceId, 'haiku');
  if (budget === 'blocked') return null;

  const system = [
    'You write a concise GENERATION BRIEF telling an AI how to write a social post for one content pillar.',
    "2-3 sentences, imperative voice, in the creator's voice. Cover: how to open, what substance to include,",
    'and how to close. End with "No em dashes." Output ONLY the brief, no preamble, no quotes.',
  ].join(' ');
  const user = `Pillar: ${name}${description ? `\nWhat it means: ${description}` : ''}`;

  try {
    const raw = (await chatCompletion(system, user, { role: 'small', maxTokens: 200, temperature: 0.3 })).trim();
    if (!raw || raw.length < 20) return null;
    return raw.slice(0, 800);
  } catch {
    return null;
  }
}

interface PillarConfigRow {
  name?: string;
  description?: string;
  promptTemplate?: string;
  weight?: number;
  color?: string;
}

/** Cap on briefs generated per backfill call, so a generation never fans out. */
const MAX_BACKFILL_PER_CALL = 2;

/**
 * Fire-and-forget backfill: gives custom pillars that predate briefs a stored
 * promptTemplate, a couple at a time, so over a few generations every pillar
 * carries a real brief. Built-ins are skipped (they resolve from the bundled
 * map). Idempotent and best-effort - never throws into the caller.
 */
export async function ensurePillarBriefs(
  client: InsforgeClient,
  userId: string,
  workspaceId: string,
): Promise<void> {
  try {
    const { data } = await client.database
      .from('creator_profile')
      .select('content_pillars')
      .eq('user_id', userId)
      .limit(1);
    const row = data?.[0] as { content_pillars?: PillarConfigRow[] } | undefined;
    const pillars = Array.isArray(row?.content_pillars) ? row!.content_pillars : [];

    const needing = pillars.filter(
      (p) => p?.name && !p.promptTemplate?.trim() && !isBuiltInPillar(p.name),
    );
    if (needing.length === 0) return;

    let changed = false;
    for (const p of needing.slice(0, MAX_BACKFILL_PER_CALL)) {
      const brief = await generatePillarBrief(client, workspaceId, p.name!, p.description);
      if (brief) {
        p.promptTemplate = brief;
        changed = true;
      }
    }
    if (changed) {
      await client.database
        .from('creator_profile')
        .update({ content_pillars: pillars, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
    }
  } catch {
    /* best-effort backfill; a failure never affects generation */
  }
}
