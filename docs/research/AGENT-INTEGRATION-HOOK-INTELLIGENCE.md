# Agent Integration & Data Strategy for Hook Intelligence

## 1. How do we gather all this data?

**Primary method (free & powerful):** gstack local browser automation.

- The `scripts/research-hooks.ts` + `gstack-extract-x-hooks.sh` use the real gstack `$B` binary to visit X profiles and extract post text via reliable `data-testid` selectors.
- We maintain a large curated `watchlist.ts` (now 50+ and growing toward 150-200 high-signal accounts across the full palette: indie makers, direct response, thread writers, visual thinkers, AI builders, etc.).
- Mining is run locally by the team or research agents. It's "free" (no Apify credits) and gives us real, fresh, high-engagement examples.
- Future scaling:
  - Codify the best extraction flows into proper gstack **browser-skills** (200ms `skill run x-hook-miner --arg handle=...`).
  - Periodic research agent runs (via OpenClaw or local cron).
  - User-contributed hooks (when they mark a generated post as "high performing").
  - Later: hybrid with Apify for production scheduled listening at scale.

Data lands in:
- Local growing `data/hooks-dataset.json` (or JSONL for streaming).
- InsForge `hook_examples` table (see `db/hooks-intelligence.sql`).

## 2. How can we integrate with LangChain / LangGraph / agents?

We built a clean **agent tool layer** exactly for this:

**File:** `src/lib/hooks-intelligence/agent-tools.ts`

Exposed tools (ready for OpenAI function calling, LangChain, LangGraph, Claude tools, etc.):

- `get_top_hooks(vertical, context, limit)` → Returns the actual best-ranked real hooks for a vertical or topic. This is the killer feature for agents.
- `search_hooks(query, vertical)`
- `get_social_listening_insights()` → What are the top accounts posting right now?

These are also exposed via:
- `GET /api/hooks/intelligence?...` (the app + any agent can call)
- `toOpenAITools()` helper → direct OpenAI tool schema (perfect for InsForge AI gateway which is OpenAI-compatible).

**Recommended agent architecture (LangGraph example):**

```python
# Pseudo
graph = StateGraph(...)
graph.add_node("hook_researcher", HookResearcherTool())  # calls our get_top_hooks
graph.add_node("voice_writer", VoicePipelineNode())     # our existing generateWithVoicePipeline now auto-injects top hooks
graph.add_edge("hook_researcher", "voice_writer")
```

The voice pipeline itself (`src/lib/voice-pipeline.ts`) was updated to **automatically inject the top 6 real mined hooks** as few-shot examples on every generation. Agents get this for free.

This turns any content agent into a "hook-augmented super writer."

## 3. How do we make this useful for creating better (amazing) posts?

**Immediate value (already wired):**
- Every time someone uses Generate (script, caption, hook, reply, etc.), the system prompt now contains real high-conversion hook examples pulled from the best creators in the world, ranked by our scorer.
- This is a massive quality jump over pure LLM generation.

**Next-level features to build on this foundation:**
- **Hook Radar / Research tab** in the app: Browse top hooks by vertical, save favorites to Creator Brain or Story Bank.
- **"Research Mode" in Generate**: "Write this post, but first research the best hooks being used right now in [vertical]."
- **Social Listening Dashboard**: See what the watchlist is posting today → one-click "turn this insight into my post".
- **Creator Brain enrichment**: Automatically create `hook/{author}` pages with their best patterns.
- **Performance feedback loop** (the real RL): When a post performs well, call `updateHookPerformance` on the hooks that were used. The dataset learns what actually works *for this user*.

**Long-term moat:**
A living, ranked, reinforced library of what actually converts on social right now — continuously updated via gstack mining + agent execution feedback. Generic LLMs can't compete with this.

## Recommended Immediate Next Steps

1. Run `npm run hooks:research -- --all` regularly (or automate it).
2. Apply `db/hooks-intelligence.sql` so the dataset is queryable and persistent.
3. Wire the `/api/hooks/intelligence` into the existing Generate UI (add a "Use top hooks" toggle or auto-inject).
4. Build the first agent example using the tools (even a simple LangChain.js or direct InsForge AI tool-calling demo).
5. Turn the best gstack mining flows into codified browser-skills for 10x faster future research.

This system is designed to compound. The more we mine + the more the agents use it successfully, the better every post becomes.
