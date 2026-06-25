# Content OS — Complete Codebase Flowchart
> **Senior Developer Scan** · Source: `FluentFlier/dispatch` · Tools: CodeGraph + manual file-by-file review
> Every node below maps 1:1 to real source files and function names.

---

## 0. Project Overview

```
Next.js 14 (App Router) · InsForge BaaS · Stripe billing · Ayrshare social API · Supermemory · Claude AI
Stack: TypeScript · Tailwind CSS · Remotion (video)
```

The app implements a **5-stage closed Content Loop**:

```
Signal ──► Draft ──► Publish ──► Reply ──► Learn
(Research)  (AI Gen)  (Queue)   (Inbox)  (Brain/Analytics)
```

---

## 1. Application Entry & Routing

```mermaid
flowchart TD
    A["Browser Request"] --> B["next.config.js\n(middleware, rewrites)"]
    B --> C{Route group?}

    C -->|"/ (root)"| D["src/app/page.tsx\n(redirect to /dashboard or /login)"]
    C -->|"/(auth)"| E["src/app/(auth)/\nlogin · signup · onboarding"]
    C -->|"/(dashboard)"| F["DashboardLayout\nsrc/app/(dashboard)/layout.tsx"]
    C -->|"/api/*"| G["src/app/api/\n(29 route groups)"]
    C -->|"/pricing"| H["src/app/pricing/\n(public pricing page)"]
```

### 1.1 Dashboard Layout Guard (`src/app/(dashboard)/layout.tsx`)
```mermaid
flowchart TD
    A["DashboardLayout()"] --> B["getAuthenticatedUser()\n← insforge/server.ts"]
    B -->|"null"| C["redirect('/login?expired=1')"]
    B -->|"user"| D{"pathname == /onboarding?"}
    D -->|"No"| E["DB: creator_profile\n.onboarding_complete"]
    E -->|"false"| F["redirect('/onboarding')"]
    E -->|"true"| G{pathname == /teleprompter?}
    G -->|"Yes"| H["Render children only\n(no sidebar)"]
    G -->|"No"| I["Render:\nToastProvider\n+ Sidebar\n+ main content area\n+ BottomBar"]
```

---

## 2. Authentication Layer

```mermaid
flowchart TD
    subgraph "Auth Clients (src/lib/insforge/)"
        SC["getServerClient()\nreads cookie: content-os-token\nSSR-safe, user-scoped"]
        SVC["getServiceClient()\nuses INSFORGE_SERVICE_ROLE_KEY\ncron/webhooks only"]
        BC["getInsforgeClient()\nsrc/lib/insforge/client.ts\nbrowser singleton, anon key"]
    end

    subgraph "Token Flow"
        L["POST /api/auth/*\n(InsForge auth callbacks)"] --> T["validateAccessToken(token)\nsrc/lib/auth.ts"]
        T --> V["createClient() with edgeFunctionToken\ncalls client.auth.getCurrentUser()"]
        V -->|"valid"| C["Set httpOnly cookie: content-os-token"]
        V -->|"invalid"| R["Return {valid:false}"]
    end

    subgraph "Token Encryption (src/lib/crypto.ts)"
        E["encryptToken(plaintext)\nAES-256-GCM\niv:ciphertext:tag (base64)"]
        D["decryptToken(encrypted)\nverify authTag → plaintext"]
    end

    C --> E
    SC --> D
```

> **Auth guard**: Every protected API route calls `getAuthenticatedUser()` first (20+ callers confirmed by CodeGraph).

---

## 3. Cross-Cutting Concerns

### 3.1 Rate Limiting & AI Guard (`src/lib/ai-guard.ts` + `src/lib/rate-limit.ts`)

```mermaid
flowchart LR
    API["Any AI-invoking\nAPI route"] --> G["guardAiRequest(userId)\nsrc/lib/ai-guard.ts"]
    G --> BL["burstAllowed(userId)\nin-process Map\n15 req / 60 s"]
    BL -->|"denied"| E1["429 Too Many Requests"]
    BL -->|"allowed"| EC["assertCanGenerate(userId)\nsrc/lib/entitlements.ts"]
    EC -->|"over cap"| E2["402 Plan limit reached"]
    EC -->|"ok"| IU["incrementUsage(userId, 'ai_generate', 1)\nsrc/lib/usage.ts\n→ usage_counters DB (fire-and-forget)"]
    IU --> OK["{ ok: true }"]
```

> **12 callers** of `guardAiRequest`: auto-generate, draft-replies, generate, humanize, optimize, research, trends/detect, video/auto-edit, video/generate, voice-lab/analyze, voice-lab/import, voice-lab/interview.

### 3.2 Entitlements & Plan Limits (`src/lib/entitlements.ts`)

```mermaid
flowchart TD
    EU["getUserEntitlements(userId)"] --> GS["getOrCreateSubscription(userId)\nDB: subscriptions table\nInserts free row if none"]
    GS --> PL["PLAN_LIMITS map\nfree / starter / growth / pro"]
    EU --> UQ["getUsageCount()\nfor publish_post, scheduled_post, ai_generate"]
    UQ --> R["{ plan, status, limits, usage, isPaid }"]

    subgraph "Plan Limits"
        FL["free: 30 AI gen, 5 publish/month\ncanPublish: false"]
        SL["starter: 200 AI, 60 publish"]
        GL["growth: 1000 AI, 300 publish"]
        PR["pro: 5000 AI, 1500 publish"]
    end
```

### 3.3 Usage Tracking (`src/lib/usage.ts`)

```mermaid
flowchart LR
    IU2["incrementUsage(userId, metric, amount)"] --> PK["periodKey(metric)\nYYYY-MM or 'lifetime'"]
    PK --> DB1["SELECT from usage_counters\nwhere user_id + metric + period_key"]
    DB1 -->|"exists"| UP["UPDATE count += amount"]
    DB1 -->|"new"| INS["INSERT row"]
```

### 3.4 Env Validation (`src/lib/env.ts`)

| Function | What it checks |
|---|---|
| `isProduction()` | `NODE_ENV === 'production'` |
| `getSocialProviderMode()` | `SOCIAL_PROVIDER_MODE` env → `'ayrshare'` or `'direct'` |
| `assertProductionEnv()` | 5 required prod vars + TOKEN_ENCRYPTION_KEY must be 64 hex chars |
| `getAppUrl()` | `NEXT_PUBLIC_APP_URL` or localhost |

---

## 4. Stage 1 — Signal (Research)

**Route**: `POST /api/research/route.ts`
**Connected**: `src/lib/hooks-intelligence/supervisor-agent.ts`

```mermaid
flowchart TD
    R["POST /api/research"] --> AU["getAuthenticatedUser()"]
    AU --> GD["guardAiRequest(userId)"]
    GD --> SUP["runContentIntelligenceSupervisor(userId, brief, vertical)\nsrc/lib/hooks-intelligence/supervisor-agent.ts"]
    SUP --> N1["1. Research Node\ngetHookContextForAgent({ query, vertical, limit, useRAG })\n← hooks-intelligence/retriever.ts"]
    N1 --> N2["2. Intelligence Node\nRAG over mined hooks\nhook examples + patterns"]
    N2 --> N3["3. Generate Node stub\ngenerateWithVoicePipeline() [commented out in prod]\nReal call wired at voice pipeline layer"]
    N3 --> N4["4. RL Reinforce\nrunTrainingStep([], [])\n← hooks-intelligence/rl-trainer.ts"]
    N4 --> RES["Return: { status, brief, researchContext, intelligence, usageTracked }"]
```

### Hook Intelligence System (`src/lib/hooks-intelligence/`)

```mermaid
flowchart LR
    subgraph "Data Sources"
        JF["data/hooks-dataset.json\n(bootstrap bundled)"]
        DB2["hook_examples table\n(live DB via mining)"]
    end

    LHD["loadHookDataset()\nmodule-level cache\nclones JSON so mutations don't corrupt module"] --> JF

    GBH["getBestHooksForContext(vertical, limit)"] --> LHD
    GBH --> RH["rankHooks(hooks, vertical, limit)\n← scorer.ts"]

    AHD["addHooksToDataset(newHooks)"] --> LHD
    AHD --> SH["scoreHook(hook) for each new hook"]
    AHD --> SAVE["saveHookDataset()\nfs.writeFileSync to data/ (best-effort, serverless ok)"]

    UHP["updateHookPerformance(hookId, delta)\nRL micro-update:\ntotal = clamp(0,100, total + delta*0.7)\nconfidence += 0.03 capped at 0.98"]
```

> **Social Listening** (`runSocialListening`): Reads `DEFAULT_WATCHLIST.accounts`, sorts by priority, returns top N. Comment says "would call gstack extractor in prod" — currently just returns the watchlist array.

---

## 5. Stage 2 — Draft (AI Generation)

### 5.1 Generation Route (`POST /api/generate/route.ts`)

```mermaid
flowchart TD
    A["POST /api/generate"] --> AU2["getAuthenticatedUser()"]
    AU2 --> UT["usage.track(userId, 'generate')\nUsageTracker → incrementUsage + DB event + Stripe meter"]
    UT --> PB["Parse & Zod validate body\n{ prompt, systemOverride?, topic?, platform?, contentType?, fast? }"]
    PB --> GD2["guardAiRequest(userId)\nburst + plan cap check"]
    GD2 --> LC["loadCreatorVoiceContext(client, userId, { memoryQuery })\nsrc/lib/voice-context.ts"]
    LC --> GVP["generateWithVoicePipeline(input)\nsrc/lib/voice-pipeline.ts"]
    GVP --> RESP["Return: { text, voice_match_score, ai_score, revised, flags, iterations, evaluation }"]
```

### 5.2 Voice Context Loader (`src/lib/voice-context.ts`)

```mermaid
flowchart TD
    LVC["loadCreatorVoiceContext(client, userId, opts)"] --> P1["DB: creator_profile\n(display_name, bio, bio_facts, content_pillars,\nvoice_description, voice_rules)"]
    LVC --> P2["DB: user_settings\n(context_additions, vocabulary_fingerprint,\nstructural_patterns, sample_posts)"]
    LVC --> P3["retrieveBrainContext(client, userId, query)\n← src/lib/brain/retrieve.ts"]
    LVC --> P4{"SUPERMEMORY_API_KEY set\n+ memoryQuery?"}
    P4 -->|"yes"| SM["searchUserContext(userId, query, 3)\n← src/lib/supermemory.ts\nPOST https://api.supermemory.ai/v3/search"]
    P4 -->|"no"| SKIP["skip"]
    P1 & P2 & P3 & SM --> BVCA["buildVoiceContextAdditions()\nAssembles sections:\nUSER CONTEXT · BIO FACTS ·\nVOCABULARY FINGERPRINT ·\nSTRUCTURAL PATTERNS ·\nVOICE EXAMPLES · CREATOR BRAIN ·\nSEMANTIC MEMORY"]
    BVCA --> CVCtx["Return: { profile, contextAdditions }"]
```

### 5.3 Voice Pipeline (`src/lib/voice-pipeline.ts`)

```mermaid
flowchart TD
    GVP2["generateWithVoicePipeline(input)"] --> CH["buildVoiceComposeHints(platform, contentType)\n← voice-prompts/index.ts"]
    GVP2 --> HI["getBestHooksForContext(vertical, 6)\n← hooks-intelligence/index.ts\nInjects top 6 ranked real hooks into prompt"]
    GVP2 --> MC["mergedContext = composeHints + taskHint +\ncontextAdditions + hookExamples"]
    MC --> SP["buildSystemPrompt(profile, mergedContext)\n← src/lib/claude.ts"]

    subgraph "Draft → Evaluate → Revise Loop (maxIterations=2)"
        D["generateContent(draftPrompt, systemPrompt)\n→ Claude claude-sonnet-4.5 · maxTokens=2048"]
        D --> STRIP["stripEmDashes(text)\nReplaces — and – with plain dashes"]
        STRIP --> FAST{fast mode?}
        FAST -->|"yes"| BREAK["break"]
        FAST -->|"no"| EVAL["evaluateDraft(text, profile)\n← voice-evaluator.ts"]
        EVAL --> PASS{evaluationPasses?}
        PASS -->|"yes"| BREAK
        PASS -->|"no, i<max"| REVISE["Rewrite prompt with revision_notes\nLoop again"]
    end

    BREAK --> HUM{"ai_slop > 3\n+ not fast mode?"}
    HUM -->|"yes"| HUMN["humanize(text, profile)\n← humanizer.ts\nAnother Claude call with 29-pattern prompt"]
    HUM -->|"no"| SCORE

    HUMN --> SCORE["Compute:\nvoice_match_score = persona_fidelity/10*100\nai_score = ai_slop*10\nflags = ['below_voice_threshold'] if !pass"]
    SCORE --> RET["Return VoicePipelineResult"]
```

### 5.4 Voice Evaluator (`src/lib/voice-evaluator.ts`)

```mermaid
flowchart LR
    ED["evaluateDraft(draft, profile)"] --> GC["generateContent(prompt, EVALUATOR_PROMPT)\nClaude returns JSON matrix"]
    GC --> PJ["Parse JSON from regex match {[\\s\\S]*}"]
    PJ --> MX["VoiceEvaluationMatrix:\npersona_fidelity · uniqueness · specificity\nso_what · pain_resonance · ai_slop\nrevision_notes · pass"]
    MX --> EP["evaluationPasses():\nAll 5 content scores ≥ 8\n+ ai_slop ≤ 3"]
```

### 5.5 Claude AI Client (`src/lib/claude.ts`)

```mermaid
flowchart LR
    GC2["generateContent(prompt, contextAdditions, systemOverride, profile)"] --> BSP["buildSystemPrompt(profile, contextAdditions)\nAssembles persona prompt from:\n- DEFAULT_SYSTEM_PROMPT_TEMPLATE\n- display_name, bio, bio_facts\n- voice_description, voice_rules\n- content_pillars"]
    BSP --> AI["client.ai.chat.completions.create()\nmodel: anthropic/claude-sonnet-4.5\nmaxTokens: 2048"]
    AI --> CHK["choices[0].message.content\nthrows if empty"]
```

### 5.6 Auto-Optimize (`src/lib/auto-optimize.ts`)

```mermaid
flowchart TD
    TAO["triggerAutoOptimize({ userId, postId, content, sourcePlatform, requestCookies, origin })"] --> CHK2["DB: user_settings.auto_optimize_on_save == 'true'?"]
    CHK2 -->|"no"| BAIL["return (noop)"]
    CHK2 -->|"yes"| TPLAT["targetPlatforms = PLATFORMS.filter(p ≠ sourcePlatform)"]
    TPLAT --> VGID["crypto.randomUUID() → variantGroupId"]
    VGID --> UPDP["DB: posts UPDATE variant_group_id, source_platform"]
    UPDP --> FOPT["fetch(origin + '/api/optimize', POST)\ncontent, targetPlatforms, optimizationLevel='full'"]
    FOPT --> VINS["DB: posts INSERT variant posts\nfor each platform variant"]
```

---

## 6. Stage 3 — Publish

### 6.1 Publish Route (`POST /api/publish/route.ts`)

```mermaid
flowchart TD
    PP["POST /api/publish"] --> AU3["getAuthenticatedUser()"]
    AU3 --> ACP["assertCanPublish(userId)\n← entitlements.ts\nChecks plan + monthly cap"]
    ACP -->|"fail"| E402["402 Upgrade required"]
    ACP -->|"ok"| EPJ["enqueuePublishJob({ userId, postId, platform, scheduledFor, provider })\n← publish-queue.ts"]
    EPJ --> IK["buildIdempotencyKey()\nsha256(userId:postId:platform:scheduledFor)"]
    IK --> DUP{Existing job\nfor this key?}
    DUP -->|"yes"| RETDUP["Return { job, duplicate:true }"]
    DUP -->|"no"| INSJ["DB: publish_jobs INSERT\n{ status:'queued', idempotency_key, scheduled_for, provider }"]
    INSJ --> LINKP["DB: posts UPDATE publish_job_id"]

    RETDUP & INSJ --> SCHED{scheduledFor?}
    SCHED -->|"future"| SCHRESP["201 Scheduled"]
    SCHED -->|"now (ayrshare)"| PJP["processPublishJob(job, post)\n← publish-queue.ts"]
    PJP --> INC2["incrementUsage(userId, 'publish_post', 1)"]
    INC2 --> SBRAIN["syncBrainPublishedPost(client, userId, postId)\n← brain/sync.ts (non-critical)"]
```

### 6.2 Publish Queue Processor (`src/lib/publish-queue.ts`)

```mermaid
flowchart TD
    PPJ["processPublishJob(job, post)"] --> UPDPROC["DB: publish_jobs UPDATE status='processing', attempts+1"]
    UPDPROC --> EXTRACT["content = post.caption || post.script || post.hook || post.title"]
    EXTRACT --> PROV["getSocialProvider()\n← social/index.ts\nModes: ayrshare | direct"]

    PROV -->|"ayrshare"| AYR["ayrshareProvider.publish(userId, payload)\nPOST https://api.ayrshare.com/api/post\nwith profileKey (fetched/created per-user)"]
    PROV -->|"direct"| DFAIL["Return status='failed'\n'Direct publish must run via /api/publish or cron'"]

    AYR -->|"success"| UPDPUB["DB: publish_jobs UPDATE status='published', provider_post_id, provider_url\nDB: posts UPDATE status='posted', posted_date\nimport syncBrainPublishedPost (dynamic)\nincrementUsage publish_post\nlogInfo"]
    AYR -->|"fail"| UPDFAIL["DB: publish_jobs UPDATE status=failed|dead\nattempts >= max_attempts → 'dead'"]
```

### 6.3 Cron Publish Worker (`GET /api/cron/publish/route.ts`)

```mermaid
flowchart TD
    CRON["GET /api/cron/publish\nBearer CRON_SECRET auth"] --> LJOBS["listDuePublishJobs(25)\nSELECT from publish_jobs\nWHERE status IN (queued, failed)\nAND (scheduled_for IS NULL OR scheduled_for <= now)\nORDER BY created_at ASC"]
    LJOBS --> FORJOBS["For each job (if attempts < max):\n1. Fetch post from DB\n2. processPublishJob(job, post)"]

    CRON --> LEGACY["Legacy path:\nSELECT posts WHERE scheduled_publish_at <= now\nAND status != posted\nAND publish_job_id IS NULL"]
    LEGACY --> LEGMODE{SOCIAL_PROVIDER_MODE?}
    LEGMODE -->|"ayrshare"| LEGENQ["enqueuePublishJob() then processPublishJob()"]
    LEGMODE -->|"direct"| LEGERR["Mark error: use publish API"]
```

### 6.4 Social Provider Abstraction (`src/lib/social/`)

```mermaid
flowchart LR
    GSP["getSocialProvider()\nsrc/lib/social/index.ts"] --> GVM["getSocialProviderMode()\n← env.ts\nChecks SOCIAL_PROVIDER_MODE + AYRSHARE_API_KEY"]
    GVM -->|"ayrshare"| AYP["ayrshareProvider\nsrc/lib/social/ayrshare.ts"]
    GVM -->|"direct"| DPR["directProvider\nsrc/lib/social/direct.ts"]

    AYP --> GCPK["getOrCreateAyrshareProfileKey(userId)\nDB: ayrshare_profiles\nIf not found: POST /profiles/profile\nStore encrypted profileKey"]
    GCPK --> ENC["encryptToken(profileKey) → DB\ndecryptToken() on read"]
```

---

## 7. Stage 4 — Reply (Engagement Inbox)

### 7.1 Engagement Inbox (`src/lib/engagement/inbox.ts`)

```mermaid
flowchart TD
    GEI["getEngagementInbox(client, userId, filter, postId?)"] --> QC["DB: post_comments\nfilter by user_id, optional postId\nORDER BY commented_at DESC"]
    QC --> QQ["DB: comment_reply_queue\nIN comment IDs\ntake latest per comment"]
    QQ --> QP["DB: posts\nIN post IDs → title, platform"]
    QP --> QJOBS["DB: publish_jobs\nIN post IDs, status=published → provider_post_id"]
    QJOBS --> CLASS["classifyComment(queue):\nnull → needs_reply\n'sent' → sent\n'skipped'/'failed' → needs_reply\n'draft'/'approved' → drafted"]
    CLASS --> FILT["matchesFilter(filter, flags)"]
    FILT --> GRP["Group by post_id → InboxPostGroup[]"]
```

### 7.2 Draft Engagement Replies (`src/lib/engagement/inbox.ts → draftEngagementReplies`)

```mermaid
flowchart TD
    DER["draftEngagementReplies(client, userId, { limit, commentIds?, fast? })"] --> QC2["DB: post_comments (limit*3 batch)"]
    QC2 --> EXCL["DB: comment_reply_queue\nexclude already-drafted/sent"]
    EXCL --> LVC2["loadCreatorVoiceContext(client, userId)"]
    LVC2 --> LOOP["For each unblocked comment:"]
    LOOP --> BRP["buildReplyPrompt(comment, postTitle)\n'Write a reply to this comment on ...'"]
    BRP --> GVP3["generateWithVoicePipeline({ prompt, profile, contextAdditions, platform, contentType:'reply', fast })"]
    GVP3 --> INSQ["DB: comment_reply_queue INSERT\n{ user_id, post_comment_id, draft_reply, status:'draft',\nvoice_match_score, evaluation }"]
```

### 7.3 Send Engagement Replies (`draftEngagementReplies → sendEngagementReplies`)

```mermaid
flowchart TD
    SER["sendEngagementReplies(client, userId, { queueIds?, approveFirst?, draftOverrides? })"] --> QQ2["DB: comment_reply_queue\nFilter: queueIds OR status='approved'/'draft'"]
    QQ2 --> CMT2["DB: post_comments → commentMap"]
    CMT2 --> USEAYR{"ayrshareCommentsAvailable()\n= AYRSHARE_API_KEY set?"}
    USEAYR -->|"yes"| SAR["sendAyrshareCommentReply()\nPOST https://api.ayrshare.com/api/comments/reply/:id\nBody: { platforms, comment, searchPlatformId }"]
    USEAYR -->|"no"| STUB["stubbed=true (no-op reply)"]
    SAR & STUB --> UPDQ["DB: comment_reply_queue UPDATE\nstatus='sent', sent_at, provider_reply_id"]
```

### 7.4 Engagement Sync (`POST /api/engagement/sync/route.ts`)

- Fetches new comments from Ayrshare (`fetchAyrsharePostComments`)
- Upserts into `post_comments` table
- Triggered manually or by cron

---

## 8. Stage 5 — Learn (Brain & Analytics)

### 8.1 Creator Brain (`src/lib/brain/sync.ts`)

```mermaid
flowchart TD
    PCB["provisionCreatorBrain(client, userId)"] --> LBP["listBrainPages(client, userId)"]
    LBP -->|"already ≥ 2 pages"| DONE["return (already provisioned)"]
    LBP -->|"new"| INITPAGES["putBrainPage → voice page (pending)\nputBrainPage → profile page (pending)\nputBrainPage → 'What works' page (empty)"]

    SBF["syncBrainFromProfile(client, userId)"] --> QP3["DB: creator_profile\ndisplay_name, bio, bio_facts, voice*, content_pillars"]
    QP3 --> PBV["putBrainPage: voice slug\n{ voice_description, voice_rules, synced_at }"]
    QP3 --> PBP["putBrainPage: profile slug\n{ display_name, bio, bio_facts, content_pillars }"]

    SBPP["syncBrainPublishedPost(client, userId, postId)"] --> QP4["DB: posts → hook + script + caption"]
    QP4 --> PBPost["putBrainPage: post/{postId} slug\n{ post_id, platform, pillar, content[0..4000],\nviews, likes, posted_date }"]
    PBPost --> SBW["syncBrainWins(client, userId)\nTOP 5 posts by views\nputBrainPage: wins slug"]

    SCBF["syncCreatorBrainFull(client, userId)"] --> PCB
    SCBF --> SBF
    SCBF --> SBPP
```

### 8.2 Voice Lab (`src/lib/brain/sync.ts → syncBrainVoiceLab`)

```mermaid
flowchart TD
    SBVL["syncBrainVoiceLab(client, userId, payload)"] --> PCB2["provisionCreatorBrain()"]
    PCB2 --> GBP["getBrainPage(client, userId, BRAIN_SLUG.voice)"]
    GBP --> MERGE["Merge existing brain page JSON with:\n{ voice_description, voice_rules,\nvocabulary_fingerprint, structural_patterns }"]
    MERGE --> PBV2["putBrainPage: voice slug"]
    PBV2 --> SBF2["syncBrainFromProfile()\nprofile page refresh"]
```

### 8.3 Hook RL Feedback Loop

```mermaid
flowchart LR
    POST_PERF["Post gets views/likes\n(pulled by engagement sync)"] --> UHP2["updateHookPerformance(hookId, delta)\nhooks-intelligence/index.ts\nRL micro-update:\ntotal = clamp(0,100, current.total + delta*0.7)\nconfidence = min(0.98, confidence + 0.03)"]
    UHP2 --> SAVE2["saveHookDataset()\nbest-effort file write\n(DB hook_examples is source of truth)"]
```

### 8.4 Analytics (`src/lib/analytics.ts`)

```mermaid
flowchart LR
    TE["trackEvent(event, properties)\n8 event types:\nsignup_complete · onboarding_complete · account_connected\nfirst_post_scheduled · first_publish_success\nupgrade_checkout_started · subscription_active · publish_failed"]
    TE --> LI["logInfo('analytics', payload)\n→ JSON to stdout"]
    TE --> WH{"ANALYTICS_WEBHOOK_URL set?"}
    WH -->|"yes"| POST_WH["POST webhook body (non-blocking)"]
    WH -->|"no"| NOOP["noop"]
```

---

## 9. Billing (Stripe)

```mermaid
flowchart TD
    subgraph "Checkout Flow"
        BCO["POST /api/billing/checkout/route.ts"] --> AU_B["getAuthenticatedUser()"]
        AU_B --> GS_ENT["getUserEntitlements(userId)"]
        GS_ENT --> GCS["createStripeCustomer(email, userId)\nPOST stripe /customers"]
        GCS --> CCS["createCheckoutSession({ customerId, priceId, successUrl, cancelUrl })\nPOST stripe /checkout/sessions"]
        CCS --> REDIR["Return Stripe checkout URL"]
    end

    subgraph "Webhook Flow"
        BWH["POST /api/billing/webhook/route.ts"] --> HSW["handleStripeWebhook(payload, signature)\nsrc/lib/stripe-webhook.ts"]
        HSW --> VSS["verifyStripeSignature()\nHMAC-SHA256 timing-safe compare"]
        VSS -->|"fail"| WH_ERR["400 Invalid signature"]
        VSS -->|"ok"| SWITCH{"event.type"}
        SWITCH -->|"checkout.session.completed"| UPS1["DB: subscriptions UPSERT\nplan=metadata.plan, status='active'\nstripe_customer_id, stripe_subscription_id"]
        SWITCH -->|"customer.subscription.updated/deleted"| LOOKUP["DB: subscriptions\nresolve userId from stripe_customer_id\n(fallback: metadata.user_id)"]
        LOOKUP --> UPS2["DB: subscriptions UPSERT\nmap status: active/trialing/past_due/canceled\nIf canceled: plan → 'free'"]
    end

    subgraph "Portal Flow"
        BPO["POST /api/billing/portal/route.ts"] --> CBPS["createBillingPortalSession(customerId, returnUrl)\nPOST stripe /billing_portal/sessions"]
        CBPS --> PREDIR["Return portal URL"]
    end
```

> **Plan → Limits mapping** is in `PLAN_LIMITS` in `entitlements.ts`. The Stripe webhook is the **only** way plans get activated/upgraded/canceled.

---

## 10. Workspace System (`src/lib/workspace.ts`)

```mermaid
flowchart TD
    EAW["getActiveWorkspace(userId)"] --> LW["listWorkspaces(userId)\nDB: workspace_members JOIN workspaces"]
    LW --> COOK["Check cookie: content-os-workspace"]
    COOK --> PICK["Pick: cookie match > solo type > first"]

    ESW["ensureSoloWorkspace(userId)"] --> LW2["listWorkspaces()"]
    LW2 -->|"empty"| CRSW["DB: workspaces INSERT solo\nDB: workspace_members INSERT owner"]

    CCW["createClientWorkspace(userId, name)"] --> CCAN["canCreateWorkspace()\nlistWorkspaces() + getUserEntitlements()\nLimit: free=1, starter=3, growth=10, pro=50"]
    CCAN -->|"allowed"| CRCW["DB: workspaces INSERT client\nDB: workspace_members INSERT owner"]
```

---

## 11. Full API Surface (29 Route Groups)

| Route | Methods | Purpose |
|---|---|---|
| `/api/analytics` | GET, POST | Analytics events read/write |
| `/api/auth/*` | POST | Token validation, session |
| `/api/auto-generate` | POST | Cron-driven auto content gen |
| `/api/billing/checkout` | POST | Start Stripe checkout |
| `/api/billing/portal` | POST | Stripe billing portal |
| `/api/billing/webhook` | POST | Stripe webhooks |
| `/api/brain/provision` | POST | Provision creator brain |
| `/api/brain/save` | POST | Save brain page |
| `/api/brain/status` | GET | Brain page list |
| `/api/brain/sync` | POST | Full brain sync |
| `/api/cron/publish` | GET | Scheduled publish cron (CRON_SECRET) |
| `/api/cron/auto-generate` | GET | Scheduled content generation |
| `/api/engagement/draft-replies` | POST | AI-draft comment replies |
| `/api/engagement/inbox` | GET | Fetch engagement inbox |
| `/api/engagement/send` | POST | Send drafted replies |
| `/api/engagement/sync` | POST | Sync comments from Ayrshare |
| `/api/entitlements` | GET | User plan limits + usage |
| `/api/generate` | POST | Primary AI generation |
| `/api/hashtag-sets/[id]` | PATCH, DELETE | Hashtag set management |
| `/api/hooks` | GET, POST | Hook examples CRUD |
| `/api/humanize` | POST | AI humanize text |
| `/api/ideas` | GET, POST | Content ideas |
| `/api/optimize` | POST | Platform variant generation |
| `/api/posts` | GET, POST, PATCH, DELETE | Post CRUD |
| `/api/publish` | POST | Immediate/scheduled publish |
| `/api/publish-jobs` | GET | List publish jobs |
| `/api/research` | POST | Hook Intelligence supervisor |
| `/api/series` | GET, POST, PATCH, DELETE | Content series |
| `/api/settings` | GET, POST | User settings |
| `/api/social-accounts` | GET | Connected social accounts |
| `/api/story-bank` | GET, POST, DELETE | Story bank |
| `/api/trends/detect` | POST | Trend detection |
| `/api/upload` | POST | File upload |
| `/api/video/*` | POST | Video gen, auto-edit |
| `/api/voice-lab/analyze` | POST | Voice analysis |
| `/api/voice-lab/import` | POST | Import posts for voice |
| `/api/voice-lab/interview` | POST | Voice interview |
| `/api/weekly-reviews` | GET, POST | Weekly analytics |
| `/api/workspaces` | GET, POST | Workspace management |
| `/api/health` | GET | Health check |

---

## 12. Database Schema (Inferred from Code)

| Table | Key Columns | Purpose |
|---|---|---|
| `creator_profile` | `user_id`, `display_name`, `bio`, `bio_facts`, `content_pillars`, `voice_description`, `voice_rules`, `onboarding_complete` | User profile + voice identity |
| `posts` | `id`, `user_id`, `title`, `platform`, `pillar`, `status`, `caption`, `script`, `hook`, `views`, `likes`, `scheduled_publish_at`, `publish_job_id`, `variant_group_id`, `source_platform`, `posted_date` | Content items |
| `publish_jobs` | `id`, `user_id`, `post_id`, `platform`, `status`, `idempotency_key`, `scheduled_for`, `attempts`, `max_attempts`, `last_error`, `provider`, `provider_post_id`, `provider_url` | Durable publish queue |
| `subscriptions` | `user_id`, `plan`, `status`, `stripe_customer_id`, `stripe_subscription_id`, `current_period_start`, `current_period_end` | Billing/plan data |
| `usage_counters` | `user_id`, `metric`, `period_key`, `count` | Monthly usage tracking |
| `usage_events` | `user_id`, `action`, `metadata`, `created_at` | Rich event log (best-effort) |
| `ayrshare_profiles` | `user_id`, `profile_key` (encrypted), `title` | Ayrshare per-user keys |
| `post_comments` | `id`, `user_id`, `post_id`, `platform`, `provider_comment_id`, `comment_text`, `author_name`, `author_handle`, `commented_at`, `synced_at` | Synced comments |
| `comment_reply_queue` | `id`, `user_id`, `post_comment_id`, `draft_reply`, `status`, `voice_match_score`, `evaluation`, `sent_at`, `provider_reply_id`, `last_error` | Reply drafts pipeline |
| `user_settings` | `user_id`, `key`, `value` | Key-value settings store |
| `workspaces` | `id`, `owner_user_id`, `name`, `type` | Workspace management |
| `workspace_members` | `workspace_id`, `user_id`, `role` | Workspace membership |
| `brain_pages` | `user_id`, `slug`, `title`, `tags`, `body` | Creator brain knowledge store |
| `hook_examples` | (inferred) | Live mined hook database |

---

## 13. Complete Data Flow Summary

```mermaid
flowchart TD
    USER["👤 Creator"] --> AUTH["Auth\n(InsForge → httpOnly cookie)"]
    AUTH --> DASH["Dashboard\n/(dashboard)/* pages"]
    DASH --> IDEA["Ideas / Trends\n/api/research · /api/ideas · /api/trends"]
    IDEA --> DRAFT["AI Draft\n/api/generate\nguardAiRequest → loadVoiceContext →\ngenerateWithVoicePipeline →\n(draft → eval → revise → humanize)"]
    DRAFT --> LIB["Post Library\n/api/posts\nsave draft/scripted/scheduled"]
    LIB --> PUB["Publish\n/api/publish → enqueuePublishJob\n→ processPublishJob → Ayrshare API"]
    PUB --> ENGMNT["Engagement Inbox\npost_comments (synced from Ayrshare)\n→ draftEngagementReplies\n→ sendAyrshareCommentReply"]
    ENGMNT --> BRAIN["Creator Brain\nsyncBrainPublishedPost\nupdateHookPerformance (RL)\nsyncBrainWins"]
    BRAIN --> IDEA

    STRIPE["Stripe"] --> WHK["Billing Webhook\n→ subscriptions table\n→ plan limits enforced"]
    WHK --> ENTITLE["Entitlements\nguardAiRequest · assertCanPublish"]
    ENTITLE --> DRAFT & PUB
```

---

*Generated by systematic CodeGraph traversal + line-by-line file review. Last scan: June 2026.*
