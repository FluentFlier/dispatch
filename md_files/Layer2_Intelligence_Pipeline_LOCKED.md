# Layer 2 — Intelligence Pipeline (RL Loop)
> Status: LOCKED — do not change without discussion
> Date: 2026-06-24

---

## What This Layer Does

Closes the learning loop. Every draft currently uses the same static hook dataset forever.
After this layer: hooks that perform well (real saves, real engagement) get ranked
higher for that topic next time. System gets smarter from real user data.

```
Hook used in draft → post published → accumulates saves/views
→ nightly job reads those signals
→ boosts that hook's score for that specific topic
→ next generation in that topic uses better hooks
```

---

## What Was Broken (Before This Layer)

- `runTrainingStep([], [])` called with empty arrays in engagement-sync cron.
  Trainer code is correct. Never fed real data.
- Score updates written to in-memory object → die when Vercel function terminates.
  Every new invocation restarts from bundled JSON. Nothing persisted.

---

## Recommendation Model: Topic-Matched Scoring

Hooks perform differently across topics. An event recap hook is wrong for a hot take.

**Architecture:**
- Each hook has vertical tags
- Performance scores stored per `(hook_id, vertical)` pair — NOT one global score
- RL boost from an AI post only updates that hook's AI score, not its event_recap score
- At generation: post pillar → pull hooks ranked by that vertical's specific score
- Generation receives pre-filtered shortlist (8-10 hooks) for that topic

---

## v2 Upgrade — Collaborative Filtering

> **FUTURE FLAG for agent:** When active user base reaches ~500+, add collaborative
> filtering: find users with similar content pillars and voice profiles, recommend hooks
> that performed well for similar users. Do NOT architect for this now.
> The `hook_performance` table structure below already supports this without schema
> changes. Add as a separate layer when data volume justifies it.

---

## Hook Verticals — Full Updated List

```typescript
// src/lib/hooks-intelligence/types.ts
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
  | 'event_recap'      // NEW — Event Capture (Layer 1)
  | 'founder_story'    // NEW — personal journey, building in public
  | 'product_launch'   // NEW — shipping, new features, launch day
  | 'customer_story'   // NEW — client wins, case studies
  | 'hot_take'         // NEW — contrarian opinion, unpopular truth
  | 'general';
```

### Pillar → Vertical Mapping

```typescript
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
// Fallback: 'general' for any unrecognized pillar
```

---

## RL Signal Rules

- **Primary signal:** `save_rate = saves / max(views, 1)`
- **Minimum threshold:** 100 views required before post affects any hook score.
  Below 100 = noise. Excluded entirely.
- **Success threshold:** `save_rate > 0.02 AND saves >= 5`
- **Edit feedback:** DROPPED. User edits do not indicate hook quality.
  Only post-publish engagement used as signal.
- **Future:** thumbs-down button on drafts for explicit negative feedback (v2 product decision).

---

## Schema Changes

```sql
-- Track which hooks were used when generating each post
ALTER TABLE posts ADD COLUMN IF NOT EXISTS used_hook_ids jsonb;

-- Per-topic hook performance (scores differ per vertical — never bleed across topics)
CREATE TABLE IF NOT EXISTS hook_performance (
  hook_id        text NOT NULL,
  vertical       text NOT NULL,
  rl_score       numeric(5,2) NOT NULL DEFAULT 0,
  rl_confidence  numeric(4,3) NOT NULL DEFAULT 0.5,
  sample_count   int NOT NULL DEFAULT 0,
  rl_updated_at  timestamptz,
  PRIMARY KEY (hook_id, vertical)
);

CREATE INDEX IF NOT EXISTS hook_performance_by_vertical
  ON hook_performance (vertical, rl_score DESC);
```

---

## New Nightly Cron: `/api/cron/intelligence-sync`

**Schedule:** `0 2 * * *` (nightly 2am)

```
1. Load posts from past 7 days WHERE:
     used_hook_ids IS NOT NULL
     AND views >= 100
     AND status = 'posted'
   LIMIT 500 per run

2. For each post:
     hook_ids  = post.used_hook_ids
     vertical  = PILLAR_TO_VERTICAL[post.pillar] ?? 'general'
     save_rate = post.saves / max(post.views, 1)
     success   = save_rate > 0.02 AND post.saves >= 5

3. For each hook_id in hook_ids:
     UPSERT hook_performance (hook_id, vertical):
       rl_score      = 0.3 × new_score + 0.7 × existing_score  [EMA]
       rl_confidence = min(0.99, existing + 0.02)
       sample_count  = sample_count + 1
       rl_updated_at = now()

4. Log: N signals processed, M hooks updated
```

---

## Updated Retrieval: `getBestHooksForContext`

```
1. Query hook_performance WHERE vertical = ? ORDER BY rl_score DESC LIMIT N×2
   → DB-learned scores, most reliable

2. For hooks NOT in hook_performance (new hooks, unseen verticals):
   → fall back to scorer.ts static algorithm

3. Merge: DB scores first, static scores fill remaining slots

4. Return top N
```

---

## Code Changes Required

| File | Change |
|------|--------|
| `src/lib/hooks-intelligence/types.ts` | Add 5 new `HookVertical` values + `PILLAR_TO_VERTICAL` map |
| `src/lib/voice-pipeline.ts` | After `getBestHooksForContext`, store returned IDs in `post.used_hook_ids` |
| `src/lib/hooks-intelligence/retriever.ts` | Read `hook_performance` table first, fall back to static scorer |
| `src/lib/hooks-intelligence/rl-trainer.ts` | `updateFromPerformance` writes to `hook_performance` table |
| `src/app/api/cron/engagement-sync/route.ts` | REMOVE dead `runTrainingStep([], [])` call (line 59) |
| `src/app/api/cron/intelligence-sync/route.ts` | NEW — nightly batch cron |

---

## Hard Constraints

1. Never update scores from posts with < 100 views — noise not signal
2. RL scores persist to `hook_performance` DB table — never in-memory only
3. Scores update per `(hook_id, vertical)` pair — topic bleeding forbidden
4. Save rate only signal — no edit feedback in v1
5. EMA alpha = 0.3 — prevents single viral post skewing dataset
6. Intelligence-sync nightly only — engagement needs 24-48h to accumulate
7. `PILLAR_TO_VERTICAL` always has `'general'` fallback — never crash on unknown pillar
8. `hook_performance` table designed to support Option C (collaborative filtering)
   without schema changes — add cross-user recommendations at 500+ active users

---

## Production Hardening Addendum
> Added: 2026-06-25 — finalized post senior-dev cross-review

### "Process Once" Semantics

Current nightly cron rescans all posts from past 7 days every run — re-scoring already-processed posts. Fix: track which posts have been RL-processed.

```sql
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS rl_processed_at timestamptz;

CREATE INDEX posts_rl_pending
  ON posts (created_at DESC)
  WHERE rl_processed_at IS NULL
    AND used_hook_ids IS NOT NULL;
```

Updated intelligence-sync cron query:

```
-- Step 1: only fetch unprocessed posts
SELECT * FROM posts
  WHERE rl_processed_at IS NULL
    AND used_hook_ids IS NOT NULL
    AND views >= 100
    AND status = 'posted'
  ORDER BY created_at ASC
  LIMIT 500

-- [existing EMA scoring logic unchanged]

-- Step 2: after scoring each post, mark it done
UPDATE posts SET rl_processed_at = now() WHERE id = $postId
```

Posts processed once. Future runs only see genuinely new posts.

---

### Feature Flag

```typescript
// Top of intelligence-sync cron, before any DB work:
if (!await isEnabled(client, 'layer2_intelligence_sync')) return;
```

Flip `layer2_intelligence_sync = false` in InsForge dashboard to pause nightly RL scoring without affecting any other layer. Scores freeze at last run values; generation falls back to static scorer as always.

---

### No AI Cost Cap for L2

L2 uses no AI calls — pure EMA math on existing DB data. `daily_ai_usage` table not applicable here.

---

### Additional Hard Constraints (L2)

9. Check `layer2_intelligence_sync` flag at cron start — return early if disabled
10. Set `rl_processed_at = now()` on each post after scoring — prevents re-scan on future runs
11. Index on `rl_processed_at IS NULL` required — full table scans forbidden as post count grows
