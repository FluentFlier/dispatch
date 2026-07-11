# Content OS

**Backend:** InsForge project **dispatch** — API `https://mm4nbzdu.us-east.insforge.app`, site `https://contentos.us`

Private content command center for creators who ship. Generate, organize, schedule, and publish across X, LinkedIn, Instagram, and Threads from one workspace.

> The product name is **Content OS** (repo slug: `content-os`). Use this name consistently across the UI and docs.

## Features

- **Generate** — AI studio with voice QA scores: scripts, hooks, captions, story mining, repurposing, trends, series planning
- **Comments** — Sync replies on your posts, AI drafts in your voice, approve and send (requires Unipile)
- **Library** — Post command center (Write | Schedule | Comments | Stats tabs), pipeline, bulk publish
- **Calendar** — Month/week views, drag-and-drop scheduling, AI week fill
- **Publish** — Unipile-connected X, LinkedIn, Instagram, Threads; platform-specific formatting
- **Analytics** — Weekly reviews, pillar breakdowns, performance logging, hook examples
- **Leads** — Signal-based lead engine (requires signals schema + ingest keys)
- **Voice Lab** — Tune AI output to your voice and pillars
- **Teleprompter** — Full-screen recording mode with mirror and offline support
- **Video Studio** — Remotion template preview only (export/auto-edit not shipping yet)
- **Hook examples** — Local mined-hook dataset for Generate (full RL loop not live yet)

## Stack

- [Next.js 14](https://nextjs.org/) (App Router) + TypeScript
- [Tailwind CSS 3.4](https://tailwindcss.com/)
- [InsForge](https://insforge.app/) — auth, database, storage, AI gateway, frontend hosting
- [Remotion](https://www.remotion.dev/) — video compositions
- Claude via InsForge AI (`anthropic/claude-sonnet-4.5`)
- GStack (dev-time mining + browser automation) + Apify (production-scale hook collection) for the Hook Intelligence system (RL, RAG over 1000+ viral hooks)

## Prerequisites

- Node.js 20+
- InsForge project (URL + anon key)
- OAuth app credentials for platforms you connect (optional for local UI dev)

## Setup

```bash
git clone https://github.com/FluentFlier/dispatch.git
cd dispatch
npm install
npx @insforge/cli link   # link to your InsForge "dispatch" project
cp .env.example .env.local
# Or pull keys: npx @insforge/cli secrets get ANON_KEY --json
npm run dev
```

Open [http://localhost:3001](http://localhost:3001).

The default git branch is **main** (GitHub: [FluentFlier/dispatch](https://github.com/FluentFlier/dispatch)).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | ESLint |
| `npm run hooks:research` | Mine viral hooks (GStack) |
| `npm run hooks:listen` | Continuous hook mining loop |

## Environment variables

See [`.env.example`](.env.example). Required for core functionality:

- `NEXT_PUBLIC_INSFORGE_URL`
- `NEXT_PUBLIC_INSFORGE_ANON_KEY`
- `TOKEN_ENCRYPTION_KEY` — `openssl rand -hex 32`
- `NEXT_PUBLIC_APP_URL` — OAuth callbacks

Optional: Stripe keys, platform OAuth keys (direct mode), `CRON_SECRET`, Unipile (`UNIPILE_API_KEY` + `UNIPILE_DSN`).

**Apply schema in order** — see [`db/APPLY_ORDER.md`](db/APPLY_ORDER.md). Do not apply only `schema.sql`; Leads, engagement, and event capture need additional SQL files.

## Project layout

```
src/
  app/          # Routes (dashboard, API, auth)
  components/   # UI by feature area
  lib/          # InsForge, AI, platforms, crypto, hooks-intelligence
db/
  schema.sql    # PostgreSQL schema (InsForge)
docs/           # Plans and research (including Hook Intelligence system)
scripts/        # GStack mining, bulk DB import, continuous loops
```

## Deploy (production checklist)

**InsForge project:** `dispatch` (app key `mm4nbzdu`). Already linked via `.insforge/project.json`. Apply schema with `bash scripts/apply-core-schema.sh` (see [`db/APPLY_ORDER.md`](db/APPLY_ORDER.md)).

1. **InsForge** — Link project: `npx @insforge/cli link`
2. **Schema** — Follow [`db/APPLY_ORDER.md`](db/APPLY_ORDER.md) (core → production-delta → engagement → signals → intelligence → migrations).
3. **Secrets** — Set via `insforge secrets` or dashboard:
   - `NEXT_PUBLIC_INSFORGE_URL`, `NEXT_PUBLIC_INSFORGE_ANON_KEY`, `INSFORGE_SERVICE_ROLE_KEY`
   - `TOKEN_ENCRYPTION_KEY` (`openssl rand -hex 32`)
   - `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`
   - `UNIPILE_API_KEY`, `UNIPILE_DSN` (required for publish + comment send)
   - `LLM_BASE_URL`, `LLM_API_KEY` (or `HUGGINGFACE_API_KEY` fallback)
4. **OAuth** — Add redirect URLs in InsForge dashboard for `/login`
5. **Deploy frontend** — Use InsForge CLI (deploys to InsForge hosting):
   ```bash
   npm run build
   npx @insforge/cli deployments deploy .
   ```
   This handles the build and deploys to your project's InsForge frontend site (e.g. `https://<app-key>.insforge.site`).
6. **Crons** — Vercel Hobby plan only allows once-per-day crons. All scheduled jobs are triggered externally via [cron-job.org](https://cron-job.org) (free). See **Cron Setup** section below.
7. **Smoke test** — `GET /api/health` should return `status: ok`

### Cron Setup

Vercel Hobby blocks cron schedules that run more than once per day. All background jobs are triggered externally by **cron-job.org** (free tier, no credit card).

**Why external?** Vercel's clock would be ideal but is plan-gated. cron-job.org calls your endpoints on the same schedule — your code doesn't change, the `CRON_SECRET` still protects every endpoint.

**How it works:**
```
cron-job.org timer → GET https://your-app/api/cron/fast
                      Header: Authorization: Bearer <CRON_SECRET>
                           ↓
                    publish queue + signals-sync run in parallel
```

**Setup steps:**
1. Create a free account at [cron-job.org](https://cron-job.org)
2. Create two cron jobs:

| Title | URL | Schedule | Method | Header |
|-------|-----|----------|--------|--------|
| `content-os-fast` | `https://contentos.us/api/cron/fast` | Every 5 minutes | GET | `Authorization: Bearer YOUR_CRON_SECRET` |
| `content-os-medium` | `https://contentos.us/api/cron/medium` | Every 15 minutes | GET | `Authorization: Bearer YOUR_CRON_SECRET` |

**What each job covers:**

`/api/cron/fast` (every 5 min):
- Publish queue — processes scheduled posts
- Signals sync — polls sources, classifies posts

`/api/cron/medium` (every 15 min):
- Engagement sync — pulls comments on published posts
- Event enrich — classifies and generates questions for calendar events
- Calendar sync — mirrors Google Calendar events *(runs at :00 of each hour)*
- Auto-generate — creates scheduled content *(runs at 8:00 AM UTC daily)*
- Intelligence sync — closes the RL loop on hook performance *(runs at 2:00 AM UTC daily)*

**Debugging:** cron-job.org shows run history and HTTP response codes. Vercel logs show what happened inside each endpoint. Check both when a job fails.

**Upgrading:** Switch to Vercel Pro and move schedules back into `vercel.json` — the fan-out routes (`fast`, `medium`) work identically whether called by cron-job.org or Vercel native crons.

### Hook Intelligence (advanced)

The system includes a production-grade Hook Intelligence layer:
- GStack (dev) + Apify (prod) mining of high-converting viral hooks from 100+ top creators.
- Target: 1,000+ hooks in the DB.
- RL trainer (from edits + real engagement + categorized leads).
- RAG retrieval for voice pipeline and UI.
- Live Research Lab in Analytics + intelligent suggestions in Generate.

See `scripts/research-hooks.ts`, `scripts/continuous-research-loop.sh`, `scripts/bulk-import-hooks-to-db.ts`, and `src/lib/hooks-intelligence/`.

### First-time user flow

Sign in → onboarding (profile + voice) → Settings → connect platforms (Unipile) → Write → Posts → publish → Comments inbox to reply.

The production site is deployed via InsForge (frontend hosting). For custom domains or advanced Vercel config, use the InsForge dashboard or link your own Vercel project.

## Brand

Visual and copy guidelines: [`Dispatch Brand Guide.md`](Dispatch%20Brand%20Guide.md).

## Related repos

- Ada iMessage: [Ada-The-AI-Secretary-For-Phones/ada-imessage](https://github.com/Ada-The-AI-Secretary-For-Phones/ada-imessage)

## License

Private — all rights reserved unless otherwise noted.
