# Manager walk — Nicole Boyd (assistant general manager, Capitol Hill, PIN 8888), tablet 1024×768

Guides v2 photo walk for the **manager guide**. Re-shoot 2026-10-14: every photo the guide links, in guide order (one exception, noted at goal 1), plus new shots for screens the guide had only in words.
Shots go to `docs/guides/img/manager/<file>.png`; the log goes to `docs/guides/walks/manager.steplog.md`.
Source of truth for every label and rule: `docs/guides/testing/facts.md` and `docs/guides/testing/app-changes-2026-10-14.md`. The guide itself: `docs/guides/manager-guide.md`.
The manager guide also links four catering photos (`catering/21-sales`, `22-catering-sales`, `23-customers`, `24-catering-accounts`). They need a GM, so the catering walk (Marcus Webb) takes them. Not yours.

## Your tool (every step uses it)

```
node scripts/guide-test/gt.mjs walk-manager start tablet walker
node scripts/guide-test/gt.mjs walk-manager look            (screen text + numbered controls)
node scripts/guide-test/gt.mjs walk-manager tap <number|label>
node scripts/guide-test/gt.mjs walk-manager type <number|label> <text>
node scripts/guide-test/gt.mjs walk-manager press Enter | scroll down | back
node scripts/guide-test/gt.mjs walk-manager goto </path>     (walkers only, when a goal names a page)
node scripts/guide-test/gt.mjs walk-manager shot manager/<file>.png [full]
node scripts/guide-test/gt.mjs walk-manager stop
```

How to drive it:
- Run `look` after every action. Control numbers change on every `look`; only use numbers from the latest one.
- `type` on a drop-down picks the option whose text you give.
- A browser pop-up (confirm box) is accepted for you. The next `look` prints it as `DIALOG (accepted) …`. Copy that text into the log. The app's own **Confirm change** box is NOT a browser pop-up: tap its buttons yourself.
- `shot` photographs what is on the screen now. Scroll so the thing the goal is about is in view first. Add `full` only where this script says full page.
- Move by tapping, like a person. Use `goto` only for a path this script names, and only after 3 honest tries to reach it by tapping; log that you used it.

## Rules

1. Fake names only. You are Nicole Boyd. Never type anything except the test PIN `8888`, the sim password `sim-nicole-pw` (only where this script says a password step asks for it), and the fake data this script names for that step.
2. Never photograph an error toast or a half-loaded screen. If `look` shows "Loading", a spinner word, or an error message: wait, `look` again, and retake. If the error stays, log it under `Bug?` and do not photograph it.
3. Check every photo. After each `shot`, open the saved PNG and look at it. Retake it if it shows an error, a spinner, a chart still drawing, a bar or menu drawn across the middle, or if the thing the step names is cut off.
4. If a goal is blocked, write `BLOCKED <goal>: <why>` in the steplog (see below) and move on to the next goal. Make 3 honest tries before calling it blocked.
5. Never tap anything that sends email, texts a vendor, downloads a file or reveals contact details: no **Send**, **Mark placed**, **Download**, **CSV**, **PDF**, or reveal buttons. Never tap **Retract** or **End shift** on someone else. Never assign a task or a station to anyone.
6. Work at Capitol Hill only. Do not switch the language. Do not delete any old photo.

## The steplog

Replace the old content of `docs/guides/walks/manager.steplog.md`. First line: `# Manager walk — step log (Nicole Boyd, <today's date>)`.
Then one block per shot, as `docs/guides/walks/_steplog-schema.md` says (URL, Persona / viewport `Nicole Boyd, Assistant General Manager / 1024x768`, Action, Saw, Shot, Confused, Bug?), with ONE change to its numbering rule:
- **Use the exact file names this script gives. Never renumber.** The guide already links these names, and the new shots use an inserted letter (`24b-…`, `31a-…`) to keep their place. Head each block `## Step <number part> — <slug>`, for example `## Step 24b — midday-phase2-saved`, and write `- Shot: img/manager/24b-midday-phase2-saved.png`.
- Take the shots in the order this script lists them. That is the guide's order, so the numbers are not in a row (for example the night runs 41–43, then 32–39, then 40, 44–46). That is expected.
- A shot you could not take gets its own block with no picture: `## SKIPPED — <file>` then `- SKIPPED <file>: <why>`. A blocked goal: `## BLOCKED — <goal>` then `- BLOCKED <goal>: <why>`.
- `Saw` quotes the screen: headings and button labels in their exact words.
- Record every note or comment field you meet: where it was and what its placeholder said.

## The day you will meet

The sim was reset before your walk. Today is a fresh day at Capitol Hill. Yesterday's closing is finished, so the opening is open.
Nobody at Capitol Hill has a task assigned. Task tiles show on the dashboard only to the person assigned that task, so you will see no task tiles. As a key holder or higher you **take** a task yourself: on the board (Assignments) open an unassigned task and do it. Every task in this walk is taken that way.
What changed in the app since the last walk (so the old photos are stale): the round user button sits in the page instead of floating over it; quantities read like "5 × 1/3 Pan"; the dashboard's station row is called **My station**; **Production** is in **Explore**; mid-day prep has a real finalized view; a closing fridge temp line opens a **Temp (°F)** box; **Needs attention** on the Pulse lists red (late) items first, then uncovered stations, then the rest; the PM report starts with NO grade picked; Counts shows a "below zero — count it" pill on items the app thinks are under zero.

---

## Goals (guide order)

### 1. LOG IN — guide "Start here › Log in with the tiles" and "Use Manager login"
Run `start tablet walker`, then `look`.
- On "Where are you?": shot **01-where-are-you**.
- Exception to guide order (it is on this screen): tap **Manager login →** (top right). Shot **02-manager-login-form** (email + password form). Do not type in it. Tap **Use tile login →**.
- Tap the Capitol Hill tile. On "What's your role?": shot **03-whats-your-role**. Tap the Assistant General Manager tile.
- On "Who are you?": shot **04-who-are-you**. Tap Nicole Boyd.
- On "Enter your 4-digit PIN": shot **05-pin-keypad**. Tap `8` four times (it signs in on the fourth digit).

### 2. DASHBOARD — guide "Start here › Your dashboard"
- Shot **06-dashboard** (top: greeting, **Explore**, role badge, shop chip and the **My shift** board). The round user button must sit in the page, not over anything.
- Shot **07-dashboard-full** `full`.
Log in exact words: the role badge, the shop chip (it must be Capitol Hill), every chip under **Explore** (expect **Production**), the **My shift** rows and every "Unassigned: … · assign or take it" line, the **Today's operations** card, whether a **Reports** section shows (it should not), and **Log out**.

### 3. THE BOARD — guide "Start here › The board comes first"
Tap path: Dashboard → **Explore** → **Assignments** (or the **Assignments** link at the bottom of "My shift").
- Shot **08-board-tasks** with **Today's team**, and **Take or assign tasks** with its hint and its unassigned tasks, in view.
- Open **Take or assign stations**. Shot **09-board-stations** with a station's **Person** list and **Set station** in view. Do not set anyone.
- Open **Who has what**. Scroll so ONE person's whole card is in frame, starting with the person's NAME at the top of the card, then the **Task** list, the **Note** box and **Assign task**. Shot **10-assign-task**. (Photo-check retake: the old shot cut off the name — scroll up until the name shows.) Do not pick a task and do not tap **Assign task**.
Log every task name, the hint text, and what the **Task** list offered.

### 4. MORNING — OPENING, Phase 1 — guide "Morning › Opening verification"
In the board's task list tap **Opening prep**. It opens the Opening Report.
- Shot **11-opening-verify**: top of the page with "Phase 1 — Verification", station cards, and the tabs **Phase 1 · Verify** and **Phase 2 (locked)**.
- Open the Crunchy Boi Station card and tap **Verified**. Shot **12-opening-station-verified** with that card ("3 of 4 done") and its still-empty fridge temp box in view.
- Type `36` in that temp box. Open the **Veg** prep section. If **Verify section** is greyed out ("Recount items without closer data first"), type in each red **Opener recount** box the "Closer count" number shown on that row, or `2` if none is shown. Tap **Verify section**. Shot **13-opening-section-verify** with Veg verified and its recount boxes in view. Log whether the filled recount boxes are still red (they should not be).
- Finish Phase 1 with no more shots: tap **Verified** on every other station; fill every other temperature box using `37`, `38`, `35`, `36`, `37`, `38`, `36` in turn; verify every other prep section the same way. If a "No prior closing data detected" box asks for a reason, choose "Closing was missed / I don't know". For any other reason box, log its exact text and choose its first option.
- Scroll to the bottom. Shot **14-opening-ready** with "44 of 44 verified · 8 of 8 temp readings entered", **Submit ready** and the enabled **Submit Opening** in view.

### 5. MORNING — OPENING, Phase 2 — guide "Morning › Opening prep"
Tap **Submit Opening**. `look`.
- Shot **15-opening-submitted**: the **Phase 2 — Prep Entry** tab open; the first row (Iceberg) with **Par**, **Closer count**, **Prep need** and an empty **Opener prepped** box. Log the page title (it should read Phase 2 now) and how quantities are written (expect "5 × 1/3 Pan").
- Scroll a little. Shot **16-opening-prep-entry** with more rows, each marked "Not saved", before typing.
- In the first three rows type the number shown first in **Prep need** (for "5 × 1/3 Pan" type `5`; `0` if it is 0; `0` on a "No par set — type what you made" row). Tap outside each box so it saves. Shot **17-opening-prep-filled** with the three rows showing "At par", "Saved by … at …" and **Undo**.
- Fill every remaining row the same way, then tap **Finalize Phase 2**. Shot **18-opening-finalize** showing **Phase 2 finalized**.
If rows will not save or **Finalize Phase 2** stays greyed out, take shot 18 of the button with its count, log its exact text, and write BLOCKED for the finalize only.

### 6. ALL DAY — MID-SHIFT PULSE — guide "All day › The Mid-Shift Pulse"
Tap path: Dashboard → **Explore** → **Mid-Shift Pulse**.
- Shot **25-pulse** with the **Needs attention** card in view.
- Shot **26-pulse-full** `full`.
- Tap **See more** on the **People** card. Shot **27-pulse-section** (Here now, stations covered, timeline). Tap **‹ Pulse** to go back.
Log every card heading, the items under **Needs attention** in their exact order and colour (red/late first, then uncovered stations with **Assign**, then yellow), which cards say "Not available for your role." (Sales should), and the floor view button's label.

### 7. ALL DAY — HANDOFF NOTE — guide "All day › Handoff notes"
On the Pulse, scroll to the **Handoff** card and tap the **See more** inside that card.
- Under **Write a handoff note**, choose **For everyone** and type `Bread comes early tomorrow. Clear a shelf on the bread rack first.` in **Note**. Shot **28-handoff-write** with the filled form and **Post note** in view.
- Tap **Post note**. Shot **29-handoff-posted** showing the note with your name, the time, **Got it** and **Retract**. Do not tap **Retract**.

### 8. ALL DAY — RECEIVING — guide "All day › Check in a delivery"
Tap path: board (Explore → **Assignments**) → **Receiving**. (Also log whether Reports Hub → **Inventory** → **Receiving** shows for you.)
- Shot **19-receiving** (before choosing a vendor: vendor list, delivery date, invoice boxes, greyed **Delivery confirmed**). The ORDERING › breadcrumb at the top must not be covered by the user button.
- Pick a produce vendor (Baldor if listed). Shot **20-receiving-vendor** with the vendor, its usual-order line(s), **Pick a SKU…** and **+ Add item** in view.
- On the lettuce line (or the first line) type a count lower than expected (for example `1`), then tap **Short** under **Flag a problem**. Shot **21-receiving-didnt-arrive** with that line and the pink **Short** flag in view.
- Type `SIM-1001` in **Invoice #** and `120.00` in **Invoice total ($)**. Tick **Photo later**. Tap **Delivery confirmed**; if it lists **Some expected items were never confirmed**, tap **Received** or **Didn't arrive** on each, log the list, then tap **Tap again to confirm**.
- Scroll to **Recent deliveries**. Shot **22-receiving-confirmed** with the new delivery ("Photo missing") and **Open vendor credits** in view if they fit.
Log every note field and its placeholder.

### 9. ALL DAY — MID-DAY PREP, start to finish — guide "All day › Mid-day prep"
Tap path: board → **Mid-day prep** → **+ New mid-day prep**.
- Shot **23-midday-start**: "Phase 1 — count to par", with **On hand** boxes and each item's par in view.
- Type `4` in **On hand** for Pickles (or the first item) and `2` for Sweet Peppers (or the second). Shot **24-midday-filled** with both rows showing how much is needed.
- Leave the rest empty (empty counts as 0). Tap **Submit count → Phase 2**. If it refuses and names rows that need a **Bulk backup**, type `0` in those boxes, log the exact message, and submit again.
- **NEW.** On **Phase 2 — prep**, in the first row type the **Need:** number in **Prepped** (for "5 × 1/3 Pan" type `5`; on a row with **Par** and no **Need:** type `0`) and tap that row's **Save**. Shot **24b-midday-phase2-saved** with that row showing "Saved ✓" and the next row's empty **Prepped** box and **Save** button in view.
- Save two more rows the same way. Tap **Finalize prep**. `look`.
- **NEW.** Shot **24c-midday-finalized**: the title **Finalized — prep made**, the "Finalized at … by Nicole Boyd" line, and rows with **Need:** and **Made:**. It must NOT say "The interactive count and prep forms ship in the next build." (log it under `Bug?` if it does).
Log every label on both phases, and whether any row showed **Add over/under reason**.

### 10. ALL DAY — THE CLOSING CHECKLIST — guide "All day › Keep the closing checklist moving"
Tap path: Dashboard → **Today's operations** → **Start closing** (or the board's **Closing checklist**).
- Shot **30-closing-overview** with "Closing checklist", **Progress**, and each station's count of done lines in view.
- Open every section. Scroll back to the top and wait until `look` shows no "Loading". Shot **31-closing-full** (a normal screen shot, NOT `full`) with the open station sections and their lines in view. (Photo-check retake: the old full-page shot drew the sticky Progress bar across the middle, so this is now two screen shots.)
- **NEW.** Scroll down to **Closing Manager** and **Walk-Out Verification**. Shot **31a-closing-report-lines** with the Closing Manager report lines ("Pending — tap to open"), **Count the drawer**, **Count and secure tips** and the Walk-Out lines in view.
- **NEW.** In the Crunchy Boi Station section, tap the fridge temp line ("Crunchy Boi Fridge temp (≤41°F)"). A small box opens. Type `38` in **Temp (°F)**. Shot **31b-closing-temp-line** with the open box, the label **Temp (°F)**, the typed `38`, **Notes (optional)** and **Save** in view. Then tap **Save** and log what the line shows after.
Tick nothing else yet. Log the station sections, any "awaiting higher role" marks, the exact text of each report line (the Mid-day Prep line should already be ticked by your finalize), and the temp box label (it must read "Temp (°F)", not "Count").

### 11. NIGHT — AM PREP — guide "Night › AM prep: the closing count"
Tap path: board → **AM prep** (today's closing is started, which AM prep needs).
- Shot **41-am-prep** with the Veg rows, the **PAR**, **ON HAND**, **BACK UP** and **TOTAL** columns and the red **Required** tags in view.
- Type `2` for Iceberg (first row), `1` for Onion, `3` for Basil. Shot **42-am-prep-filled** with those rows and their **TOTAL** in view.
- Fill every other row: `1` in each empty first box; **YES** on each Misc question. Leave **BACK UP** empty. Tap **Submit AM Prep**. If it refuses, log its exact words, fix what it names, and submit again.
- Shot **43-am-prep-submitted** with the "AM Prep submitted at … by …" banner in view.

### 12. NIGHT — PM REPORT — guide "Night › PM report"
Tap path: board → **PM report**.
- Shot **32-pm-report**: the form top, with **Shift activity**, **MVP** and the grade cards in view, BEFORE you pick any grade (no grade should be picked; log it if any is).
- Grade two people. Nothing starts picked, so pick all four lines on each card: first person — **Arrived ready** Good, **Attitude** Great, **Production** Good, **Team player** Good; second person — **Arrived ready** Good, **Attitude** Good, **Production** Needs work, **Team player** Good, and type `Restock lids before the rush.` in **Area to improve**. Tap **Save** on each card. If fewer than two people are listed, add one with **Select employee…** at the bottom (pick the first name) and log it. Shot **33-pm-grades** with both saved cards in view.
- In **MVP**, pick the first person, type `Kept the line moving all lunch.` in **Why MVP?**, tap **Save**. Shot **34-pm-mvp**.
- Tap **Submit PM Report**. Shot **35-pm-submitted** with the green "Submitted … by …" banner and the read-only cards.
Log who was listed at first, the four grade names, the hint while a card was not fully graded ("Pick a grade on every line to save."), the private-note hint, and the MVP field labels.

### 13. NIGHT — CASH DEPOSIT — guide "Night › Cash deposit"
Tap path: board → **Cash report**.
- Shot **36-cash-deposit** (the form top, with "$200 stays in the register" in view if possible).
- Keep **Enter total**. **Projected (from Toast)**: type `845.00` if it is a box. **Drawer total**: `1045.00`. **Cash tips**: `62.00`. Under **On shift today** tick Nicole Boyd. Leave the over/short note empty. Shot **37-cash-filled** with the deposit ($845.00) and **Even** in view.
- Tap **Sign & submit deposit**. Shot **38-cash-pin** with the PIN keypad in view. Tap `8` four times.
- Shot **39-cash-submitted** (read-only deposit, signed with name and time).
Log the deposit and over/short numbers, and when they first appeared (they should show only after projected and drawer are both typed).

### 14. NIGHT — CONFIRM THE CLOSING — guide "Night › Confirm the closing"
Tap path: Dashboard → **Today's operations** → **Continue closing**.
- Tick all five lines in **Walk-Out Verification**. Shot **40-closing-walk-out** with "5 of 5" and each line's **Undo** and **Add note** in view.
- Tap **Review & submit** (it may read **Review & submit (incomplete)**). In each "Why couldn't this be completed?" box type `Sim walk — not done on this test day.` Shot **44-closing-review** with the reason boxes and the yellow **Continue** in view.
- Tap **Continue**. When **Confirm with your PIN** shows, shot **45-closing-pin**, then tap `8` four times and do not tap again.
- Shot **46-closing-confirmed** with the banner ("Closing submitted with incomplete items … by …" or "Closing confirmed … by …") and the reasons list in view.
If a hard-gate line blocks you, or "Cash deposit required …" still shows, log the exact words and write BLOCKED for the confirm. If "Just modified by someone else — try again." or "This checklist is already confirmed." shows right after the PIN, log it under `Bug?` and check the dashboard card.

### 15. MANAGER TOOLS — COUNTS — guide "Manager tools › Counts (Inventory Audit)"
Tap path: board → **Counts**. (Also log whether Reports Hub → **Inventory** → **Counts and variance** shows for you.)
- Shot **47-counts** ("Inventory Audit": **New audit** form and the **On hand** list). If any item shows a "below zero — count it" pill, scroll so one is in view and log its item.
- Add three lines: pick the first three items **Pick an item…** offers; for each pick the first option in its **Unit** list; type **How many** `4`, `2`, `6`. Shot **48-counts-filled**.
- Tap **Record audit**. When **Confirm your password** shows, shot **49-counts-password**, then type `sim-nicole-pw` and confirm.
- Shot **50-counts-recorded** (form cleared, "Anchored to the audit on …" on the counted items).

### 16. MANAGER TOOLS — ORDERING WALK — guide "Manager tools › Ordering walk"
Ordering is not in **Explore**. Use the board: board → **Ordering**. Log whether Reports Hub → **Inventory** → **Ordering** also shows.
- Shot **51-ordering-walk** (Today's orders, **Cutoff today**, the item list). Log any red "Missed cutoff — call the vendor".
- Tap **+** twice on Duke's Mayo (or the first line) and once on Iceberg (or another line). Shot **52-ordering-adjusted** with the "… SKUs marked" bar in view.
- Tap **Review order**. Shot **53-ordering-review**.
- Tap **Record walk**. Shot **54-ordering-draft** showing the draft order under **Draft orders**.
Stop at the draft. Do NOT tap **Confirm**, **Send**, **Copy** or **Mark placed**.

### 17. MANAGER TOOLS — PRODUCTION — guide "Manager tools › Production"
Tap path: Dashboard → **Explore** → **Production** (it is in the menu now; no `goto`).
- Shot **55-production** (**Log a conversion** and **Recent production**). Log the shop it opened on (Capitol Hill).
- Pick Cheddar in **Raw item (SKU)** if offered (else the first item with something to pick in **Makes**); pick the first **Makes** option; **Amount used (packs)** `1`; **Amount made** `4`. Shot **56-production-filled**.
- Tap **Log production**. Shot **57-production-logged** with the new row at the top of **Recent production**.

### 18. MANAGER TOOLS — REPORTS HUB AND TRENDS — guide "Manager tools › Reports Hub / Trends"
Tap path: Dashboard → **Explore** → **Reports Hub**.
- Shot **58-reports-hub** with the date range, the shop card (**Last close**) and the report families in view.
- Tap **Operations**, then today's opening report. Shot **59-reports-opening**. Do not tap **CSV** or **PDF**.
- Dashboard → **Explore** → **Trends**. Shot **60-trends**.
Sales (`/reports/sales`) needs a GM; you are an AGM. Do not try to open it. Log whether a **Sales** family shows in the hub (it should not).

### 19. MANAGER TOOLS — ADMIN HOME — guide "Manager tools › The admin pages"
Customers and Catering accounts need a GM; the catering walk takes them.
Tap path: Dashboard → **Explore** → **Admin**.
- Shot **61-admin-home** (**This week in CO-OPS** and the section tiles).
Log every tile, and whether **Customers** is listed. Look only; open nothing.

### 20. LOG OUT — guide "Start here › Log out"
Dashboard → scroll to the bottom → **Log out**. `look`.
- Shot **62-logged-out** (the "Where are you?" screen).
Then run `stop`.

---

Planned: 20 goals, 66 shots — 62 retakes of the guide's linked manager photos (01–62) and 4 new: 24b-midday-phase2-saved, 24c-midday-finalized, 31a-closing-report-lines, 31b-closing-temp-line. (catering/21–24, also linked in this guide, come from the catering walk.)
