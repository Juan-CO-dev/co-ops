# Catering walk — step log (Marcus Webb, 2026-10-14)

## Step 01 — where-are-you
- URL: /
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: `start tablet walker`, then `look` on the first screen.
- Saw: "Manager login →" (top right); heading "Where are you?"; two tiles "MEP Capitol Hill" and "EM P Street".
- Shot: img/catering/01-where-are-you.png

## Step 02 — whats-your-role
- URL: /
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Tapped the P Street tile.
- Saw: heading "What's your role?"; sub-line "EM · P STREET"; tiles "GM General Manager", "AGM Assistant General Manager", "CTR Catering Manager", "SL Shift Lead", "KH Key Holder", "TR Trainer", "EMP Employee", "TRN Trainee"; "← Back".
- Shot: img/catering/02-whats-your-role.png

## Step 03 — who-are-you
- URL: /
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Tapped the General Manager tile.
- Saw: heading "Who are you?"; sub-line "EM · P STREET · GENERAL MANAGER"; one tile "MW Marcus Webb"; "← Back".
- Shot: img/catering/03-who-are-you.png

## Step 04 — pin-keypad
- URL: /
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Tapped the Marcus Webb tile.
- Saw: badge "GENERAL MANAGER", name "Marcus Webb", "Enter your 4-digit PIN", four empty dots, keypad 1-9, "Clear", 0, "← Back", "Use system keyboard".
- Shot: img/catering/04-pin-keypad.png

## Step 05 — dashboard
- URL: /dashboard?loc=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Tapped 9 four times. The screen showed "Loading…" for a few seconds, then the dashboard.
- Saw: "DASHBOARD" "Hi, Marcus Webb."; badge "GENERAL MANAGER"; bell "31"; shop switcher "MEP · CAPITOL HILL" and "EM · P STREET" (P Street highlighted/selected); "EXPLORE" chips: Mid-Shift Pulse, Reports Hub, Assignments, Trends, LTO, Written Reports, Catering, Maintenance, Production, Training, Recipes, Profile, Settings, My Performance, Admin; then "My shift" ("Take or assign tasks", "0 of 8 assigned"), "My station", "Team today", "TODAY'S OPERATIONS EM · P Street Wed, Oct 14", "CLOSING CHECKLIST Not started", "START CLOSING", "LOG OUT". The round user button "M" sits in the page at top right.
- Shot: img/catering/05-dashboard.png
- Confused: The dashboard opened on P Street (as expected).

## Step 06 — catering-hub
- URL: /catering?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Dashboard, tapped the **Catering** chip under Explore.
- Saw: "‹ DASHBOARD"; heading "Catering"; sub-line "Pipeline, quotes, and customers in one place."; six cards, in order: "Catering Insights — Leads, booked catering and a calendar — by week, month, 30 days or all time." / "Catering Pipeline — Leads from inquiry to completed." / "Catering Quotes — Build, price, and send quotes." / "Catering Customers — Customer directory and history." / "Catering Companies — Company accounts + email attribution." / "Admin & setup — Packages, menu, pricing, zones & rate rules."
- Shot: img/catering/06-catering-hub.png

## Step 06b — pulse-catering
- URL: /mid-shift?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Back to Dashboard, tapped **Mid-Shift Pulse** under Explore, scrolled down to the Catering card. Looked only.
- Saw: Page heading "Mid-shift Pulse", "Updated 3:10 AM", shop links "Capitol Hill" and "P Street", "Refreshes every 60 s". Catering card ("Catering  as of 3:10 AM", "See more"): "DUE TODAY" / "No catering due today." / "Tomorrow: no catering booked" / "Prep: AM Not started · mid-day Not started" / "NOT RUNG INTO TOAST" / "Every ezCater order is in Toast." (green). No money shows in the Catering card. (Sales card above it says "Register checks, before tax · ezCater not included".) Beside it is the Inventory card (order cutoffs: Boar's Head 3:00 PM, Cardinal Bakery 3:00 PM, PFG 4:00 PM, Trimark 6:00 PM, each "no draft yet").
- Shot: img/catering/06b-pulse-catering.png
- Confused: The page says "Updated 3:10 AM" / "as of 3:10 AM" although the sim day is Wed Oct 14; the page does not say which shop is active (both shop links look alike in the text dump). A handoff note box was not touched. Handoff card says "No handoff notes for today."

## Step 07 — pipeline
- URL: /catering/pipeline
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Back to Dashboard, **Catering**, then the **Catering Pipeline** card.
- Saw: "‹ CATERING"; heading "Catering Pipeline"; sub-line "Leads from inquiry to completed — track, follow up, and confirm."; search box (placeholder "Search leads by name, company, or phone…") with a **Search** button; **+ Add lead**; filters "Order lead" (All, Angel Reyes, Dana Brooks, Deshawn Carter, Luis Herrera, Marcus Webb, Maya Torres, Nicole Boyd, Priya Shah, Rosa Delgado, Tommy Nguyen) and "Source" (All, Online portal, Staff entered, Phone, Walk-in, Toast catering, EZCater, Direct invoice, Other); a "Follow-ups due" panel; columns in order INQUIRY, QUOTE SENT, CONFIRMED, OUT FOR DELIVERY, COMPLETED, LOST. **Move to other shop** is not shown for Marcus (it only appears, if at all, inside an opened lead: not there).
- Shot: img/catering/07-pipeline.png
- Bug?: THE SIM WAS NOT CLEAN. On arrival the pipeline already held 13 leads: QUOTE SENT 1 = "Jordan Sample / Hill Staffers LLC / P Street / Fri, Oct 23 / 25 ppl / Staff entered" (already a Hill Staffers LLC lead, with no @owner line), and CONFIRMED 12 = other test leads ("Fable R1 Contact", "Hill Staffers Sonnet R1 LLC", "Hill Staffers Sol R1 LLC", "Hill Staffers Astra R1 LLC", "Hill Staffers Terra R1 LLC", "Luna R1 Catering Contact", "Hill Staffers Glm R1 LLC" x2, "Hill Staffers Glmflash R1 LLC", "Opus R1 Contact", "Hill Staffers Dsflash R1 LLC", "Hill Staffers Deepseek R1 LLC"), all P Street, 25 ppl, assigned @Marcus Webb. "Follow-ups due" lists "Hill Staffers Deepseek R1 LLC · Hill Staffers Deepseek R1 LLC  due Wed, Oct 14". These show in the 07 photo. The walk script said there would be no Hill Staffers LLC lead.
- Confused: Whether another walker is using the same sim. I carried on as scripted; my new lead is therefore a second "Jordan Sample / Hill Staffers LLC".

## Step 08 — add-lead-form
- URL: /catering/pipeline
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Tapped **+ Add lead**. Typed Contact name `Jordan Sample`, Company `Hill Staffers LLC`, Event date `2026-10-23` (the box shows `10/23/2026`), Headcount `25`, Location **P Street**, Notes `Sim walk: wants a mix of hot and cold subs. Call Thursday to confirm.` Left Lead source = **Staff entered**, Order lead = **Unassigned**, Follow-up date empty.
- Saw: form fields in order: "Contact name *" (required), "Company", "Event date" (mm/dd/yyyy), "Headcount", "Lead source" (Online portal, Staff entered, Phone, Walk-in, Toast catering, EZCater, Direct invoice, Other; starts on Staff entered), "Order lead (assigned to)" (Unassigned + the 10 staff names; starts on Unassigned), "Follow-up date" (mm/dd/yyyy), "Location" (No location (global), Capitol Hill, P Street; starts on **No location (global)**), "Notes"; buttons **Add** and **Cancel**. No placeholder text in any text box, number box or the Notes box (they are empty); only the date boxes show "mm/dd/yyyy".
- Shot: img/catering/08-add-lead-form.png
- Confused: Location starts on "No location (global)", not on the shop you are in.

## Step 09 — lead-created
- URL: /catering/pipeline
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Tapped **Add**. No confirm box, no toast seen.
- Saw: INQUIRY 1 with a card "Jordan Sample / Hill Staffers LLC / P Street / Fri, Oct 23 / 25 ppl / Staff entered" (no @owner line because Order lead was Unassigned). QUOTE SENT 1 (the older identical Jordan Sample card), CONFIRMED 12.
- Shot: img/catering/09-lead-created.png
- Bug?: Two identical "Jordan Sample / Hill Staffers LLC" cards now exist (see Step 07).

## Step 10 — lead-detail
- URL: /catering/pipeline
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Tapped the new Inquiry card. Scrolled with the arrow-down key so the whole opened card is in view.
- Saw: Under the card: "No caps set"; "Notes" "Sim walk: wants a mix of hot and cold subs. Call Thursday to confirm."; button **Edit details**; "Move to" with buttons **Quote sent**, **Confirmed**, **Out for delivery**, **Completed**, **Lost**. No amber "Order comparison is currently unavailable." line. No **Move to other shop**.
- Shot: img/catering/10-lead-detail.png
- Confused: The card header shows a black keyboard-focus outline in the photo (from using the arrow key to scroll). The page scroll step of `scroll down` is a full screen, which cut the card off, hence the arrow keys.

## Step 10b — lead-edit-details
- URL: /catering/pipeline
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Tapped **Edit details**. Typed Follow-up date `2026-10-22` (Thursday of next week). Tapped **Save**.
- Saw: Edit form inside the card: "Contact name *" (value Jordan Sample), "Company" (Hill Staffers LLC), "Event date" (10/23/2026), "Headcount" (25), "Follow-up date" (10/22/2026), "Notes" (the lead note, in a textarea with no placeholder); buttons **Save** and **Cancel**; "Move to" buttons still below. After **Save** the card shows a new row "Follow-up date  Thu, Oct 22" above **Edit details**, and stays open.
- Shot: img/catering/10b-lead-edit-details.png
- Confused: The form fields are squeezed into the narrow Inquiry column in two columns; in the photo "Contact name *" wraps onto two lines, "Jordan Samp" and "Hill Staffers L" are cut off, the Event date reads "10/23/20" and the new Follow-up date reads "/22/2026" (the month is scrolled out of the box). The full date was typed correctly (value 2026-10-22).
- Bug?: Edit-details inputs are too narrow at 1024 wide: names and dates are clipped.

## Step 11 — lead-moved
- URL: /catering/pipeline
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Under **Move to** tapped **Quote sent** (the card was still open after Save). No confirm box.
- Saw: INQUIRY 0 "None"; QUOTE SENT 2 (two "Jordan Sample / Hill Staffers LLC / P Street / Fri, Oct 23 / 25 ppl / Staff entered" cards); CONFIRMED 12; OUT FOR DELIVERY None.
- Shot: img/catering/11-lead-moved.png
- Confused: Stage names in order: Inquiry, Quote sent, Confirmed, Out for delivery, Completed, Lost.

## Step 12 — quotes-list
- URL: /catering/quotes
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Back to Catering, tapped the **Catering Quotes** card.
- Saw: heading "Catering Quotes"; sub-line "Build a priced quote, send it, and track its status."; button **NEW QUOTE**; group "DRAFT · 10" with rows like "$330.00 / 2026-10-23 · 25 covers / DRAFT"; a second group "ACCEPTED · 2" ("$549.73 2026-10-23 · 25 covers ACCEPTED", "$562.93 2026-10-23 · 25 covers ACCEPTED"). Rows show only the total, the date and covers, and a status pill (no client name).
- Shot: img/catering/12-quotes-list.png
- Bug?: The script says the list would show "No quotes yet." It does NOT: 12 leftover quotes were already there (10 draft, 2 accepted) from earlier test runs. Photo shows the first six draft rows only.

## Step 13 — quote-builder
- URL: /catering/quotes
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Tapped **NEW QUOTE**. Under Pipeline lead picked "Jordan Sample · Hill Staffers LLC · Fri, Oct 23 · P Street". Typed `orders@hillstaffers.example` in Client email.
- Saw: "New quote" with "Cancel"; boxes LOCATION (Capitol Hill / P Street; already on P Street), EVENT DATE, HEADCOUNT, CLIENT EMAIL (placeholder name@company.com; hint "The client's email is their identifier — used to send the quote and roll them up to their company account."), CLIENT NAME, COMPANY, PIPELINE LEAD ("None" first, then each lead as "contact · company · date · shop"). On picking the lead these filled by themselves: EVENT DATE 10/23/2026, HEADCOUNT 25, CLIENT NAME "Jordan Sample", COMPANY "Hill Staffers LLC". Location showed P Street (it was already P Street before the pick). Client email did NOT fill itself. The Client email box shows a small "▼" (saved-email suggestions). Below: "LINE ITEMS" with columns DESCRIPTION / QTY / UNIT PRICE / ×.
- Shot: img/catering/13-quote-builder.png
- Confused: Lead option reads "contact · company · date · shop", e.g. "Jordan Sample · Hill Staffers LLC · Fri, Oct 23 · P Street". There are TWO identical Jordan Sample options (the old one and the one I added); I picked by text, so the first one in the list was chosen (cannot tell them apart on screen). The quote ends up showing Lead "Jordan Sample · Hill Staffers LLC · Fri, Oct 23" either way.
- Line items: Yes, there was an empty first line (blank DESCRIPTION, QTY 1, blank UNIT PRICE, Remove line disabled) before I added anything; **Add package** filled that line instead of adding a second. Add package list: 8 pc platter — $60.00, 16 pc platter — $115.00, 32 pc platter — $210.00, 48 pc platter — $330.00, Light Lunch — $12.00, Full Lunch — $19.99, Three Footer — $135.00, Six Footer — $260.00. I picked the first, "8 pc platter — $60.00": it is a flat price (Qty 1, Unit price 60), not per head, so I left Qty at 1. It also added a second line "Choose your subs (×4)" with Qty 4 and an empty unit price. **Add à la carte** first item "Napkins & Utensils — $20.00" added a line (Qty 1, unit price 20). No placeholder text in the line, Qty, unit price boxes or the Notes box.

## Step 14 — quote-totals
- URL: /catering/quotes
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Scrolled to the bottom of the builder.
- Saw: Three lines: "8 pc platter" (qty 1, 60), "Choose your subs (×4)" (qty 4, blank price), "Napkins & Utensils" (qty 1, 20); then "+ Add line", checkbox "Delivery", "NOTES" box, and the totals card: "Subtotal $80.00", "Tax $8.00", "Total $88.00", "Deposit due $22.00"; button **SAVE DRAFT**.
- Shot: img/catering/14-quote-totals.png

## Step 15 — quote-saved
- URL: /catering/quotes
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Tapped **SAVE DRAFT**. No confirm box. Scrolled so the buttons show.
- Saw: "← Back"; status pill "DRAFT"; "$88.00"; "2026-10-23 · 25 covers"; "Client: Jordan Sample · Hill Staffers LLC · orders@hillstaffers.example"; "Lead: Jordan Sample · Hill Staffers LLC · Fri, Oct 23"; "Expires: Wed, Oct 28"; LINE ITEMS "8 pc platter × 1 $60.00", "Choose your subs (×4) × 4 $0.00", "Napkins & Utensils × 1 $20.00"; "Subtotal $80.00", "Tax $8.00", "Total $88.00", "Deposit due $22.00"; buttons **SEND QUOTE**, **Revise**, **Print labels**. (Not tapped: Send quote, Mark accepted, Mark declined; Mark accepted / Mark declined are not on a draft.) Totals split: subtotal, tax (10% of subtotal), total, deposit due (25% of total).
- Shot: img/catering/15-quote-saved.png

## NOTE — ezcater-orders (goal 5, no shot taken, as scripted)
- URL: /catering/pipeline
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Back to Catering Pipeline; set **Source** to **EZCater**.
- Saw: Every column says "None": INQUIRY 0, QUOTE SENT 0, CONFIRMED 0, OUT FOR DELIVERY 0, COMPLETED 0, LOST 0. No "Not in Toast yet" panel (or any Toast text outside the Source list). The "Follow-ups due" panel above the columns still lists "Hill Staffers Deepseek R1 LLC · Hill Staffers Deepseek R1 LLC  due Wed, Oct 14" (it is not filtered by Source). Source options: All, Online portal, Staff entered, Phone, Walk-in, Toast catering, EZCater, Direct invoice, Other.

## Step 16 — catering-customers
- URL: /catering/customers
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Back to Catering, tapped the **Catering Customers** card.
- Saw: "‹ CATERING"; heading "Catering Customers"; sub-line "Customer directory grouped by company, with lead and order history."; **+ Add customer**; one group per company, with the company name in capitals and a card (name + email) under it: HILL STAFFERS DEEPSEEK R1 LLC, HILL STAFFERS DSFLASH R1 LLC, HILL STAFFERS FABLE R1 LLC, HILL STAFFERS GLM R1 LLC, HILL STAFFERS GLMFLASH R1 LLC, **HILL STAFFERS LLC → Jordan Sample · orders@hillstaffers.example**, HILL STAFFERS LUNA R1 LLC, HILL STAFFERS OPUS R1 LLC, HILL STAFFERS SONNET R1 LLC (9 groups, alphabetical). Emails are shown in full on the cards.
- Shot: img/catering/16-catering-customers.png
- Confused: At 1024x768, "+ Add customer" and the Hill Staffers LLC group cannot be in the same screen: the photo shows **+ Add customer** and the first four groups; Jordan Sample is below the fold (6th group). The photo does not show Jordan Sample.
- Bug?: The list holds leftover customers from earlier test runs (the "R1" companies).

## Step 17 — customer-detail
- URL: /catering/customers
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Tapped the Jordan Sample card; it opens in place. Scrolled (arrow keys) to bring it up.
- Saw: Jordan Sample / orders@hillstaffers.example, then three columns: "Pipeline" — "Jordan Sample · Quote sent · 2026-10-23" (twice); "Quotes" — "$88.00 · draft · Fri, Oct 23" and "$352.00 · draft · Fri, Oct 23"; "Orders" — "None yet."; buttons **Edit** and **Deactivate**. Nothing edited.
- Shot: img/catering/17-customer-detail.png
- Confused: The black box around the name and email in the photo is the keyboard-focus outline from the scroll keys. Two Pipeline rows and two Quotes: $88.00 is mine, $352.00 is a leftover quote on the older Jordan Sample lead (same email, so they roll up to one customer).

## Step 18 — catering-companies
- URL: /catering/companies
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Back to Catering, tapped the **Catering Companies** card.
- Saw: heading "Catering Companies"; sub-line "Company accounts — corporate domains auto-attribute contacts; an account can later be claimed via portal sign-up."; button **NEW COMPANY**; card "No company accounts yet."
- Shot: img/catering/18-catering-companies.png

## Step 18b — new-company-form
- URL: /catering/companies
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Tapped **NEW COMPANY**. Typed nothing. Tapped **Cancel** after the photo (nothing saved; page went back to "No company accounts yet.").
- Saw: Form with "COMPANY NAME" (empty, no placeholder), "CORPORATE DOMAIN (OPTIONAL)" (placeholder "acme.com"), hint "Emails from this domain auto-attribute to this company. Personal domains (gmail, etc.) can't be used — attach those contacts by hand."; buttons **CREATE** and **Cancel**.
- Shot: img/catering/18b-new-company-form.png

## Step 19 — insights
- URL: /catering/insights
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Back to Catering, tapped the **Catering Insights** card. Nothing else tapped (no CSV/PDF).
- Saw: heading "Catering Insights"; sub-line "Leads, booked catering and feedback — by week, month, 30 days or all time."; "Download" with **CSV** and **PDF**; range buttons **THIS WEEK**, **THIS MONTH** (selected, dark), **LAST 30 DAYS**, **ALL TIME**; tiles: NEW LEADS 14, BOOKED EVENTS 12, CONFIRMED (UPCOMING) $1,112.66 "12 events", COMPLETED $0.00 "0 events", WIN RATE 100%, LOST 0, AVG. HEADCOUNT 25, OPEN PIPELINE $0.00; note "Money counts by event date; leads count by the day they arrived."; fold-out rows "Leads by source  1 source", "Events by stage  14 events", "Booked catering calendar  12 booked".
- Shot: img/catering/19-insights.png
- Confused: OPEN PIPELINE still shows $0.00 although a $88.00 draft quote (and 11 other draft quotes) exists, so a draft quote does not count toward it. The only money wording on the page is "CONFIRMED (UPCOMING)", "COMPLETED" and the note above ("Money counts by event date; leads count by the day they arrived."); there is no separate "split" sentence. The numbers include the leftover test leads (see Step 07).

## Step 20 — insights-full
- URL: /catering/insights
- Persona / viewport: Marcus Webb, General Manager / 1024x768 (full-page photo, 1024 wide)
- Action: Same page, full-page photo.
- Saw: As Step 19, plus the open "Booked catering calendar  12 booked" card: legend "Confirmed" (yellow), "Out for delivery" (black), "Completed" (green); month arrows and "October 2026"; switch "Show lost ✓"; "Dots mark booked events. Tap a day to see them."; week grid MON-SUN from Sep 28 to Nov 1 with dots on Fri Oct 16 ("+1") and Fri Oct 23 ("+5"); today Wed Oct 14 highlighted; "WED, OCT 14 — No booked catering this day."; then "CUSTOMER FEEDBACK — No feedback yet."
- Shot: img/catering/20-insights-full.png
- Confused: In the full-page photo the page background changes at about one screen down (a faint band and a pale shape at the right edge), that is only the page background ending at one screen height, not part of the app.

## Step 21 — sales
- URL: /reports/sales?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09&range=last7&from=2026-10-08&to=2026-10-14&compare=false (the page then shows From 10/07/2026, To 10/13/2026)
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Dashboard, **Reports Hub**, then in the "Sales" group tapped **Sales** (the group lists **Sales**, **Sales checks**, **Catering sales**, then Download CSV / PDF; not tapped).
- Saw: "‹ REPORTS", "DASHBOARD" link; shop buttons "Capitol Hill" and "P Street" (P Street selected); heading "Sales" with links **Checks** and **Catering**; "Date range" (Yesterday, Last 7 days [selected], Last 30 days, Last 90 days, This month, Last month, Last 12 months, Today, Custom), "From" 10/07/2026, "To" 10/13/2026, "Group by" (Day, Week, Month), "Compare with previous period", **Apply**; note "Finished business days only (today only when you pick Today). Up to 92 days by day, 26 weeks by week, 12 months by month."; view buttons **Summary** (selected), **Items**, **Modifiers**, **Channels**, **Hour × weekday**, **Discounts**, **Servers**; "Download" **CSV**, **PDF** (not tapped); "Wed, Oct 7 to Tue, Oct 13 · Toast business dates · ezCater event dates"; a red pill "No capture · 0/7 days"; "No sales recorded for these days: not the same as $0."; sales tiles all "—": "Toast item-sales net (captured)", "Toast gross item sales", "Toast discounts and comps", "Toast item voids", "Toast non-gratuity service charges", "Toast item-sales refunds", "Sales (before refunds)", "Toast check totals (before refunds)", "ezCater reported subtotal / 0 ezCater orders", "Checks", "Average check", "Discounts / 0 applied", "Sales tax", "Tips", "Refunds captured so far".
- Shot: img/catering/21-sales.png
- Confused: Reports Hub showed "Last 7 days" as From 2026-10-08 To 2026-10-14, but the Sales page shows 10/07 to 10/13 (finished days only). The tiles are all "—" because the sim has no Toast capture. The walk's wording "tabs" = the **Checks** / **Catering** links next to the heading; the "views" are the seven buttons. No all-shops option was looked for.

## Step 22 — catering-sales
- URL: /reports/sales/catering?range=last7&from=2026-10-07&to=2026-10-13&g=day&compare=false&location=d2cced11-b167-49fa-bab6-86ec9bf4ff09
- Persona / viewport: Marcus Webb, General Manager / 1024x768
- Action: Tapped **Catering** (top right of the Sales heading).
- Saw: "‹ SALES"; heading "Catering sales"; same date controls; "Download" CSV / PDF (not tapped); card "ezCater orders": "0 ezCater orders · $0.00", "Subtotal by event date. ezCater is the source; a Toast ring linked to the order is not counted again.", pills "Matched in Toast: 0", "Not in Toast: 0", "Amount does not match: 0"; card "Catering rung in Toast": "Sales (before refunds): $0.00", "Nothing in this range."; card "Catering pipeline value" (below the fold): "Completed events (0): $0.00", "Confirmed, not yet done (0): $0.00", "Quote or estimate value by event date. Not register sales, never added to the totals above."; card "ezCater orders in this range": "Nothing in this range."
- Shot: img/catering/22-catering-sales.png
- Confused: "Catering pipeline value" card is cut off at the bottom of the photo (only its heading shows).

## NOTE — switch-to-desktop (goal 9, no shot)
- Ran `stop`, `start desktop walker`, logged in again: Where are you? → P Street → What's your role? → General Manager → Who are you? → Marcus Webb → PIN 9999. Dashboard opened on P Street ("EM · P Street" in Today's Operations; URL /dashboard?loc=d2cced11-b167-49fa-bab6-86ec9bf4ff09, same id as before). Explore chips on desktop: Mid-Shift Pulse, Reports Hub, Assignments, Trends, LTO, Written Reports, Catering, Maintenance, Production, Training, Recipes, Profile, Settings, My Performance, Admin.

## Step 23 — customers
- URL: /admin/customers
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: Dashboard, **Admin**, then the **Customers** card. No reveal or download button tapped.
- Saw: "‹ ADMIN"; heading "Customers" with button **Catering accounts**; sub-line "Who orders from your shop: visits, spend, favourite items and how often they come. Contact details are not shown here."; count chips "People: 0", "Regulars: 0", "Gone quiet: 0", "Both shops: 0", "Catering: 0", "Marketplace guests: 0 · 0 linked"; group chips "Regulars (5+ visits)", "Gone quiet (60+ days)", "One visit", "New (30 days)", "Both shops", "Catering customers"; filters "Search by name", "Sort by" (Most recent order, Most visits, Most spent, Highest average order, Most cards, Most catering orders, Newest customers, Quiet repeat customers), "Shop" (text "Capitol Hill, P Street"), "Order channel" (All, In store, Online, App, Delivery, Catering), "Customer group", "Minimum visits", "Minimum spend ($)", checkbox "Include marketplace guests", buttons **Apply filters** and **Clear**; "Profiles (0)" with "No customers match these filters."; folded row "Likely same person (0)". No contact fields (email, phone) anywhere on the page.
- Shot: img/catering/23-customers.png
- Confused: The page shows all zeros and "No customers match these filters." even though the catering page lists 9 customers (the two are different customer sets: this one is built from Toast/online order profiles, the catering one from catering contacts). The Shop line reads "Capitol Hill, P Street" (both shops), although Marcus is on P Street.

## Step 24 — catering-accounts
- URL: /admin/customers/catering
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: Tapped **Catering accounts** (top right of Customers); no `goto` needed.
- Saw: "‹ ADMIN"; button **Back to customers**; heading "Catering accounts"; chips "Accounts: 0", "Repeat accounts: 0", "Gone quiet: 0", "12-month catering spend: $0.00"; "Sort by" (Most spent on catering, Most catering orders, Most recent catering order, Quiet repeat accounts); checkbox "Gone quiet only (over 90 days)"; **Apply filters**; "Accounts: 0"; "No catering accounts match these filters." No contact fields.
- Shot: img/catering/24-catering-accounts.png

## Step 25 — catering-setup
- URL: /admin/catering
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: Dashboard, **Catering** chip, **Admin & setup** card (the hub card's sub-line is "Packages, menu, pricing, zones & rate rules.").
- Saw: "‹ ADMIN"; heading "Catering"; sub-line "Packages, capacity, delivery zones, and menu FAQ."; nine tiles in this order: **Packages**, **Catering Menu**, **Capacity & Blackouts**, **Delivery Zones**, **FAQ**, **Prep Demand**, **LTO & discounts**, **Fulfillment Zones**, **Catering workspace**. **Pricing**, **Rate rules** and **ezCater item review** are NOT listed for Marcus.
- Shot: img/catering/25-catering-setup.png
- Confused: The setup page's sub-line ("Packages, capacity, delivery zones, and menu FAQ.") and the hub card's text ("Packages, menu, pricing, zones & rate rules.") do not match; Pricing and Rate rules are named on the hub card but absent here. There is an extra tile "Catering workspace" (not opened). I reached the setup page from the Dashboard Catering chip, then the Admin & setup card.

## Step 26 — setup-packages
- URL: /admin/catering/packages
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: Tapped **Packages**. Changed nothing.
- Saw: "‹ CATERING"; heading "Catering Packages"; sub-line "Build the catering packages customers can order, with pricing and what's included."; button **ADD PACKAGE**; one row per package and shop, each with **Edit**, **Deactivate**, **Show details**: "8 pc platter — P Street · Per platter · $60.00 · Min 4 people · 24h lead time · Serves 8 · 1 items", the same for Capitol Hill, then 16 pc ($115.00, min 8), 32 pc ($210.00, min 16), 48 pc ($330.00, min 24), "Light Lunch — Per head · $12.00 · Min 1 people", "Full Lunch — Per head · $19.99", "Three Footer — Per platter · $135.00 · Min 6 people · 48h lead time · Serves 16", "Six Footer — Per platter · $260.00 · Min 15 people · 72h lead time · Serves 32" (16 rows: each package once per shop).
- Shot: img/catering/26-setup-packages.png
- Confused: The photo shows only the first nine rows.

## Step 27 — setup-menu
- URL: /admin/catering/menu
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: Tapped **Catering Menu**. Waited for it to load. Did not tap **Got it** or any flag.
- Saw: "‹ CATERING"; heading "Catering Menu"; sub-line "Flag items available for catering (à la carte) and, optionally, catering-only. Changes need a password step-up."; tabs **Menu**, **Toast**; box "HOW THIS LIST WORKS — Toast items come from the store menu and are named in Toast. Catering items exist only here — tubs, cases, waters — and get their sizes and prices here. Rows appear to customers under the same headings you see below, in the same order." with **Got it**; filter buttons **All**, **On menu**, **Hidden**, **Toast items**, **Catering items**; search "Search items…"; checkbox "Preview as customer"; "Packages — Packages are built on their own page. Customers see them first." "16 active" with **Open packages →**; folded groups "Drinks 21 on the menu of 21", "Sides 22 on the menu of 33", then "Desserts 4 on the menu of 5" open with rows (Berger Cookies - 2 pk $4.00, Berger Cookies- Large $9.99, Fruity Pebble Cannoli (single) $2.00 "HIDDEN FROM CUSTOMERS", ...), each row with "Feeds [1] people" and toggles **ON CATERING MENU**, **CATERING ONLY**, **SOLD BY PORTION**. Other groups below: Add-ons 1 of 11, Cooks 0 of 9, Sauces 0 of 12, Slicing 0 of 9, Veg 0 of 11, Build Your Own 0 of 9, Gear 0 of 2 (open: Compliments Only T-Shirt "HIDDEN FROM CUSTOMERS" $35.00, Little Sticker).
- Shot: img/catering/27-setup-menu.png
- Confused: The Desserts and Gear groups open by themselves; the rest are folded.

## Step 28 — setup-capacity
- URL: /admin/catering/capacity
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: Tapped **Capacity & Blackouts**. Changed nothing.
- Saw: heading "Capacity & Blackouts"; sub-line "Per-location booking caps, lead time, and blackout dates."; two cards, "Capitol Hill  NOT CONFIGURED" and "P Street  NOT CONFIGURED", each "Max covers per day: No cap · Max events per day: No cap · Minimum lead time (hours): No cap", button **Configure**, "Blackout dates", "No blackout dates.", fields "Date" (mm/dd/yyyy) and "Reason (optional)" (no placeholder), button **ADD BLACKOUT** (greyed out until a date is chosen).
- Shot: img/catering/28-setup-capacity.png

## Step 29 — setup-zones
- URL: /admin/catering/zones
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: Tapped **Delivery Zones**.
- Saw: heading "Delivery zones" (lower-case z); sub-line "Per-location delivery zones: fee and minimum order."; "Capitol Hill (MEP)" with **ADD ZONE** and "No zones yet for this location."; "P Street (EM)" with **ADD ZONE** and "No zones yet for this location."
- Shot: img/catering/29-setup-zones.png
- Confused: The tile is called "Delivery Zones" but the page heading says "Delivery zones".

## Step 30 — setup-fulfillment
- URL: /admin/catering/fulfillment
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: Tapped **Fulfillment Zones**; waited for the map to load.
- Saw: heading "Fulfillment Zones"; sub-line "Set each store's delivery zone: drag the pin to center, adjust the radius, and toggle delivery / pickup availability."; "LOCATION" drop-down with "Capitol Hill — not set" and "P Street — not set" (P Street selected); "Drag the pin to your store; set the delivery radius below."; a Leaflet / OpenStreetMap map of Washington DC with a blue pin and a blue radius circle, zoom + and −; "DELIVERY RADIUS (MILES)" box with 5; checkboxes "Offers delivery" and "Offers pickup" (both ticked); button **SAVE ZONE** (below the fold in the photo). Nothing dragged or saved.
- Shot: img/catering/30-setup-fulfillment.png
- Confused: Both shops say "not set", yet the map already shows a pin and a 5-mile circle (defaults). The circle runs off the top and bottom of the map frame so it looks like an oval.

## Step 31 — setup-faq
- URL: /admin/catering/faq
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: Tapped **FAQ**.
- Saw: heading "Catering FAQ"; sub-line "Manage frequently asked questions shown to catering clients."; button **ADD FAQ**; "No FAQs yet. Add one above."
- Shot: img/catering/31-setup-faq.png

## Step 32 — setup-prep-demand
- URL: /admin/catering/prep-demand
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: Tapped **Prep Demand**. Waited for it to load.
- Saw: heading "Catering Prep Demand"; sub-line "Upcoming prep required by confirmed catering leads, with over-par alerts for the next 14 days."; "LOCATION" drop-down (Capitol Hill, P Street; P Street selected); "Wed, Oct 14 – Wed, Oct 28"; tabs **Prep** (selected), **Raw / SKU**, **Surplus**, **Sales**; day cards "Fri, Oct 16  1 items" (row "Choose your sub  NEEDS PICK") and "Fri, Oct 23  3 items" (rows "Choose your sub  NEEDS PICK" twice and "2 × House Greek Salad"). The "Sub — par comparison in W4b" text is gone (searched the page text: no "W4b").
- Shot: img/catering/32-setup-prep-demand.png
- Confused: The demand rows come from the leftover Confirmed test leads, not from my Quote-sent lead.

## Step 33 — setup-lto
- URL: /admin/catering/lto
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: Tapped **LTO & discounts**.
- Saw: heading "Surplus → LTO / discount"; sub-line "Turn surplus into a featured LTO or a discount."; "LOCATION" drop-down (P Street selected); card "Surplus available to promote — No perishable surplus to act on."; card "LTOs & discounts — No LTOs or discounts yet."
- Shot: img/catering/33-setup-lto.png
- Confused: The tile is "LTO & discounts"; the page heading is "Surplus → LTO / discount".

## Step 34 — logged-out
- URL: /
- Persona / viewport: Marcus Webb, General Manager / 1440x900
- Action: Dashboard, scrolled to the bottom, tapped **LOG OUT**. No confirm box.
- Saw: "Manager login →"; heading "Where are you?"; tiles "MEP Capitol Hill" and "EM P Street".
- Shot: img/catering/34-logged-out.png
- Confused: Taken at desktop width (1440x900) because the walk had moved to desktop for the Admin pages; the guide's other login photos (01-04) are tablet width.
