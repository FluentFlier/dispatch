# Content OS — Next Wave Architecture Design
> Date: June 2026 | Pre-implementation design doc
> Read this before writing any code in the next wave.
> Branch: phase/workspace-migration (this doc), then phase/<feature> per layer.

---

## What This Covers

Five architecture layers that must be designed before any code is written:

1. **Event Capture** — the killer feature. Calendar → event → Q&A → drafts.
2. **Intelligence Pipeline** — wiring the RL loop with real signals.
3. **Memory Layer** — Supermemory write path for published content.
4. **Voice Fingerprint** — persistent aggregate scores per workspace.
5. **Engagement Loop** — reply → content signal → new idea.

Plus: how all five connect into the Loop (Signal → Draft → Publish → Reply → Learn).

Read the feature status table in `md_files/Senior_Dev_Analysis_Jun2026.md` first.
Do not build what is already built.

---

## The Loop — Architectural North Star

Every system in this doc exists to close one circuit:

```
SIGNAL ──────────────────────────────────────────────────────┐
  Calendar event ends → Event Capture                         │
  High-signal reply → Engagement Loop → content idea          │
                                                              ↓
DRAFT                                                    LEARN
  Event answers + voice pipeline + memory context         RL loop
  → 3 platform-native drafts                          ← hook scores
                                                       ← voice metrics
  ↓
PUBLISH
  Ayrshare queue (reliable)
  → triggers Memory Write Pipeline
    → addMemory (Supermemory)
    → syncBrainPublishedPost (Brain pages)
    → workspace_voice_metrics upsert
    → performance_signals insert (for RL)
  ↓
REPLY
  engagement-sync cron → comment sync
  AI drafts replies → human approval
  High-signal comments → new content ideas
```

Nothing in this doc is optional. Each layer is load-bearing for the loop.

---

## Layer 1: Event Capture System

### What It Is

After a high-signal calendar event ends, Content OS automatically triggers a capture flow:
1. Detects the event from Google Calendar / Notion Calendar
2. Researches it via web search (speakers, announcements, agenda)
3. Generates 5 event-specific targeted questions
4. User answers (text now, mic / Whisper in a future wave)
5. Voice pipeline generates LinkedIn post, X thread, Threads post from the answers

This replaces the "open blank doc, try to remember what happened" workflow.

### Schema

```sql
-- Calendar connections (OAuth per workspace)
CREATE TABLE calendar_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  provider text NOT NULL CHECK (provider IN ('google', 'notion')),
  access_token text NOT NULL,          -- AES-256-GCM encrypted
  refresh_token text,                  -- AES-256-GCM encrypted
  token_expires_at timestamptz,
  calendar_id text NOT NULL,           -- Google: calendarId, Notion: database_id
  sync_enabled boolean NOT NULL DEFAULT true,
  last_synced_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(workspace_id, provider, calendar_id)
);

-- Captured events awaiting content creation
CREATE TABLE event_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  calendar_connection_id uuid REFERENCES calendar_connections(id) ON DELETE SET NULL,
  provider_event_id text NOT NULL,
  title text NOT NULL,
  description text,
  location text,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  research_context jsonb,              -- web search results about this event
  questions jsonb,                     -- 5 generated questions (array of strings)
  answers jsonb,                       -- user's answers keyed by question index
  status text NOT NULL DEFAULT 'detected'
    CHECK (status IN ('detected','researching','questions_ready','answered','drafting','drafted','dismissed')),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(workspace_id, provider_event_id)
);

-- FK from posts back to the event that generated them
ALTER TABLE posts ADD COLUMN IF NOT EXISTS event_capture_id uuid REFERENCES event_captures(id) ON DELETE SET NULL;
```

### API Surface

| Route | Method | What it does |
|-------|--------|-------------|
| `/api/calendar/connect/google` | GET | OAuth redirect to Google Calendar |
| `/api/calendar/callback/google` | GET | Handle OAuth callback, encrypt + store tokens |
| `/api/calendar/connections` | GET | List connected calendars for workspace |
| `/api/calendar/connections/[id]` | DELETE | Disconnect a calendar |
| `/api/event-capture` | GET | List pending event captures (needs answers) |
| `/api/event-capture/[id]` | GET | Get single capture with questions |
| `/api/event-capture/[id]/answers` | POST | Submit answers → trigger draft generation |
| `/api/event-capture/[id]/dismiss` | POST | Skip this event |

### Background Job (Cron)

Add to Vercel cron schedule (`vercel.json`):
```json
{ "path": "/api/cron/calendar-sync", "schedule": "0 * * * *" }
```

`GET /api/cron/calendar-sync`:
1. Load all `calendar_connections` where `sync_enabled = true`
2. For each: call Google Calendar API, fetch events that ended in last 2 hours
3. For each event: upsert `event_captures` with `status: 'detected'`
4. For new captures: trigger research step (call Tavily/Brave Search API with event title + date)
5. Update `research_context`, set `status: 'researching'` → `'questions_ready'`
6. Generate 5 targeted questions using Claude with event title + description + research_context
7. Store questions in `event_captures.questions`, set `status: 'questions_ready'`
8. Surface to user via inbox / notification

### Draft Generation Flow (on answer submit)

```
POST /api/event-capture/[id]/answers
  body: { answers: { "0": "...", "1": "..." } }
  ↓
1. Load event, questions, answers, workspace voice context
2. Build event context: title + research + Q&A pairs
3. Call generateWithVoicePipeline 3 times (LinkedIn, X, Threads) in parallel
4. Each platform uses the voice pipeline (draft→evaluate→revise→humanize)
5. Create 3 posts in DB with: event_capture_id, workspace_id, status: 'scripted'
6. Update event_captures.status = 'drafted'
7. Return { posts: [linkedin_post, x_post, threads_post] }
```

### What NOT to Build (This Wave)

- Whisper voice input for answers (text-first, audio is a future wave)
- ElevenLabs voice clone (future wave)
- Notion Calendar integration (Google first per platform rollout strategy)
- Instagram/Reddit event posts (LinkedIn + X + Threads only per rollout order)

---

## Layer 2: Intelligence Pipeline — RL Loop with Real Signals

### Current State

`rl-trainer.ts` has working logic — `updateFromPerformance(signals)` updates hook scores based on engagement rate, leads, success signals. The only problem: it's called with empty arrays. Real signals never flow in.

`PerformanceSignal` interface:
```ts
interface PerformanceSignal {
  hookId?: string;         // which hook from dataset was used
  engagementRate?: number; // (likes + replies) / impressions proxy
  leadsGenerated?: number; // from engagement categorization
  success?: boolean;       // post performed well overall
}
```

### The Two Missing Connections

**Connection 1: Track which hook was used when generating a post.**

When `generateWithVoicePipeline` runs, `getBestHooksForContext` selects top hooks from the dataset and injects them into the prompt. Currently the returned hook IDs are discarded. They need to be stored on the post.

Schema addition:
```sql
ALTER TABLE posts ADD COLUMN IF NOT EXISTS used_hook_ids jsonb; -- array of hook IDs from dataset
```

In `voice-pipeline.ts`, after calling `getBestHooksForContext`, store the returned IDs and attach to the generated post.

**Connection 2: After engagement sync, pass real signals to RL trainer.**

When a post's views/saves/likes are logged (manually or via engagement-sync), calculate the signal and call `updateFromPerformance`.

### New Cron: `intelligence-sync`

```json
{ "path": "/api/cron/intelligence-sync", "schedule": "0 2 * * *" }
```

`GET /api/cron/intelligence-sync` (runs nightly, after engagement-sync):
```
1. Query all posts from past 7 days with: status=posted AND used_hook_ids IS NOT NULL
2. For each post:
   a. Calculate engagementRate = (likes + comments) / max(views, 1)
   b. Calculate saves_rate = saves / max(views, 1)    ← strongest signal per PRODUCT_VISION
   c. Determine success = saves_rate > 0.03 (3% save rate = strong signal)
   d. Fetch leads from engagement categorization (ICP count)
3. Build PerformanceSignal[] from real data
4. Call runTrainingStep(performanceSignals, [])
5. Log: how many hooks updated, patterns extracted
```

### Edit Feedback Loop (Secondary)

When a user edits a generated draft significantly before publishing:
- Calculate edit magnitude (Levenshtein distance as % of original)
- If > 30%: call `updateFromEdits` with the original hook text
- This penalizes hook patterns that consistently require heavy rewriting

Wire this into `PATCH /api/posts/[id]` — when `script` or `caption` changes, compare to original generated content and compute magnitude.

### Hook Score Persistence

Currently `saveHookDataset` writes to file (serverless-incompatible). The `hook_examples` DB table is the long-term source. Architecture:

```
updateFromPerformance
  ↓ updates in-memory dataset scores
  ↓ saveHookDataset (file write — ignored in serverless, ok as dev cache)
  ↓ ALSO: upsert scores to hook_examples table in DB
```

Add `score` and `confidence` columns to `hook_examples` table. `getBestHooksForContext` should prefer DB scores over in-memory scores in production.

---

## Layer 3: Memory Layer — Complete Write Path

### Current State (Post Audit)

| Path | Status |
|------|--------|
| Voice persona → Supermemory | ✅ Works via voice-lab/save → storePersona |
| Published posts → Supermemory | ❌ addMemory never called |
| Brain pages (InsForge) | ✅ syncBrainPublishedPost works |
| Brain pages workspace-scoped | ❌ no workspace_id column |
| Story Bank → generation context | ❌ not injected into loadCreatorVoiceContext |
| Supermemory search on generation | ⚠️ Fails silently without API key |

### 3.1 Supermemory Write Path for Published Posts

Wire into `syncBrainPublishedPost` in `src/lib/brain/sync.ts`.
After the brain page write, add:

```ts
// After putBrainPage for the published post:
try {
  const { addMemory } = await import('@/lib/supermemory');
  const memoryContent = [
    `Published ${post.platform} post (${post.pillar}):`,
    content,
    post.views ? `Performance: ${post.views} views, ${post.saves ?? 0} saves` : '',
  ].filter(Boolean).join('\n\n');

  await addMemory({
    content: memoryContent,
    containerTags: [
      workspaceId ? `workspace_${workspaceId}` : `user_${userId}`,
      'published_post',
      post.platform,
      post.pillar,
    ],
    customId: `post_${postId}`,
    metadata: {
      type: 'published_post',
      platform: post.platform,
      pillar: post.pillar,
      views: post.views ?? 0,
      saves: post.saves ?? 0,
      posted_date: post.posted_date ?? '',
    },
  });
} catch {
  // Non-critical — Supermemory is additive, never blocking
}
```

`syncBrainPublishedPost` needs a `workspaceId` parameter. Add it to the function signature and thread it through from `processPublishJob` and `syncCreatorBrainFull`.

### 3.2 Workspace Isolation for Memory

**Supermemory containerTags** — change from `user_${userId}` to `workspace_${workspaceId}` everywhere. Search also changes to use workspace tag. This means each client workspace has its own semantic memory namespace.

**Brain pages** — add `workspace_id` column:
```sql
ALTER TABLE creator_brain_pages
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
```
Update `getBrainPage`, `putBrainPage`, `listBrainPages` to filter by `workspace_id` when provided.

### 3.3 Story Bank → Generation Context

In `loadCreatorVoiceContext`, after loading brain snippets, inject top mined Story Bank entries:

```ts
// After retrieveBrainContext call:
try {
  const { data: storyRows } = await client.database
    .from('story_bank')
    .select('mined_angle, mined_hook, pillar')
    .eq('user_id', userId)
    .eq('used', false)
    .not('mined_angle', 'is', null)
    .order('created_at', { ascending: false })
    .limit(3);

  if (storyRows?.length) {
    const storySnippets = storyRows.map(
      (s) => `Story angle: ${s.mined_angle}\nHook: ${s.mined_hook ?? ''}`
    );
    // Inject as additional context in buildVoiceContextAdditions
    contextAdditions += '\n\nUNUSED STORY BANK ENTRIES (draw from these if relevant):\n'
      + storySnippets.join('\n---\n');
  }
} catch {
  // Non-critical
}
```

If workspace_id is provided, also filter by workspace_id.

### 3.4 Supermemory Graceful Fallback

When `SUPERMEMORY_API_KEY` is not set, `searchUserContext` throws and is silently caught — returning nothing. This is acceptable (graceful degradation). But callers should know the difference between "no memories" and "key not configured."

Add an `isSupermemoryConfigured()` export to `supermemory.ts`:
```ts
export function isSupermemoryConfigured(): boolean {
  return !!process.env.SUPERMEMORY_API_KEY;
}
```

Log a one-time warning at boot if not configured. Do not fail hard.

---

## Layer 4: Voice Fingerprint as Persistent State

### What It Is

The voice pipeline already returns `voice_match_score` (0-100) and `ai_score` (0-100) per post. Currently these sit on the post row and are never aggregated. The fingerprint panel in Voice Lab shows static user-defined traits.

Architecture: store rolling aggregate scores per workspace + platform + pillar. Surfaced as "Your Voice Fingerprint" — a live signal that improves as more posts are published.

### Schema

```sql
CREATE TABLE workspace_voice_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  platform text NOT NULL,
  pillar text,                          -- null = aggregate across all pillars
  avg_voice_match_score numeric(5,2) NOT NULL DEFAULT 0,
  avg_ai_score numeric(5,2) NOT NULL DEFAULT 0,
  post_count int NOT NULL DEFAULT 0,
  last_post_id uuid REFERENCES posts(id) ON DELETE SET NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(workspace_id, platform, pillar)
);

CREATE INDEX workspace_voice_metrics_ws ON workspace_voice_metrics (workspace_id);
```

### Update Flow

After every post is published AND voice pipeline evaluation scores are available:

```ts
// In processPublishJob, after status = 'published':
// (post.voice_match_score and post.ai_score are set at generation time)
async function updateVoiceMetrics(client, userId, workspaceId, post) {
  if (!post.voice_match_score) return;

  const rows = [
    { platform: post.platform, pillar: post.pillar },
    { platform: post.platform, pillar: null },  // platform-level aggregate
  ];

  for (const row of rows) {
    // Exponential moving average (recent posts weighted more)
    const existing = await getExistingMetric(client, workspaceId, row.platform, row.pillar);
    const alpha = 0.3; // weight for new data point
    const newVoice = existing
      ? alpha * post.voice_match_score + (1 - alpha) * existing.avg_voice_match_score
      : post.voice_match_score;
    const newAi = existing
      ? alpha * post.ai_score + (1 - alpha) * existing.avg_ai_score
      : post.ai_score;

    await client.database.from('workspace_voice_metrics').upsert({
      workspace_id: workspaceId,
      user_id: userId,
      platform: row.platform,
      pillar: row.pillar,
      avg_voice_match_score: newVoice,
      avg_ai_score: newAi,
      post_count: (existing?.post_count ?? 0) + 1,
      last_post_id: post.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id,platform,pillar' });
  }
}
```

### API

`GET /api/voice-metrics` — returns all metric rows for active workspace. Used by Voice Lab page to render the fingerprint panel.

### Generation Integration

In `loadCreatorVoiceContext`, inject the workspace's voice metrics as a self-awareness signal:

```ts
// After loading profile:
const metrics = await getVoiceMetrics(client, workspaceId);
if (metrics.length) {
  const metricsContext = metrics
    .filter(m => m.pillar === null)  // platform-level aggregates only
    .map(m => `${m.platform}: ${m.avg_voice_match_score.toFixed(0)}/100 voice match, ${m.avg_ai_score.toFixed(0)}/100 AI detection`)
    .join('\n');
  contextAdditions += `\n\nVOICE PERFORMANCE HISTORY:\n${metricsContext}`;
}
```

This tells the AI: "this creator's LinkedIn posts score 82/100 voice match, 8/100 AI detection. Maintain that standard."

---

## Layer 5: Engagement Loop (Reply → Content)

### Current State

- Comment sync: works via `engagement-sync` cron
- Draft replies: `draftEngagementReplies` works
- Send replies: `/api/engagement/send` works
- **Missing:** detecting which comments are content signals and converting them to new ideas

### What a Content Signal Is

A comment is a content signal when:
- High engagement itself (many likes on the comment, or it sparks a thread)
- It asks a question the creator could answer with a post
- It contradicts or challenges the post (good hook for a follow-up)
- It reveals an insight the creator hadn't considered

### Architecture

**Step 1: Content signal detection** (runs in `draftEngagementReplies`, which already processes each comment)

After drafting a reply, run a secondary prompt:
```
Is this comment a signal for new content? Assess:
- Does it ask a question worth a full post?
- Does it reveal a perspective worth addressing?
- Could this comment serve as a hook for a follow-up post?

Return JSON: { is_signal: boolean, angle: string | null, suggested_pillar: string | null }
```

**Step 2: Schema**

```sql
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS is_content_signal boolean DEFAULT false;
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS content_angle text;
ALTER TABLE post_comments ADD COLUMN IF NOT EXISTS signal_processed_at timestamptz;
```

**Step 3: Signal → Content Idea or Story Bank entry**

When `is_signal = true`:
- Create a `content_ideas` row (workspace-scoped):
  ```ts
  await client.database.from('content_ideas').insert([{
    user_id: userId,
    workspace_id: workspaceId,
    idea: `[From reply to "${post.title}"] ${contentAngle}`,
    pillar: suggestedPillar,
    priority: 'medium',
    notes: `Source comment: "${comment.comment_text}" — @${comment.author_handle}`,
    converted: false,
  }]);
  ```
- OR create a `story_bank` entry if the comment reveals a personal experience

**Step 4: UI surface**

In the Engagement Inbox: for comments where `is_content_signal = true`, show a small "→ Draft post" button alongside the reply button. Clicking it pre-fills the Generate tab's relevant template with the angle.

### What NOT to Build (This Wave)

- Safe auto-reply (Horizon 3, requires approval rules config)
- Reddit integration (Horizon 3)
- A/B testing on reply hooks

---

## Integration: How All 5 Connect

### Data Flow Through the Full Loop

```
1. SIGNAL
   ├── Calendar event ends
   │     → calendar-sync cron creates event_capture
   │     → researches event, generates 5 questions
   │     → user answers in capture inbox
   └── High-signal reply
         → engagement content signal detected
         → content_idea created

2. DRAFT
   ├── Event answers → generateWithVoicePipeline (3 platforms)
   └── Content idea → user clicks "Generate" → generateWithVoicePipeline
   Both paths use:
     - Creator Brain snippets (brain pages)
     - Story Bank entries (top 3 unused)
     - Supermemory search (past content on topic)
     - Hook Intelligence (top 6 hooks injected)
     - Voice metrics context ("your LinkedIn scores 82/100")
     - Workspace-scoped creator profile

3. PUBLISH
   → processPublishJob completes
   → Triggers all Memory Write operations in parallel:
       a. syncBrainPublishedPost (brain pages) — already wired
       b. addMemory (Supermemory) — new
       c. updateVoiceMetrics (workspace_voice_metrics) — new
       d. Insert performance_signal row — new
       e. Store used_hook_ids on post — new

4. REPLY
   → engagement-sync cron pulls comments
   → draftEngagementReplies generates replies
   → Content signal detection runs
   → High-signal comments → content_ideas

5. LEARN (nightly, intelligence-sync cron)
   → Collect posts from past 7 days with used_hook_ids
   → Calculate save_rate, engagement_rate per post
   → Build PerformanceSignal[]
   → runTrainingStep(signals, edit_diffs)
   → Hook scores updated
   → Next generation's hook selection uses better scores
```

### New Cron Schedule (vercel.json additions)

```json
{
  "crons": [
    { "path": "/api/cron/publish",            "schedule": "*/5 * * * *"  },
    { "path": "/api/cron/engagement-sync",    "schedule": "0 */2 * * *"  },
    { "path": "/api/cron/auto-generate",      "schedule": "0 */6 * * *"  },
    { "path": "/api/cron/calendar-sync",      "schedule": "0 * * * *"    },
    { "path": "/api/cron/intelligence-sync",  "schedule": "0 2 * * *"    }
  ]
}
```

---

## Schema Summary — All New Tables and Columns

```sql
-- NEW TABLES
CREATE TABLE calendar_connections (...);     -- Layer 1
CREATE TABLE event_captures (...);           -- Layer 1
CREATE TABLE workspace_voice_metrics (...);  -- Layer 4

-- NEW COLUMNS ON EXISTING TABLES
ALTER TABLE posts ADD COLUMN event_capture_id uuid;   -- Layer 1
ALTER TABLE posts ADD COLUMN used_hook_ids jsonb;     -- Layer 2
ALTER TABLE post_comments ADD COLUMN is_content_signal boolean;   -- Layer 5
ALTER TABLE post_comments ADD COLUMN content_angle text;          -- Layer 5
ALTER TABLE post_comments ADD COLUMN signal_processed_at timestamptz; -- Layer 5
ALTER TABLE creator_brain_pages ADD COLUMN workspace_id uuid;     -- Layer 3

-- hook_examples (add score columns for DB-backed RL)
ALTER TABLE hook_examples ADD COLUMN IF NOT EXISTS rl_score numeric(5,2);
ALTER TABLE hook_examples ADD COLUMN IF NOT EXISTS rl_confidence numeric(4,3) DEFAULT 0.5;
ALTER TABLE hook_examples ADD COLUMN IF NOT EXISTS rl_updated_at timestamptz;
```

---

## Build Order

Build in this order — each layer depends on the previous one's data.

```
Phase 1: Schema migration (all new tables + columns)
  Branch: phase/next-wave-schema
  No application code. Just SQL + backfill.

Phase 2: Memory Write Path (Layer 3)
  Branch: phase/memory-write
  Wire addMemory into syncBrainPublishedPost.
  Workspace-scope brain pages. Story Bank injection.
  This immediately improves every generation.

Phase 3: Intelligence Pipeline (Layer 2)
  Branch: phase/intelligence-pipeline
  Track used_hook_ids on posts.
  intelligence-sync cron with real PerformanceSignal[].
  DB-backed hook scores.

Phase 4: Voice Fingerprint (Layer 4)
  Branch: phase/voice-fingerprint
  workspace_voice_metrics update on publish.
  /api/voice-metrics endpoint.
  Inject metrics into generation context.
  Fingerprint panel in Voice Lab.

Phase 5: Event Capture (Layer 1)
  Branch: phase/event-capture
  Google Calendar OAuth.
  calendar-sync cron.
  Event capture Q&A flow.
  Multi-platform draft generation from event answers.
  THIS IS THE KILLER FEATURE. Build it last once the
  memory + intelligence layers are live — so event-generated
  posts immediately benefit from the full pipeline.

Phase 6: Engagement Loop (Layer 5)
  Branch: phase/engagement-loop
  Content signal detection in draftEngagementReplies.
  Signal → content_idea creation.
  UI surface in Engagement Inbox.
```

---

## What Each Phase Unblocks

| Phase | What starts working |
|-------|-------------------|
| 1 (schema) | Foundation for everything |
| 2 (memory write) | Generations start using past content context |
| 3 (intelligence) | Hook scores improve with real engagement data |
| 4 (voice fingerprint) | Voice consistency visible + used in generation |
| 5 (event capture) | Full calendar → post flow. The product's main loop works end-to-end. |
| 6 (engagement loop) | Reply → idea → post. Loop fully closes. |

After Phase 6: Content OS is the loop. Signal → Draft → Publish → Reply → Learn.
No other product has this. This is the moat.

---

## Hard Rules for Implementation

1. **No session cookies in background jobs.** All cron routes use `CRON_SECRET` bearer auth, not user session tokens. Service client only.
2. **Memory writes are always non-blocking.** `addMemory`, `syncBrainPublishedPost`, `updateVoiceMetrics` all in try/catch. Publishing must never fail because Supermemory is down.
3. **Workspace scope everything.** Every new table has `workspace_id`. Every query filters by it. No exceptions.
4. **Test file per phase.** `tests/phase-memory-write.test.ts`, `tests/phase-intelligence-pipeline.test.ts`, etc. Phase does not close until tests are green.
5. **No em dashes.** Not in code, not in prompts, not in UI copy.
6. **LinkedIn + X first.** Event Capture generates LinkedIn, X, Threads only. Instagram requires image logic (skip for now). Reddit = Horizon 3.
7. **Voice pipeline for all generation.** Event answer → draft must go through `generateWithVoicePipeline`, not raw `generateContent`. Voice scores must be attached to event-generated posts.
