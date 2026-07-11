/**
 * Pure scheduling helpers for the weekly hooks-refresh cron. Split out of
 * the route file because Next.js route.ts files may only export route
 * handlers/config - any other export fails the generated route-shape check
 * (`npx tsc --noEmit` -> TS2344 on .next/types/.../route.ts).
 */
import { earnsBudget } from './niche-resolver';

export interface RefreshNiche {
  id: string; label: string; seed_keywords: string[];
  status: string; active_user_count: number; last_mined_at: string | null;
  created_at: string;
}

const WEEK_MS = 7 * 86400000;
const DAY_MS = 86400000;

/**
 * Active, in-use niches never mined or stale beyond 7 days, PLUS pending
 * niches that have earned their first mining budget (B2 fix - pending niches
 * previously had zero production call sites into earnsBudget, so the feature
 * never activated). isPaying is hardcoded false until billing status is
 * plumbed through, so earnsBudget's paying+14d branch can't fire on its own -
 * the ageDays >= 14 free-grace check is therefore applied directly here too.
 * Net admission rule for pending: active_user_count >= 2 OR ageDays >= 14.
 */
export function selectDueNiches(niches: RefreshNiche[], now: number): RefreshNiche[] {
  return niches.filter((n) => {
    if (n.status === 'active') {
      return n.active_user_count > 0 &&
        (n.last_mined_at === null || now - new Date(n.last_mined_at).getTime() >= WEEK_MS);
    }
    if (n.status === 'pending') {
      const ageDays = (now - new Date(n.created_at).getTime()) / DAY_MS;
      return earnsBudget({ active_user_count: n.active_user_count, isPaying: false, ageDays }) || ageDays >= 14;
    }
    return false;
  });
}

/** True while there is budget left to mine another niche. */
export function budgetGate(spentUsd: number, capUsd: number): boolean {
  return spentUsd < capUsd;
}
