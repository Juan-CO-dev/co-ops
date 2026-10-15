# Manager walk — step log (Nicole Boyd, 2026-10-14)

## Step 01 — where-are-you
- URL: /
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Started the walk (`start tablet walker`); first screen.
- Saw: "OPERATIONS"; "Manager login →" top right; heading "Where are you?"; two tiles "MEP Capitol Hill" and "EM P Street".
- Shot: img/manager/01-where-are-you.png

## Step 02 — manager-login-form
- URL: /
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "Manager login →". Typed nothing.
- Saw: "Use tile login →" top right; heading "Manager login"; "Email + password for AGM and above."; EMAIL box (placeholder "you@complimentsonlysubs.com"); PASSWORD box (no placeholder); button "SIGN IN"; link "Forgot password?"; footer "Reset links go to manager email accounts. If you sign in with a PIN, ask a manager to reset it."
- Shot: img/manager/02-manager-login-form.png

## Step 03 — whats-your-role
- URL: /
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "Use tile login →" (it returned to "Where are you?"), then the Capitol Hill tile.
- Saw: "What's your role?"; "MEP · CAPITOL HILL"; role tiles "GM General Manager", "AGM Assistant General Manager", "CTR Catering Manager", "SL Shift Lead", "KH Key Holder", "TR Trainer", "EMP Employee", "TRN Trainee"; "← Back" (below the first screen). Employee/Trainee are at the bottom edge of the photo.
- Shot: img/manager/03-whats-your-role.png

## Step 04 — who-are-you
- URL: /
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped the Assistant General Manager tile.
- Saw: "Who are you?"; "MEP · CAPITOL HILL · ASSISTANT GENERAL MANAGER"; one tile "NB Nicole Boyd"; "← Back".
- Shot: img/manager/04-who-are-you.png

## Step 05 — pin-keypad
- URL: /
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "Nicole Boyd"; photographed the keypad; then tapped control "8" four times (by control number, not digit) and it signed in on the fourth digit.
- Saw: badge "ASSISTANT GENERAL MANAGER"; "Nicole Boyd"; "Enter your 4-digit PIN"; four empty dots; keypad 1-9, "Clear", 0. No system keyboard and no "Back" bar in the frame (the "← Back" and "Use system keyboard" links are below the fold).
- Shot: img/manager/05-pin-keypad.png

## Step 06 — dashboard
- URL: /dashboard?loc=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Signed in; waited for the dashboard.
- Saw: round "N" user button sits in the page at top right (not over anything); "DASHBOARD" / "Hi, Nicole Boyd."; role badge "ASSISTANT GENERAL MANAGER"; bell with 37 unread; shop chip "MEP · CAPITOL HILL"; "EXPLORE" chips: Mid-Shift Pulse, Reports Hub, Assignments, Trends, LTO, Written Reports, Catering, Maintenance, Production, Training, Recipes, Profile, Settings, My Performance, Admin; "My shift" with rows "Take or assign tasks — 2 of 8 assigned", "My station — None yet", "Team today — 1 of 5 assigned".
- Shot: img/manager/06-dashboard.png
- Confused: the script says nobody has a task assigned, but "Take or assign tasks" reads "2 of 8 assigned" and "Team today" reads "1 of 5 assigned" at the start.

## Step 07 — dashboard-full
- URL: /dashboard?loc=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Full-page shot.
- Saw: same top as step 06; button "ASSIGNMENTS" under My shift (no "Unassigned: … · assign or take it" lines and no task tiles); "TODAY'S OPERATIONS" card "MEP · Capitol Hill", "Wed, Oct 14", "CLOSING CHECKLIST — Not started", button "START CLOSING"; a "REPORTS" section DOES show, with an "ORDERING" card ("3:00 PM", "Boar's Head: missed cutoff — call the vendor", pills "Cardinal Bakery: missed the 3:00 PM cutoff", "PFG: missed the 4:00 PM cutoff", "Trimark: missed the 6:00 PM cutoff", "Baldor draft", "Boar's Head draft", "PFG draft", "Trimark draft", "Webstaurant draft") and an "INVENTORY AUDIT" card ("0 DAYS SINCE LAST COUNT", "16 SKUs anchored"); "LOG OUT".
- Shot: img/manager/07-dashboard-full.png
- Bug?: the script expects no Reports section for this role; a "REPORTS" section with Ordering and Inventory Audit cards shows. Also the Ordering card already shows "missed cutoff" and five drafts on a fresh day (the sim clock may be late in the day).

## Step 08 — board-tasks
- URL: /assignments?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Dashboard → "ASSIGNMENTS" (an Explore chip "Assignments" also exists). Collapsed "Take or assign stations" (it opens by default) and opened "Take or assign tasks".
- Saw: "Assignments", "Wed, Oct 14", chip "Capitol Hill", card "Today's team" with button "STATIONS" and "Active staff at this shop. Stations and tasks show today's assignments."; collapsible rows "Take or assign stations — 0 of 12 assigned", "Take or assign tasks — 2 of 8 assigned", "Unassigned — 6 unassigned", "Who has what — 1 of 5 assigned". Task hint: "Open an unassigned task to do it. Your submission records you as the doer; to assign it to yourself, ask another key holder." Task buttons: CLOSING CHECKLIST ("Everyone on shift · no assignment needed"), AM PREP, MID-DAY PREP, CASH REPORT, OPENING PREP, RECEIVING (all "Unassigned"), COUNTS and ORDERING ("Taken by Nicole Boyd · 1:16 AM"), PM REPORT ("Unassigned").
- Shot: img/manager/08-board-tasks.png
- Confused: the script says nobody has a task, but COUNTS and ORDERING already read "Taken by Nicole Boyd · 1:16 AM" at the start of the walk.

## Step 09 — board-stations
- URL: /assignments?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Opened "Take or assign stations". Set nobody.
- Saw: "Take or assign stations — 0 of 12 assigned"; groups Crunchy Boi Station · 0 of 1, 3rd Party Station · 0 of 1, Walk Ins Station · 0 of 2 (Walk-ins; Walk-ins / Online), Prep Fridge · 0 of 1, Shut Down Back Line · 0 of 1, Expo Station · 0 of 2 (Expeditor; Register & Delivery), Clean front of house · 0 of 1, Prep Area · 0 of 1, Closing Manager · 0 of 1, Walk-Out Verification · 0 of 1. Each shows "Unassigned", a "Person" list (Person / Angel Reyes / Luis Herrera / Nicole Boyd) and button "SET STATION".
- Shot: img/manager/09-board-stations.png

## Step 10 — assign-task
- URL: /assignments?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Opened "Who has what" and scrolled until Angel Reyes's whole card was in frame. Picked nothing, tapped nothing.
- Saw: "Here now (1)"; "Nicole Boyd · On shift · Active in CO-OPS"; cards for Angel Reyes, Dana Brooks, Luis Herrera (Dana Brooks's card has no Station/Task controls). Angel Reyes card: "No station"; "Station" list "No station" + "SET STATION"; "Tasks — No assigned tasks today."; "Task" list (AM prep, Mid-day prep, Cash report, Opening prep, Receiving, Counts, Ordering, PM report); "Note (optional)" box (no placeholder text); button "ASSIGN TASK".
- Shot: img/manager/10-assign-task.png

## Step 11 — opening-verify
- URL: /operations/opening?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Board → Take or assign tasks → "OPENING PREP".
- Saw: "OPENING REPORT", "Phase 1 — Verification", "Verify last night's closing matches reality. Tap each station once you've checked it; add a comment if anything looks off."; tabs "PHASE 1 · VERIFY" and "PHASE 2 (LOCKED)"; station cards in two columns (Crunchy Boi Station "0 of 4 done" open by default), each with a "VERIFIED" button; bottom bar "0 of 44 verified · 0 of 8 temp readings entered", "44 items not yet verified", "SHOW ME WHAT NEEDS FIXING", greyed "SUBMIT OPENING". Cards: Crunchy Boi Station, 3rd Party Station, Walk Ins Station, Prep Fridge, Prep Area, Back Line Open, Expo Station, Front of House Open, Manager Open, Walk-Out Verification; prep sections Veg, Cooks, Sides, Sauces, Slicing (each "VERIFY SECTION", "Recount items without closer data first").
- Shot: img/manager/11-opening-verify.png

## Step 12 — opening-station-verified
- URL: /operations/opening?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "VERIFIED" on Crunchy Boi Station.
- Saw: "✓ VERIFIED"; lines "Station appears clean as reported", "Crunchy Boi Fridge temp (≤41°F)" (empty box showing "—"), "Sauces topped off & dated correctly", "Station ready for service (containers placed, prep ready)", each with "ADD COMMENT". The card says "3 of 4 done" with all four lines ticked; bottom bar "4 of 44 verified · 0 of 8 temp readings entered", "Saved a moment ago".
- Shot: img/manager/12-opening-station-verified.png
- Confused: the card reads "3 of 4 done" while all four lines show ticks (it reads "4 of 4 done" once the temp is typed).

## Step 13 — opening-section-verify
- URL: /operations/opening?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Typed 36 in the Crunchy Boi fridge temp box. Opened Veg: "Verify section" was greyed and no row showed a "Closer count", so typed 2 in each OPENER RECOUNT box (Iceberg, Onion, Basil, Radish, Cucumber, Tomato). A box "NO PRIOR CLOSING DATA DETECTED — 6 item(s) had no closing count from last night — morning recounts were entered. Confirm the reason:" appeared with radios "Location was closed (planned)" and "Closing was missed / I don't know"; chose the second. Tapped "Verify section — Veg".
- Saw: Veg "✓ VERIFIED", "6 of 6 done"; each row shows its name, "ADD COMMENT" and an "OPENER RECOUNT" box holding 2. The filled recount boxes are NOT red (pale yellow panel).
- Shot: img/manager/13-opening-section-verify.png

## Step 14 — opening-ready
- URL: /operations/opening?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Verified the other nine stations; typed 37, 38, 35, 36, 37, 38, 36 into the seven other fridge temp lines (3rd-Party, Walk-In, Sauce, 3-Door, Back-Line Drinks, Deli Display, FOH Drinks fridges) after expanding each station (a "Temp reading required for …" button shows until typed); typed 2 in every recount box of Cooks, Sides, Sauces and Slicing and verified each section.
- Saw: box "NO PRIOR CLOSING DATA DETECTED — 38 item(s) had no closing count from last night — morning recounts were entered. Confirm the reason:" with the second radio chosen and "Attestation: Closing was missed / I don't know"; bottom bar "44 of 44 verified · 8 of 8 temp readings entered", "Submit ready", "Saved a moment ago", enabled "SUBMIT OPENING".
- Shot: img/manager/14-opening-ready.png

## Step 15 — opening-submitted
- URL: /operations/opening?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "SUBMIT OPENING" (it went straight to Phase 2).
- Saw: page title now "Phase 2 — Prep Entry"; "Type what you prepped for each item. Each row saves when you leave its box."; tabs "PHASE 1 · VERIFY" and "PHASE 2 — PREP ENTRY"; "SHOW ME WHAT NEEDS FIXING"; Veg "✓ VERIFIED"; first row Iceberg "Par: 7 × 1/3 Pan", "CLOSER COUNT: 2 × 1/3 Pan", "PREP NEED: 5 × 1/3 Pan", empty "OPENER PREPPED" box. Quantities read "5 × 1/3 Pan". Bottom bar "44 of 44 verified · 8 of 8 temp readings entered · 0 of 38 prep entries", greyed "FINALIZE PHASE 2 (38 OUTSTANDING)".
- Shot: img/manager/15-opening-submitted.png

## Step 16 — opening-prep-entry
- URL: /operations/opening?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Scrolled down one screen.
- Saw: rows Iceberg (end of its row), Onion (Par: 8 Quart, closer 2 Quart, need 6 Quart), Basil (Par: 4 Quart, need 2 Quart), each with an empty "OPENER PREPPED" box, a "Uses: … tap to confirm usage" bar and "Not saved".
- Shot: img/manager/16-opening-prep-entry.png

## Step 17 — opening-prep-filled
- URL: /operations/opening?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Typed 5, 6, 2 in the first three rows; tapped outside each. Tapped a heading to clear focus, then scrolled so Iceberg shows whole.
- Saw: Iceberg "OPENER PREPPED 5", "Uses: 1.02 Iceberg · ~685 oz", "At par", "Saved by Nicole Boyd at 10:18 PM", "UNDO"; Onion "6", "Uses: 0 Onion (red) · ~2 oz", "At par", "Saved by Nicole Boyd at 10:18 PM", "UNDO". Basil (2) saved the same way just below the frame. No blue focus ring.
- Shot: img/manager/17-opening-prep-filled.png
- Confused: only two of the three saved rows fit in the frame with Iceberg complete.
- Bug?: a row where I typed 0 but Prep need was higher (Vin, Ranch, Turkey, Ham, Capicola, Pepperoni, Genoa, Provolone, Mortadella, Cheddar) did not save: it showed "BELOW PREP NEED BY n — TAP TO RECORD REASON" and "Add a reason to save", while the typed 0 stayed in the box and the footer kept counting it as outstanding. Not a defect by itself (a reason is required) but easy to miss; typing the Prep need number saved them.

## Step 18 — opening-finalize
- URL: /operations/opening?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Filled the other 35 rows with their Prep need number (0 on "No par set" rows), then tapped "FINALIZE PHASE 2".
- Saw: bottom bar "44 of 44 verified · 8 of 8 temp readings entered · 38 of 38 prep entries", "Phase 2 already finalized", disabled button "PHASE 2 FINALIZED"; rows greyed and read-only, each "At par" with "Saved by Nicole Boyd at …".
- Shot: img/manager/18-opening-finalize.png

## Step 25 — pulse
- URL: /mid-shift?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Opening done, so went Dashboard → Explore → "Mid-Shift Pulse" (the sim clock read 10:23 PM).
- Saw: "Mid-shift Pulse", "MEP · Capitol Hill", "Updated 10:23 PM", "Refreshes every 60 s". "Needs attention — as of 10:23 PM", "See more", one red "NEEDS ACTION" group, every dot red, in this order: "Closing is overdue" (OPEN), "Mid-day Prep is overdue" (OPEN), "Cardinal Bakery: missed the 3:00 PM cutoff — call the vendor" (ORDER), "PFG: missed the 4:00 PM cutoff — call the vendor" (ORDER), "Trimark: missed the 6:00 PM cutoff — call the vendor" (ORDER), "Boar's Head: missed the 3:00 PM cutoff — call the vendor" (ORDER), "3rd Party Station is uncovered" (ASSIGN), "Expo Station is uncovered" (ASSIGN), then "+9". No yellow items showed.
- Shot: img/manager/25-pulse.png
- Confused: no yellow items and no "Not available for your role." message anywhere; it is late evening in the sim so the overdue items lead.

## Step 26 — pulse-full
- URL: /mid-shift?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Full-page shot.
- Saw: card headings in order: "Needs attention", "Live shop floor" (hint "Tap a station for details.", button "MAP VIEW", legend "Green covered · amber short, closing soon or past its close time · red uncovered · grey closed"), "People" ("Here now (1) — 0 stations covered · 10 open", Nicole Boyd "No station · Active in CO-OPS"), "Stations & tasks" ("0 covered · 0 short · 0 closing soon · 0 to close now · 10 uncovered · 0 closed", "Tasks: 1 done · 0 left", stations UNCOVERED), "Catering" ("No catering due today.", "Tomorrow: no catering booked", "Prep: AM Not started · mid-day Not started", "NOT RUNG INTO TOAST — Every ezCater order is in Toast."), "Inventory" ("Last par walk 8:29 PM by Nicole Boyd", "1 item at 86 risk", "RUNNING LOW VS PAR: Bread Knives 0% of par · order 2", "ORDER CUTOFFS TODAY" four missed cutoffs), "Food safety" ("All fridges checked and in range.", "8 in range · 0 out of range · 0 unchecked", the eight fridges with my temps 35–38°F), "Handoff" ("Reports: 1 done · 4 left", chips OPENING, AM PREP, MID-DAY PREP, CASH DEPOSIT, CLOSING, "No handoff notes for today."). No Sales card and no "Not available for your role." card.
- Shot: img/manager/26-pulse-full.png

## Step 27 — pulse-section
- URL: /mid-shift/people?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "See more" on the People card; photographed; tapped "‹ Pulse" to go back.
- Saw: "‹ PULSE"; "People — as of 10:23 PM"; "Here now (1) 0 stations covered · 10 open"; "Nicole Boyd — No station · Active in CO-OPS"; "TIMELINE — Nothing to show yet."; link "Stations".
- Shot: img/manager/27-pulse-section.png

## Step 28 — handoff-write
- URL: /mid-shift/handoff?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Pulse → Handoff card "See more". Chose "For everyone" (options: For everyone, For crew, For managers) and typed the note in "Note".
- Saw: "Handoff — as of 10:24 PM", "Reports: 1 done · 4 left", chips OPENING (green) AM PREP MID-DAY PREP CASH DEPOSIT CLOSING, "No handoff notes for today.", "WRITE A HANDOFF NOTE", "Who should see it" = "For everyone", "Note" holding "Bread comes early tomorrow. Clear a shelf in the prep fridge first.", "POST NOTE". The Note box had no placeholder text.
- Shot: img/manager/28-handoff-write.png

## Step 29 — handoff-posted
- URL: /mid-shift/handoff?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "POST NOTE". Did not tap Retract.
- Saw: note card "FOR EVERYONE", "Nicole Boyd · 10:24 PM", the note text, buttons "GOT IT" and "RETRACT"; the form cleared and "POST NOTE" greyed.
- Shot: img/manager/29-handoff-posted.png

## Step 19 — receiving
- URL: /operations/receiving?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Pulse → Dashboard → Assignments → "RECEIVING". Did not check Reports Hub → Inventory → Receiving.
- Saw: "‹ DASHBOARD" and "ORDERING ›" at the top, clear of the round user button; "Receiving"; step 1 "COUNT THE DELIVERY" with "Vendor" list ("Pick a vendor…", Amazon, Baldor, Berger, Boar's Head, Cardinal Bakery, Continental Tape, Costco, Country Snacks, Cristian, District Bakery, Leonard Paper, Penny Candy, PFG, Sarah, Saval, Sysco, Thompson Delivers, Trimark, US Foods, Vistaprint, Webstaurant, "+ New store"), "Delivery date" 10/14/2026, "Invoice #" (placeholder "From the paperwork"), "Invoice total ($)" (no placeholder), "Pick a vendor to load its usual order."; step 2 "RECEIPT PHOTO" ("Snap the invoice or packing slip. It settles any credit later.", "Take receipt photo", "Photo later"); "Notes" (placeholder "Anything to flag about this delivery…"); step 3 greyed "DELIVERY CONFIRMED" and "SAVE PARTIAL — TRUCK STILL UNLOADING"; "RECENT DELIVERIES" with "Download CSV PDF" and "No deliveries logged yet."
- Shot: img/manager/19-receiving.png

## Step 20 — receiving-vendor
- URL: /operations/receiving?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Picked Baldor in "Vendor".
- Saw: "Saved on device 10:25 PM"; Vendor "Baldor"; "Scan" with "Scanner ready"; "Prices from the invoice"; one usual-order line "Cholula — Tap to count (units)" with a dashed "—" box; "Pick a SKU…" list (Cholula, Cannoli Shell, Fresh Mozzarella, Ham, Lettuce, Onions, Salami, White Cheddar) and "+ Add item" (greyed).
- Shot: img/manager/20-receiving-vendor.png
- Confused: Baldor's usual order has only the Cholula line (no lettuce line), so I used the first line.

## Step 21 — receiving-didnt-arrive
- URL: /operations/receiving?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Opened the Cholula line, typed 1 in "Qty (units)", tapped "Short".
- Saw: line "Cholula", "Suggested — from this vendor's usage", "Done", "QTY (UNITS)" with − 1 +, "No pack chain — enter quantity in packs.", "FLAG A PROBLEM": Short (pink, selected), Over, Damaged, Sub; "PRICE/PACK ($)", "OZ/EACH (OPT)" boxes; "Line note (optional)" box (placeholder "Line note (optional)"); "Add photo".
- Shot: img/manager/21-receiving-didnt-arrive.png

## Step 22 — receiving-confirmed
- URL: /operations/receiving?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Typed SIM-1001 in "Invoice #" and 120.00 in "Invoice total ($)", ticked "Photo later", tapped "DELIVERY CONFIRMED". It confirmed at once (only one line), so no "Some expected items were never confirmed" list and no "Tap again to confirm" showed.
- Saw: green box "Delivery recorded — 1 line(s), Baldor." with link "View this delivery"; "Open vendor credits — 1 open"; "RECENT DELIVERIES" with "Baldor 2026-10-14", pill "PHOTO MISSING", "1 item(s) · #SIM-1001 · Nicole Boyd"; the form reset to "Pick a vendor…".
- Shot: img/manager/22-receiving-confirmed.png

## Step 23 — midday-start
- URL: /operations/mid-day?instance=<id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Board → "MID-DAY PREP" ("No mid-day preps started today.") → "+ NEW MID-DAY PREP".
- Saw: "MID-DAY PREP", "Phase 1 — count to par"; VEG "0 of 6 done" (Pickles PAR 20 QUART, Sweet Peppers PAR 12 QUART, Hot Peppers PAR 12 QUART, Basil PAR 4 QUART, Shredded Mozzarella PAR 5 QUART, Fresh Mozzarella PAR 12 QUART), each with an "On hand" box; SAUCES "0 of 10 done"; COOKS "0 of 1 done"; "SUBMIT COUNT → PHASE 2".
- Shot: img/manager/23-midday-start.png

## Step 24 — midday-filled
- URL: /operations/mid-day?instance=<id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Typed 4 in Pickles "On hand" and 2 in Sweet Peppers "On hand".
- Saw: "Pickles — PAR 20 QUART · NEED: 16 QUART" with 4; "Sweet Peppers — PAR 12 QUART · NEED: 10 QUART" with 2; VEG "2 of 6 done".
- Shot: img/manager/24-midday-filled.png

## Step 24b — midday-phase2-saved
- URL: /operations/mid-day?instance=<id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "SUBMIT COUNT → PHASE 2" (it went through with no refusal and no Bulk backup message). On "Phase 2 — prep" typed 16 in Pickles "Prepped" and tapped its "SAVE".
- Saw: "Phase 2 — prep"; VEG "1 of 6 done"; Pickles "NEED: 16 QUART", box holding 16 (shown in full), "SAVE", "Uses: 0.03 Pickle slices · ~8 oz tap to confirm usage", "SAVED ✓"; Sweet Peppers "NEED: 10 QUART" with an empty "Prepped" box and "SAVE"; Hot Peppers and Basil likewise; "FINALIZE PREP".
- Shot: img/manager/24b-midday-phase2-saved.png

## Step 24c — midday-finalized
- URL: /operations/mid-day?instance=<id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Saved Sweet Peppers (10) and Hot Peppers (12) the same way, then tapped "FINALIZE PREP".
- Saw: title "Finalized — prep made"; green bar "Finalized at 10:28 PM by Nicole Boyd"; VEG rows "Pickles NEED: 16 QUART · MADE: 16 QUART", "Sweet Peppers NEED: 10 QUART · MADE: 10 QUART", "Hot Peppers NEED: 12 QUART · MADE: 12 QUART", "Basil NEED: 4 QUART · MADE: —", Shredded Mozzarella, Fresh Mozzarella; SAUCES (Aioli, HC Aioli, HP Mayo, Mustard Aioli, Horsey Mayo, Salsa Verde, Dukes, Vin, Caesar Dressing "NEED: — · MADE: —", Lemon Oil); COOKS (Chicken Cutlet). The text "The interactive count and prep forms ship in the next build." did NOT show. No row offered "Add over/under reason". Phase 1 labels: On hand, PAR, NEED; Phase 2 labels: Prepped, NEED, SAVE, Uses, "tap to confirm usage", "SAVED ✓", FINALIZE PREP.
- Shot: img/manager/24c-midday-finalized.png

## Step 30 — closing-overview
- URL: /operations/closing?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Dashboard → "START CLOSING" (Today's operations card).
- Saw: "CLOSING CHECKLIST", "MEP · Capitol Hill", "PROGRESS 2/61" with a bar; station sections with counts: Crunchy Boi Station 0 of 6 (open), 3rd Party Station 0 of 6, Walk Ins Station 0 of 6, Prep Fridge 0 of 6, Shut Down Back Line 0 of 4, Expo Station 0 of 5, Clean Front of House 0 of 7, Prep Area 0 of 9, Closing Manager 2 of 7, Walk-Out Verification 0 of 5; banner "Tonight's AM prep count isn't in yet. The closer does it before lock-up."
- Shot: img/manager/30-closing-overview.png

## Step 31 — closing-full
- URL: /operations/closing?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Opened every section, scrolled to the top, waited (no "Loading"), took a normal screen shot (not full page).
- Saw: top of the page with "Progress 2/61" in its normal place, Crunchy Boi Station open (Restock, Wipe inside & outside, Wipe tops of sauce bottles, Combine & check dates on sauces, Pull out station and sweep, Crunchy Boi Fridge temp (≤41°F)) and Expo Station open (Change & stock cannoli pan, Wipe out deli display fridge, Restock bevs, Cookies & gluten free, Deli Display Fridge temp (≤41°F)). Section lines per station (all "not completed"): 3rd Party / Walk Ins / Prep Fridge — the same five chores plus "3rd-Party Fridge temp", "Walk-In Fridge temp (≤41°F)" (with note "Record cooler temp in Fahrenheit") and "Sauce Fridge temp"; Shut Down Back Line — Wipe down burners, Wipe down tile walls, Wipe wall under prep tables, Back-Line Drinks Fridge temp; Clean Front of House — Bathrooms, Patio furniture, Sweep, Mop, Restock bev fridge, Put away / organize cases, FOH Drinks Fridge temp; Prep Area — Organize Back Walk In, Clean Oven Window, Organize Smallwares & Utensils, Organize Dry Storage, Wipe down 3 door fridge, Wipe out 3 bay sink, Drain & turn off dish Machine, Trash to dumpster, 3-Door Fridge temp.
- Shot: img/manager/31-closing-full.png
- Confused: sections sit in two columns, so Expo Station lands beside Crunchy Boi Station instead of in the listed order. No "awaiting higher role" marks anywhere.

## Step 31a — closing-report-lines
- URL: /operations/closing?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Scrolled down to the Closing Manager and Walk-Out Verification sections.
- Saw: Closing Manager (2 of 7 done): "Count the drawer", "Count and secure tips" ("Count tips, place in safe. Weekly distribution handled separately by…"), "AM Prep List — Pending — tap to open", "Opening verified — Submitted by Nicole Boyd at 10:22 PM" (ticked green), "Mid-day Prep ×1 — Submitted by Nicole Boyd at 10:28 PM" (ticked green, from my finalize), "Cash deposited — Pending — tap to open", "PM Report submitted — Pending — tap to open". Walk-Out Verification "0 of 5 done" opens with "Lights off" at the bottom edge; the rest are Devices charging, Oven off, Front doors locked, Back door locked.
- Shot: img/manager/31a-closing-report-lines.png
- Confused: the Closing Manager card and the Walk-Out lines are too tall for one screen, so only the first Walk-Out line fits under the report lines.

## Step 31b — closing-temp-line
- URL: /operations/closing?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "Crunchy Boi Fridge temp (≤41°F)"; a box opened; typed 38 in "Temp (°F)".
- Saw: box with label "TEMP (°F)" (placeholder "e.g. 38") holding 38, "NOTES (OPTIONAL)" (placeholder "Anything noteworthy?"), yellow "SAVE" and "Cancel". Then tapped "SAVE": the line turned ticked ("completed by you at 10:30 PM"), shows "38° · you · 10:30 PM" and an "UNDO" button; the section reads "1 of 6 done".
- Shot: img/manager/31b-closing-temp-line.png

## Step 41 — am-prep
- URL: /operations/am-prep?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Board → "AM PREP".
- Saw: "AM PREP", "MEP · Capitol Hill"; Veg "0 of 6 done" with columns PAR, ON HAND, BACK UP, TOTAL: Iceberg 7 1/3 Pan, Onion 8 Quart, Basil 4 Quart, Radish 1 Quart, Cucumber 3 Quart, Tomato "Prep Daily"; a red "Required" tag under each ON HAND box; sections Cooks "0 of 6 done", Sides "0 of 6 done", Sauces "0 of 11 done", Slicing "0 of 9 done", Misc "0 of 4 done"; bar "Fix 42 issues before submitting" with "SHOW ME WHAT NEEDS FIXING" and a greyed "FIX ISSUES BEFORE SUBMITTING".
- Shot: img/manager/41-am-prep.png

## Step 42 — am-prep-filled
- URL: /operations/am-prep?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Typed 2 (Iceberg), 1 (Onion), 3 (Basil) in ON HAND, then tapped a heading to clear focus.
- Saw: Veg "3 of 6 done"; Iceberg 2/ total 2, Onion 1/ total 1, Basil 3/ total 3 (TOTAL shaded boxes fill in by themselves); the other rows still show "Required"; bar now "Fix 39 issues before submitting". No blue focus ring.
- Shot: img/manager/42-am-prep-filled.png

## Step 43 — am-prep-submitted
- URL: /operations/am-prep?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Typed 1 in every other first box (Radish, Cucumber, Tomato, all Cooks, Sides "PORTIONED", Sauces "LINE", Slicing "LINE" boxes) leaving BACK UP empty; tapped YES on the four Misc questions (Meatball mix - ready?, Meatballs - ready to cook?, Meatballs - for reheat?, Cook Bacon?; each YES / NO; "Notes" box with placeholder "Add notes…"); a "Saved" tag showed; tapped "SUBMIT AM PREP". It went through the first time with no refusal.
- Saw: green banner "AM Prep submitted at 10:31 PM by Nicole Boyd"; Veg and Sauces "✓", "6 of 6 done" and "11 of 11 done", every box read-only.
- Shot: img/manager/43-am-prep-submitted.png

## Step 32 — pm-report
- URL: /pm-report?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Board → "PM REPORT". Picked nothing yet.
- Saw: "PM Report"; "SHIFT ACTIVITY" with "Nicole Boyd 145 items · 3 reports", Opening 10:22 PM, AM Prep 10:31 PM, Mid-day Prep 10:28 PM, Cash Deposit "Not started", Closing "Overdue"; "MVP" list ("No MVP", Nicole Boyd) with "SAVE"; "ATTITUDE" heading and the Nicole Boyd grade card starting at the bottom edge. Under the card (below the frame): lines ARRIVED READY, ATTITUDE, PRODUCTION, TEAM PLAYER, each Great / Good / Needs work with nothing picked; "AREA TO IMPROVE" (placeholder "What should they work on?"); "NOTE (MANAGERS ONLY)" (placeholder "Private note for managers", hint "Only managers see this note"); hint "Pick a grade on every line to save."; "SAVE"; "Select employee…" list (Angel Reyes, Dana Brooks, Luis Herrera, Marcus Webb); "SUBMIT PM REPORT".
- Shot: img/manager/32-pm-report.png
- Confused: only Nicole Boyd was listed at first. No grade was pre-picked. A stray heading "ATTITUDE" sits above the first card.

## Step 33 — pm-grades
- URL: /pm-report?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Nicole Boyd: Arrived ready Good, Attitude Great, Production Good, Team player Good, "SAVE". Then added Angel Reyes with "Select employee…": Arrived ready Good, Attitude Good, Production Needs work, Team player Good, typed "Restock lids before the rush." in "Area to improve", "SAVE".
- Saw: two cards side by side, "Nicole Boyd" and "Angel Reyes", with the picked grades highlighted and the area-to-improve text on Angel's card. After a card was saved its "Pick a grade on every line to save." hint disappeared; there was no separate "Saved" message.
- Shot: img/manager/33-pm-grades.png

## Step 34 — pm-mvp
- URL: /pm-report?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: In "MVP" picked Nicole Boyd; a "Why MVP?" box appeared; typed the sentence; tapped "SAVE".
- Saw: "MVP" list showing "Nicole Boyd", "Why MVP?" box holding "Kept the line moving all lunch.", "SAVE".
- Shot: img/manager/34-pm-mvp.png

## Step 35 — pm-submitted
- URL: /pm-report?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "SUBMIT PM REPORT".
- Saw: green banner "Submitted 10:33 PM by Nicole Boyd"; Shift activity as before; the two grade cards (Nicole Boyd, Angel Reyes) now greyed and read-only with the saved grades.
- Shot: img/manager/35-pm-submitted.png

## Step 36 — cash-deposit
- URL: /cash?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Board → "CASH REPORT".
- Saw: "Cash Deposit"; left "CASH": "Projected (from Toast)" box (placeholder "0.00"), buttons "Enter total" (selected) and "Count by denomination", "Drawer total" box (placeholder "0.00"), "$200 stays in the register", "Over/short note (optional)" box (no placeholder); right "TIPS": "Cash tips" box (placeholder "0.00"); "ON SHIFT TODAY" tick boxes Angel Reyes, Dana Brooks, Luis Herrera, Marcus Webb, Nicole Boyd, button "+ Add"; "SIGN & SUBMIT DEPOSIT". No deposit/over-short line until both numbers were typed.
- Shot: img/manager/36-cash-deposit.png

## Step 37 — cash-filled
- URL: /cash?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Kept "Enter total". Typed 845.00 in Projected (from Toast), 1045.00 in Drawer total, 62.00 in Cash tips; ticked Nicole Boyd; left the over/short note empty.
- Saw: line "Deposit $845.00 · Even" under "$200 stays in the register" (it appeared only after both projected and drawer were typed); Nicole Boyd ticked.
- Shot: img/manager/37-cash-filled.png

## Step 38 — cash-pin
- URL: /cash?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "SIGN & SUBMIT DEPOSIT".
- Saw: a PIN pop-up over the dimmed form: badge "ASSISTANT GENERAL MANAGER", "Nicole Boyd", "Enter your 4-digit PIN", four dots, keypad 1-9, "Clear", 0, "← Back", "Use system keyboard".
- Shot: img/manager/38-cash-pin.png

## Step 39 — cash-submitted
- URL: /cash?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped 8 four times on the keypad.
- Saw: green bar "Deposited $845.00 · signed by Nicole Boyd at 10:34 PM"; read-only rows "Projected (from Toast) $845.00", "Drawer total $1,045.00", "Even $0.00", "Deposit $845.00 $845.00", "Cash tips $62.00", "On shift today: Nicole Boyd".
- Shot: img/manager/39-cash-submitted.png

## Step 40 — closing-walk-out
- URL: /operations/closing?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Dashboard → "CONTINUE CLOSING". Tapped each of the five Walk-Out Verification lines once, one at a time, waiting for each to save (Lights off, Devices charging, Oven off, Front doors locked, Back door locked). Every line saved with one tap.
- Saw: Walk-Out Verification "✓ 5 of 5 done"; each line ticked with "UNDO", "you · 10:35 PM" and "Add note" under it; bottom of the page: floating pill "REVIEW & SUBMIT · 11/61" and the big button "REVIEW & SUBMIT (INCOMPLETE)" below it. The sticky "Progress 11/61" bar sits at the top of the frame.
- Shot: img/manager/40-closing-walk-out.png
- Confused: the whole Walk-Out card (all five lines) plus the Review pill do fit in this frame, but the top line "Lights off" is partly under the sticky Progress bar; the big "REVIEW & SUBMIT (INCOMPLETE)" button is cut by the floating pill at the bottom.

## Step 44 — closing-review
- URL: /operations/closing?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "REVIEW & SUBMIT (INCOMPLETE)". A review panel opened ("11 of 61 required done", "REVIEW & SUBMIT", "Some required items aren't done — explain why") with one "Why couldn't this be completed?" box per unfinished line (50 boxes, labelled like "CRUNCHY BOI STATION · RESTOCK" … "PREP AREA · 3-DOOR FRIDGE TEMP (≤41°F)"). Typed "Sim walk — not done on this test day." in every one. The "CONTINUE" button was greyed until all were filled.
- Saw: the last reason boxes (Prep Fridge Sauce Fridge temp, Shut Down Back Line Back-Line Drinks Fridge temp, Expo Station Deli Display Fridge temp, Clean Front of House FOH Drinks Fridge temp, Prep Area 3-Door Fridge temp), all filled; yellow "CONTINUE"; floating pill "REVIEW & SUBMIT · 11/61"; the panel also had "HIDE REVIEW".
- Shot: img/manager/44-closing-review.png
- Confused: the listed 11 lines in the intro text and the 50 boxes disagree (the panel's first rows name Restock / Wipe inside & outside etc., not only the temp lines).

## Step 45 — closing-pin
- URL: /operations/closing?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "CONTINUE".
- Saw: pop-up "Confirm with your PIN", "Enter your 4-digit PIN to confirm this action.", four dots, keypad 1-9, Clear, 0, "Cancel", "Use system keyboard".
- Shot: img/manager/45-closing-pin.png

## Step 46 — closing-confirmed
- URL: /operations/closing?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped 8 four times; waited; scrolled to the top.
- Saw: amber banner "Closing submitted with incomplete items · 10:37 PM by you"; card "REASONS GIVEN FOR UNFINISHED LINES" listing each line — "Restock — Sim walk — not done on this test day. · you", "Wipe inside & outside — …", "Wipe tops of sauce bottles — …", "Combine & check dates on sauces — …", "Pull out station and sweep — …" and so on (repeated per station, including "Walk-In Fridge temp (≤41°F) — …"); the checklist lines below are disabled ("instance incomplete_confirmed"). No "Cash deposit required" and no "Just modified by someone else" message.
- Shot: img/manager/46-closing-confirmed.png

## Step 47 — counts
- URL: /operations/counts?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Board → "COUNTS" (it already read "Taken by Nicole Boyd"). Did not check Reports Hub → Inventory → Counts and variance.
- Saw: "Inventory Audit", "Run when the owner calls for a full audit. Day to day, the system infers on-hand from deliveries, production, and sales."; "NEW AUDIT" card: hint "Count each unit once: full containers, then loose units below. Never count the same stock twice.", "Pick an item…" list (1/2 pint bottoms (flexi), 1/2 pint top (flexi), 2 oz portion cup lids, 2 oz portion cups, … long list), "UNIT" box (placeholder "Unit (e.g. tub)"), "HOW MANY", "Loose (below a full container)" tick with "Partial" box (placeholder "e.g. 0.5"), "+ Add item", "Note" (placeholder "Anything to flag about this audit…"), greyed "RECORD AUDIT". Right: "ON HAND", "Download CSV PDF", "Anchored to the audit on Wed, Oct 14.", rows "1/2 pint bottoms (flexi) 4.0 oz on hand", "1/2 pint top (flexi) 2.0 oz on hand", "2 oz portion cup lids 6.0 oz on hand", "Banana Peppers — 1 vendors unknown", "Capicola 438.0 oz on hand +712.0 oz over". "below zero — count it" pills on Ham, Hot Peppers, Iceberg, Pepperoni, Provolone, Sweet Peppers (each "0.0 oz on hand").
- Shot: img/manager/47-counts.png

## Step 48 — counts-filled
- URL: /operations/counts?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: First tried the first three items on the list (1/2 pint bottoms, 1/2 pint top, 2 oz portion cup lids). Their "Unit" stayed a TEXT box; I typed "each" and counts 4, 2, 6, and Record audit turned active. Tapping "RECORD AUDIT" then asked for the password; after "CONFIRM" the audit did NOT save and the page showed in red: "Can't convert "each" to ounces for 1/2 pint bottoms (flexi) — nothing was saved. Pick a unit from that item's list, or remove the line and have its pack size or average weight added first." So I used items whose Unit is a pick list: Capicola (Unit list "piece"; 4), Cheddar (Unit list "case"; 2), Basil (Unit list "case"; 6). One tap on "+ Add item" adds a new blank line. (I also reloaded the page once with `goto /operations/counts` and `back` to clear the old lines; the page arrived on the dashboard first, then `back` returned.)
- Saw: three lines: "Capicola — Unit piece — How many 4", "Cheddar — Unit case — 2", "Basil — Unit case — 6" (third line cut at the bottom of the frame), each with "Loose (below a full container)", "Partial" (placeholder "e.g. 0.5"), "Remove"; "No deliveries recorded here yet" and "Count by vendor instead" on items with no deliveries; the ON HAND list beside them.
- Shot: img/manager/48-counts-filled.png
- Bug?: the first three items offered by "Pick an item…" have no unit list, so a typed "each" is refused at Record audit ("Can't convert "each" to ounces …") even though the Record audit button looks ready. This is the case the retake was meant to avoid.

## Step 49 — counts-password
- URL: /operations/counts?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "RECORD AUDIT" with the Capicola / Cheddar / Basil lines.
- Saw: pop-up "Confirm your password", "Re-enter your password to confirm this action.", "PASSWORD" box (no placeholder), black "CONFIRM" (red label), "Cancel".
- Shot: img/manager/49-counts-password.png

## Step 50 — counts-recorded
- URL: /operations/counts?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Typed sim-nicole-pw, tapped "CONFIRM".
- Saw: the form cleared (the "Pick an item…" box empty again); "Anchored to the audit on Wed, Oct 14."; the on-hand list: Capicola now "230.0 oz on hand" (the +712.0 oz over pill gone); amber note under the form "Capicola: no deliveries recorded here yet, so all 230 oz was counted under Boar's Head. Count by vendor to split it."
- Shot: img/manager/50-counts-recorded.png
- Confused: no green "Recorded" message showed; the cleared form, the note and the changed Capicola figure were the only signs it saved.

## Step 51 — ordering-walk
- URL: /ordering?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Board → "ORDERING" (it read "Taken by Nicole Boyd"). Did not check Reports Hub → Inventory → Ordering. A "RECEIVING ›" link sits top right and "‹ DASHBOARD" top left.
- Saw: "Ordering walk — Wed, Oct 14", "MEP · Capitol Hill"; red box "MISSED CUTOFF — CALL THE VENDOR": "Boar's Head: the 3:00 PM cutoff passed with no order placed", "Cardinal Bakery: the 3:00 PM …", "PFG: the 4:00 PM …", "Trimark: the 6:00 PM …"; "TODAY'S ORDERS": Baldor MEP-20261014-BALDOR 1 lines Draft; Boar's Head MEP-20261014-BOARSH 12 lines Draft; PFG MEP-20261014-PFG 5 lines Draft; Trimark MEP-20261014-TRIMAR 2 lines Draft; Webstaurant MEP-20261014-WEBSTA 1 lines Draft; below the frame "CUTOFF TODAY — 1 to draft" (Cardinal Bakery, "Missed the 3:00 PM cutoff — call the vendor", "GENERATE DRAFT"), "Order history 9", "Par tuning hasn't run at this shop yet.", "Recent walks 10", vendor lists (Baldor 1 SKUs ORDER DAY, Amazon 7, Boar's Head 26 Cutoff 3:00 PM, Continental Tape 1, Leonard Paper 20, Penny Candy 1, PFG 73 Cutoff 4:00 PM, Sarah 1, Trimark 16 Cutoff 6:00 PM, US Foods 1, Vistaprint 1, Webstaurant 4); bottom bar "0 SKUs marked" and greyed "REVIEW ORDER".
- Shot: img/manager/51-ordering-walk.png
- Confused: five draft orders already exist at the start of a "fresh" day.

## Step 52 — ordering-adjusted
- URL: /ordering?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: No Duke's Mayo or Iceberg on the lists I opened, so used the first line, Baldor's Cholula, "+" twice (box reads 2), and opened Trimark and tapped "+" once on its first line, Bleach Gallons. (A stray tap on "Baldor" in Today's orders opened a draft detail; closed it with "Close".)
- Saw: Baldor "1 SKUs · ORDER DAY · 1 marked" header in full; Cholula "Par 0.5", "Each", "~0.8 Each on hand · par-pass", "last: 1", "ORDER TO PAR (EACH)" with − 2 +, buttons "Suggest 0", "Empty · order 1", "We're full · 0", "Clear"; bottom bar "2 SKUs marked" and yellow "REVIEW ORDER".
- Shot: img/manager/52-ordering-adjusted.png

## Step 53 — ordering-review
- URL: /ordering?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "REVIEW ORDER".
- Saw: "Review order", "Close"; "2 vendor orders · 0 marked full"; Baldor: SKU / ITEM # / QTY, BALDOR, "Cholula SAUCE6B 2 Each"; Trimark: "Bleach Gallons — 1 Each (no case)"; each "Delivery options (email, portal, phone) appear once you submit."; "Keep walking", "RECORD WALK · 2 SKUS".
- Shot: img/manager/53-ordering-review.png

## Step 54 — ordering-draft
- URL: /ordering?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "RECORD WALK · 2 SKUS". Stopped there.
- Saw: green "Walk recorded — 2 SKUs."; links "Baldor: added to today's draft — PO MEP-20261014-BALDOR" and "Trimark: added to today's draft — PO MEP-20261014-TRIMAR"; heading "DRAFT ORDERS" (no rows under it in this frame) and "START A NEW WALK". The Today's orders list above is unchanged (Baldor 1 lines, Trimark 2 lines).
- Shot: img/manager/54-ordering-draft.png

## Step 55 — production
- URL: /operations/production?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Dashboard → Explore → "Production" (no goto). It opened on Capitol Hill (the URL carries the Capitol Hill id; the page itself shows no shop name).
- Saw: "Production"; link "YIELD VARIANCE →"; card "LOG A CONVERSION": "Raw item (SKU)" list ("Pick a SKU…", then every SKU with "(N in stock)", e.g. "Cheddar (-2 in stock)", "Cholula (1 in stock)"), "Amount used (packs)", "Amount made", "Notes" (no placeholder), greyed "LOG PRODUCTION"; "RECENT PRODUCTION" starting with "0 Sweet Peppers → 10 Sweet Peppers · Wed, Oct 14" and "0 Hot Peppers → 12 Hot Peppers" (made by my mid-day prep).
- Shot: img/manager/55-production.png

## Step 56 — production-filled
- URL: /operations/production?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Picked "Cheddar (-2 in stock)" in "Raw item (SKU)"; a "Makes" list appeared with only "Cheddar"; picked it; typed 1 in "Amount used (packs)" and 4 in "Amount made".
- Saw: "Raw item (SKU) Cheddar (-2 in stock)", "Makes Cheddar", "Amount used (packs) 1", "Amount made · Predicted output: 4" holding 4, "Notes", enabled "LOG PRODUCTION".
- Shot: img/manager/56-production-filled.png

## Step 57 — production-logged
- URL: /operations/production?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "LOG PRODUCTION".
- Saw: the form reset ("Pick a SKU…"); "RECENT PRODUCTION" now starts with "1 Cheddar → 4 Cheddar · Wed, Oct 14".
- Shot: img/manager/57-production-logged.png

## Step 58 — reports-hub
- URL: /reports?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Dashboard → Explore → "Reports Hub".
- Saw: "Reports"; shop chip "Capitol Hill"; "Date range" list (Today, Yesterday, Last 7 days selected, Last 30 days, This month, Last month, Custom), From 10/08/2026, To 10/14/2026, "Compare with previous period", "Apply", "Up to 92 inclusive days. Comparison applies to summary counts and trends."; shop card "Capitol Hill — Last close · Wed, Oct 14": Opening Done, AM Prep Done, Mid-Day Prep Done, Closing Done, Cash Done, PM Report Done; pills "Reports: 9", "Under par: 0", "Over par: 0", "Skipped: 50", "Not started: 0", "Temperature flags: 0", "Cash over: 0", "Cash short: 0". Below the frame: families "Operations" (Operations, Operations trends), "Written reports", "People" (My feedback, Team trends), "Inventory" (Counts and variance, Receiving, Ordering), "Catering", "Menu costing". No "Sales" family shows.
- Shot: img/manager/58-reports-hub.png
- Confused: the report families start just below the bottom of the frame. Reports Hub → Inventory does show Counts and variance, Receiving and Ordering for this role.

## Step 59 — reports-opening
- URL: /reports/opening/<id>?range=last7&…
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Tapped "Operations", then today's "Wed, Oct 14 Opening By: Nicole Boyd Status: Prep done" (list also had Closing "Confirmed (incomplete)", AM Prep "Confirmed", Mid-Day Prep "Prep done", Cash "Submitted", PM Report "Submitted", Maintenance "OK"; filters SEARCH, FROM, TO, TYPE, SIGNAL FILTERS; "Download CSV PDF" not tapped).
- Saw: "‹ OPERATIONS", "DASHBOARD"; "Same day" links Closing, AM Prep, Mid-Day Prep, Cash, PM Report, Maintenance; "Previous day", "Next day"; "Opening · Wed, Oct 14 · Prep done"; yellow "RECOUNT — NO PRIOR-DAY SUBMISSION — No prior-day AM-Prep submission to verify against — the opener recounted to establish the counts. Reason: missed or unknown."; "82/82 done · 0 skipped"; "CRUNCHY BOI STATION" lines with ticks and "Nicole Boyd", "Temp 36°".
- Shot: img/manager/59-reports-opening.png

## Step 60 — trends
- URL: /reports/trends?location=<Capitol Hill id>
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Dashboard → Explore → "Trends"; waited about 15 seconds; no "Loading" word on screen.
- Saw: "Trends"; shop chip "Capitol Hill"; three cards "Ops Trends — Par · temps · cash · completion over time", "Team — Operating health (managers)", "Yield — Batches vs the recipe card", each "TAP FOR THE FULL VIEW →"; "RELEVANT RIGHT NOW": "Team — 1 on track · 3 need a check-in: Angel Reyes, Nicole Boyd, Marcus Webb.", "Fridge Temp Flags — 8 · Tue, Sep 15 – Wed, Oct 14"; "OPS SNAPSHOT — Tue, Sep 15 – Wed, Oct 14 — UNDER / OVER PAR 0, FRIDGE TEMP FLAGS 8", "VIEW OPS TRENDS"; "TEAM SNAPSHOT" starting at the bottom edge. Dates and numbers are loaded. No chart is on this page (only cards and counts).
- Shot: img/manager/60-trends.png
- Confused: the script asks for charts; this page has number tiles only, the charts live behind "TAP FOR THE FULL VIEW".

## Step 61 — admin-home
- URL: /admin
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Dashboard → Explore → "Admin". Opened nothing.
- Saw: "Admin", "Manage your business configuration."; "USED THIS WEEK": Checklists confirmed 19, Counts recorded 15, Receiving logged 23, Prep submitted 555, Reports written 18, Photos uploaded 0, Production recorded 1424, Catering quotes 22; tiles: Vendors, SKUs (211 not ready), Products, Recipes (115 not ready), Items (38 not ready), Menu Costing, Weights & Trim, Catering. No "Customers" tile.
- Shot: img/manager/61-admin-home.png

## Step 62 — logged-out
- URL: /
- Persona / viewport: Nicole Boyd, Assistant General Manager / 1024x768
- Action: Dashboard (via Back to Dashboard from Admin) → scrolled to the bottom → "LOG OUT".
- Saw: back on "Where are you?" with tiles "MEP Capitol Hill" and "EM P Street" and "Manager login →" top right.
- Shot: img/manager/62-logged-out.png

