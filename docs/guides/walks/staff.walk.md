# Staff walk — Maya Torres (employee, P Street, PIN 1111), phone 390×844

Guides v2 photo walk for the **staff guide**, in shift order (morning → all day → night → your stuff).
Shots go to `docs/guides/img/staff/NN-slug.png`; the log goes to `docs/guides/walks/staff.steplog.md`.
Source of truth for every label and rule: `docs/guides/testing/facts.md`. Outline: `docs/superpowers/specs/2026-10-13-guides-v2-design.md`.

## Your tool (every step uses it)

```
node scripts/guide-test/gt.mjs walk-staff start phone walker
node scripts/guide-test/gt.mjs walk-staff look            (screen text + numbered controls)
node scripts/guide-test/gt.mjs walk-staff tap <number|label>
node scripts/guide-test/gt.mjs walk-staff type <number|label> <text>
node scripts/guide-test/gt.mjs walk-staff press Enter | scroll down | back
node scripts/guide-test/gt.mjs walk-staff goto </path>     (walkers only, when a goal names a page)
node scripts/guide-test/gt.mjs walk-staff shot staff/NN-slug.png [full]
node scripts/guide-test/gt.mjs walk-staff stop
```

How to drive it:
- Run `look` after every action. Control numbers change on every `look`; only use numbers from the latest one.
- `type` on a drop-down picks the option whose text you give.
- A browser pop-up (confirm box) is accepted for you. The next `look` prints it as `DIALOG (accepted) …`. Copy that text into the log.
- `shot` photographs what is on the screen now. Scroll so the thing the goal is about is in view first. Add `full` only where this script says full page.
- Move by tapping, like a person. Use `goto` only for a path this script names, and only after 3 honest tries to reach it by tapping; log that you used it.

## Rules

1. Fake names only. You are Maya Torres. Never type anything except the test PIN `1111` and the fake data this script names for that step.
2. Never photograph an error toast or a half-loaded screen. If `look` shows "Loading", a spinner word, or an error message: wait, `look` again, and retake. If the error stays, log it under `Bug?` and do not photograph it.
3. If a goal is blocked, write `BLOCKED <goal>: <why>` in the steplog (see below) and move on to the next goal. Make 3 honest tries before calling it blocked.
4. Never tap anything that sends email, downloads a file, or changes someone else's work (no "Send", "Download", "Retract", "End shift" for another person).
5. Do not switch the language. Do not delete any old photo.

## The steplog

Replace the old content of `docs/guides/walks/staff.steplog.md`. First line: `# Staff walk — step log (Maya Torres, <today's date>)`.
Then one block per shot, exactly as `docs/guides/walks/_steplog-schema.md` says (Step NN — slug, URL, Persona / viewport `Maya Torres, Employee / 390x844`, Action, Saw, Shot `img/staff/NN-slug.png`, Confused, Bug?).
- `Saw` quotes the screen: headings and button labels in their exact words.
- The shot numbers below are the plan. Number shots in the order you really take them, two digits, contiguous from 01. If a shot is skipped, the next one takes the free number and keeps its slug.
- A blocked goal gets its own block with no number and no shot: `## BLOCKED — <goal>` then `- BLOCKED <goal>: <why>`.
- Record every note or comment field you meet: where it was and what its placeholder said.

## The day you will meet

The sim was reset before your walk. Today is a fresh day. Yesterday's closing is finished, so the opening is open.
A manager has assigned you three tasks today: the **opening**, **mid-day prep** and **AM prep**. Their tiles show on your dashboard under **Reports** because they are assigned to you (tiles show only to the person assigned).

---

## Goals (shift order)

### 1. LOGIN — start of the day
Run `start phone walker`, then `look`. The tile login is four screens.
- On "Where are you?": shot **01-where-are-you**. Tap the P Street tile.
- On "What's your role?": shot **02-whats-your-role**. Tap the Employee tile.
- On "Who are you?": shot **03-who-are-you**. Tap Maya Torres.
- On "Enter your 4-digit PIN": shot **04-pin-keypad**. Tap `1` four times (it signs in on the fourth digit; there is no submit button).
Log the short code shown on each tile, and that the keypad has "Clear" and "Back".

### 2. DASHBOARD
You land on the dashboard ("Hi, Maya Torres.").
- Shot **05-dashboard** (top of the page).
- Shot **06-dashboard-full** `full`.
Log, top to bottom, in exact words: the role badge, the shop chip, every chip under **Explore**, the **My shift** board, the **Today's operations** card (**Closing checklist**, **Start closing**), the **Reports** section and each tile in it (expect **Opening Report**, **Mid-day Prep**, **AM Prep**), and **Log out** at the bottom.

### 3. MORNING — OPENING REPORT, Phase 1 · Verify (opening verification)
Tap path (facts.md): Dashboard → **Reports** → **Opening Report** tile → **Open / continue**.
- Shot **07-opening-verify**: top of the page with the title "Phase 1 — Verification", the subtitle, and the tabs **Phase 1 · Verify** and **Phase 2 (locked)** in view.
- On the first station card, tap **Verified**. Shot **08-opening-station-verified** with that card in view after the tap.
- Find a temperature box on a station card. Type `36`. Shot **09-opening-temperature** with the filled box in view.
- Find a prep section with **Verify section**. If it is greyed out ("Recount items without closer data first"), type the recount for each item first: type the "Closer count" number shown on that row, or `2` if none is shown. Tap **Verify section**. Shot **10-opening-section-verify** with that section in view after the tap.
- Now finish Phase 1 with no more shots: tap **Verified** on every other station; fill every other temperature box using `37`, `38`, `35`, `36`, `37`, `38`, `36` in turn (all are 41°F or below); verify every other prep section the same way. If a "No prior closing data detected" box asks for a reason, choose "Closing was missed / I don't know". If any other reason box appears, log its exact text and choose its first option.
- Scroll to the bottom so **Submit Opening** and the "Saved a moment ago" line are in view. Shot **11-opening-ready**.
Log: that the page saves itself as you go (quote the "Saved …" line), and every note or comment field you saw on the station cards.

### 4. MORNING — SUBMIT OPENING
Tap **Submit Opening**. `look`.
- Shot **12-opening-submitted**: the page after submit, with the **Phase 2 — Prep Entry** tab now open.
CHANGED (facts.md): the call list put Phase 2 before Submit Opening, but **Submit Opening** is the Phase 1 button and Phase 2 stays locked until it is pressed. So you submit first, then do prep entry. Also per facts.md: an employee who is assigned the opening (you) can submit it. If the app refuses you, log its exact words and write BLOCKED.

### 5. MORNING — Phase 2 — Prep Entry (opening prep)
On the **Phase 2 — Prep Entry** tab, each row shows **Par**, **Closer count**, **Prep need** and a box **Opener prepped**.
- Shot **13-opening-prep-entry** with two or three rows in view, before typing.
- In the first three rows, type in **Opener prepped** the number shown as **Prep need** on that row (type `0` if Prep need is 0). Wait for each row to save. Shot **14-opening-prep-filled** with those rows in view.
Do not tap **Finalize Phase 2**. Log what the **Finalize Phase 2** button says (it may show how many rows are left) and whether an **Undo** shows on the saved rows.

### 6. ALL DAY — YOUR BOARD (Tasks / Stations)
Go back to the dashboard.
- Scroll to the **My shift** board. Shot **15-my-shift**.
- Tap **Explore** → **Assignments** (or the **View my day** link at the bottom of "My shift"). You are on the Assignments page ("Today's team").
- Shot **16-board-tasks** with the **Tasks** list in view (first item **Closing checklist** — "Everyone on shift · no assignment needed").
- Scroll to **Stations**. Shot **17-board-stations**.
Log every task name in the list, which ones are links for you, and the exact text on tasks that are not yours. Do not tap a task that belongs to someone else.

### 7. ALL DAY — CLAIM A STATION
Per facts.md you claim your own station only from the dashboard **My shift** board. Go back to the dashboard.
- Tap **Claim / change station**. Shot **18-claim-station** with the station or position choices in view.
- Pick the first open position (one nobody holds). `look`. Scroll to the new **My station: …** card. Shot **19-station-claimed**.
Log the station and position you picked, and every choice that was offered.

### 8. ALL DAY — CLOSING CHECKLIST at your station
Tap path: Dashboard → **Today's operations** → **Start closing** (or **Continue closing**), or tap your **My station: …** card.
- Shot **20-closing-checklist**: top of the page with "Closing checklist" and **Progress** in view.
- Scroll to the section for your station. Shot **21-closing-my-station**.
- Tick two lines in your station's section. Shot **22-closing-ticked** with both ticks in view.
- On a third line, look for a note or comment control. If there is one, open it and type `Out of lids — told the shift lead`, then save it. Shot **23-closing-note** with the note in view. If no line has a note control, write `ABSENT: no note on closing lines` in the log and skip the shot.
- Shot **24-closing-full** `full`.
Log: any line marked "awaiting higher role", any report line (AM prep, cash, mid-day) and how it looks (those tick themselves), and the button at the bottom (do not tap it).

### 9. ALL DAY — MID-SHIFT PULSE
Tap path: Dashboard → **Explore** → **Mid-Shift Pulse**.
- Shot **25-pulse** (top of the page).
- Shot **26-pulse-full** `full`.
- Open the **Stations & tasks** section (tap its heading or its open link). Shot **27-pulse-section**.
Log: every section you see and its exact heading, any "Not available for your role." card, the "Refreshes every 60 s" note, and any fridge reminder text.

### 10. ALL DAY — FRIDGE TEMPS AND BROKEN EQUIPMENT (Maintenance)
Tap path: Dashboard → **Explore** → **Maintenance** ("Maintenance Log").
- Shot **28-maintenance** with **Fridge temps** in view.
- In **Log a maintenance note**: in **Equipment** pick the prep fridge if it is listed; if not, pick "Other…" and type `Prep fridge` as the equipment name. In the note box type `Prep fridge feels warm`. Shot **29-maintenance-note** with the filled form in view.
- Tap **Save note**. Shot **30-maintenance-saved** showing the saved note.
CHANGED: the call list said "walk-in feels warm". The shops have no walk-in fridge (AGENTS.md: "CO has zero walk-ins and zero freezers; it has eight under-station fridges"), so the note uses the prep fridge.
Log the placeholder of each field, and the fridge status words you saw ("Out of range", "No reading today", ok).

### 11. ALL DAY — MID-DAY PREP (after the rush)
Tap path: Dashboard → **Reports** → **Mid-day Prep** tile.
- Shot **31-midday-tile** with the tile in view.
- Tap **+ New mid-day prep**. Shot **32-midday-count**: the count form, with **On hand** and **Bulk backup** boxes in view.
- Type `4` in **On hand** for the first item and `2` for the second. Shot **33-midday-filled**.
Do not tap **Submit count → Phase 2**. Log every label on the form and any limit message.

### 12. NIGHT — AM PREP (the closing count of what is left)
AM prep is a night job: you count what is left so the morning crew knows what is there. It needs today's closing checklist to exist (you started it in goal 8).
Tap path: Dashboard → **Reports** → **AM Prep** tile → **Start AM Prep**.
- Shot **34-am-prep** (the count sheet, top).
- Type `2` for the first item, `1` for the second, `3` for the third. Shot **35-am-prep-filled** with those rows in view.
- Tap **Submit AM Prep**. If it refuses because rows are empty, log its exact words, type `1` in each remaining empty row, and submit again. Shot **36-am-prep-submitted** with the "AM Prep submitted at … by …" banner in view.
- Open the closing checklist again and find the AM prep line. Shot **37-closing-am-prep-line** showing it ticked by itself.
Log every column heading on the sheet (for example the BACK UP column) and the "Picked up where you left off …" line if you see it.

### 13. END MY SHIFT
Go to the dashboard **My shift** board (or the Assignments page) and find **End my shift**.
- Shot **38-end-my-shift** with the button in view.
- Tap **End my shift**. The confirm box is accepted for you; `look` and copy the `DIALOG (accepted)` text into the log (expected: "End your shift? Your station is released and your open tasks are unassigned."). Shot **39-shift-ended** showing the board after.
Log what changed on the board (your station, your tasks, the Reports tiles).

### 14. YOUR STUFF — PROFILE AND LANGUAGE (do not switch)
- Dashboard → **Explore** → **Profile** ("Team Profiles"). Shot **40-profile**.
- Dashboard → **Explore** → **Settings**. Scroll to the **Language** card. Shot **41-settings-language**. Do NOT change it.
- Tap the round button with your initial at the top right (the user menu). Shot **42-user-menu** with "Signed in as", the language switch and **Sign out** in view. Close the menu without choosing anything (tap the same button again).

### 15. YOUR STUFF — NOTES AND MY PERFORMANCE
- Dashboard → **Explore** → **Written Reports**. Shot **43-written-reports**.
- Tap **New report**. Shot **44-written-report-form**. Do NOT post it: log every field and placeholder, then go back.
- Dashboard → **Explore** → **My Performance**. Shot **45-my-performance**.

### 16. LOG OUT
Dashboard → scroll to the bottom → **Log out**. `look`.
- Shot **46-logged-out** (the "Where are you?" screen).
Then run `stop`.

---

Planned: 16 goals, 46 shots (01–46).
