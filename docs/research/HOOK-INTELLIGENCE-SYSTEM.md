# Hook Intelligence + Social Listening System

**The phenomenal, always-on, free (gstack-powered) hook & social radar for Dispatch.**

This is the system that lets our agents and users stay on the cutting edge of what actually converts on X, LinkedIn, etc.

## What it is

- **Massive free mining** using gstack's local headless browser (`$B` binary + skill system).
- **Smart scoring + learned ranking** (lightweight RL-style). Hooks get better scores when they perform.
- **Social listening / radar** — watchlist of 80+ high-signal accounts across every vertical. Refresh on demand.
- **Dataset that grows forever** — 100s → 1000s of real, proven hooks that feed generation.
- **Direct integration** into the voice pipeline so every piece of content Dispatch creates starts with world-class hooks.

## Core Components

- `src/lib/hooks-intelligence/` — The brain
  - `types.ts`
  - `watchlist.ts` (curated 80+ accounts)
  - `scorer.ts` (multi-signal conversion potential scorer + reinforcement)
  - `index.ts` (orchestrator, dataset, social listener entrypoint)

- `scripts/research-hooks.ts` — The miner. Run this locally with gstack to pull hundreds of fresh hooks.

- `scripts/gstack-extract-x-hooks.sh` — Simple shell version for quick runs.

- `data/hooks-dataset.json` (generated) — The living dataset.

- `src/lib/voice-prompts/hooks.ts` + `index.ts` — Now dynamically loads the best ranked hooks from the intelligence layer.

## How to run the mining (free, local, powerful)

```bash
# Mine 30 top indie/copy accounts
npx tsx scripts/research-hooks.ts --count 30

# Mine everything in the watchlist
npx tsx scripts/research-hooks.ts --all --limit 200
```

The script uses the real gstack browse binary under the hood, respects rate limits, and feeds the central intelligence system.

For continuous social listening / "always on top":

```bash
# The research script + a simple cron / agent loop
npx tsx scripts/research-hooks.ts --all
```

## The "RLML" part

The `scorer.ts` + `updateHookPerformance` is a practical reinforcement loop:

- Every hook gets a rich multi-dimensional score.
- When a hook is used in real content that performs well (we can wire this from analytics later), we call `reinforceHook` or `updateHookPerformance`.
- Over time the dataset learns which patterns actually move the needle for *this* user's voice and verticals.

This is cheap, local, and extremely effective "RL from execution data".

## Social Listening Vision

1. Run the miner regularly (manually or via agent).
2. The watchlist + keyword system surfaces trending hooks and formats in real time.
3. New interesting hooks get auto-proposed into Creator Brain or the user's Story Bank.
4. Generation always has fresh, high-signal examples instead of stale generic patterns.

## Why this is phenomenal

- 100% free at research/mining time (gstack local browser).
- Scales to thousands of real examples with almost zero marginal cost.
- The ranker + reinforcement loop means quality compounds.
- Directly upgrades every piece of content the user (and our future agents) create.
- Becomes a defensible moat for Dispatch: best-in-class hook intelligence that competitors using generic LLMs can't match.

## Next level (future work)

- Turn the best extraction flows into proper codified gstack browser-skills (so mining becomes 200ms `skill run x-hook-miner`).
- Expose a "Hook Radar" UI in the app.
- Wire real performance feedback from published posts back into the ranker.
- Cross-platform (LinkedIn, Threads, IG captions) mining.
- User personal watchlists that feed their private Creator Brain.

This is the foundation for "agents that build on amazing hooks".

Run the research script. Watch the dataset grow. The content quality jumps.
