# Staff walk — step log (Maya Torres, 2026-10-14)

## Step 01 — where-are-you
- URL: /
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: `start phone walker`, then `look` on the login page.
- Saw: Top-right link "Manager login →". Heading "Where are you?". Two tiles: "MEP / Capitol Hill" and "EM / P Street". Short codes on the tiles: MEP = Capitol Hill, EM = P Street.
- Shot: img/staff/01-where-are-you.png

## Step 02 — whats-your-role
- URL: /
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: tapped the P Street tile.
- Saw: Heading "What's your role?", sub-line "EM · P STREET". Eight tiles with codes: GM General Manager, AGM Assistant General Manager, CTR Catering Manager, SL Shift Lead, KH Key Holder, TR Trainer, EMP Employee, TRN Trainee. "← Back" below (just off the bottom of the phone screen in the photo).
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
- Action: tapped Maya Torres tile.
- Saw: Badge "EMPLOYEE", name "Maya Torres", "Enter your 4-digit PIN", four empty dots, keypad 1-9 and 0, "Clear" (left of 0), "← Back" and "Use system keyboard" at the bottom. No submit button. (The 0 key row has "Clear" on the left; the right of 0 is blank, the keypad's back-arrow control is the "← Back" at the bottom left.)
- Shot: img/staff/04-pin-keypad.png
- Confused: the walker `tap 1` means control number 1 ("Manager login →"), not the digit key; the digit 1 is control [2]. Four taps of "1" on the first attempt hit "Manager login →" four times and changed nothing visible (the PIN screen stayed). Then four taps of control [2] (digit 1) signed in on the fourth digit, no submit button.

## Step 05 — dashboard
- URL: /dashboard?loc=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: signed in with PIN 1111 (landed on the dashboard).
- Saw: Round "M" user button top right, sitting in the page above the yellow COMPLIMENTS ONLY / OPERATIONS banner (not over the Explore chips). "DASHBOARD" eyebrow, "Hi, Maya Torres." EXPLORE chips: Mid-Shift Pulse, Reports Hub, Assignments, Written Reports, Maintenance, Production, Training, Profile, Settings, My Performance. Then badge "EMPLOYEE" with a bell showing 13 unread ("Notifications, 13 unread. Open notifications"), shop chip "EM · P STREET", and the top of "My shift" (Tasks "3 of 8 assigned", My station "None yet").
- Shot: img/staff/05-dashboard.png

## Step 06 — dashboard-full
- URL: /dashboard?loc=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: full-page shot of the dashboard.
- Saw, top to bottom: role badge "EMPLOYEE"; shop chip "EM · P STREET"; Explore chips as in step 05 (Production is there); "My shift" board with rows "Tasks — 3 of 8 assigned", "My station — None yet", "Team today — 1 of 7 assigned" (each with a ▸) and a "VIEW MY DAY" button; "TODAY'S OPERATIONS" card: "EM · P Street", "Wed, Oct 14", "CLOSING CHECKLIST — Not started", "START CLOSING"; "REPORTS" heading with tiles in this order: "OPENING REPORT — Not started today — OPEN / CONTINUE", "AM PREP — Not yet started — Assigned by Priya Shah — START AM PREP", "MID-DAY PREP — No mid-day preps started today. — + NEW MID-DAY PREP"; "LOG OUT" at the bottom.
- Shot: img/staff/06-dashboard-full.png
- Confused: the script lists the tiles as Opening Report, Mid-day Prep, AM Prep; the screen shows Opening Report, AM Prep, Mid-day Prep (AM Prep is second).

## Step 07 — opening-verify
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Dashboard, tapped "OPEN / CONTINUE" on the Opening Report tile (page showed "Loading…" for a moment, then loaded).
- Saw: "‹ DASHBOARD" breadcrumb, "OPENING REPORT", title "Phase 1 — Verification", "Verify last night's closing matches reality. Tap each station once you've checked it; add a comment if anything looks off." Tabs "PHASE 1 · VERIFY" and "PHASE 2 (LOCKED)". First card "CRUNCHY BOI STATION — 0 of 4 done" with a "VERIFIED" button; lines "Station appears clean as reported", "Crunchy Boi Fridge temp (≤41°F)" (an empty box showing "—"), "Sauces topped off & dated correctly", "Station ready for service (containers placed, prep ready)", each with "ADD COMMENT". Other station cards: 3RD PARTY STATION, WALK INS STATION, PREP FRIDGE, PREP AREA, BACK LINE OPEN, EXPO STATION, FRONT OF HOUSE OPEN, MANAGER OPEN, WALK-OUT VERIFICATION (each with VERIFIED); prep sections VEG (6 items), COOKS (6), SIDES (6), SAUCES (11), SLICING (9), each with "VERIFY SECTION" and the hint "Recount items without closer data first". Sticky footer while not ready: "0 of 44 verified · 0 of 8 temp readings entered", "44 items not yet verified", link "SHOW ME WHAT NEEDS FIXING", disabled "SUBMIT OPENING".
- Shot: img/staff/07-opening-verify.png
- Confused: the sticky footer is drawn over the bottom of the phone screen in the photo (it is the page's own footer, not a bug).
- Notes/comments fields: every line on a station card has an "ADD COMMENT" link (not opened, so no placeholder seen). Fridge temp lines have a small text box (shows "—", aria "Temperature reading for … Fridge temp (≤41°F)").

## Step 08 — opening-station-verified
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: tapped "VERIFIED" on Crunchy Boi Station.
- Saw: button turns solid gold "✓ VERIFIED"; card reads "3 of 4 done"; the other three lines tick (✓), the temp line also shows ✓ with its box still empty ("—"). Footer: "4 of 44 verified · 0 of 8 temp readings entered", "40 items not yet verified", "Saved a moment ago".
- Shot: img/staff/08-opening-station-verified.png
- Confused: the card says "3 of 4 done" but the footer says "4 of 44 verified" (the footer counts the station itself too). The temp line has a ✓ tick before any temperature is typed.

## Step 09 — opening-temperature
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: typed `36` in the Crunchy Boi Fridge temp box.
- Saw: card header now "✓ CRUNCHY BOI STATION — 4 of 4 done" with a green tick, box shows 36. Footer "4 of 44 verified · 1 of 8 temp readings entered", "40 items not yet verified", "Saved a moment ago".
- Shot: img/staff/09-opening-temperature.png

## Step 10 — opening-section-verify
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: opened VEG (6 items: Iceberg, Onion, Basil, Radish, Cucumber, Tomato); "Verify section — Veg" was greyed out; no "Closer count" shown on any row, so typed `2` in each "OPENER RECOUNT" box; tapped "VERIFY SECTION".
- Saw: the recount boxes show 2 and have a gold border (I did not catch them red before typing; after filling they are gold, not red). Veg header "✓ VEG — 6 of 6 done" with solid "✓ VERIFIED". Each row shows "·", the item name, "ADD COMMENT", "OPENER RECOUNT [2] —". After the first Veg verify a pink box appeared below the sections: "NO PRIOR CLOSING DATA DETECTED — 6 item(s) had no closing count from last night — morning recounts were entered. Confirm the reason:" with radios "Location was closed (planned)" and "Closing was missed / I don't know".
- Shot: img/staff/10-opening-section-verify.png
- Confused: the footer still read "4 of 44 verified" right after Veg was verified (it caught up later, see step 11). The photo frames the Veg header and the first filled box; the other five filled boxes are below the frame.
- Bug?: none seen. Greyed-out hint under each prep section before filling: "Recount items without closer data first".

## Step 11 — opening-ready
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: verified every other station (Verified button) and opened each card; fridge temps typed in the order I met them (bottom-up): FOH Drinks Fridge 37, Deli Display Fridge 38, Back-Line Drinks Fridge 35, 3-Door Fridge 36, Sauce Fridge 37, Walk-In Fridge 38, 3rd-Party Fridge 36 (all ≤41). Stations without a temp line: Walk-Out Verification, Manager Open. Verified prep sections Cooks (recount items: Vodka, Marinara, Compound Butter, Caramelized onion, Jus, Chicken Cutlet), Sides (Tuna Salad, Egg Salad, Onion Dip, Chix Salad, Antipasto Pasta, Cannoli Cream), Sauces (Aioli, HC Aioli, HP Mayo, Mustard Aioli, Horsey Mayo, Salsa Verde, Dukes, Vin, Caesar Dressing, Lemon Oil, Ranch), Slicing (Turkey, Ham, Capicola, Pepperoni, Genoa, Provolone, Mortadella, Roast Beef, Cheddar) by typing `2` in every recount box. The pink box's reason box: chose "Closing was missed / I don't know".
- Saw: pink box "NO PRIOR CLOSING DATA DETECTED — 38 item(s) had no closing count from last night — morning recounts were entered. Confirm the reason:" and after choosing, "Attestation: Closing was missed / I don't know". Footer "44 of 44 verified · 8 of 8 temp readings entered", "Submit ready", "Saved a moment ago", enabled yellow "SUBMIT OPENING". While not ready the footer hints were "44 items not yet verified" and, once everything was verified but no reason chosen, "Pick a reason in the pink “No prior closing data detected” box". Only the reason box existed beyond that; no other reason boxes appeared.
- Shot: img/staff/11-opening-ready.png
- Confused: the Verified button on a station also ticks every line on the card, including the temp line, before the temperature is typed.

## Step 12 — opening-submitted
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: tapped "SUBMIT OPENING" (after a few seconds the page switched to Phase 2).
- Saw: page title now "Phase 2 — Prep Entry" (not "Phase 1 — Verification"); sub-line "Type what you prepped for each item. Each row saves when you leave its box."; tabs "PHASE 1 · VERIFY" and "PHASE 2 — PREP ENTRY" (Phase 2 selected); link "SHOW ME WHAT NEEDS FIXING"; VEG card "0 of 6 done" with a green "✓ VERIFIED" tag; first row "Iceberg — Par: 7 × 1/3 Pan, CLOSER COUNT: 2 × 1/3 Pan, PREP NEED: 5 × 1/3 Pan, OPENER PREPPED [box]". Quantities read "5 × 1/3 Pan" (with the ×). Footer "44 of 44 verified · 8 of 8 temp readings entered · 0 of 38 prep entries", "38 prep items not yet saved", disabled "FINALIZE PHASE 2 (38 OUTSTANDING)". Other row shapes: "Par: 8 Quart / CLOSER COUNT: 2 Quart / PREP NEED: 6 Quart" (Onion), Basil par 4 need 2, Radish par 1 "PREP NEED: 0" (no unit), Cucumber par 3 need 1, Tomato has no par: "CLOSER COUNT: 2" and "No par set — type what you made". Closer count shown is my own recount of 2 (there was no real closing data).
- Shot: img/staff/12-opening-submitted.png
- Notes/comments fields: none on the Phase 2 rows; each row has a "Uses: 0 <ingredient> · ~0 oz" read-only line and a "Not saved" status line.

## Step 13 — opening-prep-entry
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: scrolled down a little, before typing.
- Saw: rows Onion, Basil, Radish (and the end of Iceberg), each with "Uses: 0 … · ~0 oz" and "Not saved" underneath. Footer unchanged ("0 of 38 prep entries").
- Shot: img/staff/13-opening-prep-entry.png

## Step 14 — opening-prep-filled
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: typed `5` (Iceberg), `6` (Onion), `2` (Basil) in OPENER PREPPED, tapping outside each box after.
- Saw: each saved row shows "Uses: 1.02 Iceberg · ~685 oz" / "Uses: 0 Onion (red) · ~2 oz" / "Uses: 0.03 Basil · ~1 oz", the green italic "At par", "Saved by Maya Torres at 3:15 AM" (Iceberg), "3:16 AM" (Onion, Basil) and an "UNDO" button. VEG card "3 of 6 done". Footer "3 of 38 prep entries", "35 prep items not yet saved", button reads "FINALIZE PHASE 2 (35 OUTSTANDING)" (disabled; I did not tap it).
- Shot: img/staff/14-opening-prep-filled.png
- Confused: the photo shows Iceberg and Onion saved; Basil's saved row (same layout) sits just below the bottom of the frame — three full rows do not fit one phone screen.
- Bug?: after the first round the Onion row (6) showed "Saved by Maya Torres at 3:15 AM · At par · UNDO", but after Basil (2) saved, Onion went back to an empty box with "Not saved" and the VEG card went "2 of 6 done" (the footer said "2 of 38"). I had to retype 6 in Onion and tap outside again; second time it stayed saved ("3 of 38"). Possible save race when two rows are saved a few seconds apart.

## Step 15 — my-shift
- URL: /dashboard
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: back to the dashboard (via "‹ Dashboard" link on the opening page), scrolled to the My shift board (page scroll steps are big; used the ArrowUp key to land the heading in view).
- Saw: "My shift" heading with rows "Tasks — 3 of 8 assigned", "My station — None yet", "Team today — 1 of 7 assigned" (each ▸) and "VIEW MY DAY"; below it the "TODAY'S OPERATIONS" card. The Opening Report tile now reads "In progress".
- Shot: img/staff/15-my-shift.png

## Step 16 — board-tasks
- URL: /assignments?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: tapped "VIEW MY DAY"; the Assignments page opened with "Stations" already open, so I closed it and opened "Tasks 3 of 8 assigned".
- Saw: "Dashboard" link, "Assignments", "Wed, Oct 14", "P Street" chip, card "Today's team" with a "STATIONS" button and three folds: "Stations — 0 of 12 assigned", "Tasks — 3 of 8 assigned", "Who has what — 1 of 7 assigned". Tasks list in order: CLOSING CHECKLIST (link) "Everyone on shift · no assignment needed"; AM PREP (link) "Assigned to Maya Torres by Priya Shah · 3:08 AM"; MID-DAY PREP (link) "Assigned to Maya Torres by Priya Shah · 3:08 AM"; Cash report "Unassigned"; OPENING PREP (link) "Assigned to Maya Torres by Priya Shah · 3:08 AM"; Receiving "Unassigned"; Counts "Unassigned"; Ordering "Unassigned"; PM report "Unassigned". Links for Maya: Closing checklist, AM prep, Mid-day prep, Opening prep. No task belonged to someone else (all other tasks are "Unassigned"); I tapped none.
- Shot: img/staff/16-board-tasks.png
- Confused: the task is called "OPENING PREP" here but the dashboard tile is "Opening Report" (the page it opens is titled "OPENING REPORT / Phase 1 — Verification"). The photo shows a faint yellow focus ring around the Tasks fold header (the walker's tap left it focused). The first item shown in the photo is Closing checklist; only the first four of nine tasks fit on the screen.

## Step 17 — board-stations
- URL: /assignments?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: closed Tasks, opened "Stations".
- Saw: "Stations — 0 of 12 assigned". Station groups and positions (all "Unassigned"): Crunchy Boi Station · 0 of 1 (Crunchy Boi Station · Unassigned); 3rd Party Station · 0 of 1; Walk Ins Station · 0 of 2 (Walk-ins "Dedicated to walk-in orders; helps with online orders when there are no subs to make"; Walk-ins / Online "Half walk-ins, half online orders; leans toward walk-ins"); Prep Fridge · 0 of 1; Shut Down Back Line · 0 of 1; Expo Station · 0 of 2 (Expeditor "Expedites the orders"; Register & Delivery "Runs the cash register and hands out delivery orders"); Clean front of house · 0 of 1; Prep Area · 0 of 1; Closing Manager · 0 of 1; Walk-Out Verification · 0 of 1.
- Shot: img/staff/17-board-stations.png
- Confused: the first position reads "Crunchy Boi Station · Unassign…" (cut off with an ellipsis) because the name is too long for the row.

## Step 18 — claim-station
- URL: /dashboard?loc=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: dashboard, tapped the "My station — None yet" row on My shift to open it.
- Saw: row "My station — None yet ▾". Inside: green "On shift · Active in CO-OPS", buttons "START BREAK" and "END MY SHIFT", "No station", a "Station" drop-down (closed in the photo, reads "No station") and a yellow "CLAIM / CHANGE STATION" button, then "Tasks" with AM PREP / MID-DAY PREP / OPENING PREP, each "Assigned by Priya Shah · 3:08 AM". The Station drop-down offered 12 choices after "No station": "Crunchy Boi Station · Crunchy Boi Station · fill first", "3rd Party Station · 3rd Party Station · fill first", "Walk Ins Station · Walk-ins · fill first", "Walk Ins Station · Walk-ins / Online", "Prep Fridge · Prep Fridge · fill first", "Shut Down Back Line · Shut Down Back Line · fill first", "Expo Station · Expeditor · fill first", "Expo Station · Register & Delivery", "Clean front of house · Clean front of house · fill first", "Prep Area · Prep Area · fill first", "Closing Manager · Closing Manager · fill first", "Walk-Out Verification · Walk-Out Verification · fill first".
- Shot: img/staff/18-claim-station.png
- Confused: the "Station list" is a drop-down, shown closed in the photo (the walker cannot photograph an open native list). Faint yellow focus ring on the row header.

## Step 19 — station-claimed
- URL: /dashboard?loc=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: picked "Crunchy Boi Station · Crunchy Boi Station · fill first" in the drop-down, tapped "CLAIM / CHANGE STATION"; the app's "Confirm change" box opened with "Reason for change" (drop-down: "No reason (optional)", "Coverage change", "Person left or unavailable", "Skill fit", "Correction", "Other"), a "Note (optional)" text area (no placeholder text captured), buttons "CONFIRM CHANGE" and "CANCEL". Left the reason on "No reason (optional)" and tapped "CONFIRM CHANGE".
- Saw: the My station row now reads "✓ My station — Yours: Crunchy Boi Station" (expanded view: "Crunchy Boi Station · Crunchy Boi Station" and "Claimed · 3:19 AM"; the drop-down option now reads "Crunchy Boi Station · Crunchy Boi Station · taken by Maya"). A new card under REPORTS reads "My station: Crunchy Boi Station" (it is a link). Both the row and the card fit in the one photo (row folded).
- Shot: img/staff/19-station-claimed.png
- Confused: the "Confirm change" box has no title naming what is being confirmed in the page text; it just says "Confirm change". Faint yellow focus ring on the row header in the photo.

## Step 20 — closing-checklist
- URL: /operations/closing?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: dashboard, tapped "START CLOSING" on Today's operations (page showed "Loading…" a few seconds first).
- Saw: "‹ DASHBOARD", "CLOSING CHECKLIST", "EM · P Street", "PROGRESS 0/61" with a bar. Sections, all folded except the first: CRUNCHY BOI STATION (0 of 6 done, open) with lines "Restock", "Wipe inside & outside", "Wipe tops of sauce bottles", "Combine & check dates on sauces", "Pull out station and sweep", "Crunchy Boi Fridge temp (≤41°F)"; then 3RD PARTY STATION (0 of 6), WALK INS STATION (0 of 6), PREP FRIDGE (0 of 6), SHUT DOWN BACK LINE (0 of 4), EXPO STATION (0 of 5), CLEAN FRONT OF HOUSE (0 of 7), PREP AREA (0 of 9), CLOSING MANAGER (0 of 7), WALK-OUT VERIFICATION (0 of 5). The section opened is the one for my station (Crunchy Boi).
- Shot: img/staff/20-closing-checklist.png
- Confused: one line ("Wipe tops of sauce bottles") shows a yellow highlight in the photo; that is the mouse hover left over from the previous tap, not a selection.

## Step 22 — closing-ticked
- URL: /operations/closing?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: tapped "Restock", then "Wipe inside & outside".
- Saw: each line shows a ticked circle, an "UNDO" button, "you · 3:20 AM" and a small "Add note" link. Progress "2/61"; section "2 of 6 done".
- Shot: img/staff/22-closing-ticked.png
- Notes/comments fields: "Add note" under every ticked line (placeholder in the box that opens: "Anything noteworthy?", see step 23).

## Step 22b — closing-temp-line
- URL: /operations/closing?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: tapped "Crunchy Boi Fridge temp (≤41°F)"; a box opened under the line; typed `38` in the first field; tapped "SAVE".
- Saw: box with label "TEMP (°F)" (placeholder "e.g. 38"), label "NOTES (OPTIONAL)" (placeholder "Anything noteworthy?"), a yellow "SAVE" button and a "Cancel" button. The label reads "Temp (°F)", not "Count". After tapping Save: the line is ticked with an "UNDO" button and reads "38° · you · 3:21 AM"; progress "3/61", section "3 of 6 done".
- Shot: img/staff/22b-closing-temp-line.png (shot taken before tapping Save)
- Confused: the first photo attempt had the sticky "PROGRESS" bar across the line's name; I cancelled the box, scrolled, reopened it and retook it so the line name is visible. Typing Escape does not close the box. The walker's `type` reported FAILED on the retake but the box still held 38 (the typed draft was kept when I reopened it).

## Step 23 — closing-note
- URL: /operations/closing?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: on "Restock" tapped "Add note", typed `Out of lids — told the shift lead` in the box (placeholder "Anything noteworthy?"), tapped "SAVE NOTE".
- Saw: under Restock: "you · 3:22 AM", the italic note "Out of lids — told the shift lead", and a link "Edit note". The Restock time changed from 3:20 AM to 3:22 AM when the note was saved.
- Shot: img/staff/23-closing-note.png
- Confused: saving a note re-stamps the tick time (3:20 to 3:22).

## Step 24 — closing-full
- URL: /operations/closing?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: full-page shot (no "Loading" on screen first).
- Saw: whole page: header, Progress "3/61", Crunchy Boi Station open (Restock with note and Edit note, Wipe inside & outside with Add note, three unticked lines, the temp line "38° · you · 3:21 AM"), then nine folded sections. The Progress bar sits at the top, not drawn across the middle. The cream header band's background stops partway down the page (about the end of the first section) in the full-page picture, because the header is a sticky strip.
- Shot: img/staff/24-closing-full.png
- Confused: there is no button at the bottom of the page (nothing like "Submit closing" is shown to an Employee). Opening CLOSING MANAGER and WALK-OUT VERIFICATION (then folding them again) showed: "Count the drawer", "Count and secure tips — Count tips, place in safe. Weekly distribution handled separately by AGM+.", report lines "AM Prep List — Pending — tap to open", "Opening verified — Pending — tap to open", "Mid-day Prep — Pending — tap to open", "Cash deposited — Assigned shift task required", "PM Report submitted — Assigned shift task required"; WALK-OUT VERIFICATION lines "Lights off", "Devices charging", "Oven off", "Front doors locked", "Back door locked". No line said "awaiting higher role". No sticky-bar-in-the-middle bug.

## Step 25 — pulse
- URL: /mid-shift?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Dashboard, Explore, "Mid-Shift Pulse" (page showed "Loading…" about 8 seconds first).
- Saw: "‹ DASHBOARD", title "Mid-shift Pulse", "EM · P Street", "Updated 3:23 AM", line "Refreshes every 60 s" (in the page text, not visible in the photo's first screen). Card "Needs attention — as of 3:23 AM — See more": green "ON TRACK" and "All clear — nothing needs attention right now." (nothing late, so there was no red-first order to check). Card "Live shop floor — as of 3:23 AM — See more": "Tap a station for details.", button "MAP VIEW", a 3D floor picture and the legend "Green covered · amber short, closing soon or past its close time · red uncovered · grey closed".
- Shot: img/staff/25-pulse.png
- Confused: the floor picture is a red/grey 3D shape with station labels piled on top of each other ("Crunchy Boi Station", "Ma…", "3rd Party Station", "Expo Station", "Walk Ins Station", "Shut Down Back Line", "Clean front of house", "Prep Area", "Prep Fridge", "Closing Manager", "Walk-Out Verification" with "UNCOVERED" captions overlapping). It did not change after waiting 10 s and a retake; I kept it.
- Bug?: the station labels on the live shop floor picture overlap and are partly unreadable on a phone-width screen.

## Step 26 — pulse-full
- URL: /mid-shift?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: full-page shot.
- Saw, section headings in order: "Needs attention", "Live shop floor", "Stations & tasks" ("1 covered · 0 short · 0 closing soon · 0 to close now · 9 uncovered · 0 closed", "Tasks: 0 done · 3 left", a MY SHIFT box "Crunchy Boi Station · Crunchy Boi Station" with links "AM prep", "Mid-day prep", "Opening prep" each tagged "OPEN", then station rows: Crunchy Boi Station · Maya COVERED, 3rd Party Station / Walk Ins Station / Prep Fridge / Shut Down Back Line / Expo Station UNCOVERED), "Catering" ("DUE TODAY — No catering due today.", "Tomorrow: no catering booked", "Prep: AM Not started · mid-day Not started", "Timing only: names and details are on the catering board for managers."), "Food safety" ("All fridges checked and in range.", "8 in range · 0 out of range · 0 unchecked"), "Handoff" ("Reports: 0 done · 5 left", chips OPENING, AM PREP, MID-DAY PREP, CASH DEPOSIT, CLOSING, "No handoff notes for today."). Every section has a "See more" link and an "as of 3:23 AM" stamp. No "Not available for your role." card appeared. No fridge reminder text beyond "All fridges checked and in range."
- Shot: img/staff/26-pulse-full.png
- Confused: after my opening temps the fridge card says 8 in range, while closing temps are not in yet.

## Step 27 — pulse-section
- URL: /mid-shift/stations?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: tapped "See more" on the Stations & tasks card.
- Saw: "‹ PULSE", "Stations & tasks as of 3:24 AM", counts line, "Tasks: 0 done · 3 left", MY SHIFT box with AM prep / Mid-day prep / Opening prep (all "OPEN"), then all 10 stations (Crunchy Boi Station · Maya COVERED; 3rd Party Station, Walk Ins Station, Prep Fridge, Shut Down Back Line, Expo Station, Clean front of house, Prep Area, Closing Manager, Walk-Out Verification UNCOVERED), and links "Stations" and "Closing checklist" at the bottom.
- Shot: img/staff/27-pulse-section.png

## Step 28 — maintenance
- URL: /maintenance?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Dashboard, Explore, "Maintenance" (page showed "Loading…" for about 10 seconds first).
- Saw: "‹ DASHBOARD", title "Maintenance Log", "FRIDGE TEMPS" with eight cards, each with a name, today's reading, a status word and a small line chart: Walk-In Fridge OK 38°F, 3-Door Fridge OK 36°F, Sauce Fridge OK 37°F, Deli Display Fridge OK 38°F, Crunchy Boi Fridge OK 38°F, FOH Drinks Fridge OK 37°F, Back-Line Drinks Fridge OK 35°F, 3rd-Party Fridge OK 36°F (the readings are the ones I typed in the opening and closing). Then "EQUIPMENT": "Oven — No issues logged", "Fryer — Last note: sim-seed 2026-10-07: Oil changed early, smelled burnt. (Sat, Sep 12)". Then "OTHER EQUIPMENT NOTES" and "LOG A MAINTENANCE NOTE". Status words seen: only "OK"; I did not see "Out of range" or "No reading today".
- Shot: img/staff/28-maintenance.png
- Bug?: "OTHER EQUIPMENT NOTES" already listed about 11 "Prep fridge" notes by "Maya Torres" before I typed anything, 5 of them dated "Wed, Oct 14" (today) and the rest "Tue, Oct 13" (including one that ends "Maya, staff guide practice."). These are left over from earlier walks; the sim reset did not clear them.

## Step 29 — maintenance-note
- URL: /maintenance?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: in "LOG A MAINTENANCE NOTE" picked "Other…" in the Equipment drop-down (options: Walk-In Fridge, 3-Door Fridge, Sauce Fridge, Deli Display Fridge, Crunchy Boi Fridge, FOH Drinks Fridge, Back-Line Drinks Fridge, 3rd-Party Fridge, Oven, Fryer, Other…), typed `Prep fridge` in "Equipment name", typed `Prep fridge feels warm` in the note box.
- Saw: field "Equipment" (drop-down), text box with placeholder/label "Equipment name", text area with placeholder/label "What's going on?", yellow "SAVE NOTE" (greyed out until the note has text).
- Shot: img/staff/29-maintenance-note.png

## Step 30 — maintenance-saved
- URL: /maintenance?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: tapped "SAVE NOTE", scrolled up to "OTHER EQUIPMENT NOTES".
- Saw: my note is first in the list: "Prep fridge — Prep fridge feels warm — Wed, Oct 14 · Maya Torres". The date is today (Wed, Oct 14), not tomorrow. The form reset after saving. No error or toast was on screen when photographed.
- Shot: img/staff/30-maintenance-saved.png

## Step 31 — midday-tile
- URL: /dashboard?loc=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: back on the dashboard, scrolled to the Reports section.
- Saw: Today's operations card now reads "In progress · 3 of 61 items" with "CONTINUE CLOSING". REPORTS: card "My station: Crunchy Boi Station"; "OPENING REPORT — In progress — OPEN / CONTINUE"; "AM PREP — Not yet started — Assigned by Priya Shah — START AM PREP"; "MID-DAY PREP — No mid-day preps started today. — + NEW MID-DAY PREP"; "LOG OUT" below.
- Shot: img/staff/31-midday-tile.png
- Confused: the Mid-day Prep tile is the third tile (after AM Prep), not the second.

## Step 32 — midday-count
- URL: /operations/mid-day?instance=9be4b2fc-3f30-4a3a-be8e-ce99d2e022a9
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: tapped "+ NEW MID-DAY PREP".
- Saw: "‹ DASHBOARD", "MID-DAY PREP", "Phase 1 — count to par", VEG "0 of 6 done" (open) with rows Pickles PAR 20 QUART, Sweet Peppers PAR 12 QUART, Hot Peppers PAR 12 QUART, Basil PAR 4 QUART, Shredded Mozzarella PAR 5 QUART, Fresh Mozzarella PAR 12 QUART, each with a box whose placeholder reads "On hand"; SAUCES "0 of 10 done" folded; yellow "SUBMIT COUNT → PHASE 2". No "Bulk backup" box appeared on any row.
- Shot: img/staff/32-midday-count.png

## Step 33 — midday-filled
- URL: /operations/mid-day?instance=9be4b2fc-3f30-4a3a-be8e-ce99d2e022a9
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: typed `4` in Pickles "On hand" and `2` in Sweet Peppers "On hand".
- Saw: rows now read "PAR 20 QUART · NEED: 16 QUART" and "PAR 12 QUART · NEED: 10 QUART"; VEG "2 of 6 done". Other rows unchanged (no Need line).
- Shot: img/staff/33-midday-filled.png

## Step 33b — midday-phase2
- URL: /operations/mid-day?instance=9be4b2fc-3f30-4a3a-be8e-ce99d2e022a9
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: left the other boxes empty and tapped "SUBMIT COUNT → PHASE 2" (button showed "SUBMITTING…" for about 8 seconds). It was accepted at once: no refusal, no Bulk backup message, no limit message.
- Saw: title "Phase 2 — prep"; VEG "0 of 6 done"; each row: name, "NEED: 16 QUART" (Pickles), "NEED: 10 QUART" (Sweet Peppers), "NEED: 12 QUART" (Hot Peppers), "NEED: 4 QUART" (Basil), "NEED: 5 QUART" (Shredded Mozzarella), "NEED: 12 QUART" (Fresh Mozzarella), a "Prepped" box, a yellow "SAVE" button and a line "Uses: 0 Pickle slices · ~0 oz" (etc.). Sauces below (folded, 0 of 10): Aioli, HC Aioli, HP Mayo, Mustard Aioli, Horsey Mayo, Salsa Verde, Dukes, Vin, Caesar Dressing, Lemon Oil. Bottom button "FINALIZE PREP". "SAVE" is fully on screen on every row; the page is not wider than the screen.
- Shot: img/staff/33b-midday-phase2.png
- Confused: the empty "Prepped" box placeholder is cut to "Preppec" in the photo (the box is too narrow for the word). No "Add over/under reason" appeared on any row.

## Step 33c — midday-row-saved
- URL: /operations/mid-day?instance=9be4b2fc-3f30-4a3a-be8e-ce99d2e022a9
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: typed `16` (the Need) in the Pickles Prepped box and tapped "SAVE".
- Saw: the row shows "16", "Uses: 0.03 Pickle slices · ~8 oz" and a green "SAVED ✓"; VEG "1 of 6 done".
- Shot: img/staff/33c-midday-row-saved.png
- Confused: I then saved Sweet Peppers `10` and Hot Peppers `12` the same way (both "SAVED ✓", VEG "3 of 6 done"; "Uses: 0.4 Sweet Peppers · ~203 oz", "Uses: 0.47 Hot Peppers · ~240 oz").

## Step 33d — midday-finalized
- URL: /operations/mid-day?instance=9be4b2fc-3f30-4a3a-be8e-ce99d2e022a9
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: tapped "FINALIZE PREP" (button showed "FINALIZING…" for about 10 seconds; no confirm question).
- Saw: title "Finalized — prep made", green box "Finalized at 3:28 AM by Maya Torres", then VEG and SAUCES rows as "NEED: 16 QUART · MADE: 16 QUART", "NEED: 10 QUART · MADE: 10 QUART", "NEED: 12 QUART · MADE: 12 QUART", then unsaved rows "NEED: 4 QUART · MADE: —", etc.; Sauces "NEED: 15 BOTTLE · MADE: —" (Aioli), HC Aioli 4, HP Mayo 4, Mustard Aioli 4, Horsey Mayo 4, Salsa Verde 1, Dukes 3, Vin 6, Caesar Dressing "NEED: — · MADE: —", Lemon Oil 1. The text "The interactive count and prep forms ship in the next build." did NOT appear. Finalize did not complain about the unsaved rows.
- Shot: img/staff/33d-midday-finalized.png
- Confused: "Sweet Peppers" is cut to "Sweet Pepp…" on its row in the finalized view (name too long next to the Need/Made text).

## Step 33e — production
- URL: /operations/production?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Dashboard, Explore, "Production" (no `goto`; page showed "Loading…" about 10 seconds first). Looked only; to make the "Makes" field show I picked "Basil (0 in stock)" in the Raw item drop-down. Nothing was logged and the button stayed disabled.
- Saw: "‹ DASHBOARD", title "Production", card "LOG A CONVERSION" with "Raw item (SKU)" (drop-down, starts at "Pick a SKU…", long list of SKUs each "(0 in stock)"), "Makes" (drop-down "Pick what you made…", only appears after a SKU is picked), "Amount used (packs)", "Amount made", "Notes" (empty text area, no placeholder), and a greyed "LOG PRODUCTION" button. Below: "RECENT PRODUCTION" listing today's rows from my own opening and mid-day prep: "0 Hot Peppers → 12 Hot Peppers · Wed, Oct 14", "0 Sweet Peppers → 10 Sweet Peppers", "0 Pickle slices → 16 Pickles", "0 Onion (red) → 6 Onion", "0 Basil → 2 Basil", etc. No "Yield variance →" link was shown. The page does not print the shop name; the address carries the P Street location id (d2cced11…).
- Shot: img/staff/33e-production.png
- Confused: without a SKU picked there is no "Makes" field (the grey button sits right under Amount made/Notes); the script expects Makes to be visible straight away.

## Step 43 — am-prep-sheet
- URL: /operations/am-prep?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Dashboard, Reports, AM PREP tile, "START AM PREP" (page took about 10 seconds to load).
- Saw: "‹ DASHBOARD", "AM PREP", "EM · P Street". VEG "0 of 6 done" (open) with column headings "PAR", "ON HAND", "BACK UP", "TOTAL"; rows Iceberg "7 1/3 Pan", Onion "8 Quart", Basil "4 Quart", Radish "1 Quart", Cucumber "3 Quart", Tomato "Prep Daily"; every ON HAND box has a red "Required" under it; TOTAL boxes are shaded. Folded sections: COOKS (0 of 6), SIDES (0 of 6), SAUCES (0 of 11), SLICING (0 of 9), MISC (0 of 4). Bottom: "Fix 42 issues before submitting" with "SHOW ME WHAT NEEDS FIXING" and a disabled "FIX ISSUES BEFORE SUBMITTING". No "Picked up where you left off …" line was shown.
- Shot: img/staff/43-am-prep-sheet.png

## Step 44 — am-prep-filled-row
- URL: /operations/am-prep?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: typed `2` (Iceberg), `1` (Onion), `3` (Basil) in ON HAND.
- Saw: those rows show 2, 1, 3 in ON HAND and the same numbers in the shaded TOTAL; their "Required" tags are gone; VEG "3 of 6 done"; other rows still show "Required". A "Saved" line and a "DISCARD CHANGES" button appear at the bottom of the page (autosave).
- Shot: img/staff/44-am-prep-filled-row.png

## Step 45 — am-prep-done
- URL: /operations/am-prep?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: filled every other row with `1` in its first box, answered YES on all four MISC questions, left BACK UP empty, tapped "SUBMIT AM PREP". It went through the first time with no refusal. Column headings by section: VEG and COOKS use "ON HAND / BACK UP / TOTAL"; SIDES uses "PORTIONED / BACK UP / TOTAL" (no "PORT"); SAUCES and SLICING use "LINE / BACK UP / TOTAL". MISC questions: "Meatball mix - ready?", "Meatballs - ready to cook?", "Meatballs - for reheat?", "Cook Bacon?" each with YES / NO, plus a notes box with placeholder "Add notes…".
- Saw: green line "AM Prep submitted at 3:31 AM by Maya Torres"; every section ticked "6 of 6 done" etc. and the boxes are now greyed/read-only showing my numbers. The submit button is gone.
- Shot: img/staff/45-am-prep-done.png
- Confused: the script lists the headings as "ON HAND / PORT / LINE, BACK UP, TOTAL" but on screen the middle headings are "ON HAND", "PORTIONED", "LINE" (depends on the section).

## Step 34 — end-my-shift
- URL: /dashboard?loc=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: dashboard, tapped the "My station" row on My shift to open it.
- Saw: "✓ My station — Yours: Crunchy Boi Station"; inside: "On shift · Active in CO-OPS", "START BREAK", "END MY SHIFT", the position "Crunchy Boi Station · Crunchy Bo…" (cut off), "Claimed · 3:19 AM", the Station drop-down (showing "Crunchy Boi Station · Crunchy…"), "CLAIM / CHANGE STATION", and Tasks: AM PREP, MID-DAY PREP, OPENING PREP each "Assigned by Priya Shah · 3:08 AM".
- Shot: img/staff/34-end-my-shift.png
- Confused: faint yellow focus ring around the row header; the position name is cut with an ellipsis.

## Step 35 — shift-ended
- URL: /dashboard
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: tapped "END MY SHIFT". The app's "Confirm change" box read: "End your shift? Your station is released and your open tasks are unassigned." with "Reason for change" (left on "No reason (optional)"), "Note (optional)" text area, "CONFIRM CHANGE" and "CANCEL". Tapped "CONFIRM CHANGE".
- Saw: My station row now "None yet" and, inside, "Ended shift 3:32 AM", "No station", the Station drop-down at "No station", "CLAIM / CHANGE STATION", and "Tasks — No assigned tasks today." Tasks row now "0 of 8 assigned" (was 3 of 8); "Team today" "0 of 7 assigned" (was 1 of 7). The "My station: Crunchy Boi Station" card and all three REPORTS tiles (Opening Report, AM Prep, Mid-day Prep) disappeared; the whole REPORTS section is gone, only "TODAY'S OPERATIONS" with "CLOSING CHECKLIST — In progress · 5 of 61 items — CONTINUE CLOSING" remains (was 3 of 61 before: two report lines ticked themselves after my opening/AM prep). "START BREAK" and "END MY SHIFT" no longer show.
- Shot: img/staff/35-shift-ended.png
- Confused: contradicts the script: "CLAIM / CHANGE STATION" (with its drop-down) STILL shows after the shift ended; the script says it should not. The dashboard address lost its "?loc=…" part.

## Step 36 — profile
- URL: /profile
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Dashboard, Explore, "Profile".
- Saw: "‹ DASHBOARD", "Team Profiles", "Teammates at your location", heading "LEADERSHIP" with Dana Brooks (MOO, LEADERSHIP tag); then cards: Maya Torres (You, EMP, ⭐ 10), Deshawn Carter (EMP, ⭐ 5), Marcus Webb (GM), Priya Shah (AGM), Rosa Delgado (KH), Tommy Nguyen (SL).
- Shot: img/staff/36-profile.png
- Confused: some names are cut with an ellipsis in the photo ("Dan…", "Maya …", "Deshawn C…").

## Step 37 — settings-language
- URL: /settings
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Dashboard, Explore, "Settings". Language not changed.
- Saw: "Settings", "Your app preferences."; card "Language — The language used across the app." with two buttons "ENGLISH" (selected, yellow) and "ESPAÑOL"; card "Profile — View your team and update your profile blurb." with "GO TO PROFILE". The page was short, so the Language card is on the first screen.
- Shot: img/staff/37-settings-language.png

## Step 38 — user-menu
- URL: /settings
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: tapped the round "M" button top right; the menu opened in the page. Closed it afterwards by tapping the same button again; chose nothing.
- Saw: panel with "SIGNED IN AS", "Maya Torres", "maya@sim.co-ops", "LANGUAGE" with two buttons "EN · ENGLISH" (selected) and "ES · ESPAÑOL", then "Dashboard" and "Sign out". It covers the page title and part of the Language card behind it.
- Shot: img/staff/38-user-menu.png

## Step 39 — written-reports
- URL: /reports/written?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Dashboard, Explore, "Written Reports".
- Saw: breadcrumb "‹ REPORTS" and "DASHBOARD" (not covered), "P Street" chip, title "Written Reports", "Free-form posts for anything that doesn't fit a structured report.", "Date range" (drop-down at "Last 7 days": Today, Yesterday, Last 7 days, Last 30 days, This month, Last month, Custom), "From 10/08/2026", "To 10/14/2026", checkbox "Compare with previous period", "Apply", "Up to 92 inclusive days. Comparison applies to summary counts and trends.", "Download CSV PDF" (not tapped), yellow "NEW REPORT", and "No written reports yet."
- Shot: img/staff/39-written-reports.png

## Step 40 — written-report-form
- URL: /reports/written?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: tapped "NEW REPORT"; looked only, did not post; tapped "CANCEL" to close it.
- Saw: form fields: "Title (optional)" (placeholder "Short summary"), "What happened" (text area, placeholder "Describe it in your own words…"), "Category" (drop-down at "None": None, Incident, Observation, Request, Feedback, Other), "Who can see this" (drop-down with one choice, "All staff"), buttons "CANCEL" and "POST REPORT" (greyed until there is text).
- Shot: img/staff/40-written-report-form.png

## Step 41 — my-performance
- URL: /my-feedback
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Dashboard, Explore, "My Performance"; waited and ran `look` three times over about 15 seconds until the text stopped changing; scrolled down to the charts for the photo.
- Saw: breadcrumb "‹ REPORTS" "DASHBOARD", "My Performance", "P Street" chip, From 09/15/2026, To 10/14/2026, "Apply range", buttons "DAY" (selected) "WEEK" "MONTH", "COMPARE TO PREVIOUS". Score card: "2 MVP win(s) this period — keep it up! 🌟", "1107", "your score · counts the work your role is here to do", chips "2-day streak", "2 MVP", "best day: 145", "100% on-time". Cards: "YOUR CONTRIBUTION — TASKS COMPLETED", "ON-TIME COMPLETION — Task-window timeliness (not clock-in)", "HOW MANAGERS HAVE RATED YOU" (a green/light-green/orange bar), "STREAKS" (2 ACTIVE DAYS, 3 ON-TIME IN A ROW, 145 PERSONAL BEST, 2 MVP WINS; "Early-clock-in streaks unlock when Toast connects."), "FEEDBACK FROM SHIFTS" (MON, SEP 28 MVP ⭐ / WED, SEP 23 MVP ⭐ / SUN, SEP 13 MVP ⭐, each with Arrived ready / Attitude / Production / Team player ratings).
- Shot: img/staff/41-my-performance.png
- Bug?: the two charts do not look like finished charts: "YOUR CONTRIBUTION — TASKS COMPLETED" shows only a row of short yellow dashes along the bottom and a steep yellow line at the far right edge; "ON-TIME COMPLETION" is blank except a short green mark at the far right edge. They did not change after 15+ seconds and a retake, so this is how the page draws today (a 30-day DAY range with data only on the last day), not a half-drawn frame. Kept it.

## Step 42 — logged-out
- URL: /
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Dashboard, scrolled to the bottom (no Reports section now that the shift was ended), tapped "LOG OUT" (no confirm box).
- Saw: the login start screen: "Manager login →", "Where are you?", tiles "MEP Capitol Hill" and "EM P Street".
- Shot: img/staff/42-logged-out.png
