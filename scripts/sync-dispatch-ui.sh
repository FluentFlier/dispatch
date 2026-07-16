#!/usr/bin/env bash
# Port UI from FluentFlier/dispatch-ui into the main dispatch app.
# Preserves backend routes, lib integrations, auth layout, and dispatch-only components.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UI="${DISPATCH_UI_ROOT:-/tmp/dispatch-ui}"

if [[ ! -d "$UI/src" ]]; then
  echo "Clone dispatch-ui first, e.g.:"
  echo "  git clone https://github.com/FluentFlier/dispatch-ui.git /tmp/dispatch-ui"
  exit 1
fi

echo "Syncing UI from $UI → $ROOT"

# Design contract + tokens
cp "$UI/DESIGN.md" "$UI/DESIGN.json" "$ROOT/"
cp "$UI/tailwind.config.ts" "$ROOT/"
cp "$UI/src/app/globals.css" "$ROOT/src/app/"
cp "$UI/src/app/icon.png" "$ROOT/src/app/" 2>/dev/null || true
cp "$UI/src/app/opengraph-image.tsx" "$ROOT/src/app/"

# Landing (Content Relay / quiet)
rm -rf "$ROOT/src/components/landing/quiet"
mkdir -p "$ROOT/src/components/landing"
cp -R "$UI/src/components/landing/quiet" "$ROOT/src/components/landing/"
cp "$UI/src/components/landing/LandingPageContent.tsx" "$ROOT/src/components/landing/"

# Public marketing assets, including the complete Content OS / Ada brand kit
mkdir -p "$ROOT/public/images" "$ROOT/public/landing" "$ROOT/public/brand-assets"
cp -R "$UI/public/images/." "$ROOT/public/images/" 2>/dev/null || true
cp "$UI/public/landing/grid-paper-texture.png" "$ROOT/public/landing/" 2>/dev/null || true
cp -R "$UI/public/brand-assets/." "$ROOT/public/brand-assets/" 2>/dev/null || true
cp "$UI/public/og.png" "$ROOT/public/og.png" 2>/dev/null || true

# Shared UI primitives + new landing helpers
for f in Drawer Modal Tabs Toast Skeleton ErrorBoundary link-preview smooth-cursor macbook-scroll; do
  if [[ -f "$UI/src/components/ui/${f}.tsx" ]]; then
    cp "$UI/src/components/ui/${f}.tsx" "$ROOT/src/components/ui/"
  fi
done

# Dashboard / product surface components (presentation only)
for dir in admin analytics billing dashboard engagement generate leads library video-studio; do
  if [[ -d "$UI/src/components/$dir" ]]; then
    rsync -a --exclude='*.test.ts' --exclude='*.test.tsx' \
      --exclude='LeadsFeedChrome.tsx' \
      "$UI/src/components/$dir/" "$ROOT/src/components/$dir/"
  fi
done

# Admin shell layout styling (production auth layout - do not overwrite)
# cp "$UI/src/app/(admin)/layout.tsx" "$ROOT/src/app/(admin)/"

# Brand copy refresh
cp "$UI/src/lib/brand.ts" "$ROOT/src/lib/"

# NOTE: Dashboard route pages are NOT copied - they contain production auth/API wiring.
# Visual updates flow through shared components above.

echo "Done. Run: npm install && npm run build && npm test"
