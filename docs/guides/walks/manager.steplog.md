# Manager walk — step log (Nicole Boyd, 2026-10-13)

## Step 01 — where-are-you
- URL: /
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Opened the app (fresh session).
- Saw: Header "OPERATIONS", button "Manager login →" (top right), heading "Where are you?", two tiles: "MEP Capitol Hill" and "EM P Street".
- Shot: img/manager/01-where-are-you.png

## Step 02 — manager-login-form
- URL: /
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "Manager login →". Did not type.
- Saw: Button "Use tile login →"; heading "Manager login"; "Email + password for AGM and above."; fields EMAIL (placeholder "you@complimentsonlysubs.com") and PASSWORD (placeholder "password"); button "SIGN IN"; link "Forgot password?"; hint "Reset links go to manager email accounts. If you sign in with a PIN, ask a manager to reset it."
- Shot: img/manager/02-manager-login-form.png

## Step 03 — whats-your-role
- URL: /
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "Use tile login →", then the Capitol Hill tile.
- Saw: Heading "What's your role?"; "MEP · CAPITOL HILL"; tiles GM General Manager, AGM Assistant General Manager, CTR Catering Manager, SL Shift Lead, KH Key Holder, TR Trainer, EMP Employee, TRN Trainee; button "← Back".
- Shot: img/manager/03-whats-your-role.png

## Step 04 — who-are-you
- URL: /
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped the "AGM Assistant General Manager" tile.
- Saw: Heading "Who are you?"; "MEP · CAPITOL HILL · ASSISTANT GENERAL MANAGER"; one tile "NB Nicole Boyd"; button "← Back".
- Shot: img/manager/04-who-are-you.png

## Step 05 — pin-keypad
- URL: /
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "Nicole Boyd".
- Saw: Heading "ASSISTANT GENERAL MANAGER / Nicole Boyd"; "Enter your 4-digit PIN"; keypad 1-9, "Clear", 0, "←"; buttons "Back" and "Use system keyboard".
- Shot: img/manager/05-pin-keypad.png

## Step 06 — dashboard
- URL: /dashboard
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Signed in with 8888 (4th digit signs in; first look showed "Loading…", waited and looked again before photographing). Top of dashboard.
- Saw: Initial "N" user-menu button, "COMPLIMENTS ONLY / OPERATIONS", heading "DASHBOARD", "Hi, Nicole Boyd.". EXPLORE chips (14): Mid-Shift Pulse, Reports Hub, Assignments, Trends, LTO, Written Reports, Catering, Maintenance, Training, Recipes, Profile, Settings, My Performance, Admin. Role badge "ASSISTANT GENERAL MANAGER"; shop chip "MEP · CAPITOL HILL". "My shift" board: "Take or assign tasks 0 of 8 assigned ▾" with lines "UNASSIGNED: AM PREP · ASSIGN OR TAKE IT", "UNASSIGNED: MID-DAY PREP · ASSIGN OR TAKE IT", "UNASSIGNED: CASH REPORT · ASSIGN OR TAKE IT", "UNASSIGNED: OPENING PREP · ASSIGN OR TAKE IT", "UNASSIGNED: RECEIVING · ASSIGN OR TAKE IT", "UNASSIGNED: COUNTS · ASSIGN OR TAKE IT", "UNASSIGNED: ORDERING · ASSIGN OR TAKE IT", "UNASSIGNED: PM REPORT · ASSIGN OR TAKE IT"; "Take or assign stations 0 of 1 assigned ▾"; "On shift · Active in CO-OPS" with buttons "START BREAK" and "END MY SHIFT"; station drop-down ("No station" default; 12 stations each shown as "<Name> · <label> · fill first" e.g. "Crunchy Boi Station · Crunchy Boi Station · fill first") and button "CLAIM / CHANGE STATION"; "Tasks: No assigned tasks today."; "Team today 0 of 5 assigned ▸"; link "ASSIGNMENTS". "TODAY'S OPERATIONS" card: "MEP · Capitol Hill", "Tue, Oct 13", "CLOSING CHECKLIST", "Not started", button "START CLOSING". No Reports section shows. Bottom: "LOG OUT".
- Shot: img/manager/06-dashboard.png

## Step 07 — dashboard-full
- URL: /dashboard
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Full-page photo of the dashboard.
- Saw: Same screen as step 06, full page: Explore, My shift board, station picker, Team today, Today's operations card (CLOSING CHECKLIST / Not started / START CLOSING), LOG OUT.
- Shot: img/manager/07-dashboard-full.png

## Step 08 — board-tasks
- URL: /assignments?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Dashboard → Explore → Assignments (waited out a "Loading…" screen first). Collapsed "Take or assign stations" so the tasks list is in view.
- Saw: Heading "Assignments", "Tue, Oct 13", chip "Capitol Hill", card "Today's team" with "STATIONS" and "Active staff at this shop. Stations and tasks show today's assignments."; collapsible "Take or assign stations / 0 of 12 assigned"; open "Take or assign tasks / 0 of 8 assigned" with hint "Open an unassigned task to do it. Your submission records you as the doer; to assign it to yourself, ask another key holder." Task tiles: "CLOSING CHECKLIST — Everyone on shift · no assignment needed", then "AM PREP", "MID-DAY PREP", "CASH REPORT", "OPENING PREP", "RECEIVING", "COUNTS", "ORDERING", "PM REPORT" each "Unassigned". Below: collapsibles "Unassigned / 8 unassigned" and "Who has what / 0 of 5 assigned".
- Shot: img/manager/08-board-tasks.png

## Step 09 — board-stations
- URL: /assignments?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Reopened "Take or assign stations" and looked at the stations list.
- Saw: "Take or assign stations / 0 of 12 assigned ▾", then station groups each "<Group> · 0 of N": Crunchy Boi Station 0 of 1, 3rd Party Station 0 of 1, Walk Ins Station 0 of 2 (Walk-ins "Dedicated to walk-in orders; helps with online orders when there are no subs to make"; Walk-ins / Online "Half walk-ins, half online orders; leans toward walk-ins"), Prep Fridge 0 of 1, Shut Down Back Line 0 of 1, Expo Station 0 of 2 (Expeditor "Expedites the orders"; Register & Delivery "Runs the cash register and hands out delivery orders"), Clean front of house 0 of 1, Prep Area 0 of 1, Closing Manager 0 of 1, Walk-Out Verification 0 of 1. Each station row reads "<Station> · Unassigned", then "Unassigned", a "Person" drop-down (options: Person, Angel Reyes, Luis Herrera, Nicole Boyd) and a yellow "SET STATION" button.
- Shot: img/manager/09-board-stations.png

## Step 10 — assign-task
- URL: /assignments?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Opened "Who has what" (the only place an "Assign task" button exists). Did NOT tap ASSIGN TASK: it has no picker, it assigns the chosen task to that person at once.
- Saw: Under "Who has what / 0 of 5 assigned", "Here now (1)": "Nicole Boyd · On shift · Active in CO-OPS". One card per person (Angel Reyes, Dana Brooks, Luis Herrera, Marcus Webb, Nicole Boyd). Angel Reyes card: "START BREAK", "No station", "Station" drop-down ("No station", then the 12 stations) + "SET STATION", "Tasks / No assigned tasks today.", then "Task" drop-down (AM prep, Mid-day prep, Cash report, Opening prep, Receiving, Counts, Ordering, PM report; default "AM prep"), text box "Note (optional)" (empty, no other placeholder text) and a yellow "ASSIGN TASK" button. Luis Herrera's Task drop-down offers only AM prep, Mid-day prep, Opening prep. Dana Brooks and Marcus Webb show "No station / Tasks / No assigned tasks today." with no controls.
- Shot: img/manager/10-assign-task.png
- Confused: The walk script expects an "Assign task" button on a task in the task list that opens a picker; there is none there. The button lives per person in "Who has what" and has no confirm step, so the picker was not opened and nobody was assigned.

## Step 11 — opening-verify
- URL: /operations/opening?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: On the board tapped "OPENING PREP" (from the Unassigned list). Opening Report opened.
- Saw: Header "COMPLIMENTS ONLY / OPERATIONS", link "‹ DASHBOARD", "OPENING REPORT", heading "Phase 1 — Verification", subtitle "Verify last night's closing matches reality. Tap each station once you've checked it; add a comment if anything looks off.", tabs "PHASE 1 · VERIFY" and "PHASE 2 (LOCKED)". Two-column station cards, each with a "VERIFIED" button and "0 of N done": CRUNCHY BOI STATION 0 of 4 (open: "Station appears clean as reported", "Crunchy Boi Fridge temp (≤41°F)" with a temperature box showing "—", "Sauces topped off & dated correctly", "Station ready for service (containers placed, prep ready)", each with "ADD COMMENT"), 3RD PARTY STATION 0 of 4, WALK INS STATION 0 of 4, PREP FRIDGE 0 of 4, PREP AREA 0 of 6, BACK LINE OPEN 0 of 5, EXPO STATION 0 of 4, FRONT OF HOUSE OPEN 0 of 5, MANAGER OPEN 0 of 3, WALK-OUT VERIFICATION 0 of 5. Prep sections each with "VERIFY SECTION" and "Recount items without closer data first": VEG 0 of 6, COOKS 0 of 6, SIDES 0 of 6, SAUCES 0 of 11, SLICING 0 of 9. Sticky footer: "0 of 44 verified · 0 of 8 temp readings entered", "44 items not yet verified", link "SHOW ME WHAT NEEDS FIXING", button "SUBMIT OPENING" (greyed). "ADD COMMENT" opens a comment box (not opened yet).
- Shot: img/manager/11-opening-verify.png
- Confused: Phase 2 tab is greyed "(LOCKED)" until Submit Opening.

## Step 12 — opening-station-verified
- URL: /operations/opening?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "VERIFIED" on CRUNCHY BOI STATION.
- Saw: Card now reads "CRUNCHY BOI STATION / 3 of 4 done" with "✓ VERIFIED"; the three non-temperature lines show ✓; all four lines now show a tick, including "Crunchy Boi Fridge temp (≤41°F)", whose box still shows "—".
- Shot: img/manager/12-opening-station-verified.png
- Confused: Verified did not tick the temperature line (3 of 4 done): the temp box needs its own number.

## Step 13 — opening-section-verify
- URL: /operations/opening?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Opened VEG. "VERIFY SECTION" was greyed ("Recount items without closer data first") and no row showed a "Closer count", so typed 2 in "OPENER RECOUNT" for each of the six rows (Iceberg, Onion, Basil, Radish, Cucumber, Tomato), then tapped "VERIFY SECTION".
- Saw: VEG card now "✓ VEG / 6 of 6 done" with the button "✓ VERIFIED". Each row shows the item name, "ADD COMMENT", and a pink box "OPENER RECOUNT [2] —". Footer unchanged: "4 of 44 verified · 0 of 8 temp readings entered", "40 items not yet verified", "Saved a moment ago". A pink box "NO PRIOR CLOSING DATA DETECTED / 6 item(s) had no closing count from last night — morning recounts were entered. Confirm the reason:" appears at the bottom of the page.
- Shot: img/manager/13-opening-section-verify.png
- Confused: Footer still said "4 of 44 verified" after Veg showed 6 of 6 done (did not change on look after a pause). The recount boxes are red/pink even though a number is typed.

## Step 14 — opening-ready
- URL: /operations/opening?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Finished Phase 1 with no more shots: tapped "VERIFIED" on every other station; typed temps 36, 37, 38, 35, 36, 37, 38, 36 into the eight fridge boxes (Crunchy Boi Fridge, 3rd-Party Fridge, Walk-In Fridge, Sauce Fridge, 3-Door Fridge, Back-Line Drinks Fridge, Deli Display Fridge, FOH Drinks Fridge — each "temp (≤41°F)"); typed 2 in "OPENER RECOUNT" for every row of COOKS, SIDES, SAUCES, SLICING (no row showed a "Closer count") and tapped "VERIFY SECTION" on each; picked "Closing was missed / I don't know". Scrolled to the bottom.
- Saw: Pink box "NO PRIOR CLOSING DATA DETECTED / 38 item(s) had no closing count from last night — morning recounts were entered. Confirm the reason:" with two radio options "Location was closed (planned)" and "Closing was missed / I don't know" (selected), and under it "Attestation: Closing was missed / I don't know". Sticky footer: "44 of 44 verified · 8 of 8 temp readings entered", "Submit ready", "Saved a moment ago", button "SUBMIT OPENING" (now bright yellow). The VEG recount boxes were typed before the box appeared; every OPENER RECOUNT box is pink/red with a typed 2. Other comment buttons: each line has "ADD COMMENT" (not opened).
- Shot: img/manager/14-opening-ready.png
- Confused: The "6 item(s)" count in the pink box grew to "38 item(s)" as more sections were recounted (the six Veg rows plus the other 32).

## Step 15 — opening-submitted
- URL: /operations/opening?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "SUBMIT OPENING". The tab "PHASE 2 — PREP ENTRY" became available and opened.
- Saw: Tabs "PHASE 1 · VERIFY" and "PHASE 2 — PREP ENTRY" (selected). Link "SHOW ME WHAT NEEDS FIXING". Prep sections VEG, COOKS, SIDES, SAUCES, SLICING; VEG open, "0 of 6 done", greyed "✓ VERIFIED" with "Recount items without closer data first". First row "Iceberg — Par: 7 1/3 Pan", box "CLOSER COUNT: 2 1/3 Pan", "PREP NEED: 5 1/3 Pan", empty box "OPENER PREPPED", and a bar "Uses: 0 Iceberg · ~0 oz — tap to confirm usage". Sticky footer: "44 of 44 verified · 8 of 8 temp readings entered · 0 of 38 prep entries", "38 prep items not yet saved", button "FINALIZE PHASE 2 (38 OUTSTANDING)" (greyed).
- Shot: img/manager/15-opening-submitted.png
- Confused: The page heading still reads "Phase 1 — Verification" and the Phase 1 subtitle while the Phase 2 tab is open. The "Closer count" in Phase 2 is the recount I typed in Phase 1 (2), shown in pan/quart units (e.g. "2 1/3 Pan"), not the raw "2".
- Bug?: Heading/subtitle do not change to Phase 2 when the Phase 2 tab is open.

## Step 16 — opening-prep-entry
- URL: /operations/opening?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Scrolled down on Phase 2 — Prep Entry (nothing typed yet).
- Saw: Rows (VEG): "Onion — Par: 8 Quart; CLOSER COUNT: 2 Quart; PREP NEED: 6 Quart; OPENER PREPPED [empty box]; Uses: 0 Onion (red) · ~0 oz — tap to confirm usage; Not saved", "Basil — Par: 4 Quart; CLOSER COUNT: 2 Quart; PREP NEED: 2 Quart", "Radish — Par: 1 Quart; CLOSER COUNT: 2 Quart; PREP NEED: 0 Quart". Footer "44 of 44 verified · 8 of 8 temp readings entered · 0 of 38 prep entries", "38 prep items not yet saved", "FINALIZE PHASE 2 (38 OUTSTANDING)". Each row ends with "Not saved" until typed. The "Radish" row's usage bar names "Watermelon Radish".
- Shot: img/manager/16-opening-prep-entry.png

## Step 17 — opening-prep-filled
- URL: /operations/opening?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Typed the PREP NEED number in OPENER PREPPED for Iceberg (5), Onion (6) and Basil (2); each saved when the cursor left the box.
- Saw: Each filled row shows its number in the "OPENER PREPPED" box, a green "At par" line, "Saved by Nicole Boyd at 1:29 PM" (Basil 1:30 PM) and a button "UNDO". The "Uses: … · ~N oz — tap to confirm usage" bar updates (Onion "Uses: 0 Onion (red) · ~2 oz", Basil "Uses: 0.03 Basil · ~1 oz"). Footer: "44 of 44 verified · 8 of 8 temp readings entered · 3 of 38 prep entries", "35 prep items not yet saved", "FINALIZE PHASE 2 (35 OUTSTANDING)".
- Shot: img/manager/17-opening-prep-filled.png
- Confused: Prep need on Iceberg reads "5 1/3 Pan" where the unit is "1/3 Pan": the number to type is 5. I first typed 5.33 and the row said "Above prep need by 0.33000000000000007 — tap to record reason" (a long unrounded number on screen). A row saves only after the cursor leaves its box, so the last typed row shows "Not saved" until you tap elsewhere.
- Bug?: Unrounded number in "Above prep need by 0.33000000000000007 — tap to record reason".

## Step 18 — opening-finalize
- URL: /operations/opening?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Typed the PREP NEED number into OPENER PREPPED on all 38 rows (VEG 6, COOKS 6, SIDES 6, SAUCES 11, SLICING 9; each saved once focus left the box), then tapped "FINALIZE PHASE 2".
- Saw: All sections show a green ✓ and full counts (VEG 6 of 6 done, COOKS 6 of 6, SIDES 6 of 6, SAUCES 11 of 11, SLICING 9 of 9), each with a greyed "✓ VERIFIED" and "Recount items without closer data first". Footer: "44 of 44 verified · 8 of 8 temp readings entered · 38 of 38 prep entries", "Phase 2 already finalized", greyed button "PHASE 2 FINALIZED". Before finalizing the button read "FINALIZE PHASE 2 (35 OUTSTANDING)" and later plain "FINALIZE PHASE 2".
- Shot: img/manager/18-opening-finalize.png
- Confused: Two rows have no Par and show "Prep need: verify section first" instead of a number: Tomato (VEG) and Caesar Dressing (SAUCES) — I typed 0 in both. Prep-need units: Iceberg "5 1/3 Pan", Turkey "3 1/3 Pan", Roast Beef "0 1/3 Pan" (unit is "1/3 Pan", number is the first one); I typed 5, 3, 0. Tuna Salad "13", Egg Salad "10", Chix Salad "10", Antipasto Pasta "10" have no unit. No reason box appeared on any prep row except the "Above prep need" prompt I triggered once with 5.33.

## Step 19 — receiving
- URL: /operations/receiving?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: On the board tapped "RECEIVING".
- Saw: Top: link "‹ DASHBOARD", breadcrumb "ORDERING ›", heading "Receiving". Step "1 COUNT THE DELIVERY": drop-down "Vendor" ("Pick a vendor…", Amazon, Baldor, Berger, Boar's Head, Cardinal Bakery, Continental Tape, Costco, Country Snacks, Cristian, District Bakery, Leonard Paper, Penny Candy, PFG, Sarah, Saval, Sysco, Thompson Delivers, Trimark, US Foods, Vistaprint, Webstaurant, "+ New store"); fields "Delivery date" (2026-10-13), "Invoice #", "Invoice total ($)"; hint "Pick a vendor to load its usual order." Step "2 RECEIPT PHOTO": "Snap the invoice or packing slip. It settles any credit later.", buttons "Take receipt photo" and checkbox "Photo later", field "Notes". Step "3 DELIVERY CONFIRMED" with greyed buttons "DELIVERY CONFIRMED" and "SAVE PARTIAL — TRUCK STILL UNLOADING". "RECENT DELIVERIES" with links "Download CSV" and "PDF"; "No deliveries logged yet."
- Shot: img/manager/19-receiving.png

## Step 20 — receiving-vendor
- URL: /operations/receiving?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Chose "Baldor" in Vendor. Also tried Berger, Boar's Head, Cardinal Bakery, District Bakery, PFG, Saval, Sysco, Thompson Delivers, Trimark, US Foods, Whisked, Costco: none shows an expected order / purchase order for today.
- Saw: "Saved on device 1:33 PM" chip on "1 COUNT THE DELIVERY". Vendor "Baldor", Delivery date 10/13/2026, "Invoice #" (placeholder "From the paperwork"), "Invoice total ($)" (empty), buttons "Scan" and chip "Scanner ready", button "Prices from the invoice", one usual-order line "Cholula — Tap to count (units)" with a dashed count box "—", then a "Pick a SKU…" drop-down (Cholula, Cannoli Shell, Fresh Mozzarella, Ham, Lettuce, Onions, Salami, White Cheddar) and "+ Add item" (greyed until a SKU is picked). Other vendors: PFG loads about 40 usual-order lines (Duke's Mayo, Iceberg, Ham, Tomatoes Crushed (10#), Chicken Breast, ...); Boar's Head loads Provolone, Genoa, Turkey, Capicola...; US Foods loads "Dried Chives"; Berger, Cardinal Bakery, District Bakery, Saval, Sysco, Thompson Delivers, Trimark, Whisked, Costco load one blank "New item — Added — not on the usual order" line.
- Shot: img/manager/20-receiving-vendor.png
- Confused: Nothing says which vendors are produce; Baldor was picked as the produce vendor but only has one usual-order line.

## Step 21 — receiving-didnt-arrive
- URL: /operations/receiving?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: No vendor had an expected order, so the "Some expected items were never confirmed" list and "Didn't arrive" button never appeared. Fallback per script: typed 2 on "Cholula" (collapsed row now reads "2 × units"), picked Lettuce in "Pick a SKU…" and tapped "+ Add item", typed 3 in "Qty (units)" and tapped "Short" under "FLAG A PROBLEM".
- Saw: Row "Cholula / 2 × units" (dashed count box "—"). Row "Lettuce / Added — not on the usual order" with "QTY (UNITS)" [−] 3 [+], italic "No pack chain — enter quantity in packs.", "FLAG A PROBLEM" buttons "Short" (now red, selected), "Over", "Damaged", "Sub", then "PRICE/PACK ($)" and "OZ/EACH (OPT)" boxes, then "Line note (optional)" box, "Add photo" and "Remove". Bottom bar: "3 DELIVERY CONFIRMED" (greyed) and "SAVE PARTIAL — TRUCK STILL UNLOADING".
- Shot: img/manager/21-receiving-didnt-arrive.png
- Confused: No purchase order exists for any vendor today, so the "Didn't arrive" / "… short(s) will be claimed on this delivery." text cannot be photographed. Facts.md says shorts can only be claimed against a purchase order.

## Step 22 — receiving-confirmed
- URL: /operations/receiving?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Typed "SIM-1001" in "Invoice #" and "120.00" in "Invoice total ($)", ticked "Photo later" (the only way to enable the button without a camera photo; "DELIVERY CONFIRMED" stayed greyed until both an invoice # and the photo choice were set), then tapped "DELIVERY CONFIRMED".
- Saw: The form reset to "Pick a vendor…" / "Pick a vendor to load its usual order.". New card on the right: "Open vendor credits — 1 open ▸". "RECENT DELIVERIES" with "Download CSV / PDF" and a card "Baldor — 2026-10-13", yellow chip "PHOTO MISSING", "2 item(s) · #SIM-1001 · Nicole Boyd". Further down: "2 RECEIPT PHOTO — Snap the invoice or packing slip. It settles any credit later." [Take receipt photo] [ ] Photo later; "Notes" box with placeholder "Anything to flag about this delivery…"; the "Invoice #" placeholder is "From the paperwork".
- Shot: img/manager/22-receiving-confirmed.png
- Confused: Reports Hub → Inventory → Receiving not checked yet (see Reports Hub step).

## Step 23 — midday-start
- URL: /operations/mid-day?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: On the board tapped "MID-DAY PREP" (it showed "No mid-day preps started today." with "+ NEW MID-DAY PREP"), then tapped "+ NEW MID-DAY PREP".
- Saw: Header link "‹ DASHBOARD", "MID-DAY PREP", heading "Phase 1 — count to par". Sections "VEG 0 of 6 done ▾" (open), "SAUCES 0 of 10 done ▸", "COOKS 0 of 1 done ▸". VEG rows, each with an empty number box whose placeholder is "On hand": Pickles "PAR 20 QUART", Sweet Peppers "PAR 12 QUART", Hot Peppers "PAR 12 QUART", Basil "PAR 4 QUART", Shredded Mozzarella "PAR 5 QUART", Fresh Mozzarella "PAR 12 QUART". Button "SUBMIT COUNT → PHASE 2".
- Shot: img/manager/23-midday-start.png
- Confused: The script says the form shows "Bulk backup" boxes: there is NO "Bulk backup" label or box anywhere (VEG, SAUCES and COOKS all show only "On hand"). The URL changed to /operations/mid-day?instance=<id> as soon as the first number was typed.

## Step 24 — midday-filled
- URL: /operations/mid-day?instance=<id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Typed 4 in Pickles "On hand" and 2 in Sweet Peppers "On hand". Did not tap "SUBMIT COUNT → PHASE 2".
- Saw: VEG "2 of 6 done". Pickles "PAR 20 QUART · NEED: 16" with 4; Sweet Peppers "PAR 12 QUART · NEED: 10" with 2; the other four rows still show the "On hand" placeholder. No limit message appeared. SAUCES (10 rows: PAR 15, 4, 4, 4, 4, 1, 3, 6, "PAR — BOTTLE", 1 BOTTLE) and COOKS (1 row: PAR 15 PIECE) also use "On hand" only.
- Shot: img/manager/24-midday-filled.png
- Confused: One sauce row shows "PAR — BOTTLE" (no par number).

## Step 25 — pulse
- URL: /mid-shift?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Dashboard → Explore → "Mid-Shift Pulse".
- Saw: Link "‹ DASHBOARD", heading "Mid-shift Pulse" with "MEP · Capitol Hill" and "Updated 1:38 PM", small lines "Refreshes every 60 s" (in the text), card "Needs attention · as of 1:38 PM" with "See more", red tag "NEEDS ACTION", eight lines each with an "ASSIGN" button: "3rd Party Station is uncovered", "Expo Station is uncovered", "Crunchy Boi Station is uncovered", "Prep Area is uncovered", "Closing Manager is uncovered", "Clean front of house is uncovered", "Prep Fridge is uncovered", "Walk-Out Verification is uncovered", then "+2".
- Shot: img/manager/25-pulse.png

## Step 26 — pulse-full
- URL: /mid-shift?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Full-page photo of the Pulse.
- Saw: Cards in order: "Needs attention"; "Live shop floor" ("Tap a station for details.", button "MAP VIEW", a 3D floor map with red station tiles, legend "Green covered · amber short, closing soon or past its close time · red uncovered · grey closed"); "People" ("Here now (1)", "0 stations covered · 10 open", "Nicole Boyd — No station · Active in CO-OPS"); "Stations & tasks" ("0 covered · 0 short · 0 closing soon · 0 to close now · 10 uncovered · 0 closed", "Tasks: 1 done · 1 left", rows Crunchy Boi Station, 3rd Party Station, Walk Ins Station, Prep Fridge, Shut Down Back Line, Expo Station each "UNCOVERED"); "Catering" ("DUE TODAY / No catering due today.", "Tomorrow: no catering booked", "Prep: AM Not started · mid-day In progress", "NOT RUNG INTO TOAST / Every ezCater order is in Toast."); "Inventory" ("No par walk recorded yet.", "RUNNING LOW VS PAR / No data yet", "ORDER CUTOFFS TODAY": Boar's Head · 3:00 PM · no draft yet, Cardinal Bakery · 3:00 PM · no draft yet, Trimark · 6:00 PM · no draft yet); "Food safety" ("All fridges checked and in range.", "8 in range · 0 out of range · 0 unchecked", fridge chips Walk-In Fridge 38°F, 3-Door Fridge 36°F, Sauce Fridge 35°F, Deli Display Fridge 38°F, Crunchy Boi Fridge 36°F, FOH Drinks Fridge 36°F, Back-Line Drinks Fridge 37°F, 3rd-Party Fridge 37°F); "Handoff" ("Reports: 1 done · 4 left", chips OPENING, AM PREP, MID-DAY PREP, CASH DEPOSIT, CLOSING, "No handoff notes for today."). Every card except Needs attention/Live shop floor has a "See more" link.
- Shot: img/manager/26-pulse-full.png
- Confused: There is NO Sales card and no "Not available for your role." text anywhere on the page; the Handoff card has no "Write a handoff note" button (only "See more"). The 3D map in "Live shop floor" looks jumbled in the photo (overlapping labels, red blobs, big grey wedge).
- Bug?: Live shop floor map renders messily in the headless photo: labels overlap.

## Step 27 — pulse-section
- URL: /mid-shift?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: On the Pulse tapped "See more" on the People card.
- Saw: Link "‹ PULSE", heading "People", "as of 1:40 PM", "Here now (1)", "0 stations covered · 10 open", "Nicole Boyd — No station · Active in CO-OPS", heading "TIMELINE" with "Nothing to show yet.", link "Stations".
- Shot: img/manager/27-pulse-section.png
- Confused: The Pulse has no section called "Sales" at all (see step 26).

## Step 28 — handoff-write
- URL: /mid-shift/handoff?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: On the Pulse tapped "See more" on the Handoff card (the page already shows the write form; there is no separate "Write a handoff note" button, it is a heading). Typed the note and kept "For everyone" in "Who should see it".
- Saw: Link "‹ PULSE"; card "Handoff · as of 1:41 PM", "Reports: 1 done · 4 left", chips OPENING (green), AM PREP, MID-DAY PREP, CASH DEPOSIT, CLOSING (amber), "No handoff notes for today.", heading "WRITE A HANDOFF NOTE", drop-down "Who should see it" (For everyone / For crew / For managers), box "Note" (no placeholder text) holding "Bread comes early tomorrow. Clear a shelf in the prep fridge first.", button "POST NOTE" (yellow once there is text).
- Shot: img/manager/28-handoff-write.png
- Confused: The script said to tap "Write a handoff note" first; on this screen "WRITE A HANDOFF NOTE" is only a heading above the form.

## Step 29 — handoff-posted
- URL: /mid-shift/handoff?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "POST NOTE".
- Saw: The note now shows above the form: tag "FOR EVERYONE", "Nicole Boyd · 1:41 PM", "Bread comes early tomorrow. Clear a shelf in the prep fridge first.", buttons "GOT IT" and "RETRACT" (not tapped). The form below is cleared (Note empty, "POST NOTE" greyed). Report chips unchanged: OPENING, AM PREP, MID-DAY PREP, CASH DEPOSIT, CLOSING.
- Shot: img/manager/29-handoff-posted.png
- Confused: Pulse floor-view buttons: only "MAP VIEW" (no "Both shops" view, as expected for an AGM).

## Step 30 — closing-overview
- URL: /operations/closing?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Dashboard → "START CLOSING" (Today's operations card). Looked only; ticked nothing.
- Saw: Link "‹ DASHBOARD", heading "CLOSING CHECKLIST", "MEP · Capitol Hill", "PROGRESS 1/61". Station sections, each "<NAME> / 0 of N done": CRUNCHY BOI STATION 0 of 6 (open: Restock; Wipe inside & outside; Wipe tops of sauce bottles; Combine & check dates on sauces; Pull out station and sweep; Crunchy Boi Fridge temp (≤41°F)), 3RD PARTY STATION 0 of 6, WALK INS STATION 0 of 6, PREP FRIDGE 0 of 6, SHUT DOWN BACK LINE 0 of 4, EXPO STATION 0 of 5, CLEAN FRONT OF HOUSE 0 of 7, PREP AREA 0 of 9, CLOSING MANAGER 1 of 7, WALK-OUT VERIFICATION 0 of 5. Bottom line: "AM Prep had 0 items saved today - check with the opener."
- Shot: img/manager/30-closing-overview.png
- Confused: The yellow line "AM Prep had 0 items saved today - check with the opener." is there because AM prep has not been done yet today. No "awaiting a higher role" mark appears anywhere. "PROGRESS 1/61" counts the auto-done "Opening verified" report line.

## Step 31 — closing-full
- URL: /operations/closing?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Opened every section (taps on the section titles only) and took the full-page photo.
- Saw: All sections open. Extra lines: 3RD PARTY STATION (Restock; Wipe inside & outside; Wipe tops of sauce bottles; Combine & check dates on sauces; Pull out station and sweep; 3rd-Party Fridge temp (≤41°F)); WALK INS STATION (same five + Walk-In Fridge temp (≤41°F), Record cooler temp in Fahrenheit); PREP FRIDGE (same five + Sauce Fridge temp (≤41°F)); SHUT DOWN BACK LINE (Wipe down burners; Wipe down tile walls; Wipe wall under prep tables; Back-Line Drinks Fridge temp (≤41°F)); EXPO STATION (Change & stock cannoli pan; Wipe out deli display fridge; Restock bevs; Cookies & gluten free; Deli Display Fridge temp (≤41°F)); CLEAN FRONT OF HOUSE (Bathrooms; Patio furniture; Sweep; Mop; Restock bev fridge; Put away / organize cases; FOH Drinks Fridge temp (≤41°F)); PREP AREA (Organize Back Walk In; Clean Oven Window; Organize Smallwares & Utensils; Organize Dry Storage; Wipe down 3 door fridge; Wipe out 3 bay sink; Drain & turn off dish Machine; Trash to dumpster; 3-Door Fridge temp (≤41°F)). CLOSING MANAGER: "Count the drawer", "Count and secure tips" ("Count tips, place in safe. Weekly distribution handled separately by AGM+."), then report lines "AM Prep List — Pending — submit from the dashboard", "Opening verified — Submitted by Nicole Boyd at 1:42 PM", "Mid-day Prep — Pending — submit from the dashboard", "Cash deposited — Pending — submit from the dashboard", "PM Report submitted — Pending — submit from the dashboard". WALK-OUT VERIFICATION 0 of 5: Lights off; Devices charging; Oven off; Front doors locked; Back door locked.
- Shot: img/manager/31-closing-full.png
- Confused: The four report lines are links whose accessible names all say "tap to submit from the AM Prep page" (AM Prep List, Mid-Day Prep, Cash deposited, PM Report) - the wording is the same for all four. "Opening verified … Submitted by Nicole Boyd at 1:42 PM" while the Opening report page said finalized at 1:32 PM (the time shown is probably when the closing page loaded).

## BLOCKED (earlier, now cleared) — AM PREP (night: count what is left for the morning crew)
- BLOCKED AM PREP (planned shots 32-am-prep, 33-am-prep-filled, 34-am-prep-submitted): the AM prep page (/operations/am-prep?location=<Capitol Hill id>) shows only a full-screen error: "Something went wrong" / "Algo salió mal" / "An unexpected error occurred. Try again, or head back to your dashboard." / buttons "Try again · Reintentar" and "Dashboard · Panel" / "REF 789350329". Tried 4 times: Assignments board "AM PREP" tile (twice), "Try again · Reintentar" (twice), and the dashboard "CONTINUE AM PREP" button (the dashboard now lists "AM PREP — In progress"). Same REF each time. Not photographed. The closing checklist still said "AM Prep had 0 items saved today - check with the opener." CC then fixed the sim data and I retried the goal later: it worked (see steps 41-43, taken after step 40, in the order really taken).

## Step 32 — pm-report
- URL: /pm-report?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: On the board tapped "PM REPORT".
- Saw: Link "‹ DASHBOARD", heading "PM Report", "SHIFT ACTIVITY": row "Nicole Boyd — 83 items · 1 reports", then status rows "Opening 1:32 PM", "AM Prep In progress", "Mid-day Prep Not due yet", "Cash Deposit Not started", "Closing In progress". Section "MVP" with drop-down (default "No MVP", option "Nicole Boyd") and a yellow "SAVE". Section "ATTITUDE" with a person card "Nicole Boyd" and the grade rows "ARRIVED READY", "ATTITUDE", "PRODUCTION", "TEAM PLAYER", each with buttons "Great" / "Good" (selected by default) / "Needs work"; boxes "AREA TO IMPROVE" (box named "What should they work on?") and "NOTE (MANAGERS ONLY)" (box named "Private note for managers", hint "Only managers see this note"), a "SAVE" button, then a drop-down "Select employee…" (Angel Reyes, Dana Brooks, Luis Herrera, Marcus Webb) and "SUBMIT PM REPORT".
- Shot: img/manager/32-pm-report.png
- Confused: Only ONE person is listed on the grade list (Nicole Boyd herself, the only person on shift). The other staff are added with the "Select employee…" drop-down at the bottom. The script says "Attitude" and "Production" are the grade names: there are FOUR grade names: Arrived ready, Attitude, Production, Team player.

## Step 33 — pm-grades
- URL: /pm-report?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Set Nicole Boyd Attitude to "Great". Only one person was listed, so I used the "Select employee…" drop-down at the bottom to add "Angel Reyes" as the second person, set Angel Reyes Production to "Needs work" and typed "Restock lids before the rush." in "AREA TO IMPROVE". Tapped "SAVE" on Nicole's card (button turned "SAVED ✓" for a moment, then back to "SAVE") and on Angel's card ("SAVED ✓").
- Saw: Two person cards side by side (Nicole Boyd left, Angel Reyes right), each with grade rows PRODUCTION / TEAM PLAYER (and above them ARRIVED READY and ATTITUDE), buttons "Great" / "Good" / "Needs work" (the selected one is yellow with a black edge; default "Good"). Left card: Attitude Great, others Good. Right card: Production "Needs work", others Good, "AREA TO IMPROVE" shows "Restock lids before the rush." Placeholders: AREA TO IMPROVE box "What should they work on?"; "NOTE (MANAGERS ONLY)" box "Private note for managers" with hint "Only managers see this note". Under the cards: drop-down "Select employee…" (Dana Brooks, Luis Herrera, Marcus Webb left) and "SUBMIT PM REPORT".
- Shot: img/manager/33-pm-grades.png
- Confused: Nicole's card went back to "SAVE" (not "SAVED ✓") a few seconds after saving; unclear whether the grade stayed saved. Angel Reyes is not on shift today (he only appears through the drop-down).

## Step 34 — pm-mvp
- URL: /pm-report?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: In "MVP" picked "Nicole Boyd" (first person); a reason box appeared; typed "Kept the line moving all lunch." and tapped "SAVE" (it flashed "SAVED ✓").
- Saw: Section "MVP": drop-down now "Nicole Boyd" (options No MVP, Nicole Boyd, Angel Reyes), a text box named "Why MVP?" holding "Kept the line moving all lunch.", yellow "SAVE". Above it the "SHIFT ACTIVITY" rows (Opening 1:32 PM; AM Prep In progress; Mid-day Prep Not due yet; Cash Deposit Not started; Closing In progress) and below it the "ATTITUDE" section with the two person cards.
- Shot: img/manager/34-pm-mvp.png
- Confused: The reason box only appears once a person is picked (the label is "Why MVP?"). Its placeholder was not visible because it was filled.

## Step 35 — pm-submitted
- URL: /pm-report?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "SUBMIT PM REPORT".
- Saw: Green banner "Submitted 1:45 PM by Nicole Boyd" under "PM Report". "SHIFT ACTIVITY" rows unchanged (Nicole Boyd 83 items · 1 reports; Opening 1:32 PM; AM Prep In progress; Mid-day Prep Not due yet; Cash Deposit Not started; Closing In progress). The two grade cards are now greyed read-only: Nicole Boyd (Attitude Great, rest Good) and Angel Reyes (Production Needs work, rest Good, AREA TO IMPROVE "Restock lids before the rush."). The "NOTE (MANAGERS ONLY)" boxes show empty with "Only managers see this note". No "SAVE"/"SUBMIT" buttons remain.
- Shot: img/manager/35-pm-submitted.png
- Confused: The MVP drop-down and the "Why MVP?" text are not shown anywhere on the submitted page (MVP section disappeared after submit).

## Step 36 — cash-deposit
- URL: /cash?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: On the board tapped "CASH REPORT" (the page is titled "Cash Deposit").
- Saw: Link "‹ DASHBOARD", heading "Cash Deposit". Left column "CASH": box "Projected (from Toast)" (placeholder "0.00"), two toggle buttons "Enter total" (selected, yellow) and "Count by denomination", box "Drawer total" (placeholder "0.00"), line "$200 stays in the register", result line "Deposit -$200.00 · $200.00 short" ("$200.00 short" in red), box "Over/short note (optional)" (empty, no placeholder text). Right column "TIPS": box "Cash tips" (placeholder "0.00"); "ON SHIFT TODAY" tick list: Angel Reyes, Dana Brooks, Luis Herrera, Marcus Webb, Nicole Boyd (all unticked) and a "+ Add" button; big yellow "SIGN & SUBMIT DEPOSIT".
- Shot: img/manager/36-cash-deposit.png
- Confused: The "ON SHIFT TODAY" list names five people (Angel Reyes, Dana Brooks, Luis Herrera, Marcus Webb, Nicole Boyd) although the Pulse showed only Nicole Boyd as "Here now". The tip-split list is the whole active crew, not just who clocked in.

## Step 37 — cash-filled
- URL: /cash?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Kept "Enter total". Typed 845.00 in "Projected (from Toast)" (it is an ordinary box here), 1045.00 in "Drawer total", 62.00 in "Cash tips", ticked "Nicole Boyd" under "ON SHIFT TODAY". Left the over/short note empty.
- Saw: Boxes show 845.00, 1045.00 and 62.00; "$200 stays in the register"; result line now "Deposit $845.00 · Even" (no "short" in red any more); "Nicole Boyd" ticked.
- Shot: img/manager/37-cash-filled.png

## Step 38 — cash-pin
- URL: /cash?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "SIGN & SUBMIT DEPOSIT".
- Saw: A PIN panel opens over the form: "ASSISTANT GENERAL MANAGER / Nicole Boyd", "Enter your 4-digit PIN", keypad 1-9, "Clear", 0, "←", buttons "Back" and "Use system keyboard".
- Shot: img/manager/38-cash-pin.png

## Step 39 — cash-submitted
- URL: /cash?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped 8 four times on the PIN keypad.
- Saw: Read-only page: "Deposited $845.00 · signed by Nicole Boyd at 1:47 PM". Rows: "Projected (from Toast) $845.00", "Drawer total $1,045.00", "$0.00 over $0.00", "Deposit $845.00 $845.00", "Cash tips $62.00", "On shift today: Nicole Boyd". Deposit $845.00; over/short $0.00 over.
- Shot: img/manager/39-cash-submitted.png

## Step 40 — closing-walk-out
- URL: /operations/closing?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Dashboard → "CONTINUE CLOSING" (the Today's operations card now said "In progress · 1 of 61 items"). Ticked the five Walk-Out Verification lines: Lights off, Devices charging, Oven off, Front doors locked, Back door locked.
- Saw: Sticky top bar "PROGRESS 8/61". Section "✓ WALK-OUT VERIFICATION / 5 of 5 done" with each line showing a yellow tick, an "UNDO" button, "you · 1:48 PM" and a link "Add note" (the per-line note link). In the CLOSING MANAGER card above: green tick "PM Report submitted — Submitted by Nicole Boyd at 1:47 PM". Bottom: yellow strip "AM Prep had 0 items saved today - check with the opener.", big button "REVIEW & SUBMIT (INCOMPLETE)" with "8 of 61 required done", and a floating pill "REVIEW & SUBMIT · 8/61".
- Shot: img/manager/40-closing-walk-out.png
- Confused: The PM Report line says "1:47 PM" while the PM Report page said "Submitted 1:45 PM"; the Cash deposit said 1:47 PM.

## Step 41 — am-prep
- URL: /operations/am-prep?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Retried after the coordinator said the bad par data was fixed: Dashboard → Explore → Assignments → "AM PREP". It opens now.
- Saw: Link "‹ DASHBOARD", heading "AM PREP", "MEP · Capitol Hill". Sections VEG 0 of 6 (open), COOKS 0 of 6, SIDES 0 of 6, SAUCES 0 of 11, SLICING 0 of 9, MISC 0 of 4 (42 rows). Column heads "PAR", "ON HAND", "BACK UP", "TOTAL". VEG rows with a red "Required" tag each: Iceberg 7 1/3 Pan, Onion 8 Quart, Basil 4 Quart, Radish 1 Quart, Cucumber 3 Quart, Tomato "Prep Daily". Footer: "Fix 42 issues before submitting" with link "SHOW ME WHAT NEEDS FIXING" and a greyed button "FIX ISSUES BEFORE SUBMITTING".
- Shot: img/manager/41-am-prep.png
- Confused: Earlier tries today (four, before CC fixed the sim data) gave "Something went wrong / Algo salió mal", REF 789350329 — see the BLOCKED note above, now resolved. The "Tomato" row shows "Prep Daily" instead of a par.

## Step 42 — am-prep-filled
- URL: /operations/am-prep?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Typed 2 in Iceberg "ON HAND", 1 in Onion "ON HAND", 3 in Basil "ON HAND" (each box is named like "Veg · Iceberg · ON HAND").
- Saw: VEG "3 of 6 done". The three rows lost their red "Required" tag. "TOTAL" boxes filled by themselves with the same number (Iceberg 2, Onion 1, Basil 3); "BACK UP" boxes stay empty. A small "Saved" note appears. Footer "Fix 39 issues before submitting" and the greyed "FIX ISSUES BEFORE SUBMITTING" button.
- Shot: img/manager/42-am-prep-filled.png
- Confused: The button cannot be tapped until every one of the 42 rows has a count; the wording is "Fix 39 issues before submitting" / "FIX ISSUES BEFORE SUBMITTING".

## Step 43 — am-prep-submitted
- URL: /operations/am-prep?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: The "SUBMIT AM PREP" button was greyed ("FIX ISSUES BEFORE SUBMITTING", footer "Fix 39 issues before submitting" counting down: 30, then 4) until every row had a number: typed 1 in the first box (ON HAND, or "PORTIONED" in SIDES) of every remaining row of VEG, COOKS, SIDES, SAUCES and SLICING, tapped "YES" on the four MISC questions (Meatball mix - ready?, Meatballs - ready to cook?, Meatballs - for reheat?, Cook Bacon?), then tapped "SUBMIT AM PREP".
- Saw: Banner "AM Prep submitted at 1:51 PM by Nicole Boyd" under "MEP · Capitol Hill"; every section collapsed with a green ✓ and full counts (VEG 6 of 6, COOKS 6 of 6, SIDES 6 of 6, SAUCES 11 of 11, SLICING 9 of 9, MISC 4 of 4). Other things met on the page: the SIDES section column heads read "PAR / PORTIONED / BACK UP / TOTAL" (not "ON HAND"); rows in SIDES: Tuna Salad 15, Egg Salad 12, Onion Dip 12 Side, Chix Salad 12, Antipasto Pasta 12, Cannoli Cream 0.5 Bag; MISC has YES/NO buttons and a notes box with the placeholder "Add notes…"; "DISCARD CHANGES" button before submit; a "Saved" note appears while typing (autosave).
- Shot: img/manager/43-am-prep-submitted.png
- Confused: The script predicted "If it refuses because rows are empty, log the exact words": it does not refuse on tap; the button is disabled and reads "FIX ISSUES BEFORE SUBMITTING" with "Fix N issues before submitting" and "SHOW ME WHAT NEEDS FIXING" next to it.

## Step 44 — closing-review
- URL: /operations/closing?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Went back to the closing (the AM prep was done in between, so this time it was "9/61"). Tapped "REVIEW & SUBMIT (INCOMPLETE)". A "Some required items aren't done — explain why" panel opened with one box per missing item (52 of them); typed "Sim walk — not done on this test day." in every box.
- Saw: Panel header "REVIEW & SUBMIT", "Some required items aren't done — explain why", "9 of 61 required done"; then 52 labelled boxes, each a text area named "Why couldn't this be completed?", labelled e.g. "SHUT DOWN BACK LINE · BACK-LINE DRINKS FRIDGE TEMP (≤41°F)", "EXPO STATION · DELI DISPLAY FRIDGE TEMP (≤41°F)", "CLEAN FRONT OF HOUSE · FOH DRINKS FRIDGE TEMP (≤41°F)", "PREP AREA · 3-DOOR FRIDGE TEMP (≤41°F)", "CLOSING MANAGER · MID-DAY PREP". All the station lines and the six fridge temp lines are listed. At the bottom a yellow "CONTINUE" button and the floating "REVIEW & SUBMIT · 9/61" pill; a button "HIDE REVIEW" sits above the panel. The reason boxes have no placeholder text visible once filled.
- Shot: img/manager/44-closing-review.png
- Confused: The temperature lines (CRUNCHY BOI FRIDGE TEMP etc.) are listed as "not done" in the review panel although I had typed all eight temperatures at the opening: the closing checklist wants its own temperature ticks. The button said "CONTINUE", not "Submit".

## Step 45 — closing-pin
- URL: /operations/closing?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "CONTINUE" (there is no separate "Submit" button).
- Saw: A dialog "Confirm with your PIN" / "Enter your 4-digit PIN to confirm this action." with keypad 1-9, "Clear", 0, buttons "Cancel" and "Use system keyboard" opens over the checklist.
- Shot: img/manager/45-closing-pin.png
- Confused: Note the keypad here has no "←" key; Clear and Cancel instead.

## Step 46 — closing-confirmed
- URL: /operations/closing?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped 8 four times on the "Confirm with your PIN" keypad. The page showed a red line "Just modified by someone else — try again." and every checklist line turned grey/disabled (named "… — instance incomplete_confirmed"). I did not photograph that. I went back to the dashboard: the Today's operations card now read "CLOSING CHECKLIST / Closed with items incomplete" with a button "REVIEW CLOSING"; tapped it.
- Saw: Banner "Closing submitted with incomplete items · 1:53 PM by Nicole Boyd", heading "REASONS GIVEN FOR UNFINISHED LINES", then one line per item like "Restock — Sim walk — not done on this test day. · Nicole Boyd" (52 lines, station by station). The closing is read-only.
- Shot: img/manager/46-closing-confirmed.png
- Confused: The banner does not say "Closing confirmed" — it says "Closing submitted with incomplete items · 1:53 PM by Nicole Boyd". Dashboard card wording: "Closed with items incomplete" and "REVIEW CLOSING".
- Bug?: After the PIN: error text "Just modified by someone else — try again." appeared although the closing had in fact been submitted (it shows as closed afterwards). Possibly a double-write race (the page refreshed itself while the PIN confirm was saving).

## Step 47 — counts
- URL: /operations/counts?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: On the board tapped "COUNTS".
- Saw: Link "‹ DASHBOARD", heading "Inventory Audit", "Run when the owner calls for a full audit. Day to day, the system infers on-hand from deliveries, production, and sales." Left card "NEW AUDIT": hint box "Count each unit once: full containers, then loose units below. Never count the same stock twice."; a row with drop-down "Pick an item…" (about 100 items, first three: 1/2 pint bottoms (flexi), 1/2 pint top (flexi), 2 oz portion cup lids), "UNIT" box (placeholder "Unit (e.g. tub)"), "HOW MANY" box, tick box "Loose (below a full container)" with "Partial" box (placeholder "e.g. 0.5"), "+ Add item", "Note" box (placeholder "Anything to flag about this audit…"), greyed "RECORD AUDIT". Right: "ON HAND" with "Download CSV / PDF", "No audit yet — on-hand is inferred from deliveries, production, and sales." and item cards (Banana Peppers "1 vendors unknown", Capicola "63.0 oz on hand", Ham "114.1 oz known so far", Iceberg "171.2 oz known so far", Pepperoni 28.4 oz, Provolone 144.3 oz, Turkey 87.1 oz, then "Inferred" rows such as Arugula "counted: 36.7 oz · since: — · 69d ago").
- Shot: img/manager/47-counts.png
- Confused: The screen shows no password prompt yet.

## Step 48 — counts-filled
- URL: /operations/counts?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Picked the first three items from the drop-down ("1/2 pint bottoms (flexi)", "1/2 pint top (flexi)", "2 oz portion cup lids"), typed 4, 2 and 6 in "HOW MANY" and used "+ Add item" for the second and third lines. "RECORD AUDIT" stayed greyed until each line also had text in "UNIT"; the script does not name a unit, so I typed the plain word "case" in each UNIT box (the one thing I typed that the script did not name).
- Saw: Each item card shows its name, a small line "No deliveries recorded here yet", a bar "Count by vendor instead ▸", UNIT "case", HOW MANY 4 / 2 / 6, the "Loose (below a full container)" tick box (unticked) with "Partial" box (placeholder "e.g. 0.5"), and a red "Remove" link. A fresh empty line is added each time "+ Add item" is tapped.
- Shot: img/manager/48-counts-filled.png
- Confused: The script says to type only how many; the form needs a unit name too (UNIT placeholder: "Unit (e.g. tub)"). RECORD AUDIT stays greyed without it.

## Step 49 — counts-password
- URL: /operations/counts?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "RECORD AUDIT".
- Saw: A dialog over a dimmed page: "Confirm your password" / "Re-enter your password to confirm this action." / label "PASSWORD" with an empty box (named "password"), a black "CONFIRM" button (red letters) and "Cancel".
- Shot: img/manager/49-counts-password.png

## Step 50 — counts-recorded
- URL: /operations/counts?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Typed "sim-nicole-pw" in the password box and tapped "CONFIRM". The first try (unit "case") came back with a red error (not photographed): "Can't convert "case" to ounces for 1/2 pint bottoms (flexi) — nothing was saved. Pick a unit from that item's list, or remove the line and have its pack size or average weight added first." I changed the three UNIT boxes to "oz", tapped "RECORD AUDIT" again: it saved straight away (no second password prompt appeared).
- Saw: The form cleared (UNIT "Unit (e.g. tub)", HOW MANY empty, "Loose" unticked, Note "Anything to flag about this audit…"). The right-hand list now says "Anchored to the audit on Tue, Oct 13." and shows the three counted items first: "1/2 pint bottoms (flexi) 4.0 oz on hand", "1/2 pint top (flexi) 2.0 oz on hand", "2 oz portion cup lids 6.0 oz on hand", each "VENDORS · 2". Under the form, three orange notes: "1/2 pint bottoms (flexi): no deliveries recorded here yet, so all 4 oz was counted under PFG. Count by vendor to split it." and the same for "1/2 pint top (flexi)" (all 2 oz counted under Leonard Paper) and "2 oz portion cup lids" (all 6 oz counted under Leonard Paper).
- Shot: img/manager/50-counts-recorded.png
- Confused: Units matter: "case" is refused; "oz" works. The script gives no unit. The password step appeared only on the first RECORD AUDIT tap (step 49); the first CONFIRM tap I made with an empty box did nothing (dialog stayed open), then the error came after the password was typed.
- Bug?: Typing a unit that has no conversion to ounces gives the long red message quoted above (the word "case" is not valid for these packaging items).

## Step 51 — ordering-walk
- URL: /ordering?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: On the board tapped "ORDERING" (the page lives at /ordering).
- Saw: Breadcrumb "‹ DASHBOARD" and "RECEIVING ›", heading "Ordering walk — Tue, Oct 13", "MEP · Capitol Hill". Card "TODAY'S ORDERS" ("Nothing ordered yet today."), card "CUTOFF TODAY / 3 to draft" with rows "Boar's Head — Cutoff 3:00 PM", "Cardinal Bakery — Cutoff 3:00 PM", "Trimark — Cutoff 6:00 PM", each with a yellow "GENERATE DRAFT" button. Line "Par tuning hasn't run at this shop yet." Then the vendor PFG ("73 SKUs", tag "ORDER DAY", "▾") with item cards: Duke's Mayo (case, "Par 3", "~1.4 case on hand · inferred", "ORDER TO PAR (CASE)" with − [ ] +, buttons "Suggest 2", "Empty · order 3", "We're full · 0"), Iceberg (Par 4, "~0.3 Case on hand · inferred", Suggest 4, Empty · order 4), Ham (Par 3, Each (no case), Suggest 0, Empty · order 3), Tomatoes Crushed (10#) (Par 0.67, Suggest 1), Chicken Breast (Par 0.25, Suggest 1), Tuna, ... (73 lines).
- Shot: img/manager/51-ordering-walk.png
- Confused: Nothing in this screen says "Ordering" is a section of the Explore menu; it is reached only from the board. Reports Hub → Inventory → Ordering: checked later.

## Step 52 — ordering-adjusted
- URL: /ordering?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "+" twice on Duke's Mayo (first line) and once on Iceberg.
- Saw: Tag "2 marked" on the PFG header. Duke's Mayo box shows 2 (yellow "Suggest 2" selected, a new "Clear" button), Iceberg box shows 1. Bottom bar: "2 SKUs marked" and yellow "REVIEW ORDER".
- Shot: img/manager/52-ordering-adjusted.png
- Confused: The "+" box counts from 0 to 1 and 2: it shows the order quantity, not the suggested number; "Suggest 2" is highlighted when the box equals the suggestion.

## Step 53 — ordering-review
- URL: /ordering?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "REVIEW ORDER".
- Saw: A sheet "Review order" (button "Close") opens: "1 vendor orders · 0 marked full", vendor "PFG", table "SKU / ITEM # / QTY": PRODUCE — "Iceberg ICE1/5326426 1 Case"; DRY GOODS — "Duke's Mayo 32118 2 case"; hint "Delivery options (email, portal, phone) appear once you submit."; buttons "Keep walking" and "RECORD WALK · 2 SKUS".
- Shot: img/manager/53-ordering-review.png
- Confused: The walk-through table lists Produce before Dry goods, not in the order I tapped.

## Step 54 — ordering-draft
- URL: /ordering?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "RECORD WALK · 2 SKUS" and scrolled down. Stopped at the draft (no Confirm/Send/Mark placed exists on this screen; I did not tap "Copy").
- Saw: Green banner "Walk recorded — 2 SKUs.", a new row "Order history 1 ▸", heading "DRAFT ORDERS", card "PFG" with tag "PO MEP-20261013-PFG", "Minimum: 10 case minimum", table SKU / ITEM # / QTY: "Duke's Mayo 32118 2 case", "Iceberg ICE1/5326426 1 Case"; box "Order portal — TBD — PFG order portal" with button "Copy"; button "START A NEW WALK". The three "GENERATE DRAFT" rows (Boar's Head, Cardinal Bakery, Trimark) stay above.
- Shot: img/manager/54-ordering-draft.png
- Confused: The PFG draft says "Minimum: 10 case minimum" while the order is 3 cases; no warning text beside it. No "Confirm"/"Send" button shows on this page.

## Step 55 — production
- URL: /operations/production?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Looked for a menu path to "Production" in 3 honest tries: the Ordering page (only has "RECEIVING ›" and Back to Dashboard), the Reports Hub (families Operations / People / Inventory / Catering / Menu costing, no "Production" link) and Reports Hub → "Counts and variance" (no link). Then used goto: "/operations/production" alone sent me back to the dashboard; "/operations/production?location=<Capitol Hill id>" opened the page.
- Saw: Link "‹ DASHBOARD", heading "Production", link "YIELD VARIANCE →", card "LOG A CONVERSION": drop-down "Raw item (SKU)" ("Pick a SKU…", each option "<name> (0 in stock)"), boxes "Amount used (packs)" and "Amount made", box "Notes" (no placeholder), greyed "LOG PRODUCTION". Below: "RECENT PRODUCTION" with rows like "0 Cheddar → 4 Cheddar — Tue, Oct 13", "0 Mortadella → 2 Mortadella", "0 Provolone → 23 Provolone" (the opening Phase 2 entries I made).
- Shot: img/manager/55-production.png
- Confused: There is no menu path to Production: not in Explore, not in the Reports Hub, not on the Ordering page. The page opens only with the "?location=…" part of the address.

## Step 56 — production-filled
- URL: /operations/production?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Picked the first item offered, "1/2 pint bottoms (flexi) (0 in stock)": a second drop-down "Pick what you made…" appeared but with NO option, and "LOG PRODUCTION" stayed greyed even with 1 and 4 typed (not photographed). Picked the next SKU that has a "Makes" option, "Cheddar (0 in stock)", chose its only option "Cheddar", typed 1 in "Amount used (packs)" and 4 in "Amount made".
- Saw: "Raw item (SKU)" Cheddar (0 in stock); a new drop-down "Makes" now shows "Cheddar"; "Amount used (packs)" 1; "Amount made" 4; "Notes" empty (no placeholder text); "LOG PRODUCTION" now bright yellow.
- Shot: img/manager/56-production-filled.png
- Confused: The first SKU in the list has no finished item to make, so the log button stays greyed; the label on the second picker is "Makes" (placeholder "Pick what you made…").

## Step 57 — production-logged
- URL: /operations/production?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "LOG PRODUCTION".
- Saw: The form reset (SKU back to "Pick a SKU…", both amounts empty, "LOG PRODUCTION" greyed) and a new first row appears in "RECENT PRODUCTION": "1 Cheddar → 4 Cheddar — Tue, Oct 13", above "0 Cheddar → 4 Cheddar" and "0 Mortadella → 2 Mortadella".
- Shot: img/manager/57-production-logged.png
- Confused: No "Logged" message or toast shows; the only sign is the new row at the top of "RECENT PRODUCTION".

## Step 58 — reports-hub
- URL: /reports?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Dashboard → Explore → "Reports Hub".
- Saw: Link "‹ DASHBOARD", heading "Reports", chip "Capitol Hill" (yellow). Filter row: "Date range" drop-down ("Last 7 days"; options Today, Yesterday, Last 7 days, Last 30 days, This month, Last month, Custom), "From" 10/07/2026, "To" 10/13/2026, tick box "Compare with previous period", "Apply"; note "Up to 92 inclusive days. Comparison applies to summary counts and trends." Card "Capitol Hill / Last close · Mon, Oct 12 / No activity recorded" with chips "Reports: 6", "Under par: 0", "Over par: 0", "Skipped: 52", "Not started: 0", "Temperature flags: 0", "Cash over: 0", "Cash short: 0". Report families: "Operations" (buttons "Operations", "Operations trends"), "Written reports", "People" ("My feedback", "Team trends"), "Inventory" ("Counts and variance", "Receiving", "Ordering"), then "Catering" and "Menu costing" further down. No "Sales" family. No "Production" link.
- Shot: img/manager/58-reports-hub.png
- Confused: Reports Hub → Inventory shows "Counts and variance" (opens the Inventory Audit page), "Receiving" and "Ordering" for this AGM. There is no "Sales" family.

## Step 59 — reports-opening
- URL: /reports/opening/<id>?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: On the Reports Hub tapped "Operations" (a list of today's reports opened: Tue, Oct 13 Opening — By: Nicole Boyd — Status: Prep done; Closing — Status: Confirmed (incomplete); AM Prep — Status: Confirmed; Cash — Status: Submitted; PM Report — Status: Submitted; Maintenance — Status: OK; filters "SEARCH", "FROM", "TO", "TYPE" (All types, Opening, Closing, AM Prep, Mid-Day Prep, Cash, PM Report, Maintenance), "APPLY", "SIGNAL FILTERS" Under par, Over par, Skipped items, Not started, Temp out of range, Cash over, Cash short, "Download CSV / PDF", button "VIEW TRENDS"), then tapped the Opening row.
- Saw: Link "‹ OPERATIONS", "DASHBOARD", tabs "Same day": Closing, AM Prep, Cash, PM Report, Maintenance; buttons "Previous day" and "Next day". Heading "Opening", "Tue, Oct 13", "Prep done". Notice "RECOUNT — NO PRIOR-DAY SUBMISSION": "No prior-day AM-Prep submission to verify against — the opener recounted to establish the counts. Reason: missed or unknown." Then "82/82 done · 0 skipped" and each station with ticks and names: CRUNCHY BOI STATION (Station appears clean as reported ✓ Nicole Boyd; Crunchy Boi Fridge temp (≤41°F) ✓ Nicole Boyd "Temp 36°"; Sauces topped off & dated correctly ✓; Station ready for service (containers placed, prep ready) ✓), 3RD PARTY STATION (… "Temp 37°"), WALK INS STATION ("Temp 38°"), PREP FRIDGE ("Temp 35°"), PREP AREA ("Temp 36°" …) and more.
- Shot: img/manager/59-reports-opening.png
- Confused: It says "Reason: missed or unknown." for the reason I picked ("Closing was missed / I don't know"). The "Tue, Oct 13 Closing" row shows "Status: Confirmed (incomplete)" while the closing page said "Closing submitted with incomplete items".

## Step 60 — trends
- URL: /reports/trends?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Dashboard → Explore → "Trends".
- Saw: Links "‹ REPORTS", "DASHBOARD", chip "Capitol Hill", heading "Trends". Three cards each "TAP FOR THE FULL VIEW →": "Ops Trends — Par · temps · cash · completion over time", "Team — Operating health (managers)", "Yield — Batches vs the recipe card". Section "RELEVANT RIGHT NOW": "Team — 1 on track · 3 need a check-in: Angel Reyes, Nicole Boyd, Marcus Webb." and "Fridge Temp Flags 8". "OPS SNAPSHOT" (button "VIEW OPS TRENDS": "UNDER / OVER PAR 0", "FRIDGE TEMP FLAGS 8"), "TEAM SNAPSHOT" (button "VIEW TEAM": "ON TRACK 1", "NEEDS ATTENTION 3").
- Shot: img/manager/60-trends.png
- Confused: The Trends page shows "Fridge Temp Flags 8" and "Reports Hub" said "Temperature flags: 0" the same day; all eight opening temps (35-38°F) are in range. Also "Nicole Boyd" is counted as needing a check-in right after her own shift.
- Bug?: Fridge Temp Flags 8 (Trends) vs Temperature flags 0 (Reports Hub).

## Step 61 — admin-home
- URL: /admin
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Dashboard → Explore → "Admin". Opened nothing.
- Saw: Link "‹ DASHBOARD", heading "Admin", "Manage your business configuration.". Card "USED THIS WEEK": Checklists confirmed 1, Counts recorded 1, Receiving logged 1, Prep submitted 1, Reports written 1, Photos uploaded 0, Production recorded 33, Catering quotes 1. Eight section tiles: "Vendors", "SKUs" (red tag "212 not ready"), "Products", "Recipes" (tag "115 not ready"), "Items" (tag "38 not ready"), "Menu Costing", "Weights & Trim", "Catering". "Customers" is NOT listed (needs GM); no user/template/pars tiles either.
- Shot: img/manager/61-admin-home.png
- Confused: The weekly card says "Production recorded 33": 32 are my Phase 2 prep entries counted as production plus the one Cheddar conversion; "Counts recorded 1" is the Inventory Audit.

## Step 62 — logged-out
- URL: /
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Dashboard → scrolled to the bottom → "LOG OUT".
- Saw: Back on "Where are you?": "OPERATIONS" header, "Manager login →", two tiles "MEP Capitol Hill" and "EM P Street".
- Shot: img/manager/62-logged-out.png
