# Layers 1-5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all 5 intelligence layers of Content OS — Event Capture (L1), RL Hook Intelligence (L2), Memory Write Path (L3), Voice Fingerprint (L4), and Engagement Loop (L5) — wired end-to-end with shared safety infrastructure already in place.

**Architecture:** Each layer is a set of cron jobs, API routes, and lib helpers that read/write the InsForge DB. Shared infra (`feature-flags.ts`, `ai-budget.ts`) is already written and all DB tables + columns are migrated. Layers are implemented in waves to avoid shared-file conflicts. Layers 1/2/5 can proceed in parallel; L3/L4 share `voice-context.ts` and `publish/route.ts` so they execute in a final merge wave.

**Tech Stack:** Next.js 14 App Router, InsForge SDK (`@insforge/sdk`), Claude Haiku/Sonnet via `@/lib/claude`, `encryptToken`/`decryptToken` from `@/lib/crypto`, Zod for input validation, Google Calendar API, Serper, Jina Reader, Unipile.

---

## Shared Infra (DONE — do not re-implement)

- `src/lib/feature-flags.ts` — `isEnabled(client, flagName)` ✓
- `src/lib/ai-budget.ts` — `checkAndIncrementUsage(client, workspaceId, model)` ✓
- All DB tables and ALTER TABLE columns migrated ✓

---

## File Map — What Gets Created or Modified

### New Files
| File | Layer | Purpose |
|------|-------|---------|
| `src/lib/calendar/google.ts` | L1 | Google Calendar OAuth helpers, token refresh, event fetch |
| `src/lib/event-capture/filter.ts` | L1 | Title allow/block lists, duration filter, event type classifier |
| `src/lib/event-capture/research.ts` | L1 | Serper search + Jina reader + URL safety check |
| `src/lib/event-capture/questions.ts` | L1 | Haiku question generation per event type |
| `src/app/api/calendar/connect/google/route.ts` | L1 | OAuth redirect |
| `src/app/api/calendar/callback/google/route.ts` | L1 | Store encrypted tokens |
| `src/app/api/calendar/connections/route.ts` | L1 | List workspace calendar connections |
| `src/app/api/calendar/connections/[id]/route.ts` | L1 | Disconnect calendar |
| `src/app/api/cron/calendar-sync/route.ts` | L1 | Stage 1 hourly cron |
| `src/app/api/cron/event-enrich/route.ts` | L1 | Stage 2 — drains enrich_event jobs |
| `src/app/api/event-capture/route.ts` | L1 | GET inbox (questions_ready + drafted) |
| `src/app/api/event-capture/dismissed/route.ts` | L1 | GET dismissed tab |
| `src/app/api/event-capture/[id]/route.ts` | L1 | GET single capture (polling target) |
| `src/app/api/event-capture/[id]/answers/route.ts` | L1 | POST Q&A → 202 |
| `src/app/api/event-capture/[id]/auto-draft/route.ts` | L1 | POST quick draft → 202 |
| `src/app/api/event-capture/[id]/process/route.ts` | L1 | Internal: background generation |
| `src/app/api/event-capture/[id]/dismiss/route.ts` | L1 | POST soft dismiss |
| `src/app/api/event-capture/[id]/restore/route.ts` | L1 | POST un-dismiss |
| `src/app/api/event-capture/trigger/route.ts` | L1 | POST manual trigger |
| `src/app/api/social-accounts/connect/unipile/route.ts` | L1 | Unipile hosted connect redirect |
| `src/app/api/webhooks/unipile/route.ts` | L1 | Incoming Unipile events (HMAC validated) |
| `src/app/(dashboard)/event-capture/page.tsx` | L1 | Event capture inbox UI |
| `src/app/api/cron/intelligence-sync/route.ts` | L2 | Nightly RL scoring cron |
| `src/lib/voice-metrics.ts` | L4 | updateVoiceMetrics() EMA function |
| `src/app/api/voice-metrics/route.ts` | L4 | GET metrics for UI + generation |

### Modified Files
| File | Layer | What Changes |
|------|-------|-------------|
| `src/lib/hooks-intelligence/types.ts` | L2 | Add 5 new HookVertical values + PILLAR_TO_VERTICAL map |
| `src/lib/hooks-intelligence/retriever.ts` | L2 | Read hook_performance DB first, static scorer as fallback |
| `src/lib/hooks-intelligence/rl-trainer.ts` | L2 | updateFromPerformance writes to hook_performance DB table |
| `src/lib/voice-pipeline.ts` | L2 | getBestHooksForContext returns IDs; store in post.used_hook_ids |
| `src/app/api/cron/engagement-sync/route.ts` | L2+L5 | Remove dead runTrainingStep([], []) call |
| `src/lib/brain/pages.ts` | L3 | Add workspaceId param to getBrainPage, putBrainPage, listBrainPages |
| `src/lib/brain/retrieve.ts` | L3 | Add workspaceId param to retrieveBrainContext |
| `src/lib/brain/sync.ts` | L3 | Thread workspaceId; addMemory call in syncBrainPublishedPost |
| `src/lib/supermemory.ts` | L3 | Tags: user_${userId} → workspace_${workspaceId} |
| `src/lib/voice-context.ts` | L3+L4 | Inject story bank angles + voice metrics into context |
| `src/app/api/publish/route.ts` | L3+L4 | Pass workspaceId; call updateVoiceMetrics fire-and-forget |
| `src/lib/engagement/inbox.ts` | L5 | Signal detection Step 2 in draftEngagementReplies |
| `src/lib/engagement/sync.ts` | L5 | Remove runTrainingStep dynamic import + call |
| `src/app/api/ideas/route.ts` | L5 | Support ?status=suggested filter |
| `src/app/api/ideas/[id]/route.ts` | L5 | PATCH { status } for promote/dismiss |
| `src/app/api/engagement/inbox/route.ts` | L5 | Include is_content_signal, content_angle in response |

---

## Wave 1 — Foundation (no shared file conflicts, can run in parallel)

---

### Task 1: L2 — Hook Intelligence Types + PILLAR_TO_VERTICAL

**Files:**
- Modify: `src/lib/hooks-intelligence/types.ts`

- [ ] **Step 1: Add 5 new verticals and the pillar map**

Replace the `HookVertical` type in `src/lib/hooks-intelligence/types.ts`:

```typescript
export type HookVertical =
  | 'indie_maker'
  | 'direct_response'
  | 'thread_systems'
  | 'one_person_business'
  | 'visual_design'
  | 'audience_building'
  | 'mindset'
  | 'copywriting'
  | 'ai'
  | 'tech'
  | 'event_recap'
  | 'founder_story'
  | 'product_launch'
  | 'customer_story'
  | 'hot_take'
  | 'general';

export const PILLAR_TO_VERTICAL: Record<string, HookVertical> = {
  'ai':          'ai',
  'tech':        'tech',
  'hot-take':    'hot_take',
  'founder':     'founder_story',
  'hackathon':   'founder_story',
  'explainer':   'ai',
  'research':    'ai',
  'event_recap': 'event_recap',
  'product':     'product_launch',
  'customer':    'customer_story',
  'general':     'general',
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/hooks-intelligence/types.ts
git commit -m "feat(l2): add 5 hook verticals and PILLAR_TO_VERTICAL map"
```

---

### Task 2: L5 — Remove dead RL training call from engagement-sync

**Files:**
- Modify: `src/app/api/cron/engagement-sync/route.ts`

- [ ] **Step 1: Read the file and locate the dead call**

Find `runTrainingStep` import and the call site (around line 6 import, ~line 59 call). Remove both.

Remove this import line:
```typescript
import { runTrainingStep } from '@/lib/hooks-intelligence/rl-trainer';
```

Remove the call block that contains `runTrainingStep(signals)` or `runTrainingStep([], [])`. Also remove any `const { runTrainingStep } = await import(...)` dynamic import if present.

- [ ] **Step 2: Verify no TypeScript errors**

```bash
npx tsc --noEmit
```
Expected: no errors related to this file.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/engagement-sync/route.ts
git commit -m "fix(l2+l5): remove dead runTrainingStep call from engagement-sync — L2 intelligence-sync handles RL"
```

---

### Task 3: L3 — Workspace-scope brain/pages.ts

**Files:**
- Modify: `src/lib/brain/pages.ts`

- [ ] **Step 1: Add workspaceId to all three functions**

Read the full file first. Then add `workspaceId?: string` param and filter by it when provided:

```typescript
export async function listBrainPages(
  client: InsforgeClient,
  userId: string,
  workspaceId?: string,
): Promise<BrainPageRecord[]> {
  let query = client.database
    .from('creator_brain_pages')
    .select('id, user_id, slug, title, tags, body, updated_at, workspace_id')
    .eq('user_id', userId);

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId);
  }

  const { data, error } = await query.order('updated_at', { ascending: false });
  if (error) throw new Error(`Failed to list brain pages: ${error.message}`);
  return (data ?? []) as BrainPageRecord[];
}

export async function getBrainPage(
  client: InsforgeClient,
  userId: string,
  slug: string,
  workspaceId?: string,
): Promise<BrainPageRecord | null> {
  let query = client.database
    .from('creator_brain_pages')
    .select('id, user_id, slug, title, tags, body, updated_at, workspace_id')
    .eq('user_id', userId)
    .eq('slug', slug);

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Failed to get brain page: ${error.message}`);
  return (data as BrainPageRecord | null) ?? null;
}

export async function putBrainPage(
  client: InsforgeClient,
  userId: string,
  opts: {
    slug: string;
    title: string;
    tags?: string[];
    body: string;
    workspaceId?: string;
  },
): Promise<void> {
  const upsertData: Record<string, unknown> = {
    user_id: userId,
    slug: opts.slug,
    title: opts.title,
    tags: opts.tags ?? [],
    body: opts.body,
    updated_at: new Date().toISOString(),
  };
  if (opts.workspaceId) {
    upsertData.workspace_id = opts.workspaceId;
  }

  const { error } = await client.database
    .from('creator_brain_pages')
    .upsert(upsertData, { onConflict: 'user_id,slug' });

  if (error) throw new Error(`Failed to put brain page: ${error.message}`);
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/brain/pages.ts
git commit -m "feat(l3): workspace-scope brain pages — add workspaceId param to all three functions"
```

---

### Task 4: L1 — Calendar + Event Capture lib helpers

**Files:**
- Create: `src/lib/calendar/google.ts`
- Create: `src/lib/event-capture/filter.ts`
- Create: `src/lib/event-capture/research.ts`
- Create: `src/lib/event-capture/questions.ts`

- [ ] **Step 1: Create `src/lib/calendar/google.ts`**

```typescript
import { encryptToken, decryptToken } from '@/lib/crypto';

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
}

/**
 * Exchange an OAuth authorization code for Google tokens.
 */
export async function exchangeGoogleCode(code: string, redirectUri: string): Promise<GoogleTokens> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? '',
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`);
  return res.json() as Promise<GoogleTokens>;
}

/**
 * Refresh an expired Google access token using the stored refresh token.
 * Returns updated tokens or throws on failure.
 */
export async function refreshGoogleToken(encryptedRefreshToken: string): Promise<{
  access_token: string;
  expiry_date: number;
}> {
  const refreshToken = decryptToken(encryptedRefreshToken);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CALENDAR_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? '',
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  return {
    access_token: data.access_token,
    expiry_date: Date.now() + data.expires_in * 1000,
  };
}

/**
 * Fetch calendar events for a given time window.
 */
export async function fetchCalendarEvents(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<GoogleCalendarEvent[]> {
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
  url.searchParams.set('timeMin', timeMin);
  url.searchParams.set('timeMax', timeMax);
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('maxResults', '250');

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Google Calendar fetch failed: ${res.status}`);
  const data = await res.json() as { items?: GoogleCalendarEvent[] };
  return data.items ?? [];
}

/**
 * List calendars the user has access to.
 */
export async function listCalendars(accessToken: string): Promise<GoogleCalendarListEntry[]> {
  const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Calendar list failed: ${res.status}`);
  const data = await res.json() as { items?: GoogleCalendarListEntry[] };
  return data.items ?? [];
}

export interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  attendees?: Array<{ displayName?: string; email?: string }>;
  organizer?: { email?: string };
  status?: string;
}

export interface GoogleCalendarListEntry {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole: string;
}

export function buildGoogleOAuthUrl(redirectUri: string, state: string): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', process.env.GOOGLE_CALENDAR_CLIENT_ID ?? '');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar.readonly');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  return url.toString();
}
```

- [ ] **Step 2: Create `src/lib/event-capture/filter.ts`**

```typescript
import type { GoogleCalendarEvent } from '@/lib/calendar/google';

export type EventType =
  | 'conference' | 'meetup' | 'hackathon' | 'demo_day' | 'keynote'
  | 'panel' | 'workshop' | 'podcast' | 'pitch'
  | 'customer_call' | 'investor_call' | 'sales_call' | 'interview'
  | 'internal' | 'other';

export const PUBLIC_EVENT_TYPES: EventType[] = [
  'conference', 'meetup', 'hackathon', 'demo_day', 'keynote',
  'panel', 'workshop', 'podcast', 'pitch',
];

const ALLOW_KEYWORDS = [
  'conference', 'summit', 'meetup', 'hackathon', 'demo day', 'demo-day',
  'keynote', 'talk', 'panel', 'workshop', 'customer call', 'investor call',
  'sales call', 'discovery call', 'launch', 'release', 'interview', 'podcast',
  'fireside', 'ama', 'demo', 'pitch',
];

const BLOCK_KEYWORDS = [
  'doctor', 'dentist', 'gym', 'lunch', 'dinner', 'breakfast',
  'haircut', 'personal', 'vacation', 'holiday', 'birthday', 'standup', 'sync',
];

const TYPE_MAP: Array<[string[], EventType]> = [
  [['conference', 'summit'], 'conference'],
  [['meetup'], 'meetup'],
  [['hackathon'], 'hackathon'],
  [['demo day', 'demo-day', 'yc'], 'demo_day'],
  [['keynote'], 'keynote'],
  [['panel'], 'panel'],
  [['workshop'], 'workshop'],
  [['podcast'], 'podcast'],
  [['pitch'], 'pitch'],
  [['customer call', 'customer meeting'], 'customer_call'],
  [['investor call', 'investor meeting', 'vc call'], 'investor_call'],
  [['sales call', 'discovery call', 'sales meeting'], 'sales_call'],
  [['interview'], 'interview'],
  [['standup', 'sync', 'team meeting'], 'internal'],
];

export function classifyEventType(title: string): EventType {
  const lower = title.toLowerCase();
  for (const [keywords, type] of TYPE_MAP) {
    if (keywords.some(k => lower.includes(k))) return type;
  }
  return 'other';
}

export function isPublicEvent(type: EventType): boolean {
  return PUBLIC_EVENT_TYPES.includes(type);
}

/**
 * Returns true if the event should be captured for content generation.
 * Checks: duration (30min-8h), recency (within 48h), title allow/block lists.
 */
export function shouldCaptureEvent(
  event: GoogleCalendarEvent,
  now: Date,
): boolean {
  const start = event.start.dateTime ?? event.start.date;
  const end = event.end.dateTime ?? event.end.date;
  if (!start || !end) return false;

  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const durationMs = endMs - startMs;
  const nowMs = now.getTime();

  // Duration: 30min to 8 hours
  if (durationMs < 30 * 60 * 1000 || durationMs > 8 * 60 * 60 * 1000) return false;

  // Recency: end_time between now-48h and now
  const fortyEightHoursAgo = nowMs - 48 * 60 * 60 * 1000;
  if (endMs < fortyEightHoursAgo || endMs > nowMs) return false;

  const title = (event.summary ?? '').toLowerCase();

  // Block list takes priority
  if (BLOCK_KEYWORDS.some(k => title.includes(k))) return false;

  // Must match at least one allow keyword
  if (!ALLOW_KEYWORDS.some(k => title.includes(k))) return false;

  return true;
}
```

- [ ] **Step 3: Create `src/lib/event-capture/research.ts`**

```typescript
import { URL } from 'url';

const PRIVATE_IP_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^127\./,
  /^::1$/,
  /^localhost$/i,
];

/**
 * SSRF protection — rejects private/loopback addresses.
 * Reuse this function everywhere we fetch user-supplied URLs.
 */
export function assertPublicUrl(urlString: string): void {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error(`Invalid URL: ${urlString}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`Disallowed protocol: ${parsed.protocol}`);
  }
  const host = parsed.hostname;
  if (PRIVATE_IP_RANGES.some(r => r.test(host))) {
    throw new Error(`Blocked private/loopback address: ${host}`);
  }
}

/**
 * Search Serper for the event. Returns top 2 result URLs.
 */
export async function serperSearch(query: string): Promise<string[]> {
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API_KEY ?? '',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ q: query, num: 5 }),
  });
  if (!res.ok) throw new Error(`Serper failed: ${res.status}`);
  const data = await res.json() as { organic?: Array<{ link: string }> };
  return (data.organic ?? []).slice(0, 2).map(r => r.link);
}

/**
 * Fetch and clean article text via Jina Reader.
 * Truncates to 2000 tokens (~8000 chars) before returning.
 */
export async function jinaRead(url: string): Promise<string> {
  assertPublicUrl(url);
  const jinaUrl = `https://r.jina.ai/${url}`;
  const res = await fetch(jinaUrl, {
    headers: { Accept: 'text/plain' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Jina read failed: ${res.status}`);
  const text = await res.text();
  // Truncate to ~2000 tokens (8000 chars)
  return text.slice(0, 8000);
}

/**
 * Build a research summary for a public event.
 * Returns null if research could not be fetched (caller continues without it).
 */
export async function researchPublicEvent(
  title: string,
  location: string | null,
  startDate: Date,
): Promise<{ rawText: string; sources: string[] } | null> {
  const year = startDate.getFullYear();
  const month = startDate.toLocaleString('en-US', { month: 'long' });

  const primaryQuery = `"${title}" ${location ?? ''} ${year}`.trim();
  const fallbackQuery = `"${title}" ${month} ${year}`;

  let urls: string[] = [];
  try {
    urls = await serperSearch(primaryQuery);
    if (urls.length === 0) {
      urls = await serperSearch(fallbackQuery);
    }
  } catch {
    return null;
  }

  const texts: string[] = [];
  for (const url of urls.slice(0, 2)) {
    try {
      assertPublicUrl(url);
      const text = await jinaRead(url);
      if (text.length > 100) texts.push(text);
    } catch {
      // skip this URL
    }
  }

  if (texts.length === 0) return null;

  return {
    rawText: texts.join('\n\n---\n\n').slice(0, 8000),
    sources: urls,
  };
}
```

- [ ] **Step 4: Create `src/lib/event-capture/questions.ts`**

```typescript
import { generateContent } from '@/lib/claude';
import type { EventType } from '@/lib/event-capture/filter';

interface QuestionContext {
  title: string;
  location: string | null;
  eventType: EventType;
  isPublicEvent: boolean;
  researchSummary: string | null;
  creatorPillars: string[];
}

/**
 * Generate 5 conversational questions about an event using Haiku.
 * Returns array of 5 strings. Falls back to generic questions on failure.
 */
export async function generateEventQuestions(ctx: QuestionContext): Promise<string[]> {
  const researchContext = ctx.researchSummary
    ? `\n\nEVENT RESEARCH:\n${ctx.researchSummary.slice(0, 2000)}`
    : '';

  const prompt = `You are helping a content creator recall and reflect on an event they attended.

EVENT: ${ctx.title}
LOCATION: ${ctx.location ?? 'Not specified'}
TYPE: ${ctx.eventType}
CREATOR CONTENT PILLARS: ${ctx.creatorPillars.join(', ') || 'general'}${researchContext}

Generate exactly 5 questions to help them write a compelling LinkedIn/X post about this event.

Rules:
- 8-12 words each
- Conversational, no formal language ("What was the most surprising thing you heard?")
- Specific to THIS event and event type — not generic
- Focus on: key insight, unexpected moment, who they met, what changed their thinking, what they'd do differently
- If research found specific speakers or topics, reference them

Return ONLY a JSON array of 5 strings. No other text.
Example: ["What was the one insight that stuck with you?", "Who did you meet that surprised you?"]`;

  try {
    const raw = await generateContent(prompt, undefined, undefined, null);
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned) as string[];
    if (Array.isArray(parsed) && parsed.length >= 5) {
      return parsed.slice(0, 5);
    }
  } catch {
    // fall through to defaults
  }

  return [
    `What was the most surprising thing you learned at ${ctx.title}?`,
    'Who did you meet that made the biggest impression?',
    'What was one idea you heard that changed how you think?',
    'What would you do differently based on what you learned?',
    'What is the one thing you want to share with your audience?',
  ];
}
```

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/calendar/google.ts src/lib/event-capture/filter.ts src/lib/event-capture/research.ts src/lib/event-capture/questions.ts
git commit -m "feat(l1): add calendar OAuth helpers, event filter, Serper/Jina research, Haiku question generation"
```

---

## Wave 2 — Core Layer Implementation

---

### Task 5: L1 — Stage 1 Calendar Sync Cron

**Files:**
- Create: `src/app/api/cron/calendar-sync/route.ts`

- [ ] **Step 1: Create the cron route**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { isEnabled } from '@/lib/feature-flags';
import { encryptToken, decryptToken } from '@/lib/crypto';
import { refreshGoogleToken, fetchCalendarEvents } from '@/lib/calendar/google';
import { shouldCaptureEvent, classifyEventType, isPublicEvent } from '@/lib/event-capture/filter';

/**
 * GET /api/cron/calendar-sync
 * Stage 1: Mirror Google Calendar events into event_captures.
 * Enqueues enrich_event jobs for Stage 2 to drain.
 * Protected by CRON_SECRET bearer token.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = getServiceClient();

  if (!await isEnabled(client, 'layer1_calendar_sync')) {
    return NextResponse.json({ skipped: true, reason: 'flag_disabled' });
  }

  const { data: connections } = await client.database
    .from('calendar_connections')
    .select('*')
    .eq('sync_enabled', true)
    .neq('sync_status', 'disconnected');

  const now = new Date();
  const results: Array<{ connection_id: string; synced: number; error?: string }> = [];

  for (const conn of connections ?? []) {
    try {
      let accessToken = decryptToken(conn.access_token as string);

      // Refresh token if expiring within 5 minutes
      const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at as string) : null;
      if (expiresAt && expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
        if (conn.refresh_token) {
          const refreshed = await refreshGoogleToken(conn.refresh_token as string);
          accessToken = refreshed.access_token;
          await client.database
            .from('calendar_connections')
            .update({
              access_token: encryptToken(refreshed.access_token),
              token_expires_at: new Date(refreshed.expiry_date).toISOString(),
            })
            .eq('id', conn.id);
        }
      }

      const timeMin = conn.last_synced_at
        ? new Date(conn.last_synced_at as string).toISOString()
        : new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString();
      const timeMax = now.toISOString();

      const events = await fetchCalendarEvents(accessToken, conn.calendar_id as string, timeMin, timeMax);

      let synced = 0;
      for (const event of events) {
        if (!shouldCaptureEvent(event, now)) continue;

        const eventType = classifyEventType(event.summary ?? '');
        const isPublic = isPublicEvent(eventType);
        const startTime = event.start.dateTime ?? `${event.start.date}T00:00:00Z`;
        const endTime = event.end.dateTime ?? `${event.end.date}T23:59:59Z`;

        const { error: upsertError } = await client.database
          .from('event_captures')
          .upsert({
            workspace_id: conn.workspace_id,
            user_id: conn.user_id,
            calendar_connection_id: conn.id,
            source: 'google',
            provider_event_id: event.id,
            title: event.summary ?? 'Untitled Event',
            description: event.description ?? null,
            location: event.location ?? null,
            attendees: event.attendees
              ? event.attendees.map(a => ({ name: a.displayName ?? null, email: a.email ?? null }))
              : null,
            start_time: startTime,
            end_time: endTime,
            event_type: eventType,
            is_public_event: isPublic,
            status: 'detected',
          }, { onConflict: 'workspace_id,provider_event_id', ignoreDuplicates: true });

        if (!upsertError) {
          // Enqueue enrichment job for Stage 2
          const { data: capture } = await client.database
            .from('event_captures')
            .select('id')
            .eq('workspace_id', conn.workspace_id as string)
            .eq('provider_event_id', event.id)
            .single();

          if (capture) {
            await client.database.from('jobs').insert({
              type: 'enrich_event',
              workspace_id: conn.workspace_id,
              payload: { event_capture_id: capture.id },
            });
          }
          synced++;
        }
      }

      // Write last_synced_at ONLY after successful fetch+upsert
      await client.database
        .from('calendar_connections')
        .update({ last_synced_at: now.toISOString(), sync_status: 'ok' })
        .eq('id', conn.id);

      results.push({ connection_id: conn.id as string, synced });
    } catch (err) {
      console.error('[calendar-sync] connection error', { id: conn.id, err });
      await client.database
        .from('calendar_connections')
        .update({ sync_status: 'error' })
        .eq('id', conn.id);
      results.push({ connection_id: conn.id as string, synced: 0, error: String(err) });
    }
  }

  return NextResponse.json({ ok: true, results });
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/calendar-sync/route.ts
git commit -m "feat(l1): calendar-sync Stage 1 cron — mirror Google Calendar events, enqueue enrich_event jobs"
```

---

### Task 6: L1 — Stage 2 Event Enrich Cron

**Files:**
- Create: `src/app/api/cron/event-enrich/route.ts`

- [ ] **Step 1: Create the cron**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { isEnabled } from '@/lib/feature-flags';
import { checkAndIncrementUsage } from '@/lib/ai-budget';
import { researchPublicEvent } from '@/lib/event-capture/research';
import { generateEventQuestions } from '@/lib/event-capture/questions';

/**
 * GET /api/cron/event-enrich
 * Stage 2: Claim enrich_event jobs, research public events via Serper+Jina,
 * generate 5 Haiku questions per event. Drains up to 20 jobs per run.
 * Protected by CRON_SECRET bearer token.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = getServiceClient();

  if (!await isEnabled(client, 'layer1_event_enrich')) {
    return NextResponse.json({ skipped: true, reason: 'flag_disabled' });
  }

  const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  // Claim pending jobs
  const { data: pendingJobs } = await client.database
    .from('jobs')
    .select('*')
    .eq('type', 'enrich_event')
    .eq('status', 'pending')
    .lt('attempts', 3)
    .order('created_at', { ascending: true })
    .limit(20);

  if (!pendingJobs?.length) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  // Mark all as processing before starting (prevents double-processing on overlapping runs)
  await client.database
    .from('jobs')
    .update({ status: 'processing', updated_at: new Date().toISOString() })
    .in('id', pendingJobs.map(j => j.id));

  let processed = 0;

  for (const job of pendingJobs) {
    const captureId = (job.payload as { event_capture_id: string }).event_capture_id;

    try {
      const { data: capture } = await client.database
        .from('event_captures')
        .select('*')
        .eq('id', captureId)
        .single();

      if (!capture) {
        await client.database.from('jobs').update({ status: 'done' }).eq('id', job.id);
        continue;
      }

      // Skip if too old
      if (new Date(capture.end_time as string) < new Date(fortyEightHoursAgo)) {
        await client.database.from('jobs').update({ status: 'done' }).eq('id', job.id);
        await client.database.from('event_captures').update({ status: 'dismissed' }).eq('id', captureId);
        continue;
      }

      // Check AI budget
      const budget = await checkAndIncrementUsage(client, capture.workspace_id as string, 'haiku');
      if (budget === 'blocked') {
        await client.database.from('jobs').update({
          status: 'pending',
          attempts: (job.attempts as number) + 1,
          updated_at: new Date().toISOString(),
        }).eq('id', job.id);
        continue;
      }

      await client.database
        .from('event_captures')
        .update({ status: 'researching' })
        .eq('id', captureId);

      let researchSummary: string | null = null;

      // Only research public events
      if (capture.is_public_event) {
        try {
          const research = await researchPublicEvent(
            capture.title as string,
            capture.location as string | null,
            new Date(capture.start_time as string),
          );
          if (research) {
            researchSummary = research.rawText;
            await client.database.from('event_research').upsert({
              event_capture_id: captureId,
              raw_text: research.rawText,
              sources: research.sources,
            }, { onConflict: 'event_capture_id' });
          }
        } catch (err) {
          console.warn('[event-enrich] research failed (continuing without it)', err);
        }
      }

      // Load creator pillars for question context
      const { data: profile } = await client.database
        .from('creator_profile')
        .select('content_pillars')
        .eq('workspace_id', capture.workspace_id)
        .maybeSingle();

      let pillars: string[] = [];
      try {
        const raw = profile?.content_pillars;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        pillars = Array.isArray(parsed) ? parsed.map((p: { name?: string } | string) =>
          typeof p === 'string' ? p : (p.name ?? '')
        ).filter(Boolean) : [];
      } catch { pillars = []; }

      const questions = await generateEventQuestions({
        title: capture.title as string,
        location: capture.location as string | null,
        eventType: capture.event_type as any,
        isPublicEvent: capture.is_public_event as boolean,
        researchSummary,
        creatorPillars: pillars,
      });

      await client.database
        .from('event_captures')
        .update({
          questions,
          status: 'questions_ready',
          updated_at: new Date().toISOString(),
        })
        .eq('id', captureId);

      await client.database.from('jobs').update({ status: 'done', updated_at: new Date().toISOString() }).eq('id', job.id);
      processed++;
    } catch (err) {
      console.error('[event-enrich] job failed', { jobId: job.id, captureId, err });
      await client.database.from('jobs').update({
        status: (job.attempts as number) + 1 >= (job.max_attempts as number) ? 'failed' : 'pending',
        attempts: (job.attempts as number) + 1,
        last_error: String(err),
        updated_at: new Date().toISOString(),
      }).eq('id', job.id);
      await client.database.from('event_captures').update({ status: 'error' }).eq('id', captureId);
    }
  }

  return NextResponse.json({ ok: true, processed });
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/event-enrich/route.ts
git commit -m "feat(l1): event-enrich Stage 2 cron — Serper+Jina research, Haiku questions, job drain pattern"
```

---

### Task 7: L1 — Calendar OAuth Routes

**Files:**
- Create: `src/app/api/calendar/connect/google/route.ts`
- Create: `src/app/api/calendar/callback/google/route.ts`
- Create: `src/app/api/calendar/connections/route.ts`
- Create: `src/app/api/calendar/connections/[id]/route.ts`

- [ ] **Step 1: Create `src/app/api/calendar/connect/google/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { buildGoogleOAuthUrl } from '@/lib/calendar/google';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const origin = request.nextUrl.origin;
  const redirectUri = `${origin}/api/calendar/callback/google`;
  const state = Buffer.from(JSON.stringify({ userId: user.id, ts: Date.now() })).toString('base64');
  const url = buildGoogleOAuthUrl(redirectUri, state);

  return NextResponse.redirect(url);
}
```

- [ ] **Step 2: Create `src/app/api/calendar/callback/google/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { exchangeGoogleCode, listCalendars } from '@/lib/calendar/google';
import { encryptToken } from '@/lib/crypto';
import { getActiveWorkspaceId } from '@/lib/workspace';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const error = searchParams.get('error');

  if (error || !code) {
    return NextResponse.redirect(`${request.nextUrl.origin}/settings?error=calendar_denied`);
  }

  const origin = request.nextUrl.origin;
  const redirectUri = `${origin}/api/calendar/callback/google`;

  try {
    const tokens = await exchangeGoogleCode(code, redirectUri);
    const client = getServerClient();
    const workspaceId = await getActiveWorkspaceId(client, user.id);

    if (!workspaceId) {
      return NextResponse.redirect(`${origin}/settings?error=no_workspace`);
    }

    // List calendars and use primary
    const calendars = await listCalendars(tokens.access_token);
    const primary = calendars.find(c => c.primary) ?? calendars[0];

    if (!primary) {
      return NextResponse.redirect(`${origin}/settings?error=no_calendar`);
    }

    await client.database.from('calendar_connections').upsert({
      workspace_id: workspaceId,
      user_id: user.id,
      provider: 'google',
      access_token: encryptToken(tokens.access_token),
      refresh_token: tokens.refresh_token ? encryptToken(tokens.refresh_token) : null,
      token_expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      calendar_id: primary.id,
      calendar_name: primary.summary,
      sync_enabled: true,
      sync_status: 'ok',
    }, { onConflict: 'workspace_id,provider,calendar_id' });

    return NextResponse.redirect(`${origin}/settings?connected=calendar`);
  } catch (err) {
    console.error('[calendar/callback] error', err);
    return NextResponse.redirect(`${origin}/settings?error=calendar_failed`);
  }
}
```

- [ ] **Step 3: Create `src/app/api/calendar/connections/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';

export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(client, user.id);

  const { data } = await client.database
    .from('calendar_connections')
    .select('id, calendar_name, calendar_id, sync_enabled, sync_status, last_synced_at, created_at')
    .eq('workspace_id', workspaceId ?? '')
    .order('created_at', { ascending: false });

  return NextResponse.json({ connections: data ?? [] });
}
```

- [ ] **Step 4: Create `src/app/api/calendar/connections/[id]/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(client, user.id);

  const { error } = await client.database
    .from('calendar_connections')
    .delete()
    .eq('id', params.id)
    .eq('workspace_id', workspaceId ?? '');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: TypeScript check + commit**

```bash
npx tsc --noEmit
git add src/app/api/calendar/
git commit -m "feat(l1): Google Calendar OAuth connect, callback, list, disconnect routes"
```

---

### Task 8: L1 — Event Capture API Routes

**Files:**
- Create: `src/app/api/event-capture/route.ts`
- Create: `src/app/api/event-capture/dismissed/route.ts`
- Create: `src/app/api/event-capture/[id]/route.ts`
- Create: `src/app/api/event-capture/[id]/answers/route.ts`
- Create: `src/app/api/event-capture/[id]/auto-draft/route.ts`
- Create: `src/app/api/event-capture/[id]/dismiss/route.ts`
- Create: `src/app/api/event-capture/[id]/restore/route.ts`
- Create: `src/app/api/event-capture/trigger/route.ts`

- [ ] **Step 1: Create `src/app/api/event-capture/route.ts`** (inbox)

```typescript
import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';

export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(client, user.id);

  const { data } = await client.database
    .from('event_captures')
    .select('id, title, event_type, is_public_event, start_time, end_time, status, questions, answers, created_at')
    .eq('workspace_id', workspaceId ?? '')
    .in('status', ['questions_ready', 'drafting', 'drafted'])
    .order('end_time', { ascending: false })
    .limit(50);

  return NextResponse.json({ captures: data ?? [] });
}
```

- [ ] **Step 2: Create `src/app/api/event-capture/dismissed/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';

export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(client, user.id);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data } = await client.database
    .from('event_captures')
    .select('id, title, event_type, start_time, end_time, status, dismissed_at')
    .eq('workspace_id', workspaceId ?? '')
    .eq('status', 'dismissed')
    .gte('dismissed_at', sevenDaysAgo)
    .order('dismissed_at', { ascending: false });

  return NextResponse.json({ captures: data ?? [] });
}
```

- [ ] **Step 3: Create `src/app/api/event-capture/[id]/route.ts`** (polling target)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(client, user.id);

  const { data: capture } = await client.database
    .from('event_captures')
    .select('*')
    .eq('id', params.id)
    .eq('workspace_id', workspaceId ?? '')
    .single();

  if (!capture) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let posts = null;
  if (capture.status === 'drafted') {
    const { data } = await client.database
      .from('posts')
      .select('id, platform, script, caption, status, voice_match_score, ai_score')
      .eq('event_capture_id', params.id)
      .eq('workspace_id', workspaceId ?? '');
    posts = data;
  }

  return NextResponse.json({ capture, posts });
}
```

- [ ] **Step 4: Create `src/app/api/event-capture/[id]/answers/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { z } from 'zod';

const AnswersSchema = z.object({
  answers: z.record(z.string().max(500)).refine(
    val => Object.keys(val).length >= 1,
    'At least 1 answer required'
  ),
});

function sanitizeAnswer(raw: string): string {
  return raw.trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').slice(0, 500);
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(client, user.id);

  const { data: capture } = await client.database
    .from('event_captures')
    .select('id, workspace_id, status')
    .eq('id', params.id)
    .eq('workspace_id', workspaceId ?? '')
    .single();

  if (!capture) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (capture.status === 'drafting' || capture.status === 'drafted') {
    return NextResponse.json({ error: 'Already generating' }, { status: 409 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = AnswersSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const sanitized: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed.data.answers)) {
    sanitized[k] = sanitizeAnswer(v);
  }

  await client.database
    .from('event_captures')
    .update({ answers: sanitized, status: 'drafting', updated_at: new Date().toISOString() })
    .eq('id', params.id);

  // Fire-and-forget background generation
  const processUrl = `${request.nextUrl.origin}/api/event-capture/${params.id}/process`;
  fetch(processUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': process.env.CRON_SECRET ?? '',
    },
  }).catch(() => {});

  return NextResponse.json({ captureId: params.id }, { status: 202 });
}
```

- [ ] **Step 5: Create `src/app/api/event-capture/[id]/auto-draft/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(client, user.id);

  const { data: capture } = await client.database
    .from('event_captures')
    .select('id, workspace_id, status')
    .eq('id', params.id)
    .eq('workspace_id', workspaceId ?? '')
    .single();

  if (!capture) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (capture.status === 'drafting' || capture.status === 'drafted') {
    return NextResponse.json({ error: 'Already generating' }, { status: 409 });
  }

  await client.database
    .from('event_captures')
    .update({ answers: {}, status: 'drafting', updated_at: new Date().toISOString() })
    .eq('id', params.id);

  const processUrl = `${request.nextUrl.origin}/api/event-capture/${params.id}/process`;
  fetch(processUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': process.env.CRON_SECRET ?? '',
    },
  }).catch(() => {});

  return NextResponse.json({ captureId: params.id, mode: 'auto' }, { status: 202 });
}
```

- [ ] **Step 6: Create dismiss/restore/trigger routes**

`src/app/api/event-capture/[id]/dismiss/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(client, user.id);

  await client.database
    .from('event_captures')
    .update({ status: 'dismissed', dismissed_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('workspace_id', workspaceId ?? '');

  return NextResponse.json({ ok: true });
}
```

`src/app/api/event-capture/[id]/restore/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';

export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(client, user.id);

  await client.database
    .from('event_captures')
    .update({ status: 'questions_ready', dismissed_at: null })
    .eq('id', params.id)
    .eq('workspace_id', workspaceId ?? '')
    .eq('status', 'dismissed');

  return NextResponse.json({ ok: true });
}
```

`src/app/api/event-capture/trigger/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';

export async function POST(_request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(client, user.id);

  // Re-enqueue detected captures for enrichment
  const { data: detected } = await client.database
    .from('event_captures')
    .select('id')
    .eq('workspace_id', workspaceId ?? '')
    .eq('status', 'detected')
    .limit(10);

  for (const cap of detected ?? []) {
    await client.database.from('jobs').insert({
      type: 'enrich_event',
      workspace_id: workspaceId,
      payload: { event_capture_id: cap.id },
    });
  }

  return NextResponse.json({ ok: true, enqueued: (detected ?? []).length });
}
```

- [ ] **Step 7: TypeScript check + commit**

```bash
npx tsc --noEmit
git add src/app/api/event-capture/
git commit -m "feat(l1): event capture API routes — inbox, polling, Q&A, auto-draft, dismiss/restore, trigger"
```

---

### Task 9: L1 — Background Draft Generation Route

**Files:**
- Create: `src/app/api/event-capture/[id]/process/route.ts`

- [ ] **Step 1: Create the process route**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { isEnabled } from '@/lib/feature-flags';
import { checkAndIncrementUsage } from '@/lib/ai-budget';
import { generateWithVoicePipeline } from '@/lib/voice-pipeline';
import { loadCreatorVoiceContext } from '@/lib/voice-context';

/**
 * POST /api/event-capture/[id]/process
 * Internal: Background draft generation. Fire-and-forget from /answers and /auto-draft.
 * Protected by x-internal-secret header (= CRON_SECRET).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const secret = request.headers.get('x-internal-secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = getServiceClient();

  if (!await isEnabled(client, 'layer1_draft_generation')) {
    return NextResponse.json({ skipped: true });
  }

  const { data: capture } = await client.database
    .from('event_captures')
    .select('*')
    .eq('id', params.id)
    .single();

  if (!capture) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const workspaceId = capture.workspace_id as string;
  const userId = capture.user_id as string;

  try {
    // Load connected Unipile platforms for this workspace
    const { data: socialAccounts } = await client.database
      .from('social_accounts')
      .select('platform')
      .eq('workspace_id', workspaceId);

    const connectedPlatforms = (socialAccounts ?? [])
      .map(a => a.platform as string)
      .filter(p => ['linkedin', 'twitter'].includes(p));

    const platforms = connectedPlatforms.length > 0 ? connectedPlatforms : ['linkedin'];

    // Load research context
    const { data: research } = await client.database
      .from('event_research')
      .select('raw_text, speakers, key_topics')
      .eq('event_capture_id', params.id)
      .maybeSingle();

    const answers = capture.answers as Record<string, string> | null;
    const questions = capture.questions as string[] | null;

    let answerContext = '';
    if (answers && questions) {
      const pairs = Object.entries(answers)
        .map(([k, v]) => `Q: ${questions[parseInt(k)] ?? k}\nA: ${v}`)
        .join('\n\n');
      answerContext = pairs ? `\n\nCREATOR ANSWERS:\n${pairs}` : '';
    }

    const researchContext = research?.raw_text
      ? `\n\nEVENT RESEARCH:\n${(research.raw_text as string).slice(0, 2000)}`
      : '';

    const createdPosts: Array<{ platform: string; postId: string }> = [];

    for (const platform of platforms) {
      const budgetCheck = await checkAndIncrementUsage(client, workspaceId, 'sonnet');
      if (budgetCheck === 'blocked') break;

      const voiceCtx = await loadCreatorVoiceContext(client, userId, workspaceId);
      const prompt = `Write a ${platform === 'linkedin' ? 'LinkedIn' : 'X/Twitter'} post recapping this event.

EVENT: ${capture.title}
DATE: ${new Date(capture.end_time as string).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
TYPE: ${capture.event_type}${answerContext}${researchContext}

Write in my voice. Make it personal, specific, and valuable to my audience. No generic recaps.`;

      const result = await generateWithVoicePipeline({
        userPrompt: prompt,
        profile: voiceCtx.profile,
        contextAdditions: voiceCtx.contextString,
        platform,
        fast: !answers || Object.keys(answers).length === 0,
      });

      const { data: post } = await client.database
        .from('posts')
        .insert({
          user_id: userId,
          workspace_id: workspaceId,
          event_capture_id: params.id,
          title: `${capture.title} recap`,
          pillar: 'event_recap',
          platform,
          status: 'scripted',
          script: result.text,
          voice_match_score: result.voice_match_score,
          ai_score: result.ai_score,
          voice_evaluation: result.evaluation ?? null,
        })
        .select('id')
        .single();

      if (post) createdPosts.push({ platform, postId: post.id });
    }

    await client.database
      .from('event_captures')
      .update({ status: 'drafted', updated_at: new Date().toISOString() })
      .eq('id', params.id);

    return NextResponse.json({ ok: true, posts: createdPosts });
  } catch (err) {
    console.error('[event-capture/process] generation failed', err);
    await client.database
      .from('event_captures')
      .update({ status: 'questions_ready', updated_at: new Date().toISOString() })
      .eq('id', params.id);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 2: TypeScript check + commit**

```bash
npx tsc --noEmit
git add src/app/api/event-capture/
git commit -m "feat(l1): event capture background generation — voice pipeline, per-platform, feature flag + budget gated"
```

---

### Task 10: L1 — Unipile Webhook + Social Connect

**Files:**
- Create: `src/app/api/webhooks/unipile/route.ts`
- Create: `src/app/api/social-accounts/connect/unipile/route.ts`

- [ ] **Step 1: Create `src/app/api/webhooks/unipile/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'crypto';
import { getServiceClient } from '@/lib/insforge/server';

/**
 * POST /api/webhooks/unipile
 * Receives Unipile webhook events (LinkedIn events, social account changes).
 * HMAC-SHA256 signature validated on every request.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const signature = request.headers.get('x-unipile-signature');
  const secret = process.env.UNIPILE_WEBHOOK_SECRET;

  if (!secret) {
    console.error('[unipile-webhook] UNIPILE_WEBHOOK_SECRET not configured');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const rawBody = await request.text();

  if (signature) {
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    const valid = signature === expected || signature === `sha256=${expected}`;
    if (!valid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  } else {
    // No signature header — reject in production
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
    }
  }

  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const event = payload as { type?: string; data?: Record<string, unknown> };
  console.info('[unipile-webhook] received', { type: event.type });

  // Future: route event.type to handlers (LinkedIn events, comment sync triggers, etc.)

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Create `src/app/api/social-accounts/connect/unipile/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';

/**
 * GET /api/social-accounts/connect/unipile
 * Redirects to Unipile hosted connect page.
 * Unipile handles the OAuth flow and calls back to our webhook.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const apiKey = process.env.UNIPILE_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Unipile not configured' }, { status: 500 });

  // Unipile hosted connect URL — replace with actual Unipile connect endpoint
  const unipileConnectUrl = `https://api2.unipile.com/api/v1/hosted/connect?api_key=${apiKey}&user_id=${user.id}`;

  return NextResponse.redirect(unipileConnectUrl);
}
```

- [ ] **Step 3: TypeScript check + commit**

```bash
npx tsc --noEmit
git add src/app/api/webhooks/unipile/route.ts src/app/api/social-accounts/connect/unipile/route.ts
git commit -m "feat(l1): Unipile webhook (HMAC validated) + hosted connect redirect"
```

---

### Task 11: L2 — Intelligence Sync Cron + DB-backed RL Trainer

**Files:**
- Create: `src/app/api/cron/intelligence-sync/route.ts`
- Modify: `src/lib/hooks-intelligence/rl-trainer.ts`
- Modify: `src/lib/hooks-intelligence/retriever.ts`

- [ ] **Step 1: Add `updateFromPerformanceDB` to `rl-trainer.ts`**

Add a new exported async function after the existing sync functions (keep existing sync functions unchanged):

```typescript
import type { createClient } from '@insforge/sdk';
import { PILLAR_TO_VERTICAL } from './types';

type InsforgeClient = ReturnType<typeof createClient>;

/**
 * Write RL score updates to hook_performance DB table using EMA.
 * Called by intelligence-sync nightly cron. Never writes to in-memory dataset.
 */
export async function updateFromPerformanceDB(
  client: InsforgeClient,
  hookId: string,
  vertical: string,
  saveRate: number,
  success: boolean,
): Promise<void> {
  const alpha = 0.3;
  const newScore = success ? Math.min(100, saveRate * 100 + 10) : Math.max(0, saveRate * 100);

  const { data: existing } = await client.database
    .from('hook_performance')
    .select('rl_score, rl_confidence, sample_count')
    .eq('hook_id', hookId)
    .eq('vertical', vertical)
    .maybeSingle();

  if (existing) {
    await client.database.from('hook_performance').update({
      rl_score: alpha * newScore + (1 - alpha) * Number(existing.rl_score),
      rl_confidence: Math.min(0.99, Number(existing.rl_confidence) + 0.02),
      sample_count: Number(existing.sample_count) + 1,
      rl_updated_at: new Date().toISOString(),
    }).eq('hook_id', hookId).eq('vertical', vertical);
  } else {
    await client.database.from('hook_performance').insert({
      hook_id: hookId,
      vertical,
      rl_score: newScore,
      rl_confidence: 0.5,
      sample_count: 1,
      rl_updated_at: new Date().toISOString(),
    });
  }
}

export { PILLAR_TO_VERTICAL };
```

- [ ] **Step 2: Update `retriever.ts` to read hook_performance DB first**

Add a new exported async function (keep existing sync retriever functions unchanged):

```typescript
import type { createClient } from '@insforge/sdk';
import type { HookVertical } from './types';
import { loadHookDataset } from './index';

type InsforgeClient = ReturnType<typeof createClient>;

/**
 * DB-first hook retrieval: reads hook_performance scores, falls back to static scorer.
 * Used by the voice pipeline to get the best hooks for a given vertical.
 */
export async function getBestHooksForVerticalDB(
  client: InsforgeClient,
  vertical: HookVertical,
  limit = 8,
): Promise<Array<{ hookId: string; score: number; source: 'db' | 'static' }>> {
  // Step 1: DB-learned scores
  const { data: dbScores } = await client.database
    .from('hook_performance')
    .select('hook_id, rl_score')
    .eq('vertical', vertical)
    .order('rl_score', { ascending: false })
    .limit(limit * 2);

  const dbHookIds = new Set((dbScores ?? []).map(r => r.hook_id as string));

  const results: Array<{ hookId: string; score: number; source: 'db' | 'static' }> = (dbScores ?? []).map(r => ({
    hookId: r.hook_id as string,
    score: Number(r.rl_score),
    source: 'db' as const,
  }));

  // Step 2: Fill remaining slots with static scorer
  if (results.length < limit) {
    const dataset = loadHookDataset();
    const staticHooks = dataset.hooks
      .filter(h => h.verticals?.includes(vertical) && !dbHookIds.has(h.id))
      .sort((a, b) => (dataset.scores[b.id]?.total ?? 70) - (dataset.scores[a.id]?.total ?? 70))
      .slice(0, limit - results.length);

    for (const h of staticHooks) {
      results.push({ hookId: h.id, score: dataset.scores[h.id]?.total ?? 70, source: 'static' });
    }
  }

  return results.slice(0, limit);
}
```

- [ ] **Step 3: Create `src/app/api/cron/intelligence-sync/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { isEnabled } from '@/lib/feature-flags';
import { updateFromPerformanceDB, PILLAR_TO_VERTICAL } from '@/lib/hooks-intelligence/rl-trainer';

/**
 * GET /api/cron/intelligence-sync
 * Nightly RL: read posts with used_hook_ids + views >= 100 that haven't been
 * processed yet. Compute EMA score updates and write to hook_performance table.
 * Protected by CRON_SECRET bearer token.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = getServiceClient();

  if (!await isEnabled(client, 'layer2_intelligence_sync')) {
    return NextResponse.json({ skipped: true, reason: 'flag_disabled' });
  }

  const { data: posts } = await client.database
    .from('posts')
    .select('id, used_hook_ids, pillar, views, saves')
    .is('rl_processed_at', null)
    .not('used_hook_ids', 'is', null)
    .gte('views', 100)
    .eq('status', 'posted')
    .order('created_at', { ascending: true })
    .limit(500);

  let processed = 0;
  let hooksUpdated = 0;

  for (const post of posts ?? []) {
    const hookIds = post.used_hook_ids as string[];
    const views = post.views as number;
    const saves = (post.saves as number) ?? 0;
    const pillar = post.pillar as string;

    const vertical = PILLAR_TO_VERTICAL[pillar] ?? 'general';
    const saveRate = saves / Math.max(views, 1);
    const success = saveRate > 0.02 && saves >= 5;

    for (const hookId of hookIds) {
      try {
        await updateFromPerformanceDB(client, hookId, vertical, saveRate, success);
        hooksUpdated++;
      } catch (err) {
        console.warn('[intelligence-sync] hook update failed', { hookId, err });
      }
    }

    await client.database
      .from('posts')
      .update({ rl_processed_at: new Date().toISOString() })
      .eq('id', post.id);

    processed++;
  }

  console.info('[intelligence-sync] done', { processed, hooksUpdated });
  return NextResponse.json({ ok: true, processed, hooksUpdated });
}
```

- [ ] **Step 4: TypeScript check + commit**

```bash
npx tsc --noEmit
git add src/lib/hooks-intelligence/rl-trainer.ts src/lib/hooks-intelligence/retriever.ts src/app/api/cron/intelligence-sync/route.ts
git commit -m "feat(l2): intelligence-sync nightly cron — EMA RL scores to hook_performance DB, DB-first retrieval"
```

---

### Task 12: L4 — Voice Metrics

**Files:**
- Create: `src/lib/voice-metrics.ts`
- Create: `src/app/api/voice-metrics/route.ts`

- [ ] **Step 1: Create `src/lib/voice-metrics.ts`**

```typescript
import type { createClient } from '@insforge/sdk';
import { isEnabled } from '@/lib/feature-flags';
import type { VoiceEvaluationMatrix } from '@/lib/voice-evaluator';

type InsforgeClient = ReturnType<typeof createClient>;

const alpha = 0.3;

/**
 * EMA update of workspace voice quality metrics after each publish.
 * Fire-and-forget — never throws, never blocks publish path.
 * Updates both platform-specific and 'all' aggregate rows.
 */
export async function updateVoiceMetrics(
  client: InsforgeClient,
  workspaceId: string,
  userId: string,
  platform: string,
  evaluation: VoiceEvaluationMatrix,
  voiceMatchScore: number,
  aiScore: number,
  postId: string,
): Promise<void> {
  if (!await isEnabled(client, 'layer4_voice_metrics')) return;

  for (const target of [platform, 'all']) {
    const { data: existing } = await client.database
      .from('workspace_voice_metrics')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('platform', target)
      .maybeSingle();

    if (!existing) {
      await client.database.from('workspace_voice_metrics').insert({
        workspace_id: workspaceId,
        user_id: userId,
        platform: target,
        avg_voice_match_score: voiceMatchScore,
        avg_ai_score: aiScore,
        avg_persona_fidelity: evaluation.persona_fidelity * 10,
        avg_uniqueness: evaluation.uniqueness * 10,
        avg_specificity: evaluation.specificity * 10,
        avg_so_what: evaluation.so_what * 10,
        avg_pain_resonance: evaluation.pain_resonance * 10,
        post_count: 1,
        last_post_id: postId,
      });
    } else {
      await client.database.from('workspace_voice_metrics').update({
        avg_voice_match_score: alpha * voiceMatchScore + (1 - alpha) * Number(existing.avg_voice_match_score),
        avg_ai_score: alpha * aiScore + (1 - alpha) * Number(existing.avg_ai_score),
        avg_persona_fidelity: alpha * evaluation.persona_fidelity * 10 + (1 - alpha) * Number(existing.avg_persona_fidelity),
        avg_uniqueness: alpha * evaluation.uniqueness * 10 + (1 - alpha) * Number(existing.avg_uniqueness),
        avg_specificity: alpha * evaluation.specificity * 10 + (1 - alpha) * Number(existing.avg_specificity),
        avg_so_what: alpha * evaluation.so_what * 10 + (1 - alpha) * Number(existing.avg_so_what),
        avg_pain_resonance: alpha * evaluation.pain_resonance * 10 + (1 - alpha) * Number(existing.avg_pain_resonance),
        post_count: Number(existing.post_count) + 1,
        last_post_id: postId,
        updated_at: new Date().toISOString(),
      }).eq('workspace_id', workspaceId).eq('platform', target);
    }
  }
}
```

- [ ] **Step 2: Create `src/app/api/voice-metrics/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';

export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(client, user.id);

  const { data } = await client.database
    .from('workspace_voice_metrics')
    .select('*')
    .eq('workspace_id', workspaceId ?? '');

  const platforms: Record<string, unknown> = {};
  for (const row of data ?? []) {
    const p = row.platform as string;
    platforms[p] = {
      avg_voice_match_score: Number(row.avg_voice_match_score),
      avg_ai_score: Number(row.avg_ai_score),
      post_count: Number(row.post_count),
      breakdown: {
        persona_fidelity: Number(row.avg_persona_fidelity),
        uniqueness: Number(row.avg_uniqueness),
        specificity: Number(row.avg_specificity),
        so_what: Number(row.avg_so_what),
        pain_resonance: Number(row.avg_pain_resonance),
      },
    };
  }

  return NextResponse.json({ platforms });
}
```

- [ ] **Step 3: TypeScript check + commit**

```bash
npx tsc --noEmit
git add src/lib/voice-metrics.ts src/app/api/voice-metrics/route.ts
git commit -m "feat(l4): voice metrics EMA updater + GET /api/voice-metrics endpoint"
```

---

## Wave 3 — Shared File Updates (sequential — touch same files)

---

### Task 13: L3+L4 — Update voice-context.ts (story bank + metrics injection)

**Files:**
- Modify: `src/lib/voice-context.ts`

- [ ] **Step 1: Read the full file first to understand existing structure**

Open `src/lib/voice-context.ts` and find `loadCreatorVoiceContext`. Add two injections after existing brain snippets:

1. Story bank angles (L3):
```typescript
// After brain snippets loading, before return:
const { data: storyRows } = await client.database
  .from('story_bank')
  .select('mined_angle, pillar')
  .eq('user_id', userId)
  .eq('workspace_id', workspaceId)
  .eq('used', false)
  .not('mined_angle', 'is', null)
  .order('created_at', { ascending: false })
  .limit(3);

if (storyRows?.length) {
  contextParts.push(
    'UNUSED STORY BANK ANGLES (consider weaving into this draft):\n' +
    storyRows.map((s, i) => `${i + 1}. ${s.mined_angle}`).join('\n')
  );
}
```

2. Voice metrics injection (L4):
```typescript
// After story bank, before return:
if (workspaceId && platform) {
  const { data: metrics } = await client.database
    .from('workspace_voice_metrics')
    .select('avg_voice_match_score, avg_ai_score, post_count')
    .eq('workspace_id', workspaceId)
    .eq('platform', platform)
    .maybeSingle();

  if (metrics && Number(metrics.post_count) >= 3) {
    contextParts.push(
      `Your recent ${platform} performance: ${Number(metrics.avg_voice_match_score).toFixed(0)}/100 voice match, ` +
      `${Number(metrics.avg_ai_score).toFixed(0)}/100 AI detection (${metrics.post_count} posts). ` +
      `Maintain or beat these scores.`
    );
  }
}
```

- [ ] **Step 2: Thread workspaceId and platform params through loadCreatorVoiceContext signature**

Ensure function signature accepts `workspaceId?: string` and `platform?: string` if not already present. Update all callers.

- [ ] **Step 3: TypeScript check + commit**

```bash
npx tsc --noEmit
git add src/lib/voice-context.ts
git commit -m "feat(l3+l4): inject story bank angles and voice metrics baseline into generation context"
```

---

### Task 14: L3 — Wire addMemory in syncBrainPublishedPost

**Files:**
- Modify: `src/lib/brain/sync.ts`
- Modify: `src/lib/supermemory.ts`

- [ ] **Step 1: Add workspace_id threading to brain/sync.ts**

In `syncBrainPublishedPost`, add `workspaceId?: string` param. Pass it to `putBrainPage`. After the `putBrainPage` call, add the `addMemory` call:

```typescript
export async function syncBrainPublishedPost(
  client: InsforgeClient,
  userId: string,
  postId: string,
  workspaceId?: string,
): Promise<void> {
  // ... existing fetch and putBrainPage logic ...

  // L3: non-blocking Supermemory write
  if (!await isEnabled(client, 'layer3_memory_writes')) return;
  try {
    const { addMemory } = await import('@/lib/supermemory');
    await addMemory({
      content: [
        `Published ${post.platform} post (${post.pillar}):`,
        content,
        post.views ? `Performance: ${post.views} views, ${post.likes ?? 0} likes` : '',
      ].filter(Boolean).join('\n\n'),
      containerTags: [
        workspaceId ? `workspace_${workspaceId}` : `user_${userId}`,
        'published_post', post.platform, post.pillar,
      ],
      customId: `post_${postId}`,
      metadata: {
        type: 'published_post',
        platform: post.platform,
        pillar: post.pillar,
        views: post.views ?? 0,
        posted_date: post.posted_date ?? '',
      },
    });
  } catch {
    // non-blocking — Supermemory down must not block publishing
  }
}
```

- [ ] **Step 2: Update Supermemory tags in supermemory.ts**

Find `storePersona` and `searchUserContext`. Update containerTags from `user_${userId}` to `workspace_${workspaceId}` when workspaceId is provided. Add `workspaceId?: string` param to both.

- [ ] **Step 3: TypeScript check + commit**

```bash
npx tsc --noEmit
git add src/lib/brain/sync.ts src/lib/supermemory.ts
git commit -m "feat(l3): wire addMemory in syncBrainPublishedPost, workspace-scope Supermemory tags"
```

---

### Task 15: L3+L4 — Update publish/route.ts

**Files:**
- Modify: `src/app/api/publish/route.ts`

- [ ] **Step 1: Add workspaceId and fire-and-forget hooks after publish success**

After the existing `syncBrainPublishedPost` call (around line 411), add:

```typescript
// L4: voice metrics — fire and forget
if (postId) {
  const { data: postData } = await client.database
    .from('posts')
    .select('voice_match_score, ai_score, voice_evaluation, platform')
    .eq('id', postId)
    .maybeSingle();

  if (postData?.voice_match_score && postData.voice_evaluation) {
    const { updateVoiceMetrics } = await import('@/lib/voice-metrics');
    const workspaceId = (postData as any).workspace_id as string | undefined;
    if (workspaceId) {
      updateVoiceMetrics(
        client,
        workspaceId,
        user.id,
        platform,
        postData.voice_evaluation as any,
        Number(postData.voice_match_score),
        Number(postData.ai_score ?? 0),
        postId,
      ).catch(() => {});
    }
  }
}
```

- [ ] **Step 2: TypeScript check + commit**

```bash
npx tsc --noEmit
git add src/app/api/publish/route.ts
git commit -m "feat(l3+l4): wire voice metrics update and workspace-scoped brain sync in publish route"
```

---

### Task 16: L5 — Signal Detection in Engagement Inbox

**Files:**
- Modify: `src/lib/engagement/inbox.ts`
- Modify: `src/lib/engagement/sync.ts`
- Modify: `src/app/api/ideas/route.ts`
- Modify: `src/app/api/ideas/[id]/route.ts`
- Modify: `src/app/api/engagement/inbox/route.ts`

- [ ] **Step 1: Add signal detection to `draftEngagementReplies` in inbox.ts**

After the reply draft step in the per-comment loop, add:

```typescript
// L5: signal detection — check if comment is worth a full post
if (await isEnabled(client, 'layer5_engagement_signals')) {
  const budget = await checkAndIncrementUsage(client, workspaceId, 'haiku');
  if (budget !== 'blocked' && haikusUsed < MAX_HAIKU_PER_RUN) {
    const text = comment.comment_text ?? '';
    const GENERIC_PHRASES = ['great post', 'so true', 'love this', 'thanks for sharing', 'well said'];
    const isGeneric = text.length < 50 || GENERIC_PHRASES.some(p => text.toLowerCase().includes(p));

    if (!isGeneric) {
      try {
        const signalPrompt = `Is this comment asking a question worth a full post? Does it reveal a perspective worth addressing? Could it serve as a hook for a follow-up post?

COMMENT: "${text}"

Return ONLY valid JSON: {"is_signal": boolean, "angle": "string or empty", "pillar": "general|ai|tech|founder_story|hot_take|event_recap|other"}`;

        const raw = await generateContent(signalPrompt, undefined, undefined, null);
        const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim()) as {
          is_signal: boolean; angle: string; pillar: string;
        };

        if (parsed.is_signal && parsed.angle) {
          await client.database.from('post_comments').update({
            is_content_signal: true,
            content_angle: parsed.angle,
            signal_processed_at: new Date().toISOString(),
          }).eq('id', comment.id);

          await client.database.from('content_ideas').insert({
            user_id: userId,
            workspace_id: workspaceId,
            idea: parsed.angle,
            pillar: parsed.pillar,
            source: 'from_comment',
            source_comment_id: comment.id,
            status: 'suggested',
            notes: `From reply to "${postTitle}" — @${comment.author_handle ?? 'unknown'}`,
            converted: false,
          });
        } else {
          await client.database.from('post_comments').update({
            signal_processed_at: new Date().toISOString(),
          }).eq('id', comment.id);
        }
        haikusUsed++;
      } catch {
        // non-blocking
      }
    }
  }
}
```

Add at top of the loop scope: `let haikusUsed = 0; const MAX_HAIKU_PER_RUN = 25;`

- [ ] **Step 2: Remove runTrainingStep from engagement/sync.ts**

Find and remove:
- The dynamic import of `runTrainingStep`
- Any call to `runTrainingStep(signals)` or similar

- [ ] **Step 3: Update ideas/route.ts to support status filter**

In the GET handler, check for `?status=suggested` query param and filter accordingly.

- [ ] **Step 4: Update ideas/[id]/route.ts to support PATCH status**

Add a PATCH handler that accepts `{ status: 'active' | 'dismissed' }` and updates the row.

- [ ] **Step 5: Update engagement/inbox/route.ts to include signal fields**

Ensure `is_content_signal` and `content_angle` are included in the comment select query.

- [ ] **Step 6: TypeScript check + commit**

```bash
npx tsc --noEmit
git add src/lib/engagement/ src/app/api/ideas/ src/app/api/engagement/
git commit -m "feat(l5): signal detection in engagement inbox, ideas status filter, remove dead RL from sync"
```

---

## Wave 4 — Review + Verification

- [ ] **Run full build**

```bash
npm run build
```
Expected: exit 0, no errors.

- [ ] **Run lint**

```bash
npm run lint
```
Expected: exit 0.

- [ ] **TypeScript strict check**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Verify feature flags all enabled in DB**

```sql
SELECT name, enabled FROM feature_flags ORDER BY name;
```
Expected: all 7 rows with `enabled = true`.

- [ ] **Final commit**

```bash
git add -A
git commit -m "feat: all 5 layers implemented — L1 event capture, L2 RL intelligence, L3 memory, L4 voice metrics, L5 engagement signals"
```

---

## Security Checklist (reviewer subagents verify each item)

- [ ] All cron routes check `CRON_SECRET` bearer token before any work
- [ ] `/api/event-capture/[id]/process` uses `x-internal-secret` not open access
- [ ] `assertPublicUrl` called before every `fetch` of user-provided or research URLs (SSRF protection)
- [ ] Google Calendar tokens AES-256-GCM encrypted at rest (`encryptToken`) before DB insert
- [ ] Unipile webhook HMAC-SHA256 signature validated on every request
- [ ] All event capture routes validate `workspace_id` matches active workspace before touching data
- [ ] Answer sanitization: trim + strip control chars + max 500 chars before DB store
- [ ] Research text truncated to 2000 tokens before any Claude call
- [ ] No API keys hardcoded — all via `process.env.*`
- [ ] RLS on `event_captures`, `calendar_connections`, `event_research` enforces workspace scope
- [ ] `feature_flags` table has no RLS (correct — service role reads it)
- [ ] Budget blocked comments still get `signal_processed_at = now()` (no re-scan loop)

---

## Env Vars Required (use placeholders locally)

```env
# L1 - Google Calendar
GOOGLE_CALENDAR_CLIENT_ID=placeholder
GOOGLE_CALENDAR_CLIENT_SECRET=placeholder

# L1 - Research
SERPER_API_KEY=placeholder
# Jina Reader uses no key — free tier via r.jina.ai

# L1 - Unipile
UNIPILE_API_KEY=placeholder
UNIPILE_WEBHOOK_SECRET=placeholder

# Already exists in project
CRON_SECRET=<existing>
TOKEN_ENCRYPTION_KEY=<existing>
INSFORGE_SERVICE_ROLE_KEY=<existing>
```
