import type { createClient } from '@insforge/sdk';
import { chatCompletion } from '@/lib/llm';
import { checkAndIncrementUsage } from '@/lib/ai-budget';
import { normalizePillarSlug } from '@/lib/pillars';
import { generatePillarBrief } from '@/lib/pillars/briefs-generate';

type InsforgeClient = ReturnType<typeof createClient>;

/** How many pillars a profile may accumulate from emergent classification. */
export const MAX_PROFILE_PILLARS = 12;

export interface PillarClassification {
  /** Display name of the chosen pillar (an existing one, or a new emergent one). */
  pillar: string;
  /** True when this pillar is not among the profile's existing pillars. */
  isNew: boolean;
}

interface ExistingPillar {
  name: string;
}

function firstOrGeneral(existing: ExistingPillar[]): PillarClassification {
  return { pillar: existing[0]?.name || 'general', isNew: false };
}

/**
 * Classifies a post's content into a pillar, OBSERVING the post text instead of
 * stamping the profile's first pillar on everything. Given the creator's
 * existing pillars, the model picks the best fit; if the post is about
 * something outside them, it proposes a concise new pillar so the taxonomy
 * grows from what the creator actually writes.
 *
 * Budget-gated (haiku tier) and fully best-effort: any block, error, or empty
 * result falls back to the first existing pillar (or 'general'), so a post save
 * is never broken by classification.
 */
export async function classifyPostPillar(
  client: InsforgeClient,
  workspaceId: string,
  text: string,
  existing: ExistingPillar[],
): Promise<PillarClassification> {
  const content = text?.trim();
  if (!content) return firstOrGeneral(existing);

  const budget = await checkAndIncrementUsage(client, workspaceId, 'haiku');
  if (budget === 'blocked') return firstOrGeneral(existing);

  const existingNames = existing.map((p) => p.name).filter(Boolean);
  const system = [
    'You tag a social post with ONE content pillar (its core recurring theme).',
    existingNames.length
      ? `The creator's existing pillars are: ${existingNames.join(', ')}.`
      : 'The creator has no pillars yet.',
    'If the post clearly fits an existing pillar, return that exact pillar name.',
    'If it is about a distinctly different recurring theme, propose a NEW concise',
    'pillar of 1-3 words (Title Case, no punctuation).',
    'Reply with ONLY JSON: {"pillar": string, "is_new": boolean}. No prose.',
  ].join(' ');

  let raw: string;
  try {
    raw = await chatCompletion(system, `Post:\n${content.slice(0, 1500)}`, {
      role: 'small',
      maxTokens: 60,
      temperature: 0.1,
    });
  } catch {
    return firstOrGeneral(existing);
  }

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return firstOrGeneral(existing);

  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { pillar?: unknown; is_new?: unknown };
    const name = typeof parsed.pillar === 'string' ? parsed.pillar.trim() : '';
    if (!name || name.length > 40) return firstOrGeneral(existing);

    // Trust the slug match over the model's is_new flag: if the returned name
    // canonicalizes to an existing pillar, it is not new (avoids near-duplicates
    // like "AI" vs "A.I." spawning a second pillar).
    const slug = normalizePillarSlug(name);
    const match = existing.find((p) => normalizePillarSlug(p.name) === slug);
    if (match) return { pillar: match.name, isNew: false };
    return { pillar: name, isNew: true };
  } catch {
    return firstOrGeneral(existing);
  }
}

/**
 * Appends an emergent pillar to the creator profile so the pillar set reflects
 * what the creator actually posts. Additive and capped (never deletes, never
 * exceeds MAX_PROFILE_PILLARS); a no-op when the pillar already exists or the
 * cap is reached. Best-effort - a failure here must not break the post save.
 */
export async function appendEmergentPillar(
  client: InsforgeClient,
  userId: string,
  pillarName: string,
  workspaceId?: string,
): Promise<void> {
  try {
    // Explicit column (InsForge select('*') + .eq() quirk).
    const { data } = await client.database
      .from('creator_profile')
      .select('content_pillars')
      .eq('user_id', userId)
      .limit(1);
    const row = data?.[0] as { content_pillars?: Array<{ name?: string }> } | undefined;
    if (!row) return;

    const pillars = Array.isArray(row.content_pillars) ? row.content_pillars : [];
    if (pillars.length >= MAX_PROFILE_PILLARS) return;
    const slug = normalizePillarSlug(pillarName);
    if (pillars.some((p) => normalizePillarSlug(p.name ?? '') === slug)) return;

    // Give the new pillar a generation brief up front so it steers drafting as
    // much as a built-in pillar (best-effort; null just means no bespoke steer).
    const promptTemplate = workspaceId
      ? await generatePillarBrief(client, workspaceId, pillarName)
      : null;

    const next = [
      ...pillars,
      { name: pillarName, weight: 50, ...(promptTemplate ? { promptTemplate } : {}) },
    ];
    await client.database
      .from('creator_profile')
      .update({ content_pillars: next, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
  } catch {
    /* best-effort: emergent pillar growth never blocks a save */
  }
}
