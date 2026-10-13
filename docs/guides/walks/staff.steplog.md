# Staff walk — step log (Maya Torres, 2026-10-13)

## Step 01 — where-are-you
- URL: /
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Ran `start phone walker`, then `look`. Photographed the first screen.
- Saw: Top link "Manager login →". Heading "Where are you?" with two location tiles: "MEP" / "Capitol Hill" and "EM" / "P Street". (Short codes on the tiles: MEP = Capitol Hill, EM = P Street.) Page label above: "OPERATIONS".
- Shot: img/staff/01-where-are-you.png
- Confused: none
- Bug?: none

## Step 02 — whats-your-role
- URL: /
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped the "P Street" tile ("Select location P Street").
- Saw: Heading "What's your role?" with the line "EM · P STREET" and eight role tiles, each with a short code and a name: "GM" General Manager; "AGM" Assistant General Manager; "CTR" Catering Manager; "SL" Shift Lead; "KH" Key Holder; "TR" Trainer; "EMP" Employee; "TRN" Trainee. A "← Back" button at the bottom.
- Shot: img/staff/02-whats-your-role.png
- Confused: none
- Bug?: none

## Step 03 — who-are-you
- URL: /
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped the "Employee" tile ("Select role Employee").
- Saw: Heading "Who are you?" with the line "EM · P STREET · EMPLOYEE" and two people tiles: "DC" Deshawn Carter and "MT" Maya Torres. A "← Back" button.
- Shot: img/staff/03-who-are-you.png
- Confused: none
- Bug?: none

## Step 04 — pin-keypad
- URL: /
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped the "Maya Torres" tile ("Select user Maya Torres").
- Saw: Small label "EMPLOYEE" and the name "Maya Torres", heading "Enter your 4-digit PIN", a keypad with 1 2 3 / 4 5 6 / 7 8 9 and a bottom row "Clear", "0", "←" (the "←" button is labelled "Back" by the screen reader). Below it: "← Back" and a link/button "Use system keyboard". There is no submit button. Then tapped `1` four times; it signed in on the fourth digit and showed "Loading…" briefly, then the dashboard.
- Shot: img/staff/04-pin-keypad.png
- Confused: The keypad has "Clear" and a "←" key; the control list names the "←" key "Back". The tile screens have a separate "← Back" button (labelled "← Back").
- Bug?: none

## Step 05 — dashboard
- URL: /dashboard
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Waited for "Loading…" to clear, then photographed the top of the dashboard.
- Saw: Header "COMPLIMENTS ONLY", "OPERATIONS", a round "M" user-menu button at the top right. Heading "DASHBOARD" and "Hi, Maya Torres." Then "EXPLORE".
- Shot: img/staff/05-dashboard.png
- Confused: none
- Bug?: none

## Step 06 — dashboard-full
- URL: /dashboard
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Full-page photo of the dashboard.
- Saw, top to bottom: "COMPLIMENTS ONLY / OPERATIONS", "DASHBOARD", "Hi, Maya Torres." Then "EXPLORE" with nine chips: "Mid-Shift Pulse", "Reports Hub", "Assignments", "Written Reports", "Maintenance", "Training", "Profile", "Settings", "My Performance". Then the role badge "EMPLOYEE" and the shop chip "EM · P STREET". Then the board "My shift" with three collapsed rows: "Tasks — 3 of 8 assigned ▸", "Stations — 0 of 1 assigned ▸", "Team today — 1 of 7 assigned ▸", and a link "VIEW MY DAY". Then "TODAY'S OPERATIONS" card: "EM · P Street", "Tue, Oct 13", "CLOSING CHECKLIST", "Not started", button "START CLOSING". Then "REPORTS" with three tiles in this order: "OPENING REPORT — Not started today — OPEN / CONTINUE"; "AM PREP — Not yet started — Assigned by Priya Shah — START AM PREP"; "MID-DAY PREP — No mid-day preps started today. — + NEW MID-DAY PREP". Last: "LOG OUT". There is also a bell button ("Notifications. Open notifications").
- Shot: img/staff/06-dashboard-full.png
- Confused: The script says to expect the Reports tiles in the order Opening Report, Mid-day Prep, AM Prep; the screen shows Opening Report, AM Prep, Mid-day Prep. The opening tile has no "Assigned by" line; only AM Prep shows "Assigned by Priya Shah". No "Claim / change station" button is visible on the collapsed My shift board (see step 18).
- Bug?: none

## Step 07 — opening-verify
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: From the dashboard, tapped the "OPEN / CONTINUE" link on the Opening Report tile (in Reports). Waited for "Loading…" to clear.
- Saw: Back link "‹ DASHBOARD", label "OPENING REPORT", title "Phase 1 — Verification", subtitle "Verify last night's closing matches reality. Tap each station once you've checked it; add a comment if anything looks off." Tabs: "PHASE 1 · VERIFY" and "PHASE 2 (LOCKED)". First card "CRUNCHY BOI STATION — 0 of 4 done" with a "VERIFIED" button, lines "Station appears clean as reported", "Crunchy Boi Fridge temp (≤41°F)" (with a temperature box), "Sauces topped off & dated correctly", "Station ready for service (containers placed, prep ready)", each with "ADD COMMENT". Other station cards (collapsed): "3RD PARTY STATION", "WALK INS STATION", "PREP FRIDGE", "PREP AREA", "BACK LINE OPEN", "EXPO STATION", "FRONT OF HOUSE OPEN", "MANAGER OPEN", "WALK-OUT VERIFICATION", each with a "VERIFIED" button. Then prep sections "VEG" (0 of 6), "COOKS" (0 of 6), "SIDES" (0 of 6), "SAUCES" (0 of 11), "SLICING" (0 of 9), each with a greyed "VERIFY SECTION" button and the note "Recount items without closer data first". Bottom bar: "0 of 44 verified · 0 of 8 temp readings entered", "44 items not yet verified", link "SHOW ME WHAT NEEDS FIXING", greyed button "SUBMIT OPENING".
- Shot: img/staff/07-opening-verify.png
- Confused: The Phase 2 tab is "PHASE 2 (LOCKED)" and its control reads "Phase 2 locked — complete verification first".
- Bug?: "WALK INS STATION" and a "Walk-In Fridge temp (≤41°F)" line exist in the app, although AGENTS.md says the shops have no walk-ins.

## Step 08 — opening-station-verified
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped "VERIFIED" on the Crunchy Boi Station card ("Mark Crunchy Boi Station as verified"). Waited for "Saving…" to turn into "Saved a moment ago", then retook.
- Saw: The card header shows a filled "✓ VERIFIED" and "3 of 4 done" (the temperature line stays unticked until its box is filled; the three other lines are ticked). Bottom bar "4 of 44 verified · 0 of 8 temp readings entered", "40 items not yet verified", "Saved a moment ago".
- Shot: img/staff/08-opening-station-verified.png
- Confused: The bottom bar briefly said "Saving…" right after the tap (first attempt not used).
- Bug?: none

## Step 09 — opening-temperature
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Typed `36` in the "Crunchy Boi Fridge temp (≤41°F)" box (labelled "Temperature reading for Crunchy Boi Fridge temp (≤41°F)"). The empty box shows a dash "—" as its placeholder.
- Saw: Box shows 36. Card now reads "4 of 4 done" with a green tick next to the station name. Bottom bar "4 of 44 verified · 1 of 8 temp readings entered", "Saved a moment ago".
- Shot: img/staff/09-opening-temperature.png
- Confused: none
- Bug?: none

## Step 10 — opening-section-verify
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Opened the "VEG" prep section. Its six rows (Iceberg, Onion, Basil, Radish, Cucumber, Tomato) each showed "OPENER RECOUNT —" (a number box) and no closer count, so typed `2` in each. "VERIFY SECTION" turned on. Tapped it.
- Saw: VEG header shows "✓ VERIFIED" and "6 of 6 done". The recount rows stay shown with "OPENER RECOUNT" and the number 2 in a red-bordered pink box; the row circles stay unticked. Bottom bar "4 of 44 verified · 1 of 8 temp readings entered" did not change right after the tap.
- Shot: img/staff/10-opening-section-verify.png
- Confused: The recount box is outlined in red/pink even though it is filled (it seems to mark "no closing count from last night", not an error message). VEG says "6 of 6 done" while its item circles are still empty.
- Bug?: none

## Step 11 — opening-ready
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Finished Phase 1 with no photos: tapped the "VERIFIED" button on all nine other stations; expanded each station with a temperature line and typed the temperatures 37, 38, 35, 36, 37, 38, 36 in order (3rd-Party Fridge, Walk-In Fridge, Sauce Fridge, 3-Door Fridge, Back-Line Drinks Fridge, Deli Display Fridge, FOH Drinks Fridge; each "temp (≤41°F)"); typed `2` in every "OPENER RECOUNT" box of COOKS, SIDES, SAUCES and SLICING (none showed a closer count) and tapped "VERIFY SECTION" on each. Then a pink box "NO PRIOR CLOSING DATA DETECTED" appeared; chose "Closing was missed / I don't know". Scrolled to the bottom.
- Saw: Pink box "NO PRIOR CLOSING DATA DETECTED — 38 item(s) had no closing count from last night — morning recounts were entered. Confirm the reason:" with two radio choices "Location was closed (planned)" and "Closing was missed / I don't know" (second chosen; line under it "Attestation: Closing was missed / I don't know"). Bottom bar: "44 of 44 verified · 8 of 8 temp readings entered", "Submit ready", "Saved a moment ago", and the yellow button "SUBMIT OPENING" now enabled. (While not ready the bar said "Submit disabled".)
- Shot: img/staff/11-opening-ready.png
- Confused: "44 of 44 verified" turned up after the nine stations were verified, before the prep sections were; the count did not change when the prep sections were verified. No other reason box appeared.
- Bug?: none
- Notes: The page saves itself as you go: the bottom bar shows "Saving…" and then "Saved a moment ago". Comment fields on the station cards: every line on a station card has an "ADD COMMENT" link. After the opening was submitted I opened one on the Phase 1 tab (line "Station appears clean as reported"): it shows a "COMMENT" box with the placeholder "Note any discrepancy", read-only (disabled) after submit. Every prep row (Veg, Cooks, Sides, Sauces, Slicing) also has an "ADD COMMENT" link. The temperature boxes show a dash "—" when empty.

## Step 12 — opening-submitted
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped "SUBMIT OPENING" (an employee assigned the opening can submit it; the app did not refuse). Scrolled to the top.
- Saw: The same page title "Phase 1 — Verification" (unchanged) with the tabs "PHASE 1 · VERIFY" and "PHASE 2 — PREP ENTRY" (now unlocked and selected). Link "SHOW ME WHAT NEEDS FIXING". First card "VEG" with a greyed "✓ VERIFIED" and the note "Recount items without closer data first", then "Iceberg — Par: 7 1/3 Pan", "CLOSER COUNT: 2 1/3 Pan", "PREP NEED: 5 1/3 Pan", "OPENER PREPPED" box. Bottom bar "44 of 44 verified · 8 of 8 temp readings entered · 0 of 38 prep entries", "38 prep items not yet saved", greyed button "FINALIZE PHASE 2 (38 OUTSTANDING)".
- Shot: img/staff/12-opening-submitted.png
- Confused: The title still says "Phase 1 — Verification" while the Phase 2 tab is open. No "submitted" message appeared; the page just switched tabs.
- Bug?: none

## Step 13 — opening-prep-entry
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: On the "PHASE 2 — PREP ENTRY" tab, scrolled down to show the first rows before typing.
- Saw: Rows "Onion — Par: 8 Quart / CLOSER COUNT: 2 Quart / PREP NEED: 6 Quart / OPENER PREPPED (empty box) / Uses: 0 Onion (red) · … tap to confirm usage / Not saved", "Basil — Par: 4 Quart / CLOSER COUNT: 2 Quart / PREP NEED: 2 Quart", "Radish — Par: 1 Quart / CLOSER COUNT: 2 Quart / PREP NEED: 0 Quart". Every empty row says "Not saved". Bottom bar "0 of 38 prep entries".
- Shot: img/staff/13-opening-prep-entry.png
- Confused: Tomato's row shows "CLOSER COUNT: 2" and "Prep need: verify section first" (no par/unit).
- Bug?: none

## Step 14 — opening-prep-filled
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: In the first three rows typed the Prep need in "OPENER PREPPED": Iceberg `5` (Prep need is "5 1/3 Pan"; typing "5 1/3" left the box empty, so only 5 was typed), Onion `6`, Basil `2`. A row saves when you leave the box (the "Not saved" line changes to "Saved by Maya Torres at 1:27 PM" with an "UNDO" button).
- Saw: Each of the three rows shows "At par" in green italics, "Saved by Maya Torres at 1:27 PM" and a round "UNDO" button. Uses lines: "Uses: 1.02 Iceberg · ~685 oz", "Uses: 0 Onion (red) · ~2 oz", "Uses: 0.03 Basil · ~1 oz", each with "tap to confirm usage". Bottom bar "44 of 44 verified · 8 of 8 temp readings entered · 3 of 38 prep entries", "35 prep items not yet saved", button "FINALIZE PHASE 2 (35 OUTSTANDING)" (disabled; not tapped).
- Shot: img/staff/14-opening-prep-filled.png
- Confused: The Iceberg row says "At par" with 5 entered against a need of 5 1/3. Typing a fraction ("5 1/3") into the box did not stick.
- Bug?: none

## Step 15 — my-shift
- URL: /dashboard?loc=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped "Back to Dashboard" from the opening page, scrolled to the "My shift" board.
- Saw: Notification bell now shows a red "1". "EMPLOYEE" badge, "EM · P STREET" chip, then the "My shift" card with three collapsed rows: "Tasks — 3 of 8 assigned", "Stations — 0 of 1 assigned", "Team today — 1 of 7 assigned" (each with a ▸ arrow), and "VIEW MY DAY". The Opening Report tile now reads "In progress".
- Shot: img/staff/15-my-shift.png
- Confused: none
- Bug?: none

## Step 16 — board-tasks
- URL: /assignments?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped the "Assignments" chip under Explore. On this page "Stations" opens by default and "Tasks" is collapsed; collapsed "Stations" and opened "Tasks" (tap on its row).
- Saw: Back link "Dashboard", title "Assignments", "Tue, Oct 13", chip "P Street", card "Today's team", a link-button "STATIONS", rows "Stations — 0 of 12 assigned" and "Tasks — 3 of 8 assigned". Task list, in order: "CLOSING CHECKLIST — Everyone on shift · no assignment needed" (link); "AM PREP — Assigned to Maya Torres by Priya Shah · 1:10 PM" (link); "MID-DAY PREP — Assigned to Maya Torres by Priya Shah · 1:10 PM" (link); "Cash report — Unassigned"; "OPENING PREP — Assigned to Maya Torres by Priya Shah · 1:10 PM" (link); "Receiving — Unassigned"; "Counts — Unassigned"; "Ordering — Unassigned"; "PM report — Unassigned". Then a third row "Who has what — 1 of 7 assigned".
- Shot: img/staff/16-board-tasks.png
- Confused: There are nine names in the list, but the header says "3 of 8 assigned" (Closing checklist needs no assignment). The four links are the ones for me (Closing checklist and my three assigned tasks); the unassigned tasks ("Cash report", "Receiving", "Counts", "Ordering", "PM report") are plain text with the word "Unassigned" and no link. No task belongs to another person today. On the dashboard the board says "Stations — 0 of 1 assigned" but this page says "0 of 12 assigned".
- Bug?: none

## Step 17 — board-stations
- URL: /assignments?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Collapsed "Tasks", opened "Stations".
- Saw: "Stations — 0 of 12 assigned" open, with these groups and positions (all "Unassigned"): "Crunchy Boi Station · 0 of 1" (Crunchy Boi Station), "3rd Party Station · 0 of 1" (3rd Party Station), "Walk Ins Station · 0 of 2" (Walk-ins "Dedicated to walk-in orders; helps with online orders when there are no subs to make"; Walk-ins / Online "Half walk-ins, half online orders; leans toward walk-ins"), "Prep Fridge · 0 of 1" (Prep Fridge), "Shut Down Back Line · 0 of 1", "Expo Station · 0 of 2" (Expeditor "Expedites the orders"; Register & Delivery "Runs the cash register and hands out delivery orders"), "Clean front of house · 0 of 1", "Prep Area · 0 of 1", "Closing Manager · 0 of 1", "Walk-Out Verification · 0 of 1".
- Shot: img/staff/17-board-stations.png
- Confused: The station rows are plain text (not links).
- Bug?: none

## Step 18 — claim-station
- URL: /dashboard?loc=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Went back to the dashboard (the "Dashboard" link), tapped the "Stations — 0 of 1 assigned" row on "My shift" to open it, scrolled to it.
- Saw: Inside it: "On shift · Active in CO-OPS", buttons "START BREAK" and "END MY SHIFT", the line "No station", a label "Station" with a drop-down showing "No station", and the yellow button "CLAIM / CHANGE STATION". Below: "Tasks" with links "OPENING PREP", "MID-DAY PREP", "AM PREP", each "Assigned by Priya Shah · 1:10 PM". The drop-down choices (in order): "No station", "Crunchy Boi Station · Crunchy Boi Station · fill first", "3rd Party Station · 3rd Party Station · fill first", "Walk Ins Station · Walk-ins · fill first", "Walk Ins Station · Walk-ins / Online", "Prep Fridge · Prep Fridge · fill first", "Shut Down Back Line · Shut Down Back Line · fill first", "Expo Station · Expeditor · fill first", "Expo Station · Register & Delivery", "Clean front of house · Clean front of house · fill first", "Prep Area · Prep Area · fill first", "Closing Manager · Closing Manager · fill first", "Walk-Out Verification · Walk-Out Verification · fill first".
- Shot: img/staff/18-claim-station.png
- Confused: The "Stations" row has to be opened first; the claim button is not visible on the collapsed board. The choices are in a drop-down, not tiles, and the button was tapped only after a choice was picked.
- Bug?: none

## Step 19 — station-claimed
- URL: /dashboard?loc=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Picked "Crunchy Boi Station · Crunchy Boi Station · fill first" (the first open position) in the drop-down and tapped "CLAIM / CHANGE STATION". A pop-up "Confirm change" opened: "Reason for change" drop-down (choices: "No reason (optional)", "Coverage change", "Person left or unavailable", "Skill fit", "Correction", "Other") and a "Note (optional)" box (empty, no placeholder text). Left the reason as "No reason (optional)", tapped "CONFIRM CHANGE" (the other button is "CANCEL"). Waited a few seconds.
- Saw: The board shows a green tick by "Stations — 1 of 1 assigned" and "Crunchy Boi Station · Crunchy Boi Station — Claimed · 1:31 PM"; the drop-down now says "Crunchy Boi Station · Crunchy Boi Station · fill first · taken by Maya". Under Reports a new card "My station: Crunchy Boi Station" (shown in the photo) appears above the Opening Report tile (the tile reads "In progress").
- Shot: img/staff/19-station-claimed.png
- Confused: Right after "CONFIRM CHANGE" the board still read "No station" for a few seconds before it updated. The "Confirm change" pop-up is not in the call list and was not photographed.
- Bug?: none

## Step 20 — closing-checklist
- URL: /operations/closing?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: From the dashboard, tapped "START CLOSING" on the Today's operations card. Waited for the page to load.
- Saw: Back link "‹ DASHBOARD", small label "CLOSING CHECKLIST", title "EM · P Street", "PROGRESS 0/61" with a bar. The first card, "CRUNCHY BOI STATION — 0 of 6 done ▾" (my station), is already open, with these lines, each a round tick box: "Restock", "Wipe inside & outside", "Wipe tops of sauce bottles", "Combine & check dates on sauces", "Pull out station and sweep", "Crunchy Boi Fridge temp (≤41°F)". The other sections are folded: "3RD PARTY STATION 0 of 6", "WALK INS STATION 0 of 6", "PREP FRIDGE 0 of 6", "SHUT DOWN BACK LINE 0 of 4", "EXPO STATION 0 of 5", "CLEAN FRONT OF HOUSE 0 of 7", "PREP AREA 0 of 9", "CLOSING MANAGER 0 of 7", "WALK-OUT VERIFICATION 0 of 5".
- Shot: img/staff/20-closing-checklist.png
- Confused: none
- Bug?: none

## Step 21 — closing-my-station
- URL: /operations/closing?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Looked for the section of my station. The page opens with my section ("CRUNCHY BOI STATION") already open at the top, so no scrolling was needed; the shot is the same screen as step 20.
- Saw: Same as step 20: "CRUNCHY BOI STATION — 0 of 6 done" open with its six unticked lines.
- Shot: img/staff/21-closing-my-station.png
- Confused: The shot repeats step 20 because my section is the first one and starts open.
- Bug?: none

## Step 22 — closing-ticked
- URL: /operations/closing?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped "Restock" and "Wipe inside & outside".
- Saw: "PROGRESS 2/61", "CRUNCHY BOI STATION — 2 of 6 done". Each ticked line turns cream with a black-ringed yellow tick, shows a square "UNDO" button at its right, the text "you · 1:32 PM" under it and a small "Add note" link. Unticked lines have no "Add note" link.
- Shot: img/staff/22-closing-ticked.png
- Confused: none
- Bug?: none

## Step 23 — closing-note
- URL: /operations/closing?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: The third line "Wipe tops of sauce bottles" has no note control until it is ticked, so ticked it (3rd tick), tapped its "Add note", typed `Out of lids — told the shift lead` in the box and tapped "SAVE NOTE". (The open note box is a text box named "Anything noteworthy?", with the buttons "SAVE NOTE" and "Cancel".)
- Saw: Under the line: "you · 1:33 PM", the note in italics "Out of lids — told the shift lead", and a link "Edit note" (it replaced "Add note"). "PROGRESS 3/61", "3 of 6 done".
- Shot: img/staff/23-closing-note.png
- Confused: The note control only shows on a line that is already ticked. The open note box was not photographed.
- Bug?: none

## Step 24 — closing-full
- URL: /operations/closing?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Opened every folded section (tapped each header) and took a full-page photo.
- Saw, section by section: "CRUNCHY BOI STATION" (6 lines, above); "3RD PARTY STATION" — Restock, Wipe inside & outside, Wipe tops of sauce bottles, Combine & check dates on sauces, Pull out station and sweep, "3rd-Party Fridge temp (≤41°F)"; "WALK INS STATION" — the same five lines, "Walk-In Fridge temp (≤41°F)" with the hint "Record cooler temp in Fahrenheit"; "PREP FRIDGE" — the same five lines, "Sauce Fridge temp (≤41°F)"; "SHUT DOWN BACK LINE" — Wipe down burners, Wipe down tile walls, Wipe wall under prep tables, "Back-Line Drinks Fridge temp (≤41°F)"; "EXPO STATION" — Change & stock cannoli pan, Wipe out deli display fridge, Restock bevs, Cookies & gluten free, "Deli Display Fridge temp (≤41°F)"; "CLEAN FRONT OF HOUSE" — Bathrooms, Patio furniture, Sweep, Mop, Restock bev fridge, Put away / organize cases, "FOH Drinks Fridge temp (≤41°F)"; "PREP AREA" — Organize Back Walk In, Clean Oven Window, Organize Smallwares & Utensils, Organize Dry Storage, Wipe down 3 door fridge, Wipe out 3 bay sink, Drain & turn off dish Machine, Trash to dumpster, "3-Door Fridge temp (≤41°F)"; "CLOSING MANAGER" (0 of 7) — Count the drawer, Count and secure tips, and five report lines (below); "WALK-OUT VERIFICATION" — Lights off, Devices charging, Oven off, Front doors locked, Back door locked. At the very bottom an amber box: "AM Prep had 0 items saved today - check with the opener."
- Report lines in CLOSING MANAGER (they are links, "tap to submit from the AM Prep page", not tick boxes): "AM Prep List — Pending — submit from the dashboard"; "Opening verified — Pending — submit from the dashboard"; "Mid-day Prep — Pending — submit from the dashboard"; "Cash deposited — Assigned shift task required"; "PM Report submitted — Assigned shift task required". There is also a sub-line "Count tips, place in safe. Weekly distribution handled separately by AGM+."
- No line is marked "awaiting higher role". No button at the bottom of the page (no "Submit"/"Finish" button; only the amber AM Prep box). The page has no note box except the "Add note" link on ticked lines.
- Shot: img/staff/24-closing-full.png
- Confused: The report lines are in the Closing Manager section (7 lines in the count), and the three "Pending" ones are links, not tick boxes. "Walk In" lines exist here although the shops have no walk-in fridge (AGENTS.md).
- Bug?: none

## Step 25 — pulse
- URL: /mid-shift?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Dashboard → Explore → "Mid-Shift Pulse". Waited for the page to load.
- Saw: Back link "‹ DASHBOARD", title "Mid-shift Pulse", "EM · P Street", "Updated 1:34 PM", and the note "Refreshes every 60 s". First card "Needs attention — as of 1:34 PM — See more": a pink tag "NEEDS ACTION", a red dot and "Opening prep is late" with an "OPEN" button. Second card "Live shop floor — as of 1:34 PM — See more": "Tap a station for details.", a "MAP VIEW" button, a colour map of the shop with station names ("Crunchy Boi Station", "3rd Party Station", "Walk Ins Station", "Prep Fridge", "Shut Down Back Line", "Expo Station", "Clean front of house", "Prep Area", "Closing Manager", "Walk-Out Verification", each marked "UNCOVERED" except mine) and the key "Green covered · amber short, closing soon or past its close time · red uncovered · grey closed".
- Shot: img/staff/25-pulse.png
- Confused: The station labels on the map overlap each other. "Opening prep is late" shows although I started the opening (Phase 2 not finalized).
- Bug?: none

## Step 26 — pulse-full
- URL: /mid-shift?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Full-page photo.
- Saw, every section and its heading, top to bottom: "Needs attention" (as above); "Live shop floor" (as above); "Stations & tasks — as of 1:34 PM — See more": "1 covered · 0 short · 0 closing soon · 0 to close now · 9 uncovered · 0 closed", "Tasks: 0 done · 3 left", a "MY SHIFT" box "Crunchy Boi Station · Crunchy Boi Station" with "Opening prep — OPEN", "Mid-day prep — OPEN", "AM prep — OPEN", then each station with a tag ("Crunchy Boi Station · Maya — COVERED", "3rd Party Station — UNCOVERED", "Walk Ins Station — UNCOVERED", "Prep Fridge — UNCOVERED", "Shut Down Back Line — UNCOVERED", "Expo Station — UNCOVERED"); "Catering — as of 1:34 PM — See more": tag "DUE TODAY", "No catering due today.", "Tomorrow: no catering booked", "Prep: AM Not started · mid-day Not started", "Timing only: names and details are on the catering board for managers."; "Food safety — as of 1:34 PM — See more": "All fridges checked and in range.", "8 in range · 0 out of range · 0 unchecked"; "Handoff — as of 1:34 PM — See more": "Reports: 0 done · 5 left" with tags "OPENING", "AM PREP", "MID-DAY PREP", "CASH DEPOSIT", "CLOSING", and "No handoff notes for today."
- No "Not available for your role." card appears for this role. No fridge reminder text beyond "All fridges checked and in range." (the 8 fridge temps were entered in the opening).
- Shot: img/staff/26-pulse-full.png
- Confused: The Stations & tasks box on this page lists only six stations; the full list is on the next page.
- Bug?: none

## Step 27 — pulse-section
- URL: /mid-shift/stations?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped the "See more" link on the "Stations & tasks" card. The page took a few seconds to change, then loaded.
- Saw: Back link "‹ PULSE" (labelled "Back to Pulse"), card "Stations & tasks — as of 1:35 PM", "1 covered · 0 short · 0 closing soon · 0 to close now · 9 uncovered · 0 closed", "Tasks: 0 done · 3 left", "MY SHIFT / Crunchy Boi Station · Crunchy Boi Station" with underlined links "Opening prep", "Mid-day prep", "AM prep" (each tagged "OPEN"), then "Crunchy Boi Station · Maya — COVERED", and "UNCOVERED" for "3rd Party Station", "Walk Ins Station", "Prep Fridge", "Shut Down Back Line", "Expo Station", "Clean front of house", "Prep Area", "Closing Manager", "Walk-Out Verification", and at the end two links "Stations" and "Closing checklist".
- Shot: img/staff/27-pulse-section.png
- Confused: The first tap showed no change for a few seconds; it was slow, not dead.
- Bug?: none

## Step 28 — maintenance
- URL: /maintenance?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Dashboard → Explore → "Maintenance".
- Saw: Back link "‹ DASHBOARD", title "Maintenance Log", section "FRIDGE TEMPS" with eight cards, each with the fridge name, a green "OK" and the latest reading, and a small line graph with a dashed red line: "Walk-In Fridge OK 38°F", "3-Door Fridge OK 36°F", "Sauce Fridge OK 35°F", "Deli Display Fridge OK 38°F", "Crunchy Boi Fridge OK 36°F", "FOH Drinks Fridge OK 36°F", "Back-Line Drinks Fridge OK 37°F", "3rd-Party Fridge OK 37°F" (these are the temperatures typed in the opening). Then section "EQUIPMENT" with two cards: "Oven — No issues logged" and "Fryer — Last note: sim-seed 2026-10-07: Oil changed early, smelled burnt. (Sat, Sep 12)". Then "LOG A MAINTENANCE NOTE".
- Shot: img/staff/28-maintenance.png
- Confused: The fridge cards are links. Status words seen: "OK" only; no "Out of range" and no "No reading today". The Walk-In Fridge graph has one red dot above the dashed line earlier in its history.
- Bug?: There is a "Walk-In Fridge" in the list (AGENTS.md says the shops have no walk-ins).

## Step 29 — maintenance-note
- URL: /maintenance?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: In "LOG A MAINTENANCE NOTE", the "Equipment" drop-down lists: Walk-In Fridge, 3-Door Fridge, Sauce Fridge, Deli Display Fridge, Crunchy Boi Fridge, FOH Drinks Fridge, Back-Line Drinks Fridge, 3rd-Party Fridge, Oven, Fryer, Other…. There is no item named "Prep fridge" (the prep fridge station's fridge is called "Sauce Fridge"), so chose "Other…". A text box (placeholder/label "Equipment name") appeared; typed `Prep fridge`. In the note box (placeholder "What's going on?") typed `Prep fridge feels warm`.
- Saw: The filled form: "Equipment" = "Other…", name box "Prep fridge", note box "Prep fridge feels warm", yellow "SAVE NOTE" (it is greyed out while the note box is empty).
- Shot: img/staff/29-maintenance-note.png
- Confused: "Prep fridge" is not in the drop-down; the prep fridge station's fridge is called "Sauce Fridge" in the list, so "Other…" was used as the script says.
- Bug?: none

## Step 30 — maintenance-saved
- URL: /maintenance?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped "SAVE NOTE".
- Saw: A new section "OTHER EQUIPMENT NOTES" above the form with a card: "Prep fridge" / "Prep fridge feels warm" / "Tue, Oct 13 · Maya Torres". The note box is empty again (placeholder "What's going on?") and "SAVE NOTE" is greyed; the equipment name box still holds "Prep fridge". No toast or message appeared.
- Shot: img/staff/30-maintenance-saved.png
- Confused: none
- Bug?: none

## Step 31 — midday-tile
- URL: /dashboard
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Back to the dashboard, scrolled to the Reports section.
- Saw: Today's operations now reads "CLOSING CHECKLIST — In progress · 3 of 61 items" with the button "CONTINUE CLOSING". REPORTS: card "My station: Crunchy Boi Station"; "OPENING REPORT — In progress — OPEN / CONTINUE"; "AM PREP — Not yet started — Assigned by Priya Shah — START AM PREP"; "MID-DAY PREP — No mid-day preps started today. — + NEW MID-DAY PREP"; then "LOG OUT".
- Shot: img/staff/31-midday-tile.png
- Confused: none
- Bug?: none

## Step 32 — midday-count
- URL: /operations/mid-day?instance=095646d9-7429-4d42-8758-59cb021851b2
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped "+ NEW MID-DAY PREP".
- Saw: Back link "‹ DASHBOARD", label "MID-DAY PREP", title "Phase 1 — count to par". Section "VEG — 0 of 6 done ▾" (open) with rows, each with an empty box showing the placeholder "On hand": "Pickles — PAR 20 QUART", "Sweet Peppers — PAR 12 QUART", "Hot Peppers — PAR 12 QUART", "Basil — PAR 4 QUART", "Shredded Mozzarella — PAR 5 QUART", "Fresh Mozzarella — PAR 12 QUART". Section "SAUCES — 0 of 10 done ▸" (folded; when opened: Aioli PAR 15 BOTTLE, HC Aioli PAR 4, HP Mayo PAR 4, Mustard Aioli PAR 4, Horsey Mayo PAR 4, Salsa Verde PAR 1, Dukes PAR 3, Vin PAR 6, Caesar Dressing PAR — BOTTLE, Lemon Oil PAR 1, each with an "On hand" box). Yellow button "SUBMIT COUNT → PHASE 2".
- Shot: img/staff/32-midday-count.png
- Confused: ABSENT: there are no "Bulk backup" boxes on this form (neither in VEG nor SAUCES); only "On hand" boxes. The script expected both.
- Bug?: none

## Step 33 — midday-filled
- URL: /operations/mid-day?instance=095646d9-7429-4d42-8758-59cb021851b2
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Typed `4` in "On hand" for Pickles and `2` for Sweet Peppers. Did not tap "SUBMIT COUNT → PHASE 2".
- Saw: Boxes show 4 and 2. Under the names the lines now read "PAR 20 QUART · NEED: 16" and "PAR 12 QUART · NEED: 10". Header "VEG — 2 of 6 done". No limit message or error shown. Every label on the form: "MID-DAY PREP", "Phase 1 — count to par", "VEG", "SAUCES", "x of y done", item name, "PAR n UNIT", "NEED: n" (after typing), box placeholder "On hand", "SUBMIT COUNT → PHASE 2".
- Shot: img/staff/33-midday-filled.png
- Confused: none
- Bug?: none

AM prep retaken after sim data fix — see steps 43–45.

## Step 34 — end-my-shift
- URL: /dashboard
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Back on the dashboard, opened the "Stations" row of "My shift" and scrolled to the buttons.
- Saw: "Stations — 1 of 1 assigned" (green tick), "On shift · Active in CO-OPS", buttons "START BREAK" and "END MY SHIFT", "Crunchy Boi Station · Crunchy Boi Station", "Claimed · 1:31 PM", the "Station" drop-down, "CLAIM / CHANGE STATION", then "Tasks" with "OPENING PREP", "MID-DAY PREP", "AM PREP" (each "Assigned by Priya Shah · 1:10 PM"), and "Team today — 1 of 7 assigned".
- Shot: img/staff/34-end-my-shift.png
- Confused: The button is inside the open "Stations" row; it is not visible when the row is folded. Shot number 34 is used because shots 34-37 of the plan were skipped (AM prep blocked), so the plan's 38 became 34.
- Bug?: none

## Step 35 — shift-ended
- URL: /dashboard
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped "END MY SHIFT". No browser pop-up appeared (so no "DIALOG (accepted)" line). Instead an in-page pop-up opened, "Confirm change": "End your shift? Your station is released and your open tasks are unassigned." with "Reason for change" drop-down (default "No reason (optional)"; choices "Coverage change", "Person left or unavailable", "Skill fit", "Correction", "Other"), a "Note (optional)" box (empty, no placeholder) and the buttons "CONFIRM CHANGE" and "CANCEL". Left the reason, tapped "CONFIRM CHANGE". Waited about 8 seconds. (The pop-up was not photographed.)
- Saw: "My shift": "Tasks — 0 of 8 assigned" (was 3 of 8), "Stations — 0 of 1 assigned" (was 1 of 1), the station card says "Ended shift 1:43 PM" (was "On shift · Active in CO-OPS") with only "START BREAK" left (no "END MY SHIFT"), "No station", the "Station" drop-down back at "No station" with "CLAIM / CHANGE STATION", "Tasks" now says "No assigned tasks today.", "Team today — 0 of 7 assigned". Under Today's operations the closing card still says "CLOSING CHECKLIST — In progress · 3 of 61 items — CONTINUE CLOSING". The whole REPORTS section is gone: the "My station: Crunchy Boi Station" card, the "OPENING REPORT", "AM PREP" and "MID-DAY PREP" tiles no longer show (they are no longer assigned to Maya). Only "LOG OUT" follows the closing card.
- Shot: img/staff/35-shift-ended.png
- Confused: The script expected a browser confirm box ("DIALOG (accepted)"); the app showed its own "Confirm change" pop-up and it had to be confirmed by tapping "CONFIRM CHANGE". The dashboard still shows the bell with "1".
- Bug?: none

## Step 36 — profile
- URL: /profile
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Dashboard → Explore → "Profile".
- Saw: Back link "‹ DASHBOARD", title "Team Profiles", "Teammates at your location". A "LEADERSHIP" group with "Dana Brooks — MOO — LEADERSHIP"; then people tiles: "Maya Torres — You — EMP — ⭐ 10", "Deshawn Carter — EMP — ⭐ 5", "Marcus Webb — GM", "Priya Shah — AGM", "Rosa Delgado — KH", "Tommy Nguyen — SL" (each tile has the first letter of the name in a circle). Every tile is a link.
- Shot: img/staff/36-profile.png
- Confused: The page is named "Profile" in the Explore chips and "Team Profiles" on the page. There is no note or comment field on this page (the Settings page says "View your team and update your profile blurb.", and the blurb is on my own tile's page, which was not opened).
- Bug?: none

## Step 37 — settings-language
- URL: /settings
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Dashboard → Explore → "Settings". The page is short, so the Language card is already in view. Did not change it.
- Saw: Back link "‹ DASHBOARD", title "Settings", "Your app preferences.", card "Language — The language used across the app." with two buttons "ENGLISH" (selected) and "ESPAÑOL", then card "Profile — View your team and update your profile blurb." with "GO TO PROFILE".
- Shot: img/staff/37-settings-language.png
- Confused: none
- Bug?: none

## Step 38 — user-menu
- URL: /settings
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped the round "M" button at the top right ("User menu"). Then tapped it again to close the menu without choosing anything.
- Saw: A card: "SIGNED IN AS", "Maya Torres", "maya@sim.co-ops" (the sim's fake address); "LANGUAGE" with two buttons "EN · ENGLISH" (selected) and "ES · ESPAÑOL"; then the menu items "Dashboard" and "Sign out".
- Shot: img/staff/38-user-menu.png
- Confused: none
- Bug?: none

## Step 39 — written-reports
- URL: /reports/written?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Dashboard → Explore → "Written Reports". (Did not tap the "CSV" or "PDF" download buttons.)
- Saw: Back links "‹ REPORTS" and "DASHBOARD", chip "P Street", title "Written Reports", "Free-form posts for anything that doesn't fit a structured report.", "Date range" drop-down (Today, Yesterday, Last 7 days, Last 30 days, This month, Last month, Custom; set to "Last 7 days"), "From" 10/07/2026, "To" 10/13/2026, a box "Compare with previous period", "Apply", "Up to 92 inclusive days. Comparison applies to summary counts and trends.", "Download" with "CSV" and "PDF", a "NEW REPORT" button, and the empty text "No written reports yet."
- Shot: img/staff/39-written-reports.png
- Confused: none
- Bug?: none

## Step 40 — written-report-form
- URL: /reports/written?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped "NEW REPORT". Typed nothing. Tapped "CANCEL" afterwards (nothing posted).
- Saw: A dashed form above "No written reports yet.": "Title (optional)" box with placeholder "Short summary"; "What happened" text area with placeholder "Describe it in your own words…"; "Category" drop-down (None, Incident, Observation, Request, Feedback, Other; default "None"); "Who can see this" drop-down (only "All staff"); buttons "CANCEL" and "POST REPORT" (greyed out until the text area has text).
- Shot: img/staff/40-written-report-form.png
- Confused: The photo shows the form from "Title (optional)" down to the start of the "What happened" box; the Category, "Who can see this" and the buttons are below the fold of the photo.
- Bug?: none

## Step 41 — my-performance
- URL: /my-feedback
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Back to the dashboard (the "Back to Dashboard" link), then Explore → "My Performance". Waited for the chart to settle.
- Saw: Back link "‹ REPORTS" and "DASHBOARD", title "My Performance", chip "P Street", "From" 09/14/2026, "To" 10/13/2026, "Apply range", period buttons "DAY" (selected), "WEEK", "MONTH", and "COMPARE TO PREVIOUS". Green card: "2 MVP win(s) this period — keep it up! 🌟", the big number "1016", "your score · counts the work your role is here to do", pills "1-day streak", "2 MVP", "best day: 85". Card "YOUR CONTRIBUTION — TASKS COMPLETED" (a small bar chart). Further down: "ON-TIME COMPLETION — Task-window timeliness (not clock-in)", "HOW MANAGERS HAVE RATED YOU", "STREAKS" (1 "ACTIVE DAYS", 0 "ON-TIME IN A ROW", 85 "PERSONAL BEST", 2 "MVP WINS"), "Early-clock-in streaks unlock when Toast connects.", "FEEDBACK FROM SHIFTS" with ten dated cards (e.g. "MON, SEP 28 MVP ⭐ — Arrived ready: Great / Attitude: Needs work / Production: Good / Team player: Needs work"), and the closing note "Manager-private notes are never shown here — only your own structured feedback."
- Shot: img/staff/41-my-performance.png
- Confused: The "DASHBOARD" link at the top is half hidden behind the round user button. There are no note or comment fields on this page.
- Bug?: none

## Step 42 — logged-out
- URL: /
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: From My Performance the "DASHBOARD" link at the top was covered by the round user button and could not be tapped (3 tries), so opened the user menu and tapped "Dashboard". On the dashboard tapped "LOG OUT" at the bottom.
- Saw: The first screen again: "OPERATIONS", link "Manager login →", heading "Where are you?" with the tiles "MEP / Capitol Hill" and "EM / P Street".
- Shot: img/staff/42-logged-out.png
- Confused: none
- Bug?: On /my-feedback (My Performance) and /reports/written the "DASHBOARD" link is partly hidden behind the round user button (it shows as "DASHB…"), so it could not be tapped.

## Step 43 — am-prep-sheet
- URL: /operations/am-prep?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Fresh walk (retake). Logged in by tapping P Street, Employee, Maya Torres, PIN 1111. On the dashboard, Reports, tapped "START AM PREP".
- Saw: Back link "‹ DASHBOARD", small title "AM PREP", heading "EM · P Street". Six folded-or-open sections, each with a "0 of N done" count and an arrow: "VEG" (0 of 6, open), "COOKS" (0 of 6), "SIDES" (0 of 6), "SAUCES" (0 of 11), "SLICING" (0 of 9), "MISC" (0 of 4). In VEG the column headings are "PAR", "ON HAND", "BACK UP", "TOTAL". Rows: Iceberg (par "7 1/3 Pan"), Onion ("8 Quart"), Basil ("4 Quart"), Radish ("1 Quart"), Cucumber ("3 Quart"), Tomato ("Prep Daily"). Each empty "ON HAND" box has a red "Required" under it; "BACK UP" is optional and "TOTAL" fills itself (shaded). At the bottom of the page: "Fix 42 issues before submitting" with the button "SHOW ME WHAT NEEDS FIXING" and a greyed-out button "FIX ISSUES BEFORE SUBMITTING". Other sections have different column headings: COOKS "PAR / ON HAND / BACK UP / TOTAL"; SIDES "PAR / PORT / BACK UP / TOTAL" (the box label is "PORTIONED"); SAUCES and SLICING "PAR / LINE / BACK UP / TOTAL"; MISC has no columns, only YES / NO questions: "Meatball mix - ready?", "Meatballs - ready to cook?", "Meatballs - for reheat?", "Cook Bacon?", then a notes box.
- Shot: img/staff/43-am-prep-sheet.png
- Confused: none. All 42 rows are required (VEG 6, COOKS 6, SIDES 6, SAUCES 11, SLICING 9, MISC 4 yes/no questions) and the sheet has no part-way submit.
- Bug?: none. The sheet opened without the earlier crash.

## Step 44 — am-prep-filled-row
- URL: /operations/am-prep?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Typed `2` in "ON HAND" for Iceberg, `1` for Onion and `3` for Basil. Waited for the page to settle.
- Saw: The three rows show 2, 1 and 3 in "ON HAND" and the same number in the shaded "TOTAL" box. The heading now reads "VEG — 3 of 6 done". The remaining rows (Radish, Cucumber, Tomato) still show a red "Required". A small "Saved" line and a "DISCARD CHANGES" button appeared at the bottom of the page, and the bottom bar changed to "Fix 39 issues before submitting".
- Shot: img/staff/44-am-prep-filled-row.png
- Confused: none
- Bug?: none

(Step 45 is not used: the AM Prep page has no confirm step, "SUBMIT AM PREP" sends at once. The next shot keeps its planned number, 46.)

Between steps 44 and 46 (no shot): typed `1` in "ON HAND" for the other three VEG rows, then opened each other section and filled it: COOKS "ON HAND" `1` in all 6 rows; SIDES "PORTIONED" `1` in all 6 rows; SAUCES "LINE" `1` in all 11 rows; SLICING "LINE" `1` in all 9 rows; MISC tapped "YES" on all 4 questions. Each section header turned to "✓ NAME N of N done" and the bottom button changed to "SUBMIT AM PREP". "BACK UP" boxes were left empty. The MISC notes box: textarea with placeholder "Add notes…" (left empty). Tapped "SUBMIT AM PREP" the first time: the page refused with a line at the top, "Closing not yet started — start it from the dashboard, then re-submit AM Prep" (not photographed). Went to the dashboard, tapped "START CLOSING" (opens "CLOSING CHECKLIST", "PROGRESS 0/61"), went back to the dashboard, tapped "CONTINUE AM PREP" (the tile had changed from "START AM PREP"). The sheet came back with a line "Picked up where you left off at 2:21 PM (Maya Torres)" and every entered number kept. Tapped "SUBMIT AM PREP" again.

## Step 45 — am-prep-done
- URL: /operations/am-prep?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Maya Torres, Employee / 390x844
- Action: Tapped "SUBMIT AM PREP" (second time, after starting the closing checklist). Scrolled back to the top of the page.
- Saw: A green banner under the "EM · P Street" heading: "AM Prep submitted at 2:22 PM by Maya Torres". The sections are all ticked ("✓ VEG", "✓ COOKS", "✓ SIDES" … "6 of 6 done" etc.) and the boxes are now shaded/read-only with the entered numbers (1 in each ON HAND / PORT / LINE box). The "SUBMIT AM PREP" button is gone. Opening the closing checklist afterwards showed "PROGRESS 1/61" (was 0/61 before the submit; the line itself was not looked at, so it is likely the AM Prep line ticking itself).
- Shot: img/staff/45-am-prep-done.png
- Confused: The page stays on the same URL after submit, scrolled to the bottom; it needed a scroll up to see the banner. In this photo "VEG" is folded (it keeps the folded state from the restored sheet).
- Bug?: The first submit says "Closing not yet started" — the AM Prep tile on the dashboard offers "START AM PREP" before the closing checklist exists, and only the refusal tells the user to start closing first.
