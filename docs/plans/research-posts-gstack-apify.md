# Research Posts Puller — gstack + Apify

**Goal:** Let creators (and their brain) learn from the public posts of "these people" — followed accounts, peers, competitors, or inspiration sources — without manual copy-paste.

Pulls recent posts, hooks, captions, engagement signals (likes/views/comments counts when public) into Dispatch for:
- Story bank / Idea mining
- Voice training examples (positive + negative)
- Trend / hook pattern analysis
- Creator Brain `creator/{handle}` pages

## Why gstack first (not just Apify)

- **Local, controllable, codifiable**: Use the existing gstack browser in this environment (`$B` from `~/.claude/skills/gstack/browse/dist/browse` or the project vendored copy).
- `/scrape "latest 12 posts + hooks from x.com/@handle"` prototypes the flow once.
- `/skillify` turns it into a fast reusable browser-skill (~200ms) stored in `~/.gstack/browser-skills/` (or project-local).
- The resulting Playwright script (or the skill) can be promoted into the app as a reliable extractor.
- Zero extra cost for development / agent use. Works for X, public IG, LinkedIn company/personal pages, Threads, etc.
- Cookie import via `/setup-browser-cookies` or `gstack connect` for private-but-accessible data when the user is logged in.

Apify (or similar) is the **production/cloud fallback**:
- Mature actors for Instagram Profile Scraper, Twitter User Tweets, LinkedIn Company Posts, etc.
- Pay-per-use, reliable anti-bot, structured JSON out of the box.
- Good when we need scheduled background pulls for many users.

**Recommendation (v1):** gstack + skillify for the prototype + codified extractors. Later expose a thin `/api/research/posts` (or worker) that can delegate to a codified browser-skill or an Apify task.

## Proposed surface (MVP)

- Settings or a new "Research" / "Creators" section: add handles + platforms.
- "Pull recent posts" button on a creator card → runs the extractor → stores in `creator_research_posts` (or reuses brain pages + `post/{external}` style entries).
- Use in:
  - StoryMine / Idea suggestions
  - Voice Lab examples
  - Weekly review "what are peers shipping?"
- Respect robots / rate limits. Public data only by default. Clear attribution.

## Schema sketch (add to future delta)

```sql
create table if not exists creator_research_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  platform text not null,
  handle text not null,
  display_name text,
  last_pulled_at timestamptz,
  notes text,
  unique(user_id, platform, handle)
);

create table if not exists creator_research_posts (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references creator_research_targets(id) on delete cascade,
  provider_post_id text,
  url text,
  posted_at timestamptz,
  text text,
  hook text,
  metrics jsonb,           -- {likes, views, comments, reposts}
  raw jsonb,
  ingested_at timestamptz default now()
);
```

Index on `(target_id, posted_at desc)`.

## Implementation path

1. **Dev / agent time (today)**: Use gstack `/scrape` + `/skillify` on real profiles to discover stable selectors and produce the first browser-skill(s).
2. **Codify**: Promote the skill into the Dispatch repo (under `browser-skills/` or as a TS module using Playwright directly).
3. **App integration** (later PR):
   - New UI in Ideas or a dedicated Research tab.
   - API route that can invoke the local skill (dev) or call Apify (prod).
   - Store results → feed into brain / story bank / generate prompts ("write something in the style of @handle's last hook about X").
4. **Production**: When a user connects accounts or adds research targets, offer "background refresh via Apify" (opt-in, paid tier).

## Open questions

- Rate limiting / politeness for gstack runs during dev.
- How much to persist (full thread text vs. hooks + metrics)?
- Privacy / ToS notes in UI.
- Authenticated scraping (user's own logged-in browser cookies via gstack) for more data?

## Related

- Ties directly into Creator Brain (`syncBrainFromProfile` style pages for external creators).
- Complements the existing Engagement Inbox (own posts' comments) and Voice pipeline.
- Could power better auto-generate / trend catcher.

This is the natural next layer after the Dispatch v1 foundation (voice fidelity + command center + engagement loop).

See also: `docs/plans/dispatch-creator-os-master-plan.md` (Phase 4–5 area).
