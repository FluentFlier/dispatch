/**
 * Phase 4 reward wiring (spec 4.1 / 2.4): binary Thompson-arm rewards from
 * real engagement. r = 1 iff the post beat the SAME user's trailing-median
 * engagement rate (controls for audience size; a 500-follower account and a
 * 50k-follower account compete only against themselves).
 *   alpha += r; beta += 1 - r        (post outcome, full weight)
 *   beta  += 0.5                     (heavy human edit, half-weight negative)
 * The existing hook_performance EMA keeps running in parallel for dashboard
 * continuity; hook_arms is the selection authority (Phase 2).
 *
 * HARD DEPENDENCY: Phase 2 tables (hook_arms, hook_examples.niche_id).
 * Writers throw on missing tables; callers catch, warn, and count skips so
 * the cron never dies on a missing migration.
 */
import type { createClient } from '@insforge/sdk';
import { updateArm as thompsonUpdateArm, type Arm } from './thompson';
import { onlyPublished } from '@/lib/posts/published';

type InsforgeClient = ReturnType<typeof createClient>;

export function medianOf(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = Array.from(nums).sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface EngagementCounts { saves: number; views: number; likes: number; comments: number }

/** MUST stay identical to the formula in intelligence-sync (one source now). */
export function engagementRateOf(p: EngagementCounts): number {
  return (p.saves + p.likes + p.comments) / Math.max(p.views, 1);
}

const MIN_PRIOR_POSTS = 3;   // below this a "median" is noise, skip arm updates
const TRAILING_WINDOW = 20;  // most recent processed posts considered

/**
 * Trailing-median engagement for one user over their already-RL-processed,
 * published, above-noise-floor posts. Returns null when history is too thin
 * (< MIN_PRIOR_POSTS): the caller then skips arm updates but still runs EMA
 * and still marks the post processed.
 */
export async function getTrailingMedianEngagement(
  client: InsforgeClient,
  userId: string,
): Promise<number | null> {
  // onlyPublished, not a bare status check: a hand-marked draft carries
  // status='posted' with no posted_date and would skew the RL baseline.
  const { data } = await onlyPublished(client.database
    .from('posts')
    .select('saves, views, likes, comments')
    .eq('user_id', userId))
    .gte('views', 100)
    .not('rl_processed_at', 'is', null)
    .order('created_at', { ascending: false })
    .limit(TRAILING_WINDOW);

  const rates = (data ?? []).map((p) =>
    engagementRateOf({
      saves: Number((p as { saves?: number }).saves) || 0,
      views: Number((p as { views?: number }).views) || 0,
      likes: Number((p as { likes?: number }).likes) || 0,
      comments: Number((p as { comments?: number }).comments) || 0,
    }),
  );
  if (rates.length < MIN_PRIOR_POSTS) return null;
  return medianOf(rates);
}

async function nicheIdForHook(client: InsforgeClient, hookId: string): Promise<string | null> {
  const { data } = await client.database
    .from('hook_examples')
    .select('niche_id')
    .eq('id', hookId)
    .maybeSingle();
  return (data as { niche_id?: string | null } | null)?.niche_id ?? null;
}

// ponytail: read-modify-write, not an atomic SQL increment. Fine at nightly
// cron scale (one writer). Upgrade path: raw-SQL "SET alpha = alpha + $1" if
// a second writer ever appears.
//
// Delta is expressed as an Arm -> Arm transform so callers compose with
// thompson.ts's updateArm (the reward-outcome case is literally that
// function) instead of re-deriving alpha/beta math here.
async function bumpArm(
  client: InsforgeClient,
  nicheId: string,
  hookId: string,
  apply: (arm: Arm) => Arm,
): Promise<void> {
  const { data: existing } = await client.database
    .from('hook_arms')
    .select('alpha, beta')
    .eq('niche_id', nicheId)
    .eq('hook_id', hookId)
    .maybeSingle();

  const prior: Arm = existing
    ? { alpha: Number((existing as Arm).alpha), beta: Number((existing as Arm).beta) }
    : { alpha: 1, beta: 1 }; // uninformative Beta(1,1) prior for a never-selected hook
  const next = apply(prior);

  if (!existing) {
    await client.database.from('hook_arms').insert({
      niche_id: nicheId,
      hook_id: hookId,
      alpha: next.alpha,
      beta: next.beta,
      pulls: 0,
      updated_at: new Date().toISOString(),
    });
    return;
  }
  await client.database
    .from('hook_arms')
    .update({
      alpha: next.alpha,
      beta: next.beta,
      updated_at: new Date().toISOString(),
    })
    .eq('niche_id', nicheId)
    .eq('hook_id', hookId);
}

/** Post outcome: alpha += r, beta += 1 - r per used hook. */
export async function updateArmsForHooks(
  client: InsforgeClient,
  hookIds: string[],
  reward: 0 | 1,
): Promise<{ updated: number; skipped: number }> {
  let updated = 0;
  let skipped = 0;
  for (const hookId of hookIds) {
    const nicheId = await nicheIdForHook(client, hookId);
    if (!nicheId) { skipped++; continue; } // static/bootstrap hook: EMA only
    await bumpArm(client, nicheId, hookId, (arm) => thompsonUpdateArm(arm, reward));
    updated++;
  }
  return { updated, skipped };
}

/** Heavy human edit: half-weight negative, beta += 0.5 per used hook. */
export async function applyEditPenaltyToArms(
  client: InsforgeClient,
  hookIds: string[],
): Promise<number> {
  let updated = 0;
  for (const hookId of hookIds) {
    const nicheId = await nicheIdForHook(client, hookId);
    if (!nicheId) continue;
    await bumpArm(client, nicheId, hookId, (arm) => ({ alpha: arm.alpha, beta: arm.beta + 0.5 }));
    updated++;
  }
  return updated;
}
