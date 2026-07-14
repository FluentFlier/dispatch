/**
 * Reliability utilities for third-party social API calls (Unipile et al).
 *
 * Exponential-backoff retries that only fire on transient statuses,
 * human-mimicking random delays, per-account daily action caps (LinkedIn
 * restricts accounts that hammer the API), and a deterministic "random
 * minute of the day" scheduler so daily jobs don't run at robotic times.
 */

// --- HTTP status errors ---

/**
 * Error carrying the HTTP status that caused it, so retry logic can decide
 * whether the failure is transient (429/5xx) or permanent (4xx).
 */
export class HttpStatusError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpStatusError';
    this.status = status;
  }
}

/**
 * Throws HttpStatusError for non-2xx responses so callers can wrap fetches
 * in retryWithBackoff without hand-rolling status checks each time.
 * Reads (and truncates) the body for a useful error message.
 */
export async function throwIfNotOk(res: Response, context: string): Promise<Response> {
  if (res.ok) return res;
  const body = await res.text().catch(() => '');
  throw new HttpStatusError(res.status, `${context} failed (${res.status}): ${body.slice(0, 200)}`);
}

// --- Retry with exponential backoff ---

export interface RetryOptions {
  /** Max retry attempts after the initial try (default 3). */
  maxRetries?: number;
  /** First backoff delay in ms (default 1000). */
  initialDelayMs?: number;
  /** Backoff ceiling in ms (default 10000). */
  maxDelayMs?: number;
  /** Override which errors are worth retrying (default: 429/5xx statuses). */
  shouldRetry?: (error: unknown) => boolean;
  /** Injectable sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Retries only transient failures: rate limits (429) and server errors (5xx).
 * Permanent client errors (400/401/404...) fail fast - retrying them just
 * burns quota against providers that count every request.
 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof HttpStatusError) {
    return error.status === 429 || error.status >= 500;
  }
  // Network-level failures (fetch TypeError, socket resets) are transient.
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /\b(429|rate limit|50[0-4])\b/i.test(message);
}

/**
 * Runs an async operation with exponential backoff and jitter.
 * WHY jitter: many callers retrying on the same schedule re-stampede the
 * provider at the exact same instant; 0-20% noise de-synchronizes them.
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelayMs = 1000,
    maxDelayMs = 10000,
    shouldRetry = isTransientError,
    sleep = defaultSleep,
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries || !shouldRetry(error)) throw error;
      const base = Math.min(initialDelayMs * 2 ** attempt, maxDelayMs);
      const jitter = base * 0.2 * Math.random();
      await sleep(base + jitter);
    }
  }
  throw lastError;
}

// --- Human-mimicking delays ---

/**
 * Random delay bounds recommended by Unipile to mimic human pacing between
 * consecutive LinkedIn API actions.
 */
export function getRandomDelayMs(minMs = 150, maxMs = 300): number {
  return Math.floor(minMs + Math.random() * (maxMs - minMs));
}

/** Sleeps a random duration between minMs and maxMs. */
export async function randomDelay(minMs = 150, maxMs = 300): Promise<void> {
  await defaultSleep(getRandomDelayMs(minMs, maxMs));
}

// --- Daily usage tracking (per external account) ---

interface UsageEntry {
  date: string;
  count: number;
}

/**
 * In-memory per-account daily counters. Resets at midnight UTC (date-keyed)
 * and on server restart - acceptable because this is a safety guard against
 * runaway loops, not a billing-grade quota.
 */
const usageByAccount = new Map<string, UsageEntry>();

/** Default cap on daily Unipile actions per connected account. */
export const DEFAULT_MAX_ACTIONS_PER_DAY = 100;

function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export interface DailyUsageCheck {
  allowed: boolean;
  currentCount: number;
  remainingToday: number;
}

/**
 * Checks whether an account can spend `requestedActions` more API actions
 * today without crossing the daily cap. Does NOT increment - call
 * incrementDailyUsage after the actions actually happen.
 */
export function checkDailyUsage(
  accountId: string,
  requestedActions: number,
  maxPerDay: number = DEFAULT_MAX_ACTIONS_PER_DAY,
  now: Date = new Date(),
): DailyUsageCheck {
  const entry = usageByAccount.get(accountId);
  const current = entry && entry.date === todayUtc(now) ? entry.count : 0;
  return {
    allowed: current + requestedActions <= maxPerDay,
    currentCount: current,
    remainingToday: Math.max(0, maxPerDay - current),
  };
}

/** Records spent actions for an account for today (UTC). */
export function incrementDailyUsage(
  accountId: string,
  actions: number,
  now: Date = new Date(),
): void {
  const date = todayUtc(now);
  const entry = usageByAccount.get(accountId);
  if (entry && entry.date === date) {
    entry.count += actions;
  } else {
    usageByAccount.set(accountId, { date, count: actions });
  }
}

/** Testing helper: wipes all in-memory usage counters. */
export function clearDailyUsage(): void {
  usageByAccount.clear();
}

// --- Deterministic daily random scheduling ---

/**
 * FNV-1a 32-bit hash. Tiny deterministic string hash - enough entropy for
 * picking a pseudo-random minute without pulling in a PRNG dependency.
 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Picks a deterministic pseudo-random minute of the day (0-1439) for a given
 * seed + date. Every cron tick asks "is it my minute yet?" - the job then runs
 * exactly once per day at a time that varies day-to-day, so automated LinkedIn
 * activity doesn't fire at a robotically fixed time.
 */
export function dailyRandomMinute(seed: string, now: Date = new Date()): number {
  return fnv1a(`${todayUtc(now)}-${seed}`) % 1440;
}

/** True when the current UTC minute is the seed's chosen minute for today. */
export function isDailyRandomMinuteNow(seed: string, now: Date = new Date()): boolean {
  const currentMinute = now.getUTCHours() * 60 + now.getUTCMinutes();
  return currentMinute === dailyRandomMinute(seed, now);
}
