# Catering walk — step log (Marcus Webb, 2026-10-13)

## Step 01 — where-are-you
- URL: /
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Opened the app on the tablet (fresh start).
- Saw: Heading "Where are you?" with tiles "MEP / Capitol Hill" and "EM / P Street"; a top link "Manager login →" under the "OPERATIONS" label.
- Shot: img/catering/01-where-are-you.png

## Step 02 — whats-your-role
- URL: /
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Tapped the "P Street" tile.
- Saw: Heading "What's your role?", sub-label "EM · P STREET", role tiles "GM General Manager", "AGM Assistant General Manager", "CTR Catering Manager", "SL Shift Lead", "KH Key Holder", "TR Trainer", "EMP Employee", "TRN Trainee", and a "← Back" button.
- Shot: img/catering/02-whats-your-role.png

## Step 03 — who-are-you
- URL: /
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Tapped the "General Manager" tile.
- Saw: Heading "Who are you?", sub-label "EM · P STREET · GENERAL MANAGER", one tile "MW Marcus Webb", and a "← Back" button.
- Shot: img/catering/03-who-are-you.png

## Step 04 — pin-keypad
- URL: /
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Tapped the "Marcus Webb" tile.
- Saw: "GENERAL MANAGER / Marcus Webb", heading "Enter your 4-digit PIN", keypad 1-9, "Clear", 0, "←", plus buttons "Back" and "Use system keyboard".
- Shot: img/catering/04-pin-keypad.png

## Step 05 — dashboard
- URL: /dashboard
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Tapped "9" four times (PIN 9999); the dashboard opened on Capitol Hill, so I tapped the "EM · P STREET" chip in the header switcher.
- Saw: "Hi, Marcus Webb." EXPLORE chips: "Mid-Shift Pulse", "Reports Hub", "Assignments", "Trends", "LTO", "Written Reports", "Catering", "Maintenance", "Training", "Recipes", "Profile", "Settings", "My Performance", "Admin". Header shop switcher: "MEP · CAPITOL HILL" and "EM · P STREET". Below: "My shift" with "Take or assign tasks 0 of 8 assigned", "Take or assign stations", "Team today 1 of 7 assigned", and "TODAY'S OPERATIONS / EM · P Street / Tue, Oct 13 / CLOSING CHECKLIST / START CLOSING".
- Shot: img/catering/05-dashboard.png
- Confused: After login the dashboard first opened on "MEP · Capitol Hill" (Marcus belongs to both shops); the switcher is two chips, not a drop-down. After the switch the page re-rendered with "EM · P Street".

## Step 06 — catering-hub
- URL: /catering?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Tapped the "Catering" chip in EXPLORE.
- Saw: Back link "‹ DASHBOARD"; heading "Catering"; sub-line "Pipeline, quotes, and customers in one place." Six cards: "Catering Insights" ("Leads, booked catering and a calendar — by week, month, 30 days or all time."), "Catering Pipeline" ("Leads from inquiry to confirmed."), "Catering Quotes" ("Build, price, and send quotes."), "Catering Customers" ("Customer directory and history."), "Catering Companies" ("Company accounts + email attribution."), "Admin & setup" ("Packages, menu, pricing, zones & rate rules."). Each has an arrow "→".
- Shot: img/catering/06-catering-hub.png

## Step 07 — pipeline
- URL: /catering/pipeline
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: From the hub, tapped the "Catering Pipeline" card (page took a few seconds to load; looked twice before photographing).
- Saw: Back link "‹ CATERING"; heading "Catering Pipeline"; "Leads from inquiry to completed — track, follow up, and confirm." A search box (placeholder "Search leads by name, company, or phone…") with a "Search" button; "+ Add lead" button; two filters: "Order lead" (All, Angel Reyes, Dana Brooks, Deshawn Carter, Luis Herrera, Marcus Webb, Maya Torres, Nicole Boyd, Priya Shah, Rosa Delgado, Tommy Nguyen) and "Source" (All, Online portal, Staff entered, Phone, Walk-in, Toast catering, EZCater, Direct invoice, Other). Stage columns in order: "INQUIRY", "QUOTE SENT", "CONFIRMED", "OUT FOR DELIVERY", "COMPLETED", "LOST" (the last two are off to the right of a 1024 wide screen in the photo). Every column shows "0" and "None" — the P Street board is EMPTY.
- Shot: img/catering/07-pipeline.png
- Confused: The board has no leads at all at P Street, so there is no example card to show; no "Not in Toast yet" panel and no ezCater lead are visible here. The photo shows only four of the six columns.

## Step 08 — add-lead-form
- URL: /catering/pipeline
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Tapped "+ Add lead"; typed Jordan Sample (Contact name), Hill Staffers LLC (Company), 2026-10-23 into Event date (shows as 10/23/2026; the date box format is mm/dd/yyyy), 25 (Headcount); picked "P Street" in Location. Left Lead source on its default "Staff entered", Order lead on "Unassigned", Follow-up date and Notes empty.
- Saw: Form fields in order: "Contact name *" (required, no placeholder), "Company" (no placeholder), "Event date" (date box, mm/dd/yyyy), "Headcount" (number box with up/down arrows, no placeholder), "Lead source" (Online portal, Staff entered, Phone, Walk-in, Toast catering, EZCater, Direct invoice, Other; default "Staff entered"), "Order lead (assigned to)" (Unassigned, then the team names; default "Unassigned"), "Follow-up date" (date box, mm/dd/yyyy), "Location" (No location (global), Capitol Hill, P Street; default "No location (global)"), "Notes" (big text box, no placeholder). Buttons "Add" and "Cancel".
- Shot: img/catering/08-add-lead-form.png
- Confused: The form has NO phone box and NO email box, so the fake phone 202-555-0147 and email orders@hillstaffers.example could not be entered (script said to type them). Location defaults to "No location (global)" and must be changed to P Street by hand. Event date: "Friday of next week" = Fri 2026-10-23 (today is Tue 2026-10-13). The "Notes" box on this form was left empty; the lead note is added later on the lead itself. Placeholders: the text fields show none (the search box above says "Search leads by name, company, or phone…").

## Step 09 — lead-created
- URL: /catering/pipeline
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Tapped "Add".
- Saw: The form closed with no toast. "INQUIRY 1" now holds a card: "Jordan Sample / Hill Staffers LLC / P Street / Fri, Oct 23 / 25 ppl / Staff entered". Other columns still "0 None".
- Shot: img/catering/09-lead-created.png

## Step 10 — lead-detail
- URL: /catering/pipeline
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Tapped the "Jordan Sample / Hill Staffers LLC" card in the INQUIRY column. (The card opens in place; there is no separate lead page. Tapping the card again closes it.)
- Saw: The card grew to show: "Jordan Sample", "Hill Staffers LLC", chip "P Street", "Fri, Oct 23", "25 ppl", "Staff entered", a divider, "No caps set", an amber line "Order comparison is currently unavailable.", then "Move to" with buttons "Quote sent", "Confirmed", "Out for delivery", "Completed", "Lost".
- Shot: img/catering/10-lead-detail.png
- Confused: There is no notes box, no phone/email line and no history on the opened card, only the Move to buttons. "No caps set" is not explained.
- Bug?: The amber line "Order comparison is currently unavailable." stays on screen after waiting and after closing and reopening the card (3 tries, several seconds each). It reads like a warning and it IS in the photo; CC to decide whether to keep or retake the shot.

## Step 11 — lead-moved
- URL: /catering/pipeline
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: With the card open, tapped "Quote sent" under "Move to". No confirm box appeared.
- Saw: INQUIRY now "0 / None"; "QUOTE SENT 1" holds the card "Jordan Sample / Hill Staffers LLC / P Street / Fri, Oct 23 / 25 ppl / Staff entered". The card closed itself after the move.
- Shot: img/catering/11-lead-moved.png

## BLOCKED — goal 3 lead note (shot 12-lead-note)
- BLOCKED goal 3 lead note: the opened lead card in the Pipeline (reached through "Quote sent" column) has no notes box and no "add note" button. Its only contents are the details line, "No caps set", the amber "Order comparison is currently unavailable.", and the "Move to" buttons ("Inquiry", "Confirmed", "Out for delivery", "Completed", "Lost"). Tried: opened the card in INQUIRY, opened it again in QUOTE SENT, scrolled down, closed and reopened. The only Notes box in the Pipeline is the "Notes" field on the "+ Add lead" form, which I left empty when I created the lead. The note text "Sim walk: wants a mix of hot and cold subs. Call Thursday to confirm." was NOT typed anywhere.

## Step 12 — quotes-list
- URL: /catering/quotes
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Tapped "Back to Catering", then the "Catering Quotes" card (the page took several seconds to open).
- Saw: Back link "‹ CATERING"; heading "Catering Quotes"; "Build a priced quote, send it, and track its status."; a "NEW QUOTE" button; and the empty message "No quotes yet."
- Shot: img/catering/12-quotes-list.png
- Confused: The list is empty at P Street, so no status labels show here. No lead link to the quote exists on the pipeline card.

## Step 13 — quote-builder
- URL: /catering/quotes
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Tapped "NEW QUOTE". Set LOCATION to "P Street" (it defaults to "Capitol Hill"), EVENT DATE 10/23/2026, HEADCOUNT 25, CLIENT EMAIL orders@hillstaffers.example, CLIENT NAME Jordan Sample, COMPANY Hill Staffers LLC, PIPELINE LEAD "Jordan Sample · Hill Staffers LLC". Then picked "Light Lunch — $12.00" in "Add package", changed its QTY to 25, and picked "Napkins & Utensils — $20.00" in "Add à la carte" (QTY 1). Removed one blank line that was there at the start with the "x" (Remove line).
- Saw: "New quote" with a "Cancel" link. Labels: "LOCATION" (Capitol Hill / P Street), "EVENT DATE", "HEADCOUNT", "CLIENT EMAIL" (placeholder "name@company.com"; help text "The client's email is their identifier — used to send the quote and roll them up to their company account."), "CLIENT NAME", "COMPANY", "PIPELINE LEAD" (None / Jordan Sample · Hill Staffers LLC). "LINE ITEMS" with columns "DESCRIPTION", "QTY", "UNIT PRICE" and an "×" per line. Selecting "Light Lunch — $12.00" added TWO lines: "Light Lunch" (qty 1, unit price 12; I changed qty to 25) and "Choose your sub" (qty 1, unit price blank). Below the lines: "Add package" drop-down (8 pc platter — $60.00, 16 pc platter — $115.00, 32 pc platter — $210.00, 48 pc platter — $330.00, Light Lunch — $12.00, Full Lunch — $19.99, Three Footer — $135.00, Six Footer — $260.00), "Add à la carte" drop-down (long menu list of items with prices, from "Napkins & Utensils — $20.00" to "Whisked Chocolate Chip Cookie — $2.25"), "+ Add line". Then "Delivery" checkbox, "NOTES" box (no placeholder), totals card, "SAVE DRAFT" button. The photo shows the top of the form and the first line.
- Shot: img/catering/13-quote-builder.png
- Confused: Choosing the pipeline lead did NOT fill in name, company or email; they had to be typed. The quote form has no phone box. Package qty does not follow headcount (it started at 1). The "Choose your sub" line has an empty unit price. The lead choice list shows only Jordan Sample · Hill Staffers LLC.

## Step 14 — quote-totals
- URL: /catering/quotes
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Scrolled down to the bottom of the new-quote form.
- Saw: Lines "Light Lunch 25 x 12", "Choose your sub 1 (blank price)", "Napkins & Utensils 1 x 20"; "Add package", "Add à la carte", "+ Add line"; "Delivery" checkbox (unchecked); "NOTES" box (no placeholder); totals card: "Subtotal $320.00", "Tax $32.00", "Total $352.00", "Deposit due $88.00"; black button "SAVE DRAFT". There is no "Send quote" button on the form.
- Shot: img/catering/14-quote-totals.png
- Confused: Tax is 10% of the subtotal and the deposit is 25% of the total (88 / 352), but the screen does not say either rate.

## Step 15 — quote-saved
- URL: /catering/quotes
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Tapped "SAVE DRAFT" (did not touch "SEND QUOTE").
- Saw: The quote opened as a detail view: "← Back", a "DRAFT" badge, "$352.00", "2026-10-23 · 25 covers", "Expires: Tue, Oct 27", "LINE ITEMS": "Light Lunch × 25 $300.00", "Choose your sub × 1 $0.00", "Napkins & Utensils × 1 $20.00"; totals "Subtotal $320.00", "Tax $32.00", "Total $352.00", "Deposit due $88.00". Buttons on the draft: "SEND QUOTE", "Revise", "Print labels" (a link). Money split: subtotal, then tax, then total, then deposit due (no delivery fee line, since Delivery was unchecked).
- Shot: img/catering/15-quote-saved.png
- Confused: The only quote status seen is "DRAFT". "Mark accepted" and "Mark declined" do not appear on a draft, so they could not be read; no other statuses were visible. The quote detail does not show the client name, company or email. No toast appeared after saving.

## ABSENT — goal 5 ezCater lead (shot 17-ezcater-order)
- ABSENT: ezCater lead. Back on "Catering Pipeline" at P Street the board holds only the one lead I made (Jordan Sample, Hill Staffers LLC, now in QUOTE SENT). No card says "EZCater" and no lead has an "ezCater order" box. The Source filter does list "EZCater" and "Toast catering", but no ezCater card exists, so nothing was created or photographed.

## ABSENT — goal 5 Not in Toast yet panel (shot 18-not-in-toast)
- ABSENT: "Not in Toast yet" panel. The text "Not in Toast yet" does not appear anywhere on the Catering Pipeline page (read with look, twice, after the page finished loading).

## Step 16 — catering-customers
- URL: /catering/customers
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Back to the Catering hub, tapped "Catering Customers".
- Saw: "‹ CATERING", heading "Catering Customers", "Customer directory grouped by company, with lead and order history.", a "+ Add customer" button, and one company group "HILL STAFFERS LLC" with the row "Jordan Sample / orders@hillstaffers.example" (the customer made from my quote).
- Shot: img/catering/16-catering-customers.png
- Confused: Here the manager sees the full email address in the row.

## Step 17 — customer-detail
- URL: /catering/customers
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Tapped the "Jordan Sample orders@hillstaffers.example" row (it opens in place).
- Saw: Under the row: "Pipeline" with "None yet."; "Orders" with "None yet."; buttons "Edit" and "Deactivate" (not tapped).
- Shot: img/catering/17-customer-detail.png
- Confused: "Pipeline: None yet." even though the Hill Staffers LLC lead is in the Pipeline (QUOTE SENT) — the lead was added without an email, so it is not tied to this customer. The saved quote is not listed either.
- Bug?: Possible link gap — the customer made from my quote shows no pipeline lead or quote history.

## Step 18 — catering-companies
- URL: /catering/companies
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Back to the Catering hub, tapped "Catering Companies".
- Saw: "‹ CATERING", heading "Catering Companies", "Company accounts — corporate domains auto-attribute contacts; an account can later be claimed via portal sign-up.", a "NEW COMPANY" button, and the empty message "No company accounts yet."
- Shot: img/catering/18-catering-companies.png
- Confused: Hill Staffers LLC is not listed as a company account (it only exists as a customer group); the example domain is not a corporate domain.

## BLOCKED — goal 6 company detail (shot 22-company-detail)
- BLOCKED goal 6 company detail: "Catering Companies" shows "No company accounts yet.", so there is no company to open. The only way forward would be "NEW COMPANY", which creates data and the script says look only, so I did not tap it.

## Step 19 — insights
- URL: /catering/insights
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Back to the Catering hub, tapped "Catering Insights". Changed nothing (did not tap CSV or PDF).
- Saw: "‹ CATERING", heading "Catering Insights", "Leads, booked catering and feedback — by week, month, 30 days or all time." "Download" with "CSV" and "PDF" buttons. Range buttons "THIS WEEK", "THIS MONTH" (selected on arrival), "LAST 30 DAYS", "ALL TIME". Eight tiles: "NEW LEADS 1", "BOOKED EVENTS 0", "CONFIRMED (UPCOMING) $0.00 / 0 events", "COMPLETED $0.00 / 0 events", "WIN RATE — / No settled leads yet", "LOST 0", "AVG. HEADCOUNT —", "OPEN PIPELINE $0.00". Note: "Money counts by event date; leads count by the day they arrived."
- Shot: img/catering/19-insights.png
- Confused: The hub card said "…and a calendar — by week, month…" but the page sub-title says "…booked catering and feedback — by week, month…". "OPEN PIPELINE $0.00" although my lead (in QUOTE SENT) has a $352.00 quote on it.

## Step 20 — insights-full
- URL: /catering/insights
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Took a full-page shot of the same screen.
- Saw: Below the tiles: collapsed rows "Leads by source — 1 sources ▸", "Events by stage — 1 events ▸", and an open "Booked catering calendar — 0 booked ▾" with legend "Confirmed", "Out for delivery", "Completed", month "October 2026" with previous/next buttons, a "Show lost ✓" switch, "Dots mark booked events. Tap a day to see them.", a Mon-Sun grid, "TUE, OCT 13 — No booked catering this day.", and last "CUSTOMER FEEDBACK — No feedback yet." Money split: the tiles separate "CONFIRMED (UPCOMING)", "COMPLETED" and "OPEN PIPELINE" dollar amounts, all $0.00 here.
- Shot: img/catering/20-insights-full.png
- Confused: "1 sources" and "1 events" are not pluralised correctly on the screen. I did not open the two collapsed rows.

## Step 21 — sales
- URL: /reports/sales?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09&range=last7&from=2026-10-07&to=2026-10-13&compare=false
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Dashboard, tapped "Reports Hub" (it opened on Capitol Hill, so I tapped the "P Street" link), then tapped "Sales" under the Sales family.
- Saw: Reports hub: shop links "Capitol Hill" and "P Street"; "Date range" (Today, Yesterday, Last 7 days, Last 30 days, This month, Last month, Custom), "Compare with previous period", "Apply"; family "Sales" lists "Sales", "Sales checks", "Catering sales" and "Download" (CSV, PDF); other families "Operations", "People", "Inventory" (Counts and variance, Receiving, Ordering, Catering, Menu costing). On the Sales page: "‹ REPORTS", "DASHBOARD", shop links "Capitol Hill" and "P Street", tabs "Sales", "Checks", "Catering"; "Date range" (Yesterday, Last 7 days, Last 30 days, Last 90 days, This month, Last month, Last 12 months, Today, Custom), "Group by" (Day, Week, Month), "Compare with previous period", "Apply"; sub-tabs "Summary", "Items", "Modifiers", "Channels", "Hour × weekday", "Discounts", "Servers"; "Download CSV / PDF"; "Tue, Oct 6 to Mon, Oct 12 · Toast business dates · ezCater event dates"; "No capture · 0/7 days"; "No sales recorded for these days: not the same as $0." Tiles all "—": "Toast item-sales net (captured)", "Toast gross item sales", "Toast discounts and comps", "Toast item voids", "Toast non-gratuity service charges", "Toast item-sales refunds", "Sales (before refunds)", "Toast check totals (before refunds)", "ezCater reported subtotal / 0 ezCater orders", "Checks", "Average check", "Discounts / 0 applied", "Sales tax", "Tips", "Refunds captured so far". Collapsed rows "Not counted as sales — 0 checks" and "By day — 7 rows".
- Shot: img/catering/21-sales.png
- Confused: No Toast sales are captured in the sim for P Street (all "—"), so the photo shows empty tiles. The Sales family on the Reports Hub shows "Sales" twice (family heading and link). The page defaults to the dates Oct 6 to Oct 12 (the finished days), while the hub says Oct 7 to Oct 13.

## Step 22 — catering-sales
- URL: /reports/sales/catering?range=last7&from=2026-10-06&to=2026-10-12&g=day&compare=false&location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: On the Sales page, tapped the "Catering" tab (called "Catering sales" on the Reports Hub).
- Saw: "‹ SALES", "DASHBOARD", shop links "Capitol Hill" / "P Street", heading "Catering sales", the same date and "Group by" controls, "Tue, Oct 6 to Mon, Oct 12 · Toast business dates · ezCater event dates", "Download CSV / PDF"; "ezCater orders — 0 ezCater orders · $0.00" with "Subtotal by event date. ezCater is the source; a Toast ring linked to the order is not counted again."; "Matched in Toast: 0", "Not in Toast: 0", "Amount does not match: 0"; "Catering rung in Toast — Sales (before refunds): $0.00" and "Nothing in this range."
- Shot: img/catering/22-catering-sales.png
- Confused: Everything is zero, so the panel shows no example rows. Sub-pages listed for the Sales family: "Sales", "Sales checks" (tab label "Checks"), "Catering sales" (tab label "Catering").

- Also saw (step 22, lower on the same page): "Catering pipeline value — Completed events (0): $0.00 / Confirmed, not yet done (0): $0.00" with "Quote or estimate value by event date. Not register sales, never added to the totals above." and "ezCater orders in this range — Nothing in this range."

## Step 23 — customers
- URL: /admin/customers
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: Stopped the tablet browser, started the desktop one, logged in again (P Street, General Manager, Marcus Webb, 9999; the dashboard opened on Capitol Hill so I tapped "EM · P STREET"). Then Dashboard, "Admin", "Customers". (Admin hub tiles seen: "Stations", "Toast employees", "Customers", "Vendors", "SKUs 212 not ready", "Products", "Recipes 115 not ready", "Items 38 not ready", "Menu Costing", "Weights & Trim", "Catering", "Checklist Templates", "Report recipients", "Par Levels / Arrives in Phase 5"; and a "USED THIS WEEK" row where "Catering quotes" reads 1.)
- Saw: "‹ ADMIN", heading "Customers", a "Catering accounts" link, "Who orders from your shop: visits, spend, favourite items and how often they come. Contact details are not shown here." Counts: "People: 0", "Regulars: 0", "Gone quiet: 0", "Both shops: 0", "Catering: 0", "Marketplace guests: 0 · 0 linked". Group chips "Regulars (5+ visits)", "Gone quiet (60+ days)", "One visit", "New (30 days)", "Both shops", "Catering customers". Filters: "Search by name", "Sort by" (Most recent order, Most visits, Most spent, Highest average order, Most cards, Most catering orders, Newest customers, Quiet repeat customers), "Shop — Capitol Hill, P Street", "Order channel" (All, In store, Online, App, Delivery, Catering), "Customer group", "Minimum visits", "Minimum spend ($)", "Include marketplace guests", "Apply filters", "Clear". "Profiles (0)" — "No customers match these filters." "Likely same person (0) ▸".
- Shot: img/catering/23-customers.png
- Confused: The profile list is empty in the sim. Contact fields: the page itself says "Contact details are not shown here." (no reveal or download buttons on this page). The "Shop" line reads "Capitol Hill, P Street" for a GM.

## Step 24 — catering-accounts
- URL: /admin/customers/catering
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: On Customers, tapped the "Catering accounts" link (found on the first try; no goto needed).
- Saw: "‹ ADMIN", "Back to customers", heading "Catering accounts", counts "Accounts: 0", "Repeat accounts: 0", "Gone quiet: 0", "12-month catering spend: $0.00"; "Sort by" (Most spent on catering, Most catering orders, Most recent catering order, Quiet repeat accounts); checkbox "Gone quiet only (over 90 days)"; "Apply filters"; "Accounts: 0" and "No catering accounts match these filters."
- Shot: img/catering/24-catering-accounts.png
- Confused: Empty in the sim, so there is no row to show which contact fields are hidden; the Customers page states "Contact details are not shown here." and there are no reveal/download buttons on either page.

## Step 25 — catering-setup
- URL: /admin/catering
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: Tapped "Back to Admin" then the "Catering" tile on the Admin hub (reached the same Admin → Catering page the script names; I did not go through the Catering hub's "Admin & setup" card at desktop width).
- Saw: "‹ ADMIN", heading "Catering", "Packages, pricing, capacity, delivery zones, and menu FAQ." Tiles: "Packages", "Catering Menu", "Capacity & Blackouts", "Delivery Zones", "FAQ", "Prep Demand", "LTO & discounts", "Fulfillment Zones", "Catering workspace".
- Shot: img/catering/25-catering-setup.png
- Confused: No tile named "Pricing", "Rate rules" or "ezCater item review" is listed for a GM (although the sub-line and the hub card say "pricing" and "rate rules"). The script names are not the tile names: Menu = "Catering Menu", Capacity = "Capacity & Blackouts", Zones = "Delivery Zones", Fulfillment = "Fulfillment Zones", LTO = "LTO & discounts".

## Step 26 — setup-packages
- URL: /admin/catering/packages
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: Tapped the "Packages" tile. Looked only; tapped nothing on the page.
- Saw: "‹ CATERING", heading "Catering Packages", "Build the catering packages customers can order, with pricing and what's included.", "ADD PACKAGE" button, then one row per package per shop (Capitol Hill and P Street both listed) such as "8 pc platter — P Street · Per platter · $60.00 · Min 4 people · 24h lead time · Serves 8 · 1 items", also "16 pc platter", "32 pc platter", "48 pc platter", "Light Lunch (Per head · $12.00 · Min 1 people)", "Full Lunch (Per head · $19.99)", "Three Footer (Per platter · $135.00 · Min 6 people · 48h lead time · Serves 16)", "Six Footer (Per platter · $260.00 · Min 15 people · 72h lead time · Serves 32)". Each row has "Edit", "Deactivate", "Show details".
- Shot: img/catering/26-setup-packages.png
- Confused: The back link says "‹ CATERING" / "Back to Catering" even though the page sits under Admin.

## Step 27 — setup-menu
- URL: /admin/catering/menu
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: Back to the setup page, tapped the "Catering Menu" tile. Looked only.
- Saw: "‹ CATERING", heading "Catering Menu", "Flag items available for catering (à la carte) and, optionally, catering-only. Changes need a password step-up." Tabs "Menu" and "Toast". A "HOW THIS LIST WORKS" box ("Toast items come from the store menu and are named in Toast. Catering items exist only here — tubs, cases, waters — and get their sizes and prices here. Rows appear to customers under the same headings you see below, in the same order.") with a "Got it" button (not tapped). Filters "All", "On menu", "Hidden", "Toast items", "Catering items"; a search box (placeholder "Search items…"); checkbox "Preview as customer". "Packages — Packages are built on their own page. Customers see them first. — 16 active — Open packages →". Section rows: "Drinks 21 on the menu of 21", "Sides 22 on the menu of 33", "Desserts 4 on the menu of 5" (open), "Add-ons 1 on the menu of 11", "Cooks 0 on the menu of 9", "Sauces 0 on the menu of 12", "Slicing 0 on the menu of 9", "Veg 0 on the menu of 11", "Build Your Own 0 on the menu of 9", "Gear 0 on the menu of 2". Each item row has "TOAST ITEM", a price, "Feeds [ ] people" and toggles "ON CATERING MENU", "CATERING ONLY", "SOLD BY PORTION"; some show "HIDDEN FROM CUSTOMERS".
- Shot: img/catering/27-setup-menu.png
- Confused: Notes/comment fields: none on this page; the only text box is the search box ("Search items…"). The Desserts section opens by itself while the others are collapsed.

## Step 28 — setup-capacity
- URL: /admin/catering/capacity
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: Back to the setup page, tapped "Capacity & Blackouts". Looked only.
- Saw: "‹ CATERING", heading "Capacity & Blackouts", "Per-location booking caps, lead time, and blackout dates." Two cards, "Capitol Hill" and "P Street", each with a grey badge "NOT CONFIGURED", the line "Max covers per day: No cap · Max events per day: No cap · Minimum lead time (hours): No cap", a "Configure" button, "Blackout dates — No blackout dates.", and a form "Date" (mm/dd/yyyy), "Reason (optional)" (text box, no placeholder text), and a greyed "ADD BLACKOUT" button.
- Shot: img/catering/28-setup-capacity.png
- Confused: "No cap" is shown for all three limits; this matches "No caps set" on the lead card in the Pipeline. The "Reason (optional)" box is the only note-like field here; its placeholder is empty.

## Step 29 — setup-zones
- URL: /admin/catering/zones
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: Back to the setup page, tapped "Delivery Zones". Looked only.
- Saw: "‹ CATERING", heading "Delivery zones", "Per-location delivery zones: fee and minimum order." Two blocks, "Capitol Hill (MEP)" and "P Street (EM)", each with an "ADD ZONE" button and "No zones yet for this location."
- Shot: img/catering/29-setup-zones.png
- Confused: No zones exist in the sim, so no fee or minimum order example is shown.

## Step 30 — setup-fulfillment
- URL: /admin/catering/fulfillment
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: Back to the setup page, tapped "Fulfillment Zones". Waited for the map to load. Looked only (did not drag the pin or tap SAVE ZONE).
- Saw: "‹ CATERING", heading "Fulfillment Zones", "Set each store's delivery zone: drag the pin to center, adjust the radius, and toggle delivery / pickup availability." "LOCATION" drop-down ("Capitol Hill — not set" / "P Street — not set"; it opens on Capitol Hill), "Drag the pin to your store; set the delivery radius below.", a Leaflet / OpenStreetMap map with a pin and a blue radius ring over Washington DC, "DELIVERY RADIUS (MILES)" box showing 5, checkboxes "Offers delivery" and "Offers pickup" (both ticked), and a "SAVE ZONE" button below.
- Shot: img/catering/30-setup-fulfillment.png
- Confused: Both shops say "not set", yet the screen shows a pin and a 5-mile ring (defaults). The photo is on the Capitol Hill choice, not P Street.

## Step 31 — setup-faq
- URL: /admin/catering/faq
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: Back to the setup page, tapped "FAQ". Looked only.
- Saw: "‹ CATERING", heading "Catering FAQ", "Manage frequently asked questions shown to catering clients.", an "ADD FAQ" button, and "No FAQs yet. Add one above."
- Shot: img/catering/31-setup-faq.png
- Confused: Empty in the sim.

## Step 32 — setup-prep-demand
- URL: /admin/catering/prep-demand?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: Back to the setup page, tapped "Prep Demand". It opened on Capitol Hill, so I picked "P Street" in the "LOCATION" drop-down (a view choice only).
- Saw: "‹ CATERING", heading "Catering Prep Demand", "Upcoming prep required by confirmed catering leads, with over-par alerts for the next 14 days.", "LOCATION" drop-down (Capitol Hill, P Street), the range "Tue, Oct 13 – Tue, Oct 27", tabs "Prep", "Raw / SKU", "Surplus", "Sales", and the line "No upcoming catering prep demand for this location."
- Shot: img/catering/32-setup-prep-demand.png
- Confused: Empty because nothing is in CONFIRMED (my lead is in QUOTE SENT, which is correct).

## Step 33 — setup-lto
- URL: /admin/catering/lto
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: Back to the setup page, tapped "LTO & discounts"; it opened on Capitol Hill, so I picked "P Street" in the "LOCATION" drop-down (a view choice only).
- Saw: "‹ CATERING", heading "Surplus → LTO / discount", "Turn surplus into a featured LTO or a discount.", "LOCATION" drop-down (Capitol Hill, P Street), "Surplus available to promote — No perishable surplus to act on.", "LTOs & discounts — No LTOs or discounts yet."
- Shot: img/catering/33-setup-lto.png
- Confused: The page title is "Surplus → LTO / discount" but the tile is called "LTO & discounts".

## Step 34 — logged-out
- URL: /
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: Back through Admin to the Dashboard, scrolled to the bottom, tapped "LOG OUT".
- Saw: The "Where are you?" screen with "MEP / Capitol Hill" and "EM / P Street", and "Manager login →" at the top. No confirm box and no toast.
- Shot: img/catering/34-logged-out.png

## Summary
- Shots taken: 34 of 38 planned. Numbers are contiguous 01-34 in the order taken. The four skipped plan shots (12-lead-note, 17-ezcater-order, 18-not-in-toast, 22-company-detail) are logged as BLOCKED / ABSENT blocks above, so every shot from plan number 13 onward sits one to four numbers lower than its plan number (slugs unchanged).
