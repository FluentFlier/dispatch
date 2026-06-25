# Layer 5 — Engagement Loop (Reply → Content)
> Status: LOCKED — do not change without discussion
> Date: 2026-06-25

---

## What This Layer Does

Engagement inbox already works: comments come in, you draft replies, you send them.

What's missing: high-value comments that contain hidden content ideas get missed.
Someone asks "what's your process for building in public without burning out?" —
that's a full post. Right now it's just another comment you reply to and forget.

Layer 5 detects those signals and captures them automatically — so nothing slips through.

---

## What Already Exists (Do Not Rebuild)

| Function | Status |
|----------|--------|
| `draftEngagementReplies()` — per-comment voice-matched reply generation | ✓ Works |
| `getEngagementInbox()` — comments grouped by post | ✓ Works |
| `sendEngagementReplies()` — sends approved replies | ✓ Works |
| `bucketEngagers()` — ICP/Lead/Community/Other categorization | ✓ Works |

---

## The Full Chain

```
Comment synced into post_comments
  → bucketEngagers already runs (no change)

draftEngagementReplies() loops each comment:
  → Step 1: draft reply (existing, no change)
  → Step 2: signal check (NEW — runs after reply draft)
      ├─ skip if comment length < 50 chars (noise)
      ├─ skip if generic phrase detected:
      │    "great post", "so true", "love this", "thanks for sharing",
      │    "well said", pure emoji, single word
      └─ Haiku call: "Is this comment asking a question worth a full post?
                      Does it reveal a perspective worth addressing?
                      Could it serve as a hook for a follow-up post?
                      Return: { is_signal: boolean, angle: string, pillar: string }"

  → If is_signal = true:
      ├─ UPDATE post_comments SET
      │    is_content_signal = true,
      │    content_angle = angle,
      │    signal_processed_at = now()
      └─ INSERT content_ideas {
           workspace_id, user_id,
           idea: angle,
           pillar: suggested_pillar,
           source: 'from_comment',
           source_comment_id: comment.id,
           status: 'suggested',
           notes: 'From reply to "[post title]" — @{commenter_handle}',
           converted: false,
         }

  → If is_signal = false OR comment too short OR generic:
      UPDATE post_comments SET signal_processed_at = now()
      (mark as processed so we don't re-check it next sync)
```

---

## UX: Two Surfaces

### Surface 1 — Engagement Inbox (Option B: lightbulb indicator)

Signal comments get a 💡 chip next to the comment text.
User sees it while reviewing replies. Clicking it takes them to the Suggested Ideas pile.
If they don't click: the idea is STILL saved automatically (Option C safety net below).

```
┌────────────────────────────────────────────────────────────┐
│ @sarah_chen commented on "How I got my first 10 customers" │
│                                                            │
│ "What's your process for building in public without        │
│  burning out? I've tried but always quit after 2 weeks."  │
│                                                            │
│ [Draft reply]  [Send]  💡 Post idea saved                  │
└────────────────────────────────────────────────────────────┘
```

### Surface 2 — Ideas Page (Option C: Suggested pile)

Ideas page gets two tabs:

```
[ Active Ideas (12) ]  [ Suggested (4) ]

── Suggested ──────────────────────────────────────────────
💡 Building in public without burning out
   From: @sarah_chen's comment on "First 10 customers"
   Pillar: founder_story

   [Keep →  Active]    [Dismiss]

💡 Why most founders underestimate distribution
   From: @mkd_builds's comment on "Product vs Distribution"
   Pillar: hot_take

   [Keep →  Active]    [Dismiss]
```

**Keep** → moves idea from `status='suggested'` to `status='active'`. Appears in regular Ideas list.
**Dismiss** → soft-deletes. Gone from Suggested but not from DB (audit trail).

If user ignores inbox entirely → ideas accumulate in Suggested automatically.
Nothing is lost.

---

## Schema Changes

### `post_comments` — new columns

```sql
ALTER TABLE post_comments
  ADD COLUMN IF NOT EXISTS is_content_signal boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS content_angle text,
  ADD COLUMN IF NOT EXISTS signal_processed_at timestamptz;

CREATE INDEX IF NOT EXISTS post_comments_signals
  ON post_comments (user_id, is_content_signal)
  WHERE is_content_signal = true;
```

### `content_ideas` — new columns

```sql
ALTER TABLE content_ideas
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'from_comment', 'from_event')),
  ADD COLUMN IF NOT EXISTS source_comment_id uuid
    REFERENCES post_comments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suggested', 'dismissed'));

CREATE INDEX IF NOT EXISTS content_ideas_suggested
  ON content_ideas (workspace_id, status)
  WHERE status = 'suggested';
```

`source = 'from_event'` reserved for future: content ideas auto-created from event captures.

---

## RL Cleanup

The engagement sync (`src/lib/engagement/sync.ts`) currently calls:
```typescript
runTrainingStep(signals);  // line ~309
```

with proxy signals (`synced_count / 200` as engagementRate). This is weaker than
Layer 2's real save_rate approach and will double-count once intelligence-sync runs nightly.

**Remove this call entirely.** Layer 2 handles RL with real signals. Sync stays fast.

Also remove the `const { runTrainingStep } = await import(...)` dynamic import in sync.ts.

---

## Code Changes Required

| File | Change |
|------|--------|
| `src/lib/engagement/inbox.ts` — `draftEngagementReplies()` | After reply draft: run signal check. Insert content idea if signal. Update post_comments. |
| `src/lib/engagement/sync.ts` | Remove `runTrainingStep(signals)` call and its dynamic import. |
| `src/app/api/ideas/route.ts` | Support `status` filter param: `?status=suggested` returns suggested pile |
| `src/app/api/ideas/[id]/route.ts` | Support `PATCH { status: 'active' }` (promote) and `PATCH { status: 'dismissed' }` |
| `src/app/api/engagement/inbox/route.ts` | Include `is_content_signal`, `content_angle` in comment response |

---

## Hard Constraints

1. Signal detection runs in `draftEngagementReplies` only — not during sync. Sync stays fast.
2. Pre-filter before Haiku: length < 50 chars OR generic phrase → skip entirely, no LLM call.
3. Auto-save to `status='suggested'` always when signal detected — inbox lightbulb is discovery, not the only path.
4. `signal_processed_at` set on every comment after check — prevents re-checking on next cron.
5. Source attribution always stored: `notes = 'From reply to "[post title]" — @handle'`.
6. Workspace scoped: content_ideas created from signals include `workspace_id`.
7. No safe auto-reply — replies still require user approval. Horizon 3.
8. `source='from_event'` column reserved but unused in Layer 5 — future Event Capture → content ideas path.
9. RL removed from sync.ts — Layer 2 handles it. No double-counting.

---

## Production Hardening Addendum
> Added: 2026-06-25 — finalized post senior-dev cross-review

### Feature Flag

Check flag before Step 2 (signal detection) in `draftEngagementReplies`. Reply drafting continues working even when the flag is off — only idea extraction stops.

```typescript
// In draftEngagementReplies, before Step 2 signal check:
if (!await isEnabled(client, 'layer5_engagement_signals')) {
  // draft reply as normal, skip signal detection entirely
  return draftedReply;
}
```

Flip `layer5_engagement_signals = false` in InsForge dashboard to stop all Haiku signal calls and idea extraction without touching reply drafting.

---

### Dual AI Cost Cap — Per-Day + Per-Run

L5 is the highest-risk layer for runaway AI costs. A viral post with 500 genuine comments that all pass pre-filters = 500 Haiku calls in one sync run.

Two guards always run together:

**Guard 1 — Daily hard cap (per workspace, from shared infra in L1 addendum):**

```typescript
const budget = await checkAndIncrementUsage(client, workspaceId, 'haiku');
if (budget === 'blocked') {
  // Mark comment as processed so it's not re-checked tomorrow
  await client.database
    .from('post_comments')
    .update({ signal_processed_at: new Date().toISOString() })
    .eq('id', comment.id);
  // Skip idea extraction — budget exhausted for today
  break;
}
```

**Guard 2 — Per-run workspace cap (prevents one cron run burning full daily budget):**

```typescript
const MAX_HAIKU_CALLS_PER_WORKSPACE_PER_RUN = 25;
let haikusUsed = 0;

for (const comment of candidateComments) {
  if (haikusUsed >= MAX_HAIKU_CALLS_PER_WORKSPACE_PER_RUN) {
    console.info('[l5] per-run cap hit', { workspaceId, haikusUsed });
    break; // remaining comments stay unprocessed — next run picks them up
  }
  // ... existing pre-filter + Haiku signal check ...
  haikusUsed++;
}
```

Both guards must be present. Per-day cap = total protection. Per-run cap = prevents spikes from single events.

---

### Comment Signal Jobs (Future Migration Path)

For v1, signal detection stays inline in `draftEngagementReplies`. When workspaces regularly produce 100+ candidate comments per sync, migrate to async jobs:

```typescript
// Replace inline Haiku call with job enqueue:
await client.database.from('jobs').insert({
  type: 'check_comment_signal',
  workspace_id: workspaceId,
  payload: { comment_id: comment.id, post_id: comment.post_id },
});
```

A dedicated cron drains `check_comment_signal` jobs with full daily budget awareness. Not required in v1 — migrate when comment volume makes inline processing a bottleneck.

---

### Additional Hard Constraints (L5)

10. Check `layer5_engagement_signals` flag before Step 2 in `draftEngagementReplies` — reply drafting continues when flag is off
11. Check `checkAndIncrementUsage(workspaceId, 'haiku')` before every Haiku signal-detection call
12. Per-run cap: max 25 Haiku calls per workspace per engagement sync run (independent of daily cap)
13. Budget-blocked comments still get `signal_processed_at = now()` — no re-scan on next cron run
