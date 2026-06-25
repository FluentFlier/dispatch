# CODE_MISTAKES.md — Senior Developer Audit
> **FluentFlier / dispatch (Content OS)**
> Scan date: June 2026 · Tools: CodeGraph + manual line-by-line review
> Severity: 🔴 Critical · 🟠 High · 🟡 Medium · 🔵 Low / Info

---

## 🔴 CRITICAL

---

### CRIT-A · Login `?expired=1` Clears Token Without Re-Verification (CSRF Risk)
**File**: `src/middleware.ts` — line 35

**Problem**: Visiting `/login?expired=1` clears the `content-os-token` cookie for any authenticated user without any server-side check that the token is actually expired. A malicious link or CSRF attack can silently log out any user by directing them to this URL.

```ts
if (pathname === '/login' && token && request.nextUrl.searchParams.get('expired') === '1') {
  response.cookies.set('content-os-token', '', { maxAge: 0 }); // clears on query param alone
```

**Fix**: Remove the `?expired=1` client-driven clear. Token expiry should be detected server-side in `getAuthenticatedUser()` and the redirect/clear handled there.

---

### CRIT-B · `incrementUsage().catch(() => {})` — AI Quota Tracking Is a No-Op Under Failure
**File**: `src/lib/ai-guard.ts` — line 53

**Problem**: Any DB error during usage increment is silently swallowed. During any InsForge latency spike, the quota counter never increments — users generate unlimited content. The entire metering system fails open.

```ts
await incrementUsage(userId, 'ai_generate', 1).catch(() => {}); // ← silent fail
```

**Fix**: Log the error and surface it. If usage tracking fails, either block the request (strict mode) or alert ops. Never silently ignore.

---

### CRIT-C · Auto-Generate Cron Has No Per-User Quota Check
**File**: `src/app/api/cron/auto-generate/route.ts`

**Problem**: Runs as admin client with no `assertCanGenerate()` or `guardAiRequest()` per user. Any free plan user who sets `auto_generate_enabled=true` gets unlimited AI generation — daily, indefinitely, on your API bill.

**Fix**: Call `guardAiRequest(userId)` for each user before generating. Skip users who are over quota.

---

### CRIT-D · Publishes with Expired Tokens After Silent Refresh Failure
**File**: `src/app/api/publish/route.ts` — lines 82–104

**Problem**: `ensureFreshToken()` catches refresh errors and falls through without throwing. The expired token is used for the Ayrshare call anyway. Platform rejects it. Error message gives no indication the token was stale.

**Fix**: If token refresh fails, throw and return a clear `token_expired` error to the caller. Never fall through to publish with a known-bad token.

---

### CRIT-E · Undefined Session Token Passed to InsForge Client May Disable RLS
**File**: `src/lib/insforge/server.ts` — lines 39, 45

**Problem**: If `sessionToken` is missing from cookies, `edgeFunctionToken` is also undefined. Passing undefined to the InsForge SDK may silently disable row-level filtering depending on SDK internals. No error thrown. Potential elevated access.

**Fix**: If `sessionToken` is undefined on a protected route, return 401 before constructing the client. Never construct an unauthenticated server client for user-facing requests.

---

### BUG-01 · Race Condition in Usage Counter — Double-Spend on Concurrent Requests
**File**: `src/lib/usage.ts` — `incrementUsage()` (lines 20–53)

**Problem**: The counter is incremented with a SELECT-then-UPDATE pattern (no database-level atomic increment or optimistic lock). Under concurrent requests from the same user (very common for AI generation — user rapid-clicks), two requests can read the same count, both decide `count < limit`, both generate content, then both write `count + 1` instead of `count + 2`. This allows users to exceed their monthly plan cap by ~2× under burst.

```ts
// Current — NOT safe under concurrency:
const existing = rows?.[0];
if (existing?.id) {
  await client.database
    .from('usage_counters')
    .update({ count: existing.count + amount }) // read-modify-write race
    .eq('id', existing.id);
```

**Fix**: Use a DB-level atomic upsert with an increment function (e.g., Postgres `count = count + $1`) or use the `INSFORGE_SERVICE_ROLE_KEY` path to call an RPC/function that does an atomic increment.

---

### BUG-02 · AI Guard Burst Store Is Per-Process — Ineffective on Serverless
**File**: `src/lib/ai-guard.ts` — `burstStore` (line 13)

**Problem**: `burstStore` is an in-memory `Map`. On Vercel or any serverless runtime, each cold start gets a fresh Map. A user can bypass the 15 req/60s burst limit entirely by triggering cold starts (or simply waiting for a new function instance). The comment says "the DB-backed monthly cap is the real ceiling" — but the burst check is the only **immediate** defense against hammering, and it doesn't work cross-instance.

```ts
const burstStore = new Map<string, { count: number; resetAt: number }>();
```

**Fix**: Replace in-memory burst store with a Redis/Upstash KV-backed sliding window counter, or accept the limitation and rely solely on the DB-backed monthly cap (remove the misleading burst comment).

---

### BUG-03 · Stripe Webhook: `planFromMetadata` Falls Back Silently to 'starter'
**File**: `src/lib/stripe-webhook.ts` — `planFromMetadata()` (lines 28–32)

**Problem**: If `metadata.plan` is unset or invalid on the Stripe subscription object, the function silently returns `'starter'` — giving the user a paid plan for free.

```ts
function planFromMetadata(meta: Record<string, string> | undefined): PlanId {
  const plan = meta?.plan;
  if (plan === 'starter' || plan === 'growth' || plan === 'pro') return plan;
  return 'starter'; // ← FREE UPGRADE if metadata missing
}
```

**Fix**: Fall back to `'free'`, not `'starter'`. Add a log/alert when the fallback fires so ops can investigate mismatched metadata.

---

### BUG-04 · Token Stored Unencrypted in Dev / Staging if KEY Missing
**File**: `src/lib/crypto.ts` — `encryptToken()` (lines 44–51)

**Problem**: If `TOKEN_ENCRYPTION_KEY` is missing and `isDeployedEnv()` returns `false` (e.g., a non-Vercel staging server), the function returns the raw plaintext OAuth token and stores it in the DB unencrypted. The logic only throws for `VERCEL=1` or `VERCEL_ENV=preview|production`. Any other deployment target (Railway, Render, Fly.io, etc.) silently stores plaintext tokens.

```ts
if (!key) {
  if (isDeployedEnv()) {
    requireEncryptionKey();
  }
  return plaintext; // ← silently stored unencrypted on non-Vercel deploys
}
```

**Fix**: Make the plaintext fallback strictly opt-in via `ALLOW_PLAINTEXT_TOKENS=1` env flag only for local dev. Any missing key in any non-localhost context should throw.

---

## 🟠 HIGH

---

### BUG-05 · Double Usage Charge on AI Generation
**File**: `src/app/api/generate/route.ts` (lines 25–26 and 34–35)

**Problem**: The route calls `usage.track(userId, 'generate')` which calls `incrementUsage(userId, 'ai_generate', 1)`, and then also calls `guardAiRequest(userId)` which internally calls `incrementUsage(userId, 'ai_generate', 1)` again on success. This charges **2 units per generation instead of 1**.

```ts
// Line 26: charges 1 unit
await usage.track(user.id, 'generate');

// Line 34-35: charges another 1 unit via guardAiRequest → incrementUsage
const guard = await guardAiRequest(user.id);
```

**Fix**: Remove the `usage.track()` call at the route level and rely solely on `guardAiRequest()` for usage tracking, or remove the `incrementUsage` from inside `guardAiRequest` and track only at call sites.

---

### BUG-06 · Supervisor Agent Generate Node Is Commented Out and Stubs RL Inputs
**File**: `src/lib/hooks-intelligence/supervisor-agent.ts` (lines 40–44, 51)

**Problem**: The core "Generate Node" of the intelligence supervisor is commented out and never executed. Additionally, `runTrainingStep([], [])` is called with empty arrays, meaning the RL loop never processes real signals. The supervisor returns a "cycle-complete" status even though no real generation or training occurred. This makes the research API return false "intelligence improved" signals.

```ts
// Line 41-44: never executes
// try {
//   const demoResult = await generateWithVoicePipeline(...);
// }

// Line 51: empty RL — no learning ever happens
runTrainingStep([], []);
```

**Fix**: Either wire the generate node to execute (with proper error handling and entitlement check), or clearly document that the supervisor is a stub and not return misleading `status: 'cycle-complete'` / `usageTracked: true` (usage IS charged even though nothing runs).

---

### BUG-07 · Engagement `sortedGroups` Comparison Bug
**File**: `src/lib/engagement/inbox.ts` (line 181)

**Problem**: The sort comparator uses `.localeCompare()` with a fallback `?? 0`, but the fallback uses the wrong operator precedence — the `?? 0` is on the entire expression return, not just the optional chain. If both `synced_at` values exist, `localeCompare` returns -1/0/1 correctly. But if either is undefined, the sort may silently return `0` (treating unequal items as equal) instead of a meaningful sort order.

```ts
.sort((a, b) =>
  b.comments[0]?.comment.synced_at.localeCompare(a.comments[0]?.comment.synced_at ?? '') ?? 0
```

**Fix**:
```ts
.sort((a, b) => {
  const bDate = b.comments[0]?.comment.synced_at ?? '';
  const aDate = a.comments[0]?.comment.synced_at ?? '';
  return bDate.localeCompare(aDate);
})
```

---

### BUG-08 · `triggerAutoOptimize` Uses Request Cookies for a Fire-and-Forget Fetch
**File**: `src/lib/auto-optimize.ts` (lines 64–78)

**Problem**: The function passes `Cookie: requestCookies` from the original request into a background `fetch()` to `/api/optimize`. If the background fetch runs after the original request has been completed and cookies have expired (common in serverless edge functions with short lifetimes), the background call will return `401 Unauthorized`. This is a design smell — background work should use a service key, not user session cookies.

**Fix**: Have `/api/optimize` accept a `service_token` header when called from internal background tasks, or restructure to use a job queue (like `publish_jobs`) rather than a fire-and-forget fetch.

---

### BUG-09 · Usage Tracker `track()` Always Returns `{ allowed: true }` — No Enforcement
**File**: `src/lib/hooks-intelligence/usage-tracker.ts` (lines 62–65)

**Problem**: The `UsageTracker.track()` JSDoc says "Throws (or returns {allowed:false}) when over plan limit" — but it never returns `{allowed: false}`. All errors are caught and returned as `{allowed: true}`. Callers like `generate/route.ts` don't check the return value anyway. This means the usage tracker adds no enforcement — it's logging-only.

```ts
} catch (e) {
  console.warn('[UsageTracker] increment failed (dev fallback allowed):', e);
  return { allowed: true }; // ← NEVER blocks regardless of plan limit
}
```

**Fix**: Either update the JSDoc to reflect the logging-only nature, or implement actual enforcement that calls `assertCanGenerate()` and propagates the block to the caller.

---

### BUG-10 · `processPublishJob` Returns `'failed'` Object Instead of Updating DB for Direct Mode
**File**: `src/lib/publish-queue.ts` (lines 127–133)

**Problem**: When `provider.name !== 'ayrshare'` (direct mode), the function returns a locally-constructed failed object without updating the `publish_jobs` table:

```ts
return {
  ...job,
  status: 'failed',
  last_error: 'Direct publish must run via /api/publish or cron',
};
```

The DB row remains in `processing` status forever. The next cron run will re-attempt the job (since `'processing'` is not in the `['queued', 'failed']` filter for `listDuePublishJobs`), but it will never be re-queued, so the job is stuck. **Every direct-mode job becomes a zombie.**

**Fix**: Update the DB row to `'failed'` before returning in the direct-mode branch.

---

### BUG-11 · `listDuePublishJobs` Doesn't Exclude `processing` Status — Jobs Can Double-Process
**File**: `src/lib/publish-queue.ts` (lines 210–222)

**Problem**: The cron picks up `queued` and `failed` jobs. But if a previous cron run started a job (set it to `processing`) and the serverless function timed out before it finished, the job stays in `processing` status. The next cron run will skip it (correct), but if the job was marked `processing` on error in a prior run without updating status, it will be permanently stuck with no dead-letter mechanism.

**Fix**: Add a `stuck_processing_timeout` — any job in `processing` for > N minutes should be reset to `failed` or flagged as `dead`.

---

## 🟡 MEDIUM

---

### BUG-12 · `getBestHooksForContext` Called with `undefined as any` — Type Bypass
**File**: `src/lib/voice-pipeline.ts` (line 53)

**Problem**:
```ts
const topHooks = getBestHooksForContext(undefined as any, 6);
```
The comment says "can be made vertical-aware later" but the `undefined as any` type cast bypasses TypeScript safety. The function accepts `HookVertical | undefined` but the cast hides any future API changes.

**Fix**: Change to `getBestHooksForContext(undefined, 6)` — `HookVertical | undefined` is already the correct signature.

---

### BUG-13 · `saveHookDataset` Uses `require('fs')` Inside a Function (Serverless Incompatible)
**File**: `src/lib/hooks-intelligence/index.ts` (lines 36–44)

**Problem**: `require('fs')` inside a function body works in Node.js but is an anti-pattern in Next.js App Router where edge runtimes don't have `fs`. The try-catch swallows the error, but the cached in-memory updates are lost on the next serverless instance.

**Fix**: Move file I/O to a separate Node.js-only module with `export const runtime = 'nodejs'` or remove file persistence entirely (since the DB is the source of truth, as the comment states).

---

### BUG-14 · `decryptToken` Returns Input Unchanged for Invalid Format
**File**: `src/lib/crypto.ts` (lines 82–84)

**Problem**: If the encrypted value has incorrect format (not 3 colon-separated parts), the function silently returns the raw input instead of throwing. This means a corrupted or unencrypted token stored in DB will be "decrypted" as-is and used as a real Ayrshare profile key — which will likely cause auth failures downstream with confusing error messages.

```ts
if (parts.length !== 3) return encrypted; // silent fallback
```

**Fix**: Throw a descriptive error when format is wrong, or at minimum log a warning so ops can detect corrupted tokens.

---

### BUG-15 · `voice-evaluator.ts` — Fallback Matrix Has `pass: false` with Scores of 7
**File**: `src/lib/voice-evaluator.ts` (lines 68–77)

**Problem**: The fallback matrix (returned when the AI call fails) sets `pass: false` and all scores to 7 and `ai_slop: 4`. But `evaluationPasses()` requires scores ≥ 8 and `ai_slop ≤ 3`. So every time the evaluator AI call fails, the voice pipeline will attempt a revision loop because `pass` is `false` — wasting another AI call with the same prompt, then the humanizer will also run (since `ai_slop: 4 > 3`). An API error cascades into 3× token cost.

**Fix**: Set the fallback `pass: true` to prevent unnecessary retries on infra errors (or skip iteration if AI call fails). Alternatively, surface the error upstream and short-circuit.

---

### BUG-16 · `getOrCreateSubscription` Ignores Insert Error
**File**: `src/lib/entitlements.ts` (lines 79–87)

**Problem**: The free subscription row insert has no error handling. If the insert fails (e.g., unique constraint race condition on concurrent requests from a new user), the function silently continues and returns `{ plan: 'free', status: 'inactive' }` which is harmless but the failed insert means the user has no subscription row, and the next call will try to insert again (repeated race).

**Fix**: Use an upsert (`INSERT ... ON CONFLICT DO NOTHING`) instead of a plain insert.

---

### BUG-17 · `listWorkspaces` Fetches ALL Workspaces Then Filters in Memory
**File**: `src/lib/workspace.ts` (lines 38–46)

**Problem**:
```ts
const { data: ws } = await client.database
  .from('workspaces')
  .select('id, name, type, owner_user_id')
  .order('created_at', { ascending: true });
// Then: .filter((w) => ids.has(w.id))
```
This fetches ALL workspaces in the database (from all users), then filters to just the ones the user belongs to in JavaScript. As the platform grows, this query becomes expensive and a data privacy concern (all workspace names visible in the server response before filtering).

**Fix**: Add `.in('id', Array.from(ids))` to the DB query to filter server-side.

---

### BUG-18 · Auto-Optimize Sets `variant_group_id` Before Checking If Variants Were Created
**File**: `src/lib/auto-optimize.ts` (lines 52–61 vs 88–118)

**Problem**: The source post's `variant_group_id` is written to the DB before the `/api/optimize` call. If the optimize call fails (network error, 4xx, 0 variants returned), the source post still has a `variant_group_id` set, making it appear to be part of a variant group with no siblings. Any UI that queries by `variant_group_id` will show an orphaned source post.

**Fix**: Only update `variant_group_id` on the source post after variants are successfully created, or clear it on failure.

---

### BUG-24 · `processPublishJob` Not Awaited in Publish Cron
**File**: `src/app/api/cron/publish/route.ts` — line 46

**Problem**: `processPublishJob` call is fire-and-forget. Cron moves to the next job before the previous one resolves. Status updates race. The `results` array reports incorrect success/failure counts. Jobs may double-process.

**Fix**: Ensure every `processPublishJob` call is properly awaited and its return value assigned before continuing the loop.

---

### BUG-25 · `incrementUsage` Not Awaited on Scheduled Publish Path
**File**: `src/app/api/publish/route.ts` — line 256 vs line 417

**Problem**: Scheduled publish path calls `incrementUsage()` without `await` (fire-and-forget). Direct publish path awaits it. Inconsistent — scheduled publishes silently fail to log usage, users on scheduled-heavy workflows bypass metering.

**Fix**: Await `incrementUsage` on all code paths consistently.

---

### BUG-26 · Publish Job `attempts` Counter Incremented Twice — Off-by-One
**File**: `src/lib/publish-queue.ts` — lines 136–150 and 194

**Problem**: `attempts` is incremented in two places in the retry flow. A job that fails once shows `attempts: 2`. Jobs hit `max_attempts: 3` ceiling after only 2 real tries. One retry wasted per job.

**Fix**: Increment `attempts` in exactly one place — at job pickup, not at failure.

---

### BUG-27 · `ayrshare.listAccounts()` Returns Empty Array on Any API Error
**File**: `src/lib/social/ayrshare.ts` — lines 88–94

**Problem**: Any Ayrshare API error causes a silent empty return. UI shows "no connected accounts." User thinks accounts disconnected. Real cause hidden — could be API key revoked, Ayrshare outage, or network failure. Zero logging.

```ts
} catch {
  return []; // ← silent, no log
}
```

**Fix**: Log the error with context. Distinguish "no accounts" from "API error" in the return type so the UI can show the correct state.

---

### BUG-28 · `decryptByokCredentials` Throws Uncaught on Malformed JSON
**File**: `src/app/api/publish/route.ts` — line 379

**Problem**: `JSON.parse` inside `decryptByokCredentials` has no try/catch. Corrupted BYOK credential stored in DB → unhandled exception → 500 response with no useful message to the user or ops.

**Fix**: Wrap in try/catch. Return a typed error: `{ error: 'credential_corrupted' }` so the publish route can surface a clear message.

---

### BUG-29 · Brain Sync `JSON.parse` Uncaught — Sync Silently Aborts
**File**: `src/lib/brain/sync.ts` — line 92

**Problem**: `JSON.parse(profile.content_pillars)` when `content_pillars` is malformed throws uncaught. `syncBrainFromProfile()` crashes mid-execution. Brain never updates. Voice context silently degrades with no error surfaced.

**Fix**: Wrap parse in try/catch. On failure, use empty array default and log a warning.

---

### BUG-30 · Auto-Generate Cron Day-of-Week Check Has No Timezone Handling
**File**: `src/app/api/cron/auto-generate/route.ts` — line 63

**Problem**: Day-of-week logic uses server UTC. A creator in PST with a Monday schedule gets their Monday post generated Sunday night their time. Scheduling is systematically wrong for any non-UTC user.

**Fix**: Store user timezone in `user_settings`. Convert `now()` to user local time before checking day-of-week.

---

### BUG-31 · Active Workspace Chosen from Unvalidated Cookie Value
**File**: `src/lib/workspace.ts` — line 53

**Problem**: Cookie value for active workspace is used directly without validating it exists in the authenticated user's workspace list. Any cookie value passes through. Potential cross-workspace data access if workspace IDs are guessable.

**Fix**: After reading the cookie value, verify it exists in the user's `workspaceIds` set before using it. Default to first workspace if invalid.

---

## 🔵 LOW / INFO

---

### BUG-32 · `syncBrainWins` Runs on Every Single Post Sync (N+1 Query Pattern)
**File**: `src/lib/brain/sync.ts` — line 174

**Problem**: `syncBrainWins()` is called at the end of every `syncBrainPublishedPost()` call. It queries the top-5 posts by views every time any post syncs. Publishing 10 posts triggers 10 full top-5 queries. Should run once at end of bulk sync or on a schedule, not inside the per-post loop.

**Fix**: Call `syncBrainWins()` once after all posts are synced, not inside `syncBrainPublishedPost`.

---

### BUG-33 · `publish_jobs` Missing Index on `(user_id, status, created_at)`
**File**: `db/schema.sql` — line 296

**Problem**: Existing index covers `(status, scheduled_for)` for cron queries. UI queries jobs by `user_id + status` (show pending jobs per user) — no index for that. Full table scan as `publish_jobs` grows.

**Fix**:
```sql
create index if not exists publish_jobs_user_status
  on publish_jobs (user_id, status, created_at desc);
```

---

### BUG-34 · Workspace Members Select Has No ORDER BY — Non-Deterministic
**File**: `src/lib/workspace.ts` — line 42

**Problem**: `workspace_members` query has no `order()` clause. Same user sees workspace list in different order on different requests. Any UI that picks "first workspace" as the default will flip-flop.

**Fix**: Add `.order('created_at', { ascending: true })` to the workspace_members select.

---

### BUG-19 · `checkRateLimit` in `rate-limit.ts` Is Redundant with `ai-guard.ts`
**File**: `src/lib/rate-limit.ts`

`checkRateLimit()` and `guardAiRequest()` both check `ai_generate` usage against a limit. The rate-limit module appears unused by any API route — all AI routes use `ai-guard.ts`. The `rate-limit.ts` module exports `recordRateLimitHit` which also calls `incrementUsage` — creating a third potential charging path. This dead code should be removed.

---

### BUG-20 · `analytics.ts` Type for `trackEvent` Properties Is Too Permissive
**File**: `src/lib/analytics.ts` (line 20)

`Record<string, string | number | boolean>` is fine but `publish_failed` includes a `jobId` which is a string — no issue there. Minor: the `AnalyticsEvent` union could be a `const` enum for better tree-shaking.

---

### BUG-21 · `planFromMetadata` in Stripe Webhook Only Checks `customer.subscription.*` Events — Not `invoice.payment_succeeded`
**File**: `src/lib/stripe-webhook.ts` (lines 51, 80)

The webhook only handles `checkout.session.completed` and `customer.subscription.updated/deleted`. It does **not** handle `invoice.payment_failed` (which should downgrade/suspend the account) or `invoice.payment_succeeded` after a period renewal. Subscriptions can go `past_due → active` via payment retry without triggering an update event, leaving users in a limbo state.

**Recommended**: Add `invoice.payment_failed` → set status to `past_due`, and optionally `invoice.payment_succeeded` → ensure status is `active`.

---

### BUG-22 · No Timestamp Validation in Stripe Webhook Verification
**File**: `src/lib/stripe-webhook.ts` — `verifyStripeSignature()` (lines 7–25)

The timestamp (`t=`) from the Stripe signature header is extracted but never validated against `Date.now()`. Stripe's official recommendation is to reject webhooks where the timestamp is more than 5 minutes old (replay attack protection). The current implementation accepts replayed webhooks indefinitely.

**Fix**: Add `if (Math.abs(Date.now() / 1000 - parseInt(timestamp)) > 300) return false;`

---

### BUG-23 · `DashboardLayout` Uses `headers()` for Pathname Detection — Will Break in Next.js 15
**File**: `src/app/(dashboard)/layout.tsx` (lines 14–15)

```ts
const headersList = headers();
const pathname = headersList.get('x-pathname') || '';
```

The `x-pathname` header is not set by Next.js by default — this requires a middleware to inject it. If that middleware is removed or the Next.js 15 upgrade changes how headers are handled, `pathname` will always be `''`, disabling the onboarding and teleprompter redirects. The correct approach is to use `usePathname()` client-side or pass it as a search param.

---

## Summary Statistics

| Severity | Count |
|---|---|
| 🔴 Critical | 9 (4 original + CRIT-A through CRIT-E) |
| 🟠 High | 11 (7 original + BUG-24 through BUG-31) |
| 🟡 Medium | 7 |
| 🔵 Low/Info | 8 (5 original + BUG-32 through BUG-34) |
| **Total** | **35** |

### Top Priority Fixes (Before Any New Features)

**Security + billing — fix immediately:**
1. **CRIT-B**: AI quota tracking is a no-op under DB failure — unlimited generation possible
2. **CRIT-C**: Auto-generate cron has no per-user quota — free users get unlimited AI daily
3. **BUG-03**: Stripe metadata fallback gives free `starter` plan — immediate revenue loss
4. **CRIT-A**: `?expired=1` CSRF logout — any user can be logged out by a malicious link
5. **CRIT-D**: Publishes with expired tokens after silent refresh failure
6. **CRIT-E**: Undefined InsForge session token may disable RLS
7. **BUG-04**: OAuth tokens stored plaintext on non-Vercel deploys
8. **BUG-22**: Stripe webhook accepts replayed requests indefinitely

**Broken core flows — fix before public launch:**
9. **BUG-01**: Race condition on usage counter — plan limits bypassable under load
10. **BUG-05**: Double AI usage charge — users hit limits 2× faster than intended
11. **BUG-10**: Direct-mode publish jobs stuck in `processing` forever — zombie queue
12. **BUG-11**: No stuck-processing timeout — jobs permanently orphaned on timeout
13. **BUG-24**: `processPublishJob` not awaited in cron — race on status updates
14. **BUG-25**: `incrementUsage` not awaited on scheduled publish path — usage not logged
15. **BUG-26**: Publish job `attempts` counter off-by-one — retries exhausted too early
