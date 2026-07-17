# Leads Revamp AI Handoff

Status: approved design, implementation not started.

Branch: `feat/leads-revamp-analysis`

Target branch: `main`

## Read this first

1. Read [`objective-driven-leads-design.md`](./objective-driven-leads-design.md) completely. It is the product and engineering source of truth.
2. Open [`wireframe.html`](./wireframe.html) to see the intended low-friction onboarding and familiar lead-detail workflow.
3. Inspect the existing leads and onboarding code before editing. The design deliberately preserves the current feed, draft, approval, send, reply, conversion, and nurture lifecycle.

## Product decision

Replace the company-only ICP model with an objective-driven Mission model:

- Durable context answers: “What are you building or growing?”
- A Mission answers: “What are you trying to make happen now?”
- Targets can be people or organizations.
- A lead is a typed target matched to one immutable Mission version.
- Only evidence-backed, safe, actionable matches enter the default feed.
- Incomplete matches are candidates and cannot silently behave like workable leads.

Release one supports customer acquisition and fundraising. Hiring, partnerships, networking, global-onboarding promotion, autonomous sending, and generalized relationship graphs are explicitly deferred.

## Friction decision

Do not add a multi-field onboarding questionnaire.

The first Leads visit accepts one website, profile, deck/document, pasted description, or one sentence. Content OS extracts durable context and asks at most one follow-up when ambiguity changes the search strategy, recipient type, or eligibility threshold.

The Mission composer is one plain-language prompt. Advanced sources, exclusions, schedules, and caps stay behind progressive disclosure.

## Architecture decision

Use an additive compatibility migration:

- Keep `signal_icp_profiles` as the transitional storage table, but call the concept Mission in the product.
- Add immutable Mission versions and resumable Mission runs.
- Add conservative, source-backed person/organization entities and affiliations.
- Retain `signal_leads` as the Mission-match workflow record so existing outreach and nurture foreign keys remain valid.
- Add persisted candidate/workable/stale/suppressed states and claim-level evidence.
- Never write a person's name into `company_name`.
- Keep production person writes disabled until every legacy consumer passes the entity-type compatibility matrix in the design.

## Required implementation order

1. Phase 0 compatibility contract tests and inventory of direct company/founder assumptions.
2. Additive schema, RLS, composite workspace foreign keys, backfill, and reconciliation tooling.
3. Leads-local context capture and authoritative context claims.
4. Mission composer, compiler, immutable versions, and resumable runs.
5. Internal organization-first customer-acquisition vertical slice.
6. Person compatibility and consumer matrix.
7. Fundraising provider benchmark and vertical slice.
8. Feedback proposals and broader rollout only after observed data supports them.

Do not begin with visual renaming alone. The current extractor, dedupe, scoring, enrichment, drafting, import/export, digest, and reply paths contain company assumptions that must be handled as one compatibility program.

## Review record

The design went through three independent adversarial review passes across completeness, consistency, clarity, scope, and feasibility.

- First review: 5/10
- Second review: 8/10
- Final review: 9/10
- 65 review findings resolved

The final pass drove explicit contracts for entity merge collisions, cancellation, independent-buyer and angel scoring profiles, sensitive-evidence expiry, and reusable entity-level affiliation evidence.

## Verification expectations

Before enabling person discovery in production, verify both person and organization behavior for:

- Feed and detail rendering
- Drafting and polishing
- Contact verification
- Approval and send
- Import and export
- Nurture and next actions
- Reply matching
- Notes and messages
- Conversion stages
- Digests and analytics
- Signal-based reactivation

Provider selection must pass the stratified benchmark and latency gates in the design. Do not lower the workable-lead evidence contract to hit result-count or latency targets.

## Suggested prompt for another AI

> Read `docs/leads-revamp/README.md` and `docs/leads-revamp/objective-driven-leads-design.md` completely. Inspect the existing onboarding, leads, signals, enrichment, outreach, import/export, nurture, and database code. Implement only the next approved vertical slice, starting with Phase 0 compatibility tests and a direct-assumption inventory. Preserve existing organization-lead behavior. Do not enable production person writes until the compatibility matrix is green. Use the managed target branch reported by `sc worktree status --json`, and report any conflict between the implementation and the approved design before changing scope.

## Current repository areas

- `src/app/(dashboard)/onboarding/`
- `src/app/(dashboard)/leads/`
- `src/app/api/leads/`
- `src/components/leads/`
- `src/lib/signals/leads/`
- `src/lib/signals/ingest/lead-sources/`
- `src/lib/signals/outreach/`
- `src/lib/gtm/`
- `db/signals-leads.sql`
- `db/signal-icp-profiles.sql`
- `tests/phase-lead-*.test.ts`
- `tests/phase-leads-*.test.ts`
