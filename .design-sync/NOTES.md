# design-sync notes — content-os

Repo-specific gotchas for future syncs. Read before running the converter.

## Setup

- This is an app repo, not a packaged DS: the bundle entry is the curated
  `.design-sync/ds-entry.ts` (synth-entry mode), `pkg` name `content-os`.
- `cfg.buildCmd` compiles Tailwind (fonts.css + globals.css → `.cache/ds-compiled.css`)
  and must run before the converter whenever `src/` styling changed. Its
  `--content` glob covers all of `src/**` and `.design-sync/previews/**`.
- Playwright for the render check: `.ds-sync/node_modules` carries playwright
  1.61.1 pinning chromium 1228, which is cached in `~/Library/Caches/ms-playwright`
  (macOS path — not `~/.cache`).

## Pages (added 2026-07-14)

- All 16 client-component pages (dashboard + login) are synced as full-page
  components grouped under "Pages", each `cardMode: single` at 1280x800.
  Server-component pages CANNOT ship: admin/*, dashboard home, brain, signals,
  get-started, landing/legal — they import `next/headers` / DB clients.
- Pages need `PreviewShell` (`.design-sync/preview-shell.tsx`, exported from
  the entry, excluded from the component list via `componentSrcMap: null`).
  It mocks the Next app-router contexts (Next 14 shared-runtime context
  modules), wraps ToastProvider, and stubs `window.fetch` for `/api/*` URLs
  (registered mocks or `{}`), installed lazily on first render so real
  designs importing the bundle keep native fetch. Page previews wrap
  themselves in it — deliberately NOT `cfg.provider`, so the 17 UI primitives'
  cards stay byte-identical and skip re-verification on anchored re-syncs.
- Page code (or a dep) reads `process.env.*` at module scope; esbuild only
  defines NODE_ENV, so a bare `process` reference threw at bundle init and
  blanked EVERY card ("process is not defined"). Fixed by
  `.design-sync/process-shim.ts` imported as the FIRST line of ds-entry.ts.
- The converter's tsconfig-paths plugin matches a bare directory before
  `/index.ts` (its extension list tries `''` first), so alias imports that
  point at directories (`@/components/video-studio`, `@/lib/social`, …) fail
  with "is a directory". All directory-style aliases are pinned to their
  index files in `.design-sync/tsconfig.json` — add new ones there.
- `OnboardingPage` imports its server-actions file, which drags
  `@/lib/insforge/server` → `lib/admin/impersonation.ts` → node `crypto` into
  the browser bundle. Fixed by `cfg.tsconfig = .design-sync/tsconfig.json`,
  whose `paths` alias `@/lib/insforge/server` to
  `.design-sync/stubs/insforge-server.ts` (order matters: the exact alias
  must precede `@/*`). If another page ever pulls in a new server-only
  module, add another alias + stub the same way.

## Known render warns (triaged legitimate)

- `ErrorBoundary` — [RENDER_ERRORS] "Simulated render failure": the authored
  preview deliberately throws inside the boundary to show the fallback UI.
  The card renders the fallback correctly (~25KB png).
- `SkeletonLines` — [RENDER_THIN] maxHeight ~128px: skeleton line placeholders
  genuinely are that short; variants are gray bars by design.

## Preview fetch mocks

- `PreviewShell` ships default mocks for endpoints whose consumers crash on
  `{}`: `/api/loop/readiness` → `{complete:true}`, `/api/voice-drift` →
  zeroed report, `/api/engagement/inbox` → `{groups:[]}`. New unguarded
  fetches in page code will surface as [RENDER] card crashes — add the
  endpoint's empty shape to the defaults in `.design-sync/preview-shell.tsx`.
- `process-shim.ts` fakes `NEXT_PUBLIC_INSFORGE_URL`/`_ANON_KEY` (the browser
  insforge client throws at construction without them — LoginPage).

## Re-sync risks

- The insforge-server stub must keep exporting whatever client-reachable code
  imports from `@/lib/insforge/server` (currently getServiceClient,
  getServerClient, getSessionUser, getAuthenticatedUser, EffectiveUser). A new
  export used by page code will fail the bundle until added to the stub.
- Page previews render zero-data states via the fetch stub. If a page's
  empty state changes (or it starts requiring seeded data to look sensible),
  add mock payloads via the `mocks` prop of `PreviewShell` in that page's
  preview — payloads live inline in `.design-sync/previews/<Name>Page.tsx`
  and can silently drift from the API's real response shapes.
- PreviewShell imports Next 14 internals
  (`next/dist/shared/lib/app-router-context.shared-runtime`,
  `hooks-client-context.shared-runtime`). A Next major upgrade may move these
  — check first if page cards suddenly all fail with router/context errors.
