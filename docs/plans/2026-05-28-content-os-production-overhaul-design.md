# Content OS — Production Overhaul & Tiered Multi-Tenancy

Date: 2026-05-28
Status: Approved, executing autonomously
Branch: feat/designer-grade-suite

## Goal

Take Content OS from a polished-but-single-tenant prototype to a production-grade
tool that both solo creators and social-media managers (agencies) can rely on.
Solo users get one workspace; agencies get multiple client workspaces, each with
its own trained voice, connected socials, calendar, inbox, and analytics.

Success criteria:
- Every screen works end to end against the live InsForge backend; no fake/simulated features.
- Backend is secure: uniform RLS, rate limiting, validated inputs, no secret leaks.
- Tiered multi-tenancy: solo (1 workspace) and agency (N client workspaces), plan-gated.
- No em-dashes anywhere in source.
- `tsc --noEmit`, `next lint`, and `next build` all pass; QA walkthrough is clean.

## Audit summary (evidence-based, 2026-05-28)

Code is more disciplined than it felt: 1 TS error, lint clean, zod almost everywhere,
AES-256-GCM token encryption, OAuth PKCE+state, cron bearer auth, Stripe signature
verification. The real problems:

- RLS is half-applied. ~12 core tables (`posts`, `creator_profile`, `subscriptions`,
  `content_ideas`, `series`, `story_bank`, `publish_jobs`, `hashtag_sets`,
  `weekly_reviews`, `user_settings`, `usage_counters`, `ayrshare_profiles`) have NO RLS.
  App-layer `.eq('user_id')` is the only barrier. One forgotten filter = IDOR.
- Service client silently falls back to public anon key if service role key missing.
- No rate limiting on expensive AI endpoints (`optimize` = up to 4 Claude calls; `research` unmetered).
- Fake features: Video Studio export is simulated; "Save to Brain" ignores payload;
  analytics shows hardcoded lead counts; hooks dataset read via CWD-relative `fs` (breaks in serverless).
- UX: Series/Story-Bank/Video-Studio/Teleprompter not in nav; post deep-linking broken
  (always lands on /library index); native alert()/confirm(); silent console.error failures.
- 56 em-dashes across 33 files.
- No multi-tenancy: one user = one creator_profile = one voice = one set of socials.

## Key decisions

- **Migration strategy: branch-and-merge.** Phase 2 schema + RLS rewrite happens on an
  InsForge branch project, verified for tenant isolation, then merged to prod.
- **Cadence: autonomous.** Execute all phases, stopping only for true blockers.
- **Non-breaking migrations.** Additive nullable `workspace_id`, backfill, then enforce.
  Never drop `user_id` (keep as defense-in-depth during transition).

## Phases

### Phase 0 — Truth & polish (low risk)
- [ ] Fix the 1 TS error (`landing/primitives.tsx`).
- [ ] Remove fake/misleading features or make them honest:
      Video Studio export, "Save to Brain", analytics demo lead counts + stale copy.
- [ ] Fix hooks dataset serverless read (static import or DB-backed).
- [ ] Replace native `alert()`/`confirm()` with app toasts/modal; add error toasts to
      Ideas/Calendar/Series/Story-Bank/Video-Studio.
- [ ] Remove dead code: stray leaked comment (QuickActions), `as any` in voice-pipeline,
      redundant ternary in publish route, unused imports.
- [ ] Remove ALL em-dashes from `src` (UI copy, LLM prompts, comments, landing).

### Phase 1 — Security & production hardening
- [ ] Uniform RLS: enable + force + `user_id = auth.uid()` policies on every tenant table.
- [ ] Require `INSFORGE_SERVICE_ROLE_KEY` in prod; remove anon-key fallback.
- [ ] Rate-limit every AI endpoint; back limiter with a real sliding window/shared store.
- [ ] `/api/research`: zod + try/catch + rate limit.
- [ ] Sanitize DB error messages (log server-side, return generic).
- [ ] Security headers + CSP in `next.config.mjs`.
- [ ] Upload: magic-byte validation + confirm bucket ACL.
- [ ] SSRF importer: pin resolved IP / re-validate on redirect.
- [ ] Stripe webhook: resolve user by `stripe_customer_id`, not subscription metadata.
- [ ] Enforce `aiGenerationsPerMonth` entitlement.

### Phase 2 — Tiered multi-tenancy (on InsForge branch, then merge)
- [ ] Schema: `workspaces`, `workspace_members`; add nullable `workspace_id` to ~20 tables.
- [ ] Backfill: one personal workspace per existing user; set `workspace_id` from `user_id`.
- [ ] Rewrite RLS to membership-based:
      `workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())`.
- [ ] API: workspace resolver (active workspace via cookie/header); thread through all query sites + inserts.
- [ ] Session/auth: workspace-aware; list + active selection.
- [ ] `creator_profile`: 1:N per workspace (voice isolation).
- [ ] UI: real workspace/client switcher (Sidebar + BottomBar); multi-client onboarding ("add a client").
- [ ] Entitlements: agency tier + workspace/client limits; solo = 1 workspace.
- [ ] Service-role code paths (crons, Stripe webhook) made workspace-aware.

### Phase 3 — Feature completeness & UX
- [ ] Add Series/Story-Bank/Video-Studio/Teleprompter to nav or give real entry points.
- [ ] Fix post deep-linking everywhere (open editor for specific post; Next router, not full reload).
- [ ] Video Studio: implement real render+poll, or label as preview and disable fake completion.
- [ ] Standardize `PageHeader` across screens.
- [ ] Library: touch-accessible status menu; server-side filtering.
- [ ] `trends/detect`: best-effort persistence; clean up cron no-op training.

### Phase 4 — Full QA & verification (gstack)
- [ ] Walk every screen against live backend; exercise onboarding -> generate -> schedule ->
      publish -> inbox -> analytics.
- [ ] Create a 2nd client workspace; verify tenant isolation (no cross-leak of voice/socials/posts).
- [ ] Fix everything QA surfaces.
- [ ] Final: typecheck, lint, build all green.
