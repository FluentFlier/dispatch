# Content OS — Bug Fix Implementation Plan
> Pre-feature / pre-architecture phase. Fix everything before new code lands.
> Date: June 2026 | Based on live code audit

---

## Terminology

All multi-step work is organized into **PHASES** (not sprints). Each phase has a plan, a branch, a test file, and a cross-check before it closes.

---

## Step 0: Create the Working Branch

Before touching a single file, create the branch:

```bash
git checkout main
git pull origin main
git checkout -b fix/security-and-stability
```

All changes in Phases 0-4 go on this branch. When all phases pass verification, open a PR to `main`, review, then merge. Delete the branch after merge.

**Never commit directly to `main`.**

---

## Execution Order

Five phases. Run in order. Do not start Phase 1 until Phase 0 passes all checks.

```
Phase 0  →  Security + Billing (BLOCKING — nothing ships without this)
Phase 1  →  Publish Queue Reliability
Phase 2  →  Fake Feature Cleanup + AI Infrastructure
Phase 3  →  Data Layer + Code Quality
Phase 4  →  RLS on all 12 tables (gate for multi-tenancy)
```

Phase completion gate (MUST pass before moving to next phase):
```bash
npm run build        # must exit 0
npx tsc --noEmit     # must exit 0
npm run lint         # must exit 0
npm test             # phase test file must be all green
```

Plus: manually cross-check every item in the phase plan. If any item is incomplete, fix it before moving on.

---

## Test File Convention

Each phase has a test file: `tests/phase-<name>.test.ts`

| Phase | Test file |
|-------|-----------|
| Phase 0 | `tests/phase-0-security.test.ts` |
| Phase 1 | `tests/phase-1-publish-queue.test.ts` |
| Phase 2 | `tests/phase-2-fake-feature-cleanup.test.ts` |
| Phase 3 | `tests/phase-3-data-layer.test.ts` |
| Phase 4 | `tests/phase-4-rls.test.ts` |

Each test file must include:
- One `describe` block per phase item
- At minimum: unit test for each fixed function, regression test that would have caught the original bug, security test for any security fix
- Run with `npm test` — all green before phase closes

---

## Phase 0 — Security + Billing (Must-Fix Before Anything)

### P0-1 · CRIT-A: Middleware CSRF logout
**File:** `src/middleware.ts` lines 35-45
**Problem:** Visiting `/login?expired=1` while authenticated silently clears `content-os-token` cookie. Any link can force-log out any user.
**Current code:**
```ts
if (pathname === '/login' && token && request.nextUrl.searchParams.get('expired') === '1') {
  response.cookies.set('content-os-token', '', { maxAge: 0 });
  return response;
}
```
**Fix:** Remove this block entirely. Token expiry is detected server-side in `getAuthenticatedUser()`. The `/login?expired=1` redirect should come from the server after a failed auth check, not be triggered by the client.

---

### P0-2 · CRIT-B: AI quota tracking is a no-op on DB failure
**File:** `src/lib/ai-guard.ts` line 53
**Problem:** `incrementUsage(...).catch(() => {})` silently swallows DB errors. During any InsForge hiccup, quota never increments. Users generate unlimited content on your bill.
**Current code:**
```ts
incrementUsage(userId, 'ai_generate', 1).catch(() => {});
```
**Fix:**
```ts
try {
  await incrementUsage(userId, 'ai_generate', 1);
} catch (err) {
  console.error('[ai-guard] Usage increment failed:', err);
  // Do NOT silently ignore. Log so ops can detect systematic failures.
  // Policy decision: fail open (allow generation) but always log the failure.
}
```

---

### P0-3 · CRIT-C: Auto-generate cron bypasses all quota checks
**File:** `src/app/api/cron/auto-generate/route.ts` — inside the `for` loop, before `generateContent()`
**Problem:** Cron uses admin client, calls `generateContent()` directly, never calls `guardAiRequest()` or `assertCanGenerate()`. Any free-plan user with `auto_generate_enabled=true` gets unlimited daily AI generation.
**Fix:** Add quota check per user inside the loop before generating:
```ts
// Add at top of file
import { assertCanGenerate } from '@/lib/entitlements';
import { incrementUsage } from '@/lib/usage';

// Inside the for loop, before generateContent():
const quota = await assertCanGenerate(userId);
if (!quota.ok) {
  results.push({ userId, status: 'quota_exceeded', postsGenerated: 0 });
  continue;
}
// ... generateContent() call ...
// After successful insert:
await incrementUsage(userId, 'ai_generate', 1);
```

---

### P0-4 · CRIT-E: Undefined session token passed to InsForge client
**File:** `src/lib/insforge/server.ts` `getServerClient()` — lines 38-47
**Problem:** If `content-os-token` cookie is missing, `edgeFunctionToken: undefined` is passed to the SDK. Depending on SDK internals, this may construct an effectively anonymous client that bypasses RLS for subsequent queries in that request.
**Current code:**
```ts
const token = cookieStore.get('content-os-token')?.value;
return createClient({ ..., edgeFunctionToken: token });
```
**Fix:** `getServerClient()` should remain as-is (it's a generic getter). The fix is to enforce that every API route that handles user data calls `getAuthenticatedUser()` first and returns 401 before ever using `getServerClient()` for data queries. Audit all routes — any that call `getServerClient()` for DB queries without a prior `getAuthenticatedUser()` check are the vulnerability. Add an `assertAuthenticated` helper to make this consistent:
```ts
// src/lib/auth.ts — add:
export async function assertAuthenticated(): Promise<{ id: string; email: string }> {
  const user = await getAuthenticatedUser();
  if (!user) throw new Error('UNAUTHENTICATED');
  return user;
}
```
Any API route that reaches a DB call without this is a bug.

---

### P0-5 · BUG-01: Race condition on usage counter (SELECT-then-UPDATE)
**File:** `src/lib/usage.ts` lines 28-53
**Problem:** Two concurrent requests read the same count, both pass the limit check, both increment to `count+1` instead of `count+2`. Users can burst past plan limits by ~2x.
**Current code:**
```ts
const { data: rows } = await client.database.from('usage_counters')
  .select('id, count')...
// ...
await client.database.from('usage_counters')
  .update({ count: (existing.count as number) + amount ... })
```
**Fix:** Use an atomic upsert with Postgres `count + amount` increment via RPC, or restructure to use `ON CONFLICT DO UPDATE SET count = count + excluded.count`:
```ts
export async function incrementUsage(
  userId: string,
  metric: UsageMetric,
  amount = 1
): Promise<void> {
  const client = getServerClient();
  const pk = periodKey(metric);

  // Atomic upsert: if row exists, increment; if not, insert with amount.
  // InsForge upsert with onConflict handles both paths in one DB round trip.
  await client.database.from('usage_counters').upsert(
    [{
      user_id: userId,
      metric,
      period_key: pk,
      count: amount,
      updated_at: new Date().toISOString(),
    }],
    {
      onConflict: 'user_id,metric,period_key',
      // InsForge/Postgres: if your SDK supports ignoreDuplicates=false,
      // you need the DB to do: SET count = usage_counters.count + EXCLUDED.count
      // If SDK does not support this natively, use a stored function/RPC.
    }
  );
}
```
If InsForge SDK doesn't support `count = count + EXCLUDED.count` in upsert, create a Postgres function via InsForge dashboard:
```sql
CREATE OR REPLACE FUNCTION increment_usage_counter(
  p_user_id uuid, p_metric text, p_period_key text, p_amount int
) RETURNS void AS $$
  INSERT INTO usage_counters (user_id, metric, period_key, count)
  VALUES (p_user_id, p_metric, p_period_key, p_amount)
  ON CONFLICT (user_id, metric, period_key)
  DO UPDATE SET count = usage_counters.count + p_amount,
                updated_at = now();
$$ LANGUAGE sql;
```
Then call via `client.database.rpc('increment_usage_counter', { p_user_id, p_metric, p_period_key, p_amount })`.

---

### P0-6 · BUG-03: Stripe plan metadata falls back to 'starter' not 'free'
**File:** `src/lib/stripe-webhook.ts` lines 28-32
**Problem:** `planFromMetadata` returns `'starter'` when metadata is missing/invalid. Free users get a paid plan silently.
**Current code:**
```ts
function planFromMetadata(meta: Record<string, string> | undefined): PlanId {
  const plan = meta?.plan;
  if (plan === 'starter' || plan === 'growth' || plan === 'pro') return plan;
  return 'starter'; // ← WRONG
}
```
**Fix:**
```ts
function planFromMetadata(meta: Record<string, string> | undefined): PlanId {
  const plan = meta?.plan;
  if (plan === 'starter' || plan === 'growth' || plan === 'pro') return plan;
  if (plan) {
    console.warn(`[stripe-webhook] Unknown plan in metadata: "${plan}" — defaulting to free`);
  }
  return 'free';
}
```
Also add timestamp replay protection to `verifyStripeSignature`:
```ts
// Inside verifyStripeSignature, after extracting timestamp:
const age = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
if (age > 300) return false; // Reject webhooks older than 5 minutes
```

---

### P0-7 · BUG-04: OAuth tokens stored plaintext on non-Vercel deploys
**File:** `src/lib/crypto.ts` lines 44-51
**Problem:** `isDeployedEnv()` only checks for `VERCEL=1` or `VERCEL_ENV`. Railway, Render, Fly.io, etc. silently store plaintext OAuth tokens.
**Fix:** Tighten the deployed env check. If `NODE_ENV=production` OR `TOKEN_ENCRYPTION_KEY` is present, require it:
```ts
function isDeployedEnv(): boolean {
  if (process.env.NODE_ENV === 'production') return true;
  if (process.env.VERCEL === '1') return true;
  if (process.env.VERCEL_ENV === 'preview' || process.env.VERCEL_ENV === 'production') return true;
  if (process.env.RAILWAY_ENVIRONMENT) return true;
  if (process.env.FLY_APP_NAME) return true;
  if (process.env.RENDER) return true;
  // If the key is explicitly set, assume deployed (don't silently ignore it)
  if (process.env.TOKEN_ENCRYPTION_KEY) return true;
  return false;
}
```
Separately, `decryptToken` should throw on malformed format rather than returning plaintext:
```ts
if (parts.length !== 3) {
  throw new Error('[crypto] Malformed encrypted token format — expected iv:ciphertext:tag');
}
```

---

### P0-8 · BUG-05: Double AI usage charge on generate route
**File:** `src/app/api/generate/route.ts` lines 24-26 and 34
**Problem:** `usage.track(user.id, 'generate')` and `guardAiRequest(user.id)` both call `incrementUsage`. Users charged 2 units per generation. Hit limits 2x faster than intended.
**Fix:** Remove the `usage.track()` call at line 24-26. `guardAiRequest` handles both the quota check AND the increment. One authoritative charging path:
```ts
// DELETE these lines:
const { usage } = await import('@/lib/hooks-intelligence/usage-tracker');
await usage.track(user.id, 'generate');

// KEEP — this is the only charging call:
const guard = await guardAiRequest(user.id);
if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
```

---

## Phase 1 — Publish Queue Reliability

### P1-1 · BUG-10: Direct-mode publish jobs stuck in `processing` forever
**File:** `src/lib/publish-queue.ts` lines 125-133
**Problem:** Direct mode branch returns a failed object without updating the DB. Job stays `processing` indefinitely.
**Current code:**
```ts
} else {
  return {
    ...job,
    status: 'failed',
    last_error: 'Direct publish must run via /api/publish or cron',
  };
}
```
**Fix:** Update the DB row before returning:
```ts
} else {
  const errorMsg = 'Direct publish must run via /api/publish or cron';
  await client.database
    .from('publish_jobs')
    .update({
      status: 'failed',
      last_error: errorMsg,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId);
  return { ...job, status: 'failed', last_error: errorMsg };
}
```

---

### P1-2 · BUG-11: No stuck-processing timeout (zombie jobs)
**File:** `src/lib/publish-queue.ts` `listDuePublishJobs()` — add new function
**Problem:** Jobs set to `processing` on function timeout never recover. No dead-letter mechanism.
**Fix:** Add a cleanup function and call it at the start of the cron:
```ts
// Add to publish-queue.ts:
export async function resetStuckProcessingJobs(stuckAfterMinutes = 10): Promise<number> {
  const client = getServerClient();
  const stuckBefore = new Date(Date.now() - stuckAfterMinutes * 60 * 1000).toISOString();

  const { data } = await client.database
    .from('publish_jobs')
    .update({
      status: 'failed',
      last_error: 'Job stuck in processing — reset by watchdog',
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'processing')
    .lt('updated_at', stuckBefore)
    .select('id');

  return data?.length ?? 0;
}
```
Call this at the top of `GET /api/cron/publish` before `listDuePublishJobs()`:
```ts
const resetCount = await resetStuckProcessingJobs(10);
if (resetCount > 0) logInfo('cron.publish.reset_stuck', { resetCount });
```

---

### P1-3 · BUG-22: Stripe webhook accepts replayed requests indefinitely
**File:** `src/lib/stripe-webhook.ts` `verifyStripeSignature()`
**Already included in P0-6 fix** — timestamp check added there.

---

### P1-4 · BUG-25: `incrementUsage` not awaited on scheduled publish path
**File:** `src/app/api/publish/route.ts` — find all `incrementUsage` calls
**Problem:** Scheduled publish path calls `incrementUsage()` without `await`. Usage never logged for scheduled posts.
**Fix:** `grep -n "incrementUsage" src/app/api/publish/route.ts` and add `await` to every call that's missing it.

---

### P1-5 · BUG-26: Publish job `attempts` counter off-by-one
**File:** `src/lib/publish-queue.ts`
**Problem:** `attempts` incremented in two places. Jobs hit `max_attempts` after only 2 real tries.
**Fix:** Increment `attempts` only once — at job pickup (`status: 'processing'` update). Remove any secondary increment at the failure path. The current code sets `attempts: job.attempts + 1` when updating status to `processing` (line 102), then re-computes `const attempts = job.attempts + 1` in the failure block (line 137). The failure block should read `job.attempts + 1` from the already-incremented value stored in DB, OR just read the updated count after the initial `processing` update. Simplest fix: track the incremented value from the first update and use it in the failure path:
```ts
const incrementedAttempts = job.attempts + 1;
await client.database.from('publish_jobs')
  .update({ status: 'processing', attempts: incrementedAttempts, ... })
  .eq('id', jobId);

// In failure block — use incrementedAttempts, not job.attempts + 1 again:
const status: PublishJobStatus = incrementedAttempts >= job.max_attempts ? 'dead' : 'failed';
```

---

## Phase 2 — Fake Feature Cleanup + AI Infrastructure

### P2-1 · BUG-06: Supervisor agent returns false "intelligence improved" signals
**File:** `src/lib/hooks-intelligence/supervisor-agent.ts`
**Problem:** Generate node commented out. RL training called with empty arrays. Returns `status: 'cycle-complete'` and `usageTracked: true` — both lies.
**Fix (Option A — honest stub, lowest effort):**
```ts
export async function runContentIntelligenceSupervisor(userId: string, brief: string, vertical?: string) {
  // STUB: Intelligence supervisor is not yet implemented.
  // Returns context from hook dataset only. RL training not active.
  const researchContext = getHookContextForAgent({ query: brief, vertical: vertical as any, limit: 10, useRAG: true });
  return {
    status: 'hook-context-only',
    brief,
    researchContext: researchContext.substring(0, 400),
    intelligence: { hooks: researchContext },
    usageTracked: false, // Not charging for a stub
  };
}
```
Remove `usage.track()` call from the stub — don't charge for a non-functioning feature.
**Option B** (do later in next wave): Wire the real generate node and pass actual performance signals to `runTrainingStep`. This is a feature, not a bug fix.

---

### P2-2 · Video auto-edit route — honest about what it does
**File:** `src/app/api/video/auto-edit/route.ts`
**Problem:** Route returns `status: 'processing'` for non-caption requests (silence removal, smart cuts) without actually doing any processing. UI may show "job submitted" with no follow-up.
**Fix:** Return clear "not-implemented" for non-caption paths instead of fake `processing`:
```ts
// At the bottom of POST, replace the non-caption return:
if (!options.captions) {
  return NextResponse.json({
    status: 'not_available',
    message: 'Video processing features (silence removal, smart cuts) are not yet available.',
  }, { status: 501 });
}
```
Also update any UI button that calls this path for non-caption options to show "Coming soon" rather than calling the route.

---

### P2-3 · BUG-09: UsageTracker always returns `{allowed: true}` — no enforcement
**File:** `src/lib/hooks-intelligence/usage-tracker.ts`
**Problem:** Documented as enforcement layer but always allows. Callers (generate route) don't check return value anyway.
**Fix:** Consolidate — `guardAiRequest()` in `ai-guard.ts` IS the enforcement layer. The `usage-tracker.ts` is a duplicate that adds confusion. Options:
- Remove `usage.track()` from generate route entirely (done in S0-8)
- Keep `usage-tracker.ts` as a logging-only module and update JSDoc to remove the "throws or returns {allowed:false}" promise
- Do NOT create a third enforcement path

---

### P2-4 · BUG-02: In-memory burst store ineffective on serverless
**File:** `src/lib/ai-guard.ts` line 13
**Problem:** `burstStore` is a `Map` — per cold start. Ineffective on Vercel.
**Note:** The DB-backed monthly cap is the real ceiling. Burst limit is defense-in-depth.
**Fix options (in order of effort):**
- A: Remove the burst comment's effectiveness claim — accept it's best-effort, document this
- B: Replace with Upstash Redis sliding window (external dependency, proper fix)
For now: update the comment to be honest about the limitation. Revisit when Redis is added.

---

## Phase 3 — Data Layer + Code Quality

### P3-1 · BUG-17: `listWorkspaces` fetches all workspaces then filters in JS
**File:** `src/lib/workspace.ts` lines 38-46
**Problem:** Fetches ALL workspaces from all users. As platform grows: expensive + data privacy issue.
**Current code:**
```ts
const { data: ws } = await client.database
  .from('workspaces')
  .select('id, name, type, owner_user_id')
  .order('created_at', { ascending: true });
// Then filters in JS
```
**Fix:**
```ts
const { data: ws } = await client.database
  .from('workspaces')
  .select('id, name, type, owner_user_id')
  .in('id', Array.from(ids))  // ← filter in DB
  .order('created_at', { ascending: true });
```

---

### P3-2 · BUG-29: `syncBrainFromProfile` crashes on malformed JSON
**File:** `src/lib/brain/sync.ts` lines 91-93
**Problem:** `JSON.parse(profile.content_pillars)` has no try/catch. Malformed data → unhandled exception → brain never updates.
**Current code:**
```ts
const pillars =
  typeof profile.content_pillars === 'string'
    ? JSON.parse(profile.content_pillars)  // ← no try/catch
    : profile.content_pillars;
```
**Fix:**
```ts
let pillars: unknown = profile.content_pillars;
if (typeof profile.content_pillars === 'string') {
  try {
    pillars = JSON.parse(profile.content_pillars);
  } catch {
    console.warn('[brain/sync] content_pillars JSON parse failed for user', userId, '— using empty array');
    pillars = [];
  }
}
```

---

### P3-3 · BUG-32: `syncBrainWins` N+1 — top-5 query on every post sync
**File:** `src/lib/brain/sync.ts` line 166
**Problem:** `syncBrainWins()` called at end of every `syncBrainPublishedPost()`. Publishing 10 posts triggers 10 full top-5 queries.
**Fix:** Remove `syncBrainWins()` call from `syncBrainPublishedPost()`. Call it once at the end of `syncCreatorBrainFull()` only:
```ts
// In syncBrainPublishedPost — REMOVE this line:
await syncBrainWins(client, userId);

// In syncCreatorBrainFull — add at the end:
await syncBrainWins(client, userId); // Run once after all posts synced
```

---

### P3-4 · BUG-14: `decryptToken` silently returns plaintext on malformed format
**File:** `src/lib/crypto.ts` line 84
**Already included in P0-7 fix.** Throw on malformed format.

---

### P3-5 · BUG-07: Engagement sort comparator operator precedence
**File:** `src/lib/engagement/inbox.ts` line 181
**Fix:**
```ts
// Replace:
.sort((a, b) =>
  b.comments[0]?.comment.synced_at.localeCompare(a.comments[0]?.comment.synced_at ?? '') ?? 0
)

// With:
.sort((a, b) => {
  const bDate = b.comments[0]?.comment.synced_at ?? '';
  const aDate = a.comments[0]?.comment.synced_at ?? '';
  return bDate.localeCompare(aDate);
})
```

---

### P3-6 · BUG-33: Missing DB index on `publish_jobs(user_id, status, created_at)`
**File:** `db/schema.sql`
**Problem:** UI queries jobs by `user_id + status` with no index. Full table scan as platform grows.
**Fix:** Add to schema and apply via InsForge dashboard:
```sql
CREATE INDEX IF NOT EXISTS publish_jobs_user_status
  ON publish_jobs (user_id, status, created_at DESC);
```

---

### P3-7 · BUG-31: Active workspace from unvalidated cookie value
**File:** `src/lib/workspace.ts` `getActiveWorkspace()` line 53
**Problem:** Cookie value used directly without verifying it exists in the user's actual workspace list.
**Current code:**
```ts
const cookieId = cookies().get(WORKSPACE_COOKIE)?.value;
return list.find((w) => w.id === cookieId) ?? list.find((w) => w.type === 'solo') ?? list[0];
```
**This is actually fine** — `list` is already scoped to the user's workspaces (fetched via `workspace_members .eq('user_id', userId)`). The `find()` will return undefined if the cookie workspace_id doesn't belong to the user, then fall back to solo/first. No IDOR possible here. Mark as **resolved by existing code logic**.

---

### P3-8 · BUG-08: `triggerAutoOptimize` uses request cookies in background fetch
**File:** `src/lib/auto-optimize.ts` lines 64-78
**Problem:** Background fetch passes user session cookies. If request completes before background fetch runs (serverless), the 401 is silent.
**Fix:** Add an internal service token to background fetch calls. Create `INTERNAL_CRON_SECRET` env var or reuse `CRON_SECRET`:
```ts
const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/optimize`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-internal-user-id': userId,          // Pass user ID
    'Authorization': `Bearer ${process.env.CRON_SECRET}`,  // Service auth
  },
  body: JSON.stringify({ ... }),
});
```
Update `/api/optimize` to accept this service auth header pattern and look up the user by ID when it's present.

---

### P3-9 · BUG-18: `variant_group_id` set before verifying variant creation
**File:** `src/lib/auto-optimize.ts` lines 52-61
**Problem:** Source post gets `variant_group_id` written before optimize call. If optimize fails, source post is orphaned in a group with no siblings.
**Fix:** Write `variant_group_id` to source post only after variants are successfully created and inserted. Use a transaction-like pattern: generate the UUID, create variants, then update source.

---

## Phase 4 — RLS on All 12 Tables (Gate for Multi-Tenancy)

**This sprint happens in InsForge dashboard + `db/schema.sql`. Not code changes.**

Tables that need RLS enabled + `user_id = auth.uid()` policies:
1. `posts`
2. `creator_profile`
3. `subscriptions`
4. `content_ideas`
5. `series`
6. `story_bank`
7. `publish_jobs`
8. `hashtag_sets`
9. `weekly_reviews`
10. `user_settings`
11. `usage_counters`
12. `ayrshare_profiles`

For each table, enable RLS in InsForge dashboard:
```sql
-- Template (apply per table):
ALTER TABLE <table_name> ENABLE ROW LEVEL SECURITY;

CREATE POLICY "<table>_user_isolation" ON <table_name>
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
```

After applying, verify with a curl test using two different user tokens that cross-user reads return empty results.

**Note on workspace-aware tables (Phase 2 of mission-v2.md):** Once `workspace_id` column is added, the RLS policy will need to change from `user_id = auth.uid()` to membership-based:
```sql
-- Future (post-workspace migration):
USING (workspace_id IN (
  SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
))
```
Apply the `user_id` policies now for immediate security. Plan to migrate them during the workspace migration sprint.

---

## Verification Checklist

Run these after all four sprints complete:

```bash
# No ANTHROPIC_API_KEY in client components
grep -rn "ANTHROPIC_API_KEY" src/components/ src/app/\(dashboard\)/
# Expected: ZERO results

# No INSFORGE_SERVICE_ROLE_KEY in client code  
grep -rn "SERVICE_ROLE" src/components/ src/app/\(dashboard\)/
# Expected: ZERO results

# No em dashes
grep -rn $'\xe2\x80\x94' src/
# Expected: ZERO results

# No silent .catch(() => {}) on critical paths
grep -rn "catch(() => {})" src/lib/
# Audit each result — only acceptable in truly non-critical paths

# Double charge removed
grep -n "usage.track" src/app/api/generate/route.ts
# Expected: ZERO results (removed in S0-8)

# Quota check in auto-generate cron
grep -n "assertCanGenerate\|guardAiRequest" src/app/api/cron/auto-generate/route.ts
# Expected: at least 1 result
```

Manual verifications:
- [ ] Unauthenticated `curl` to every `/api/` route returns 401
- [ ] Stripe webhook: manually test with timestamp > 5 min old → rejected
- [ ] Two users: verify user A cannot read user B's posts (RLS working)
- [ ] Generate: check usage counter increments exactly once per generation
- [ ] Cron publish: create a job, manually corrupt it to `processing`, wait >10 min, verify it resets to `failed`
- [ ] `npm run build` exits 0
- [ ] `npx tsc --noEmit` exits 0

---

## Bug Status at Time of Audit (June 2026)

| ID | Severity | Status | Phase |
|----|----------|--------|--------|
| CRIT-A | Critical | Open | P0-1 |
| CRIT-B | Critical | Open | P0-2 |
| CRIT-C | Critical | Open | P0-3 |
| CRIT-D | Critical | Open | P1-4 (publish route await) |
| CRIT-E | Critical | Open | P0-4 |
| BUG-01 | Critical | Open | P0-5 |
| BUG-03 | Critical | Open | P0-6 |
| BUG-04 | High | Open | P0-7 |
| BUG-05 | High | Open | P0-8 |
| BUG-06 | High | Open | P2-1 |
| BUG-07 | High | Open | P3-5 |
| BUG-08 | High | Open | P3-8 |
| BUG-09 | High | Open | P2-3 |
| BUG-10 | High | Open | P1-1 |
| BUG-11 | High | Open | P1-2 |
| BUG-14 | Medium | Included in P0-7 | P0-7 |
| BUG-17 | Medium | Open | P3-1 |
| BUG-18 | Medium | Open | P3-9 |
| BUG-22 | Low | Included in S0-6 | P0-6 |
| BUG-24 | High | **Already fixed** — `processPublishJob` IS awaited in cron | N/A |
| BUG-25 | High | Open | P1-4 |
| BUG-26 | High | Open | P1-5 |
| BUG-29 | Medium | Open | P3-2 |
| BUG-31 | High | **Not a bug** — list already scoped to user's workspaces | N/A |
| BUG-32 | Low | Open | P3-3 |
| BUG-33 | Low | Open | P3-6 |
| BUG-34 | Low | **Already fixed** — ORDER BY present in workspace.ts line 42 | N/A |
| RLS | Critical | Open | Sprint 4 |
