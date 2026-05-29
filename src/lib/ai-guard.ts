import { assertCanGenerate } from '@/lib/entitlements';
import { incrementUsage } from '@/lib/usage';

/**
 * Abuse + cost protection for AI-invoking endpoints. Two layers:
 *  1. Per-instance burst limit (short window) to blunt rapid hammering.
 *  2. Monthly plan cap (DB-backed via usage_counters + entitlements) which is
 *     the real, durable cost ceiling and works across serverless instances.
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

  incrementUsage(userId, 'ai_generate', 1).catch(() => {});
  return { ok: true };
}
