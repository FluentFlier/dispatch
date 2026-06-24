# Event Capture — Phase 5 Implementation Plan
> Phase: phase/event-capture
> Branch from: phase/workspace-migration (after schema + memory phases done)
> Prerequisite phases: Schema (P1), Memory Write (P2), Intelligence Pipeline (P3), Voice Fingerprint (P4)
> Full architecture: `docs/plans/2026-06-next-wave-architecture.md`

---

## Why This Phase Matters

The single feature that separates Content OS from every other tool on the market.

Buffer, Hootsuite, FeedHive, Fastlane — all assume you already have content. Fastlane starts from a brand URL and generates batches of generic short-form videos. None of them starts from a real human experience.

Event Capture starts from a real event in your life: a meetup, a conference talk, a customer call, a demo day, a hackathon. You lived it. The system asks 5 targeted questions. You answer in 3 minutes. It generates 3 platform-native, voice-matched drafts.

This is the wedge.

---

## Market + Algorithm Intelligence (Informs Every Design Decision)

### Why authenticity is the architecture

LinkedIn's 2026 algorithm runs a Generative Recommender model that explicitly detects AI-sounding content and suppresses it. What it rewards: personal, specific, dwell-inducing content. Event Q&A answers are authentic by design — the user typed (or spoke) their raw reactions. Running them through the voice pipeline before showing a draft is the only correct approach. Do NOT skip the voice pipeline for speed.

### What LinkedIn rewards (content decisions)

- **Specificity + numbers**: "3 things I learned at the NVIDIA meetup" outperforms "thoughts on AI." Web research step adds speaker names, announcements, specific details that make content specific.
- **Dwell time**: Posts that make people read slowly are rewarded. Target 1200-2500 characters for LinkedIn drafts. Short sentences. Personal reflection not press release.
- **Golden hour**: First 60 minutes after posting is critical for LinkedIn distribution. Event Capture must suggest an optimal posting window — within 24-48 hours of the event while still fresh, timed to LinkedIn golden hour (Tuesday-Thursday 8-10am or 12-1pm in user's timezone).
- **Comments drive reach**: Asking a genuine open-ended question at the end of each LinkedIn draft increases comment likelihood. Every LinkedIn draft must end with one.
- **Tagging**: Tagging 1-3 relevant people (speakers, organizers found in research) can boost reach ~20%. Include tag suggestions from web research.
- **Format**: Carousels and infographics reach 1.8-11x more than text. Phase 5 generates text-first. Carousel outline (slide-by-slide text breakdown) is a stretch goal for this phase.

### What X rewards (content decisions)

- **Thread format**: Event content that fills 500+ chars needs thread structure. First tweet = the sharpest single insight from the event. Subsequent tweets expand with specifics.
- **SimClusters community signal**: Event hashtags (#AIConf, #YCDemo, #TechMeetup) connect posts to communities and improve For You distribution.
- **Concrete + specific**: Vague takes get buried. Quotes, announcements, surprises from the event — specificity travels through interaction graphs.
- **Hooks**: The first tweet must stop the scroll. Use the Hook Intelligence dataset filtered to `event_recap` content type.

### What Threads rewards

- Conversational, under 500 chars per post
- Raw and informal — "texting a friend who missed the event"
- Can be single post if the insight is sharp enough
- No hashtags needed

### Competitor context (Fastlane)

Fastlane's strength: volume and distribution velocity for brand marketing. Their weakness: no voice identity, no real human experience as input, not for personal brands or founders. Event Capture is the inverse: one real experience, maximum authenticity, minimum friction. They do not compete on this axis.

---

## High-Signal Event Detection

Not every calendar event should trigger a capture flow. The cron should filter for high-signal events only.

### Signal criteria (any one qualifies)

**Title contains:**
- Conference, summit, meetup, hackathon, demo day, keynote, talk, panel, workshop
- Customer call, investor call, sales call (treat as high-signal business events)
- Launch, release, announcement
- Interview, podcast recording

**Duration:** > 30 minutes AND < 8 hours (all-day personal blocks excluded)

**Exclusions (title heuristics):**
- Doctor, dentist, gym, lunch, dinner, haircut, personal
- Recurring daily standup, sync (unless user explicitly marks as capture-worthy)
- Tentative/declined invites

**Override:** User can manually trigger capture from any event via "Capture this event" button in the calendar page.

---

## Schema

All schema additions are part of Phase 1 (schema migration). Listed here for reference.

```sql
-- Calendar connections (per workspace, OAuth)
create table if not exists calendar_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null,
  provider text not null check (provider in ('google', 'notion')),
  access_token text not null,        -- AES-256-GCM encrypted
  refresh_token text,                -- AES-256-GCM encrypted
  token_expires_at timestamptz,
  calendar_id text not null,         -- Google: calendarId string
  calendar_name text,                -- display name for UI
  sync_enabled boolean not null default true,
  last_synced_at timestamptz,
  created_at timestamptz default now() not null,
  unique(workspace_id, provider, calendar_id)
);

-- Event captures (each high-signal event detected)
create table if not exists event_captures (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null,
  calendar_connection_id uuid references calendar_connections(id) on delete set null,
  provider_event_id text not null,
  title text not null,
  description text,
  location text,
  attendees jsonb,                   -- array of {name, email} from calendar
  start_time timestamptz not null,
  end_time timestamptz not null,
  research_context jsonb,            -- web search results: {summary, speakers, key_points, urls}
  questions jsonb,                   -- array of 5 strings
  answers jsonb,                     -- {0: "...", 1: "...", ...}
  suggested_post_time timestamptz,   -- optimal posting window calculated on detection
  status text not null default 'detected'
    check (status in (
      'detected',       -- event found, not yet researched
      'researching',    -- web search in progress
      'questions_ready',-- research done, questions generated, waiting for user answers
      'answered',       -- user submitted answers, ready for draft generation
      'drafting',       -- generating drafts
      'drafted',        -- drafts created in posts table
      'dismissed'       -- user skipped this event
    )),
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique(workspace_id, provider_event_id)
);

create trigger event_captures_updated_at
  before update on event_captures
  for each row execute function update_updated_at();

create index if not exists event_captures_workspace_status
  on event_captures (workspace_id, status, end_time desc);

-- Link generated posts back to source event
alter table posts add column if not exists event_capture_id uuid references event_captures(id) on delete set null;
create index if not exists posts_event_capture on posts (event_capture_id) where event_capture_id is not null;
```

---

## API Routes

### Calendar OAuth

```
GET  /api/calendar/connect/google
```
- Build Google OAuth URL with scopes: `calendar.readonly`
- Store `state` in httpOnly cookie (CSRF protection)
- Redirect to Google

```
GET  /api/calendar/callback/google
```
- Validate `state` against cookie
- Exchange `code` for tokens
- Encrypt tokens with `encryptToken()`
- Upsert `calendar_connections` row
- Redirect to `/settings?connected=google_calendar`

```
GET  /api/calendar/connections
```
- Auth: `getAuthenticatedUser()` + `getActiveWorkspaceId()`
- Returns all connections for active workspace
- Strips tokens from response (never expose to client)

```
DELETE  /api/calendar/connections/[id]
```
- Auth + workspace scope
- Deletes connection, triggers cleanup of pending event_captures

### Event Capture

```
GET  /api/event-capture
```
- Auth + workspace scope
- Returns captures with `status IN ('questions_ready', 'answered')` ordered by end_time desc
- This is the "Event Inbox" — what the user needs to act on

```
GET  /api/event-capture/[id]
```
- Returns single capture with full research_context and questions
- Used when user opens the capture to answer questions

```
POST  /api/event-capture/[id]/answers
body: { answers: { "0": "...", "1": "...", "2": "...", "3": "...", "4": "..." } }
```
- Validates all 5 answers present and non-empty
- Sets `status = 'answered'`
- Immediately triggers draft generation (inline, not queued — user is waiting)
- Returns `{ posts: [{ id, platform, status }] }`

```
POST  /api/event-capture/[id]/dismiss
```
- Sets `status = 'dismissed'`
- No drafts generated

```
POST  /api/event-capture/trigger
body: { providerEventId: string, calendarConnectionId: string }
```
- Manual trigger: user wants to capture a specific event
- Kicks off research + question generation immediately
- Returns `{ eventCaptureId: string }`

---

## Cron: calendar-sync

**Schedule:** `0 * * * *` (every hour)

**Route:** `GET /api/cron/calendar-sync`

**Steps:**

```
1. Auth: CRON_SECRET bearer token
2. Load all calendar_connections where sync_enabled = true
   (use service client, not user session)

3. For each connection:
   a. Refresh token if token_expires_at < now() + 5 min
      → encryptToken(newToken) and upsert back to DB
   b. Fetch events from Google Calendar API:
      GET /calendars/{calendarId}/events
      timeMin = last_synced_at OR (now - 3 hours)
      timeMax = now
      singleEvents = true, orderBy = startTime
   c. Update last_synced_at on the connection

4. For each event:
   a. Apply high-signal detection filter (see above)
   b. Skip if end_time > now() (event hasn't ended yet)
   c. Skip if end_time < now() - 48 hours (too old)
   d. Upsert event_captures: ON CONFLICT (workspace_id, provider_event_id) DO NOTHING
      (only process new events, don't overwrite user's work)

5. For each NEW event_capture with status = 'detected':
   a. Calculate suggested_post_time:
      - Base: event end_time + 2 hours (still fresh)
      - Round to next golden hour slot (see golden hour logic below)
      - Store on event_capture
   b. Trigger research step (async — call internal endpoint or run inline)
   c. Set status = 'researching'

6. For each event_capture with status = 'researching':
   a. Run web research (see research step below)
   b. Generate 5 questions using Claude
   c. Set status = 'questions_ready'
```

**Golden hour calculation:**

```ts
function suggestPostTime(eventEndTime: Date, userTimezone: string): Date {
  // Golden hour slots: 8:00am, 9:00am, 12:00pm, 1:00pm, 5:00pm in user timezone
  // Prefer weekdays. If event ends on Friday evening, suggest Monday morning.
  const GOLDEN_HOURS = [8, 9, 12, 13, 17];
  const base = new Date(eventEndTime.getTime() + 2 * 60 * 60 * 1000); // +2 hours
  // Find next golden hour slot after base, within 48 hours
  // ... timezone-aware logic using user's timezone from user_settings
}
```

User timezone stored in `user_settings` key `timezone`. Default to UTC if not set.

---

## Research Step

**What it does:** given event title, description, date, location — search the web and extract structured context.

**Search query:** `"{event_title}" site:eventbrite.com OR site:lu.ma OR site:meetup.com OR site:{location} {year}`

**Fallback query if no results:** `"{event_title}" {year}`

**Implementation:** reuse the SSRF-protected fetch pattern from `voice-lab/import/route.ts` (Jina.ai reader at `https://r.jina.ai/{url}`).

**Output schema:**
```ts
interface EventResearchContext {
  summary: string;          // 1-2 sentences about what this event is
  speakers: string[];       // names/handles of speakers found
  key_topics: string[];     // main topics/themes discussed
  key_announcements: string[]; // any product launches, news mentioned
  venue: string | null;
  sources: string[];        // URLs used
}
```

Store as `event_captures.research_context` (jsonb).

**If research fails:** proceed with just the calendar event data (title, description). Questions will be more generic but the flow still works.

---

## Question Generation

**Prompt to Claude:**

```
You are helping a founder/creator capture content from a real event they just attended.

EVENT DETAILS:
Title: {title}
Date: {date}
Location: {location}
Calendar description: {description}

RESEARCH CONTEXT:
{research_context.summary}
Speakers: {research_context.speakers.join(', ')}
Key topics: {research_context.key_topics.join(', ')}
Announcements: {research_context.key_announcements.join(', ')}

Generate exactly 5 specific, targeted questions to help this person capture the most interesting, shareable content from this event.

Rules:
- Questions must be SPECIFIC to this event. Never generic ("what did you learn?").
- Each question should surface a different type of content: personal story, surprising insight, contrarian take, actionable advice, emotional moment.
- Questions should be conversational and easy to answer in 2-5 sentences.
- Do not number the questions. Return as a JSON array of 5 strings.
- No em dashes.

Return ONLY a valid JSON array. No preamble, no explanation.
```

---

## Draft Generation (on answer submission)

Called inline from `POST /api/event-capture/[id]/answers`. User is waiting — keep it fast.

**Steps:**

```ts
async function generateEventCaptureDrafts(capture, answers, userId, workspaceId) {
  // 1. Build event + Q&A context block
  const eventContext = buildEventContext(capture, answers);
  // Includes: event title, date, research findings, all Q&A pairs

  // 2. Load voice context (workspace-scoped)
  const { profile, contextAdditions } = await loadCreatorVoiceContext(client, userId, {
    workspaceId,
    memoryQuery: capture.title,  // semantic search for related past posts
  });

  // 3. Generate 3 platforms in parallel
  const [linkedinDraft, xDraft, threadsDraft] = await Promise.all([
    generateWithVoicePipeline({
      userPrompt: buildLinkedInPrompt(capture, eventContext),
      profile,
      contextAdditions,
      platform: 'linkedin',
      fast: false,  // always full pipeline for event posts
    }),
    generateWithVoicePipeline({
      userPrompt: buildXPrompt(capture, eventContext),
      profile,
      contextAdditions,
      platform: 'twitter',
      fast: false,
    }),
    generateWithVoicePipeline({
      userPrompt: buildThreadsPrompt(capture, eventContext),
      profile,
      contextAdditions,
      platform: 'threads',
      fast: false,
    }),
  ]);

  // 4. Validate character counts
  // LinkedIn: warn if < 800 chars or > 2600 chars
  // X thread: validate each tweet <= 280 chars
  // Threads: validate <= 500 chars per post

  // 5. Generate tag suggestions for LinkedIn (from research speakers)
  const tagSuggestions = extractTagSuggestions(capture.research_context);

  // 6. Insert posts with event_capture_id
  const posts = await insertEventPosts([linkedinDraft, xDraft, threadsDraft], {
    userId, workspaceId, eventCaptureId: capture.id,
    suggestedPostTime: capture.suggested_post_time,
    tagSuggestions,  // stored in post.notes as JSON
  });

  // 7. Update event_captures.status = 'drafted'
  await client.database.from('event_captures')
    .update({ status: 'drafted', updated_at: new Date().toISOString() })
    .eq('id', capture.id);

  return posts;
}
```

### Platform-Specific Prompts

**LinkedIn prompt goal:** Long-form story post, 1200-2500 chars, first-person, dwell time optimized.

```
Write a LinkedIn post about attending {event_title} on {date}.

EVENT CONTEXT:
{eventContext}

FORMAT REQUIREMENTS:
- 1200-2500 characters total
- First 2-3 lines are the hook (shown before "see more") — drop into the most interesting moment or insight immediately
- Body: personal story structure — what happened, what surprised you, what you took away
- Include specific details: speaker names, quotes, announcements, numbers from the research
- Short sentences. No corporate language. Write like a real person reflecting on a real experience.
- End with one open-ended question that invites response (NOT "thoughts?" — be specific)
- No em dashes. No hashtags in the body.
- Voice match: {profile voice rules}
```

**X thread prompt goal:** Hook tweet + 4-6 thread tweets, each ≤280 chars.

```
Write an X (Twitter) thread about attending {event_title} on {date}.

EVENT CONTEXT:
{eventContext}

FORMAT REQUIREMENTS:
- 5-7 tweets total
- First tweet: the sharpest single insight or most surprising moment. Must stop the scroll. ≤280 chars.
- Tweets 2-5: expand on different aspects. Each tweet stands alone but the thread flows.
- Last tweet: where to go/follow up, or a direct question.
- Separate tweets with ---TWEET--- on its own line.
- Include specific names, numbers, details from the research.
- No em dashes. Conversational and direct.
```

**Threads prompt goal:** Short, conversational, under 500 chars.

```
Write a Threads post about attending {event_title} on {date}.

EVENT CONTEXT:
{eventContext}

FORMAT REQUIREMENTS:
- Under 500 characters total
- Conversational, like texting a smart friend about what you just saw
- One sharp take or the most interesting moment
- Can be a single post or 2-3 short posts separated by ---POST---
- No em dashes. Raw and real.
```

---

## UI — Event Capture Inbox

**Location:** New section in the dashboard OR new `/event-capture` page accessible from nav.

**What users see:**
- List of events with `status = 'questions_ready'` or `status = 'answered'`
- Each event: title, date, status badge, "Answer Questions" button or "View Drafts" button
- Empty state: "No events to capture. Connect your calendar in Settings."

**Answer Questions flow:**
- Shows event title + date + research summary (brief)
- 5 questions rendered as form fields
- Each question: text input or textarea (no mic yet)
- "Generate Drafts" button — disabled until all 5 answered
- On submit: loading state ("Generating 3 drafts...") → redirect to post editor with all 3 drafts open
- Each draft shows: voice_match_score, character count, platform tag

**Post editor additions:**
- New badge: "From Event: {event title}" on event-generated posts
- Suggested posting time shown as a pre-filled scheduled_publish_at
- Tag suggestions for LinkedIn shown as a chip list (click to add to notes/caption)

---

## Tests

**File:** `tests/phase-event-capture.test.ts`

```ts
describe('Phase 5: Event Capture', () => {
  describe('High-signal event detection', () => {
    it('detects meetup/conference titles as high-signal')
    it('excludes gym/doctor/lunch events')
    it('excludes events shorter than 30 minutes')
    it('excludes events that ended more than 48 hours ago')
  })

  describe('Golden hour calculation', () => {
    it('suggests a time within 48h of event end')
    it('rounds to nearest golden hour slot (8am, 9am, 12pm, 1pm)')
    it('skips weekends and rounds to Monday morning')
  })

  describe('Question generation prompt', () => {
    it('includes event title, speakers, and key topics in prompt')
    it('does not include generic questions when research context is rich')
  })

  describe('Draft generation', () => {
    it('generates 3 drafts (linkedin, twitter, threads) in parallel')
    it('all drafts use generateWithVoicePipeline not generateContent')
    it('LinkedIn draft is between 800 and 2600 chars')
    it('each X tweet is <= 280 chars')
    it('sets event_capture_id on all generated posts')
    it('sets suggested_post_time on all generated posts')
    it('updates event_captures.status to drafted on success')
  })

  describe('Calendar OAuth', () => {
    it('stores access token encrypted (iv:ciphertext:tag format)')
    it('validates CSRF state on callback')
    it('strips tokens from /api/calendar/connections response')
  })

  describe('Workspace scoping', () => {
    it('calendar_connections are workspace-scoped')
    it('event_captures are workspace-scoped')
    it('generated posts inherit workspace_id')
  })
})
```

---

## Phase Completion Checklist

Phase 5 does NOT close until every item below is checked manually:

**Schema:**
- [ ] `calendar_connections` table exists in InsForge dashboard
- [ ] `event_captures` table exists with all columns including `suggested_post_time`
- [ ] `posts.event_capture_id` column added
- [ ] All new tables have `workspace_id` column
- [ ] RLS will be applied (add to Phase 4 RLS script)

**OAuth:**
- [ ] Google Calendar OAuth flow completes end-to-end
- [ ] Access token stored encrypted (confirmed with `grep -rn "access_token" src/app/api/calendar/`)
- [ ] CSRF state validated on callback
- [ ] Token refresh works when `token_expires_at` is past

**Cron:**
- [ ] `calendar-sync` cron fires every hour in Vercel
- [ ] High-signal detection filters correctly (test with both signal + non-signal events)
- [ ] New event_captures created for qualifying events
- [ ] Research step populates `research_context` with speakers + topics
- [ ] 5 questions generated and stored in `questions` field
- [ ] `suggested_post_time` is set and falls within a golden hour slot

**Draft Generation:**
- [ ] Answer submission generates 3 drafts within 30 seconds
- [ ] All 3 drafts have `event_capture_id` set
- [ ] LinkedIn draft is 1200+ chars
- [ ] X draft uses thread format with `---TWEET---` delimiters, each tweet ≤280 chars
- [ ] Threads draft is ≤500 chars
- [ ] All 3 drafts have `voice_match_score` > 0 (voice pipeline ran)
- [ ] `event_captures.status` set to 'drafted' after generation

**UI:**
- [ ] Event inbox shows events with `questions_ready` status
- [ ] Q&A form shows all 5 questions
- [ ] "Generate Drafts" button disabled until all 5 answered
- [ ] Loading state shown during draft generation
- [ ] Generated posts show "From Event" badge
- [ ] Suggested post time pre-filled on generated posts
- [ ] Tag suggestions visible on LinkedIn draft

**Tests:**
- [ ] `npm test tests/phase-event-capture.test.ts` all green
- [ ] `npm run build` exits 0
- [ ] `npx tsc --noEmit` exits 0

---

## Hard Constraints

1. **Always use `generateWithVoicePipeline`** — never raw `generateContent` for event drafts. The voice pipeline is the anti-AI-detection defense.
2. **Web research is non-negotiable** — generic questions without research produce generic posts. If research fails, log and proceed with calendar data only, but always attempt research.
3. **Tokens encrypted at rest** — `encryptToken()` on every calendar access_token and refresh_token before writing to DB. `decryptToken()` only in the cron, never in client code.
4. **Google Calendar first** — Notion Calendar is Phase 6+ or future wave. Do not scope Notion in this phase.
5. **Text answers only** — Whisper mic input is a future wave. Do not add audio input in Phase 5.
6. **LinkedIn + X + Threads only** — Instagram needs image, Reddit = Horizon 3. Do not generate for Instagram or Reddit.
7. **No auto-posting** — all generated drafts require user approval before publish. This is a hard product rule.
8. **Cron uses service client** — `getServiceClient()` with `CRON_SECRET` bearer auth. No session cookies.

---

## What This Unlocks

After Phase 5 ships:
- A technical founder attends a meetup Monday evening
- Tuesday morning: they open Content OS, see "NVIDIA AI Meetup — 5 questions waiting"
- 3 minutes to answer
- 3 drafts: LinkedIn story post (already timed for 9am Tuesday), X thread, Threads take
- They review, approve, schedule
- Done

No other product on the market does this. This is the moat.
