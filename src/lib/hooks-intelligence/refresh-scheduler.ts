/**
 * Pure scheduling helpers for the weekly hooks-refresh cron. Split out of
 * the route file because Next.js route.ts files may only export route
 * handlers/config - any other export fails the generated route-shape check
 * (`npx tsc --noEmit` -> TS2344 on .next/types/.../route.ts).
 */
export interface RefreshNiche {
  id: string; label: string; seed_keywords: string[];
  status: string; active_user_count: number; last_mined_at: string | null;
}

const WEEK_MS = 7 * 86400000;

/** Active, in-use niches never mined or stale beyond 7 days. */
export function selectDueNiches(niches: RefreshNiche[], now: number): RefreshNiche[] {
  return niches.filter((n) =>
    n.status === 'active' &&
    n.active_user_count > 0 &&
    (n.last_mined_at === null || now - new Date(n.last_mined_at).getTime() >= WEEK_MS),
  );
}

/** True while there is budget left to mine another niche. */
export function budgetGate(spentUsd: number, capUsd: number): boolean {
  return spentUsd < capUsd;
}
