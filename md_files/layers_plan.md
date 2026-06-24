# Content OS — Next Wave Layers Plan
> Quick-reference for all 5 architecture layers.
> Full design: `docs/plans/2026-06-next-wave-architecture.md`
> Read `md_files/Senior_Dev_Analysis_Jun2026.md` before starting any layer.

---

## Build Order

```
Phase 1  schema migration      → new tables + columns, no app code
Phase 2  memory write path     → immediately improves every generation
Phase 3  intelligence pipeline → hook scores update from real engagement
Phase 4  voice fingerprint     → voice metrics visible + used in generation
Phase 5  event capture         → THE killer feature, benefits from all prior phases
Phase 6  engagement loop       → reply → content idea, loop fully closed
```

Each phase gets its own branch (`phase/<name>`) and test file (`tests/phase-<name>.test.ts`).
Phase does not close until: build green + tests green + every plan item manually checked.

---

## Layer 1 — Event Capture

**What:** After a calendar event ends, system triggers Q&A flow → multi-platform drafts.
**Why:** The single most differentiated feature. No competitor starts from a calendar event.

### New Schema
```sql
calendar_connections (workspace_id, provider, access_token encrypted, calendar_id)
event_captures      (workspace_id, title, start/end_time, research_context,
                     questions, answers, status: detected→questions_ready→answered→drafted)
posts.event_capture_id   -- FK to event that generated this post
```

### New Routes
```
GET  /api/calendar/connect/google       OAuth redirect
GET  /api/calendar/callback/google      Store encrypted tokens
GET  /api/calendar/connections          List connected calendars
POST /api/event-capture/[id]/answers    Submit answers → trigger draft generation
GET  /api/event-capture                 List pending captures (need answers)
POST /api/event-capture/[id]/dismiss    Skip this event
```

### New Cron
```
/api/cron/calendar-sync   0 * * * *   (hourly)
  → fetch events ended in last 2h from Google Calendar
  → web research on event (Tavily/Brave)
  → generate 5 targeted questions via Claude
  → set status = questions_ready
```

### Draft Generation Flow
```
User submits answers
→ loadCreatorVoiceContext (full memory stack)
→ generateWithVoicePipeline x3 in parallel (LinkedIn, X, Threads)
→ 3 posts created with event_capture_id, workspace_id, status: scripted
```

### Hard Constraints
- Google Calendar only (Notion = later)
- Text answers only (Whisper mic = future wave)
- LinkedIn + X + Threads only (Instagram needs image logic, Reddit = Horizon 3)
- Must use `generateWithVoicePipeline` not raw `generateContent`

---

## Layer 2 — Intelligence Pipeline (RL Loop)

**What:** Wire `updateFromPerformance` in rl-trainer.ts with real signals from published posts.
**Why:** RL loop exists and works — just never called with real data. Every generation uses static scores.

### The Two Missing Connections

**1. Track which hooks were used when generating a post:**
```sql
ALTER TABLE posts ADD COLUMN used_hook_ids jsonb;
```
In `voice-pipeline.ts`: after `getBestHooksForContext`, store returned IDs on the post.

**2. Nightly cron passes real signals to trainer:**
```
/api/cron/intelligence-sync   0 2 * * *   (nightly)
  → posts from past 7 days with used_hook_ids + performance data
  → compute save_rate = saves / max(views, 1)   ← strongest signal
  → build PerformanceSignal[]
  → runTrainingStep(signals, [])
  → hook scores updated
```

### DB-Backed Hook Scores
```sql
ALTER TABLE hook_examples ADD COLUMN rl_score numeric(5,2);
ALTER TABLE hook_examples ADD COLUMN rl_confidence numeric(4,3) DEFAULT 0.5;
ALTER TABLE hook_examples ADD COLUMN rl_updated_at timestamptz;
```
`getBestHooksForContext` should prefer DB scores over in-memory scores in production.

### Edit Feedback (Secondary Signal)
In `PATCH /api/posts/[id]`: if `script` or `caption` changes >30% from generated original, call `updateFromEdits`. Penalizes hooks that consistently require heavy rewriting.

---

## Layer 3 — Memory Write Path

**What:** Wire Supermemory write path for published posts. Workspace-isolate brain pages. Inject Story Bank into generation.
**Why:** `storePersona` already works (voice lab save). `addMemory` for published posts = completely missing.

### 3.1 Wire addMemory on Publish
In `src/lib/brain/sync.ts` `syncBrainPublishedPost`:
```ts
// After putBrainPage:
await addMemory({
  content: `Published ${platform} post (${pillar}):\n${content}`,
  containerTags: [`workspace_${workspaceId}`, 'published_post', platform, pillar],
  customId: `post_${postId}`,
  metadata: { type: 'published_post', views, saves, posted_date },
});
```
Add `workspaceId` param to `syncBrainPublishedPost`. Thread through from `processPublishJob` and `syncCreatorBrainFull`.

### 3.2 Workspace Isolation
- Supermemory containerTags: `workspace_${workspaceId}` not `user_${userId}`
- Brain pages: `ALTER TABLE creator_brain_pages ADD COLUMN workspace_id uuid REFERENCES workspaces(id)`
- Update `getBrainPage`, `putBrainPage`, `listBrainPages` to filter by workspace_id

### 3.3 Story Bank → Generation Context
In `loadCreatorVoiceContext`, after brain snippets:
```ts
const { data: storyRows } = await client.database
  .from('story_bank').select('mined_angle, mined_hook, pillar')
  .eq('user_id', userId).eq('used', false)
  .not('mined_angle', 'is', null)
  .order('created_at', { ascending: false }).limit(3);

if (storyRows?.length) {
  // inject as 'UNUSED STORY BANK ENTRIES' section in contextAdditions
}
```

### 3.4 Memory Writes Are Always Non-Blocking
Every `addMemory`, `syncBrainPublishedPost`, `updateVoiceMetrics` call = wrapped in try/catch.
Publishing must never fail because Supermemory is down.

---

## Layer 4 — Voice Fingerprint

**What:** Persist rolling voice scores per workspace per platform. Inject into generation.
**Why:** Scores exist per-post but never aggregated. Fingerprint never compounds.

### New Schema
```sql
CREATE TABLE workspace_voice_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  platform text NOT NULL,
  pillar text,                          -- null = platform-level aggregate
  avg_voice_match_score numeric(5,2) NOT NULL DEFAULT 0,
  avg_ai_score numeric(5,2) NOT NULL DEFAULT 0,
  post_count int NOT NULL DEFAULT 0,
  last_post_id uuid REFERENCES posts(id) ON DELETE SET NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(workspace_id, platform, pillar)
);
```

### Update Flow
After publish, for each post with `voice_match_score`:
```ts
// Exponential moving average (alpha = 0.3)
newScore = 0.3 * post.voice_match_score + 0.7 * existing.avg_voice_match_score
```
Upsert for both `(workspace_id, platform, pillar)` and `(workspace_id, platform, null)`.

### API + Generation Integration
- `GET /api/voice-metrics` → returns metrics for active workspace (Voice Lab panel)
- In `loadCreatorVoiceContext`: inject platform metrics as voice performance history
  → "Your LinkedIn posts: 82/100 voice match, 8/100 AI detection. Maintain this."

---

## Layer 5 — Engagement Loop (Reply → Content)

**What:** Detect high-signal comments and convert them into content ideas automatically.
**Why:** The Reply → Learn connection in the loop. Inbox works. Signal detection is missing.

### New Schema
```sql
ALTER TABLE post_comments ADD COLUMN is_content_signal boolean DEFAULT false;
ALTER TABLE post_comments ADD COLUMN content_angle text;
ALTER TABLE post_comments ADD COLUMN signal_processed_at timestamptz;
```

### Signal Detection
In `draftEngagementReplies`, after drafting each reply, run secondary prompt:
```
Is this comment a signal for new content?
- Does it ask a question worth a full post?
- Does it reveal a perspective worth addressing?
- Could it serve as a hook for a follow-up post?

Return: { is_signal: boolean, angle: string | null, suggested_pillar: string | null }
```

### Signal → Content Idea
When `is_signal = true`:
```ts
await client.database.from('content_ideas').insert([{
  user_id: userId,
  workspace_id: workspaceId,
  idea: `[From reply to "${post.title}"] ${angle}`,
  pillar: suggestedPillar,
  priority: 'medium',
  notes: `Source: "${comment.comment_text}" — @${comment.author_handle}`,
  converted: false,
}]);
```

### UI
In Engagement Inbox: "→ Draft post" button on comments where `is_content_signal = true`.
Clicking pre-fills the relevant Generate tab template with the angle.

### Hard Constraints
- No safe auto-reply (Horizon 3 — needs approval rules config)
- No Reddit (Horizon 3)

---

## Full Schema Change List

```sql
-- Layer 1
CREATE TABLE calendar_connections (...);
CREATE TABLE event_captures (...);
ALTER TABLE posts ADD COLUMN event_capture_id uuid;

-- Layer 2
ALTER TABLE posts ADD COLUMN used_hook_ids jsonb;
ALTER TABLE hook_examples ADD COLUMN rl_score numeric(5,2);
ALTER TABLE hook_examples ADD COLUMN rl_confidence numeric(4,3) DEFAULT 0.5;
ALTER TABLE hook_examples ADD COLUMN rl_updated_at timestamptz;

-- Layer 3
ALTER TABLE creator_brain_pages ADD COLUMN workspace_id uuid REFERENCES workspaces(id);

-- Layer 4
CREATE TABLE workspace_voice_metrics (...);

-- Layer 5
ALTER TABLE post_comments ADD COLUMN is_content_signal boolean DEFAULT false;
ALTER TABLE post_comments ADD COLUMN content_angle text;
ALTER TABLE post_comments ADD COLUMN signal_processed_at timestamptz;
```

---

## New Cron Schedule (vercel.json)

```json
{ "path": "/api/cron/publish",           "schedule": "*/5 * * * *"  },
{ "path": "/api/cron/engagement-sync",   "schedule": "0 */2 * * *"  },
{ "path": "/api/cron/auto-generate",     "schedule": "0 */6 * * *"  },
{ "path": "/api/cron/calendar-sync",     "schedule": "0 * * * *"    },
{ "path": "/api/cron/intelligence-sync", "schedule": "0 2 * * *"    }
```

---

## Hard Rules (All Phases)

1. No session cookies in background jobs. Cron routes use `CRON_SECRET` bearer auth only.
2. Memory writes never block publishing. Always try/catch, never await in critical path.
3. Workspace scope everything. Every new table has `workspace_id`. Every query filters it.
4. Test file per phase. Phase does not close until tests green + every item checked.
5. No em dashes anywhere. Not in code, not in prompts, not in UI copy.
6. LinkedIn + X first. Event Capture targets LinkedIn, X, Threads. Instagram/Reddit = later.
7. Voice pipeline for all generation. `generateWithVoicePipeline` not `generateContent`.
