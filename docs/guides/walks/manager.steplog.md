# Manager walk — step log (Nicole Boyd, 2026-10-14)

## Step 01 — where-are-you
- URL: /
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Started the walk; first screen.
- Saw: "OPERATIONS"; "Manager login →" top right; heading "Where are you?"; two tiles "MEP Capitol Hill" and "EM P Street".
- Shot: img/manager/01-where-are-you.png

## Step 02 — manager-login-form
- URL: /
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "Manager login →". Typed nothing.
- Saw: "Use tile login →" top right; heading "Manager login"; "Email + password for AGM and above."; EMAIL box (placeholder "you@complimentsonlysubs.com"); PASSWORD box (placeholder empty/dots); button "SIGN IN"; link "Forgot password?"; footer "Reset links go to manager email accounts. If you sign in with a PIN, ask a manager to reset it."
- Shot: img/manager/02-manager-login-form.png

## Step 03 — whats-your-role
- URL: /
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "Use tile login →", then the Capitol Hill tile.
- Saw: "What's your role?" ; "MEP · CAPITOL HILL"; role tiles "GM General Manager", "AGM Assistant General Manager", "CTR Catering Manager", "SL Shift Lead", "KH Key Holder", "TR Trainer", "EMP Employee", "TRN Trainee"; "← Back". (Tiles run below the first screen; Employee/Trainee are at the bottom edge of the photo.)
- Shot: img/manager/03-whats-your-role.png
- Confused: After "Use tile login →" the next `look` showed "Where are you?" again, so the Capitol Hill tile was tapped next.

## Step 04 — who-are-you
- URL: /
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped the Assistant General Manager tile.
- Saw: "Who are you?"; "MEP · CAPITOL HILL · ASSISTANT GENERAL MANAGER"; one tile "NB Nicole Boyd"; "← Back".
- Shot: img/manager/04-who-are-you.png

## Step 05 — pin-keypad
- URL: /
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "Nicole Boyd". Then entered the PIN.
- Saw: badge "ASSISTANT GENERAL MANAGER"; "Nicole Boyd"; "Enter your 4-digit PIN"; four empty dots; keypad 1-9, "Clear", 0; "Back"; "Use system keyboard".
- Shot: img/manager/05-pin-keypad.png
- Confused: WALKER SLIP: I ran `tap 8` four times; `tap` takes a control NUMBER first, so it pressed control [8] = "7" four times. The screen showed "Wrong PIN. Try again." (1 failed attempt, no lockout). Then tapped control [9] ("8") four times; it signed in on the fourth digit. Note for the guide: nothing wrong with the app; "Wrong PIN. Try again." is the exact message and the dots cleared.

## Step 06 — dashboard
- URL: /dashboard?loc=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Signed in with PIN; the dashboard opened.
- Saw: round "N" user button sits in the page top right (not over anything); "COMPLIMENTS ONLY / OPERATIONS"; "DASHBOARD" / "Hi, Nicole Boyd."; role badge "ASSISTANT GENERAL MANAGER"; bell with "22" unread; shop chip "MEP · CAPITOL HILL"; "EXPLORE" chips in order: Mid-Shift Pulse, Reports Hub, Assignments, Trends, LTO, Written Reports, Catering, Maintenance, Production, Training, Recipes, Profile, Settings, My Performance, Admin; "My shift" board with three collapsed rows: "Take or assign tasks — 2 of 8 assigned", "My station — None yet", "Team today — 1 of 5 assigned"; button "ASSIGNMENTS".
- Shot: img/manager/06-dashboard.png
- Confused: The walk says nobody has a task, but "Take or assign tasks" reads "2 of 8 assigned": the Counts and Ordering tasks already show "Taken by Nicole Boyd · 1:16 AM" (see 07 rows).
- Bug?: none; but 22 unread notifications on a fresh day.

## Step 07 — dashboard-full
- URL: /dashboard?loc=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Full-page photo of the dashboard (My shift rows collapsed).
- Saw: same top as 06, then "ASSIGNMENTS" button; "TODAY'S OPERATIONS" card "MEP · Capitol Hill", "Wed, Oct 14", "CLOSING CHECKLIST — Not started", yellow "START CLOSING"; a section headed "REPORTS" with two cards: "ORDERING — 3:00 PM — Boar's Head cutoff — not started" with chips "Cardinal Bakery 3:00 PM" (red), "PFG 4:00 PM" (red), "Trimark 6:00 PM" (red), "Baldor draft", "Boar's Head draft", "PFG draft" (yellow), and "INVENTORY AUDIT — 0 DAYS SINCE LAST COUNT — 12 SKUs anchored"; "LOG OUT".
- Shot: img/manager/07-dashboard-full.png
- Confused: Expanded rows (logged, not photographed): "Take or assign tasks" lists "UNASSIGNED: AM PREP · ASSIGN OR TAKE IT", "UNASSIGNED: MID-DAY PREP · ASSIGN OR TAKE IT", "UNASSIGNED: CASH REPORT · ASSIGN OR TAKE IT", "UNASSIGNED: OPENING PREP · ASSIGN OR TAKE IT", "UNASSIGNED: RECEIVING · ASSIGN OR TAKE IT", "UNASSIGNED: PM REPORT · ASSIGN OR TAKE IT", then "COUNTS — Taken by Nicole Boyd · 1:16 AM" and "ORDERING — Taken by Nicole Boyd · 1:16 AM". "My station" expanded: "On shift · Active in CO-OPS", buttons "START BREAK", "END MY SHIFT", a "Station" drop-down ("No station", then Crunchy Boi Station · Crunchy Boi Station · fill first; 3rd Party Station · 3rd Party Station · fill first; Walk Ins Station · Walk-ins · fill first; Walk Ins Station · Walk-ins / Online; Prep Fridge · Prep Fridge · fill first; Shut Down Back Line · Shut Down Back Line · fill first; Expo Station · Expeditor · fill first; Expo Station · Register & Delivery; Clean front of house · Clean front of house · fill first; Prep Area · Prep Area · fill first; Closing Manager · Closing Manager · fill first; Walk-Out Verification · Walk-Out Verification · fill first), button "CLAIM / CHANGE STATION", and "Tasks: COUNTS Taken · 1:16 AM; ORDERING Taken · 1:16 AM". "Team today" expanded: "Here now (1) Nicole Boyd · On shift · Active in CO-OPS"; all 8 tasks and 12 stations listed; people Angel Reyes, Dana Brooks, Luis Herrera, Marcus Webb ("No station / No assigned tasks today."), Nicole Boyd (On shift, "Counts: Taken · 1:16 AM", "Ordering: Taken · 1:16 AM").
- Bug?: CONTRADICTS the walk script: a "REPORTS" section DOES show on the dashboard (Ordering and Inventory audit cards). Also Counts and Ordering are already taken by Nicole at 1:16 AM, and she is already "On shift" without tapping anything.

## Step 08 — board-tasks
- URL: /assignments?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "Assignments" in Explore; collapsed "Take or assign stations" (it opens expanded), opened "Take or assign tasks", scrolled so the heading and the first tasks are in frame (used the arrow keys to scroll part-way, so a yellow keyboard-focus ring shows round the "Take or assign tasks" header).
- Saw: "Dashboard" link; heading "Assignments"; "Wed, Oct 14"; shop button "Capitol Hill"; card "Today's team" with a "STATIONS" button and "Active staff at this shop. Stations and tasks show today's assignments."; rows "Take or assign stations — 0 of 12 assigned", "Take or assign tasks — 2 of 8 assigned"; hint "Open an unassigned task to do it. Your submission records you as the doer; to assign it to yourself, ask another key holder."; task buttons in order: CLOSING CHECKLIST ("Everyone on shift · no assignment needed"), AM PREP (Unassigned), MID-DAY PREP (Unassigned), CASH REPORT (Unassigned), OPENING PREP (Unassigned), RECEIVING (Unassigned), COUNTS ("Taken by Nicole Boyd · 1:16 AM"), ORDERING ("Taken by Nicole Boyd · 1:16 AM"), PM REPORT (Unassigned). Below: rows "Unassigned — 6 unassigned" (lists AM PREP, MID-DAY PREP, CASH REPORT, OPENING PREP, RECEIVING, PM REPORT) and "Who has what — 1 of 5 assigned".
- Shot: img/manager/08-board-tasks.png
- Confused: The hint says to assign it to yourself ask another key holder, while the dashboard says "assign or take it". Photo shows a keyboard focus ring (yellow) on the Take or assign tasks header; the page could only be scrolled by a full screen or by arrow key.
- Bug?: Counts and Ordering already show "Taken by Nicole Boyd · 1:16 AM" on a freshly reset day (script says nobody has a task).

## Step 09 — board-stations
- URL: /assignments?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Opened "Take or assign stations"; scrolled one screen. Set nobody.
- Saw: "3rd Party Station · 0 of 1" with "3rd Party Station · Unassigned"; "Walk Ins Station · 0 of 2" with "Walk-ins · Unassigned" ("Dedicated to walk-in orders; helps with online orders when there are no subs to make") and "Walk-ins / Online · Unassigned" ("Half walk-ins, half online orders; leans toward walk-ins"); "Prep Fridge · 0 of 1". Each station has a "Person" label, a drop-down showing "Person" (options: Person, Angel Reyes, Luis Herrera, Nicole Boyd) and a yellow "SET STATION" button. 12 stations in all: Crunchy Boi Station, 3rd Party Station, Walk-ins, Walk-ins / Online, Prep Fridge, Shut Down Back Line, Expeditor, Register & Delivery, Clean front of house, Prep Area, Closing Manager, Walk-Out Verification (the Expo Station group is "Expo Station · 0 of 2").
- Shot: img/manager/09-board-stations.png

## Step 10 — assign-task
- URL: /assignments?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Opened "Who has what" and scrolled one screen so Angel Reyes's whole card is in frame. Picked nothing.
- Saw: "Here now (1)  Nicole Boyd · On shift · Active in CO-OPS"; card "Angel Reyes" / "No station" / "Station" drop-down "No station" + "SET STATION"; "Tasks" / "No assigned tasks today."; labels "Task" (drop-down showing "AM prep") and "Note (optional)" (empty box, no placeholder text) and the "ASSIGN TASK" button. Dana Brooks's card has no Station/Task controls (only "No station", "Tasks", "No assigned tasks today."). Luis Herrera's card has the Station drop-down and Task drop-down.
- Shot: img/manager/10-assign-task.png
- Confused: The Task list for Angel Reyes offered: AM prep, Mid-day prep, Cash report, Opening prep, Receiving, Counts, Ordering, PM report. For Luis Herrera it offered only: AM prep, Mid-day prep, Opening prep. Station list: No station; Crunchy Boi Station · Crunchy Boi Station · fill first; 3rd Party Station · 3rd Party Station · fill first; Walk Ins Station · Walk-ins · fill first; Walk Ins Station · Walk-ins / Online; Prep Fridge · Prep Fridge · fill first; Shut Down Back Line · Shut Down Back Line · fill first; Expo Station · Expeditor · fill first; Expo Station · Register & Delivery; Clean front of house · Clean front of house · fill first; Prep Area · Prep Area · fill first; Closing Manager · Closing Manager · fill first; Walk-Out Verification · Walk-Out Verification · fill first.

## Step 11 — opening-verify
- URL: /operations/opening?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: From the board (Explore → Assignments → Take or assign tasks) tapped "OPENING PREP". The page showed "Loading…" for a moment, then opened (photographed after it loaded).
- Saw: "‹ DASHBOARD"; "OPENING REPORT"; heading "Phase 1 — Verification"; "Verify last night's closing matches reality. Tap each station once you've checked it; add a comment if anything looks off."; tabs "PHASE 1 · VERIFY" and "PHASE 2 (LOCKED)"; station cards (two columns): CRUNCHY BOI STATION (0 of 4 done, open: "Station appears clean as reported", "Crunchy Boi Fridge temp (≤41°F)" with an empty temp box showing "—", "Sauces topped off & dated correctly", "Station ready for service (containers placed, prep ready)"; each with "ADD COMMENT"), 3RD PARTY STATION 0 of 4, WALK INS STATION 0 of 4, PREP FRIDGE 0 of 4, PREP AREA 0 of 6, BACK LINE OPEN 0 of 5, EXPO STATION 0 of 4, FRONT OF HOUSE OPEN 0 of 5, MANAGER OPEN 0 of 3, WALK-OUT VERIFICATION 0 of 5, then prep sections VEG 0 of 6, COOKS 0 of 6, SIDES 0 of 6, SAUCES 0 of 11, SLICING 0 of 9 each with "VERIFY SECTION" greyed and "Recount items without closer data first". Bottom bar: "0 of 44 verified · 0 of 8 temp readings entered", "44 items not yet verified", link "SHOW ME WHAT NEEDS FIXING", greyed "SUBMIT OPENING".
- Shot: img/manager/11-opening-verify.png
- Confused: The bottom bar is sticky and sits over the lower edge of the page; the station list is two columns, so Crunchy Boi is left and Expo/Front of House/Manager Open right in the photo.

## Step 12 — opening-station-verified
- URL: /operations/opening?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "VERIFIED" on the Crunchy Boi Station card.
- Saw: card "CRUNCHY BOI STATION — 3 of 4 done" with the yellow "✓ VERIFIED" button; three lines ticked; the fridge temp line "Crunchy Boi Fridge temp (≤41°F)" ticked but its box still empty ("—"). Bottom bar "4 of 44 verified · 0 of 8 temp readings entered", "40 items not yet verified", "Saved a moment ago".
- Shot: img/manager/12-opening-station-verified.png
- Confused: "3 of 4 done" while the bar says "4 of 44 verified": the card count does not count the temp line until a temperature is typed (it went to "4 of 4 done" after typing 36).

## Step 13 — opening-section-verify
- URL: /operations/opening?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Typed 36 in the Crunchy Boi temp box (card went to "4 of 4 done"). Opened VEG; "VERIFY SECTION" was greyed ("Recount items without closer data first"). No "Closer count" number was shown on any Veg row, so typed 2 in each OPENER RECOUNT box (Iceberg, Onion, Basil, Radish, Cucumber, Tomato). Tapped "Verify section — Veg".
- Saw: "✓ VEG — 6 of 6 done" with "✓ VERIFIED"; the rows Iceberg, Onion, Basil, Radish, Cucumber, Tomato each show "ADD COMMENT" and a box "OPENER RECOUNT" holding 2 with a "—" on the right. The recount boxes are a pale yellow, NOT red, after filling. Crunchy Boi card on the left "4 of 4 done" with "36" in the temp box.
- Shot: img/manager/13-opening-section-verify.png
- Confused: The rows' own round tick circles in Veg stay empty ("·") even though the section says "6 of 6 done" and "✓ VERIFIED". Before filling the boxes were not photographed (a first test shot was not saved).

## Step 14 — opening-ready
- URL: /operations/opening?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "VERIFIED" on all other stations (Crunchy Boi 4/4 etc. stay at "3 of 4" until a temp is typed). Opened each and typed the seven remaining temps in page order: 3rd-Party Fridge 37, Walk-In Fridge 38, Sauce Fridge 35, 3-Door Fridge 36, Back-Line Drinks Fridge 37, Deli Display Fridge 38, FOH Drinks Fridge 36 (the 8 temp lines are Crunchy Boi, 3rd-Party, Walk-In, Sauce, 3-Door, Back-Line Drinks, Deli Display, FOH Drinks). Typed 2 in every OPENER RECOUNT box of Cooks (Vodka, Marinara, Compound Butter, Caramelized onion, Jus, Chicken Cutlet), Sides (Tuna Salad, Egg Salad, Onion Dip, Chix Salad, Antipasto Pasta, Cannoli Cream), Sauces (Aioli, HC Aioli, HP Mayo, Mustard Aioli, Horsey Mayo, Salsa Verde, Dukes, Vin, Caesar Dressing, Lemon Oil, Ranch) and Slicing (Turkey, Ham, Capicola, Pepperoni, Genoa, Provolone, Mortadella, Roast Beef, Cheddar); verified all four sections. Chose the reason "Closing was missed / I don't know".
- Saw: red box "NO PRIOR CLOSING DATA DETECTED" — "38 item(s) had no closing count from last night — morning recounts were entered. Confirm the reason:" with radios "Location was closed (planned)" and "Closing was missed / I don't know" (chosen); "Attestation: Closing was missed / I don't know". Bottom bar: "44 of 44 verified · 8 of 8 temp readings entered", "Submit ready", "Saved a moment ago", yellow enabled "SUBMIT OPENING".
- Shot: img/manager/14-opening-ready.png
- Confused: The no-prior-data box first read "6 item(s)" (after Veg) then "38 item(s)" once all prep sections were recounted. Veg showed this box before the other sections were done. No other reason boxes met.

## Step 15 — opening-submitted
- URL: /operations/opening?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "SUBMIT OPENING".
- Saw: page title now "Phase 2 — Prep Entry" ("OPENING REPORT" above it); "Type what you prepped for each item. Each row saves when you leave its box."; tabs "PHASE 1 · VERIFY" and "PHASE 2 — PREP ENTRY" (active); link "SHOW ME WHAT NEEDS FIXING"; VEG card "0 of 6 done" with green "✓ VERIFIED"; first row Iceberg "Par: 7 × 1/3 Pan", "CLOSER COUNT: 2 × 1/3 Pan", "PREP NEED: 5 × 1/3 Pan", "OPENER PREPPED" empty box. Bottom bar "44 of 44 verified · 8 of 8 temp readings entered · 0 of 38 prep entries", "38 prep items not yet saved", greyed "FINALIZE PHASE 2 (38 OUTSTANDING)". Quantities read like "5 × 1/3 Pan".
- Shot: img/manager/15-opening-submitted.png
- Bug?: none. No toast or error after Submit Opening.

## Step 16 — opening-prep-entry
- URL: /operations/opening?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Scrolled a little (arrow keys) before typing.
- Saw: rows Iceberg (Par: 7 × 1/3 Pan; CLOSER COUNT: 2 × 1/3 Pan; PREP NEED: 5 × 1/3 Pan), Onion (Par: 8 Quart; CLOSER COUNT: 2 Quart; PREP NEED: 6 Quart), Basil (Par: 4 Quart; CLOSER COUNT 2 Quart ...). Each row has a grey "Uses: 0 Iceberg · ~0 oz  tap to confirm usage" line (Onion row reads "Uses: 0 Onion (red) · ~0 oz") and the small text "Not saved". Other rows in Veg: Radish (Par 1 Quart, need 0), Cucumber (Par 3 Quart, need 1 Quart), Tomato ("No par set — type what you made", Uses: 0 Tomatoes). Other sections COOKS 6, SIDES 6, SAUCES 11, SLICING 9 (38 prep entries in all), each with "✓ VERIFIED".
- Shot: img/manager/16-opening-prep-entry.png
- Confused: none; the closer counts all read 2 because the opener recounts in Phase 1 were typed as 2.

## Step 17 — opening-prep-filled
- URL: /operations/opening?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Typed 5 (Iceberg), 6 (Onion), 2 (Basil) in OPENER PREPPED; pressed Tab to leave the last box so it saved.
- Saw: each saved row shows green italic "At par", "Saved by Nicole Boyd at 3:17 AM" and an "UNDO" button; Iceberg row now "Uses: 1.02 Iceberg · ~685 oz", Onion "Uses: 0 Onion (red) · ~2 oz", Basil "Uses: 0.03 Basil · ~1 oz". Bottom bar "44 of 44 verified · 8 of 8 temp readings entered · 3 of 38 prep entries", "35 prep items not yet saved", "FINALIZE PHASE 2 (35 OUTSTANDING)".
- Shot: img/manager/17-opening-prep-filled.png
- Confused: Three saved rows are taller than the screen, so the photo shows the Iceberg input and its Undo block cut at the top, Onion in full and the Basil input; the Basil "Uses" line has a yellow keyboard-focus ring (from the Tab key).

## Step 18 — opening-finalize
- URL: /operations/opening?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Typed the first number of Prep need in every other row (Veg: Radish 0, Cucumber 1, Tomato 0; Cooks: Vodka 2, Marinara 4, Compound Butter 0, Caramelized onion 0, Jus 2, Chicken Cutlet 13; Sides: Tuna Salad 13, Egg Salad 10, Onion Dip 10, Chix Salad 10, Antipasto Pasta 10, Cannoli Cream 0; Sauces: Aioli 13, HC Aioli 2, HP Mayo 2, Mustard Aioli 2, Horsey Mayo 2, Salsa Verde 0, Dukes 1, Vin 4, Caesar Dressing 0 ("No par set — type what you made"), Lemon Oil 0, Ranch 1; Slicing: Turkey 3, Ham 13, Capicola 13, Pepperoni 10, Genoa 23, Provolone 23, Mortadella 2, Roast Beef 0, Cheddar 4). Tapped "FINALIZE PHASE 2".
- Saw: the five sections collapsed with green ticks: "VEG 6 of 6 done", "COOKS 6 of 6 done", "SIDES 6 of 6 done" (and Sauces 11 of 11, Slicing 9 of 9), each "✓ VERIFIED"; bottom bar "44 of 44 verified · 8 of 8 temp readings entered · 38 of 38 prep entries", "Phase 2 already finalized", greyed button "PHASE 2 FINALIZED".
- Shot: img/manager/18-opening-finalize.png
- Confused: No over/under reason box appeared on any row; every row said "At par". Finalize needed no confirm box.

## Step 25 — pulse
- URL: /mid-shift?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Back on the dashboard, tapped "Mid-Shift Pulse" in Explore. (Pulse links open slowly: the first tap seems to do nothing for 3-8 seconds, then the page changes; I waited before looking.)
- Saw: "‹ DASHBOARD"; "Mid-shift Pulse  MEP · Capitol Hill  Updated 3:21 AM"; "Refreshes every 60 s"; card "Needs attention  as of 3:21 AM  See more" with the red tag "NEEDS ACTION" and eight rows each with an "ASSIGN" button, in this order (all red dots): "3rd Party Station is uncovered", "Expo Station is uncovered", "Crunchy Boi Station is uncovered", "Prep Area is uncovered", "Closing Manager is uncovered", "Clean front of house is uncovered", "Prep Fridge is uncovered", "Walk-Out Verification is uncovered", then "+3".
- Shot: img/manager/25-pulse.png
- Confused: No red "late" items showed (nothing is late), so the order was uncovered stations first; the order of the uncovered stations is not the order of the Assignments page (3rd Party, Expo, Crunchy Boi, Prep Area, Closing Manager, Clean front of house, Prep Fridge, Walk-Out Verification). The "See more" page for Needs attention (/mid-shift/attention) lists all 10 uncovered stations (adds "Walk Ins Station is uncovered", "Shut Down Back Line is uncovered") then a "Check:" line "5 items low vs par: Chicken Breast · Duke's Mayo · Ham" with an "ORDER" button. No yellow items before that Check line.

## Step 26 — pulse-full
- URL: /mid-shift?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Full-page photo of the Pulse (taken twice, 8 seconds apart; the floor map looked the same both times).
- Saw: cards in order: "Needs attention", "Live shop floor  as of 3:21 AM  See more" ("Tap a station for details." button "MAP VIEW"; legend "Green covered · amber short, closing soon or past its close time · red uncovered · grey closed"), "People" ("Here now (1)  0 stations covered · 10 open", "Nicole Boyd  No station · Active in CO-OPS"), "Stations & tasks" ("0 covered · 0 short · 0 closing soon · 0 to close now · 10 uncovered · 0 closed", "Tasks: 1 done · 0 left", then Crunchy Boi Station, 3rd Party Station, Walk Ins Station, Prep Fridge, Shut Down Back Line, Expo Station each tagged "UNCOVERED"), "Catering" ("DUE TODAY No catering due today.", "Tomorrow: no catering booked", "Prep: AM Not started · mid-day Not started", "NOT RUNG INTO TOAST Every ezCater order is in Toast."), "Inventory" ("Last par walk 2:34 AM by Nicole Boyd", "5 items at 86 risk", "RUNNING LOW VS PAR": Chicken Breast 0% of par · order 1 Case; Duke's Mayo 0% of par · order 3 case; Ham 0% of par · order 3 Each (no case); Iceberg 0% of par · order 4 Case; Tomatoes Crushed (10#) 0% of par · order 1 Case; "On-hand share is estimated from the walk's order quantity (order up to par)."; "ORDER CUTOFFS TODAY": Boar's Head · 3:00 PM · draft ready; Cardinal Bakery · 3:00 PM · no draft yet; PFG · 4:00 PM · draft ready; Trimark · 6:00 PM · no draft yet), "Food safety" ("All fridges checked and in range.", "8 in range · 0 out of range · 0 unchecked", fridge tiles Walk-In 38°F, 3-Door 36°F, Sauce 35°F, Deli Display 38°F, Crunchy Boi 36°F, FOH Drinks 36°F, Back-Line Drinks 37°F, 3rd-Party 37°F), "Handoff" ("Reports: 1 done · 4 left", chips OPENING, AM PREP, MID-DAY PREP, CASH DEPOSIT, CLOSING; "No handoff notes for today.").
- Shot: img/manager/26-pulse-full.png
- Confused: The Live shop floor map is drawn as a grey wedge with red shapes and station labels piled up on top of each other (3D-looking view); it reads as half-drawn but did not change in 8 seconds.
- Bug?: Contradicts the walk script: NO card said "Not available for your role." (script expected Sales to). There is no Sales card at all. The walk's earlier Ordering/par-walk line says "Last par walk 2:34 AM by Nicole Boyd" though Nicole did not walk any par.

## Step 27 — pulse-section
- URL: /mid-shift/people?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "See more" on the People card.
- Saw: "‹ PULSE"; card "People  as of 3:22 AM"; "Here now (1)  0 stations covered · 10 open"; "Nicole Boyd  No station · Active in CO-OPS"; "TIMELINE — Nothing to show yet."; link "Stations".
- Shot: img/manager/27-pulse-section.png
- Confused: The back link reads "‹ PULSE" (the script said "‹ Pulse"). No timeline entries even though the opening was submitted and finalized.

## Step 28 — handoff-write
- URL: /mid-shift/handoff?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: On the Pulse tapped "See more" in the Handoff card. Chose "For everyone" and typed the note text in "Note".
- Saw: "Handoff  as of 3:24 AM"; "Reports: 1 done · 4 left" with chips OPENING (green), AM PREP, MID-DAY PREP, CASH DEPOSIT, CLOSING; "No handoff notes for today."; "WRITE A HANDOFF NOTE"; "Who should see it" drop-down (For everyone / For crew / For managers); "Note" box; yellow "POST NOTE" (greyed until text typed). The note reads "Bread comes early tomorrow. Clear a shelf in the prep fridge first."
- Shot: img/manager/28-handoff-write.png
- Confused: Note fields: "Note" textarea on this page has NO placeholder text (empty). Handoff is a separate page, reached by "See more" in the card (the Pulse card itself has no write box).

## Step 29 — handoff-posted
- URL: /mid-shift/handoff?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "POST NOTE". Did not tap Retract.
- Saw: note card tagged "FOR EVERYONE", "Nicole Boyd · 3:25 AM", text "Bread comes early tomorrow. Clear a shelf in the prep fridge first.", buttons "GOT IT" and red "RETRACT"; the form below cleared (Note empty, "POST NOTE" greyed).
- Shot: img/manager/29-handoff-posted.png

## Step 19 — receiving
- URL: /operations/receiving?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Dashboard → Explore → Assignments → tapped "RECEIVING" in the task list (the page took about 8 seconds to open).
- Saw: "‹ DASHBOARD" (left) and "ORDERING ›" (right) at the top, both clear of the round user button; heading "Receiving"; card "1 COUNT THE DELIVERY": "Vendor" drop-down "Pick a vendor…" (options: Amazon, Baldor, Berger, Boar's Head, Cardinal Bakery, Continental Tape, Costco, Country Snacks, Cristian, District Bakery, Leonard Paper, Penny Candy, PFG, Sarah, Saval, Sysco, Thompson Delivers, Trimark, US Foods, Vistaprint, Webstaurant, Whisked, "+ New store"); "Delivery date" 10/14/2026; "Invoice #" (placeholder "From the paperwork"); "Invoice total ($)" (empty, no placeholder); dashed box "Pick a vendor to load its usual order."; card "2 RECEIPT PHOTO" ("Snap the invoice or packing slip. It settles any credit later.", "Take receipt photo", checkbox "Photo later"); "Notes"; sticky bottom bar with "3" and greyed "DELIVERY CONFIRMED" and "SAVE PARTIAL — TRUCK STILL UNLOADING". Right column: "RECENT DELIVERIES", "Download" "CSV" "PDF" (not tapped), "No deliveries logged yet."
- Shot: img/manager/19-receiving.png
- Confused: Notes box placeholder (seen after step 22): "Anything to flag about this delivery…". The Invoice total box has no placeholder text.

## Step 20 — receiving-vendor
- URL: /operations/receiving?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Picked "Baldor" in Vendor; scrolled down a little.
- Saw: small tag "Saved on device 3:27 AM" appears at the top right of the card; Vendor "Baldor"; Delivery date; Invoice #; Invoice total ($); buttons "Scan" with the tag "Scanner ready", and "Prices from the invoice"; ONE usual-order line "Cholula — Tap to count (units)" with a dashed count box showing "—"; a dashed box with "Pick a SKU…" drop-down and a greyed "+ Add item". The Pick-a-SKU list: Cholula, Cannoli Shell, Fresh Mozzarella, Ham, Lettuce, Onions, Salami, White Cheddar.
- Shot: img/manager/20-receiving-vendor.png
- Confused: Baldor's usual order here is only Cholula (no lettuce line), so the first line was used. The line gives no "expected" number to compare, only "Tap to count (units)".

## Step 21 — receiving-didnt-arrive
- URL: /operations/receiving?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped the Cholula line to open it, typed 1 in "Qty (units)", tapped "Short".
- Saw: opened line "Cholula — Suggested — from this vendor's usage" with "Done" at its right; "QTY (UNITS)" with − / 1 / + ; italic "No pack chain — enter quantity in packs."; "FLAG A PROBLEM" with pills "Short" (pink, selected), "Over", "Damaged", "Sub"; "PRICE/PACK ($)" and "OZ/EACH (OPT)" boxes (empty); "Line note (optional)" (placeholder text "Line note (optional)"); "Add photo".
- Shot: img/manager/21-receiving-didnt-arrive.png
- Confused: The pill says "Short"; the photo name says "didn't arrive". No "Received" / "Didn't arrive" buttons appeared anywhere on this page.

## Step 22 — receiving-confirmed
- URL: /operations/receiving?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Typed SIM-1001 in "Invoice #" and 120.00 in "Invoice total ($)", ticked "Photo later", tapped "DELIVERY CONFIRMED". It saved at once: there was no "Some expected items were never confirmed" list and no "Tap again to confirm" step (only one line), and no browser pop-up. The form reset.
- Saw: right column now has "Open vendor credits  1 open ▸" and under "RECENT DELIVERIES" (Download CSV / PDF) a card "Baldor  2026-10-14", yellow tag "PHOTO MISSING", "1 item(s) · #SIM-1001 · Nicole Boyd". The left form is back to "Pick a vendor…", "Pick a vendor to load its usual order."
- Shot: img/manager/22-receiving-confirmed.png
- Confused: Note fields met on this page: "Line note (optional)" (inside an opened line), and "Notes" (placeholder "Anything to flag about this delivery…").
- Bug?: The "Short" flag on a 1-unit Cholula count created an open vendor credit ("1 open") at once; not a bug but not described in the script.

## Step 23 — midday-start
- URL: /operations/mid-day?instance=59571b58-a018-4d00-9dc4-c628c323dcbf
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Dashboard → Assignments → "MID-DAY PREP" (page said "No mid-day preps started today." and a button "+ NEW MID-DAY PREP"); tapped "+ NEW MID-DAY PREP".
- Saw: "‹ DASHBOARD"; "MID-DAY PREP"; heading "Phase 1 — count to par"; sections "VEG 0 of 6 done" (open): Pickles PAR 20 QUART, Sweet Peppers PAR 12 QUART, Hot Peppers PAR 12 QUART, Basil PAR 4 QUART, Shredded Mozzarella PAR 5 QUART, Fresh Mozzarella PAR 12 QUART, each with a box with the placeholder "On hand"; "SAUCES 0 of 10 done" and "COOKS 0 of 1 done" (closed); yellow "SUBMIT COUNT → PHASE 2".
- Shot: img/manager/23-midday-start.png

## Step 24 — midday-filled
- URL: /operations/mid-day?instance=59571b58-a018-4d00-9dc4-c628c323dcbf
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Typed 4 in Pickles "On hand" and 2 in Sweet Peppers "On hand", pressed Tab.
- Saw: "VEG 2 of 6 done"; "Pickles — PAR 20 QUART · NEED: 16 QUART" (4); "Sweet Peppers — PAR 12 QUART · NEED: 10 QUART" (2); the other rows still "On hand" with no NEED line. Hot Peppers box shows a keyboard focus ring and spinner arrows from the Tab key.
- Shot: img/manager/24-midday-filled.png
- Confused: no "Bulk backup" boxes or messages anywhere in Phase 1 (labels met: "On hand", "PAR … QUART", "NEED: …"). Tapped "SUBMIT COUNT → PHASE 2" with the rest empty: it went straight through with no refusal.

## Step 24b — midday-phase2-saved
- URL: /operations/mid-day?instance=59571b58-a018-4d00-9dc4-c628c323dcbf
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: On "Phase 2 — prep" typed 16 (the Need number) in Pickles "Prepped" and tapped its "SAVE".
- Saw: heading "Phase 2 — prep"; "VEG 1 of 6 done"; Pickles row "NEED: 16 QUART" with the box showing 16, "SAVE", "Uses: 0.03 Pickle slices · ~8 oz  tap to confirm usage", green "SAVED ✓"; next rows Sweet Peppers "NEED: 10 QUART", Hot Peppers "NEED: 12 QUART", Basil "NEED: 4 QUART", each with an empty Prepped box (placeholder reads "Prepp", cut off) and a yellow "SAVE"; right side "SAUCES 0 of 10 done", "COOKS 0 of 1 done", "FINALIZE PREP".
- Shot: img/manager/24b-midday-phase2-saved.png
- Confused: The Prepped placeholder is cut off as "Prepp" in the narrow box. No "Add over/under reason" showed on any row. Phase 2 row labels: "NEED:", "Prepped" (box), "SAVE", "Uses: …", "SAVED ✓". After the count the Phase 2 rows show only NEED (no Par, no On hand).

## Step 24c — midday-finalized
- URL: /operations/mid-day?instance=59571b58-a018-4d00-9dc4-c628c323dcbf
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Saved Sweet Peppers 10 and Hot Peppers 12 the same way, then tapped "FINALIZE PREP".
- Saw: title "Finalized — prep made"; green banner "Finalized at 3:30 AM by Nicole Boyd"; rows "VEG: Pickles NEED: 16 QUART · MADE: 16 QUART; Sweet Peppers NEED: 10 QUART · MADE: 10 QUART; Hot Peppers NEED: 12 QUART · MADE: 12 QUART; Basil NEED: 4 QUART · MADE: —; Shredded Mozzarella NEED: 5 QUART · MADE: —; Fresh Mozzarella NEED: 12 QUART · MADE: —"; "SAUCES": Aioli NEED: 15 BOTTLE, HC Aioli 4, HP Mayo 4, Mustard Aioli 4, Horsey Mayo 4, Salsa Verde 1, Dukes 3, Vin 6, Caesar Dressing "NEED: — · MADE: —", Lemon Oil 1; "COOKS": Chicken Cutlet NEED: 15 PIECE · MADE: —. The text "The interactive count and prep forms ship in the next build." does NOT appear.
- Shot: img/manager/24c-midday-finalized.png
- Confused: Finalize ran with unsaved rows left blank (MADE: —); no warning.

## Step 30 — closing-overview
- URL: /operations/closing?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Dashboard → "START CLOSING" under Today's operations (page took about 10 seconds to open).
- Saw: "‹ DASHBOARD"; "CLOSING CHECKLIST"; "MEP · Capitol Hill"; "PROGRESS" with "2/61" and a thin yellow bar; sections in two columns, each with "N of M done": CRUNCHY BOI STATION 0 of 6 (open; lines Restock, Wipe inside & outside, Wipe tops of sauce bottles, Combine & check dates on sauces, Pull out station and sweep, Crunchy Boi Fridge temp (≤41°F)), 3RD PARTY STATION 0 of 6, WALK INS STATION 0 of 6, PREP FRIDGE 0 of 6, SHUT DOWN BACK LINE 0 of 4, EXPO STATION 0 of 5, CLEAN FRONT OF HOUSE 0 of 7, PREP AREA 0 of 9, CLOSING MANAGER 2 of 7, WALK-OUT VERIFICATION 0 of 5.
- Shot: img/manager/30-closing-overview.png
- Confused: Progress already reads 2/61 before anything is ticked: the Opening verified and Mid-day Prep lines are ticked by the earlier work. The photo shows the first column and the right-hand sections that start at the top (Walk Ins, Prep Fridge, Shut Down Back Line, Expo Station, Clean Front of House, Prep Area); 3rd Party Station sits lower down in the column.

## Step 31 — closing-full
- URL: /operations/closing?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Opened every section (all ten now show "▾"), scrolled back to the top, waited, `look` showed no "Loading".
- Saw: header "CLOSING CHECKLIST / MEP · Capitol Hill", "PROGRESS 2/61", open sections: left column CRUNCHY BOI STATION (0 of 6) with its six lines; right column EXPO STATION 0 of 5 (Change & stock cannoli pan, Wipe out deli display fridge, Restock bevs, Cookies & gluten free, Deli Display Fridge temp (≤41°F)), then CLEAN FRONT OF HOUSE starting at the bottom edge. No "awaiting higher role" mark anywhere on the page.
- Shot: img/manager/31-closing-full.png
- Confused: Section order on screen is not the order in the script (a two-column layout puts sections where they fit). Other open sections (text): 3RD PARTY STATION: Restock, Wipe inside & outside, Wipe tops of sauce bottles, Combine & check dates on sauces, Pull out station and sweep, 3rd-Party Fridge temp (≤41°F); CLEAN FRONT OF HOUSE: Bathrooms, Patio furniture, Sweep, Mop, Restock bev fridge, Put away / organize cases, FOH Drinks Fridge temp (≤41°F); SHUT DOWN BACK LINE: Wipe down burners, Wipe down tile walls, Wipe wall under prep tables, Back-Line Drinks Fridge temp (≤41°F).

## Step 31a — closing-report-lines
- URL: /operations/closing?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Scrolled down to the Closing Manager and Walk-Out Verification sections.
- Saw: CLOSING MANAGER (2 of 7 done): "Count the drawer"; "Count and secure tips — Count tips, place in safe. Weekly distribution handled separately by…"; "AM Prep List — Pending — tap to open"; "Opening verified — Submitted by Nicole Boyd at 3:20 AM" (green tick); "Mid-day Prep ×1 — Submitted by Nicole Boyd at 3:30 AM" (green tick); "Cash deposited — Pending — tap to open"; "PM Report submitted — Pending — tap to open". WALK-OUT VERIFICATION (0 of 5 done) starting: Lights off, Devices charging, Oven off, Front doors locked, Back door locked. The sticky "PROGRESS 2/61" bar is at the very top of the photo.
- Shot: img/manager/31a-closing-report-lines.png
- Confused: The Mid-day Prep line IS already ticked by the finalize, as the walk said. The sticky Progress bar overlaps the top edge of the first line.

## Step 31b — closing-temp-line
- URL: /operations/closing?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: In the Crunchy Boi Station section tapped "Crunchy Boi Fridge temp (≤41°F)"; typed 38 in "Temp (°F)"; photographed; then tapped "SAVE".
- Saw: line "Crunchy Boi Fridge temp (≤41°F)" with an open yellow box: label "TEMP (°F)" holding 38 (box placeholder "e.g. 38"), label "NOTES (OPTIONAL)" with the placeholder "Anything noteworthy?", yellow "SAVE" and "Cancel". After Save the line shows a tick, "UNDO", and the text "38° · you · 3:32 AM"; the section reads "1 of 6 done".
- Shot: img/manager/31b-closing-temp-line.png
- Confused: The label reads "Temp (°F)", not "Count", as the walk expects. A yellow focus ring is on the Temp box (it was the last typed box).

## Step 41 — am-prep
- URL: /operations/am-prep?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Dashboard → Assignments → "AM PREP" (took about 10 seconds to open).
- Saw: "‹ DASHBOARD"; "AM PREP"; "MEP · Capitol Hill"; VEG (open, "0 of 6 done") with column heads "PAR", "ON HAND", "BACK UP", "TOTAL" and rows Iceberg (7 1/3 Pan), Onion (8 Quart), Basil (4 Quart), Radish (1 Quart), Cucumber (3 Quart), Tomato ("Prep Daily"), each with a red "Required" under its ON HAND box and a shaded TOTAL box; right column sections COOKS 0 of 6, SIDES 0 of 6, SAUCES 0 of 11, SLICING 0 of 9, MISC 0 of 4 (closed); below, a pink bar "Fix 42 issues before submitting" + "SHOW ME WHAT NEEDS FIXING" and a greyed "FIX ISSUES BEFORE SUBMITTING".
- Shot: img/manager/41-am-prep.png
- Confused: Column heads differ by section once opened: Cooks "ON HAND", Sides "PORTIONED", Sauces and Slicing "LINE" (all with BACK UP and TOTAL). Note fields: MISC has a box with the placeholder "Add notes…". A "DISCARD CHANGES" button sits at the very bottom (not tapped).

## Step 42 — am-prep-filled
- URL: /operations/am-prep?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Typed 2 (Iceberg), 1 (Onion), 3 (Basil) in ON HAND.
- Saw: "VEG 3 of 6 done"; Iceberg 2 / TOTAL 2; Onion 1 / TOTAL 1; Basil 3 / TOTAL 3 (Basil box has a yellow keyboard-focus ring); Radish, Cucumber, Tomato still empty with "Required"; the pink bar now reads "Fix 39 issues before submitting".
- Shot: img/manager/42-am-prep-filled.png
- Confused: TOTAL fills itself from ON HAND (BACK UP empty counts as nothing).

## Step 43 — am-prep-submitted
- URL: /operations/am-prep?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Typed 1 in the first box of every other row (Radish, Cucumber, Tomato; all Cooks, Sides, Sauces and Slicing rows), tapped YES on all four MISC questions (Meatball mix - ready?, Meatballs - ready to cook?, Meatballs - for reheat?, Cook Bacon?), left BACK UP empty, tapped "SUBMIT AM PREP". It went through first time, no refusal. After tapping Submit the page stays scrolled down; I scrolled back to the top for the photo.
- Saw: green banner "AM Prep submitted at 3:34 AM by Nicole Boyd"; every section has a green tick and "N of N done" (VEG 6 of 6, SAUCES 11 of 11 ...); rows are greyed and read-only: Iceberg 2/2, Onion 1/1, Basil 3/3, Radish 1/1, Cucumber 1/1, Tomato 1/1, Aioli, HC Aioli, HP Mayo, Mustard Aioli, Horsey Mayo, Salsa Verde, Dukes each 1/1.
- Shot: img/manager/43-am-prep-submitted.png
- Confused: In the read-only view the MISC questions show YES highlighted, notes box "Add notes…" empty.

## Step 32 — pm-report
- URL: /pm-report?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Dashboard → Assignments → "PM REPORT" (about 10 seconds to open). Photographed before touching any grade.
- Saw: "‹ DASHBOARD"; "PM Report"; "SHIFT ACTIVITY": "Nicole Boyd  145 items · 3 reports", then rows "Opening 3:20 AM", "AM Prep 3:34 AM", "Mid-day Prep 3:30 AM", "Cash Deposit Not started", "Closing In progress"; "MVP" with a drop-down "No MVP" and a yellow "SAVE"; heading "ATTITUDE" and the first card "Nicole Boyd / ARRIVED READY" just at the bottom edge. No grade was picked on any line.
- Shot: img/manager/32-pm-report.png
- Confused: only ONE person (Nicole Boyd) was listed at first, so the grade cards could not be photographed in full in this frame. The word "ATTITUDE" is used as the heading above the whole grade-card area AND as the second grade line on each card. Under "Select employee…" at the bottom the list offers Angel Reyes, Dana Brooks, Luis Herrera, Marcus Webb. Card hints seen: "Pick a grade on every line to save." (shown under a card with no grades; gone once all four lines are graded), "Only managers see this note" under "NOTE (MANAGERS ONLY)" (placeholder "Private note for managers"); "AREA TO IMPROVE" placeholder "What should they work on?".

## Step 33 — pm-grades
- URL: /pm-report?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Fewer than two people were listed, so I graded Nicole Boyd (Arrived ready Good, Attitude Great, Production Good, Team player Good) and tapped her card's "SAVE"; then picked "Angel Reyes" (first name) in "Select employee…", graded Arrived ready Good, Attitude Good, Production Needs work, Team player Good, typed "Restock lids before the rush." in "Area to improve" and tapped "SAVE".
- Saw: two cards side by side: "Nicole Boyd" with Good / Great / Good / Good highlighted and an empty "AREA TO IMPROVE" ("What should they work on?"), and "Angel Reyes" with Good / Good / Needs work / Good highlighted and "Restock lids before the rush." in Area to improve; each has "NOTE (MANAGERS ONLY)" ("Private note for managers", "Only managers see this note") and a yellow "SAVE". The four grade names: ARRIVED READY, ATTITUDE, PRODUCTION, TEAM PLAYER; options "Great", "Good", "Needs work".
- Shot: img/manager/33-pm-grades.png
- Confused: There is NO visible "Saved" message or change after tapping SAVE on a card: the SAVE buttons stay yellow and active. I could not tell from the screen that the cards were saved (the PM Report still accepted Submit afterwards). Angel Reyes was added to the MVP drop-down as soon as he was picked.

## Step 34 — pm-mvp
- URL: /pm-report?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: In MVP picked "Nicole Boyd" (first person), typed "Kept the line moving all lunch." in the box that appeared, tapped "SAVE".
- Saw: "MVP" with the drop-down on "Nicole Boyd"; a text box holding "Kept the line moving all lunch." (its label in the control list is "Why MVP?", no visible label or placeholder on screen); yellow "SAVE".
- Shot: img/manager/34-pm-mvp.png
- Confused: MVP field labels: drop-down "No MVP / Nicole Boyd / Angel Reyes"; the reason box is called "Why MVP?" only in the accessibility name. Again no "Saved" feedback.

## Step 35 — pm-submitted
- URL: /pm-report?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "SUBMIT PM REPORT" (no PIN or confirm asked); scrolled back to the top.
- Saw: green banner "Submitted 3:37 AM by Nicole Boyd"; "SHIFT ACTIVITY" as before; the two grade cards (Nicole Boyd, Angel Reyes) now greyed and read-only with the chosen grades highlighted.
- Shot: img/manager/35-pm-submitted.png
- Confused: After submitting, the MVP block no longer shows on screen.

## Step 36 — cash-deposit
- URL: /cash?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Dashboard → Assignments → "CASH REPORT" (about 10 seconds).
- Saw: "‹ DASHBOARD"; "Cash Deposit"; two columns. Left "CASH": "Projected (from Toast)" box (placeholder "0.00"), toggle buttons "Enter total" (selected, yellow) and "Count by denomination", "Drawer total" box (placeholder "0.00"), "$200 stays in the register", "Over/short note (optional)" box (empty, no placeholder). Right "TIPS": "Cash tips" box (placeholder "0.00"), "ON SHIFT TODAY" tick boxes for Angel Reyes, Dana Brooks, Luis Herrera, Marcus Webb, Nicole Boyd, a "+ Add" button, and "SIGN & SUBMIT DEPOSIT".
- Shot: img/manager/36-cash-deposit.png

## Step 37 — cash-filled
- URL: /cash?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Kept "Enter total". Typed 845.00 in Projected (from Toast), then 1045.00 in Drawer total, 62.00 in Cash tips, ticked Nicole Boyd. Over/short note left empty.
- Saw: after the projected number alone nothing new showed. As soon as both Projected and Drawer total were typed, the line "Deposit $845.00 · Even" appeared under "$200 stays in the register". Boxes show 845.00, 1045.00, 62.00; Nicole Boyd ticked.
- Shot: img/manager/37-cash-filled.png

## Step 38 — cash-pin
- URL: /cash?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "SIGN & SUBMIT DEPOSIT".
- Saw: dimmed page with a white box: badge "ASSISTANT GENERAL MANAGER", "Nicole Boyd", "Enter your 4-digit PIN", four empty dots, keypad 1-9, "Clear", 0, "← Back", "Use system keyboard".
- Shot: img/manager/38-cash-pin.png

## Step 39 — cash-submitted
- URL: /cash?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped 8 four times (this time by its control number).
- Saw: green banner "Deposited $845.00 · signed by Nicole Boyd at 3:39 AM"; read-only rows "Projected (from Toast) $845.00", "Drawer total $1,045.00", "$0.00 over $0.00", "Deposit $845.00 $845.00", "Cash tips $62.00", "On shift today: Nicole Boyd".
- Shot: img/manager/39-cash-submitted.png
- Confused: the row reads "$0.00 over" with value "$0.00", not "Even" as in the live form.

## Step 40 — closing-walk-out
- URL: /operations/closing?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Dashboard → "CONTINUE CLOSING" (the card read "In progress · 4 of 61 items"; the page took about 10 seconds). Ticked all five lines under Walk-Out Verification (Lights off, Devices charging, Oven off, Front doors locked, Back door locked).
- Saw: "✓ WALK-OUT VERIFICATION 5 of 5 done"; each line goes yellow with a tick, a white "UNDO" button, small text "you · 3:40 AM" and a link "Add note". Progress now "11/61". Bottom of the page: a button "REVIEW & SUBMIT (INCOMPLETE)" with "11 of 61 required done", and a floating pill "REVIEW & SUBMIT · 11/61" over the page bottom (it covers part of a line in the photo).
- Shot: img/manager/40-closing-walk-out.png
- Confused: In the photo the last line (Back door locked) falls below the screen edge and the floating pill crosses the bottom of the right column. The Closing Manager lines now show 5 of 7 done (AM Prep List, Opening verified, Mid-day Prep ×1, Cash deposited, PM Report submitted all ticked).

## Step 44 — closing-review
- URL: /operations/closing?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "REVIEW & SUBMIT (INCOMPLETE)". The page opened a panel with a "HIDE REVIEW" button, the heading "REVIEW & SUBMIT", "Some required items aren't done — explain why", "11 of 61 required done", and 50 boxes, each labelled with the line (for example "CRUNCHY BOI STATION · RESTOCK", "WALK INS STATION · WALK-IN FRIDGE TEMP (≤41°F)", "CLOSING MANAGER · COUNT THE DRAWER") and the placeholder "Why couldn't this be completed?". Typed "Sim walk — not done on this test day." in every one of the 50.
- Saw: the last six boxes (Prep Fridge · Sauce Fridge Temp, Shut Down Back Line · Back-Line Drinks Fridge Temp, Expo Station · Deli Display Fridge Temp, Clean Front of House · FOH Drinks Fridge Temp, Prep Area · 3-Door Fridge Temp) filled, and the yellow "CONTINUE" button under them; "REVIEW & SUBMIT · 11/61" floats below. Progress bar "11/61" at the top.
- Shot: img/manager/44-closing-review.png
- Confused: Note fields met: "Why couldn't this be completed?" (50 of them, one per unfinished line), and the "Add note" link on each completed Walk-Out line (not opened). Last box has a yellow focus ring.

## Step 45 — closing-pin
- URL: /operations/closing?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "CONTINUE".
- Saw: dimmed page with a white box "Confirm with your PIN", "Enter your 4-digit PIN to confirm this action.", four empty dots, keypad 1-9, "Clear", 0, button "Cancel", link "Use system keyboard".
- Shot: img/manager/45-closing-pin.png

## Step 46 — closing-confirmed
- URL: /operations/closing?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped 8 four times (using its control number).
- Saw: amber banner with a warning triangle: "Closing submitted with incomplete items · 3:42 AM by you"; the progress stays "11/61"; every line is greyed and disabled (screen-reader labels read "… — instance incomplete_confirmed"). No "Cash deposit required …", hard-gate message, "Just modified by someone else — try again." or "This checklist is already confirmed." appeared.
- Shot: img/manager/46-closing-confirmed.png
- Confused: There is NO reasons list on this page: the "Sim walk — not done on this test day." text typed in the 50 boxes is not shown anywhere after confirming, so the guide/walk line "the reasons list in view" does not match the screen.
- Bug?: The grey lines carry the raw status text "instance incomplete_confirmed" as their accessible name (visible only to screen readers).

## Step 47 — counts
- URL: /operations/counts?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Dashboard → Assignments → "COUNTS" (about 10 seconds to open).
- Saw: "‹ DASHBOARD"; heading "Inventory Audit"; "Run when the owner calls for a full audit. Day to day, the system infers on-hand from deliveries, production, and sales."; left card "NEW AUDIT" with "Count each unit once: full containers, then loose units below. Never count the same stock twice.", an item drop-down "Pick an item…", labels "UNIT" (box placeholder "Unit (e.g. tub)") and "HOW MANY", a tick box "Loose (below a full container)", "Partial" (placeholder "e.g. 0.5"), "+ Add item", "Note" (placeholder "Anything to flag about this audit…"), greyed "RECORD AUDIT". Right "ON HAND" with "Download CSV PDF", "Anchored to the audit on Wed, Oct 14." and cards: 1/2 pint bottoms (flexi) 4.0 oz on hand · VENDORS 2; 1/2 pint top (flexi) 2.0 oz; 2 oz portion cup lids 6.0 oz; Banana Peppers "— 1 vendors unknown"; Capicola with the pill "below zero — count it" and 0.0 oz on hand. Other "below zero — count it" items further down: Hot Peppers, Iceberg, Pepperoni, Provolone (Roast Beef reads 0.0 oz with no pill); Fresh Mozzarella and Ham read "— 1 vendors unknown".
- Shot: img/manager/47-counts.png
- Confused: Counts says "Anchored to the audit on Wed, Oct 14." on a day when no audit has been recorded by this walk (12 SKUs were already anchored on the dashboard card "0 DAYS SINCE LAST COUNT / 12 SKUs anchored" from the start).

## Step 48 — counts-filled
- URL: /operations/counts?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Picked the first three items the drop-down offers ("1/2 pint bottoms (flexi)", "1/2 pint top (flexi)", "2 oz portion cup lids"), adding each line with "+ Add item", and typed How many 4, 2, 6. The Unit box is a plain text box (placeholder "Unit (e.g. tub)"), NOT a list, so there was no "first option" to pick and I left it empty. Each line says "No deliveries recorded here yet" and has "Count by vendor instead" (not tapped except once to test; it empties How many, tapped back) and "Remove".
- Saw: three lines (item drop-down, "No deliveries recorded here yet", "Count by vendor instead ▸", UNIT empty, HOW MANY 4 / 2 / 6, "Loose (below a full container)", "Partial", "Remove"); "+ Add item", "Note", and "RECORD AUDIT" still GREYED.
- Shot: img/manager/48-counts-filled.png
- Confused: The photo shows lines 1 and 2 (4 and 2); line 3 (6) is just below the frame (the lines are taller than the screen). RECORD AUDIT never turned on; the page did not say why (an earlier screen text read "1 unfinished line(s) — they won't be saved" while a blank line was open).

## SKIPPED — 49-counts-password.png
- SKIPPED 49-counts-password.png: "RECORD AUDIT" stayed greyed out with Unit empty, so no "Confirm your password" box could open.

## SKIPPED — 50-counts-recorded.png
- SKIPPED 50-counts-recorded.png: same reason; nothing was recorded.

## BLOCKED — Counts: record the audit (Record audit, password step)
- BLOCKED Counts record: the Unit field is free text (no Unit list) and "RECORD AUDIT" stays disabled with Unit empty; the walk only allows typing the PIN, the password and the data it names, and it names no Unit text, so I did not type a unit (probably the missing piece, for example "each"; not tested). The password `sim-nicole-pw` was never asked for.

## Step 51 — ordering-walk
- URL: /ordering?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Dashboard → Assignments → "ORDERING" (the page took about 12 seconds to open). Ordering is NOT in the Explore chips.
- Saw: "‹ DASHBOARD" and "RECEIVING ›" at the top; "Ordering walk — Wed, Oct 14  MEP · Capitol Hill"; card "TODAY'S ORDERS": Baldor MEP-20261014-BALDOR 1 lines Draft; Boar's Head MEP-20261014-BOARSH 12 lines Draft; PFG MEP-20261014-PFG 5 lines Draft; card "CUTOFF TODAY  2 to draft": Cardinal Bakery Cutoff 3:00 PM and Trimark Cutoff 6:00 PM each with "GENERATE DRAFT" (not tapped); "Order history 7 ▸"; "Par tuning hasn't run at this shop yet."; "Recent walks 8 ▸"; vendor rows below: Baldor 1 SKUs (ORDER DAY, open: Cholula), Amazon 7, Boar's Head 26 (Cutoff 3:00 PM), Continental Tape 1, Leonard Paper 20, Penny Candy 1, PFG 73 (Cutoff 4:00 PM), Sarah 1, Trimark 16 (Cutoff 6:00 PM), US Foods 1, Vistaprint 1, Webstaurant 4; sticky bar "0 SKUs marked" and a greyed "REVIEW ORDER".
- Shot: img/manager/51-ordering-walk.png
- Confused: No red "Missed cutoff — call the vendor" showed (the clock is 3:4x AM). The Baldor vendor row is open at first showing the Cholula line (Par 0.5, "~0.8 Each on hand · par-pass", "last: 1", "ORDER TO PAR (EACH)" − / + , chips "Suggest 0", "Empty · order 1", "We're full · 0", "Clear"). I did not check whether Reports Hub → Inventory → Ordering shows.

## Step 52 — ordering-adjusted
- URL: /ordering?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Duke's Mayo was not in an open list, so used the first line: tapped "+" twice on Cholula (Baldor) and once on Provolone (Boar's Head, first line of that vendor).
- Saw: Baldor "1 marked" with Cholula showing 2 (Par 0.5); Boar's Head "1 marked" with Provolone showing 1 (Par 8; the line reads "PROVOLONE", "piece", "Use exceeds recorded receipts — receiving history incomplete  last: 8"; chips "Suggest 8", "Empty · order 8", "We're full · 0", "Clear"); bar "2 SKUs marked" and a yellow "REVIEW ORDER".
- Shot: img/manager/52-ordering-adjusted.png
- Confused: the page scrolled down so the vendor header rows are cut at the top; the "+" button is not in the photo's top part.

## Step 53 — ordering-review
- URL: /ordering?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "REVIEW ORDER".
- Saw: full-screen panel "Review order" with "Close"; "2 vendor orders · 0 marked full"; card Baldor (SKU / ITEM # / QTY; group BALDOR; Cholula, SAUCE6B, 2 Each); card Boar's Head (group BOAR'S HEAD; Provolone, —, 1 piece); each card ends "Delivery options (email, portal, phone) appear once you submit."; bottom buttons "Keep walking" and yellow "RECORD WALK · 2 SKUS".
- Shot: img/manager/53-ordering-review.png

## Step 54 — ordering-draft
- URL: /ordering?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "RECORD WALK · 2 SKUS". Did not tap Confirm, Send, Copy or Mark placed.
- Saw: green boxes "Walk recorded — 2 SKUs.", then links "Baldor: added to today's draft — PO MEP-20261014-BALDOR" and "Boar's Head: added to today's draft — PO MEP-20261014-BOARSH"; heading "DRAFT ORDERS" with NOTHING listed under it; yellow "START A NEW WALK". Today's orders still show Baldor 1 lines Draft, Boar's Head 12 lines Draft, PFG 5 lines Draft.
- Shot: img/manager/54-ordering-draft.png
- Confused: The "Draft orders" list under its heading is empty; the drafts are reached through the green links. The line counts did not change (Baldor 1 lines, Boar's Head 12 lines) after adding Cholula and Provolone.

## Step 55 — production
- URL: /operations/production?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Dashboard → Explore → "Production" (it is in the Explore chips; no goto).
- Saw: "‹ DASHBOARD"; "Production"; link "YIELD VARIANCE →"; card "LOG A CONVERSION": "Raw item (SKU)" drop-down "Pick a SKU…" (each option reads "<name> (N in stock)", e.g. "Cheddar (-1 in stock)", "Cholula (1 in stock)", many duplicates such as two "1/2 pint bottoms (flexi) (0 in stock)"), "Amount used (packs)", "Amount made", "Notes" (empty, no placeholder), greyed "LOG PRODUCTION"; below "RECENT PRODUCTION" with earlier rows already there (the mid-day/opening prep made today, e.g. "0 Hot Peppers → 12 Hot Peppers  Wed, Oct 14"). No shop name shown on the page (URL carries the Capitol Hill id).
- Shot: img/manager/55-production.png
- Confused: There is no "Makes" drop-down until a raw SKU is picked; then "Makes" appears with the single option "Cheddar".

## Step 56 — production-filled
- URL: /operations/production?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Picked "Cheddar (-1 in stock)" in Raw item (SKU); "Makes" appeared, picked "Cheddar"; Amount used (packs) 1; Amount made 4.
- Saw: "Raw item (SKU) Cheddar (−1 in stock)"; "Makes — Cheddar"; "Amount used (packs) 1"; "Amount made · Predicted output: 4" with 4 (yellow focus ring and spinner arrows); "Notes" empty; yellow "LOG PRODUCTION" enabled.
- Shot: img/manager/56-production-filled.png

## Step 57 — production-logged
- URL: /operations/production?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "LOG PRODUCTION"; scrolled to bring "Recent production" into view.
- Saw: form cleared (LOG PRODUCTION greyed again); under "RECENT PRODUCTION" the new row "1 Cheddar → 4 Cheddar  Wed, Oct 14" is first, then "0 Hot Peppers → 12 Hot Peppers", "0 Sweet Peppers → 10 Sweet Peppers", "0 Pickle slices → 16 Pickles", "0 Balsamic Vin, Olive Oil → 4 Vin", ...
- Shot: img/manager/57-production-logged.png

## Step 58 — reports-hub
- URL: /reports?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Dashboard → Explore → "Reports Hub" (about 10 seconds); scrolled a little so the date range, the shop card and the report families are all in view.
- Saw: "Reports"; shop pill "Capitol Hill"; "Date range" drop-down "Last 7 days" (options Today, Yesterday, Last 7 days, Last 30 days, This month, Last month, Custom), "From 10/08/2026", "To 10/14/2026", tick box "Compare with previous period", "Apply", "Up to 92 inclusive days. Comparison applies to summary counts and trends."; shop card "Capitol Hill / Last close · Wed, Oct 14" with Opening Done, AM Prep Done, Mid-Day Prep Done, Closing Done, Cash Done, PM Report Done; counters "Reports: 9", "Under par: 0", "Over par: 0", "Skipped: 50", "Not started: 0", "Temperature flags: 0", "Cash over: 0", "Cash short: 0"; families: "Operations" (Operations, Operations trends), "Written reports", "People" (My feedback, Team trends), "Inventory" (Counts and variance, Receiving, Ordering), "Catering", "Menu costing".
- Shot: img/manager/58-reports-hub.png
- Confused: NO "Sales" family shows, as the walk expected. Reports Hub → Inventory DOES show Counts and variance, Receiving and Ordering for Nicole. The hub says "Temperature flags: 0" while the Trends page (step 60) says "Fridge Temp Flags 8".

## Step 59 — reports-opening
- URL: /reports/opening/9ba4ab10-f43c-47c7-9eb9-191ce112c5af?range=last7&from=2026-10-08&to=2026-10-14&compare=false&location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "Operations" (the first chip), then the row "Wed, Oct 14 Opening By: Nicole Boyd Status: Prep done". Did not tap CSV or PDF.
- Saw: the Operations list page first showed "Operations", "VIEW TRENDS", the date range, a SEARCH/FROM/TO/TYPE filter (All types, Opening, Closing, AM Prep, Mid-Day Prep, Cash, PM Report, Maintenance, "APPLY"), "SIGNAL FILTERS" (Under par, Over par, Skipped items, Not started, Temp out of range, Cash over, Cash short), "Download CSV PDF", rows Opening "Prep done", Closing "Confirmed (incomplete)", AM Prep "Confirmed", Mid-Day Prep "Prep done", Cash "Submitted", PM Report. The report page: "‹ OPERATIONS", "DASHBOARD", "Same day" links (Closing, AM Prep, Mid-Day Prep, Cash, PM Report, Maintenance), "Previous day", "Next day"; "Opening / Wed, Oct 14" with the pill "Prep done"; a yellow box "RECOUNT — NO PRIOR-DAY SUBMISSION — No prior-day AM-Prep submission to verify against — the opener recounted to establish the counts. Reason: missed or unknown."; "82/82 done · 0 skipped"; then station sections each line with a green tick, "Nicole Boyd", and temps like "Temp 36°".
- Shot: img/manager/59-reports-opening.png
- Confused: "82/82 done" while the Opening page itself said 44 of 44 verified (44 items + 38 prep entries = 82).

## Step 60 — trends
- URL: /reports/trends?location=54ce1029-400e-4a92-9c2b-0ccb3b031f0a
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Back to Dashboard → Explore → "Trends".
- Saw: shop pill "Capitol Hill"; "Trends"; three cards "Ops Trends — Par · temps · cash · completion over time", "Team — Operating health (managers)", "Yield — Batches vs the recipe card" each with "TAP FOR THE FULL VIEW →"; "RELEVANT RIGHT NOW": amber dot "Team — 1 on track · 3 need a check-in: Angel Reyes, Nicole Boyd, Marcus Webb." and "Fridge Temp Flags 8"; "OPS SNAPSHOT / VIEW OPS TRENDS": "UNDER / OVER PAR 0", "FRIDGE TEMP FLAGS 8"; "TEAM SNAPSHOT / VIEW TEAM": "ON TRACK 1", "NEEDS ATTENTION 3".
- Shot: img/manager/60-trends.png
- Bug?: "Fridge Temp Flags 8" here, but the Pulse "Food safety" said "All fridges checked and in range. 8 in range · 0 out of range" and the Reports Hub says "Temperature flags: 0". All eight fridge temps typed today were 35-38 (all under 41).

## Step 61 — admin-home
- URL: /admin
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Back to Dashboard → Explore → "Admin". Looked only; opened nothing.
- Saw: "‹ DASHBOARD"; "Admin"; "Manage your business configuration."; card "USED THIS WEEK": Checklists confirmed 10, Counts recorded 7, Receiving logged 11, Prep submitted 283, Reports written 9, Photos uploaded 0 (grey), Production recorded 801, Catering quotes 15; tiles: "Vendors", "SKUs" (red tag "211 not ready"), "Products", "Recipes" ("115 not ready"), "Items" ("38 not ready"), "Menu Costing", "Weights & Trim", "Catering".
- Shot: img/manager/61-admin-home.png
- Confused: No "Customers" tile is listed (and no "Catering accounts" tile; "Catering" only). The user button is placed at the top right with less room than other pages (the page has a narrower top margin). "Counts recorded 7" although this walk recorded no count.

## Step 62 — logged-out
- URL: /
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Dashboard → scrolled down → "LOG OUT" (no confirm box).
- Saw: "Where are you?" with the "Manager login →" link and two tiles "MEP Capitol Hill" and "EM P Street".
- Shot: img/manager/62-logged-out.png

## Log notes
- Walker slips: (1) the first PIN try pressed "7" four times because `tap 8` takes a control number, not a label (see step 05); (2) the Receiving page's "Take or assign tasks" path and others open slowly (8-12 s), so I waited before each `look`.
- Photo 05 (PIN keypad): the keypad sits low on the page so "← Back" and "Use system keyboard" fall below the photo's bottom edge.
- Dashboard "My station" (step 07 expanded) offers "START BREAK"/"END MY SHIFT" buttons: not tapped.
