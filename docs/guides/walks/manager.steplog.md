# Manager walk — step log (Marcus Webb, 2026-09-08)

## Step 01 — login-where
- URL: /
- Persona / viewport: (not logged in) / 1280x800
- Action: Navigated to http://localhost:3100 (fresh session, no prior login to log out of).
- Saw: Heading "Compliments Only" / "Operations", a "Manager login →" button top of card, and "Where are you?" with two location tiles: "MEP / Capitol Hill" and "EM / P Street".
- Shot: img/manager/01-login-where.png

## Step 02 — manager-login-form
- URL: /
- Persona / viewport: (not logged in) / 1280x800
- Action: Clicked "Manager login →" at the top of the login card.
- Saw: Card flips to "Manager login" / "Email + password for AGM and above." with Email and Password fields (email placeholder "you@complimentsonlysubs.com"), a "Sign in" button, a "Forgot password?" link, note "Reset links go to manager email accounts. If you sign in with a PIN, ask a manager to reset it.", and a "Use tile login →" link to go back.
- Shot: img/manager/02-manager-login-form.png

## Step 03 — login-role
- URL: /
- Persona / viewport: (not logged in) / 1280x800
- Action: Clicked "Use tile login →", then "Select location P Street".
- Saw: "What's your role?" with subhead "EM · P Street" and eight role tiles: General Manager (GM), Assistant General Manager (AGM), Catering Manager (CTR), Shift Lead (SL), Key Holder (KH), Trainer (TR), Employee (EMP), Trainee (TRN); a "Back" link.
- Shot: img/manager/03-login-role.png

## Step 04 — login-user
- URL: /
- Persona / viewport: (not logged in) / 1280x800
- Action: Clicked "Select role General Manager".
- Saw: "Who are you?" with subhead "EM · P Street · General Manager" and a single user tile "Marcus Webb" (initials MW).
- Shot: img/manager/04-login-user.png

## Step 05 — login-pin
- URL: /
- Persona / viewport: (not logged in) / 1280x800
- Action: Clicked "Select user Marcus Webb".
- Saw: "General Manager" / heading "Marcus Webb" / "Enter your 4-digit PIN", a PIN-entry dot row (screen-reader label "PIN entry: 0 of 4 digits entered"), and a numeric keypad 1-9/0 plus "Clear"; "Back" and "Use system keyboard" links below.
- Shot: img/manager/05-login-pin.png

## Step 06 — dashboard-capitol-hill
- URL: /dashboard
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Pressed "9" four times on the PIN keypad; it auto-submitted and landed on /dashboard (default location = MEP · Capitol Hill).
- Saw: Heading "Hi, Marcus Webb." with a full "Explore" nav list staff do not get — Mid-Shift Pulse, Reports Hub, Trends, Announcements, Ordering, Tip Pool, AI Insights, Rollups, Deep Cleaning, Feedback, LTO, Written Reports, Catering, Training, Recipes, Comms, Profile, Settings, My Performance, and Admin — plus a role chip "General Manager", a notifications bell "1 unread", and a location switcher with both "MEP · Capitol Hill" and "EM · P Street". Capitol Hill's Today's-operations card shows "Closing checklist — Not started" and every Reports row reads "Not started"/"No orders today"/"Start your first count".
- Shot: img/manager/06-dashboard-capitol-hill-full.png
- Confused: The dashboard's default location on login was Capitol Hill (MEP), not P Street — had to switch explicitly via the location-switcher nav.

## Step 07 — dashboard-p-street
- URL: /dashboard?loc=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Clicked "EM · P Street" in the location switcher.
- Saw: "Today's operations at P Street" showing "Closing checklist — In progress · 3 of 61 items" with a "Continue closing" link; Reports card shows "Opening Report — In progress", "AM Prep — Not yet started", "Mid-day Prep — No mid-day preps started today.", "Receiving — No deliveries logged yet today", "Ordering — No orders today", "Inventory Audit — 28 days since last count / 6 SKUs anchored", "Cash Deposit — Not started today", "PM Report — Not started today"; Trends tile "Checklist Completion 28%"; Team panel "1 on track · 5 need a check-in: Deshawn Carter, Rosa Delgado, Tommy Nguyen." listing Rosa Delgado (KH), Tommy Nguyen (SL), Maya Torres (EMP, "Steady"), Deshawn Carter (EMP), Marcus Webb (GM), Priya Shah (AGM).
- Shot: img/manager/07-dashboard-p-street-full.png

## Step 08 — opening-phase1-filled
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Clicked "Open / continue" on the Opening Report. Landed on "Phase 1 — Verification" with 10 station cards (Crunchy Boi Station, 3rd Party Station, Walk Ins Station, Prep Fridge, Prep Area, Back Line Open, Expo Station, Front of House Open, Manager Open, Walk-Out Verification) each with sub-checklist items and, on 8 of them, a "Temperature reading for <fridge> (≤41°F)" box; plus 5 prep-recount sections (Veg, Cooks, Sides, Sauces, Slicing, 36 items total) each item showing an "Opener recount" number box. Filled all 8 temps (34-40°F range: 36, 38, 35, 37, 39, 36, 38, 37) and all 36 opener-recount boxes with plausible counts.
- Saw: Station header text "Verify last night's closing matches reality. Tap each station once you've checked it; add a comment if anything looks off." Each item row bullet is "·" until verified. Header counter read "0 of 44 verified · 0 of 8 temp readings entered · 0 of 36 prep entries" before filling; each prep-recount section's "Verify section" button was disabled with note "Recount items without closer data first" until its items had counts.
- Shot: img/manager/08-opening-phase1-filled.png
- Confused: The dashboard/staff-walker note said 4 items were already verified with one comment, but this GM session showed 0 of 44 verified on load — no carried-over progress was visible.

## Step 09 — opening-ready-to-submit
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Clicked all 10 station "Mark [Station] as verified" toggles (each flips to "Untick [Station] / ✓ Verified"), then clicked "Verify section" on Veg, Cooks, Sides, Sauces, and Slicing (each flips to "Verified — [Section]"). This surfaced a callout "No prior closing data detected" — "36 item(s) had no closing count from last night — morning recounts were entered. Confirm the reason:" with two radio options "Location was closed (planned)" and "Closing was missed / I don't know". Selected "Closing was missed / I don't know" (true to the dashboard's "Closing checklist — In progress · 3 of 61 items").
- Saw: Footer counter updated to "44 of 44 verified · 8 of 8 temp readings entered · 0 of 36 prep entries" with status line "Submit ready" and an enabled "Submit Opening" button (previously disabled and read "44 items not yet verified").
- Shot: img/manager/09-opening-ready-to-submit.png
- Confused: The footer kept reading "0 of 36 prep entries" even after every recount box had a number in it and every section showed "Verified" — that counter tracks something else (likely Phase 2's separate opener-prepped entries, not the Phase 1 recounts).

## Step 10 — opening-phase2-prep-entry
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Clicked "Submit Opening". Instead of finishing, it advanced to "Phase 2 — Prep Entry": the same 5 prep sections re-rendered, each item now showing "Par: <amount+unit>", "Closer count: <n>", "Prep need: <n>", an "Opener prepped" number box, and a collapsible "Uses: ... tap to confirm usage" row per item's ingredients. Filled all 36 "Opener prepped" boxes with plausible amounts (0 where Prep need was already 0, otherwise close to the shown Prep need).
- Saw: Each item row read e.g. "Par: 7 1/3 Pan" / "Closer count: 8 · 1/3 Pan" / "Prep need: 0 · 1/3 Pan" (Iceberg). One item, Tomato, showed no "Par" line at all and "Prep need: verify section first" instead of a number even after its section showed Verified.
- Shot: img/manager/10-opening-phase2-prep-entry.png
- Confused: Tomato's "Prep need" never resolved to a number ("verify section first") even though the Veg section's "Verify section" toggle already read "Verified — Veg" — unclear whether Tomato is missing a par/recipe configuration or the message is stale.

## Step 11 — opening-phase2-save-failed-bug
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: After filling all 36 "Opener prepped" boxes, every row showed a red "Save failed" alert with a "Retry" button instead of saving. Clicked "Retry" on Iceberg, then on Onion Dip, as two more honest attempts (three total counting the original fill) — both retries produced the same failure.
- Saw: Per-row alert text "Save failed" next to a "Retry" button (e.g. "Retry saving Iceberg", "Retry saving Onion Dip"); the bottom bar still read "44 of 44 verified · 8 of 8 temp readings entered · 0 of 36 prep entries" / "36 prep items not yet saved" with a disabled button "Finalize Phase 2 (36 outstanding)".
- Shot: img/manager/11-opening-phase2-save-failed-bug.png
- Bug?: Every "Opener prepped" save call to the prep-entry endpoint returns a server error (repeated browser console entries: "Failed to load resource: the server responded with a status of 500 (Internal Server Error)" for the opening prep-item save route) — confirmed on the original fill and on two separate manual Retry clicks (Iceberg, Onion Dip). "Finalize Phase 2" can never enable because no row can save, so the Opening Report cannot be completed and the confirm ceremony (PIN/password step-up) is never reached.

## Step 12 — BLOCKED goal 2 (confirm ceremony)
- URL: /operations/opening?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- BLOCKED GOAL 2 (finish the confirm ceremony): Phase 2 — Prep Entry's per-item save call fails with a 500 on every attempt (3 honest tries: the initial batch save plus two individual Retry clicks), so "Finalize Phase 2 (36 outstanding)" never un-disables and the opening can't be submitted to reach the PIN/password confirm step. This blocks the whole flow regardless of role, so switching to Rosa Delgado (key holder) would not route around it — same shared endpoint.

## Step 13 — am-prep-sheet
- URL: /operations/am-prep?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Navigated to AM Prep from the dashboard's "Start AM Prep" link.
- Saw: Heading "AM Prep" / "EM · P Street" with the same 5 station sections as the opening walk (Veg, Cooks, Sides, Sauces, Slicing), each item showing "PAR" and an editable column (ON HAND / PORTIONED / LINE depending on section) plus BACK UP and an auto-computed TOTAL; every input carried a red "Required" alert while empty. Below that, a "Misc" section with four YES/NO toggle questions ("Meatball mix - ready?", "Meatballs - ready to cook?", "Meatballs - for reheat?", "Cook Bacon?") each "currently —, tap to change", plus a "Notes" box (placeholder "Add notes…"). Footer alert read "Fix 40 issues before submitting" with a disabled "Fix issues before submitting" button.
- Shot: img/manager/12-am-prep-sheet.png

## Step 14 — am-prep-filled-row
- URL: /operations/am-prep?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Filled ON HAND for 3 Veg items: Iceberg = 6, Onion = 7, Basil = 3.
- Saw: Each row's TOTAL auto-filled to match ON HAND (6, 7, 3) since BACK UP was left blank; the "Required" alerts cleared on those 3 rows only; the footer counter dropped from "Fix 40 issues before submitting" to "Fix 37 issues before submitting", and "Fix issues before submitting" stayed disabled (expected — the other 37 required fields across Cooks/Sides/Sauces/Slicing/Misc were still empty, matching the task's "3 items" scope rather than a full sheet).
- Shot: img/manager/13-am-prep-filled-row.png
- Confused: The submit button's label doubles as the validation message ("Fix issues before submitting") rather than reading "Submit AM Prep" — easy to mistake for a broken button rather than an incomplete-form guard.

## Step 15 — midday-prep-new
- URL: /operations/mid-day?instance=f878f8a4-87e7-4017-b267-851d103600fe
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Back on the dashboard, Mid-day Prep read "No mid-day preps started today." — clicked "+ New mid-day prep", which created a new instance and opened it.
- Saw: Heading "Mid-day Prep" / "Phase 1 — count to par" with two sections, Veg (Pickles, Sweet Peppers, Hot Peppers, Basil, Shredded Mozzarella, Fresh Mozzarella) and Sauces (Aioli, HC Aioli, HP Mayo, Mustard Aioli, Horsey Mayo, Salsa Verde, Dukes, Vin), each item showing "Par <n> <unit>" and an "On hand" spinbutton; a "Submit count → Phase 2" button at the bottom.
- Shot: img/manager/15-midday-prep-new.png

## Step 16 — midday-prep-filled
- URL: /operations/mid-day?instance=f878f8a4-87e7-4017-b267-851d103600fe
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Filled "On hand" for 2 items: Pickles = 14, Sweet Peppers = 9.
- Saw: Both spinbuttons held their new values; no per-field save indicator or error appeared (contrast with the Opening Report's Phase 2 grid, which showed an explicit "Not saved"/"Save failed" state per row).
- Shot: img/manager/16-midday-prep-filled.png

## Step 17 — receiving-vendor-pick
- URL: /operations/receiving?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Opened Receiving from the dashboard's "Log a delivery" link.
- Saw: Heading "Receiving" with step "1 Count the delivery": a "Vendor" dropdown (Amazon, Baldor, Boar's Head, Cardinal Bakery, Continental Tape, Costco, Country Snacks, Cristian, Penny Candy, PFG, Sarah, Saval, Sysco, Trimark, US Foods, Vistaprint, Webstaurant), "Delivery date" (defaulted 2026-09-08), "Invoice #" (placeholder "From the paperwork"), "Invoice total ($)", and note "Pick a vendor to load its usual order." Below, step "2 Receipt photo" ("Choose or take a photo" / "Take receipt photo" / "Photo later" checkbox) and step "3" with disabled "Delivery confirmed" and "Save partial — truck still unloading" buttons. "Recent deliveries" on the right showed two old PFG entries both tagged "Photo missing" and "Missing email".
- Shot: img/manager/17-receiving-vendor-pick.png
- Confused: No vendor in the list is labeled as a produce house (no "produce" name); picked "Baldor" as the closest real-world match for a produce vendor.

## Step 18 — receiving-vendor-selected
- URL: /operations/receiving?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Selected vendor "Baldor" from the dropdown.
- Saw: A "Prices from the invoice" button appeared, plus one line card already present titled "New item" / "Added — not on the usual order" with Qty, a "Flag a problem" row (Short/Over/Damaged/Sub), Price/pack, Oz/each, a line-note box, and photo buttons — with no product name or SKU tied to it. Below that, a separate "Pick a SKU…" dropdown (Cholula, Fresh Mozzarella, Ham, Onions, Salami, White Cheddar) with a disabled "+ Add item" button for adding more lines.
- Shot: img/manager/18-receiving-vendor-selected.png
- Confused: The auto-added "New item" card had no field to name or identify the product — just quantity/price/notes attached to a generic "New item" label. Unclear what this line represented since Baldor apparently has no "usual order" on file.

## Step 19 — receiving-line-entry
- URL: /operations/receiving?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Filled Invoice # = "BAL-88213", Invoice total = "145.50", and on the "New item" card: Qty = 12, Price/pack = 3.25, Line note = "case of assorted greens, no label match".
- Saw: The header badge changed to "1 priced"; fields held their values with no per-field save indicator.
- Shot: img/manager/19-receiving-line-entry.png

## Step 20 — receiving-short-flagged
- URL: /operations/receiving?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Used "Pick a SKU…" + "+ Add item" to add "Onions" (Qty 8, Price/pack $18.00) and clicked "Short" on its "Flag a problem" row (button went to a pressed/highlighted state, no popup at that moment); then added "Fresh Mozzarella" (Unit "case", Qty 4, Price/pack $22.00) as a fully-received line; checked "Photo later"; typed a note "Onions came in short - driver said next truck Thursday." in the delivery Notes box.
- Saw: Onions card showed "Onions" / "Added — not on the usual order" and paragraph "No pack chain — enter quantity in packs."; the Short button stayed visually pressed but nothing else changed on this screen. "Delivery confirmed" (step 3) became enabled once Photo later was checked.
- Shot: img/manager/20-receiving-short-flagged.png

## Step 21 — receiving-detail-short-item
- URL: /operations/receiving/1da9de68-de7d-42c8-832d-47871e9919c9
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Clicked "Delivery confirmed" (submitted immediately, no confirmation dialog — form reset to blank and a new "Baldor · 2026-09-08 · Photo missing · 2 item(s) · #BAL-88213 · Marcus Webb" row appeared in Recent Deliveries, plus a new "Open vendor credits 1 open" panel). Opened that Baldor delivery's detail page.
- Saw: Heading "Baldor" / "2026-09-08 · #BAL-88213 · by Marcus Webb" / "Invoice total: $145.50" / the delivery note text; a "Receipt photo still missing" callout; a "Vendor claim" section reading "Not compared" / "No vendor claim is linked to this delivery yet."; an "Items" list with only 2 lines — "Onions — Short — 8 packs — $18.00/pack" and "Fresh Mozzarella — 4 case — $22.00/pack · 288.0 oz"; a "Vendor credits" section listing "Short — — — Open" with a "Resolve" button.
- Shot: img/manager/21-receiving-detail-short-item.png
- Bug?: The delivery's Items list shows only 2 items (Onions, Fresh Mozzarella) — the first line I filled in, the auto-added "New item" card (qty 12, $3.25/pack, note "case of assorted greens, no label match"), is gone entirely. It had no SKU attached, and its data appears to have been silently dropped on submit rather than saved or flagged as an error.

## Step 22 — receiving-short-item-options
- URL: /operations/receiving/1da9de68-de7d-42c8-832d-47871e9919c9
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Clicked "Resolve" on the "Short" vendor-credit row.
- Saw: The row expanded to a "Note (optional)" textbox and four buttons: "Credit", "Refund", "Write off", "Cancel". This is the short-item resolution prompt (it appears on the delivery's detail page after confirming, not inline on the receiving form when the Short flag is first tapped).
- Shot: img/manager/22-receiving-short-item-options.png

## Step 23 — receiving-finished-receipt
- URL: /operations/receiving/1da9de68-de7d-42c8-832d-47871e9919c9
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Typed note "Baldor to credit next invoice for 4 missing cases of onions" and clicked "Credit".
- Saw: The "Short" vendor-credit row status changed from "Open" to "Credited", and the note text now displays under it permanently.
- Shot: img/manager/23-receiving-finished-receipt.png

## Step 24 — counts-new-audit
- URL: /operations/counts?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Opened Inventory Audit from the dashboard's "Inventory Audit" tile.
- Saw: Heading "Inventory Audit" / "Run when the owner calls for a full audit. Day to day, the system infers on-hand from deliveries, production, and sales." A "New audit" panel with instruction "Count each unit once: full containers, then loose units below. Never count the same stock twice." — a "Pick an item…" dropdown (full catalog, 150+ items), a Unit field, a "How many" spinbutton, a "Loose (below a full container)" checkbox revealing a "Partial" spinbutton, a "+ Add item" button, a "Note" box, and a disabled "Record audit" button. To the right, an "On hand" list anchored to "Tue, Aug 11" showing ~30 items all flagged "Inferred / advisory" or "Audited Tue, Aug 11 / advisory" with the same warning "A backdated delivery landed after this audit — verify before trusting on-hand."
- Shot: img/manager/24-counts-new-audit.png

## Step 25 — counts-filled
- URL: /operations/counts?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Added 3 lines: Iceberg (Unit "case", How many 6), Tomatoes (Unit "case", How many 3), Onions (Unit "bag" free-text, How many 2, checked "Loose (below a full container)", Partial 0.5). Noted the Unit field is a locked dropdown ("Pick a unit… / case") for items with a defined pack chain (Iceberg, Tomatoes, Fresh Mozzarella) but a free-text box for others (Onions) with no conversion behind it.
- Saw: Each added line collapses to a compact row with a "Remove" button; "Record audit" became enabled once the first line was added.
- Shot: img/manager/25-counts-filled.png

## Step 26 — counts-confirm-dialog
- URL: /operations/counts?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Clicked "Record audit". First attempt 403'd silently (no on-screen message); this triggered a step-up dialog on submit.
- Saw: Dialog heading "Confirm your password" / "Re-enter your password to confirm this action." with a "Password" field and "Confirm" / "Cancel" buttons. This is the count submit confirmation the walk goal asks for.
- Shot: img/manager/26-counts-confirm-dialog.png

## Step 27 — counts-unit-error
- URL: /operations/counts?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Typed password "sim-marcus-pw" and clicked "Confirm". Submission still failed.
- Saw: An on-screen error line appeared above "Record audit": "Can't convert that unit to ounces — set the item's pack chain or avg oz first." This pointed at the Onions line (free-text "bag" unit, no configured pack chain).
- Shot: img/manager/27-counts-unit-error.png
- Bug?: Submitting a count with any item whose unit has no configured pack-chain/avg-oz conversion (here, Onions in "bag") fails the whole audit with a generic error rather than only flagging that one line — the two good lines (Iceberg, Tomatoes) had to be resubmitted separately after removing Onions.

## Step 28 — counts-submitted
- URL: /operations/counts?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Removed the Onions line, added Fresh Mozzarella (Unit "case", How many 5) in its place alongside Iceberg and Tomatoes, and clicked "Record audit" again. This time it went through without a second password prompt (the earlier step-up apparently still counted) and without error.
- Saw: The form reset to blank; the "On hand anchor" line updated from "Tue, Aug 11" to "Tue, Sep 8"; Iceberg, Tomatoes, and Fresh Mozzarella now show "Audited Tue, Sep 8" with fresh on-hand totals ("Iceberg — counted: 3840.0 oz · since: 0.0 oz · 0d ago", "Tomatoes — counted: 480.0 oz · since: 0.0 oz · 0d ago", "Fresh Mozzarella — counted: 360.0 oz · since: 0.0 oz · 0d ago").
- Shot: img/manager/28-counts-submitted.png

## Step 29 — ordering-walk-list
- URL: /ordering?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Opened /ordering from the dashboard's Ordering tile.
- Saw: Heading "Ordering walk — Tue, Sep 8" with location tabs "Capitol Hill" / "P Street"; a "Today's orders" card reading "Nothing ordered yet today." and an "Order history 1" expander; a warning banner "2 par'd products have no ordering path today — nothing will be suggested for them." / "2 sit on a deactivated item. Move the par to the item you actually buy, or turn that one back on."; note "Par tuning hasn't run at this shop yet."; then a vendor accordion "PFG · 79 SKUs · ORDER DAY" (expanded) listing every SKU with a "− / Order to par (unit) / +" stepper plus "Empty · order N" and "We're full · 0" quick-set buttons; a sticky footer "0 SKUs marked" / "REVIEW ORDER".
- Shot: img/manager/29-ordering-walk-list.png

## Step 30 — ordering-adjusted-line
- URL: /ordering?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Clicked "+" twice on "1/2 pint top (flexi)" (Par 5) to set its order to 2, then clicked "Empty · order 3" on "Arugula" (Par 3, marks the full par).
- Saw: The "1/2 pint top (flexi)" stepper showed "2" and gained a "Clear" button; the vendor header badge changed to show a marked count; the sticky footer updated to "1 SKUs marked" then "2 SKUs marked" as each line was set.
- Shot: img/manager/30-ordering-adjusted-line.png

## Step 31 — ordering-review-order
- URL: /ordering?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Clicked "Review order".
- Saw: A "Review order" panel with a "Close" button, summary "1 vendor orders · 0 marked full", a "PFG" table (columns SKU / Item # / Qty) listing "1/2 pint top (flexi) — 870550 — 2 unit" and "Arugula — 242470 — 3 case", note "Delivery options (email, portal, phone) appear once you submit.", and two buttons "Keep walking" and "Record walk · 2 SKUs".
- Shot: img/manager/31-ordering-review-order.png

## Step 32 — ordering-draft-created
- URL: /ordering?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Clicked "Record walk · 2 SKUs".
- Saw: "Today's orders" now lists a card "PFG · EM-20260908-PFG · 2 lines · Draft"; "Order history" count went from "1" to "2".
- Shot: img/manager/32-ordering-draft-created.png

## Step 33 — production-form
- URL: /operations/production?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Opened Production from Ordering's page nav.
- Saw: Heading "Production" / "Log a conversion" with a "Raw item (SKU)" dropdown (every catalog item, each labeled with its "in stock" count — most read "0 in stock" except a handful like "Cucumber (2 in stock)", "Fresh Mozzarella (4 in stock)", "Onions (8 in stock)"), an "Amount used (packs)" spinbutton, an "Amount made" spinbutton, a "Notes" box, and a disabled "Log production" button. Below, "Recent production" read "No production logged yet."
- Shot: img/manager/33-production-form.png
- Confused: "In stock" counts here didn't match the Inventory Audit numbers just recorded (e.g. Iceberg showed "0 in stock" here right after being audited at 3840 oz) — this raw-item stock appears to track a different ledger (deliveries/production) than the audit's on-hand oz.

## Step 34 — production-filled
- URL: /operations/production?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Selected "Fresh Mozzarella (4 in stock)" as the raw item — this revealed a second dropdown, "Makes" ("Pick what you made… / Fresh Mozzarella"), which had to be set before "Log production" would enable. Filled Amount used (packs) = 2, Amount made = 10, Notes = "batch of fresh mozz portions for the deli case".
- Saw: "Log production" went from disabled to enabled only after the "Makes" dropdown was also set — selecting just the raw item and quantities was not enough.
- Shot: img/manager/34-production-filled.png
- Confused: The "Makes" field appears only after picking a raw item and isn't mentioned anywhere as a required step — easy to fill everything else and not notice why Submit stays disabled.

## Step 35 — production-logged
- URL: /operations/production?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Clicked "Log production".
- Saw: Form cleared; "Recent production" now lists "2 Fresh Mozzarella → 10 Fresh Mozzarella · Tue, Sep 8"; the Raw item dropdown's Fresh Mozzarella option updated to "Fresh Mozzarella (2 in stock)" (down from 4).
- Shot: img/manager/35-production-logged.png

## Step 36 — midshift-pulse
- URL: /mid-shift?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Opened Mid-Shift Pulse from the dashboard nav.
- Saw: Heading "Mid-Shift Pulse — Updated 3:17 AM"; a "Check — Needs attention" alert linking "1 maintenance note logged today"; "Today's operation" tiles ("Ordering — All orders in", "Receiving — 1 needs attention", "Inventory Audit — 0 · days since last count"); "Today's reports" list (Opening In progress, AM Prep After closing/In progress, Mid-day Prep Not due yet/In progress, Cash Deposit After closing/Not started, Closing In progress); "Fridge temps — All 8 fridges read · in range" showing every temp we entered in the opening walk (Walk-In 35°F, 3-Door 39°F, Sauce 37°F, Deli Display 38°F, Crunchy Boi 36°F, FOH Drinks 37°F, Back-Line Drinks 36°F, 3rd-Party 38°F) with a "View maintenance log" link; "Active today" (Maya Torres · Closing, Marcus Webb · Opening) with note "From report activity (scheduled roster arrives with 7shifts)."; "Sales — No Toast sales data yet."
- Shot: img/manager/36-midshift-pulse.png

## Step 37 — maintenance-note-filled
- URL: /maintenance?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Followed "View maintenance log" from the pulse (the offered action). On the Maintenance Log page (Fridge temps cards all "OK", Equipment cards "Oven — No issues logged" / "Fryer — No issues logged" — neither of these mentioned the staff walker's earlier "Slicer" note), used "Log a maintenance note": selected Equipment "Other…" (revealing an "Equipment name" box), typed "Slicer", and typed "Checked the slicer opener flagged - blade guard was loose, tightened it, cutting clean now." in "What's going on?".
- Saw: The Equipment dropdown listed Walk-In Fridge, 3-Door Fridge, Sauce Fridge, Deli Display Fridge, Crunchy Boi Fridge, FOH Drinks Fridge, Back-Line Drinks Fridge, 3rd-Party Fridge, Oven, Fryer, Other…
- Shot: img/manager/37-maintenance-note-filled.png
- Confused: Nowhere on this page could I find the staff walker's earlier "Slicer" maintenance note that the dashboard/pulse referenced as "1 maintenance note logged today" — the Equipment section only tracks Oven and Fryer as named pieces of equipment, so a prior "Other…"-logged Slicer note (if that's how it was filed) has no visible home to review it against.

## Step 38 — maintenance-note-saved
- URL: /maintenance?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Clicked "Save note".
- Saw: No error appeared, but the "What's going on?" textarea cleared back to placeholder while the "Equipment name" field still read "Slicer" and the Equipment dropdown stayed on "Other…" — there is no visible list of saved maintenance notes anywhere on the page to confirm the note actually recorded.
- Shot: img/manager/38-maintenance-note-saved.png
- Confused: No confirmation toast or note history — after Save, it's unclear from the screen alone whether the note persisted; only the partial form-field reset (note text cleared, equipment name and dropdown left as-is) hints that something happened.

## Step 39 — pmreport-form
- URL: /pm-report?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Opened PM Report from the dashboard's "Start PM Report" link.
- Saw: Heading "PM Report" / "Shift activity" listing "Marcus Webb — 80 items · 0 reports" and "Maya Torres — 3 items · 0 reports", plus today's report statuses (Opening/AM Prep/Closing "In progress", Mid-day Prep "Not due yet", Cash Deposit "Not started"). An "MVP" section (dropdown "No MVP / Marcus Webb / Maya Torres" + a "Why MVP?" box + "Save"). An "Attitude" section with one card per crew member, each with four 3-way graded rows (Arrived ready / Attitude / Production / Team player, each "Great / Good / Needs work"), an "Area to improve" box, a "Note (managers only)" box (caption "Only managers see this note"), and a per-employee "Save" button. A "Select employee…" dropdown (Deshawn Carter, Priya Shah, Rosa Delgado, Tommy Nguyen) to add more evals, and "Submit PM Report" at the bottom.
- Shot: img/manager/39-pmreport-form.png

## Step 40 — pmreport-evals
- URL: /pm-report?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Set MVP = "Maya Torres" with reason "Covered two open stations solo during the lunch rush without missing a beat." and saved. Graded Marcus Webb (Arrived ready: Good, Attitude: Great, Production: Great, Team player: Good; Area to improve: "Delegate more of the line checks to Priya during rush"; manager note: "Solid open, caught the closing gap early and got ahead of it.") and saved. Graded Maya Torres (Arrived ready: Great, Attitude: Good, Production: Great, Team player: Great; Area to improve: "Speak up sooner when the walk-in feels off"; manager note: "MVP for the day - carried closing almost single-handed.") and saved.
- Saw: Selected rating buttons highlight gold/filled against the unselected white ones; each per-employee Save is independent of the page-level Submit.
- Shot: img/manager/40-pmreport-evals.png

## Step 41 — pmreport-submitted
- URL: /pm-report?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Clicked "Submit PM Report".
- Saw: Page header gained "Submitted 3:21 AM by Marcus Webb"; every rating button, and both Area-to-improve/Note boxes, are now disabled/read-only showing the saved values; the MVP section and the "Select employee…" add-more control disappeared from the submitted view.
- Shot: img/manager/41-pmreport-submitted.png

## Step 42 — cash-form
- URL: /cash?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Opened Cash Deposit from the dashboard's "Start cash deposit" link.
- Saw: Heading "Cash Deposit" with a "Cash" panel (Projected (from Toast) box, "Enter total" / "Count by denomination" toggle, Drawer total box, note "$200 stays in the register", a live line "Deposit -$200.00 · $200.00 short", and an "Over/short note (optional)" box); a "Tips" panel (Cash tips box); an "On shift today" checklist (Deshawn Carter, Marcus Webb, Maya Torres, Priya Shah, Rosa Delgado, Tommy Nguyen, "+ Add"); and "Sign & submit deposit".
- Shot: img/manager/42-cash-form.png

## Step 43 — cash-filled
- URL: /cash?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Filled Projected (from Toast) = 845.00, Drawer total = 1045.00, Cash tips = 62.00, and checked Marcus Webb and Maya Torres on "On shift today".
- Saw: The live deposit line updated to "Deposit $845.00 · Even" (the $200 float automatically subtracted from the $1,045 drawer total to net against the $845 projected).
- Shot: img/manager/43-cash-filled.png

## Step 44 — cash-sign-pin
- URL: /cash?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Clicked "Sign & submit deposit".
- Saw: A PIN dialog appeared — "General Manager" / heading "Marcus Webb" / "Enter your 4-digit PIN" with the same dot-entry keypad as login ("PIN entry: 0 of 4 digits entered"), "Back" and "Use system keyboard" links. This is the cash deposit's confirm ceremony.
- Shot: img/manager/44-cash-sign-pin.png

## Step 45 — cash-deposited
- URL: /cash?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Pressed "9" four times on the PIN keypad; it auto-submitted.
- Saw: "Deposited $845.00 · signed by Marcus Webb at 3:22 AM" with a summary list — "Projected (from Toast) $845.00", "Drawer total $1,045.00", "$0.00 over $0.00", "Deposit $845.00 $845.00", "Cash tips $62.00" — and "On shift today: Marcus Webb, Maya Torres".
- Shot: img/manager/45-cash-deposited.png

## Step 46 — reports-hub
- URL: /reports?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Opened Reports Hub from the dashboard nav.
- Saw: Heading "Reports" with a "View trends" link; a filter bar (Search, From/To dates defaulting to the last 2 weeks through today, a "Type" dropdown — All types/Opening/Closing/AM Prep/Mid-Day Prep/Cash/PM Report/Maintenance — and "Apply"); "Signal filters" checkboxes (Under par, Over par, Skipped items, Temp out of range, Cash over, Cash short); and today's report list: "Cash — By: Marcus Webb — Status: Submitted", "PM Report — By: Marcus Webb — Status: Submitted", "AM Prep — Status: Open", "Closing — Status: Open", "Opening — Status: Verification done", "Mid-Day Prep — Status: Open", "Maintenance — Status: OK".
- Shot: img/manager/46-reports-hub.png

## Step 47 — reports-opening-detail
- URL: /reports/opening/c9f48cc2-dabf-4cad-88e0-98e0a3936ac3?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Opened today's Opening report from the hub.
- Saw: Header "Opening — Tue, Sep 8 — Verification done"; a note "Recount — no prior-day submission" / "No prior-day AM-Prep submission to verify against — the opener recounted to establish the counts. Reason: missed or unknown."; a summary "80/80 done · 0 skipped"; then every station's checklist read back with a ✓ and "Marcus Webb" as the actor, temps shown inline (e.g. "Crunchy Boi Fridge temp (≤41°F) ✓ · Marcus Webb · Temp 36°"), and every prep-recount item annotated "Recount — no prior submission" / "No prior-day baseline · par N" / "Recount: X" / "Ground truth: X · prep need Y" — this is where the Phase 1 recount data we entered actually surfaced, even though Phase 2 (Opener prepped) never saved.
- Shot: img/manager/47-reports-opening-detail.png

## Step 48 — reports-trends
- URL: /reports/trends?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Opened Trends from the Reports Hub link.
- Saw: Heading "Trends" with two entry cards "Ops Trends — Par · temps · cash · completion over time" and "Team — Operating health (managers)"; a "Relevant right now" callout "Team — 1 on track · 5 need a check-in: Deshawn Carter, Rosa Delgado, Tommy Nguyen."; an "Ops snapshot" (Under/Over Par 0, Fridge Temp Flags 0) and a "Team snapshot" (on track 1, needs attention 5).
- Shot: img/manager/48-reports-trends.png

## Step 49 — reports-trends-team
- URL: /reports/trends/team?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Opened Team trends.
- Saw: Heading "Team" / "Operating health — who's doing their part"; the same "1 on track · 5 need a check-in: Deshawn Carter, Rosa Delgado, Tommy Nguyen." line as the dashboard's Team panel, followed by per-person detail cards (full-page shot captures all of them).
- Shot: img/manager/49-reports-trends-team.png

## Step 50 — admin-home
- URL: /admin
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Opened Admin from the dashboard nav.
- Saw: Heading "Admin" / "Manage your business configuration."; a "Used this week" tally (Checklists confirmed 0, Counts recorded 1, Receiving logged 1, Prep submitted 0, Reports written 1, Photos uploaded 0, Production recorded 1, Catering quotes 0); a grid of admin sections — Vendors, "SKUs — 160 not ready", Products, "Recipes — 70 not ready", "Items — 46 not ready", Menu Costing, Weights & Trim, Catering, Checklist Templates — and a disabled-looking "Par Levels — Arrives in Phase 5" tile. There was no "Users" (or Team/Staff/Employees) tile anywhere on this page.
- Shot: img/manager/50-admin-home.png
- Confused: No visible entry point to user management from the admin home — had to guess the URL.

## Step 51 — BLOCKED admin/users
- URL: /admin/users
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- BLOCKED (add-one-user requirement): Navigating directly to /admin/users silently redirects to /dashboard every time (2 direct attempts, plus a search of the /admin home page for any alternate link, found none — 3 honest tries). No error banner, no console error — a clean server-side redirect. Every other /admin/* sub-page (checklist-templates, pars, vendors, skus, items, weights) loaded normally for this same Marcus Webb GM session, so this looks like a role-floor specific to user management rather than a broken /admin route generally. Could not add the requested fake employee "Jordan Blake" because this page never renders for a General Manager account.
- Bug?: /admin/users redirects a General Manager (level 7, "both shops") straight to /dashboard with no explanation — a GM sees every other admin tool but silently loses access here, with nothing on screen telling them why or who to ask.

## Step 52 — admin-checklist-templates-opening
- URL: /admin/checklist-templates/opening
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Opened Checklist Templates → Opening.
- Saw: Heading "Opening" / "Edit every checklist, count list, prep list, and report from one place. Changes apply going forward — past reports stay as submitted."; a "List check ✓ All clear" status button; a location tab strip; a "Standard Opening v1" tab panel listing "80 items" with a "+ Add item" button; a "This list requires…" control and a "Preview (what staff see)" button; and a collapsed footer "Prep lists (read-only) managed in the Prep Editor ✓ All clear".
- Shot: img/manager/53-admin-checklist-templates-opening.png

## Step 53 — admin-checklist-item-open
- URL: /admin/checklist-templates/opening
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Clicked "Details" on the first item, "Station appears clean as reported" (Crunchy Boi Station).
- Saw: An expanded editor with "Label" ("Station appears clean as reported"), "Description" (empty), "Who can do it?" (role dropdown, "Employee" selected, full ladder Prospect through Chief Growth Strategist), "When is this required?" ("Must complete — or explain" selected, alongside "Optional" / "Hard gate — can't submit until done"), a "Connections" section ("Auto-tick when this report is done" — No report connection/Opening report/AM Prep/Mid-day Prep/Cash deposit/PM report — plus a searchable list of other-list items each with a "Track" button), a "Disable" button, and a Spanish translation line "Spanish 1/1 — Label (ES): Estación limpia como se reportó".
- Shot: img/manager/54-admin-checklist-item-open.png

## Step 54 — admin-pars
- URL: /admin/pars
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Opened Par Levels directly (no working link from /admin home — the tile there just read "Arrives in Phase 5").
- Saw: Heading "Par Levels" / "Coming in Phase 5 (Foundation Admin Tools)" — a stub listing planned features: "Location selector", "Items grouped by category (matches vendor_item categories)", "All-days par + day-of-week overrides", "Inline edit, save per row (each save = step-up)".
- Shot: img/manager/55-admin-pars.png

## Step 55 — admin-vendors
- URL: /admin/vendors
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Opened Vendors from /admin.
- Saw: Heading "Vendors" / "Your supplier directory — contacts and how to order."; a "This week's ordering" region; an "Add vendor" button; and the full vendor list (Amazon, Baldor, Boar's Head, Cardinal Bakery, Continental Tape, Costco, Country Snacks, Cristian, Penny Candy, PFG, Sarah, Saval, Sysco, Trimark, US Foods, Vistaprint, Webstaurant) each showing status "Active", category tags, contact count, and an order/delivery-day schedule line (e.g. Baldor: "Order: Sun · Wed · Sat / Delivery: Tue · Fri"; most others "No schedule").
- Shot: img/manager/56-admin-vendors.png

## Step 56 — admin-vendor-baldor
- URL: /admin/vendors/f6539397-2b9f-4cc6-92f2-00747a7fd621
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Opened the Baldor vendor record.
- Saw: Baldor's detail page (contact info, categories, ordering schedule, and SKU/product ties).
- Shot: img/manager/57-admin-vendor-baldor.png

## Step 57 — admin-skus
- URL: /admin/skus
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Opened SKUs from /admin (home tile read "SKUs — 160 not ready").
- Saw: The SKU catalog admin screen.
- Shot: img/manager/58-admin-skus.png

## Step 58 — admin-items
- URL: /admin/items
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Opened Items from /admin (home tile read "Items — 46 not ready").
- Saw: The item (prep registry) admin screen.
- Shot: img/manager/59-admin-items.png

## Step 59 — admin-weights
- URL: /admin/weights
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Opened Weights & Trim from /admin.
- Saw: Heading "Weights & Trim" / "Every weight the system believes, where it came from, and what disagrees with it. Open it when you have a scale — nothing here is due."
- Shot: img/manager/60-admin-weights.png

## Step 60 — settings
- URL: /settings
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Opened Settings from the dashboard nav.
- Saw: Heading "Settings" / "Your app preferences."; a "Language" radio group (English selected, Español); a "Profile" section — "View your team and update your profile blurb." with a "Go to Profile" link; "More settings" — "Notification preferences are coming in a follow-up."
- Shot: img/manager/61-settings.png

## Step 61 — dashboard-before-logout
- URL: /dashboard
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Returned to the dashboard to log out.
- Saw: The same dashboard shell with the "Log out" button at the bottom of the page.
- Shot: img/manager/62-dashboard-before-logout.png

## Step 62 — logged-out
- URL: /
- Persona / viewport: (logged out) / 1280x800
- Action: Clicked "Log out".
- Saw: Landed back on the tile-login home screen — "Compliments Only" / "Operations", "Manager login →" link, and "Where are you?" with the two location tiles (Capitol Hill, P Street) — matching Step 01's starting screen.
- Shot: img/manager/63-logged-out.png
