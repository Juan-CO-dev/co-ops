# Staff walk — step log (Maya Torres, 2026-10-14)

## Step 01 — where-are-you
- URL: /
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: `start phone walker`, then `look` on the login page.
- Saw: Top-right link "Manager login →". Heading "Where are you?". Two tiles with short codes: "MEP / Capitol Hill" and "EM / P Street".
- Shot: img/staff/01-where-are-you.png

## Step 02 — whats-your-role
- URL: /
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: tapped the P Street tile.
- Saw: Heading "What's your role?", sub-line "EM · P STREET". Eight tiles with codes: GM General Manager, AGM Assistant General Manager, CTR Catering Manager, SL Shift Lead, KH Key Holder, TR Trainer, EMP Employee, TRN Trainee. "← Back" below the tiles (just off the bottom of the photo).
- Shot: img/staff/02-whats-your-role.png

## Step 03 — who-are-you
- URL: /
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: tapped the Employee tile.
- Saw: Heading "Who are you?", sub-line "EM · P STREET · EMPLOYEE". Two tiles: "DC Deshawn Carter" and "MT Maya Torres". "← Back".
- Shot: img/staff/03-who-are-you.png

## Step 04 — pin-keypad
- URL: /
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: tapped the Maya Torres tile, then the digit 1 four times (it signed in on the fourth digit; no submit button).
- Saw: Badge "EMPLOYEE", name "Maya Torres", "Enter your 4-digit PIN", four empty dots, keypad 1-9 and 0, "Clear" (left of 0), "← Back" and "Use system keyboard" at the bottom. No submit button.
- Shot: img/staff/04-pin-keypad.png
- Confused: in the walker's control list the digit 1 is control [2] (control [1] is "Manager login →"), so `tap 1` would hit the wrong thing.

## Step 05 — dashboard
- URL: /dashboard?loc=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: signed in with PIN 1111; waited for "Loading…" to clear.
- Saw: Round "M" user button top right, sitting in the page above the yellow "COMPLIMENTS ONLY / OPERATIONS" banner (not over the Explore chips). "DASHBOARD", "Hi, Maya Torres.", "EXPLORE" chips: Mid-Shift Pulse, Reports Hub, Assignments, Written Reports, Maintenance, Production, Training, Profile, Settings, My Performance. Badge "EMPLOYEE", bell "Notifications, 25 unread", shop chip "EM · P STREET", top of "My shift" (Tasks "3 of 8 assigned", My station "None yet").
- Shot: img/staff/05-dashboard.png

## Step 06 — dashboard-full
- URL: /dashboard?loc=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: full-page shot of the dashboard.
- Saw: top to bottom: "M" user button; banner; "DASHBOARD / Hi, Maya Torres."; EXPLORE chips as above (10, includes "Production"); badge "EMPLOYEE"; bell 25; chip "EM · P STREET"; "My shift" with rows "Tasks — 3 of 8 assigned", "My station — None yet", "Team today — 1 of 7 assigned" and a "VIEW MY DAY" button; "TODAY'S OPERATIONS" card "EM · P Street", "Wed, Oct 14", "CLOSING CHECKLIST — Not started", "START CLOSING"; "REPORTS" section with tiles "OPENING REPORT — Not started today / OPEN / CONTINUE", "AM PREP — Not yet started / Assigned by Priya Shah / START AM PREP", "MID-DAY PREP — No mid-day preps started today. / + NEW MID-DAY PREP"; "LOG OUT" at the bottom. (Tile order is Opening, AM Prep, Mid-day.)
- Shot: img/staff/06-dashboard-full.png

## Step 07 — opening-verify
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Dashboard → Reports → "OPEN / CONTINUE" on the Opening Report tile (it went straight to /operations/opening); waited for "Loading…" to clear.
- Saw: "‹ DASHBOARD", "OPENING REPORT", "Phase 1 — Verification", "Verify last night's closing matches reality. Tap each station once you've checked it; add a comment if anything looks off." Tabs "PHASE 1 · VERIFY" and "PHASE 2 (LOCKED)". First card "CRUNCHY BOI STATION — 0 of 4 done" with the "VERIFIED" button. Lines: "Station appears clean as reported", "Crunchy Boi Fridge temp (≤41°F)" (small box showing "—"), "Sauces topped off & dated correctly", "Station ready for service (containers placed, prep ready)", each with "ADD COMMENT". Bottom bar: "0 of 44 verified · 0 of 8 temp readings entered", "44 items not yet verified", "SHOW ME WHAT NEEDS FIXING", disabled "SUBMIT OPENING". Station cards in order: Crunchy Boi, 3rd Party, Walk Ins, Prep Fridge, Prep Area, Back Line Open, Expo, Front of House Open, Manager Open, Walk-Out Verification; prep sections Veg, Cooks, Sides, Sauces, Slicing (each "VERIFY SECTION" greyed with "Recount items without closer data first").
- Shot: img/staff/07-opening-verify.png

## Step 08 — opening-station-verified
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: tapped "VERIFIED" on the Crunchy Boi Station card.
- Saw: Card now reads "3 of 4 done", the button is filled "✓ VERIFIED", three lines ticked (the fridge temp line ticked too, box still empty). Bottom bar: "4 of 44 verified · 0 of 8 temp readings entered", "40 items not yet verified", "Saved a moment ago".
- Shot: img/staff/08-opening-station-verified.png

## Step 09 — opening-temperature
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: typed 36 in the Crunchy Boi Fridge temp box, tabbed out.
- Saw: Card reads "4 of 4 done" with a green tick by the station name; box shows 36. Bottom bar "4 of 44 verified · 1 of 8 temp readings entered", "Saved a moment ago".
- Shot: img/staff/09-opening-temperature.png

## Step 10 — opening-section-verify
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: opened the Veg section; "VERIFY SECTION" was greyed. The Veg rows showed no "Closer count" so I typed 2 in each of the six red "OPENER RECOUNT" boxes (Iceberg, Onion, Basil, Radish, Cucumber, Tomato); the "Recount items without closer data first" hint went away and the button became active. Tapped "VERIFY SECTION".
- Saw: Veg card "✓ VEG — 6 of 6 done" with the filled "✓ VERIFIED" button; "OPENER RECOUNT" boxes showing 2. The red borders went away once filled (the box edge turns gold/cream); nothing stayed red.
- Shot: img/staff/10-opening-section-verify.png
- Note/comment fields: every line has an "ADD COMMENT" link (no placeholder visible until tapped); the Opener recount boxes show "—" when empty.

## Step 11 — opening-ready
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: tapped "Verified" on every other station, opened each card and typed the temps 37, 38, 35, 36, 37, 38, 36 (3rd-Party Fridge 37, Walk-In Fridge 38, Sauce Fridge 35, 3-Door Fridge 36, Back-Line Drinks Fridge 37, Deli Display Fridge 38, FOH Drinks Fridge 36); typed 2 in every opener recount box of Cooks, Sides, Sauces and Slicing and verified each section. A pink box "NO PRIOR CLOSING DATA DETECTED — 38 item(s) had no closing count from last night — morning recounts were entered. Confirm the reason:" asked for a reason; chose "Closing was missed / I don't know" (other choice: "Location was closed (planned)"). Then "Attestation: Closing was missed / I don't know" showed.
- Saw: Bottom bar "44 of 44 verified · 8 of 8 temp readings entered", "Submit ready", "Saved a moment ago", enabled yellow "SUBMIT OPENING". Footer hint while not ready, in order: "44 items not yet verified" → "Verify all sections before submitting" → "Pick a reason in the pink “No prior closing data detected” box" → "Submit ready". "SHOW ME WHAT NEEDS FIXING" link shows only while not ready.
- Shot: img/staff/11-opening-ready.png
- Confused: the selected radio shows a dark focus ring in this photo (it is the radio just tapped).

## Step 12 — opening-submitted
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: tapped "SUBMIT OPENING"; the Phase 2 tab opened by itself.
- Saw: Page title now reads "Phase 2 — Prep Entry" (not "Phase 1 — Verification"), sub-line "Type what you prepped for each item. Each row saves when you leave its box." Tabs "PHASE 1 · VERIFY" and "PHASE 2 — PREP ENTRY", link "SHOW ME WHAT NEEDS FIXING". VEG card "0 of 6 done" with a green "✓ VERIFIED" pill. First row "Iceberg — Par: 7 × 1/3 Pan", "CLOSER COUNT: 2 × 1/3 Pan", "PREP NEED: 5 × 1/3 Pan", "OPENER PREPPED" box (quantities are written "5 × 1/3 Pan"). Bottom bar: "44 of 44 verified · 8 of 8 temp readings entered · 0 of 38 prep entries", "38 prep items not yet saved", greyed "FINALIZE PHASE 2 (38 OUTSTANDING)".
- Shot: img/staff/12-opening-submitted.png

## Step 13 — opening-prep-entry
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: scrolled down a little.
- Saw: rows Onion (Par: 8 Quart, closer 2 Quart, prep need 6 Quart) and Basil (Par: 4 Quart, closer 2 Quart, prep need 2 Quart), each with an empty "OPENER PREPPED" box, "Uses: 0 Onion (red) · ~0 oz" style line and "Not saved". Tomato row (further down) says "No par set — type what you made" and "CLOSER COUNT: 2".
- Shot: img/staff/13-opening-prep-entry.png

## Step 14 — opening-prep-filled
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: typed 5 (Iceberg), 6 (Onion), 2 (Basil) in "OPENER PREPPED", tapping the "PHASE 2 — PREP ENTRY" tab after each so the box lost focus and the row saved.
- Saw: Each of the three rows shows "At par" and "Saved by Maya Torres at 10:17 PM" with an "UNDO" button. VEG card "3 of 6 done". Bottom bar "3 of 38 prep entries", "35 prep items not yet saved", "FINALIZE PHASE 2 (35 OUTSTANDING)" (greyed; not tapped). No blue ring on any box or button in the photo.
- Shot: img/staff/14-opening-prep-filled.png
- Bug?: the Iceberg row's "Uses:" line reads "Uses: 1.02 Iceberg · ~685 oz" after prepping 5 × 1/3 Pan (~685 oz looks very large for about one head of iceberg; Onion reads "0 Onion (red) · ~2 oz" for 6 quarts).

## Step 15 — my-shift
- URL: /dashboard
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Back to the dashboard (tapped "Back to Dashboard" on the opening page), scrolled so the whole My shift board is in the picture, then tapped the "Team today" row open and closed so no button holds a focus ring.
- Saw: "EMPLOYEE" badge, bell "26 unread", "EM · P STREET" chip; board "My shift" with rows "Tasks — 3 of 8 assigned", "My station — None yet", "Team today — 1 of 7 assigned" and the "VIEW MY DAY" button; below it "TODAY'S OPERATIONS" card. The Opening Report tile now reads "In progress".
- Shot: img/staff/15-my-shift.png

## Step 16 — board-tasks
- URL: /assignments?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: tapped "VIEW MY DAY"; on the Assignments page ("Today's team") collapsed Stations and opened Tasks.
- Saw: "Dashboard" link, "Assignments", "Wed, Oct 14", chip "P Street", "Today's team", a "STATIONS" button, "Stations — 0 of 12 assigned", "Tasks — 3 of 8 assigned" open. Tasks, in order: "CLOSING CHECKLIST — Everyone on shift · no assignment needed" (link), "AM PREP — Assigned to Maya Torres by Priya Shah · 10:11 PM" (link), "MID-DAY PREP — Assigned to Maya Torres by Priya Shah · 10:11 PM" (link), "Cash report — Unassigned" (plain text), "OPENING PREP — Assigned to Maya Torres by Priya Shah · 10:11 PM" (link), "Receiving — Unassigned", "Counts — Unassigned", "Ordering — Unassigned", "PM report — Unassigned" (plain text). Also a "Who has what — 1 of 7 assigned" row. Only my three tasks plus Closing checklist are links; the others are not tappable for me.
- Shot: img/staff/16-board-tasks.png
- Confused: the task is called "OPENING PREP" here, the dashboard tile is "OPENING REPORT".

## Step 17 — board-stations
- URL: /assignments?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: opened the Stations row.
- Saw: "Stations — 0 of 12 assigned". Groups and positions: Crunchy Boi Station 0 of 1 (Crunchy Boi Station · Unassigned); 3rd Party Station 0 of 1 (3rd Party Station · Unassigned); Walk Ins Station 0 of 2 (Walk-ins · Unassigned — "Dedicated to walk-in orders; helps with online orders when there are no subs to make"; Walk-ins / Online · Unassigned — "Half walk-ins, half online orders; leans toward walk-ins"); Prep Fridge 0 of 1; Shut Down Back Line 0 of 1; Expo Station 0 of 2 (Expeditor — "Expedites the orders"; Register & Delivery — "Runs the cash register and hands out delivery orders"); Clean front of house 0 of 1; Prep Area 0 of 1; Closing Manager 0 of 1; Walk-Out Verification 0 of 1. All "Unassigned".
- Shot: img/staff/17-board-stations.png

## Step 18 — claim-station
- URL: /dashboard?loc=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: from the dashboard tapped the "My station" row on My shift to open it.
- Saw: "My station — None yet" open: green "On shift · Active in CO-OPS", buttons "START BREAK" and "END MY SHIFT", heading "No station", label "Station" with a drop-down showing "No station", yellow "CLAIM / CHANGE STATION", then "Tasks" with links "AM PREP / MID-DAY PREP / OPENING PREP" (each "Assigned by Priya Shah · 10:11 PM"). Drop-down choices: No station; Crunchy Boi Station · Crunchy Boi Station · fill first; 3rd Party Station · 3rd Party Station · fill first; Walk Ins Station · Walk-ins · fill first; Walk Ins Station · Walk-ins / Online; Prep Fridge · Prep Fridge · fill first; Shut Down Back Line · Shut Down Back Line · fill first; Expo Station · Expeditor · fill first; Expo Station · Register & Delivery; Clean front of house · Clean front of house · fill first; Prep Area · Prep Area · fill first; Closing Manager · Closing Manager · fill first; Walk-Out Verification · Walk-Out Verification · fill first.
- Shot: img/staff/18-claim-station.png
- Confused: "START BREAK" and "END MY SHIFT" already show before any station is claimed.

## Step 19 — station-claimed
- URL: /dashboard?loc=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: picked "Crunchy Boi Station · Crunchy Boi Station · fill first" (the first open position), tapped "CLAIM / CHANGE STATION". The app's "Confirm change" box appeared: "Reason for change" drop-down (No reason (optional), Coverage change, Person left or unavailable, Skill fit, Correction, Other), "Note (optional)" text box, "CONFIRM CHANGE" and "CANCEL". Left the reason on "No reason (optional)" and tapped "CONFIRM CHANGE".
- Saw: the row now reads "✓ My station — Yours: Crunchy Boi Station"; inside it "Crunchy Boi Station · Crunchy Bo…" and "Claimed · 10:19 PM"; the drop-down now lists that position as "taken by Maya"; "START BREAK" and "END MY SHIFT" still show. The "My station: Crunchy Boi Station" card is a link under Reports (above "OPENING REPORT"), too far down to fit in the same screen. The My shift board has no "stations count" line of its own; the only counts on it are Tasks "3 of 8 assigned" and Team today "1 of 7 assigned".
- Shot: img/staff/19-station-claimed.png

## Step 20 — closing-checklist
- URL: /operations/closing?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Dashboard → "START CLOSING" on Today's operations.
- Saw: "‹ DASHBOARD", "CLOSING CHECKLIST", "EM · P Street", "PROGRESS 0/61" with a thin bar. My station's section "CRUNCHY BOI STATION — 0 of 6 done" is open with lines: Restock, Wipe inside & outside, Wipe tops of sauce bottles, Combine & check dates on sauces, Pull out station and sweep, "Crunchy Boi Fridge temp (≤41°F)". Other sections (collapsed): 3rd Party Station (6), Walk Ins Station (6), Prep Fridge (6), Shut Down Back Line (4), Expo Station (5), Clean Front of House (7), Prep Area (9), Closing Manager (7), Walk-Out Verification (5).
- Shot: img/staff/20-closing-checklist.png

## Step 22 — closing-ticked
- URL: /operations/closing?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: tapped "Restock", waited for it to save (progress 1/61), then tapped "Wipe inside & outside" once and waited (2/61).
- Saw: Both lines ticked, each with "UNDO", "you · 10:20 PM" and an "Add note" link. "2 of 6 done", "PROGRESS 2/61".
- Shot: img/staff/22-closing-ticked.png

## Step 22b — closing-temp-line
- URL: /operations/closing?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: tapped the "Crunchy Boi Fridge temp (≤41°F)" line; a box opened. Typed 38 in the temp box; scrolled so the box is in view and waited for the page to settle; tapped "SAVE".
- Saw: Box labels "TEMP (°F)" (text box placeholder "e.g. 38"), "NOTES (OPTIONAL)" (box placeholder "Anything noteworthy?"), buttons "SAVE" and "Cancel". The label reads "Temp (°F)", not "Count". The Progress bar sits at the top of the screen. After "SAVE": the line is ticked with "UNDO" and "38° · you · 10:20 PM"; progress 3/61, "3 of 6 done".
- Shot: img/staff/22b-closing-temp-line.png
- Confused: the line's own name is half hidden behind the sticky Progress bar at the top of the photo.

## Step 23 — closing-note
- URL: /operations/closing?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: on "Restock" tapped "Add note" (a note box opened, placeholder "Anything noteworthy?", buttons "SAVE NOTE" and "Cancel"), typed "Out of lids — told the shift lead", tapped "SAVE NOTE".
- Saw: under Restock: "you · 10:20 PM", the italic note "Out of lids — told the shift lead" and an "Edit note" link.
- Shot: img/staff/23-closing-note.png

## Step 24 — closing-full
- URL: /operations/closing?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: full-page shot after `look` showed no "Loading".
- Saw: Whole page top to bottom: Progress "3/61" at the top (not in the middle), the open Crunchy Boi Station section with Restock (note), Wipe inside & outside, three open lines and the 38° temp line, then the nine collapsed sections, and at the bottom an orange box "Tonight’s AM prep count isn’t in yet. The closer does it before lock-up." There is no button at the bottom of the page, no line marked "awaiting higher role", and no report line other than that AM prep box.
- Shot: img/staff/24-closing-full.png
- Confused: a faint colour seam crosses the page background about a third of the way down (the page gradient only covers the first screen height); nothing is drawn over the content.

## Step 25 — pulse
- URL: /mid-shift?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Dashboard → Explore → "Mid-Shift Pulse".
- Saw: "‹ DASHBOARD", "Mid-shift Pulse", "EM · P Street", "Updated 10:21 PM", "Refreshes every 60 s". Card "Needs attention — as of 10:21 PM" with "See more" and a red "NEEDS ACTION" tag; items in order: "Needs action: Mid-day prep is late" (OPEN), "Needs action: Opening prep is late" (OPEN) — both red, nothing else. Card "Live shop floor — as of 10:21 PM", "See more", "Tap a station for details.", "MAP VIEW" button, a map picture with station name labels.
- Shot: img/staff/25-pulse.png
- Bug?: in the Live shop floor map the station labels overlap each other and the red/grey floor shapes look jumbled (labels like "Walk-Out Verification", "Closing Manager", "Prep Area" stacked on top of one another).

## Step 26 — pulse-full
- URL: /mid-shift?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: full-page shot.
- Saw: Section headings in order: "Needs attention", "Live shop floor" (legend "Green covered · amber short, closing soon or past its close time · red uncovered · grey closed"), "Stations & tasks" ("1 covered · 0 short · 0 closing soon · 0 to close now · 9 uncovered · 0 closed", "Tasks: 0 done · 3 left", "MY SHIFT — Crunchy Boi Station · Crunchy Boi Station" with AM prep / Mid-day prep / Opening prep each "OPEN", then "Crunchy Boi Station · Maya COVERED" and 3rd Party Station, Walk Ins Station, Prep Fridge, Shut Down Back Line, Expo Station each "UNCOVERED"), "Catering" ("DUE TODAY — No catering due today.", "Tomorrow: no catering booked", "Prep: AM Not started · mid-day Not started", "Timing only: names and details are on the catering board for managers."), "Food safety" ("All fridges checked and in range." / "8 in range · 0 out of range · 0 unchecked"), "Handoff" ("Reports: 0 done · 5 left" with tags OPENING, AM PREP, MID-DAY PREP, CASH DEPOSIT, CLOSING; "No handoff notes for today."). Every card has "See more". No "Not available for your role." card. No fridge reminder text (fridges were all in range).
- Shot: img/staff/26-pulse-full.png

## Step 27 — pulse-section
- URL: /mid-shift/stations?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: tapped "See more" on the "Stations & tasks" card.
- Saw: "‹ PULSE", "Stations & tasks — as of 10:22 PM", the same counts, "MY SHIFT" block with three OPEN tasks, then every station with COVERED / UNCOVERED (Crunchy Boi Station · Maya COVERED; the other nine UNCOVERED), and further down headings "Stations" and "Closing checklist".
- Shot: img/staff/27-pulse-section.png

## Step 28 — maintenance
- URL: /maintenance?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: (retake, fresh `walk-staff` session after the old test notes were deleted) logged in as Maya, Dashboard → Explore → "Maintenance".
- Saw: "‹ DASHBOARD", "Maintenance Log", "FRIDGE TEMPS" with one card per fridge, each a link with a status word and a small line chart: Walk-In Fridge OK 38°F, 3-Door Fridge OK 36°F, Sauce Fridge OK 35°F, Deli Display Fridge OK 38°F, Crunchy Boi Fridge OK 38°F, FOH Drinks Fridge OK 36°F, Back-Line Drinks Fridge OK 37°F, 3rd-Party Fridge OK 37°F. No "Out of range" or "No reading today". Then "EQUIPMENT" (Oven — "No issues logged"; Fryer — "Last note: sim-seed 2026-10-07: Oil changed early, smelled burnt. (Sat, Sep 12)"), then "LOG A MAINTENANCE NOTE". There is no "OTHER EQUIPMENT NOTES" section now and no "Prep fridge" notes.
- Shot: img/staff/28-maintenance.png

## Step 29 — maintenance-note
- URL: /maintenance?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: (retake per updated script) in "LOG A MAINTENANCE NOTE": "Equipment" drop-down set to "Sauce Fridge" (choices: Walk-In Fridge, 3-Door Fridge, Sauce Fridge, Deli Display Fridge, Crunchy Boi Fridge, FOH Drinks Fridge, Back-Line Drinks Fridge, 3rd-Party Fridge, Oven, Fryer, Other…); with a fridge chosen there is no "Equipment name" box. The note box (placeholder "What's going on?") — typed "Sauce Fridge feels warm". "SAVE NOTE" is greyed until the note box has text.
- Saw: Oven and Fryer cards above, the filled form with Sauce Fridge selected and a yellow "SAVE NOTE" button.
- Shot: img/staff/29-maintenance-note.png

## Step 30 — maintenance-saved
- URL: /maintenance?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09&equipment=a888b8a2-19e4-45cc-a68a-651306cfac95
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: tapped "SAVE NOTE" (the form cleared), then tapped the "Sauce Fridge" card under Fridge temps.
- Saw: Sauce Fridge page (status OK, readings list, "WHERE THESE READINGS COME FROM", "MAINTENANCE HISTORY") with one entry: "Sauce Fridge feels warm — Maya Torres · 10:38 PM" (time 10:38 PM; the entry shows a time only, no date). The log form repeats at the bottom with "Sauce Fridge" selected.
- Shot: img/staff/30-maintenance-saved.png
- Confused: a note saved for a fridge appears only on that fridge's page ("Maintenance history"), not on the main Maintenance Log.

## Step 31 — midday-tile
- URL: /dashboard?loc=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Dashboard → scrolled to Reports.
- Saw: "REPORTS" with a "My station: Crunchy Boi Station" card, "OPENING REPORT — In progress — OPEN / CONTINUE", "AM PREP — Not yet started — Assigned by Priya Shah — START AM PREP", "MID-DAY PREP — No mid-day preps started today. — + NEW MID-DAY PREP", then "LOG OUT". Above it the Today's operations card now reads "CLOSING CHECKLIST — In progress · 3 of 61 items — CONTINUE CLOSING".
- Shot: img/staff/31-midday-tile.png

## Step 32 — midday-count
- URL: /operations/mid-day?instance=40eaf7cb-133b-4039-8649-27744eeca28c
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: tapped "+ NEW MID-DAY PREP".
- Saw: "‹ DASHBOARD", "MID-DAY PREP", "Phase 1 — count to par". VEG (open, "0 of 6 done"): Pickles PAR 20 QUART, Sweet Peppers PAR 12 QUART, Hot Peppers PAR 12 QUART, Basil PAR 4 QUART, Shredded Mozzarella PAR 5 QUART, Fresh Mozzarella PAR 12 QUART, each with an "On hand" box (placeholder "On hand"). SAUCES collapsed ("0 of 10 done"). Button "SUBMIT COUNT → PHASE 2".
- Shot: img/staff/32-midday-count.png

## Step 33 — midday-filled
- URL: /operations/mid-day?instance=40eaf7cb-133b-4039-8649-27744eeca28c
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: typed 4 in Pickles "On hand" and 2 in Sweet Peppers "On hand"; tapped the VEG header open/closed so no box holds the focus ring.
- Saw: "2 of 6 done"; Pickles "PAR 20 QUART · NEED: 16 QUART"; Sweet Peppers "PAR 12 QUART · NEED: 10 QUART"; other rows still empty.
- Shot: img/staff/33-midday-filled.png

## Step 33b — midday-phase2
- URL: /operations/mid-day?instance=40eaf7cb-133b-4039-8649-27744eeca28c
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: left the other boxes empty and tapped "SUBMIT COUNT → PHASE 2" ("SUBMITTING…" for a few seconds). It did not refuse; no "Bulk backup" message appeared.
- Saw: Title "Phase 2 — prep". VEG "0 of 6 done". Each row: name, "NEED: 16 QUART" (10, 12, 4, 5, 12), an empty box with placeholder "Prepped", a "SAVE" button, and a "Uses: … · ~0 oz" line. The page is no wider than the screen; "SAVE" on every row is fully on screen and the "Prepped" box is fully visible. SAUCES collapsed ("0 of 10 done"); bottom button "FINALIZE PREP".
- Shot: img/staff/33b-midday-phase2.png
- Confused: long item names are cut with "…" next to the box ("Sweet Pepp…", "Shredded M…").

## Step 33c — midday-row-saved
- URL: /operations/mid-day?instance=40eaf7cb-133b-4039-8649-27744eeca28c
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: typed 16 in the Pickles "Prepped" box and tapped "SAVE" ("SAVING…" then done); tapped the VEG header open/closed to drop the focus ring.
- Saw: Pickles row shows 16 in the box, "Uses: 0.03 Pickle slices · ~8 oz" and "SAVED ✓"; "1 of 6 done".
- Shot: img/staff/33c-midday-row-saved.png

## Step 33d — midday-finalized
- URL: /operations/mid-day?instance=40eaf7cb-133b-4039-8649-27744eeca28c
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: saved Sweet Peppers 10 and Hot Peppers 12 the same way (each "SAVED ✓", "3 of 6 done"), then tapped "FINALIZE PREP" (no confirm box).
- Saw: Title "Finalized — prep made", green line "Finalized at 10:24 PM by Maya Torres". VEG rows: Pickles NEED: 16 QUART · MADE: 16 QUART; Sweet Peppers NEED: 10 QUART · MADE: 10 QUART; Hot Peppers NEED: 12 QUART · MADE: 12 QUART; Basil, Shredded Mozzarella, Fresh Mozzarella NEED: 4 / 5 / 12 QUART · MADE: —. SAUCES rows: Aioli NEED: 15 BOTTLE, HC Aioli 4, HP Mayo 4, Mustard Aioli 4, Horsey Mayo 4, Salsa Verde 1, Dukes 3, Vin 6, Caesar Dressing "NEED: —", Lemon Oil 1 (all MADE: —). No "The interactive count and prep forms ship in the next build." text. No row showed "Add over/under reason" and no limit message appeared.
- Shot: img/staff/33d-midday-finalized.png

## Step 33e — production
- URL: /operations/production?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Dashboard → Explore → "Production" (opened by tapping; no goto). Looked only; logged nothing.
- Saw: "‹ DASHBOARD", "Production", card "LOG A CONVERSION" with "Raw item (SKU)" drop-down ("Pick a SKU…", entries like "Arugula (0 in stock)"), "Amount used (packs)" and "Amount made" boxes side by side, "Notes" box, a greyed "LOG PRODUCTION" button. The "Makes" field did not show before a SKU was picked. "RECENT PRODUCTION" below lists today's rows, e.g. "0 Hot Peppers → 12 Hot Peppers — Wed, Oct 14", "0 Sweet Peppers → 10 Sweet Peppers", "0 Pickle slices → 16 Pickles", "0 Basil → 2 Basil", "0 Onion (red) → 6 Onion". No shop name is printed on the page (the address carries the P Street location); no "Yield variance →" link showed for me.
- Shot: img/staff/33e-production.png
- Confused: the mid-day prep and opening prep I saved show up here as "0 X → N X" conversions.

## Step 43 — am-prep-sheet
- URL: /operations/am-prep?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Dashboard → Reports → "START AM PREP" (the closing was already started).
- Saw: "‹ DASHBOARD", "AM PREP", "EM · P Street". Sections VEG (open, "0 of 6 done"), COOKS, SIDES, SAUCES, SLICING, MISC (collapsed). Column headings on Veg: "PAR", "ON HAND", "BACK UP", "TOTAL" (Cooks the same; Sides: "PAR", "PORT", "BACK UP", "TOTAL"; Sauces and Slicing: "PAR", "LINE", "BACK UP", "TOTAL"). Rows: Iceberg 7 1/3 Pan, Onion 8 Quart, Basil 4 Quart, Radish 1 Quart, Cucumber 3 Quart, Tomato "Prep Daily"; each first box has a red "Required" tag. Bottom: "Fix 42 issues before submitting", "SHOW ME WHAT NEEDS FIXING", greyed "FIX ISSUES BEFORE SUBMITTING". No "Picked up where you left off …" line appeared.
- Shot: img/staff/43-am-prep-sheet.png

## Step 44 — am-prep-filled-row
- URL: /operations/am-prep?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: typed 2 (Iceberg), 1 (Onion), 3 (Basil) in ON HAND; tapped the VEG header open/closed to drop the focus ring.
- Saw: "3 of 6 done"; the three rows show their numbers and the shaded TOTAL box fills in with 2, 1, 3; the other three rows still show red "Required".
- Shot: img/staff/44-am-prep-filled-row.png

## Step 45 — am-prep-done
- URL: /operations/am-prep?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: typed 1 in every empty first box (Veg, Cooks, Sides "PORT", Sauces/Slicing "LINE"), tapped YES on all four Misc questions (Meatball mix - ready?, Meatballs - ready to cook?, Meatballs - for reheat?, Cook Bacon?), left BACK UP empty; Misc also has a "Notes" box with placeholder "Add notes…". The bottom button changed to "SUBMIT AM PREP" (and a "DISCARD CHANGES" button appeared while editing). Tapped "SUBMIT AM PREP"; it accepted the first time.
- Saw: green box "AM Prep submitted at 10:27 PM by Maya Torres", every section "✓ … done", boxes now greyed (read-only).
- Shot: img/staff/45-am-prep-done.png

## Step 34 — end-my-shift
- URL: /dashboard?loc=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: back on the dashboard; the "My station" row was still open from before, so I did not tap it (it would have closed it); scrolled to the My shift board.
- Saw: "✓ My station — Yours: Crunchy Boi Station" open: "On shift · Active in CO-OPS", "START BREAK", "END MY SHIFT", "Crunchy Boi Station · Crunchy Bo…", "Claimed · 10:19 PM", Station drop-down, "CLAIM / CHANGE STATION", "Tasks" with AM PREP, MID-DAY PREP, OPENING PREP (each "Assigned by Priya Shah · 10:11 PM"). No focus ring on any button.
- Shot: img/staff/34-end-my-shift.png

## Step 35 — shift-ended
- URL: /dashboard?loc=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: tapped "END MY SHIFT". The app's "Confirm change" box asked: "End your shift? Your station is released and your open tasks are unassigned." with "Reason for change" (No reason (optional) / Coverage change / Person left or unavailable / Skill fit / Correction / Other) and a note box; left "No reason (optional)", tapped "CONFIRM CHANGE".
- Saw: the board now: Tasks "0 of 8 assigned" (was 3 of 8); "My station — None yet" with "Ended shift 10:28 PM", "No station", Station drop-down, "No assigned tasks today."; "Team today — 0 of 7 assigned" (was 1 of 7). The whole REPORTS section with the Opening Report, AM Prep and Mid-day Prep tiles and the "My station: …" card is gone from the dashboard (only Today's operations remains: "CLOSING CHECKLIST — In progress · 5 of 61 items — CONTINUE CLOSING"). "START BREAK" and "END MY SHIFT" are gone, but "CLAIM / CHANGE STATION" still shows (it should not).
- Shot: img/staff/35-shift-ended.png
- Bug?: after "End my shift" the "CLAIM / CHANGE STATION" button and the Station drop-down are still shown.

## Step 36 — profile
- URL: /profile
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Dashboard → Explore → "Profile".
- Saw: "‹ DASHBOARD", "Team Profiles", "Teammates at your location", group "LEADERSHIP" (Dana Brooks, MOO), then cards: Maya Torres "You" EMP ⭐ 10, Deshawn Carter EMP ⭐ 5, Marcus Webb GM, Priya Shah AGM, Rosa Delgado KH, Tommy Nguyen SL. Long names are cut with "…" (Dan…, Maya …, Deshawn C…).
- Shot: img/staff/36-profile.png

## Step 37 — settings-language
- URL: /settings
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Dashboard → Explore → "Settings". Did not change the language.
- Saw: "Settings", "Your app preferences."; card "Language — The language used across the app." with buttons "ENGLISH" (selected, yellow) and "ESPAÑOL"; card "Profile — View your team and update your profile blurb." with "GO TO PROFILE".
- Shot: img/staff/37-settings-language.png

## Step 38 — user-menu
- URL: /settings
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: tapped the round "M" button at the top right; the menu opened in the page. Closed it by tapping the same button again (nothing chosen).
- Saw: panel with "SIGNED IN AS", "Maya Torres", "maya@sim.co-ops", "LANGUAGE" with two buttons "EN · ENGLISH" (selected) and "ES · ESPAÑOL", then "Dashboard" and "Sign out".
- Shot: img/staff/38-user-menu.png

## Step 39 — written-reports
- URL: /reports/written?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Dashboard → Explore → "Written Reports".
- Saw: "‹ REPORTS" and the "DASHBOARD" link both fully visible at the top, chip "P Street", "Written Reports", "Free-form posts for anything that doesn't fit a structured report.", "Date range" (drop-down "Last 7 days"; other choices Today, Yesterday, Last 30 days, This month, Last month, Custom), "From 10/08/2026", "To 10/14/2026", "Compare with previous period" tick-box, "Apply", "Up to 92 inclusive days. Comparison applies to summary counts and trends.", "Download" with "CSV" and "PDF" (not tapped), yellow "NEW REPORT", "No written reports yet."
- Shot: img/staff/39-written-reports.png

## Step 40 — written-report-form
- URL: /reports/written?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: tapped "NEW REPORT"; looked at the form; did not post; tapped "CANCEL".
- Saw: Form fields: "Title (optional)" (placeholder "Short summary"); "What happened" (placeholder "Describe it in your own words…"); "Category" drop-down (None, Incident, Observation, Request, Feedback, Other; default None); "Who can see this" drop-down (only "All staff"); buttons "CANCEL" and a greyed "POST REPORT" (stays greyed until "What happened" has text).
- Shot: img/staff/40-written-report-form.png

## Step 41 — my-performance
- URL: /my-feedback
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Dashboard → Explore → "My Performance"; ran `look` twice 5 s apart (text identical); on the default DAY view the two charts stayed broken after more than 10 s and a third wait, so I tapped "WEEK" (a link on the page), waited 8 s and shot again.
- Saw: Page: "‹ REPORTS", "DASHBOARD", "My Performance", chip "P Street", "From 09/15/2026", "To 10/14/2026", "Apply range", chips "DAY / WEEK / MONTH", "COMPARE TO PREVIOUS"; green card "2 MVP win(s) this period — keep it up! 🌟", score "1107 — your score · counts the work your role is here to do", chips "2-day streak", "2 MVP", "best day: 145", "100% on-time". Photo (WEEK view): "YOUR CONTRIBUTION — TASKS COMPLETED" shows a finished line chart; "ON-TIME COMPLETION — Task-window timeliness (not clock-in)" reads "Not enough days yet — this chart fills in after a few more shifts."; "HOW MANAGERS HAVE RATED YOU" colour bar; "STREAKS": 2 ACTIVE DAYS, 3 ON-TIME IN A ROW, 145 PERSONAL BEST, 2 MVP WINS. Further down: "Early-clock-in streaks unlock when Toast connects." and "FEEDBACK FROM SHIFTS" with MVP days Mon Sep 28, Wed Sep 23, Sun Sep 13 and ratings such as "Arrived ready: Great", "Attitude: Needs work".
- Shot: img/staff/41-my-performance.png
- Bug?: on the default DAY view the "Your contribution — tasks completed" chart renders as a few separate short dashes and a lone line at the right edge, and the "On-time completion" chart as one lone green mark, and they never finish drawing (waited well over 10 s; same on a second look). The WEEK view draws correctly. The photo therefore shows WEEK, not the default view.

## Step 42 — logged-out
- URL: /
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Dashboard → scrolled to the bottom → "LOG OUT".
- Saw: back on the first screen: "Manager login →", "Where are you?", tiles "MEP Capitol Hill" and "EM P Street".
- Shot: img/staff/42-logged-out.png

## Notes
- Used `goto /dashboard` once (after step 24) instead of tapping "Dashboard"; every other move was by tapping.
- The scripted order lists shots 43–45 before 34–35; they were taken in that order, as the script says.
