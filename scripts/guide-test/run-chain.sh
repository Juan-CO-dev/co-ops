#!/usr/bin/env bash
# Run several Codex/API models on the staff + manager guides one after another, with a fresh sim day before
# each (staff and manager share the two shops, so they cannot overlap). Progress goes to the log file given.
# Usage: scripts/guide-test/run-chain.sh <round> <log> "<label> <lane> <model>" ...
# GUIDES="catering" runs only the catering guide and resets only catering data (--catering-only), so it can
# run beside a staff/manager chain without wiping that chain's shift (default: GUIDES="staff manager").
round="$1"; log="$2"; shift 2
guides="${GUIDES:-staff manager}"
reset_flag=""; [ "$guides" = "catering" ] && reset_flag="--catering-only"
cd "$(dirname "$0")/../.." || exit 1
# Healthy sim, or restart it once (a crash-restarted Next child stayed broken for hours on 2026-10-14).
ensure_sim() {
  bash scripts/guide-test/health.sh >/dev/null && return 0
  echo "sim unhealthy $(date +%H:%M) — restarting it" >> "$log"
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/guide-test/start-sim.ps1 >/dev/null 2>&1
  for i in $(seq 1 60); do [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3100/)" = 200 ] && break; sleep 5; done
  bash scripts/guide-test/health.sh >/dev/null
}
for spec in "$@"; do
  set -- $spec
  if ! ensure_sim; then
    echo "SIM UNHEALTHY before $1 even after a restart — chain stopped $(date +%H:%M)" >> "$log"
    exit 1
  fi
  echo "### $1 $(date +%H:%M) sim ok · reset: $(npx tsx scripts/guide-test/reset.ts $reset_flag 2>&1 | tail -1)" >> "$log"
  bash scripts/guide-test/run-lane.sh "$1" "$2" "$3" "$round" $guides 2>&1 | grep "==" >> "$log"
  if ! h=$(bash scripts/guide-test/health.sh); then
    echo "SIM UNHEALTHY after $1 ($h) — CHECK ITS REPORTS (sim may have broken mid-run)" >> "$log"
  fi
  git add "docs/guides/testing/round-$round" >/dev/null 2>&1
  git commit -q -m "test(guides): round $round — $1 $guides

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TiAmVpRCSW7w8NzTFk4L31" >/dev/null 2>&1
done
echo "CHAIN FINISHED $(date +%H:%M)" >> "$log"
