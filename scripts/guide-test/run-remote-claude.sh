#!/usr/bin/env bash
# Run one Claude-lane guide tester on the CO desktop (whose Claude Code has a model this laptop lacks,
# e.g. Haiku 5.5) against THIS laptop's sim, through a reverse SSH tunnel to the browser daemon.
# Usage: scripts/guide-test/run-remote-claude.sh <staff|manager|catering> <label> <model-alias> <round>
#   e.g. scripts/guide-test/run-remote-claude.sh catering haiku haiku 2
# Needs: the sim + daemon running here (start-sim.ps1), ssh alias co-desktop (Windows, PowerShell shell).
# The report lands in docs/guides/testing/round-<N>/<label>-<guide>.md like every other lane.
set -u
guide="$1"; label="$2"; model="$3"; round="$4"
repo="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo" || exit 1
remote_root="C:/co/guide-test-ws/r$round"
report="docs/guides/testing/round-$round/$label-$guide.md"
mkdir -p "docs/guides/testing/round-$round"

info=$(node scripts/guide-test/make-workspace.mjs "$guide" "$label" "$round" claude) || exit 1
ws=$(node -e 'console.log(JSON.parse(process.argv[1]).ws)' "$info")
session=$(node -e 'console.log(JSON.parse(process.argv[1]).session)' "$info")
viewport=$(node -e 'console.log(JSON.parse(process.argv[1]).viewport)' "$info")
dir="$(basename "$ws")"

# The prompt tells the tester to write its report to this laptop's repo path; remotely it writes report.md
# in its own workspace, which is copied back below.
sed -i "s#C:/Users/conta/co-ops-guides/$report#report.md#g" "$ws/PROMPT.md"
grep -q "report.md" "$ws/PROMPT.md" || { echo "PROMPT.md report path not rewritten" >&2; exit 1; }

node scripts/guide-test/gt.mjs "$session" start "$viewport" >/dev/null || exit 1
ssh -o BatchMode=yes co-desktop "New-Item -ItemType Directory -Force '$remote_root' | Out-Null" 2>/dev/null
scp -q -r -o BatchMode=yes "$ws" "co-desktop:$remote_root/" || exit 1

# -R makes 127.0.0.1:3199 on the CO desktop reach this laptop's daemon, so gt.mjs needs no change.
ssh -o BatchMode=yes -o ServerAliveInterval=30 -R 3199:127.0.0.1:3199 co-desktop \
  "Set-Location '$remote_root/$dir'; Get-Content PROMPT.md -Raw | claude -p --model $model --allowedTools 'Read,Write,Edit,Bash(node gt.mjs:*)' > claude.out 2>&1" \
  2>&1 | grep -viE "post-quantum|store now|openssh.com|server may need"

scp -q -o BatchMode=yes "co-desktop:$remote_root/$dir/report.md" "$report" 2>/dev/null \
  || { scp -q -o BatchMode=yes "co-desktop:$remote_root/$dir/claude.out" "$report.raw" 2>/dev/null; echo "RUN ENDED WITHOUT A REPORT (see $report.raw)" > "$report"; }
node scripts/guide-test/gt.mjs "$session" stop >/dev/null
echo "== $label $guide: $( [ -s "$report" ] && grep -c '| done' "$report" || echo 0) goals marked done; $(wc -l < "$report") lines"
