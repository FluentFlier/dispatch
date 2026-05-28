# Dispatch

Private content command center for creators who ship. Generate, organize, schedule, and publish across X, LinkedIn, Instagram, and Threads from one workspace.

> Formerly developed as **content-os**. The product name is **Dispatch**.

## Features

- **Generate** — AI studio with voice QA scores: scripts, hooks, captions, story mining, repurposing, trends, series planning
- **Comments** — Sync replies on your posts, AI drafts in your voice, approve and send
- **Library** — Post command center (Write | Schedule | Comments | Stats tabs), pipeline, bulk publish
- **Calendar** — Month/week views, drag-and-drop scheduling, AI week fill
- **Publish** — OAuth for X, LinkedIn, Instagram, Threads; platform-specific formatting
- **Analytics** — Weekly reviews, pillar breakdowns, performance logging
- **Video Studio** — Remotion-based templates and preview
- **Voice Lab** — Tune AI output to your voice and pillars
- **Teleprompter** — Full-screen recording mode with mirror and offline support

## Stack

- [Next.js 14](https://nextjs.org/) (App Router) + TypeScript
- [Tailwind CSS 3.4](https://tailwindcss.com/)
- [InsForge](https://insforge.app/) — auth, database, storage, AI gateway
- [Remotion](https://www.remotion.dev/) — video compositions
- Claude via InsForge AI (`anthropic/claude-sonnet-4.5`)

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

Open [http://localhost:3000](http://localhost:3000).

The default git branch is **main** (GitHub: [FluentFlier/dispatch](https://github.com/FluentFlier/dispatch)).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm run lint` | ESLint |

## Environment variables

See [`.env.example`](.env.example). Required for core functionality:

- `NEXT_PUBLIC_INSFORGE_URL`
- `NEXT_PUBLIC_INSFORGE_ANON_KEY`
- `TOKEN_ENCRYPTION_KEY` — `openssl rand -hex 32`
- `NEXT_PUBLIC_APP_URL` — OAuth callbacks

Optional: `AYRSHARE_API_KEY`, Stripe keys, platform OAuth keys (direct mode), `CRON_SECRET`.

Apply schema changes: `npx @insforge/cli db query "$(cat db/production-delta.sql)"` or run statements from `db/production-delta.sql` individually.

## Project layout

```
src/
  app/          # Routes (dashboard, API, auth)
  components/   # UI by feature area
  lib/          # InsForge, AI, platforms, crypto
db/
  schema.sql    # PostgreSQL schema (InsForge)
docs/           # Plans and research
```

## Deploy (production checklist)

1. **InsForge** — Link project: `npx @insforge/cli link`
2. **Schema** — Apply in order:
   - `db/schema.sql` (fresh projects)
   - `db/production-delta.sql` (billing, publish queue, engagement)
   - `db/creator-brain.sql` (Creator Brain pages)
3. **Secrets** — Set in Vercel / InsForge:
   - `NEXT_PUBLIC_INSFORGE_URL`, `NEXT_PUBLIC_INSFORGE_ANON_KEY`, `INSFORGE_SERVICE_ROLE_KEY`
   - `TOKEN_ENCRYPTION_KEY` (`openssl rand -hex 32`)
   - `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`
   - `AYRSHARE_API_KEY` (recommended for multi-platform publish + comment sync)
4. **OAuth** — Add redirect URLs in InsForge dashboard for `/login`
5. **Deploy** — [Vercel](https://vercel.com/) with [`vercel.json`](vercel.json) crons:
   - `/api/cron/publish` — every 5 min
   - `/api/cron/engagement-sync` — every 15 min
   - `/api/cron/auto-generate` — daily
6. **Smoke test** — `GET /api/health` should return `status: ok` (social may be `missing` until Ayrshare is set)

### First-time user flow

Sign in → onboarding (profile + voice) → Settings → connect platforms (Ayrshare) → Write → Posts → publish → Comments inbox to reply.

Configured for [Vercel](https://vercel.com/). Set the project **Root Directory** to `.` (repo root).

## Brand

Visual and copy guidelines: [`Dispatch Brand Guide.md`](Dispatch%20Brand%20Guide.md).

## Related repos

- Ada iMessage: [Ada-The-AI-Secretary-For-Phones/ada-imessage](https://github.com/Ada-The-AI-Secretary-For-Phones/ada-imessage)

## License

Private — all rights reserved unless otherwise noted.
