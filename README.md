# Dispatch

Private content command center for creators who ship. Generate, organize, schedule, and publish across X, LinkedIn, Instagram, and Threads from one workspace.

> Formerly developed as **content-os**. The product name is **Dispatch**.

## Features

- **Generate** — AI studio: scripts, hooks, captions, story mining, repurposing, trends, comment replies, series planning
- **Library** — Post CRM with status pipeline, filters, bulk actions, and editor drawer
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

## Deploy

Configured for [Vercel](https://vercel.com/) with cron jobs in [`vercel.json`](vercel.json). Set the project **Root Directory** to `.` (repo root). Ensure all env vars from `.env.example` are set in the Vercel dashboard.

## Brand

Visual and copy guidelines: [`Dispatch Brand Guide.md`](Dispatch%20Brand%20Guide.md).

## Related repos

- Ada iMessage: [Ada-The-AI-Secretary-For-Phones/ada-imessage](https://github.com/Ada-The-AI-Secretary-For-Phones/ada-imessage)

## License

Private — all rights reserved unless otherwise noted.
