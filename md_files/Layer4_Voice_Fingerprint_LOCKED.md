# Layer 4 — Voice Fingerprint
> Status: LOCKED — do not change without discussion
> Date: 2026-06-24

---

## What This Layer Does

Every generated post already returns a voice_match_score and ai_score.
Those scores are stored per post but never aggregated.

Layer 4 builds a running average across all your posts per platform,
injects that average back into generation as a quality bar,
and shows it in the Voice Lab UI.

After this layer:
- "Your last 20 LinkedIn posts: 78/100 voice match, 12/100 AI detection. Maintain or beat this."
- User can see their voice score in Voice Lab panel
- Generation uses their own baseline to calibrate output quality

---

## What Already Exists (Do Not Rebuild)

| What | Location | Status |
|------|----------|--------|
| `evaluateDraft()` — 5-metric scoring | `src/lib/voice-evaluator.ts` | ✓ Works |
| `generateWithVoicePipeline()` — returns `voice_match_score`, `ai_score`, full `evaluation` | `src/lib/voice-pipeline.ts` | ✓ Works |
| Per-post scores stored on `posts` table | `posts.voice_match_score`, `posts.ai_score` | ✓ Exists |

**Missing:** No aggregation table. No API endpoint. Not injected into generation.

---

## The 5 Evaluation Dimensions

The evaluator (`voice-evaluator.ts`) scores on:

| Dimension | What it measures |
|-----------|-----------------|
| `persona_fidelity` | How much it sounds like the user's specific voice |
| `uniqueness` | Fresh angle vs generic creator advice |
| `specificity` | Concrete details, not vague claims |
| `so_what` | Clear reader value |
| `pain_resonance` | Speaks to audience pain |
| `ai_slop` | 10 = obvious bot, 1 = fully human |

Composite `voice_match_score = (persona_fidelity / 10) × 100`
Composite `ai_score = ai_slop × 10`

All 6 dimension averages stored in `workspace_voice_metrics` for the expandable breakdown.

---

## UI Behavior (Q1: Option A + Expandable)

**Default view** (Voice Lab panel):
```
Voice Match: 78/100  (based on 12 posts)    [↓ breakdown]
AI Detection: 12/100
```

**Expanded view** (user clicks ↓ breakdown):
```
Persona Fidelity  ████████░░  82/100
Uniqueness        ███████░░░  71/100
Specificity       ████████░░  79/100
"So What" Value   ████████░░  81/100
Pain Resonance    ███████░░░  74/100
AI Detection      ██░░░░░░░░  12/100  ← lower is better
```

Per platform: LinkedIn, X, All Platforms tabs.

---

## Score Display (Q2: Option C — always show, with N-posts disclaimer)

Show from post 1. Disclaimer scales with post count:

| Posts | Disclaimer |
|-------|-----------|
| 1 | "based on 1 post" |
| 2-4 | "based on N posts — score stabilizes after 10" |
| 5-9 | "based on N posts" |
| 10+ | "based on N posts" (no extra caveat needed) |

Never hide the score. Transparency > "not enough data" gates.

---

## Generation Injection

In `loadCreatorVoiceContext`, after brain snippets, inject metrics when `post_count >= 3`:

```typescript
if (metrics && metrics.post_count >= 3) {
  contextAdditions.push(
    `Your recent ${platform} performance: ${metrics.avg_voice_match_score}/100 voice match, ` +
    `${metrics.avg_ai_score}/100 AI detection (${metrics.post_count} posts). ` +
    `Maintain or beat these scores.`
  );
}
// Below 3 posts: skip injection — not enough signal to be a useful bar
```

---

## Schema

```sql
CREATE TABLE workspace_voice_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  platform text NOT NULL CHECK (platform IN ('linkedin', 'twitter', 'threads', 'all')),
  avg_voice_match_score numeric(5,2) NOT NULL DEFAULT 0,
  avg_ai_score          numeric(5,2) NOT NULL DEFAULT 0,
  avg_persona_fidelity  numeric(5,2) NOT NULL DEFAULT 0,
  avg_uniqueness        numeric(5,2) NOT NULL DEFAULT 0,
  avg_specificity       numeric(5,2) NOT NULL DEFAULT 0,
  avg_so_what           numeric(5,2) NOT NULL DEFAULT 0,
  avg_pain_resonance    numeric(5,2) NOT NULL DEFAULT 0,
  post_count            int NOT NULL DEFAULT 0,
  last_post_id          uuid REFERENCES posts(id) ON DELETE SET NULL,
  updated_at            timestamptz DEFAULT now() NOT NULL,
  UNIQUE(workspace_id, platform)
);

CREATE INDEX workspace_voice_metrics_workspace
  ON workspace_voice_metrics (workspace_id);
```

---

## Update Logic (after every publish)

EMA alpha = 0.3. Same formula as Layer 2.

```typescript
async function updateVoiceMetrics(
  client: InsforgeClient,
  workspaceId: string,
  userId: string,
  platform: string,        // 'linkedin' | 'twitter' | 'threads'
  evaluation: VoiceEvaluationMatrix,
  voiceMatchScore: number,
  aiScore: number,
  postId: string,
): Promise<void> {
  const alpha = 0.3;

  // Update both platform-specific AND 'all' aggregate
  for (const target of [platform, 'all']) {
    const { data: existing } = await client.database
      .from('workspace_voice_metrics')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('platform', target)
      .maybeSingle();

    if (!existing) {
      // First post — insert with raw scores
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
      // EMA update
      await client.database
        .from('workspace_voice_metrics')
        .update({
          avg_voice_match_score: alpha * voiceMatchScore + (1 - alpha) * Number(existing.avg_voice_match_score),
          avg_ai_score: alpha * aiScore + (1 - alpha) * Number(existing.avg_ai_score),
          avg_persona_fidelity: alpha * evaluation.persona_fidelity * 10 + (1 - alpha) * Number(existing.avg_persona_fidelity),
          avg_uniqueness: alpha * evaluation.uniqueness * 10 + (1 - alpha) * Number(existing.avg_uniqueness),
          avg_specificity: alpha * evaluation.specificity * 10 + (1 - alpha) * Number(existing.avg_specificity),
          avg_so_what: alpha * evaluation.so_what * 10 + (1 - alpha) * Number(existing.avg_so_what),
          avg_pain_resonance: alpha * evaluation.pain_resonance * 10 + (1 - alpha) * Number(existing.avg_pain_resonance),
          post_count: existing.post_count + 1,
          last_post_id: postId,
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', workspaceId)
        .eq('platform', target);
    }
  }
}
```

Called from publish pipeline as fire-and-forget (try/catch, non-blocking).
Only runs when the post has a `voice_match_score > 0` (voice pipeline ran).
Auto-draft posts (Option A, empty answers) still generate through voice pipeline — still counted.

---

## New API Endpoint

```
GET /api/voice-metrics
  Auth: getAuthenticatedUser() + getActiveWorkspaceId()
  Returns:
  {
    platforms: {
      linkedin:  { avg_voice_match_score, avg_ai_score, post_count, breakdown: {...5 dims} },
      twitter:   { ... },
      threads:   { ... },
      all:       { ... }
    }
  }
```

Used by: Voice Lab panel, generation context injection.

---

## Code Changes Required

| File | Change |
|------|--------|
| `src/lib/voice-metrics.ts` | NEW — `updateVoiceMetrics()` function |
| `src/app/api/publish/route.ts` | After publish: call `updateVoiceMetrics()` fire-and-forget |
| `src/app/api/event-capture/[id]/process/route.ts` | Same — after event capture draft published |
| `src/lib/voice-context.ts` | Inject voice metrics into `loadCreatorVoiceContext` when `post_count >= 3` |
| `src/app/api/voice-metrics/route.ts` | NEW — GET endpoint for UI + generation |

---

## Hard Constraints

1. `updateVoiceMetrics` never blocks publishing — fire-and-forget, try/catch
2. Only count posts where `voice_match_score > 0` — manually written posts (no pipeline) excluded
3. Update both platform-specific AND 'all' aggregate on every publish
4. EMA alpha = 0.3 — same as Layer 2, prevents single outlier post distorting average
5. Generation injection only when `post_count >= 3` — below 3 = insufficient baseline
6. Always show score to user regardless of post count — with N-posts disclaimer
7. Expandable breakdown stored in DB (all 5 dimensions) — UI can always show details

---

## Production Hardening Addendum
> Added: 2026-06-25 — finalized post senior-dev cross-review

### Feature Flag

Check flag at the start of `updateVoiceMetrics`. Since it's already fire-and-forget (called after publish), disabling it freezes the EMA at its last values — metrics just stop updating until re-enabled.

```typescript
// In updateVoiceMetrics, at the very top:
if (!await isEnabled(client, 'layer4_voice_metrics')) {
  return; // freeze EMA — publish already succeeded
}
```

Flip `layer4_voice_metrics = false` in InsForge dashboard to pause metric updates. Useful when changing scoring logic or running schema migrations without corrupting running averages.

---

### No AI Cost Cap for L4

L4 is pure DB math (EMA calculation). No AI calls made. `daily_ai_usage` table not applicable.

---

### Metrics Drift — Recompute Procedure

If evaluation scoring logic changes (new dimensions, changed weights), `workspace_voice_metrics` EMA values will become inconsistent with new scores. When this happens:

1. Disable `layer4_voice_metrics` flag in InsForge dashboard
2. Run targeted clear: `DELETE FROM workspace_voice_metrics WHERE workspace_id = $id` (or `TRUNCATE workspace_voice_metrics` for all)
3. Re-enable flag — metrics rebuild naturally from the next published post onward
4. EMA stabilizes within ~10–15 posts per workspace

Do not attempt full historical recompute across all past posts. Trust the EMA to converge.

---

### Additional Hard Constraints (L4)

8. Check `layer4_voice_metrics` flag at start of `updateVoiceMetrics` — return early if disabled
9. When scoring logic changes: disable flag → clear table → re-enable. Never attempt full historical backfill.
