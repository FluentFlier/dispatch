import type { SeriesCadence } from './types';

const DAY_INDEX: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

/**
 * Expands a cadence into `count` ISO timestamps, one per part, walking forward
 * from start_date and emitting a slot on each eligible weekday of each eligible
 * week (interval_weeks controls the every-Nth-week gap).
 *
 * ponytail: time is combined as a naive local-clock 'YYYY-MM-DDTHH:MM:00' string
 * and turned into a Date server-side. Cadence.tz is stored for display only; if
 * precise per-user-timezone firing matters later, convert here using tz. The
 * publish cron compares scheduled_for to now() in UTC, so a deploy in a non-UTC
 * region would shift slots - acceptable for v1, revisit with a tz library.
 */
export function computeSchedule(cadence: SeriesCadence, count: number): string[] {
  const days = cadence.days
    .map((d) => DAY_INDEX[d.toLowerCase().slice(0, 3)])
    .filter((n): n is number => n !== undefined);
  const time = /^\d{1,2}:\d{2}$/.test(cadence.time) ? cadence.time : '09:00';
  const interval = Math.max(1, cadence.interval_weeks ?? 1);

  // Fallback: no valid weekdays -> post daily so a misconfigured cadence still lays out.
  const eligible = days.length > 0 ? new Set(days) : new Set([0, 1, 2, 3, 4, 5, 6]);

  const slots: string[] = [];
  const start = new Date(`${cadence.start_date}T${time}:00`);
  if (Number.isNaN(start.getTime())) return slots;

  // Week 0 = the week containing start_date; only weeks where weekNo % interval === 0 fire.
  const cursor = new Date(start);
  const maxIterations = 366 * Math.max(1, count); // hard bound against infinite loop
  let iterations = 0;

  while (slots.length < count && iterations < maxIterations) {
    const daysSinceStart = Math.floor((cursor.getTime() - start.getTime()) / 86_400_000);
    const weekNo = Math.floor(daysSinceStart / 7);
    if (cursor >= start && eligible.has(cursor.getDay()) && weekNo % interval === 0) {
      slots.push(cursor.toISOString());
    }
    cursor.setDate(cursor.getDate() + 1);
    iterations++;
  }
  return slots;
}
