<!-- tester glm/glm-5.3-flash · session glmflash-staff-r1 · 406 actions · 2169s -->
# Report — glmflash — staff guide
Model I am: GLM (glmflash-staff-r1)

## Goals
| # | Goal | Result (done / partly / stuck) | Actions used |
|---|---|---|---|
| 1 | Log in (P Street / Employee / Maya Torres / PIN 1111) | done | ~8 |
| 2 | Opening verification (Phase 1) and send morning report part 1 | done | ~40 |
| 3 | Opening prep (Phase 2) and finish morning report | done | ~45 |
| 4 | Find/claim my station | done (claimed Crunchy Boi Station) | ~5 |
| 5 | Check Mid-Shift Pulse | done | ~3 |
| 6 | Record warm prep fridge | done (Maintenance note) | ~7 |
| 7 | Mid-day prep back to par | done (finalized) | ~50 |
| 8 | My station's closing lines + note | done (6/6 + note on Restock) | ~10 |
| 9 | AM prep closing count | done (submitted) | ~45 |
| 10 | End my shift | done ("Ended shift 1:52 AM") | ~4 |
| 11 | Spanish → English | done | ~5 |
| 12 | Log out | done | ~3 |

## Where I got stuck
No goal was left stuck. Three spots needed workarounds:

1. Mid-day prep (Phase 2) — SAVE / FINALIZE PREP buttons. URL `/operations/mid-day?…`, heading "Phase 2 — prep". Tapping SAVE on Sauces rows and FINALIZE PREP timed out repeatedly ("locator.click: Timeout"), though the same buttons worked earlier for the Veg rows. I recovered by typing in the row's input, then Tab to focus the button and Enter to activate it — the keyboard path worked every time. The guide ("Mid-day prep", step 4: "Type how much you made in **Prepped**. Then tap **Save** on that row.") describes the flow correctly but gives no fallback when the tap doesn't respond.
2. Maintenance note — first Save seemed to fail (box cleared but no note visible). I retyped and was about to save a duplicate when I saw the first note at the top of "Other equipment notes" — it had saved after all. Guide ("Fridge temps and broken equipment") says "The box clears, and your note shows on the page", but the note list needs a moment / scroll to show the new entry.
3. Opening prep (Phase 2) — typing the mixed fraction "3 1/3" into **Opener prepped** silently cleared (value lost); decimals ("3.33") worked. That row then needed the over/under reason flow. Guide ("Opening prep") never says which number formats are accepted.

## Notes for the team
- What would make the guide better:
  - Say what number formats the prep/count boxes accept (decimals vs. fractions like "3 1/3" — fractions silently fail).
  - Tell people that completing a station's closing checklist releases the claim — after Crunchy Boi hit 6/6, my board flipped to "No station" with no message, which looks like a bug.
  - Mid-day prep: the dashboard tile button actually says **START MID-DAY PREP**, not "+ New mid-day prep".
  - Add a "if a button doesn't respond, use Tab + Enter" tip, and note that a saved maintenance note can take a moment to appear in the list.
  - Warn that prep-need numbers in Phase 2 can disagree with what you eyeballed on Phase 1 rows; trust the per-row "Need" and the off-by amounts the app shows.
- What is hard in the app for no reason:
  - Phase 1 of the opening makes you re-type 38 recounts even though the boxes are optional for already-counted items — fine, but the boxes stay red after filling, which the guide does explain.
  - Phase 1 vs Phase 2 of the opening live under one "Phase 1 — Verification" title, and the checklist page keeps a stale section heading; the guide covers the title but the phase mix is still easy to misread.
  - Dashboard takes several seconds of "Loading…" on every return; on a busy line that feels like a freeze.
- Steps that confused me even when the guide was right:
  - "Verify section first" showing on the Tomato row in opening prep even though every section was verified.
  - Two Prep tiles under Reports mid-day (Mid-day Prep and AM Prep) — easy to tap the wrong one.
  - The station row switching from "1 of 1 assigned" to "0 of 1 assigned · No station" after my station closed (see above).
- Anything that looked broken:
  - The mid-day prep SAVE/FINALIZE click timeouts (recovered with keyboard); the first maintenance save appearing lost (it wasn't).

## The 5 best things CO-OPS does for a restaurant
1. **Opening verification with recounts** — walks you station by station and makes the opener confirm every line against last night's count, and forces a reason when closing data is missing. Missed closings surface at 7 AM, not at the lunch rush.
2. **AM prep closing count** — the closer counts what's left (with backup bulk) and the opener sees it as "Closer count" with par and prep need. Morning prep becomes arithmetic, not guessing, and 86s shrink.
3. **Station-based closing checklist with notes** — everyone ticks their own lines as they finish, stations close themselves, and notes ("bread drawer 2 short of par") leave a time-stamped record managers can read the next morning.
4. **Mid-day prep count-to-par** — after the rush, count the line, the app computes the need, you prep to it, and the checklist line checks itself. The line is full again before dinner without a manager chasing it.
5. **Mid-Shift Pulse + Maintenance log** — one live page for what needs attention, stations covered, food-safety status, and handoff notes; plus a quick way to log a warm fridge or broken gear so problems are recorded, not whispered.

