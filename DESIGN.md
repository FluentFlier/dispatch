# Design System — Content OS

## Product Context
- **What this is:** Content OS is a content command center for creators and founders. One loop: research what's moving, write in your trained voice, schedule everywhere, publish, reply, and learn what compounds.
- **Who it's for:** Solo founders, operators, consultants, and technical creators who post on social and want control + consistency, not generic AI automation.
- **Space/industry:** Creator tooling / social content SaaS.
- **Project type:** Marketing landing page (dark cinematic) sitting on top of a light product app. The landing's dark theme is **scoped** and must not leak into the dashboard.

## Memorable Thing
"My content engine, trained on me." The emotional promise is taste, control, and consistency — a founder's private media desk at 1am before a launch — never "AI writes your posts."

## Aesthetic Direction
- **Direction:** Near-black editorial control room. Smoked glass, live social surfaces, restrained aurora light.
- **Decoration level:** Intentional. Every glow emanates from a product event (trend heat, active composer, reply priority, analytics lift) — no lazy decorative blobs.
- **Mood:** Cinematic, expensive, operational. Calm confidence, not hype.
- **Reference:** cluely.com (dark canvas + glowing gradients + glassy floating product UI + smooth scroll). We adopt the engine, not the assets or palette.

## Typography
Licensed picks (Suisse Int'l / Editorial New / Berkeley Mono) substituted with premium free equivalents.
- **Display/Hero:** Fraunces (variable, optical) — editorial serif for headlines, section openers, pull quotes. Media-world taste.
- **UI/Body/Labels:** Hanken Grotesk — operational grotesk, expensive and direct without being sterile.
- **Data/System/Mono:** JetBrains Mono — timestamps, handles, queue states, analytics deltas, voice-match %, `⌘` keys.
- **Loading:** next/font/google (self-hosted, no layout shift). Scoped to landing via `.os-landing` font-family vars.
- **Scale:** eyebrow 12px mono / body 16-18px / sub-display clamp(28,4vw,44) / hero clamp(44,7vw,104), tracking -0.03em on display, line-height 0.95-1.05.

## Color (landing, dark — scoped under `.os-landing`)
- **Approach:** Restrained near-black base, color used only as signal.
- **Backgrounds:** `--os-bg #07080A`, `--os-bg-elevated #0D0F13`, `--os-surface rgba(20,22,27,0.72)`, `--os-surface-strong #151820`
- **Text:** `--os-text #F4F0E8`, `--os-text-soft #C9C0B3`, `--os-text-muted #7F776C`
- **Borders:** `--os-border rgba(244,240,232,0.12)`, `--os-border-strong rgba(244,240,232,0.22)`
- **Accents:** coral `#FF6B4A` (action/heat, primary), cyan `#5BE7D8` (intelligence/live data), gold `#D7B56D` (credibility: revenue, authority, outcomes), lime `#B8F36A` (sparingly, growth)
- **Glows:** coral rgba(255,107,74,0.36), cyan rgba(91,231,216,0.28), gold rgba(215,181,109,0.22)
- **Anti-slop:** NO purple/violet/blue gradient. Glow is oil-slick coral/cyan/gold against near-black.

## Layout
- **Approach:** Creative-editorial. Asymmetry, left-anchored large type, product UI bleeding across section boundaries. First viewport is a poster, not a document.
- **Max content width:** 1200px (`max-w-6xl`/`7xl`), generous gutters.
- **Border radius:** sm 10px, md 16px, lg 22px, xl 28px, full 9999px.
- **Hard rule — no feature grid.** The product is a loop, so the page behaves like a loop: signal → draft → publish → reply → learn → repeat. No 3-column "Research / Write / Schedule" icon row.

## Motion (Framer Motion `motion` + Lenis)
- **Approach:** Intentional, restrained, expensive — not hyperactive.
- **Smooth scroll:** Lenis with gentle easing, momentum, sitewide on landing only.
- **Hero:** aurora drifts almost imperceptibly; glass panels enter with small depth/parallax; composer types once then stops; metrics tick up once on settle; voice-match meter fills once and stays.
- **Scroll:** mask/line reveals for headlines; opacity + blur-reduction + 12-24px vertical for cards (no fly-in from all directions); horizontal drift for social feeds (kept readable); subtle parallax on product surfaces.
- **Micro:** platform chips pulse only when active; reply classifications slide into place; queue items magnetic-snap into the calendar; primary CTA is magnetic with an animated gradient ring.
- **Easing:** enter cubic-bezier(0.16,1,0.3,1); durations micro 120ms / short 250ms / medium 450ms / long 700ms.
- **Accessibility:** `MotionConfig reducedMotion="user"`; all looping/auto animation disabled under `prefers-reduced-motion`.

## Social-Media-Native System (integrated in every section)
1. **Post Receipts** — replace logo-wall/testimonials with receipts: the post, platform, timestamp, replies/saves it triggered, and what Content OS recommended next. Growth made observable.
2. **Voice Fingerprint** — a recurring visual of the user's writing traits (directness, pacing, punchiness, vocabulary, warmth) so every generated post visibly routes through *their* voice.
3. **Reply → Content loop** — a high-signal reply gets tagged, turned into a new draft, scheduled, then measured. Proves it's an operating system, not a one-way scheduler.

## Page Structure
1. Sticky glass nav — CONTENT OS wordmark, links, magnetic Start free
2. Hero poster — editorial headline + running product cockpit (composer, voice meter, trend radar, queue, replies, analytics strip)
3. Post Receipts marquee — social proof as compounding timeline
4. The Loop — signal → draft → publish → reply → learn, as one circuit
5. Voice Fingerprint — write like yourself (before/after + traits)
6. One Idea, Native Everywhere — one source branching into X thread, LinkedIn, newsletter, video script, reply, carousel
7. What Compounds — editorial analytics (outcomes, not vanity)
8. Final CTA — return to calmer poster, "Build your content loop"
9. Footer

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-28 | Dark cinematic landing, scoped from light app | User brief: jaw-dropping, Cluely-like; app stays light |
| 2026-05-28 | Coral/cyan/gold over violet/blue | Codex anti-slop critique; ties to existing coral brand |
| 2026-05-28 | No feature grid; page = the loop | Product is a loop; differentiates from category |
| 2026-05-28 | Fraunces + Hanken Grotesk + JetBrains Mono | Free premium subs for Suisse/Editorial New/Berkeley Mono |
| 2026-05-28 | Framer Motion + Lenis, restrained | Premium feel, full reduced-motion fallback |
| 2026-05-28 | Rename Dispatch → Content OS app-wide | User directive |
