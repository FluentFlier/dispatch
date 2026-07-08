/**
 * Human-mimicking pacing for LinkedIn/Unipile actions.
 *
 * Unipile guidance (provider-limits-and-restrictions):
 * - Space out calls with random intervals; never chain at fixed cadence.
 * - Distribute activity across working hours.
 * - Default ~100 actions/day/account for unlisted routes (comments, follows, reactions).
 * - Minimum ~120s between consecutive actions on the same account.
 *
 * @see https://developer.unipile.com/docs/provider-limits-and-restrictions
 */
import {
  computeRequiredCooldownMs,
  isWithinWorkingHours,
  UNIPILE_SAFETY_REFERENCE,
  type SignalSafetySettings,
} from '@/lib/signals/safety/limits';

/**
 * Random pause between two chained Unipile calls in a single request handler
 * (e.g. profile lookup → invite/follow) so they do not fire back-to-back like a
 * bot. Kept short (a few seconds) because this runs inline in a serverless
 * request: the long, ban-avoiding gap between separate actions is enforced
 * across requests by the safety guard cooldown and by the async engagement worker.
 */
export const INTER_CALL_DELAY_MS = {
  min: 3_000,
  max: 8_000,
} as const;

/**
 * When true (test runner, or explicitly opted out), real timer sleeps are
 * skipped so suites don't hang on human-pacing delays. Pacing logic (schedule
 * math, cooldown computation) is still exercised — only wall-clock waits are no-ops.
 */
const HUMANIZE_DELAYS_DISABLED =
  process.env.NODE_ENV === 'test' ||
  Boolean(process.env.VITEST) ||
  process.env.DISABLE_HUMANIZE_DELAYS === '1';

/** Default random delay before a queued comment/reaction is due (minutes). */
export const ENGAGEMENT_SCHEDULE_MINUTES = {
  min: 12,
  max: 55,
} as const;

export function randomMs(min: number, max: number, randomFn: () => number = Math.random): number {
  if (max <= min) return min;
  return Math.floor(min + randomFn() * (max - min));
}

export async function sleepMs(ms: number): Promise<void> {
  if (ms <= 0 || HUMANIZE_DELAYS_DISABLED) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pause between two Unipile calls in the same HTTP handler so profile lookup
 * and follow/send do not fire back-to-back like a bot.
 */
export async function awaitInterCallDelay(randomFn: () => number = Math.random): Promise<void> {
  await sleepMs(randomMs(INTER_CALL_DELAY_MS.min, INTER_CALL_DELAY_MS.max, randomFn));
}

/**
 * Full human-like gap between separate outbound actions on the same account.
 * Uses workspace min_seconds_between_sends + random jitter (Unipile recommends ≥120s).
 */
export async function awaitEngagementGap(
  settings: SignalSafetySettings,
  randomFn: () => number = Math.random,
): Promise<void> {
  const ms = Math.max(
    computeRequiredCooldownMs(settings, randomFn),
    UNIPILE_SAFETY_REFERENCE.minSecondsBetweenActions * 1000,
  );
  await sleepMs(ms);
}

/**
 * Pick a pseudo-random future time for a queued engagement task. Adds a random
 * delay (default 12–55 min) and, when working_hours_only is on, shifts the slot
 * into the next in-window period with a random minute offset so posts do not
 * land at robotic fixed times.
 */
export function scheduleHumanizedEngagementAt(
  settings: SignalSafetySettings,
  opts: {
    now?: Date;
    minDelayMinutes?: number;
    maxDelayMinutes?: number;
    randomFn?: () => number;
  } = {},
): Date {
  const now = opts.now ?? new Date();
  const randomFn = opts.randomFn ?? Math.random;
  const minM = opts.minDelayMinutes ?? ENGAGEMENT_SCHEDULE_MINUTES.min;
  const maxM = opts.maxDelayMinutes ?? ENGAGEMENT_SCHEDULE_MINUTES.max;
  const delayMs = randomMs(minM * 60_000, maxM * 60_000, randomFn);
  let at = new Date(now.getTime() + delayMs);

  if (!settings.working_hours_only) return at;

  for (let attempt = 0; attempt < 14; attempt++) {
    if (isWithinWorkingHours(settings, at)) return at;
    at = nextWorkingHoursSlot(settings, at, randomFn);
  }

  return at;
}

function nextWorkingHoursSlot(
  settings: SignalSafetySettings,
  from: Date,
  randomFn: () => number,
): Date {
  const startHour = settings.working_hours_utc_start;
  const endHour = settings.working_hours_utc_end;
  const slot = new Date(from);

  if (slot.getUTCHours() >= endHour || !isWithinWorkingHours(settings, slot)) {
    slot.setUTCDate(slot.getUTCDate() + 1);
  }

  slot.setUTCHours(startHour, randomMs(8, 110, randomFn), randomMs(0, 59, randomFn), 0);
  return slot;
}

export function formatScheduledLocal(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
