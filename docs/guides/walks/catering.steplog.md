# Catering walk — step log (Marcus Webb, 2026-10-14)

## Step 01 — where-are-you
- URL: /
- Persona / viewport: (not logged in) / 1024x768
- Action: `start tablet walker`, looked at the first screen.
- Saw: "Manager login →" (top right); heading "Where are you?"; two tiles "MEP Capitol Hill" and "EM P Street".
- Shot: img/catering/01-where-are-you.png

## Step 02 — whats-your-role
- URL: /
- Persona / viewport: (not logged in) / 1024x768
- Action: tapped the P Street tile.
- Saw: heading "What's your role?", sub-line "EM · P STREET"; tiles GM General Manager, AGM Assistant General Manager, CTR Catering Manager, SL Shift Lead, KH Key Holder, TR Trainer, EMP Employee, TRN Trainee; "← Back".
- Shot: img/catering/02-whats-your-role.png

## Step 03 — who-are-you
- URL: /
- Persona / viewport: (not logged in) / 1024x768
- Action: tapped the General Manager tile.
- Saw: heading "Who are you?", sub-line "EM · P STREET · GENERAL MANAGER"; one tile "MW Marcus Webb"; "← Back".
- Shot: img/catering/03-who-are-you.png

## Step 04 — pin-keypad
- URL: /
- Persona / viewport: (not logged in) / 1024x768
- Action: tapped the Marcus Webb tile.
- Saw: badge "GENERAL MANAGER", "Marcus Webb", "Enter your 4-digit PIN", four empty dots, keypad 1-9, "Clear", 0, "← Back", "Use system keyboard".
- Shot: img/catering/04-pin-keypad.png

## Step 05 — dashboard
- URL: /dashboard?loc=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: tapped 9 four times; waited for the dashboard (login took roughly 20 s).
- Saw: round "M" user button sits in the page (top right, not floating over content); "DASHBOARD" "Hi, Marcus Webb."; badge "GENERAL MANAGER"; bell with 41 unread; shop switcher "MEP · CAPITOL HILL" and "EM · P STREET" (P STREET highlighted yellow = selected; "TODAY'S OPERATIONS EM · P Street" further down). **EXPLORE** chips: Mid-Shift Pulse, Reports Hub, Assignments, Trends, LTO, Written Reports, Catering, Maintenance, Production, Training, Recipes, Profile, Settings, My Performance, Admin. Then "My shift".
- Shot: img/catering/05-dashboard.png
- Confused: none. The dashboard opened on P Street (as expected; no switch needed).

## Step 06 — catering-hub
- URL: /catering?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Dashboard -> Explore -> Catering (tap reported a 5 s click timeout but the page opened; the sim was slow).
- Saw: "‹ DASHBOARD"; heading "Catering"; "Pipeline, quotes, and customers in one place."; six cards: "Catering Insights — Leads, booked catering and a calendar — by week, month, 30 days or all time."; "Catering Pipeline — Leads from inquiry to completed."; "Catering Quotes — Build, price, and send quotes."; "Catering Customers — Customer directory and history."; "Catering Companies — Company accounts + email attribution."; "Admin & setup — Packages, menu, capacity, zones & FAQ."
- Shot: img/catering/06-catering-hub.png
- Confused: "Admin & setup" names Packages, menu, capacity, zones & FAQ (no Pricing / Rate rules / ezCater) — matches the "names only what Marcus can open" change.

## Step 06b — pulse-catering
- URL: /mid-shift?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Dashboard -> Explore -> Mid-Shift Pulse (page header "Mid-shift Pulse", "EM · P Street", shop buttons "Capitol Hill" / "P Street"); scrolled down to the Catering section. Looked only; no handoff note written.
- Saw: card "Catering  as of 2:40 PM" with "See more"; "DUE TODAY" "No catering due today."; "Tomorrow: no catering booked"; "Prep: AM Not started · mid-day Not started"; "NOT RUNG INTO TOAST" "Every ezCater order is in Toast." (green). No money figures show in the Catering card. (Money does show elsewhere on the page, in the Sales card: "Sales so far —" "No completed Toast capture for today yet." — not part of this shot.) The Inventory card sits beside it (Order cutoffs: Boar's Head 3:00 PM, Cardinal Bakery 3:00 PM, PFG 4:00 PM, Trimark 6:00 PM, all "no draft yet").
- Shot: img/catering/06b-pulse-catering.png
- Confused: In this shot the Food safety fridge tiles show clipped one-letter names ("W", "3.", "S.", "D", "C", "F.", "B.", "3.") beside "Not checked today" — display truncation on the tablet, not part of the catering section.
- Note: after the hub I used `goto /dashboard` once (a walker shortcut, it timed out at 30 s but the page loaded) instead of tapping "Dashboard" back; no data effect.

## Step 07 — pipeline
- URL: /catering/pipeline
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Dashboard -> Explore -> Catering -> Catering Pipeline (page took ~25 s to load).
- Saw: "‹ CATERING"; heading "Catering Pipeline"; "Leads from inquiry to completed — track, follow up, and confirm."; search box placeholder "Search leads by name, company, or phone…" + "Search" button; "+ Add lead"; filters "Order lead" (All, Angel Reyes, Dana Brooks, Deshawn Carter, Luis Herrera, Marcus Webb, Maya Torres, Nicole Boyd, Priya Shah, Rosa Delgado, Tommy Nguyen) and "Source" (All, Online portal, Staff entered, Phone, Walk-in, Toast catering, EZCater, Direct invoice, Other). Columns in order: INQUIRY, QUOTE SENT, CONFIRMED, OUT FOR DELIVERY, COMPLETED, LOST — all "0" / "None" (clean board). At tablet width only the first four columns are in the picture; COMPLETED and LOST are off the right edge (the board scrolls sideways).
- Shot: img/catering/07-pipeline.png
- Confused: The guide text may say the shot shows all stage columns; at 1024 wide COMPLETED and LOST are not visible.

## Step 08 — add-lead-form
- URL: /catering/pipeline
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: tapped "+ Add lead"; typed Contact name "Jordan Sample", Company "Hill Staffers LLC", Event date 10/23/2026 (Friday of next week; the browser date box needs 2026-10-23 typed, it shows mm/dd/yyyy), Headcount "25", Notes "Sim walk: wants a mix of hot and cold subs. Call Thursday to confirm."; left Lead source on "Staff entered" and Order lead on "Unassigned". Location was already "P Street" without my touching it.
- Saw: form fields in order: "Contact name *", "Company", "Phone", "Email" (hint under it: "Links the lead to the customer with this email — or adds them as a new customer."), "Event date" (mm/dd/yyyy), "Headcount", "Lead source" (Online portal, Staff entered, Phone, Walk-in, Toast catering, EZCater, Direct invoice, Other), "Order lead (assigned to)" (Unassigned + the 10 staff names), "Follow-up date" (mm/dd/yyyy), "Location" (No location (global), Capitol Hill, P Street; starts on P Street), "Notes", buttons "Add" and "Cancel". The photo shows the form down to Notes; Add/Cancel are just below the picture.
- Shot: img/catering/08-add-lead-form.png
- Confused: none. Placeholders: no text field (Contact name, Company, Phone, Email, Headcount, Notes) shows placeholder text — all are blank when empty. The Notes box here has no placeholder.
- Bug?: none. (Location starting on P Street is the fixed behaviour.)

## Step 09 — lead-created
- URL: /catering/pipeline
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: tapped "Add".
- Saw: INQUIRY column "1" with a card: "Jordan Sample", "Hill Staffers LLC", chip "P Street", "Fri, Oct 23   25 ppl   Staff entered". Other columns "0" / "None".
- Shot: img/catering/09-lead-created.png

## Step 10 — lead-detail
- URL: /catering/pipeline
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: tapped the Jordan Sample card; scrolled down one screen so the Move to buttons are all in view. (First attempt showed no "No caps set" yet — that line appears a second or two after the card opens; I retook the shot after it had loaded.)
- Saw: card opened with "No caps set", "Notes   Sim walk: wants a mix of hot and cold subs. Call Thursday to confirm.", button "Edit details", "Move to" buttons "Quote sent", "Confirmed", "Out for delivery", "Completed", "Lost". No amber "Order comparison is currently unavailable." line. No "Move to other shop" button.
- Shot: img/catering/10-lead-detail.png
- Bug?: none now. (The "No caps set" line loads late; a quick shot can miss it.)

## Step 10b — lead-edit-details
- URL: /catering/pipeline
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: tapped "Edit details"; set Follow-up date to 10/22/2026 (Thursday of next week); scrolled so the whole form is in view; then tapped "Save".
- Saw: the edit form stacks inside the card in one column: "Contact name *" (Jordan Sample), "Company" (Hill Staffers LLC), "Phone" (empty), "Event date" (10/23/2026), "Headcount" (25), "Follow-up date" (10/22/2026), "Notes" (the lead note), buttons "Save" and "Cancel", then "Move to" below. There is no Email field in this form. No placeholder text on Phone or Notes. After Save the card stays open and now shows "Follow-up date   Thu, Oct 22" under the notes, above "Edit details".
- Shot: img/catering/10b-lead-edit-details.png

## Step 11 — lead-moved
- URL: /catering/pipeline
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: the card was still open after Save, so I tapped "Quote sent" under Move to.
- Saw: INQUIRY "0" / "None"; QUOTE SENT "1" with the card "Jordan Sample / Hill Staffers LLC / P Street / Fri, Oct 23   25 ppl   Staff entered"; CONFIRMED and OUT FOR DELIVERY "0" / "None". The card collapsed (no follow-up line shown on the closed card).
- Shot: img/catering/11-lead-moved.png

## Step 12 — quotes-list
- URL: /catering/quotes
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Back to Catering -> Catering Quotes.
- Saw: "‹ CATERING"; heading "Catering Quotes"; "Build a priced quote, send it, and track its status."; button "NEW QUOTE"; a card with "No quotes yet."
- Shot: img/catering/12-quotes-list.png

## Step 13 — quote-builder
- URL: /catering/quotes
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: tapped "NEW QUOTE"; under PIPELINE LEAD picked "Jordan Sample · Hill Staffers LLC · Fri, Oct 23 · P Street"; typed Client email "orders@hillstaffers.example".
- Saw: heading "New quote" with "Cancel"; fields LOCATION (Capitol Hill / P Street; shows "P Street"), EVENT DATE, HEADCOUNT, CLIENT EMAIL (input hint "name@company.com"; help text "The client's email is their identifier — used to send the quote and roll them up to their company account."), CLIENT NAME, COMPANY, PIPELINE LEAD (options "None" and the lead; the option reads contact · company · date · shop). Picking the lead filled Event date "10/23/2026", Headcount "25", Client name "Jordan Sample", Company "Hill Staffers LLC", and Location stayed "P Street". Client email did NOT fill (the lead has no email) — I typed it. Below the picture: LINE ITEMS (DESCRIPTION / QTY / UNIT PRICE / ×), "Add package" and "Add à la carte" drop-downs, "+ Add line", a "Delivery" checkbox, NOTES (empty box, no placeholder), "SAVE DRAFT".
- Shot: img/catering/13-quote-builder.png
- Confused: Before I added anything there WAS one empty first line (Description empty, Qty 1, Unit price empty, "Remove line" greyed out). Adding the package replaced that empty line.
- Note fields: Notes box (below Delivery): no placeholder. Description / Qty / Unit price boxes: no placeholder.

## Step 14 — quote-totals
- URL: /catering/quotes
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Add package -> first one "8 pc platter — $60.00". It came in as "8 pc platter" Qty 1 Unit price 60 plus a second line "Choose your subs (×4)" Qty 4, no unit price (the package carries its parts). I left Qty at 1 because an 8 pc platter is a flat price, not per head (the script says set Qty 25 only if per head; it was not). Add à la carte -> first item "Napkins & Utensils — $20.00": line "Napkins & Utensils" Qty 1, Unit price 20. Scrolled to the totals.
- Saw: Delivery checkbox (unticked), NOTES, "Subtotal $80.00", "Tax $8.00", "Total $88.00", "Deposit due $22.00", "SAVE DRAFT". The unit-price box of the "Choose your subs (×4)" line is empty. Package list in the drop-down: 8 pc platter $60, 16 pc platter $115, 32 pc platter $210, 48 pc platter $330, Light Lunch $12, Full Lunch $19.99, Three Footer $135, Six Footer $260.
- Shot: img/catering/14-quote-totals.png

## Step 15 — quote-saved
- URL: /catering/quotes
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: tapped "SAVE DRAFT" (page said "Loading…" for about 30 s before the saved quote appeared); scrolled down one screen so the buttons are in the picture.
- Saw: "← Back"; badge "DRAFT"; "$88.00"; "2026-10-23 · 25 covers"; "Client: Jordan Sample · Hill Staffers LLC · orders@hillstaffers.example"; "Lead: Jordan Sample · Hill Staffers LLC · Fri, Oct 23"; "Expires: Wed, Oct 28"; LINE ITEMS "8 pc platter × 1 $60.00", "Choose your subs (×4) × 4 $0.00", "Napkins & Utensils × 1 $20.00"; "Subtotal $80.00", "Tax $8.00", "Total $88.00", "Deposit due $22.00"; buttons "SEND QUOTE", "Revise", "Print labels" (not tapped). No Mark accepted / Mark declined on a draft. Totals split: subtotal + tax (10%) = total; deposit due is 25% of the total.
- Shot: img/catering/15-quote-saved.png
- Confused: the event date here prints as "2026-10-23" (ISO) while the lead and the Lead line print "Fri, Oct 23" — two date styles on one screen.

## Step 05x — ezcater-filter (no shot, goal 5)
- URL: /catering/pipeline
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: back on Catering Pipeline, set Source to "EZCater", waited, looked, then set Source back to "All".
- Saw: INQUIRY 0 / None, QUOTE SENT 0 / None, CONFIRMED 0 / None, OUT FOR DELIVERY 0 / None, COMPLETED 0 / None, LOST 0 / None. No "Not in Toast yet" panel (the only "Toast" text on the page is the Source option "Toast catering"). No ezCater lead shown. No shot taken, per script.

## Step 16 — catering-customers
- URL: /catering/customers
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Back to Catering -> Catering Customers.
- Saw: heading "Catering Customers"; "Customer directory grouped by company, with lead and order history."; "+ Add customer"; group "HILL STAFFERS LLC" with one card "Jordan Sample / orders@hillstaffers.example". (The customer was created from the quote's client email, since the lead had no email.) The email is shown in full to this GM on this page.
- Shot: img/catering/16-catering-customers.png

## Step 17 — customer-detail
- URL: /catering/customers
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: tapped the Jordan Sample card.
- Saw: card opens in place: "Jordan Sample", "orders@hillstaffers.example"; three columns "Pipeline — Jordan Sample · Quote sent · 2026-10-23", "Quotes — $88.00 · draft · Fri, Oct 23", "Orders — None yet."; buttons "Edit" and "Deactivate". Nothing edited.
- Shot: img/catering/17-customer-detail.png
- Bug?: On the FIRST open of this card (about 30 s of waiting) Pipeline said "None yet." and Quotes said "None yet.". I left the page (Back to Catering) and came back to Catering Customers -> Jordan Sample and then Pipeline and Quotes filled in as above. So the first load can show the lists as "None yet." even though the lead and the quote exist (stale or slow first load). The photo is of the second, correct load.

## Step 18 — catering-companies
- URL: /catering/companies
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Back to Catering -> Catering Companies.
- Saw: heading "Catering Companies"; "Company accounts — corporate domains auto-attribute contacts; an account can later be claimed via portal sign-up."; button "NEW COMPANY"; card "No company accounts yet."
- Shot: img/catering/18-catering-companies.png

## Step 18b — new-company-form
- URL: /catering/companies
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: tapped "NEW COMPANY". Typed nothing. Closed it with "Cancel" (nothing saved).
- Saw: "COMPANY NAME" (empty box, no placeholder); "CORPORATE DOMAIN (OPTIONAL)" (placeholder "acme.com"); help text "Emails from this domain auto-attribute to this company. Personal domains (gmail, etc.) can't be used — attach those contacts by hand."; buttons "CREATE" and "Cancel". The NEW COMPANY button is replaced by the form while it is open.
- Shot: img/catering/18b-new-company-form.png

## Step 19 — insights
- URL: /catering/insights
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Back to Catering -> Catering Insights.
- Saw: heading "Catering Insights"; "Leads, booked catering and feedback — by week, month, 30 days or all time."; "Download" "CSV" "PDF" (not tapped); range buttons "THIS WEEK", "THIS MONTH" (selected, dark), "LAST 30 DAYS", "ALL TIME"; tiles: "NEW LEADS 1", "BOOKED EVENTS 0", "CONFIRMED (UPCOMING) $0.00 · 0 events", "COMPLETED $0.00 · 0 events", "WIN RATE —  No settled leads yet", "LOST 0", "AVG. HEADCOUNT —", "OPEN PIPELINE $0.00". Line under the tiles: "Money counts by event date; leads count by the day they arrived." Then collapsed sections "Leads by source 1 source", "Events by stage 1 events", "Booked catering calendar 0 booked".
- Shot: img/catering/19-insights.png
- Confused: OPEN PIPELINE shows "$0.00" even though a draft quote for $88.00 exists and the lead sits in Quote sent (event date Oct 23, inside this month). So a draft quote is not counted in OPEN PIPELINE, and "Events by stage" says "1 events" while "BOOKED EVENTS" says 0. The money split on screen is only the two tiles CONFIRMED (UPCOMING) and COMPLETED, both $0.00 / 0 events.

## Step 20 — insights-full
- URL: /catering/insights
- Persona / viewport: Marcus Webb, General Manager / 1024x768 (full page)
- Action: `shot ... full` on the same page, This month range.
- Saw: everything above, plus "Booked catering calendar  0 booked" open: legend "Confirmed" (yellow dot), "Out for delivery" (black), "Completed" (green); month bar "‹ October 2026 ›"; switch "Show lost ✓"; "Dots mark booked events. Tap a day to see them."; the month grid MON–SUN with 14 highlighted; "WED, OCT 14  No booked catering this day."; "CUSTOMER FEEDBACK  No feedback yet." No dot on Fri 23 (the lead is only Quote sent).
- Shot: img/catering/20-insights-full.png
- Confused: in the full-page picture the page background shows a faint seam and a pale drawing at the right edge of the lower half (a page background effect of the full-page capture, not content).

## Step 21 — sales
- URL: /reports/sales?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09&range=last7&from=2026-10-08&to=2026-10-14&compare=false (hub range) -> page opened with from=2026-10-07 to=2026-10-13
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Back to Catering -> Back to Dashboard -> Reports Hub (hub shows "Reports", "Date range" "Last 7 days", family "Sales" with links "Sales", "Sales checks", "Catering sales", Download CSV/PDF) -> tapped "Sales".
- Saw: "‹ REPORTS", "DASHBOARD", shop buttons "Capitol Hill" / "P Street" (selected); heading "Sales"; tabs top right "Checks" and "Catering"; "Date range" select (Yesterday, Last 7 full days, Last 30 full days, Last 90 full days, This month, Last month, Last 12 months, Today, Custom) showing "Last 7 full days"; From 10/07/2026; To 10/13/2026; "Group by" Day / Week / Month; "Compare with previous period"; "Apply"; "Finished business days only (today only when you pick Today). Up to 92 days by day, 26 weeks by week, 12 months by month."; view buttons "Summary", "Items", "Modifiers", "Channels", "Hour × weekday", "Discounts", "Servers"; "Download CSV PDF"; "Wed, Oct 7 to Tue, Oct 13 · Toast business dates · ezCater event dates"; red badge "No capture · 0/7 days"; "No sales recorded for these days: not the same as $0."; tiles "Toast item-sales net (captured) —", "Toast gross item sales —", "Toast discounts and comps —", "Toast item voids —", "Toast non-gratuity service charges", "Toast item-sales refunds", "Sales (before refunds)", "Toast check totals (before refunds)" all —; also "ezCater reported subtotal — 0 ezCater orders", "Checks —", "Average check —", "Discounts — 0 applied", "Sales tax —", "Tips —", "Refunds captured so far —", then "Not counted as sales 0 checks" and "By day 7 rows" (collapsed). The old "Last 7 days" wording is gone here: the button reads "Last 7 full days". (The Reports Hub page itself still says "Last 7 days" in its own range list.)
- Shot: img/catering/21-sales.png
- Confused: the script says "Sales (tabs, views, date range and the sales tiles)"; the page shows only dashes (no capture in the sim) so the tiles read "—".

## Step 22 — catering-sales
- URL: /reports/sales/catering?range=last7&from=2026-10-07&to=2026-10-13&g=day&compare=false
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: tapped the "Catering" tab on the Sales page.
- Saw: "‹ SALES"; heading "Catering sales"; same range controls ("Last 7 full days"); "Wed, Oct 7 to Tue, Oct 13 · Toast business dates · ezCater event dates"; "Download CSV PDF"; card "ezCater orders — 0 ezCater orders · $0.00 — Subtotal by event date. ezCater is the source; a Toast ring linked to the order is not counted again." with chips "Matched in Toast: 0", "Not in Toast: 0", "Amount does not match: 0"; card "Catering rung in Toast — Sales (before refunds): $0.00 — Nothing in this range."; card "Catering pipeline value — Completed events (0): $0.00 / Confirmed, not yet done (0): $0.00 — Quote or estimate value by event date. Not register sales, never added to the totals above."; card "ezCater orders in this range — Nothing in this range."
- Shot: img/catering/22-catering-sales.png

## Step 09x — desktop login (no shot, goal 9)
- Action: `stop`, `start desktop walker`, logged in again P Street -> General Manager -> Marcus Webb -> 9999. The dashboard opened on loc d2cced11-b167-49fa-bab6-86ec9bf4ff09 (same id as the tablet P Street session). Desktop browser 1440x900.
- Confused: at the Admin page my first tap used a stale control number and opened Admin > Stations by mistake; I changed nothing there (no Save, no toggle) and went back with "Back to Admin".

## Step 23 — customers
- URL: /admin/customers
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: Dashboard -> Explore -> Admin -> Customers.
- Saw: "‹ ADMIN"; heading "Customers"; button "Catering accounts" (top right); "Who orders from your shop: visits, spend, favourite items and how often they come. Contact details are not shown here."; count chips "People: 0", "Regulars: 0", "Gone quiet: 0", "Both shops: 0", "Catering: 0", "Marketplace guests: 0 · 0 linked"; group chips "Regulars (5+ visits)", "Gone quiet (60+ days)", "One visit", "New (30 days)", "Both shops", "Catering customers"; filters "Search by name", "Sort by" (Most recent order, Most visits, Most spent, Highest average order, Most cards, Most catering orders, Newest customers, Quiet repeat customers), "Shop: Capitol Hill, P Street" (plain text, no drop-down), "Order channel" (All, In store, Online, App, Delivery, Catering), "Customer group", "Minimum visits", "Minimum spend ($)", "Include marketplace guests", "Apply filters", "Clear"; "Profiles (0)" "No customers match these filters."; "Likely same person (0)" collapsed. No contact fields are shown anywhere ("Contact details are not shown here.").
- Shot: img/catering/23-customers.png
- Confused: "Catering: 0" and "Catering customers" are empty although Jordan Sample (a catering customer with a quote) exists in Catering Customers; this directory is built from orders, so the sim shows none.

## Step 24 — catering-accounts
- URL: /admin/customers/catering
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: on Customers tapped "Catering accounts" (one tap; no goto needed).
- Saw: "‹ ADMIN"; "Back to customers"; heading "Catering accounts"; chips "Accounts: 0", "Repeat accounts: 0", "Gone quiet: 0", "12-month catering spend: $0.00"; "Sort by" (Most spent on catering, Most catering orders, Most recent catering order, Quiet repeat accounts); checkbox "Gone quiet only (over 90 days)"; "Apply filters"; "Accounts: 0" "No catering accounts match these filters." No contact details on the page.
- Shot: img/catering/24-catering-accounts.png

## Step 25 — catering-setup
- URL: /admin/catering
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: Dashboard -> Explore -> Catering -> Admin & setup.
- Saw: "‹ ADMIN"; heading "Catering"; sub-line "Packages, capacity, delivery zones, and menu FAQ."; nine tiles in this order: "Packages", "Catering Menu", "Capacity & Blackouts", "Delivery Zones", "FAQ", "Prep Demand", "LTO & discounts", "Fulfillment Zones", "Catering workspace". Not listed: Pricing, Rate rules, ezCater item review.
- Shot: img/catering/25-catering-setup.png
- Confused: the sub-line does not mention Catering Menu, Prep Demand, LTO or Fulfillment Zones, and "Catering workspace" is a ninth tile the script did not name.

## Step 26 — setup-packages
- URL: /admin/catering/packages
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: tapped "Packages" (look only; nothing changed).
- Saw: "‹ CATERING"; "Catering Packages"; "Build the catering packages customers can order, with pricing and what's included."; "ADD PACKAGE"; rows, each with Edit, Deactivate, Show details, e.g. "8 pc platter — P Street · Per platter · $60.00 · Min 4 people · 24h lead time · Serves 8 · 1 items", then the Capitol Hill copy, 16 pc platter $115.00, 32 pc platter $210.00, 48 pc platter $330.00, "Light Lunch — Per head · $12.00 · Min 1 people", "Full Lunch — Per head · $19.99", Three Footer, Six Footer (16 packages, both shops).
- Shot: img/catering/26-setup-packages.png

## Step 27 — setup-menu
- URL: /admin/catering/menu
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: tapped "Catering Menu" (look only).
- Saw: "Catering Menu"; "Flag items available for catering (à la carte) and, optionally, catering-only. Changes need a password step-up."; tabs "Menu" / "Toast"; help box "HOW THIS LIST WORKS — Toast items come from the store menu and are named in Toast. Catering items exist only here — tubs, cases, waters — and get their sizes and prices here. Rows appear to customers under the same headings you see below, in the same order." with button "Got it"; filters "All", "On menu", "Hidden", "Toast items", "Catering items"; search box placeholder "Search items…"; checkbox "Preview as customer"; "Packages — Packages are built on their own page. Customers see them first. 16 active  Open packages →"; groups "Drinks 21 on the menu of 21", "Sides 22 on the menu of 33", "Desserts 4 on the menu of 5" (open, with Berger Cookies - 2 pk, Berger Cookies- Large, Fruity Pebble Cannoli (single) "HIDDEN FROM CUSTOMERS") and per row "Feeds [ ] people", "ON CATERING MENU", "CATERING ONLY", "SOLD BY PORTION".
- Shot: img/catering/27-setup-menu.png

## Step 28 — setup-capacity
- URL: /admin/catering/capacity
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: tapped "Capacity & Blackouts" (look only).
- Saw: "Capacity & Blackouts"; "Per-location booking caps, lead time, and blackout dates."; for Capitol Hill and for P Street: badge "NOT CONFIGURED", "Max covers per day: No cap · Max events per day: No cap · Minimum lead time (hours): No cap", button "Configure", "Blackout dates" "No blackout dates.", "Date" (mm/dd/yyyy), "Reason (optional)" (empty box, no placeholder), "ADD BLACKOUT" (greyed out).
- Shot: img/catering/28-setup-capacity.png

## Step 29 — setup-zones
- URL: /admin/catering/zones
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: tapped "Delivery Zones" (look only).
- Saw: heading "Delivery zones" (lower-case z); "Per-location delivery zones: fee and minimum order."; "Capitol Hill (MEP)" "ADD ZONE" "No zones yet for this location."; "P Street (EM)" "ADD ZONE" "No zones yet for this location."
- Shot: img/catering/29-setup-zones.png
- Confused: the tile is "Delivery Zones" but the page heading is "Delivery zones".

## Step 30 — setup-fulfillment
- URL: /admin/catering/fulfillment
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: tapped "Fulfillment Zones" (look only; waited about 45 s so the map tiles were all drawn). Did not tap PLACE PIN or SAVE ZONE.
- Saw: heading "Fulfillment Zones"; "Set each store's delivery zone: drag the pin to center, adjust the radius, and toggle delivery / pickup availability."; "LOCATION" drop-down showing "P Street — not set" (options "Capitol Hill — not set", "P Street — not set"); dashed note "P Street has no delivery location set yet." with button "PLACE PIN"; a map of the Washington DC area with zoom + / − and "Leaflet | © OpenStreetMap contributors" and NO pin and NO radius circle; "DELIVERY RADIUS (MILES)" box showing 5; checkboxes "Offers delivery" (ticked) and "Offers pickup" (ticked); "SAVE ZONE" (greyed out).
- Shot: img/catering/30-setup-fulfillment.png
- Bug?: MISMATCH WITH THE GUIDE: the guide caption for this photo (catering-guide.md line 1156) reads "Fulfillment Zones with the map, the pin and the delivery radius", and guide step 3 says "Drag the pin to the shop and set Delivery radius (miles)". The screen shows no pin and no circle: it shows "P Street has no delivery location set yet." and a "PLACE PIN" button. Not changed in the guide, per instructions.

## Step 31 — setup-faq
- URL: /admin/catering/faq
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: tapped "FAQ" (look only).
- Saw: heading "Catering FAQ"; "Manage frequently asked questions shown to catering clients."; "ADD FAQ"; "No FAQs yet. Add one above."
- Shot: img/catering/31-setup-faq.png

## Step 32 — setup-prep-demand
- URL: /admin/catering/prep-demand
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: tapped "Prep Demand" (look only).
- Saw: heading "Catering Prep Demand"; "Upcoming prep required by confirmed catering leads, with over-par alerts for the next 14 days."; "LOCATION" drop-down "P Street" (Capitol Hill / P Street); "Wed, Oct 14 – Wed, Oct 28"; tabs "Prep" (selected), "Raw / SKU", "Surplus", "Sales"; dashed box "No upcoming catering prep demand for this location." The text "Sub — par comparison in W4b" is gone.
- Shot: img/catering/32-setup-prep-demand.png
- Confused: the Hill Staffers lead is in Quote sent (not Confirmed), so no demand shows, as expected.

## Step 33 — setup-lto
- URL: /admin/catering/lto
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: tapped "LTO & discounts" (look only).
- Saw: page heading "Surplus → LTO / discount"; "Turn surplus into a featured LTO or a discount."; "LOCATION" drop-down "P Street"; card "Surplus available to promote — No perishable surplus to act on."; card "LTOs & discounts — No LTOs or discounts yet."
- Shot: img/catering/33-setup-lto.png
- Confused: the tile is "LTO & discounts" but the page heading is "Surplus → LTO / discount".

## Step 34 — logged-out
- URL: /
- Persona / viewport: (logged out; was Marcus Webb, General Manager) / 1024x768
- Action: after the desktop pages, `stop`, `start tablet walker`, logged in again (P Street -> General Manager -> Marcus Webb -> 9999), scrolled to the bottom of the dashboard and tapped "LOG OUT" (no confirmation box appeared).
- Saw: the "Where are you?" screen: "Manager login →"; tiles "MEP Capitol Hill" and "EM P Street".
- Shot: img/catering/34-logged-out.png
- Note: this shot is the tablet-width one (like 01-04); it was taken last, per the script's exception (1).
- Note on fields: the only note / comment fields met on this walk were: Add lead "Notes" (no placeholder text), lead Edit details "Notes" (no placeholder), quote builder "NOTES" (no placeholder), capacity "Reason (optional)" (no placeholder), Catering Menu search "Search items…". No "Move to other shop" button showed for Marcus on the lead card.
