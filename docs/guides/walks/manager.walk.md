# Manager walk — Nicole Boyd (assistant general manager, Capitol Hill, PIN 8888), tablet 1024×768

Guides v2 photo walk for the **manager guide**, in shift order (morning → all day → night → manager tools).
Shots go to `docs/guides/img/manager/NN-slug.png`; the log goes to `docs/guides/walks/manager.steplog.md`.
Source of truth for every label and rule: `docs/guides/testing/facts.md`. Outline: `docs/superpowers/specs/2026-10-13-guides-v2-design.md`.

## Your tool (every step uses it)

```
node scripts/guide-test/gt.mjs walk-manager start tablet walker
node scripts/guide-test/gt.mjs walk-manager look            (screen text + numbered controls)
node scripts/guide-test/gt.mjs walk-manager tap <number|label>
node scripts/guide-test/gt.mjs walk-manager type <number|label> <text>
node scripts/guide-test/gt.mjs walk-manager press Enter | scroll down | back
node scripts/guide-test/gt.mjs walk-manager goto </path>     (walkers only, when a goal names a page)
node scripts/guide-test/gt.mjs walk-manager shot manager/NN-slug.png [full]
node scripts/guide-test/gt.mjs walk-manager stop
```

How to drive it:
- Run `look` after every action. Control numbers change on every `look`; only use numbers from the latest one.
- `type` on a drop-down picks the option whose text you give.
- A browser pop-up (confirm box) is accepted for you. The next `look` prints it as `DIALOG (accepted) …`. Copy that text into the log.
- `shot` photographs what is on the screen now. Scroll so the thing the goal is about is in view first. Add `full` only where this script says full page.
- Move by tapping, like a person. Use `goto` only for a path this script names, and only after 3 honest tries to reach it by tapping; log that you used it.

## Rules

1. Fake names only. You are Nicole Boyd. Never type anything except the test PIN `8888`, the sim password `sim-nicole-pw` (only where this script says a password step asks for it), and the fake data this script names for that step.
2. Never photograph an error toast or a half-loaded screen. If `look` shows "Loading", a spinner word, or an error message: wait, `look` again, and retake. If the error stays, log it under `Bug?` and do not photograph it.
3. If a goal is blocked, write `BLOCKED <goal>: <why>` in the steplog (see below) and move on to the next goal. Make 3 honest tries before calling it blocked.
4. Never tap anything that sends email, texts a vendor, downloads a file or reveals contact details: no **Send**, **Mark placed**, **Download**, or reveal buttons. Never tap **Retract** or **End shift** on someone else.
5. Work at Capitol Hill only. Do not switch the language. Do not delete any old photo.

## The steplog

Replace the old content of `docs/guides/walks/manager.steplog.md`. First line: `# Manager walk — step log (Nicole Boyd, <today's date>)`.
Then one block per shot, exactly as `docs/guides/walks/_steplog-schema.md` says (Step NN — slug, URL, Persona / viewport `Nicole Boyd, Assistant General Manager / 1024x768`, Action, Saw, Shot `img/manager/NN-slug.png`, Confused, Bug?).
- `Saw` quotes the screen: headings and button labels in their exact words.
- The shot numbers below are the plan. Number shots in the order you really take them, two digits, contiguous from 01. If a shot is skipped, the next one takes the free number and keeps its slug.
- A blocked goal gets its own block with no number and no shot: `## BLOCKED — <goal>` then `- BLOCKED <goal>: <why>`.
- Record every note or comment field you meet: where it was and what its placeholder said.

## The day you will meet

The sim was reset before your walk. Today is a fresh day at Capitol Hill. Yesterday's closing is finished, so the opening is open.
Nobody at Capitol Hill has a task assigned. Task tiles show on the dashboard only to the person assigned that task, so you will see no task tiles. As a key holder or higher you **take** a task yourself from the board (Assignments): open an unassigned task and do it. Every task in this walk is opened that way unless a goal says otherwise.

---

## Goals (shift order)

### 1. LOGIN
Run `start tablet walker`, then `look`.
- On "Where are you?": shot **01-where-are-you**.
- Tap **Manager login →** (top right). Shot **02-manager-login-form** (the email + password form). Do not type in it. Tap **Use tile login →**.
- Tap the Capitol Hill tile. On "What's your role?": shot **03-whats-your-role**. Tap the Assistant General Manager tile.
- On "Who are you?": shot **04-who-are-you**. Tap Nicole Boyd.
- On "Enter your 4-digit PIN": shot **05-pin-keypad**. Tap `8` four times (it signs in on the fourth digit).

### 2. DASHBOARD
- Shot **06-dashboard** (top).
- Shot **07-dashboard-full** `full`.
Log in exact words: the role badge, the shop chip, every chip under **Explore**, the **My shift** board and every "Unassigned: … · assign or take it" line, the **Today's operations** card, whether a **Reports** section shows (it should not: nothing is assigned to you), and **Log out**.

### 3. THE BOARD — take the opening for yourself
Tap path: Dashboard → **Explore** → **Assignments** (or the **Assignments** link at the bottom of "My shift").
- Shot **08-board-tasks** with **Take or assign tasks** and its hint ("Open an unassigned task to do it. …") in view.
- Scroll to **Take or assign stations**. Shot **09-board-stations**.
- Tap **Assign task** on one task. If a picker opens, shot **10-assign-task** with it in view, then close it WITHOUT choosing anyone (tap Cancel or Close; if there is none, use `back`). Do not assign anyone.
- Now take the opening: in the task list tap **Opening prep**. It opens the Opening Report.
Log every task name, the hint text, and what the **Assign task** picker offered.

### 4. MORNING — OPENING REPORT, Phase 1 · Verify (opening verification)
- Shot **11-opening-verify**: top of the page with "Phase 1 — Verification", the subtitle, and the tabs **Phase 1 · Verify** and **Phase 2 (locked)** in view.
- On the first station card, tap **Verified**. Shot **12-opening-station-verified** with that card in view.
- Find a prep section with **Verify section**. If it is greyed out ("Recount items without closer data first"), type the recount for each item first: the "Closer count" number shown on that row, or `2` if none is shown. Tap **Verify section**. Shot **13-opening-section-verify** with that section in view.
- Finish Phase 1 with no more shots: tap **Verified** on every other station; fill every temperature box using `36`, `37`, `38`, `35`, `36`, `37`, `38`, `36` in turn; verify every other prep section the same way. If a "No prior closing data detected" box asks for a reason, choose "Closing was missed / I don't know". For any other reason box, log its exact text and choose its first option.
- Scroll to the bottom. Shot **14-opening-ready** with **Submit Opening** and the "Saved …" line in view.

### 5. MORNING — SUBMIT OPENING
Tap **Submit Opening**. `look`.
- Shot **15-opening-submitted**: the **Phase 2 — Prep Entry** tab now open.
CHANGED (facts.md): the call list put prep entry before submit. **Submit Opening** is the Phase 1 button, and Phase 2 stays locked until it is pressed. So the order is verify → **Submit Opening** → prep entry → **Finalize Phase 2**.

### 6. MORNING — Phase 2 — Prep Entry (opening prep), then finalize
Each row shows **Par**, **Closer count**, **Prep need** and a box **Opener prepped**.
- Shot **16-opening-prep-entry** with two or three rows in view, before typing.
- In the first three rows type the **Prep need** number shown on that row (`0` if it is 0). Wait for each row to save. Shot **17-opening-prep-filled**.
- Fill every remaining row the same way, then tap **Finalize Phase 2**. Shot **18-opening-finalize** showing **Phase 2 finalized** (or the read-only "Opening verified" page).
If rows will not save or **Finalize Phase 2** stays greyed out, take shot 18 of the button with its count, log its exact text, and write BLOCKED for the finalize only.

### 7. ALL DAY — RECEIVING: a produce delivery where one item did not come
Tap path: board (Explore → **Assignments**) → **Receiving**. (Also log whether Reports Hub → Inventory → **Receiving** shows for you.)
- Shot **19-receiving** (the Receiving page, before choosing a vendor).
- Choose a produce vendor. Prefer one that shows an expected order (a purchase order) for today. Shot **20-receiving-vendor** with the vendor and its lines in view.
- Receive every expected line except one. If a line needs a quantity typed, type the expected quantity shown on that line. If the form asks for an invoice number, type `SIM-1001`; for an invoice total, type `120.00`.
- When **Some expected items were never confirmed** shows, mark one item **Didn't arrive** and the rest **Received**. Shot **21-receiving-didnt-arrive** with that list and the "… short(s) will be claimed on this delivery." line in view.
- Tap **Delivery confirmed**. Shot **22-receiving-confirmed** showing the result (the delivery in the list, and **Open vendor credits** if it appears).
If no vendor has an expected order, the missing-items list cannot appear (facts.md: "Shorts can only be claimed against a purchase order."). Then log that, receive two lines by hand, use the line's own short or problem flag on one of them if the form has one, and take shots 21–22 of what you see. Log every note field and its placeholder.

### 8. ALL DAY — MID-DAY PREP (after the rush)
Tap path: board → **Mid-day prep**. If you land on a page with **+ New mid-day prep**, tap it.
- Shot **23-midday-start**: the count form with **On hand** and **Bulk backup** in view.
- Type `4` in **On hand** for the first item and `2` for the second. Shot **24-midday-filled**.
Do not tap **Submit count → Phase 2**. Log every label and any limit message.

### 9. ALL DAY — MID-SHIFT PULSE and a handoff note
Tap path: Dashboard → **Explore** → **Mid-Shift Pulse**.
- Shot **25-pulse** (top).
- Shot **26-pulse-full** `full`.
- Open the **People** section. Shot **27-pulse-section**.
- In the **Handoff** section tap **Write a handoff note**. Type `Bread comes early tomorrow. Clear a shelf in the prep fridge first.` Choose **For everyone**. Shot **28-handoff-write** with the filled form in view.
- Tap **Post note**. Shot **29-handoff-posted** showing the note.
Log every section heading, which ones say "Not available for your role." (Sales should: it needs a GM), and the floor view buttons. You are an AGM: there is no **Both shops** view (that needs level 8); do not look for it.

### 10. ALL DAY — KEEPING THE CLOSING CHECKLIST MOVING (overview)
Tap path: Dashboard → **Today's operations** → **Start closing** / **Continue closing** (or the board's **Closing checklist**).
- Shot **30-closing-overview** with "Closing checklist" and **Progress** in view.
- Shot **31-closing-full** `full`.
Look only; do not tick anything yet. Log the station sections, any "awaiting higher role" marks, the report lines (AM prep, cash, mid-day) and the **Walk-Out Verification** section.

### 11. NIGHT — AM PREP (count what is left for the morning crew)
Tap path: board → **AM prep**. (Today's closing now exists, which AM prep needs.)
- Shot **32-am-prep** (the sheet, top).
- Type `2` for the first item, `1` for the second, `3` for the third. Shot **33-am-prep-filled**.
- Tap **Submit AM Prep**. If it refuses because rows are empty, log the exact words, type `1` in each remaining empty row, and submit again. Shot **34-am-prep-submitted** with the "AM Prep submitted at … by …" banner in view.

### 12. NIGHT — PM REPORT (grades + MVP)
Tap path: board → **PM report**.
- Shot **35-pm-report** (the form, top).
- For the first person listed, set **Attitude** to **Great**. For the second person, set **Production** to **Needs work** and type `Restock lids before the rush.` in **Area to improve**. Leave every other grade on its default (**Good**). Save each person if there is a save button. Shot **36-pm-grades** with both people in view.
- In **MVP**, pick the first person. If it asks for a reason, type `Kept the line moving all lunch.` Shot **37-pm-mvp**.
- Tap **Submit PM Report**. Shot **38-pm-submitted**.
Log who was listed, the four grade names, the private-note hint text, and the MVP field labels. If fewer than two people are listed, grade who is there and log it.

### 13. NIGHT — CASH DEPOSIT
Tap path: board → **Cash report** (the tile and page call it the cash deposit).
- Shot **39-cash-deposit** (the form, top, with "$200 stays in the register" in view if possible).
- Keep **Enter total**. If **Projected (from Toast)** is a box you must fill, type `845.00`; otherwise leave it. **Drawer total**: `1045.00`. **Cash tips**: `62.00`. Under **On shift today** tick Nicole Boyd. Leave the over/short note empty. Shot **40-cash-filled**.
- Tap **Sign & submit deposit**. Shot **41-cash-pin** with the PIN prompt in view. Tap `8` four times.
- Shot **42-cash-submitted**.
Log the deposit and over/short numbers the page showed.

### 14. NIGHT — CONFIRM THE CLOSING
Tap path: Dashboard → **Today's operations** → **Continue closing**.
- Tick every line in the **Walk-Out Verification** section. Shot **43-closing-walk-out** with that section in view.
- Tap **Review & submit** (it may read **Review & submit (incomplete)**). For each reason box ("Why couldn't this be completed?") type `Sim walk — not done on this test day.` Shot **44-closing-review**.
- Submit. When **Confirm with your PIN** shows, shot **45-closing-pin**, then tap `8` four times.
- Shot **46-closing-confirmed** with the "Closing confirmed … by …" banner in view.
If a line marked as a hard gate blocks you, or the cash banner ("Cash deposit required …") still shows, log the exact words and write BLOCKED for the confirm.

### 15. MANAGER TOOLS — COUNTS (Inventory Audit)
Tap path: board → **Counts**. (Also log whether Reports Hub → Inventory → **Counts** shows for you; it needs AGM, which you are.)
- Shot **47-counts** (the "Inventory Audit" page).
- Add three lines: pick the first three items the picker offers, and type how many: `4`, `2`, `6`. Shot **48-counts-filled**.
- Tap **Record audit**. AGM and up confirm with a password (facts.md). When the password box shows, shot **49-counts-password**, then type `sim-nicole-pw` and confirm.
- Shot **50-counts-recorded**.

### 16. MANAGER TOOLS — ORDERING WALK
Ordering is NOT in the Explore menu (facts.md). A manager reaches it from the board task **Ordering**, from the dashboard Ordering tile (only when assigned), or from Reports Hub → Inventory → **Ordering**. Use the board: board → **Ordering**. Log whether the Reports Hub path also shows for you.
- Shot **51-ordering-walk** ("Ordering walk", the list).
- Adjust two quantities: tap **+** twice on the first line, and tap **+** once on another line (or its "Empty · order N" button). Shot **52-ordering-adjusted**.
- Tap **Review order**. Shot **53-ordering-review**.
- Tap the button that records the walk (for example "Record walk"). Shot **54-ordering-draft** showing the draft order.
Stop at the draft. Do NOT tap **Confirm**, **Send** or **Mark placed** (they place a real order or email the vendor).

### 17. MANAGER TOOLS — PRODUCTION
Reach the "Production" page by tapping (a link on the Ordering page or in the Reports Hub). If you cannot find a link in 3 tries, `goto /operations/production` and log that it has no menu path.
- Shot **55-production**.
- Record one batch: pick the first item offered; if a second picker ("Makes") appears, pick its first option; amount used `1`, amount made `4`. Shot **56-production-filled**.
- Tap the log button. Shot **57-production-logged**.

### 18. MANAGER TOOLS — REPORTS HUB (and sales)
Tap path: Dashboard → **Explore** → **Reports Hub**.
- Shot **58-reports-hub** with the report families in view.
- Open today's opening report. Shot **59-reports-opening**.
- Dashboard → **Explore** → **Trends**. Shot **60-trends**.
CHANGED (facts.md): the call list asks for sales here. Sales (`/reports/sales`) needs a GM (level 7); you are an AGM (6). Do not try to open it. Log whether a **Sales** family shows in the hub (it should not) and that the Pulse **Sales** card said "Not available for your role." The sales photos are taken in the catering walk (Marcus Webb, GM).

### 19. MANAGER TOOLS — BASIC ADMIN (in place of customers + catering accounts)
CHANGED (facts.md): Customers (`/admin/customers`) and Catering accounts (`/admin/customers/catering`) need a GM (level 7). You are an AGM (6), so you cannot open them; the catering walk (Marcus Webb, GM) photographs both. Instead, show what an AGM does see in Admin.
Tap path: Dashboard → **Explore** → **Admin**.
- Shot **61-admin-home**.
Log every section tile you see, and whether **Customers** is listed. Look only; open nothing.

### 20. LOG OUT
Dashboard → scroll to the bottom → **Log out**. `look`.
- Shot **62-logged-out** (the "Where are you?" screen).
Then run `stop`.

---

Planned: 20 goals, 62 shots (01–62).
