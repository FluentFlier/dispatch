# design-sync NOTES — content-os

Repo-specific gotchas for future syncs. content-os is a **Next.js app**, not a packaged
component library, so this sync runs the package shape in **synth-entry mode** off a curated entry.

## Setup / build

- **Self-symlink required.** The converter resolves the package at `node_modules/<pkg>`. content-os
  is the repo root and npm won't self-install, so create:
  `ln -sfn .. node_modules/content-os`
  This is gitignored (node_modules) — **recreate it on every fresh clone** before building.
- **Curated entry, not whole-app synth.** `cfg.entry = .design-sync/ds-entry.ts` re-exports exactly
  the public UI surface (the `src/components/ui` barrel + StatusBadge/PillarBadge/CharCount). Do NOT
  let the converter synth-scan all of `src/components/ui` — `ImageUpload.tsx` imports `next/image`,
  which drags in the Next runtime and crashes the bundle at load with `process is not defined`.
  `componentSrcMap` lists every component→src path because there is no shipped `.d.ts`.
- **CSS is compiled Tailwind.** There is no stylesheet on disk; `cfg.buildCmd` concatenates
  `.design-sync/fonts.css` + `src/app/globals.css` and runs `tailwindcss` scanning `src/**` +
  `.design-sync/previews/**` → `.design-sync/.cache/ds-compiled.css` (= `cfg.cssEntry`). The `src/**`
  scan (not just components) is deliberate so the `@layer components` classes (.btn-primary,
  .card-surface, …) and dynamic badge classes from `src/lib/constants.ts` (STATUS_BADGE,
  PILLAR_BADGE_BG) are emitted. **Re-run `cfg.buildCmd` before `package-build` whenever component or
  preview class usage changes**, or new utility classes silently go missing.
- **Fonts are remote.** The app uses next/font (DM Sans, Fraunces, Hanken, JetBrains). The bundle has
  no Next runtime, so `.design-sync/fonts.css` loads the same families from Google Fonts via @import
  and defines the `--font-fraunces/-hanken/-jetbrains` CSS vars next/font normally injects. Validate
  reports `[FONT_REMOTE]` (informational) — fonts load at runtime; previews render in DM Sans.

## Component handling

- **Overlays (Modal, Drawer)** are `position:fixed`. Their previews wrap the component in a sized,
  `transform:translateZ(0)` container so the fixed overlay is contained inside the card (otherwise it
  centers in a zero-height containing block and the top clips). Paired with
  `cfg.overrides.{Modal,Drawer}: {cardMode:"single", viewport:"WxH"}`. Changing an override viewport
  requires a full `package-build` (preview-rebuild alone fails `[CONFIG_STALE]`).
- **ToastProvider** is a context provider with no static visual — it ships the **floor card** by
  design (honest baseline). `useToast` is exported on the bundle for the design agent; toast usage is
  documented in the conventions header / prompt.md, not previewed.

## Preview authoring notes (carried from the first sync's waves)
- **Badge** has no default background — every Badge instance needs an explicit color className.
  Repo-present combos used: `bg-coral-light text-accent-primary`, `bg-sage-light text-accent-secondary`,
  `bg-amber-100 text-amber-800`, `bg-bg-tertiary text-text-tertiary`.
- **Skeleton** has no intrinsic size — every instance needs `h-`/`w-` classes (circle via `rounded-full`).
- **CharCount** color bands: gray < 80% of platform limit, amber 80–99%, red ≥ 100% (Twitter limit 280).
  Pick preview text lengths to land in the band you want to show.

## Known render warns
- `[FONT_REMOTE]` for JetBrains Mono / DM Sans / Hanken Grotesk / Fraunces — expected (remote @import).
- `tokens: … (1 missing, below threshold)` — non-blocking.
- `[RENDER_ERRORS] ErrorBoundary … "Simulated render failure"` — INTENTIONAL. The `Fallback` cell
  renders a child that throws so the boundary's fallback UI shows; the boundary catches it (root is
  non-empty). Expected, not a failure.

## Re-sync quickstart (turnkey)
From the repo root:
```sh
# 1. fresh clone only: install converter deps + recreate symlink
ln -sfn .. node_modules/content-os
( cd .ds-sync && npm i esbuild ts-morph @types/react playwright && npx playwright install chromium )
# 2. recompile Tailwind (cfg.buildCmd), then run the driver
sh -c "$(node -e "process.stdout.write(require('./.design-sync/config.json').buildCmd.replace(/^sh -c '|'$/g,''))")"
# (or just run the buildCmd value from .design-sync/config.json)
# 3. fetch the project anchor, then drive build→diff→validate→capture
#    (project b39bb9a2-7e92-4f22-bb72-cb8696a760b1)
node .ds-sync/resync.mjs --config .design-sync/config.json --node-modules ./node_modules \
  --out ./ds-bundle --remote .design-sync/.cache/remote-sync.json
```
`.ds-sync/` is gitignored — re-copy it from the skill's bundled scripts before re-syncing
(a stale `.ds-sync/` runs an old converter).

## Re-sync risks (watch-list for the next run)
- The Google Fonts @import in `.design-sync/fonts.css` is network-fetched at render time. If Google
  Fonts is unreachable, previews fall back to system fonts (no error). Self-host woff2 via
  `cfg.extraFonts` if a fully offline/self-contained bundle is ever required.
- `componentSrcMap` is a hand-maintained name→path list. If a `ui/` component is renamed/moved, update
  it AND `.design-sync/ds-entry.ts`, or that component silently drops from the bundle.
- The curated `ds-entry.ts` is the public-API source of truth. New `ui/` primitives are NOT picked up
  automatically — add them to the entry + componentSrcMap to include them.
- Preview class vocabulary depends on the `src/**` Tailwind scan. A class used ONLY inside a
  `.design-sync/previews/*.tsx` (not anywhere in src) is covered by the `previews/**` content glob —
  keep that glob in `cfg.buildCmd`.
