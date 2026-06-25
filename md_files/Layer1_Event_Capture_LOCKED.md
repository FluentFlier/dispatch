# Event Capture — Final Locked Architecture
> Status: LOCKED — do not change without discussion
> Date: 2026-06-24
> Incorporates: 3 rounds of external review + 14 Q&A decisions

---

## What This Feature Does

After a calendar event ends, Content OS detects it, researches it, asks you 5 quick questions,
and generates 3 ready-to-publish posts (LinkedIn + X) in your voice — before you forget what happened.

Target: founder attends NVIDIA AI meetup Monday evening. Tuesday morning: 3 drafts waiting.
Total user time: 2-3 minutes answering questions.

---

## Platforms in Scope

| Platform | Status |
|----------|--------|
| LinkedIn | ✓ In scope |
| X/Twitter | ✓ In scope (via Unipile — if Unipile X breaks, skip gracefully) |
| Threads | ✗ Not in scope (Unipile doesn't support it yet) |
| Instagram | ✗ Horizon 3 |
| Reddit | ✗ Horizon 3 |

---

## Architecture: 3 Stages

### Stage 1 — Calendar Sync (hourly cron)
**One job. One responsibility: mirror calendar events into DB.**

```
/api/cron/calendar-sync   0 * * * *

getServiceClient() [INSFORGE_SERVICE_ROLE_KEY + CRON_SECRET bearer]

for each calendar_connections WHERE sync_enabled=true:
  try:
    ├─ check token_expires_at < now+5min
    │    → POST oauth2.googleapis.com/token { refresh_token: decryptToken(...) }
    │    → encryptToken(newToken) → upsert calendar_connections
    │
    ├─ GET googleapis.com/calendar/v3/calendars/{id}/events
    │    timeMin = last_synced_at | now-3h (first run)
    │    timeMax = now
    │
    ├─ for each event:
    │    ├─ duration filter: 30min < duration < 8h
    │    ├─ recency filter: end_time between now-48h and now
    │    ├─ title ALLOW list: conference, summit, meetup, hackathon, demo day,
    │    │   keynote, talk, panel, workshop, customer call, investor call,
    │    │   sales call, discovery call, launch, release, interview, podcast,
    │    │   fireside, ama, demo, pitch
    │    ├─ title BLOCK list: doctor, dentist, gym, lunch, dinner, breakfast,
    │    │   haircut, personal, vacation, holiday, birthday, standup, sync
    │    ├─ upsert event_captures ON CONFLICT (workspace_id, provider_event_id) DO NOTHING
    │    │   ← don't overwrite user's work
    │    └─ set event_type (see type labels below)
    │
    └─ update last_synced_at ONLY after successful fetch+upsert
  catch (connection error):
    log error, set sync_status='error' on this connection, CONTINUE to next
    ← one bad token must not kill the whole cron run

NO Serper. NO Jina. NO Claude. Target: < 5 seconds per user.
```

**Vercel Hobby tier note:** Minimum cron interval is 60 minutes on free plan.
Stage 2 is bundled at the end of Stage 1 (same hourly cron, second pass) until Pro upgrade.
On Pro: Stage 2 becomes its own 15-minute cron.

---

### Stage 2 — Event Enrich (every 15 min, or end of Stage 1 on Hobby)
**One job. One responsibility: classify, research, generate questions.**

```
/api/cron/event-enrich   */15 * * * *

getServiceClient()

SELECT * FROM event_captures
  WHERE status='detected'
  ORDER BY end_time ASC  ← oldest first
  LIMIT 5 per workspace  ← cost cap: ~$0.03 max per run

for each capture:
  ├─ skip if end_time < now - 48h (too old, user has moved on)
  │
  ├─ event_type determines research strategy:
  │    PUBLIC events (conference, summit, meetup, hackathon, demo_day,
  │                   keynote, talk, panel, workshop, podcast, pitch):
  │      → Serper search: '"${title}" ${location} ${year}'
  │        fallback: '"${title}" ${month} ${year}'
  │      → top 2 URLs → assertPublicUrl → Jina reader → cleanReaderText
  │      → truncate to 2000 tokens
  │      → store in event_research table (NOT on event_captures row)
  │
  │    PRIVATE events (customer_call, investor_call, sales_call,
  │                    interview, internal, other):
  │      → NO Serper/Jina (no public footprint)
  │      → research = null, questions use calendar data + creator pillars only
  │
  ├─ update status='researching'
  │
  ├─ Haiku: generate 5 questions
  │    [event title + date + location + type + research (if exists) + creator_pillars]
  │    → specific to this event and event_type
  │    → 8-12 words each, conversational, no formal language
  │    → store in event_captures.questions
  │
  └─ update status='questions_ready'

If Serper/Jina fail: continue without research, generate generic questions
If Haiku fails: update status='error', log, retry next run
```

---

### Stage 3 — Draft Generation (async, user-triggered)

#### User Flow

```
/event-capture page (new dedicated page in left nav)

Event cards show events with status='questions_ready':

┌────────────────────────────────────────────────────┐
│ NVIDIA AI Meetup                    conference      │
│ Mon June 24 · 7:00pm                               │
│ Research found: 3 speakers, 5 topics               │
│                                                    │
│  [Answer 5 questions →]      [Quick draft]         │
└────────────────────────────────────────────────────┘

Dismissed events: separate "Dismissed" tab, recoverable within 7 days
```

#### Option B — Q&A (default)

Conversational thread UI. One question at a time. NOT a form.

```
POST /api/event-capture/[id]/answers
body: { answers: { "0": "...", "1": "...", ... } }

Rules:
- At least 1 answer required (not all 5, not 0)
- Each answer: trim(), strip control chars (\x00-\x1f except \n\t), max 500 chars
- Validate capture.workspace_id = activeWorkspaceId before touching anything
- Store sanitized answers
- Update status='drafting'
- Return 202 { captureId } IMMEDIATELY — do not wait for generation
```

#### Option A — Quick Draft (escape hatch, per-event only)

```
POST /api/event-capture/[id]/auto-draft

Same auth + validation. answers = {}
Same 202 return + same background generation
Response includes: { mode: 'auto' } so UI can show lower voice_match expectation
```

#### Background Draft Generation

```
Triggered by: POST /answers or /auto-draft
Mechanism: internal fire-and-forget fetch to /api/event-capture/[id]/process
           (fire without awaiting — user's request has already returned 202)

Client: polls GET /api/event-capture/[id] every 3 seconds
        shows "Generating your 3 drafts..." with live status
        when status='drafted' → show drafts

/api/event-capture/[id]/process:
  ├─ load which platforms user has connected via Unipile
  │    → only generate for connected platforms
  │    → if only LinkedIn connected: generate 1 draft, not 3
  │
  ├─ loadCreatorVoiceContext (profile + brain snippets + story bank)
  ├─ searchUserContext [Supermemory, tag: workspace_${workspaceId}] × 3 parallel
  ├─ getBestHooksForContext('event_recap')
  ├─ load event_research (from separate table, not event_captures row)
  │
  ├─ build context stack (8 sections per plan)
  │
  ├─ Promise.all × connected platforms:
  │    generateWithVoicePipeline({ platform, fast: false })
  │    → Sonnet generate → Haiku evaluate → if <75 Sonnet revise → humanize
  │
  ├─ validate char counts per platform
  ├─ extract tag suggestions if research found speakers
  ├─ INSERT posts (event_capture_id, workspace_id, status='scripted')
  └─ UPDATE event_captures.status = 'drafted'
```

---

## LinkedIn Events (Secondary Source)

LinkedIn Events detected via Unipile → deduplication before storing:

```
When LinkedIn Event detected:
  1. Check event_captures for fuzzy title match + same date (±1 day)
  2. If exact match found → skip (already captured via Google Calendar)
  3. If partial match found → check if LinkedIn Event has new info
     (speakers not in research_context, new announcements, URL)
     → merge new fields only, don't duplicate row
  4. If no match → create new event_capture from LinkedIn Event data
```

Fuzzy match threshold: 80% title similarity + same calendar day.

---

## Notification System

When drafts are ready (status → 'drafted'):

```
Always: send email "Your 3 drafts from [Event Name] are ready"

If user is currently on the website:
  + toast popup (bottom right, auto-dismiss 5s): "Drafts ready — view them"
  + in-app notification bell update (badge count +1)

Notification bell stores: event captures ready, published confirmations, errors
```

---

## Attendee Data Policy

Default behavior: store event title, time, location, description. Names only from attendees. No emails.

First time a user connects Google Calendar → consent prompt:

> "Can we store attendee names and emails from your calendar events?
> This lets us say 'you had a call with Sarah Chen — write a follow-up post.'
> You can change this anytime in Settings."

If YES → store full attendees jsonb (names + emails) on event_captures
If NO → store names only

Stored in user_settings key: `calendar_attendee_consent: true|false`

---

## Event Type Labels

```typescript
type EventType =
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

// public_event = true for: conference, meetup, hackathon, demo_day, keynote,
//                           panel, workshop, podcast, pitch
// public_event = false for: customer_call, investor_call, sales_call,
//                            interview, internal, other
```

Stored on event_captures as `event_type: text` and `is_public_event: boolean`.

---

## Tiered Access

| Tier | Monthly Event Capture Quota |
|------|-----------------------------|
| Free | 3 captures/month |
| Starter | 15 captures/month |
| Growth/Premium | Unlimited (or 100+) |

Quota checked in POST /answers and POST /auto-draft before triggering generation.
Entitlement key: `event_captures_monthly`

---

## Publish Flow (Unipile)

```
Default: Unipile
  POST api2.unipile.com/api/v1/posts
  { account_id: unipile_account_id, text: draft, provider: 'LINKEDIN'|'TWITTER' }
  Authorization: X-API-KEY: UNIPILE_API_KEY
  Idempotency-Key: post_${postId}_${platform}  ← prevents double-publish on retry

BYOK fallback (advanced users):
  Same as current publish route — direct platform API with user's own keys
  Accessible from Settings → Advanced → Bring Your Own Keys
  Unipile is the default onboarding; BYOK is opt-in

If Unipile X fails at runtime:
  Catch error, skip X draft generation, log warning
  Show user: "X posting unavailable — LinkedIn draft ready"
  Don't fail the whole generation
```

---

## Calendar Connection

Per-workspace (not per-user).

Agency use case: client A workspace connects client A's Google Calendar.
Personal workspace connects founder's own Google Calendar.
Each workspace has its own `calendar_connections` rows.

---

## Schema Summary

### New Tables

```sql
-- Per-workspace Google Calendar connections
CREATE TABLE calendar_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'google' CHECK (provider IN ('google')),
  access_token text NOT NULL,        -- AES-256-GCM encrypted
  refresh_token text,                -- AES-256-GCM encrypted
  token_expires_at timestamptz,
  calendar_id text NOT NULL,
  calendar_name text,
  sync_enabled boolean NOT NULL DEFAULT true,
  sync_status text DEFAULT 'ok' CHECK (sync_status IN ('ok', 'error', 'disconnected')),
  last_synced_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(workspace_id, provider, calendar_id)
);

-- One row per detected event
CREATE TABLE event_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  calendar_connection_id uuid REFERENCES calendar_connections(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'google' CHECK (source IN ('google', 'linkedin')),
  provider_event_id text NOT NULL,
  title text NOT NULL,
  description text,
  location text,
  attendees jsonb,                   -- null | [{ name, email? }] based on consent
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  event_type text NOT NULL DEFAULT 'other',
  is_public_event boolean NOT NULL DEFAULT false,
  questions jsonb,                   -- array of 5 strings
  answers jsonb,                     -- { "0": "...", ... }
  suggested_post_time timestamptz,
  status text NOT NULL DEFAULT 'detected'
    CHECK (status IN (
      'detected',
      'researching',
      'questions_ready',
      'drafting',
      'drafted',
      'dismissed'
    )),
  dismissed_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(workspace_id, provider_event_id)
);

-- Research stored separately — keeps event_captures rows lean
CREATE TABLE event_research (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_capture_id uuid NOT NULL REFERENCES event_captures(id) ON DELETE CASCADE,
  summary text,
  speakers jsonb,                    -- [{ name, title, handle }]
  key_topics jsonb,                  -- string[]
  key_announcements jsonb,           -- string[]
  sources jsonb,                     -- string[] of URLs used
  raw_text text,                     -- truncated article text (2000 tokens max)
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(event_capture_id)
);
```

### Modified Tables

```sql
-- Link posts back to the event that generated them
ALTER TABLE posts ADD COLUMN IF NOT EXISTS event_capture_id uuid
  REFERENCES event_captures(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS posts_event_capture
  ON posts (event_capture_id) WHERE event_capture_id IS NOT NULL;
```

### New Indexes

```sql
CREATE INDEX event_captures_workspace_status
  ON event_captures (workspace_id, status, end_time DESC);

CREATE INDEX event_captures_detected_age
  ON event_captures (workspace_id, end_time DESC)
  WHERE status = 'detected';
```

---

## New API Routes

```
-- Calendar OAuth
GET  /api/calendar/connect/google           OAuth redirect
GET  /api/calendar/callback/google          Store encrypted tokens, redirect
GET  /api/calendar/connections              List workspace calendar connections
DELETE /api/calendar/connections/[id]       Disconnect

-- Event Capture
GET  /api/event-capture                     Inbox: questions_ready + drafted
GET  /api/event-capture/dismissed           Dismissed tab (recoverable within 7d)
GET  /api/event-capture/[id]               Single capture + status (polling target)
POST /api/event-capture/[id]/answers        Submit Q&A → 202
POST /api/event-capture/[id]/auto-draft     Quick draft → 202
POST /api/event-capture/[id]/process        Internal: background generation
POST /api/event-capture/[id]/dismiss        Soft dismiss
POST /api/event-capture/[id]/restore        Un-dismiss
POST /api/event-capture/trigger             Manual trigger from calendar page

-- Unipile
GET  /api/social-accounts/connect/unipile   Hosted connect redirect
POST /api/webhooks/unipile                  Incoming events (validate signature)
```

---

## Cron Schedule (vercel.json)

```json
{ "path": "/api/cron/calendar-sync",   "schedule": "0 * * * *"    },
{ "path": "/api/cron/event-enrich",    "schedule": "*/15 * * * *"  },
{ "path": "/api/cron/publish",         "schedule": "*/5 * * * *"   },
{ "path": "/api/cron/engagement-sync", "schedule": "0 */2 * * *"   },
{ "path": "/api/cron/auto-generate",   "schedule": "0 */6 * * *"   },
{ "path": "/api/cron/intelligence-sync","schedule": "0 2 * * *"    }
```

Note: On Vercel Hobby (free tier), minimum cron interval is 60 minutes.
`event-enrich` cannot run every 15 min on free tier.
Workaround: bundle Stage 2 at end of `calendar-sync` cron until plan upgrade.

---

## New Environment Variables

```env
GOOGLE_CALENDAR_CLIENT_ID=
GOOGLE_CALENDAR_CLIENT_SECRET=
SERPER_API_KEY=
UNIPILE_API_KEY=
UNIPILE_WEBHOOK_SECRET=      # HMAC-SHA256 signature validation
# Already exists:
# SUPERMEMORY_API_KEY
# CRON_SECRET
# TOKEN_ENCRYPTION_KEY
# INSFORGE_SERVICE_ROLE_KEY
```

---

## Hard Constraints (Non-Negotiable)

1. Always use `generateWithVoicePipeline` — never raw `generateContent` for event drafts
2. Google Calendar tokens encrypted at rest — `encryptToken` before DB, `decryptToken` only in cron
3. SSRF protection — reuse `assertPublicUrl` from voice-lab/import, do not write new fetch
4. Cron routes use `getServiceClient()` + `CRON_SECRET` bearer auth — no session cookies ever
5. Memory writes never block publishing — always try/catch, never await in critical path
6. Workspace scope everything — `calendar_connections`, `event_captures`, `event_research` all filtered by `workspace_id`
7. Generate only for platforms connected via Unipile — don't create X draft if user hasn't connected X
8. No auto-posting — all drafts require user review and publish action
9. Unipile publish calls include idempotency key — prevents double-publish on timeout/retry
10. Validate Unipile webhook signature on every incoming event — high-risk surface
11. `last_synced_at` written ONLY after successful fetch+upsert — prevents gaps on cron failure
12. Per-connection error handling in Stage 1 — one bad token does not kill other users' sync
13. Answers sanitized before storage — trim, strip control chars, max 500 chars each
14. Research text truncated to 2000 tokens before any Claude call
15. LinkedIn Events deduplicated against existing event_captures before inserting
16. Dismissed events soft-deleted — recoverable within 7 days via /dismissed tab

---

## Production Hardening Addendum
> Added: 2026-06-25 — finalized post senior-dev cross-review

### Shared Infrastructure Tables (defined here, used by all 5 layers)

#### 1. Jobs Table — Lightweight Queue

Replaces pure cron table-scans. Crons that do work enqueue a job row and a separate cron drains it. Gives retry logic, "process once" semantics, and visibility into what's queued.

```sql
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  last_error text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX jobs_pending
  ON jobs (type, created_at ASC) WHERE status = 'pending';

CREATE INDEX jobs_workspace_status
  ON jobs (workspace_id, status, created_at DESC);
```

**Job types used across all layers:**

| type | Created by | Consumed by |
|------|-----------|-------------|
| `enrich_event` | L1 Stage 1 calendar-sync | L1 Stage 2 event-enrich cron |
| `memory_write` | L3 publish route | L3 async worker (optional v1) |
| `update_voice_metrics` | L4 publish route | L4 async worker (optional v1) |
| `check_comment_signal` | L5 engagement sync | L5 signal processing (optional v1) |

---

#### 2. Feature Flags Table — Per-Layer Kill Switches

Flip `enabled = false` in InsForge dashboard → layer stops immediately. No redeploy needed.

```sql
CREATE TABLE feature_flags (
  name text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  description text,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- Seed: all layers on by default
INSERT INTO feature_flags (name, description) VALUES
  ('layer1_calendar_sync',      'Stage 1: Google Calendar → DB sync'),
  ('layer1_event_enrich',       'Stage 2: Event research + Haiku question generation'),
  ('layer1_draft_generation',   'Stage 3: Background draft generation via voice pipeline'),
  ('layer2_intelligence_sync',  'Nightly RL hook scoring from real engagement data'),
  ('layer3_memory_writes',      'Post publish → Supermemory addMemory + brain sync'),
  ('layer4_voice_metrics',      'Voice fingerprint EMA updates after each publish'),
  ('layer5_engagement_signals', 'Comment signal detection + auto content idea extraction');
```

```typescript
// src/lib/feature-flags.ts
export async function isEnabled(
  client: InsforgeClient,
  flagName: string,
): Promise<boolean> {
  const { data } = await client.database
    .from('feature_flags')
    .select('enabled')
    .eq('name', flagName)
    .single();
  return data?.enabled ?? true; // default enabled if flag row missing
}
```

---

#### 3. Daily AI Usage Table — 80% Warn / 100% Hard Stop

Per-workspace per-day cap. At 80%: log warning. At 100%: call blocked, layer skips gracefully.

```sql
CREATE TABLE daily_ai_usage (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  model text NOT NULL CHECK (model IN ('haiku', 'sonnet')),
  call_count int NOT NULL DEFAULT 0,
  PRIMARY KEY (workspace_id, date, model)
);

CREATE INDEX daily_ai_usage_lookup
  ON daily_ai_usage (workspace_id, date DESC);
```

```typescript
// src/lib/ai-budget.ts
const DAILY_LIMITS: Record<string, { warn: number; hard: number }> = {
  haiku:  { warn: 80, hard: 100 },  // per workspace per day
  sonnet: { warn: 20, hard: 25  },  // per workspace per day
};

export type BudgetStatus = 'ok' | 'warn' | 'blocked';

export async function checkAndIncrementUsage(
  client: InsforgeClient,
  workspaceId: string,
  model: 'haiku' | 'sonnet',
): Promise<BudgetStatus> {
  const today = new Date().toISOString().split('T')[0];

  const { data } = await client.database
    .from('daily_ai_usage')
    .upsert(
      { workspace_id: workspaceId, date: today, model, call_count: 0 },
      { onConflict: 'workspace_id,date,model' },
    )
    .select('call_count')
    .single();

  const count = data?.call_count ?? 0;
  const { warn, hard } = DAILY_LIMITS[model];

  if (count >= hard) {
    console.warn('[ai-budget] hard cap hit', { workspaceId, model, count });
    return 'blocked';
  }

  await client.database
    .from('daily_ai_usage')
    .update({ call_count: count + 1 })
    .eq('workspace_id', workspaceId)
    .eq('date', today)
    .eq('model', model);

  if (count >= warn) {
    console.warn('[ai-budget] warn threshold reached', { workspaceId, model, count });
    return 'warn';
  }
  return 'ok';
}
```

Default limits are starter-tier values. Adjust per plan in future via a `workspace_limits` table.

---

### L1-Specific Changes

#### Stage 1 → Enqueue Instead of Inline

Stage 1 no longer bundles Stage 2 inline (the old Hobby-tier workaround). Instead Stage 1 creates a job; Stage 2 drains it on its own schedule.

```typescript
// In Stage 1 cron, after successful event_captures upsert:
await client.database.from('jobs').insert({
  type: 'enrich_event',
  workspace_id: capture.workspace_id,
  payload: { event_capture_id: capture.id },
});
```

Stage 2 cron (`event-enrich`) updated:

```typescript
// 1. Check flag
if (!await isEnabled(client, 'layer1_event_enrich')) return;

// 2. Claim pending jobs (LIMIT 20 per run — across all workspaces)
const { data: pendingJobs } = await client.database
  .from('jobs')
  .select('*')
  .eq('type', 'enrich_event')
  .eq('status', 'pending')
  .lt('attempts', 3)
  .order('created_at', { ascending: true })
  .limit(20);

// 3. Mark claiming (prevents double-processing on overlapping runs)
await client.database
  .from('jobs')
  .update({ status: 'processing', updated_at: new Date().toISOString() })
  .in('id', pendingJobs.map(j => j.id));

// 4. Process each job
for (const job of pendingJobs) {
  try {
    const budget = await checkAndIncrementUsage(client, job.workspace_id, 'haiku');
    if (budget === 'blocked') {
      // re-queue for tomorrow
      await client.database.from('jobs')
        .update({ status: 'pending', attempts: job.attempts + 1 })
        .eq('id', job.id);
      continue;
    }
    // ... existing enrich logic ...
    await client.database.from('jobs')
      .update({ status: 'done', updated_at: new Date().toISOString() })
      .eq('id', job.id);
  } catch (err) {
    await client.database.from('jobs').update({
      status: job.attempts + 1 >= job.max_attempts ? 'failed' : 'pending',
      attempts: job.attempts + 1,
      last_error: String(err),
    }).eq('id', job.id);
  }
}
```

#### Additional Hard Constraints (L1)

17. Check `layer1_calendar_sync` flag at top of Stage 1 cron — return early if disabled
18. Check `layer1_event_enrich` flag at top of Stage 2 cron — return early if disabled
19. Check `layer1_draft_generation` flag before triggering background generation
20. Stage 1 creates `enrich_event` jobs — never calls Stage 2 inline (replaces old Hobby-tier bundling)
21. Stage 2 claims jobs (status → 'processing') before enriching — prevents double-processing on overlapping cron runs
22. Failed jobs increment `attempts` — abandoned at `max_attempts=3`, never silently loop forever
