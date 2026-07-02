/** A reload window request from the UI: a named preset or an explicit custom range. */
export interface WindowRequest {
  preset: 'last_week' | 'last_month' | 'last_year' | 'next_week' | 'next_month' | 'next_year' | 'custom';
  from?: string;
  to?: string;
}

/** Resolved absolute window passed to the resync endpoint. */
export interface ResolvedWindow {
  timeMin: Date;
  timeMax: Date;
}

/** UI-facing labelled preset list (order is the render order). */
export const RELOAD_PRESETS: Array<{ id: WindowRequest['preset']; label: string }> = [
  { id: 'last_week', label: 'Last week' },
  { id: 'last_month', label: 'Last month' },
  { id: 'last_year', label: 'Last year' },
  { id: 'next_week', label: 'Next week' },
  { id: 'next_month', label: 'Next month' },
  { id: 'next_year', label: 'Next year' },
  { id: 'custom', label: 'Custom range' },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const PAST_DAYS: Partial<Record<WindowRequest['preset'], number>> = { last_week: 7, last_month: 30, last_year: 365 };
const FUTURE_DAYS: Partial<Record<WindowRequest['preset'], number>> = { next_week: 7, next_month: 30, next_year: 365 };

/**
 * Converts a UI window request into an absolute {timeMin, timeMax}. Past presets
 * span [now - Nd, now]; future presets span [now, now + Nd]; custom uses the
 * caller-supplied ISO dates. Throws on a custom request missing from/to so the
 * endpoint can return a 400 rather than silently mis-fetching.
 */
export function resolveWindow(req: WindowRequest, now: Date): ResolvedWindow {
  if (req.preset === 'custom') {
    if (!req.from || !req.to) throw new Error('custom window requires from and to');
    return { timeMin: new Date(req.from), timeMax: new Date(req.to) };
  }
  const past = PAST_DAYS[req.preset];
  if (past !== undefined) return { timeMin: new Date(now.getTime() - past * DAY_MS), timeMax: now };
  const future = FUTURE_DAYS[req.preset];
  if (future !== undefined) return { timeMin: now, timeMax: new Date(now.getTime() + future * DAY_MS) };
  throw new Error(`unknown preset: ${req.preset}`);
}
