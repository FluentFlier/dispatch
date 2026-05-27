import { checkUsageLimit, incrementUsage, type UsageMetric } from '@/lib/usage';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const memoryStore = new Map<string, RateLimitEntry>();
const DEFAULT_LIMIT = 50;
const DEFAULT_WINDOW_MS = 60 * 60 * 1000;

function memoryCheck(
  userId: string,
  limit: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const existing = memoryStore.get(userId);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowMs;
    memoryStore.set(userId, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }

  if (existing.count < limit) {
    existing.count += 1;
    return {
      allowed: true,
      remaining: limit - existing.count,
      resetAt: existing.resetAt,
    };
  }

  return { allowed: false, remaining: 0, resetAt: existing.resetAt };
}

/**
 * DB-backed rate limit for AI generation. Falls back to in-memory if DB unavailable.
 */
export async function checkRateLimit(
  userId: string,
  limit: number = DEFAULT_LIMIT,
  windowMs: number = DEFAULT_WINDOW_MS
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  try {
    const { allowed, remaining } = await checkUsageLimit(userId, 'ai_generate', limit);
    const resetAt = Date.now() + windowMs;
    return { allowed, remaining, resetAt };
  } catch {
    return memoryCheck(userId, limit, windowMs);
  }
}

export async function recordRateLimitHit(userId: string): Promise<void> {
  try {
    await incrementUsage(userId, 'ai_generate', 1);
  } catch {
    memoryCheck(userId, DEFAULT_LIMIT, DEFAULT_WINDOW_MS);
  }
}

export { type UsageMetric };
