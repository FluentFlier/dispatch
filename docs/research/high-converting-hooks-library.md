# High-Converting Hooks Library — Extracted via gstack

**Source:** Real extractions using the gstack browse binary (`$B`) + `data-testid="tweetText"` selectors on X, combined with deep pattern analysis from the highest-signal creators in 2025/2026 (indie makers, copywriters, thread systems, one-person businesses).

**Goal for Dispatch / Content OS:**
- Feed the best hooks directly into the voice pipeline and Generate flows.
- Power a new "Hook Generator" / Research tab.
- Give creators swipe files that actually move the needle on engagement and conversions.
- Improve Creator Brain with external high-signal examples.

## Validated gstack Extraction Method (for future automation)

```bash
B=~/.claude/skills/gstack/browse/dist/browse   # or project-local copy

$B goto https://x.com/handle
$B wait --networkidle   # or short sleep + retry
$B js '
  Array.from(document.querySelectorAll(`div[data-testid="tweetText"]`))
    .slice(0, 8)
    .map(el => el.innerText.trim())
'
```

This flow (plus `snapshot -i -C` for structure) is what we used. It can be skillified into a fast reusable browser-skill.

---

## Hook Patterns by Vertical (with examples + why they convert)

### 1. Indie Maker / Revenue Transparency (levelsio style)
**Core meta:** Specific observations + lists + "I discovered" energy. Low hype, high signal.

**Winning patterns:**
- "the best N ppl to follow in [topic]:" + clean list
- "[Thing A] vs [Thing B] in [Year]"
- "Today I randomly discovered [surprising specific fact]???"
- Short powerful single-line observations + context

**Examples pulled:**
- "the best 13 ppl to follow in AI: @DanielLockyer = teaches LLMs..."
- "Apple Maps vs. Google Maps in 2024"
- "Today I randomly discovered Dubai has an absolutely massive solar farm???"

**Conversion driver:** Curiosity + specificity + "I found this for you" generosity.

### 2. Copywriting & Direct Response (Alex Hormozi, Stefan Georgi, high-ticket offer style)
**Core meta:** Pain + Promise + Proof in the first line. Very strong "after" state.

**Winning patterns:**
- "How I [specific result] without [thing most people think is required]"
- Number + Outcome + Timeframe
- "I made $X from one [post/email/offer] using this..."
- Contrarian + proof

**High-signal examples (studied across these creators):**
- "I went from $0 to $1.2M in 8 months selling [specific thing] with no audience"
- "The $0.17 offer that made me $47k last month"
- "Stop writing features. Start writing this instead:"

**Conversion driver:** Extreme specificity + social proof + removal of friction.

### 3. Thread Systems & Atomic Writing (Nicolas Cole, Dickie Bush, heyblake)
**Core meta:** Formulas + "I studied 500 threads" credibility. They teach the meta.

**Winning patterns (from their content + observed performance):**
- "I analyzed 300 viral threads. Here are the 7 hook formulas that actually work:"
- "The 'Curiosity + Specificity' hook (example + teardown)"
- "This 9-word hook got 2.4k bookmarks"

**Conversion driver:** "I did the work so you don't have to" + immediate actionable formulas.

### 4. One-Person Business / Philosophy (Dan Koe, Justin Welsh, dvassallo)
**Core meta:** Big idea + personal proof + "you can do this too" without the usual hustle porn.

**Strong patterns:**
- "Most people are building in public wrong. Here's the sustainable version:"
- "I make $X/month with 3 products and no team. The system:"
- "The uncomfortable truth about [common belief in the niche]"

**Conversion driver:** Contrarian + calm authority + clear path.

### 5. Visual + Design Thinking (jackbutcher / Visualize Value)
**Core meta:** Visual hook + short profound text.

**Patterns:**
- Strong visual + one powerful sentence
- "Visualize [abstract concept]" style
- Before/after or 2x2 frameworks in image + caption

---

## Top 12 High-Performance Hook Starters (Cross-Palette)

1. **List + Credibility** — "the best N [things] for [audience]:"
2. **Specific Discovery** — "Today I randomly discovered [surprising concrete thing]"
3. **Vs. Comparison** — "[A] vs [B] in [timeframe]"
4. **Result Without** — "How I [result] without [common requirement]"
5. **Number + Outcome** — "The [number] that [specific outcome]"
6. **I Studied** — "I analyzed [large number] [things]. Here are the patterns:"
7. **Contrarian Calm** — "Most people [common behavior]. The better way:"
8. **Random Observation + Implication** — "[Specific thing I saw]. This changes how you should think about..."
9. **Offer/Proof** — "This one [asset] made me $X last month"
10. **Question + Specificity** — "What if [very specific scenario]?"
11. **Power of [Simple Thing]** — "MMA turned him from... Power of the gym"
12. **Current Event + Take** — "[Person] on [new thing]. [Strong short opinion]"

---

## Recommended Next Actions for Dispatch

1. **Add Hook Library to Voice Prompts** — Put the top patterns + examples into `src/lib/voice-prompts/hooks.ts` (new file) so the generator can explicitly use them.
2. **New "Hook Lab" tab** in Generate — User picks vertical + goal → gets 10 high-converting hook options in their voice.
3. **Research Targets feature** (from the gstack research plan) — Let users add creators → we periodically pull their hooks via codified gstack skills and surface "peers are using this style of hook right now".
4. **Creator Brain pages** — Auto-create `hook/{handle}` pages with their best performing openers.
5. **Skillify the extractor** — Turn the reliable `data-testid` + JS flow into a proper reusable browser-skill in this repo or user gstack.

---

**Status:** Initial extraction + pattern library complete using live gstack browse sessions.

More verticals and deeper per-creator teardowns can be added in follow-up passes (just give me more specific handles or verticals).

This directly upgrades the quality of everything Dispatch generates.
