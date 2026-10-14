#!/usr/bin/env bash
# Run several Codex/API models on the staff + manager guides one after another, with a fresh sim day before
# each (staff and manager share the two shops, so they cannot overlap). Progress goes to the log file given.
# Usage: scripts/guide-test/run-chain.sh <round> <log> "<label> <lane> <model>" ...
round="$1"; log="$2"; shift 2
cd "$(dirname "$0")/../.." || exit 1
for spec in "$@"; do
  set -- $spec
  echo "### $1 $(date +%H:%M) reset: $(npx tsx scripts/guide-test/reset.ts 2>&1 | tail -1)" >> "$log"
  bash scripts/guide-test/run-lane.sh "$1" "$2" "$3" "$round" staff manager 2>&1 | grep "==" >> "$log"
  git add "docs/guides/testing/round-$round" >/dev/null 2>&1
  git commit -q -m "test(guides): round $round — $1 staff + manager

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31" >/dev/null 2>&1
done
echo "CHAIN FINISHED $(date +%H:%M)" >> "$log"
