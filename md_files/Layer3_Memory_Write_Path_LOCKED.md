# Layer 3 — Memory Write Path
> Status: LOCKED — do not change without discussion
> Date: 2026-06-24

---

## What This Layer Does

Right now generation reads your voice profile but cannot reference what you've already
written or what you've told the system to remember.

Three gaps closed:
1. Published posts enter Supermemory → future drafts can find "you wrote about this before"
2. Brain pages become workspace-scoped → client workspaces don't bleed into each other
3. Story Bank angles feed into generation → captured memories inform new drafts

---

## What Already Exists (Do Not Rebuild)

| Function | Location | Status |
|----------|----------|--------|
| `syncBrainPublishedPost()` | `src/lib/brain/sync.ts` | ✓ Works. Wired to publish route. |
| `syncBrainVoiceLab()` | `src/lib/brain/sync.ts` | ✓ Works. Called from voice-lab/save. |
| `retrieveBrainContext()` | `src/lib/brain/retrieve.ts` | ✓ Works. Reads into generation. |
| `storePersona()` | `src/lib/supermemory.ts` | ✓ Works. Called from voice-lab/save. |
| `addMemory()` | `src/lib/supermemory.ts` | ✓ Exists. Never called for posts. |
| `searchUserContext()` | `src/lib/supermemory.ts` | ✓ Exists. Returns empty (nothing written). |

---

## Fix 1 — Wire `addMemory` for Published Posts

**Problem:** Published posts never enter Supermemory. `searchUserContext` always returns
empty. The "has this user written about this before?" search is a no-op.

**Fix:** In `syncBrainPublishedPost()`, after writing to brain pages, call `addMemory`.
Non-blocking — must never fail publishing.

```typescript
// src/lib/brain/sync.ts — syncBrainPublishedPost
// After putBrainPage:
try {
  await addMemory({
    content: [
      `Published ${post.platform} post (${post.pillar}):`,
      content,
      post.views ? `Performance: ${post.views} views, ${post.saves ?? 0} saves` : '',
    ].filter(Boolean).join('\n\n'),
    containerTags: [`workspace_${workspaceId}`, 'published_post', post.platform, post.pillar],
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
  // non-blocking — Supermemory down must not block publishing
}
```

---

## Fix 2 — Workspace-Scope Brain Pages

**Problem:** `creator_brain_pages` has no `workspace_id`. All client workspaces share one
brain per user. Agency use case breaks entirely.

**Fix:**

```sql
ALTER TABLE creator_brain_pages
  ADD COLUMN workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS creator_brain_pages_workspace
  ON creator_brain_pages (workspace_id, slug);
```

Thread `workspaceId` through all brain functions:
- `getBrainPage(client, userId, slug, workspaceId)`
- `putBrainPage(client, userId, page, workspaceId)`
- `listBrainPages(client, userId, workspaceId)`
- `retrieveBrainContext(client, userId, query, workspaceId)`

All queries filter by `workspace_id`. Brain pages created without `workspace_id` (legacy)
get backfilled to the user's primary workspace via migration.

---

## Fix 3 — Story Bank → Generation Context

**Problem:** Story Bank collects raw memories and mines angles. Those angles never appear
in generation context. Captured stories are a dead end.

**Fix:** In `loadCreatorVoiceContext`, after brain snippets, inject top 3 unused story
bank angles:

```typescript
// After brain snippets:
const { data: storyRows } = await client.database
  .from('story_bank')
  .select('mined_angle, mined_hook, pillar')
  .eq('user_id', userId)
  .eq('workspace_id', workspaceId)
  .eq('used', false)
  .not('mined_angle', 'is', null)
  .order('created_at', { ascending: false })
  .limit(3);

if (storyRows?.length) {
  contextAdditions.push(
    'UNUSED STORY BANK ANGLES (consider weaving into this draft):\n' +
    storyRows.map((s, i) => `${i + 1}. ${s.mined_angle}`).join('\n')
  );
}
```

Limit: **3 entries**. Enough to surface good material without bloating the prompt.

---

## Workspace Scope — v1 Decision: Fully Separate

**v1:** Each workspace gets its own brain namespace and its own Supermemory
container tag (`workspace_${workspaceId}`). New workspace starts fresh.

Supermemory containerTags change from `user_${userId}` → `workspace_${workspaceId}`:
- `storePersona()`: tag becomes `workspace_${workspaceId}`
- `searchUserContext()`: search `workspace_${workspaceId}` tag
- `addMemory()` for posts: tag is `workspace_${workspaceId}`

**Legacy data:** Existing Supermemory entries tagged `user_${userId}` remain.
On first access of a new workspace, copy persona from `user_${userId}` to
`workspace_${workspaceId}` once (one-time migration per workspace creation).

---

## v2 Upgrade — Shared Persona Across Workspaces

> **FUTURE FLAG for agent:** When agency tier has enough active users, implement
> Option B — shared persona + separate content memory:
> - Core voice profile (voice_description, voice_rules, content_pillars) auto-copied
>   to every new workspace the user creates
> - Published posts, story bank, event captures remain workspace-isolated
> - Implementation: on workspace creation, call `storePersona(newWorkspaceId, existingPersona)`
> Do NOT build this in v1. Fully separate is cleaner to launch with.

---

## Schema Changes

```sql
-- Workspace-scope brain pages
ALTER TABLE creator_brain_pages
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS creator_brain_pages_workspace
  ON creator_brain_pages (workspace_id, slug);

-- Backfill: assign existing brain pages to user's primary workspace
-- (run as part of Phase 1 migration after workspaces table is populated)
UPDATE creator_brain_pages cbp
SET workspace_id = (
  SELECT id FROM workspaces
  WHERE user_id = cbp.user_id
  ORDER BY created_at ASC
  LIMIT 1
)
WHERE workspace_id IS NULL;
```

---

## Code Changes Required

| File | Change |
|------|--------|
| `src/lib/brain/sync.ts` | Thread `workspaceId` through all functions. Add `addMemory` call in `syncBrainPublishedPost` (non-blocking try/catch). |
| `src/lib/brain/pages.ts` | Add `workspaceId` param to `getBrainPage`, `putBrainPage`, `listBrainPages`. Filter queries by `workspace_id`. |
| `src/lib/brain/retrieve.ts` | Add `workspaceId` param to `retrieveBrainContext`. Pass to `getBrainPage` and `listBrainPages`. |
| `src/lib/supermemory.ts` | `storePersona` and `searchUserContext` use `workspace_${workspaceId}` tag. Add `addMemoryForPost` helper. |
| `src/lib/voice-context.ts` (or wherever `loadCreatorVoiceContext` lives) | Inject top 3 unused story bank angles after brain snippets. |
| `src/app/api/publish/route.ts` | Pass `workspaceId` to `syncBrainPublishedPost`. |

---

## Hard Constraints

1. Memory writes NEVER block publishing — every `addMemory`, `syncBrainPublishedPost`,
   `updateVoiceMetrics` call wrapped in `try/catch`. Publish must succeed even if Supermemory is down.
2. Story bank injection capped at 3 entries — prevents prompt bloat.
3. All brain queries filter by `workspace_id` — cross-workspace data bleed forbidden.
4. Supermemory containerTags use `workspace_${workspaceId}` not `user_${userId}` for all new writes.
5. Legacy `user_${userId}` Supermemory data not deleted — stays for backwards compatibility.
   New workspace creation triggers one-time persona copy from user tag to workspace tag.
6. `addMemory` for posts uses `customId: post_${postId}` — idempotent, safe to re-run.

---

## Production Hardening Addendum
> Added: 2026-06-25 — finalized post senior-dev cross-review

### Feature Flag

Check flag before any memory write. Publishing has already succeeded at this point — skipping memory writes never blocks the user.

```typescript
// In syncBrainPublishedPost, before the addMemory call:
if (!await isEnabled(client, 'layer3_memory_writes')) {
  return; // skip all memory writes — publish already complete above
}
```

Flip `layer3_memory_writes = false` in InsForge dashboard to pause all Supermemory writes and brain syncs instantly. Re-enable when service recovers. Past memory entries are not lost — they stay in Supermemory; new posts just don't get added while flag is off.

---

### Optional: Queue Memory Writes via Jobs Table

Memory writes are already non-blocking (try/catch). The `jobs` table (defined in L1 addendum) can optionally give failed writes retry semantics instead of silently swallowing errors:

```typescript
// Instead of fire-and-forget try/catch around addMemory:
await client.database.from('jobs').insert({
  type: 'memory_write',
  workspace_id: workspaceId,
  payload: { post_id: postId, platform, pillar, content },
});
```

A lightweight cron claims `type='memory_write'` jobs and calls `addMemory`. Failures increment `attempts`, retry up to 3×. Gives visibility into Supermemory reliability.

**v1 decision:** keep fire-and-forget try/catch for now. Migrate to jobs if Supermemory downtime becomes measurably frequent (check monthly error logs before deciding).

---

### Supermemory Cost Monitoring

Supermemory is an external paid service. Add tracking to `daily_ai_usage` (or a separate `external_api_usage` table) if costs become material. Not required in v1 — revisit when monthly Supermemory bill exceeds ~$20.

---

### Additional Hard Constraints (L3)

7. Check `layer3_memory_writes` flag before any `addMemory` or brain sync call
8. Flag check always happens AFTER publish response — memory skip never impacts publish latency or success
