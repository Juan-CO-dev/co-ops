#!/usr/bin/env bash
# Guides v2 tester round: run ONE model on all three guides at once (Codex or API lane).
# Usage: scripts/guide-test/run-lane.sh <label> <codex|api> <model-id> <round> [guides...]
#   codex: model-id is the Codex model (gpt-6-astra, gpt-5.6, gpt-5.6-terra, gpt-5.6-luna)
#   api:   model-id is "<provider>:<model>" (glm:glm-5.3, deepseek:deepseek-flash, ...)
# Claude-lane runs are launched by CC through the Agent tool (make-workspace.mjs ... claude).
# Reports land in docs/guides/testing/round-<N>/<label>-<guide>.md. Sim + daemon must be running and the
# sim day reset (reset-sim-day.sql) before staff/manager runs.
set -u
label="$1"; lane="$2"; model="$3"; round="$4"; shift 4
guides=("$@"); [ ${#guides[@]} -eq 0 ] && guides=(staff manager catering)
repo="$(cd "$(dirname "$0")/../.." && pwd)"
out="$repo/docs/guides/testing/round-$round"
mkdir -p "$out"
cd "$repo" || exit 1

pids=()
for g in "${guides[@]}"; do
  info=$(node scripts/guide-test/make-workspace.mjs "$g" "$label" "$round" "$lane") || exit 1
  ws=$(node -e 'console.log(JSON.parse(process.argv[1]).ws)' "$info")
  session=$(node -e 'console.log(JSON.parse(process.argv[1]).session)' "$info")
  viewport=$(node -e 'console.log(JSON.parse(process.argv[1]).viewport)' "$info")
  report="$out/$label-$g.md"
  if [ "$lane" = codex ]; then
    node scripts/guide-test/gt.mjs "$session" start "$viewport" >/dev/null
    (
      cd "$ws" && cat PROMPT.md | ~/.claude/hooks/dispatch-astra.sh "gt-$label-$g-r$round" --mode ask --clone "$ws" \
        --sandbox workspace-write --model "$model" -c sandbox_workspace_write.network_access=true --skip-git-repo-check \
        > "$ws/codex.out" 2>&1
      # Keep the report part of the final answer (from the "# Report" heading on, minus Codex's token footer).
      awk '/^# Report/{p=1} p' "$ws/codex.out" | sed '/^tokens used/,$d' > "$report.tmp"
      { echo "<!-- tester codex/$model · session $session -->"; cat "$report.tmp"; } > "$report"; rm -f "$report.tmp"
      [ -s "$report" ] || echo "RUN ENDED WITHOUT A REPORT (see $ws/codex.out)" >> "$report"
      node scripts/guide-test/gt.mjs "$session" stop >/dev/null
    ) &
  else
    provider="${model%%:*}"; mid="${model#*:}"
    # 2-hour cap per guide: an API tester once sat idle for 4.5 hours and held up the whole chain.
    PYTHONIOENCODING=utf-8 timeout 7200 python scripts/guide-test/api_tester.py --provider "$provider" --model "$mid" \
      --workspace "$ws" --session "$session" --out "$report" --viewport "$viewport" > "$ws/api.out" 2>&1 &
  fi
  pids+=($!)
  echo "started $label $g ($session)"
done
for p in "${pids[@]}"; do wait "$p"; done
for g in "${guides[@]}"; do
  f="$out/$label-$g.md"
  echo "== $label $g: $( [ -s "$f" ] && grep -c '| done' "$f" || echo 0) goals marked done; $(wc -l < "$f" 2>/dev/null || echo 0) lines"
done
