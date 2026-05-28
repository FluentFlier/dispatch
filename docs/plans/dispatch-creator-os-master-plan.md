# Dispatch Creator OS — Master Plan

> Gary-style product plan: auto-replies on *your* posts, per-post command center, voice that survives automation.
> Imagine analysis included; LangChain optional at Phase 4.

## Thesis

**Dispatch = command center for creators who ship on every platform in their own voice.**

Imagine wins B2B LinkedIn GTM (agency, outbound comments, persona reports for ghostwriters).
Dispatch wins **solo creators** with **one pipeline**: plan post → draft in voice → publish everywhere → engage from one inbox → learn.

Auto-reply on **your** posts is in scope. Auto-comment on **strangers'** posts is not (that's Imagine's outbound GTM).

---

## What Imagine actually does (analysis)

### AI stack (3 layers)

| Layer | What | Voice relevance |
|-------|------|-----------------|
| **Persona Builder** | 500+ line system prompt → structured Client Persona Report | High — deep capture |
| **Content Writer** | Ghostwriter prompt + **hidden eval loop** (5 metrics, discard if &lt;8, regenerate) | **This is the secret** |
| **LangGraph Cloud** | Unified Agent, Auto LinkedIn Comment, research graphs | Medium for voice — high for **multi-step + tools + approval** |

### Content Writer quality loop (port the pattern, not the prompt)

Internal steps (never shown to user):

1. Silent draft
2. Score: Persona Fidelity, Uniqueness, Specificity, So-What, Pain Resonance (1–10 each)
3. If any &lt; 8 → discard → new draft
4. Deliver polished output

Dispatch equivalent: `voice-pipeline.ts` + `voice-evaluator.ts` (implemented).

### LangGraph is used for

- Tasks chat (Unified Agent) with streaming + tool calls
- Cron: auto-comment on **target accounts** (outbound)
- Human-in-the-loop via Agent Inbox (approve before send)

**Not** used for: simple one-shot captions (that's deprecated chat routes + graphs).

### Product UX Imagine nails

- **Post modal**: content + schedule + media + mentions + first comment + notes + labels + AI chat sidebar
- **Comment list**: pending/sent comments tied to tasks
- **Engagement analytics**: who commented, lead buckets

---

## Dispatch differentiation

| | Imagine | Dispatch |
|--|---------|----------|
| Buyer | Agency / founder GTM | Creator / small brand |
| Platforms | LinkedIn-first | X, LI, IG, Threads |
| Auto engagement | Comment on others' posts | Reply on **own** posts |
| Voice | Persona Report (agency doc) | Voice Lab + Creator Brain (living) |
| Planning | Calendar + post modal per client | Library + calendar → **Post Command Center** |

---

## End-to-end loop (target state)

```text
ONBOARD
  Voice Lab → Creator Brain (voice, profile)

PLAN (per post)
  Idea → hook → script/caption → variants per platform → schedule → first comment plan

PUBLISH
  Outstand → provider_post_id → brain sync (post/{id}, wins)

ENGAGE (auto-assisted)
  Cron sync comments (Outstand GET /replies)
  → Inbox: one list, grouped by post
  → AI draft reply in voice (voice pipeline)
  → User approves batch / one-click send (Outstand POST /replies)

LEARN
  Analytics → wins page → next drafts pull top patterns
```

---

## Voice system (no LangChain required)

### Layers

1. **Capture** — Voice Lab (samples → analysis → interview → rules)
2. **Store** — Creator Brain pages + `creator_profile`
3. **Retrieve** — brain + few-shots + optional Supermemory
4. **Compose** — modular ghostwriter principles (`lib/voice-prompts/`)
5. **Evaluate** — 5-metric critic (`lib/voice-evaluator.ts`)
6. **Revise** — max 2 loops if metrics fail
7. **Humanize** — strip AI tells
8. **Gate** — optional min score before publish

### LangChain vs InsForge-native agent

| Need | Recommendation |
|------|----------------|
| Draft + critique + revise | **TypeScript pipeline** (now) |
| Auto-reply batch with approval | **TS workflow** + DB queue (Phase 2) |
| Research chat agent | LangGraph **or** Vercel AI SDK tools (Phase 4) |
| Long-running cron graphs | InsForge schedules + idempotent steps |

**Rule:** Add LangGraph when you need **streaming multi-tool chat** with checkpointing — not to fix voice.

---

## Phased build

### Phase 1 — Voice fidelity (week 1) ✅ complete

- [x] Creator Brain
- [x] Voice pipeline (draft → critique → revise)
- [x] 5-metric evaluator (Imagine-style)
- [x] Modular `voice-prompts/` (principles, hooks, platform playbooks)
- [x] Show scores in Generate + Library editor

### Phase 2 — Post Command Center (week 2)

**Route:** `/library/[postId]` or expanded drawer tabs

| Tab | Contents |
|-----|----------|
| Content | script, caption, hook, variants, voice score |
| Platforms | per-platform preview + constraints |
| Schedule | datetime, queue status |
| Engage | synced comments, draft replies, send |
| Stats | views, likes (Outstand sync) |

Mirror Imagine post modal; creator-scoped (no `clientId`).

### Phase 3 — Engagement Inbox (week 3)

**DB:** `post_comments`, `comment_reply_queue` (see `db/engagement.sql`)

**APIs:**

- `POST /api/engagement/sync` — pull Outstand replies for published posts
- `GET /api/engagement/inbox` — grouped by post
- `POST /api/engagement/draft-replies` — voice pipeline batch
- `POST /api/engagement/send` — approved → Outstand POST

**UI:** `/inbox` — filter: needs reply / drafted / sent

**Auto settings:**

- `auto_draft_replies` — cron drafts, never sends without approval
- `auto_send_replies` — opt-in only, rate-limited

### Phase 4 — Outstand + analytics (week 3–4)

- Outstand provider (publish + replies + analytics)
- Cron: sync metrics → posts table
- Dashboard: cross-platform performance

### Phase 5 — Agent chat (optional, week 5+)

- Unified “content strategist” chat
- LangGraph **if** you need subgraph streaming; else AI SDK + tools
- Tools: search brain, draft post, schedule, suggest replies

---

## Auto-reply: Gary rules

**Do automate:**

- Pull comments into one inbox
- Draft replies in creator voice
- Suggest first comment when scheduling post

**Do not automate (v1):**

- Send replies without approval (default off)
- Reply to spam/trolls without filter
- Comment on other people's posts (Imagine lane)

**Completeness:** 10/10 = sync + draft + approve + send + audit log.

---

## Success metrics

| Metric | Target |
|--------|--------|
| Voice match score avg on generate | &gt; 80 |
| % posts with brain `post/{id}` after publish | &gt; 90% |
| Time to clear comment inbox | &lt; 10 min/day |
| WAU publishing through Dispatch | growing week over week |

---

## Immediate next commits

1. `voice-evaluator.ts` + pipeline integration
2. `db/engagement.sql` applied on InsForge
3. Post Command Center tab scaffold in `PostEditorDrawer`
4. Outstand provider skeleton
