# Staff walk — Maya Torres (employee, P Street, PIN 1111), phone 390×844

Guides v2 photo walk for the **staff guide**. Re-shoot 2026-10-14: every photo the guide links, in guide order, plus new shots for screens the guide had only in words.
Shots go to `docs/guides/img/staff/<file>.png`; the log goes to `docs/guides/walks/staff.steplog.md`.
Source of truth for every label and rule: `docs/guides/testing/facts.md` and `docs/guides/testing/app-changes-2026-10-14.md`. The guide itself: `docs/guides/staff-guide.md`.

## Your tool (every step uses it)

```
node scripts/guide-test/gt.mjs walk-staff start phone walker
node scripts/guide-test/gt.mjs walk-staff look            (screen text + numbered controls)
node scripts/guide-test/gt.mjs walk-staff tap <number|label>
node scripts/guide-test/gt.mjs walk-staff type <number|label> <text>
node scripts/guide-test/gt.mjs walk-staff press Enter | scroll down | back
node scripts/guide-test/gt.mjs walk-staff goto </path>     (walkers only, when a goal names a page)
node scripts/guide-test/gt.mjs walk-staff shot staff/<file>.png [full]
node scripts/guide-test/gt.mjs walk-staff stop
```

How to drive it:
- Run `look` after every action. Control numbers change on every `look`; only use numbers from the latest one.
- `type` on a drop-down picks the option whose text you give.
- A browser pop-up (confirm box) is accepted for you. The next `look` prints it as `DIALOG (accepted) …`. Copy that text into the log. The app's own **Confirm change** box is NOT a browser pop-up: tap its **Confirm change** button yourself.
- `shot` photographs what is on the screen now. Scroll so the thing the goal is about is in view first. Add `full` only where this script says full page.
- Move by tapping, like a person. Use `goto` only for a path this script names, and only after 3 honest tries to reach it by tapping; log that you used it.

## Rules

1. Fake names only. You are Maya Torres. Never type anything except the test PIN `1111` and the fake data this script names for that step.
2. Never photograph an error toast or a half-loaded screen. If `look` shows "Loading", a spinner word, or an error message: wait, `look` again, and retake. If the error stays, log it under `Bug?` and do not photograph it.
3. Check every photo. After each `shot`, open the saved PNG and look at it. Retake it if it shows an error, a spinner, a chart still drawing, a bar or menu drawn across the middle, or if the thing the step names is cut off.
4. If a goal is blocked, write `BLOCKED <goal>: <why>` in the steplog (see below) and move on to the next goal. Make 3 honest tries before calling it blocked.
5. Never tap anything that sends email, downloads a file, or changes someone else's work (no "Send", "Download", "Retract", "End shift" for another person).
6. Do not switch the language. Do not delete any old photo.

## The steplog

Replace the old content of `docs/guides/walks/staff.steplog.md`. First line: `# Staff walk — step log (Maya Torres, <today's date>)`.
Then one block per shot, as `docs/guides/walks/_steplog-schema.md` says (URL, Persona / viewport `Maya Torres, Employee / 390x844`, Action, Saw, Shot, Confused, Bug?), with ONE change to its numbering rule:
- **Use the exact file names this script gives. Never renumber.** The guide already links these names, and the new shots use an inserted letter (`22b-…`, `33b-…`) to keep their place. Head each block `## Step <number part> — <slug>`, for example `## Step 22b — closing-temp-line`, and write `- Shot: img/staff/22b-closing-temp-line.png`.
- Take the shots in the order this script lists them. That is the guide's order, so the numbers are not always in a row (the AM prep shots 43–45 come before 34–35). That is expected.
- A shot you could not take gets its own block with no picture: `## SKIPPED — <file>` then `- SKIPPED <file>: <why>`. A blocked goal: `## BLOCKED — <goal>` then `- BLOCKED <goal>: <why>`.
- `Saw` quotes the screen: headings and button labels in their exact words.
- Record every note or comment field you meet: where it was and what its placeholder said.

## The day you will meet

The sim was reset before your walk. Today is a fresh day at P Street. Yesterday's closing is finished, so the opening is open.
A manager has assigned you three tasks today: the **opening**, **mid-day prep** and **AM prep**. Their tiles show on your dashboard under **Reports** because they are assigned to you (tiles show only to the person assigned).
What changed in the app since the last walk (so the old photos are stale): the round user button now sits in the page instead of floating over it; quantities read like "5 × 1/3 Pan"; the board's station row is called **My station**; **Production** is in **Explore** for employees (you can open it); mid-day prep has a real finalized view; a closing fridge temp line opens a **Temp (°F)** box; the Pulse lists late (red) items first in **Needs attention**.

---

## Goals (guide order)

### 1. LOG IN — guide "Start here › Log in"
Run `start phone walker`, then `look`. The tile login is four screens.
- On "Where are you?": shot **01-where-are-you**. Tap the P Street tile.
- On "What's your role?": shot **02-whats-your-role**. Tap the Employee tile.
- On "Who are you?": shot **03-who-are-you**. Tap Maya Torres.
- On "Enter your 4-digit PIN": shot **04-pin-keypad**. Tap `1` four times (it signs in on the fourth digit; there is no submit button).
Log the short code shown on each tile, and that the keypad has "Clear" and "Back".

### 2. DASHBOARD — guide "Start here › Your dashboard"
You land on the dashboard ("Hi, Maya Torres.").
- Shot **05-dashboard** (top of the page). The round button with your initial must sit in the page, not over the Explore chips.
- Shot **06-dashboard-full** `full`.
Log, top to bottom, in exact words: the role badge, the shop chip, every chip under **Explore** (expect **Production** now), the **My shift** board and its rows (expect **Tasks**, **My station**, **Team today**), the **Today's operations** card, the **Reports** section and each tile in it (expect **Opening Report**, **Mid-day Prep**, **AM Prep**), and **Log out** at the bottom.

### 3. MORNING — OPENING, Phase 1 — guide "Morning › Opening verification (Phase 1)"
Tap path: Dashboard → **Reports** → **Opening Report** tile → **Open / continue**.
- Shot **07-opening-verify**: top of the page with the title "Phase 1 — Verification", the first station card (Crunchy Boi Station) with its **Verified** button, and the tabs **Phase 1 · Verify** and **Phase 2 (locked)**.
- On the Crunchy Boi Station card, tap **Verified**. Shot **08-opening-station-verified** with that card in view ("3 of 4 done": the temp is not in yet).
- On the same card type `36` in the fridge temp box. Shot **09-opening-temperature** with the filled box and "4 of 4 done" in view.
- Open the **Veg** prep section. If **Verify section** is greyed out ("Recount items without closer data first"), type in each red **Opener recount** box the "Closer count" number shown on that row, or `2` if none is shown. Check the red borders go away once filled (log it if they stay red). Tap **Verify section**. Shot **10-opening-section-verify** with the Veg section and its filled recount boxes in view.
- Finish Phase 1 with no more shots: tap **Verified** on every other station; open each card and fill its temp box using `37`, `38`, `35`, `36`, `37`, `38`, `36` in turn (all are 41°F or below); verify every other prep section the same way. If a "No prior closing data detected" box asks for a reason, choose "Closing was missed / I don't know". If any other reason box appears, log its exact text and choose its first option.
- Scroll to the bottom. Shot **11-opening-ready** with "44 of 44 verified · 8 of 8 temp readings entered", "Saved a moment ago" and the enabled **Submit Opening** in view.
Log the "Saved …" line, the footer hint while it was not ready, and every note or comment field you saw on the station cards.

### 4. MORNING — OPENING, Phase 2 — guide "Morning › Opening prep (Phase 2)"
Tap **Submit Opening**. `look`.
- Shot **12-opening-submitted**: the **Phase 2 — Prep Entry** tab open, with the first rows showing **Par**, **Closer count**, **Prep need** and the **Opener prepped** box. Log the page title (it should now read Phase 2, not "Phase 1 — Verification") and how quantities are written (expect "5 × 1/3 Pan", not "5 1/3 Pan").
- Scroll down a little. Shot **13-opening-prep-entry** with more rows in view, each marked "Not saved", before typing.
- In the first three rows, type in **Opener prepped** the number shown first in **Prep need** (for "5 × 1/3 Pan" type `5`; type `0` if Prep need is 0; on a row that says "No par set — type what you made" type `0`). Tap outside the box after each one so it saves. Shot **14-opening-prep-filled** with those three rows showing "At par", "Saved by …" and **Undo**.
Do not tap **Finalize Phase 2**. Log what the **Finalize Phase 2** button says (it shows how many rows are left).

### 5. ALL DAY — YOUR BOARD — guide "All day › Your board"
Go back to the dashboard.
- Scroll until the whole **My shift** board is on screen (heading plus the **Tasks**, **My station** and **Team today** rows). Shot **15-my-shift**. (Photo-check retake: the old shot missed the board.)
- Tap **View my day** at the bottom of "My shift" (or **Explore** → **Assignments**). You are on the Assignments page ("Today's team").
- Shot **16-board-tasks** with the **Tasks** list in view (first item **Closing checklist** — "Everyone on shift · no assignment needed").
- Scroll to **Stations**. Shot **17-board-stations**.
Log every task name, which ones are links for you, and the exact text on tasks that are not yours. Do not tap a task that belongs to someone else.

### 6. ALL DAY — CLAIM A STATION — guide "All day › Claim a station"
Go back to the dashboard.
- Tap the **My station** row on **My shift** to open it. Shot **18-claim-station** with the **Station** list and **Claim / change station** in view.
- Pick the first open position (one nobody holds; prefer one marked **fill first**). Tap **Claim / change station**. In the **Confirm change** box leave **Reason for change** on "No reason (optional)" and tap **Confirm change**. `look`.
- Shot **19-station-claimed**: the **My station** row now reading "Yours: …" (or "Claimed · …" with the time) AND, if it fits on the same screen, the **My station: …** card under **Reports**. If both do not fit, keep the row in frame and log where the card is. (Photo-check retake: the old shot did not show the claimed row.)
Log the station and position you picked, and every choice that was offered.

### 7. ALL DAY — CLOSING CHECKLIST at your station — guide "All day › Your station's closing jobs"
Tap path: Dashboard → **Today's operations** → **Start closing** (or **Continue closing**), or tap your **My station: …** card.
- Shot **20-closing-checklist**: top of the page with "Closing checklist", **Progress**, and your station's section open.
- In your station's section, tick two plain lines (not the fridge temp line). Shot **22-closing-ticked** with both ticks, each with **Undo** and **Add note**, in view.
- **NEW.** Tap your station's fridge temp line (its name ends "Fridge temp (≤41°F)"). A small box opens. Type `38` in **Temp (°F)**. Shot **22b-closing-temp-line** with the open box, the label **Temp (°F)**, the typed `38`, **Notes (optional)** and **Save** in view. Then tap **Save** and log what the line shows after.
- On one of your two ticked lines tap **Add note**, type `Out of lids — told the shift lead`, tap **Save note**. Shot **23-closing-note** with the saved note and **Edit note** in view.
- Shot **24-closing-full** `full`. (Wait until `look` shows no "Loading" first. If the saved picture shows the Progress bar drawn in the middle of the page, retake it once; if it is still there, keep it and log `Bug?: sticky bar in full-page shot`.)
Log: the box label on the temp line (it must read "Temp (°F)", not "Count"), any line marked "awaiting higher role", any report line (AM prep, cash, mid-day) and its exact text, and the button at the bottom (do not tap it).

### 8. ALL DAY — MID-SHIFT PULSE — guide "All day › Mid-Shift Pulse"
Tap path: Dashboard → **Explore** → **Mid-Shift Pulse**.
- Shot **25-pulse** (top of the page: **Needs attention** and **Live shop floor**).
- Shot **26-pulse-full** `full`.
- Tap **See more** on the **Stations & tasks** card. Shot **27-pulse-section**.
Log: every section heading, the order of the items under **Needs attention** (red/late ones should come first), any "Not available for your role." card, the "Refreshes every 60 s" note, and any fridge reminder text.

### 9. ALL DAY — FRIDGE TEMPS AND BROKEN EQUIPMENT — guide "All day › Fridge temps and broken equipment"
Tap path: Dashboard → **Explore** → **Maintenance** ("Maintenance Log").
- Shot **28-maintenance** with **Fridge temps** in view.
- In **Log a maintenance note**: in **Equipment** pick "Other…" and type `Prep fridge` in **Equipment name**. In the note box type `Prep fridge feels warm`. Shot **29-maintenance-note** with the filled form in view.
- Tap **Save note**. Shot **30-maintenance-saved** showing the saved note under **Other equipment notes**. Log its date (it must be today's date, not tomorrow's).
Log the placeholder of each field, and the fridge status words you saw ("Out of range", "No reading today", ok).

### 10. ALL DAY — MID-DAY PREP, start to finish — guide "All day › Mid-day prep"
Tap path: Dashboard → **Reports** → **Mid-day Prep** tile.
- Shot **31-midday-tile** with the tile and **+ New mid-day prep** in view.
- Tap **+ New mid-day prep**. Shot **32-midday-count**: "Phase 1 — count to par", with **On hand** boxes in view, before typing.
- Type `4` in **On hand** for the first item and `2` for the second. Shot **33-midday-filled** with both rows showing what you need.
- Leave the other boxes empty (empty counts as 0). Tap **Submit count → Phase 2**. If it refuses and names rows that need a **Bulk backup**, type `0` in those boxes, log the exact message, and submit again.
- **NEW.** The page now says **Phase 2 — prep**. Shot **33b-midday-phase2** with two or three rows in view, each with **Need:** and an empty **Prepped** box. The page must not be wider than the screen: check that **Save** on each row is fully on screen (log it if it is cut off).
- **NEW.** In the first row type the **Need:** number (for "5 × 1/3 Pan" type `5`; on a row with **Par** and no **Need:** type `0`). Tap **Save** on that row. Shot **33c-midday-row-saved** with that row showing "Saved ✓".
- Save two more rows the same way. Then tap **Finalize prep**. `look`.
- **NEW.** Shot **33d-midday-finalized**: the title **Finalized — prep made**, the green "Finalized at … by Maya Torres" line, and rows showing **Need:** and **Made:**. It must NOT say "The interactive count and prep forms ship in the next build." (log it under `Bug?` if it does).
Log every label on both phases, any limit message, and whether any row showed **Add over/under reason**.

### 11. ALL DAY — PRODUCTION — guide "All day › Production"
Tap path: Dashboard → **Explore** → **Production** (it is in the menu for employees now; no `goto`).
- **NEW.** Shot **33e-production**: the "Production" page on the phone, with **Log a conversion** (the **Raw item (SKU)**, **Makes**, **Amount used (packs)**, **Amount made** fields and the grey **Log production** button) in view, and **Recent production** if it fits.
Look only: do not log a production. Log the shop the page opened on (it should be P Street), every field label, and whether a **Yield variance →** link shows (it should not for an employee).

### 12. NIGHT — AM PREP — guide "Night › AM prep (the closing count)"
Today's closing is already started (goal 7), which AM prep needs.
Tap path: Dashboard → **Reports** → **AM Prep** tile → **Start AM Prep**.
- Shot **43-am-prep-sheet** with the **Veg** section open (column headings and the red **Required** tags in view).
- Type `2` for the first item, `1` for the second, `3` for the third. Shot **44-am-prep-filled-row** with those rows and their filled **TOTAL** in view.
- Fill every other row: type `1` in each empty first box; in **Misc** tap **YES** on each question. Leave **BACK UP** empty. Tap **Submit AM Prep**. If it refuses, log its exact words, fix what it names, and submit again.
- Shot **45-am-prep-done** with the green "AM Prep submitted at … by …" line in view.
Log every column heading (ON HAND / PORT / LINE, BACK UP, TOTAL) and the "Picked up where you left off …" line if you see it.

### 13. END MY SHIFT — guide "Night › End my shift"
Go to the dashboard **My shift** board and tap the **My station** row to open it.
- Shot **34-end-my-shift** with **End my shift** in view.
- Tap **End my shift**. In the **Confirm change** box, copy its question into the log (expected: "End your shift? Your station is released and your open tasks are unassigned."), leave the reason on "No reason (optional)", tap **Confirm change**. `look`.
- Shot **35-shift-ended** showing the board after ("Ended shift" and the time).
Log what changed: your station, your tasks, the Reports tiles, and whether **Start break** or **Claim / change station** still show (they should not).

### 14. YOUR STUFF — PROFILE AND LANGUAGE (do not switch) — guide "Your stuff › Profile / Language"
- Dashboard → **Explore** → **Profile** ("Team Profiles"). Shot **36-profile**.
- Dashboard → **Explore** → **Settings**. Scroll to the **Language** card. Shot **37-settings-language**. Do NOT change it.
- Tap the round button with your initial at the top right (the user menu). It opens in the page. Shot **38-user-menu** with "Signed in as", the language switch, **Dashboard** and **Sign out** in view. Close the menu without choosing anything (tap the same button again).

### 15. YOUR STUFF — WRITTEN REPORTS AND MY PERFORMANCE — guide "Your stuff › Written reports / My Performance"
- Dashboard → **Explore** → **Written Reports**. Shot **39-written-reports** (the DASHBOARD breadcrumb must not be covered).
- Tap **New report**. Shot **40-written-report-form**. Do NOT post it: log every field and placeholder, then go back.
- Dashboard → **Explore** → **My Performance**. Run `look` twice, a few seconds apart, until the screen text stops changing (the chart draws late). Then shot **41-my-performance** and check the picture shows the finished chart. (Photo-check retake: the old shot caught the chart mid-draw.)

### 16. LOG OUT — guide "Your stuff › Log out"
Dashboard → scroll to the bottom → **Log out**. `look`.
- Shot **42-logged-out** (the "Where are you?" screen).
Then run `stop`.

---

Planned: 16 goals, 49 shots — 44 retakes of the guide's linked photos (01–20, 22–45; there is no 21) and 5 new: 22b-closing-temp-line, 33b-midday-phase2, 33c-midday-row-saved, 33d-midday-finalized, 33e-production.
