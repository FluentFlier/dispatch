/**
 * Dynamic per-user niche resolution (spec 2.2).
 * On profile create/update: LLM classifies the profile into a niche label +
 * seed keywords, we embed the label, and cosine-match it against existing niche
 * embeddings. >= 0.85 merges into the existing niche; 0.75-0.85 merges but logs
 * for monthly review; < 0.75 creates a new pending niche and enqueues mining.
 * Anti-explosion: max 50 active niches; a new niche earns its own mining budget
 * only at >= 2 active users OR a paying user after 14 days - until then it
 * inherits retrieval from its nearest existing niche.
 *
 * Classification uses chatCompletion (env-routed, NOT a hardcoded provider);
 * embeddings use the OpenAI-locked helper.
 */
import type { createClient } from '@insforge/sdk';
import { chatCompletion } from '@/lib/llm';
import { resolveModel } from '@/lib/ai-tiers';
import { embedText, toPgVector } from '@/lib/embeddings';
import { parseLlmJson } from '@/lib/llm-json';

type InsforgeClient = ReturnType<typeof createClient>;

// CALIBRATE these on ~20 hand-picked pairs before trusting them: OpenAI
// embeddings cluster high, so if unrelated niches (fitness vs automotive) score
// > 0.8, raise NICHE_MERGE_THRESHOLD (spec 2.2.3).
export const NICHE_MERGE_THRESHOLD = 0.85;
export const NICHE_REVIEW_THRESHOLD = 0.75;
export const MAX_ACTIVE_NICHES = 50;

export interface NicheRow {
  id: string;
  slug: string;
  label: string;
  embedding: number[] | null;
  status: string;
  active_user_count: number;
}

export interface NicheClassification {
  label: string;
  seed_keywords: string[];
  confidence: number;
}

/** Cosine similarity of two equal-length vectors. */
export function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

/** URL-safe slug: lowercase, punctuation to hyphens, trimmed, no trailing sep. */
export function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Nearest-neighbour decision against existing niche embeddings.
 * `nearest` is the best-similarity row regardless of action, so the
 * MAX_ACTIVE_NICHES cap can fall back to it when action is 'create'.
 */
export function decideAssignment(
  embedding: number[],
  existing: NicheRow[],
): { action: 'assign' | 'assign-review' | 'create'; niche?: NicheRow; nearest?: NicheRow; bestSim: number } {
  let best: NicheRow | undefined;
  let bestSim = -1;
  for (const row of existing) {
    if (!row.embedding) continue;
    const sim = cosineSim(embedding, row.embedding);
    if (sim > bestSim) {
      bestSim = sim;
      best = row;
    }
  }
  if (best && bestSim >= NICHE_MERGE_THRESHOLD) return { action: 'assign', niche: best, nearest: best, bestSim };
  if (best && bestSim >= NICHE_REVIEW_THRESHOLD) return { action: 'assign-review', niche: best, nearest: best, bestSim };
  return { action: 'create', nearest: best, bestSim: bestSim < 0 ? 0 : bestSim };
}

/** Whether a niche earns its own mining budget yet (spec 2.2.4). */
export function earnsBudget(input: { active_user_count: number; isPaying: boolean; ageDays: number }): boolean {
  if (input.active_user_count >= 2) return true;
  return input.isPaying && input.ageDays >= 14;
}

const CLASSIFY_SYSTEM =
  'You classify a creator profile into ONE marketing niche. Return ONLY JSON: ' +
  '{"label": string, "seed_keywords": string[5-10], "confidence": number 0-1}. ' +
  'label is a short human niche name (e.g. "automotive detailing", "fitness coaching"). ' +
  'seed_keywords are LinkedIn search terms real posts in this niche would contain. ' +
  'No prose, no markdown, no code fences.';

/** LLM classification of a profile into a niche (env-routed cheap tier). */
export async function classifyProfileNiche(profile: {
  display_name?: string | null;
  content_pillars?: unknown;
  voice_description?: string | null;
  bio?: string | null;
}): Promise<NicheClassification> {
  const userMsg = JSON.stringify({
    display_name: profile.display_name ?? '',
    pillars: profile.content_pillars ?? '',
    voice: profile.voice_description ?? '',
    bio: profile.bio ?? '',
  });
  const raw = await chatCompletion(CLASSIFY_SYSTEM, userMsg, {
    model: resolveModel('fast'),
    temperature: 0,
    responseFormat: 'json',
    maxTokens: 300,
  });
  const parsed = parseLlmJson<Partial<NicheClassification>>(raw) ?? {};
  return {
    label: (parsed.label ?? 'general').trim(),
    seed_keywords: Array.isArray(parsed.seed_keywords) ? parsed.seed_keywords.slice(0, 10) : [],
    confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
  };
}

/**
 * Resolves (and persists) a niche for a profile. Assigns to an existing niche or
 * creates a new pending one, writes creator_profile.niche_id + confidence, and
 * bumps active_user_count. A new niche is left in status 'pending' with
 * last_mined_at NULL - the weekly cron (Task 8) mines it once it earns budget;
 * until then retrieval inherits the nearest niche's hooks (Task 7).
 */
export async function resolveNicheForProfile(
  client: InsforgeClient,
  profile: {
    user_id: string;
    display_name?: string | null;
    content_pillars?: unknown;
    voice_description?: string | null;
    bio?: string | null;
  },
): Promise<{ nicheId: string; created: boolean; action: string }> {
  const cls = await classifyProfileNiche(profile);
  const embedding = await embedText(cls.label);

  const { data: existingRaw, error: nichesError } = await client.database
    .from('niches')
    .select('id, slug, label, embedding, status, active_user_count')
    .neq('status', 'merged');
  if (nichesError) {
    console.warn('[niche-resolver] niches read failed, treating as empty', nichesError);
  }
  const existing = (existingRaw ?? []) as unknown as NicheRow[];

  const decision = decideAssignment(embedding, existing);
  const activeCount = existing.filter((n) => n.status === 'active').length;
  // Cap hit: attach to nearest rather than exploding the taxonomy.
  const capped = decision.action === 'create' && activeCount >= MAX_ACTIVE_NICHES && !!decision.nearest;
  const assignTo = decision.action !== 'create' ? decision.niche : capped ? decision.nearest : undefined;

  let nicheId: string;
  let created = false;
  let action: string = capped ? 'assign-capped' : decision.action;

  if (assignTo) {
    nicheId = assignTo.id;
    await client.database
      .from('niches')
      .update({ active_user_count: assignTo.active_user_count + 1 })
      .eq('id', nicheId);
  } else {
    const slug = slugify(cls.label) || `niche-${Date.now()}`;
    const { data: ins } = await client.database
      .from('niches')
      .insert({
        slug,
        label: cls.label,
        embedding: toPgVector(embedding),
        status: 'pending',
        seed_keywords: cls.seed_keywords,
        active_user_count: 1,
      })
      .select('id')
      .single();
    nicheId = (ins as { id: string }).id;
    created = true;
  }

  await client.database
    .from('creator_profile')
    .update({ niche_id: nicheId, niche_confidence: cls.confidence })
    .eq('user_id', profile.user_id);

  if (decision.action === 'assign-review') {
    console.warn('[niche-resolver] borderline assignment for monthly review', {
      user: profile.user_id, nicheId, sim: decision.bestSim, label: cls.label,
    });
  }
  return { nicheId, created, action };
}
