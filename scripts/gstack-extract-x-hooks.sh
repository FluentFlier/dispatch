#!/bin/bash
# Reusable gstack-powered X hook extractor
# Usage: ./scripts/gstack-extract-x-hooks.sh arvidkahl levelsio 2>/dev/null

B="${B:-$HOME/.claude/skills/gstack/browse/dist/browse}"

if [ ! -x "$B" ]; then
  echo "gstack browse binary not found at $B"
  exit 1
fi

echo "Using gstack browse: $B"
echo "=== Extracting high-signal posts/hooks from X ==="

for handle in "$@"; do
  echo ""
  echo ">>> @${handle}"
  $B goto "https://x.com/${handle}" >/dev/null 2>&1
  sleep 2.5

  # Best current selector for tweet text (as of 2026)
  $B js '
    Array.from(document.querySelectorAll(`div[data-testid="tweetText"]`))
      .slice(0, 6)
      .map((el, i) => ({
        index: i,
        text: el.innerText.trim().replace(/\n+/g, " | ")
      }))
  ' 2>/dev/null || echo "  (no extractable posts this run - try again or use snapshot -i)"
done

echo ""
echo "Tip: Pipe output to jq or save to a file for analysis."
echo "For skillification: after good runs, use /skillify in your agent session or manually codify the command sequence."
