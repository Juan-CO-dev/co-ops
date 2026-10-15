<!-- tester glm/glm-5.3-flash · session glmflash-staff-r2 · 371 actions · 2086s -->
# Report — glmflash — staff guide
Model I am: glmflash (GLM, Z.ai)

## Goals
| # | Goal | Result (done / partly / stuck) | Actions used |
|---|---|---|---|
| 1 | Log in (P Street / Employee / Maya Torres / 1111) | done | 7 |
| 2 | Opening verification (Phase 1) + submit | done — 10 stations verified, 8/8 temps, 5/5 prep sections verified with recounts + reason picked, Submit Opening accepted | ~45 |
| 3 | Morning prep (Phase 2) + finalize | stuck — Veg (6) and Cooks (6) rows saved; all later rows fail "Save failed — RETRY" across 3 page reloads and many retries; Finalize stays disabled (26 outstanding) | ~25 |
| 4 | Find/claim my station | done — Prep Area, "fill first", Confirm change → "Yours: Prep Area" | 6 |
| 5 | Check the shop right now (Mid-Shift Pulse) | done — viewed Pulse: "All clear", live floor, tasks, catering, food safety 8/8 in range, handoff | 2 |
| 6 | Record warm prep fridge in Maintenance | done — Other… → "Prep fridge" → note saved and shown with my name/time | 7 |
| 7 | Mid-day prep count to par | stuck — filled all 16 On hand counts twice; "Could not submit the count." both times; counts do not persist (boxes empty on return) | ~24 |
| 8 | My station's closing lines + note on a finished line | done — 5 of 9 Prep Area lines (4 ticks + fridge temp 37°F with note); note saved on "Organize Back Walk In" (shows Edit note) | ~15 |
| 9 | AM prep closing count + submit | done — all 6 sections 100% (ON HAND/PORT/LINE + backups + Misc Y/N + note), "AM Prep submitted at 5:15 AM by Maya Torres" | ~40 |
| 10 | End my shift | done — confirm box → "Ended shift 5:15 AM"; station, tasks and report tiles gone | 4 |
| 11 | Switch app to Spanish, then back | stuck — Español fails on both Settings ("Could not save — try again.") and user menu ("Update failed."), 4 attempts; app stayed English | 7 |
| 12 | Log out | done — Sign out in user menu → back at "Where are you?" | 2 |

## Where I got stuck

**Goal 3 — Phase 2 prep rows won't save (Opening Report)**
- Screen: `/operations/opening?location=d2cced11-…`, heading "OPENING REPORT — Phase 2 — Prep Entry".
- What I tried: typed values and tabbed out (guide's method), tapped RETRY on many rows, typed again, pressed Enter, left to the dashboard and re-opened the report 3 times. Veg and Cooks rows saved fine at 4:56 AM; from Sides onward every save returned "Save failed — RETRY", and on each reload the unsaved boxes came back empty. The first failure coincided with a page navigation error mid-typing ("Execution context was destroyed, most likely because of a navigation").
- Guide problem: under "Opening prep (Phase 2)", "Worth knowing" covers "Add a reason to save", "Not saved" and Undo — but never a "Save failed — RETRY" state. It says "The page saves as you go", so a person would trust the retry button; there is no instruction for what to do when retry keeps failing (tell a manager? re-enter after reload?). Nothing in the guide distinguishes a connection failure from a validation problem.

**Goal 7 — Mid-day prep submit fails and doesn't keep counts**
- Screen: `/operations/mid-day?instance=a8dc15d8-…`, heading "MID-DAY PREP — Phase 1 — count to par".
- What I tried: filled all 16 On hand boxes (Veg + Sauces), tapped "Submit count → Phase 2" → "Could not submit the count." Retried immediately → same error. Left and re-opened via the tile → same instance, but every count box was empty again.
- Guide problem: under "Mid-day prep", the guide documents skipped reasons and "Some items couldn't load", but has no line for a failed submit or for counts being lost when you leave. "Saved" behaviour is claimed for the opening and AM prep sheets, but for mid-day the guide never says whether Phase 1 counts persist — they did not.

**Goal 11 — Language won't switch to Español**
- Screen: `/settings`, heading "Settings"; also the round user menu at top right.
- What I tried: tapped ESPAÑOL on the Settings page → "Could not save — try again."; tapped it again → same; opened the round user menu and tapped "ES · ESPAÑOL" → "Update failed."; tried that twice. The UI stayed English. (The reverse switch was never testable since Español never took.)
- Guide problem: under "Language", the guide only says tap English or Español. No fallback, no error state, no "if it won't save, tell a manager" — a crew member would just keep tapping a broken button.

## Notes for the team
- What would make the guide better:
  - Add one "Worth knowing" bullet for a failed save: "If a row says 'Save failed — RETRY', tap RETRY once; if it still fails, don't keep retyping — note it and tell a key holder." Same for the mid-day submit button and the language toggle.
  - Show what happens when you leave a page with unsaved Phase 2 rows (they are gone on return) — the "saves as you go" reassurance only applies to some pages.
  - For the station dropdown, say you may need to pick from the list itself; typing a partial name doesn't select.
- What is hard in the app for no reason:
  - The Sides dropdown option text ("Prep Area · Prep Area · fill first") is doubled and awkward; typing "Prep Area" timed out, only the full string selected.
  - "Save failed — RETRY" gives no reason at all, and retry silently does nothing — you can't tell a network problem from a data problem.
  - Mid-day Phase 1 lets you submit a count where nothing persists; it would be kinder to keep the numbers on the instance so you can pick up after an error (like AM prep does with "Picked up where you left off").
- Steps that confused me even when the guide was right:
  - Only the first station card starts open in Phase 1; the temp box hides inside each card, so I opened 8 cards one by one — the guide did say this, but "8 temps" vs 10 cards takes a beat to reconcile.
  - The claim-station dropdown needed the full option label, not the visible name (tool-level friction, not an app bug).
  - AM prep column names change per section (ON HAND / PORT / LINE); the guide is right, but it's easy to second-guess when Sides says PORTIONED.
- Anything that looked broken:
  - Prep-entry saves and the mid-day count submit failed persistently server-side (reproduced across full page reloads), while AM prep, closing ticks, maintenance notes, station claim and end-shift all worked in the same session — looks like two broken endpoints, not a dead server.
  - Language save fails on both paths (Settings page and user menu).
  - One transient page crash during opening prep typing ("Execution context was destroyed… navigation") that reloaded the page and lost in-flight input.

## The 5 best things CO-OPS does for a restaurant
1. **The opening's two-phase verification** — Phase 1 makes you walk each station, tick it against last night's count, enter every fridge temp, and recount anything the closer missed, with a reason; Phase 2 turns that into exact prep needs (par minus count). It caught the day's real starting point before the doors opened — the difference between a line that's ready at open and one that 86s its first sandwich.
2. **AM prep closing count that feeds the opener** — I counted what was left (ON HAND/PORT/LINE plus BACK UP), hit submit, and got "AM Prep submitted at 5:15 AM by Maya Torres"; the opener sees those numbers as the closer count. It closes the loop between shifts so morning prep starts from facts, not guesses — and it took one pass, no training.
3. **Mid-Shift Pulse** — one live page answering "what's happening right now": needs-attention ("All clear"), the station floor map, my tasks, catering, food safety (8/8 fridges in range) and manager handoff notes. In 10 seconds a crew member knows what to fix before a manager has to ask — that's fewer walk-arounds and faster reactions mid-rush.
4. **The closing checklist with notes and temps on lines** — sections per station run all day, each tick stamps "you + time", temp lines save a reading with an optional note, and finished lines take a written note. I ticked my Prep Area lines, logged the 3-door fridge at 37°F with a "ran warm earlier" note, and left a restock note for the next crew — accountability you can audit, not just boxes.
5. **Maintenance log with automatic fridge readings** — the page already listed every fridge's last reading from my checklist taps, and logging the warm prep fridge took three fields ("Other…", name, note) with my name and time attached. It turns "the fridge feels warm" told in passing into a timestamped record a manager can act on before food is lost.

