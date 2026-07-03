// --- Types ---

/** Canonical event types used across all three stages of event capture. */
export type EventType =
  | 'conference'
  | 'meetup'
  | 'hackathon'
  | 'demo_day'
  | 'keynote'
  | 'panel'
  | 'workshop'
  | 'podcast'
  | 'pitch'
  | 'customer_call'
  | 'investor_call'
  | 'sales_call'
  | 'interview'
  | 'internal'
  | 'other';

/** Event types that have a public footprint — eligible for Serper/Jina research in Stage 2. */
export const PUBLIC_EVENT_TYPES: EventType[] = [
  'conference',
  'meetup',
  'hackathon',
  'demo_day',
  'keynote',
  'panel',
  'workshop',
  'podcast',
  'pitch',
];

// --- Title keyword maps ---

/**
 * Keywords in event titles that indicate a public/professional event worth capturing.
 * Order matters: more specific keywords checked before shorter ones to avoid false positives.
 */
const ALLOW_LIST_KEYWORDS: Array<[string, EventType]> = [
  ['conference', 'conference'],
  ['summit', 'conference'],
  ['demo day', 'demo_day'],
  ['demoday', 'demo_day'],
  ['hackathon', 'hackathon'],
  ['meetup', 'meetup'],
  ['meet-up', 'meetup'],
  ['keynote', 'keynote'],
  ['fireside', 'panel'],
  ['panel', 'panel'],
  ['workshop', 'workshop'],
  ['podcast', 'podcast'],
  ['interview', 'interview'],
  ['ama', 'panel'],
  ['demo', 'pitch'],
  ['pitch', 'pitch'],
  ['launch', 'conference'],
  ['release', 'conference'],
  ['talk', 'keynote'],
  ['customer call', 'customer_call'],
  ['investor call', 'investor_call'],
  ['sales call', 'sales_call'],
  ['discovery call', 'sales_call'],
];

/**
 * Keywords that block an event from being captured.
 * Personal/health/social events that generate no professional content.
 */
const BLOCK_LIST_KEYWORDS = [
  'doctor',
  'dentist',
  'gym',
  'lunch',
  'dinner',
  'breakfast',
  'haircut',
  'personal',
  'vacation',
  'holiday',
  'birthday',
  'standup',
  'stand-up',
  'sync',
];

// --- Core filter logic ---

/**
 * The minimum event duration to capture (30 minutes in ms).
 * Shorter events (quick calls, standups) rarely generate publishable content.
 */
const MIN_DURATION_MS = 30 * 60 * 1000;

/**
 * The maximum event duration to capture (8 hours in ms).
 * Multi-day events or blocks are not actionable as single post moments.
 */
const MAX_DURATION_MS = 8 * 60 * 60 * 1000;

/**
 * How far in the past we look for events to capture (48 hours in ms).
 * After 48 hours, the user has moved on and the moment is lost.
 */
const MAX_AGE_MS = 48 * 60 * 60 * 1000;

/**
 * Determines whether a completed calendar event is worth capturing.
 * Capture-all policy: after structural (duration/recency) and block-list checks,
 * every timed event is captured regardless of title. The pipeline serves a broad
 * audience (students, creators, enterprises) whose calendars are not limited to
 * conference/meetup-style events, so we no longer require an allow-list keyword.
 * The allow-list still drives event-type classification (see classifyEventType).
 * Designed to run in the Stage 1 cron — must be fast, no I/O.
 *
 * @param event - Minimal event shape (title, start, end)
 * @param now - Reference timestamp (injected for testability)
 * @param options - Optional overrides. `ignoreRecency` skips the past/future
 *   recency guards so a manual reload can (re)import events over an explicit
 *   user-chosen window; duration and block-list filters still apply.
 */
export function shouldCaptureEvent(
  event: { title: string; startTime: Date; endTime: Date },
  now: Date,
  options?: { ignoreRecency?: boolean },
): boolean {
  const duration = event.endTime.getTime() - event.startTime.getTime();

  // Duration guard — skip short and all-day-or-longer events.
  if (duration < MIN_DURATION_MS) return false;
  if (duration > MAX_DURATION_MS) return false;

  // Recency guard — skipped for manual reloads over an explicit user window,
  // where the user has deliberately asked to (re)import past/future events.
  if (!options?.ignoreRecency) {
    const age = now.getTime() - event.endTime.getTime();
    if (age > MAX_AGE_MS) return false;
    if (age < 0) return false;
  }

  const titleLower = event.title.toLowerCase();

  // Block list — obvious personal/low-content events never get captured.
  for (const blocked of BLOCK_LIST_KEYWORDS) {
    if (titleLower.includes(blocked)) return false;
  }

  // Capture everything else — no allow-list keyword required.
  return true;
}

/**
 * Classifies a calendar event title into a canonical EventType.
 * Uses the same keyword map as shouldCaptureEvent for consistency.
 * Falls back to 'other' when no keyword matches.
 *
 * @param title - Raw event title from Google Calendar
 */
export function classifyEventType(title: string): EventType {
  const titleLower = title.toLowerCase();
  for (const [keyword, type] of ALLOW_LIST_KEYWORDS) {
    if (titleLower.includes(keyword)) return type;
  }
  return 'other';
}

/**
 * Returns true for event types that have a public online presence (conferences,
 * meetups, panels, etc.) and are therefore eligible for Serper/Jina research in Stage 2.
 * Private professional events (calls, interviews) return false — no web footprint to search.
 */
export function isPublicEvent(type: EventType): boolean {
  return PUBLIC_EVENT_TYPES.includes(type);
}
