import { assertCanGenerate } from '@/lib/entitlements';
import { incrementUsage } from '@/lib/usage';

/**
 * Abuse + cost protection for AI-invoking endpoints. Two layers:
 *  1. Per-instance in-memory burst limit (15 req/60s). IMPORTANT: this Map is
 *     reset on every cold start and is NOT shared across serverless instances —
 *     a user can bypass it by hitting different function instances or waiting for
 *     a new cold start. It blunts rapid hammering on a single instance only.
 *     Replace with Upstash Redis sliding window for true cross-instance enforcement.
 *  2. Monthly plan cap (DB-backed via usage_counters + entitlements) which IS
 *     the real, durable cost ceiling and works across all instances.
 * On success it records one ai_generate unit. Infra errors fail open (only the
 * burst limit applies) so a transient DB blip never takes generation down.
 */

const burstStore = new Map<string, { count: number; resetAt: number }>();
const BURST_LIMIT = 15;
const BURST_WINDOW_MS = 60_000;

function burstAllowed(userId: string): boolean {
  const now = Date.now();
  const entry = burstStore.get(userId);
  if (!entry || entry.resetAt <= now) {
    burstStore.set(userId, { count: 1, resetAt: now + BURST_WINDOW_MS });
    // opportunistic cleanup so the map cannot grow unbounded
    if (burstStore.size > 5000) {
      burstStore.forEach((v, k) => {
        if (v.resetAt <= now) burstStore.delete(k);
      });
    }
    return true;
  }
  if (entry.count < BURST_LIMIT) {
    entry.count += 1;
    return true;
  }
  return false;
}

export type AiGuardResult = { ok: true } | { ok: false; status: number; error: string };

export async function guardAiRequest(userId: string): Promise<AiGuardResult> {
  if (!burstAllowed(userId)) {
    return { ok: false, status: 429, error: 'Too many requests. Please slow down and try again shortly.' };
  }

  try {
    const cap = await assertCanGenerate(userId);
    if (!cap.ok) {
      return { ok: false, status: 402, error: cap.error ?? 'AI generation limit reached.' };
    }
  } catch {
    // entitlement lookup failed (infra): fall through, burst limit still applied
  }

  // Await the increment so failures are observable. We still return ok:true on
  // DB errors (fail-open policy) but we log the failure so ops can detect
  // systematic issues — silently swallowing meant quotas never tracked under load.
  try {
    await incrementUsage(userId, 'ai_generate', 1);
  } catch (err) {
    console.error('[ai-guard] Usage increment failed — quota not tracked:', err);
  }
  return { ok: true };
}
