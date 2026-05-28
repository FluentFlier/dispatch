#!/bin/bash
# Continuous GStack-powered mining loop for Content-OS
# Run in background: nohup ./scripts/continuous-research-loop.sh &
echo "Starting continuous research mining loop for Hook Intelligence..."
while true; do
  echo "$(date): Running research pass..."
  npx tsx scripts/research-hooks.ts --all --target 50 2>&1 | tail -10
  echo "$(date): Logging to GStack..."
  ~/.claude/skills/gstack/bin/gstack-learnings-log '{"skill":"research","type":"data","key":"mining-pass","insight":"Continuous loop added more hooks/posts to dataset. Current volume: check DB/local. RL from edits/performance next."}' 2>/dev/null || true
  echo "Sleeping 30min for politeness and rate limits..."
  sleep 1800
done
