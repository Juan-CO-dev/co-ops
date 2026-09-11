# Catering walk — step log (Marcus Webb, 2026-09-08)

> Images 08–15 (first quote run: hit the menu-item à-la-carte save defect + missing pricing rule) and 49 (duplicate of 39) were removed from the repo; Supplement B (40–48) is the clean run the guide uses. The defect is tracked in the PR body and CHIEF bugs.

## Step 01 — catering-hub
- URL: /catering
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Logged in (tiles: P Street → General Manager → Marcus Webb → PIN 9999), then navigated to /catering.
- Saw: Heading "Catering" with subtext "Pipeline, quotes, and customers in one place." Five cards: "Catering Insights" ("Leads, booked catering and a calendar — by week, month, 30 days or all time."), "Catering Pipeline" ("Leads from inquiry to confirmed."), "Catering Quotes" ("Build, price, and send quotes."), "Catering Customers" ("Customer directory and history."), "Catering Companies" ("Company accounts + email attribution."), and "Admin & setup" ("Packages, menu, pricing, zones & rate rules.").
- Shot: img/catering/01-catering-hub.png

## Step 02 — pipeline-board
- URL: /catering/pipeline
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Navigated to the pipeline from the hub.
- Saw: Heading "Catering Pipeline" with subtext "Leads from inquiry to completed — track, follow up, and confirm." A search box "Search leads by name, company, or phone…", a "+ Add lead" button, filter dropdowns "Order lead" and "Source". Six columns left to right with counts: "INQUIRY" (1) — Maybe Corp, Sat Sep 19, 50 ppl, Walk-in, $900.00; "QUOTE SENT" (0) — "None"; "CONFIRMED" (4) — EZCater order SIM2, Rachel Wagley, Nav Gill, Block OS; "OUT FOR DELIVERY" (1) — EZCater order SIM1; "COMPLETED" (1) — Cris/CO; "LOST" (1) — Lost Lead. The board was NOT empty (8 leads total, matching the seeded sim data).
- Shot: img/catering/02-pipeline-board.png

## Step 03 — lead-detail
- URL: /catering/pipeline
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Clicked the "Maybe Corp" lead card in the Inquiry column to expand it.
- Saw: The card expands in place (accordion, not a separate page/URL) to show "No caps set", a definition list "Est. revenue: $900.00", and a "Move to" row of stage buttons: "Inquiry" (implicit, current), "Confirmed", "Out for delivery", "Completed", "Lost" (plus "Quote sent" was one of the options before the move). No note field appears on this card because it had none.
- Shot: img/catering/03-lead-detail.png
- Confused: Expected a separate lead-detail page or route; the board's row-click accordion IS the detail view — there's no dedicated /catering/pipeline/<id> URL reachable from the UI.

## Step 04 — pipeline-stage-change
- URL: /catering/pipeline
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Clicked the "Quote sent" stage button inside the expanded Maybe Corp card.
- Saw: The lead moved instantly (no confirmation dialog) — "INQUIRY" count dropped to 0 ("None"), "QUOTE SENT" count rose to 1 showing the Maybe Corp card in its new column.
- Shot: img/catering/04-pipeline-stage-change.png

## Step 05 — add-lead-note
- URL: /catering/pipeline
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Since the expanded lead card had no editable note field for an existing lead, used "+ Add lead" to create a new lead with a note attached at creation: Contact name "Erin Walsh", Company "Hill Staffers LLC", Event date 2026-09-18 (next Friday), Headcount 25, Lead source "Phone", Order lead (assigned to) "Marcus Webb", Location "P Street", Notes "Called about a Friday office lunch for ~25 people. Wants two packages plus an a la carte add-on. Delivery address 1200 Pennsylvania Ave NW. Follow up with a quote this week."
- Saw: Form fields exactly as above; a required-field marker "Contact name *"; buttons "Add" and "Cancel".
- Shot: img/catering/05-add-lead-note.png
- Confused: Notes can only be entered when creating a lead through this form — the existing lead's expanded card view has no "add note" control, so a note can't be appended to a lead already in the pipeline from this screen.

## Step 06 — lead-note-saved
- URL: /catering/pipeline
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Submitted the Add lead form, then clicked the new "Erin Walsh / Hill Staffers LLC" card in the Inquiry column to expand it and confirm the note saved.
- Saw: Card now reads "Erin Walsh · Hill Staffers LLC · Fri, Sep 18 · 25 ppl · Phone · @Marcus Webb". Expanded view shows "No caps set" and a definition list with term "Notes" and definition "Called about a Friday office lunch for ~25 people. Wants two packages plus an a la carte add-on. Delivery address 1200 Pennsylvania Ave NW. Follow up with a quote this week." Then clicked "Quote sent" under "Move to" to advance this lead one stage.
- Shot: img/catering/06-lead-note-saved.png

## Step 07 — quotes-list
- URL: /catering/quotes
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Navigated to Catering Quotes from the hub.
- Saw: Heading "Catering Quotes" with subtext "Build a priced quote, send it, and track its status." A "New quote" button and the message "No quotes yet." — confirms the sim starts with zero quotes as briefed.
- Shot: img/catering/07-quotes-list.png

## Step 08 — quote-builder-full
- URL: /catering/quotes
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Clicked "New quote", then filled the builder for the Hill Staffers LLC lead: Location "P Street", Event date 2026-09-18, Headcount 25, Client email "erin.walsh@hillstaffers.com", Client name "Erin Walsh", Company "Hill Staffers LLC", Pipeline lead "Erin Walsh · Hill Staffers LLC". Added two packages ("16 pc platter — $115.00" and "Full Lunch — $19.99") and one à la carte item ("Case of Assorted Chips (24) — $52.00"), checked "Delivery", and wrote the address into Notes.
- Saw: A red banner "No pricing rule for this location — tax, gratuity, and service charge stay $0 until one is set in Admin." even after switching to P Street. Adding a package auto-inserted a line item labeled "Choose your subs (×8)" (for the 16 pc platter) or "Choose your sub" (for the Full Lunch) with the quantity pre-filled but the Unit price field left BLANK — the package's listed price ($115.00 / $19.99) did not carry over, so I typed it in myself. Adding the à la carte item, by contrast, auto-filled both description "Case of Assorted Chips (24)" AND unit price "52" correctly. Checking "Delivery" revealed a "Delivery zone" field whose only option was "None" (no zones configured for P Street). Subtotal and Total both read "$187.03".
- Shot: img/catering/08-quote-builder-full.png
- Confused: Selecting a package from "Add package" does not price the line item the way selecting an à la carte item does — the manager has to know the package's listed price and type it in manually, or the quote silently totals to less than intended.
- Bug?: Red validation-style banner "No pricing rule for this location — tax, gratuity, and service charge stay $0 until one is set in Admin." appears for P Street (Marcus's own location), meaning tax/gratuity/service charge are not being calculated on any quote built here.

## Step 09 — quote-totals
- URL: /catering/quotes
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Cropped shot of just the totals block after entering all line items.
- Saw: "Subtotal $187.03" and, in bold, "Total $187.03" — total equals subtotal because tax/gratuity/service charge are $0 (no pricing rule, per Step 08).
- Shot: img/catering/09-quote-totals.png

## Step 10 — quote-save-error
- URL: /catering/quotes
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Clicked "Save draft".
- Saw: A red line of text appeared under the totals: "Something went wrong. Please try again." Tried unchecking Delivery and retrying, then clearing the Pipeline lead field and retrying — both retries showed the same error. Browser console confirmed three consecutive 500 Internal Server Errors from POST /api/catering/quotes.
- Shot: img/catering/10-quote-save-error.png
- Bug?: "Save draft" shows "Something went wrong. Please try again." (server 500) on every attempt, but navigating back to the quotes list afterward showed the draft HAD been saved each time — three retries created three duplicate $187.03 drafts for the same lead. The error message is false/misleading and the retry-on-error path silently creates duplicates instead of failing cleanly.

## Step 11 — quotes-list-after-save
- URL: /catering/quotes
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Navigated back to the quotes list after the three "failed" save attempts.
- Saw: Heading "draft · 3" — three separate quote cards, each "$187.03", "2026-09-18 · 25 covers", status pill "draft".
- Shot: img/catering/11-quotes-list-after-save.png

## Step 12 — quote-detail-draft
- URL: /catering/quotes
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Clicked the first of the three draft quotes to open its detail view.
- Saw: Status pill "DRAFT", "$187.03", "2026-09-18 · 25 covers", "Expires: Tue, Sep 22". A "LINE ITEMS" section header with nothing listed under it (no line rows shown despite a nonzero subtotal). "Subtotal $187.03" / "Total $187.03". Buttons "SEND QUOTE", "Revise", "Print labels".
- Shot: img/catering/12-quote-detail-draft.png
- Bug?: The quote detail view's "Line items" section renders no line rows at all (the three items I added — two "Choose your sub(s)" lines and the chips case — don't display here), even though the dollar totals below it are correct.

## Step 13 — quote-send-password-stepup
- URL: /catering/quotes
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Clicked "Send quote".
- Saw: A modal dialog titled "Confirm your password" with body text "Re-enter your password to confirm this action.", a "Password" field, and buttons "Confirm" / "Cancel".
- Shot: img/catering/13-quote-send-password-stepup.png

## Step 14 — quote-sent
- URL: /catering/quotes
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Entered the password and clicked "Confirm".
- Saw: Status pill changed to "sent". Message: "Quote marked sent. No customer email on file, so nothing was emailed." (this is despite having typed "erin.walsh@hillstaffers.com" into Client email during the builder step). New buttons appeared: "Resend", "Revise", "Mark accepted", "Mark declined", "Print labels".
- Shot: img/catering/14-quote-sent.png
- Confused: The quote says "No customer email on file" right after I entered a client email while building it — unclear whether that email never saved, or whether "on file" refers to a separate customer record the quote doesn't yet link to.

## Step 15 — quote-label
- URL: /catering/quotes/45f0093d-a231-4aff-98a6-d553b09e2ccc/label
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Clicked "Print labels" (opened in a new tab).
- Saw: Heading "Food Labels", subtext "Print allergen labels for this quote's items.", a "Print" button — and nothing else. The page body below the header is entirely blank; no labels rendered for any of the quote's three line items.
- Shot: img/catering/15-quote-label.png
- Bug?: The label page shows no labels at all for a sent quote with three line items — likely because the manually-priced "Choose your sub(s)" lines aren't linked to catalog items with allergen data, but the page gives no explanation and just renders empty.

## Step 16 — customers-list
- URL: /catering/customers
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Navigated to Catering Customers.
- Saw: Heading "Catering Customers", subtext "Customer directory grouped by company, with lead and order history." A "+ Add customer" button, and one group heading "Hill Staffers LLC" containing "Erin Walsh · erin.walsh@hillstaffers.com" — the customer record the quote builder created.
- Shot: img/catering/16-customers-list.png

## Step 17 — customer-detail
- URL: /catering/customers
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Clicked the Erin Walsh row to expand it.
- Saw: Two columns, "Pipeline" — "None yet." and "Orders" — "None yet." — plus "Edit" and "Deactivate" buttons.
- Shot: img/catering/17-customer-detail.png
- Confused: Erin Walsh has an active pipeline lead (Step 06) and three sent quotes (Steps 11-14), but her customer record shows "None yet." under both Pipeline and Orders — the customer directory doesn't appear to be linked to the pipeline lead or the quotes I just built for her.

## Step 18 — companies-list-empty
- URL: /catering/companies
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Navigated to Catering Companies.
- Saw: Heading "Catering Companies", subtext "Company accounts — corporate domains auto-attribute contacts; an account can later be claimed via portal sign-up." A "New company" button and the message "No company accounts yet." — even though the customer list (Step 16) already showed a "Hill Staffers LLC" grouping heading, that grouping is evidently just the free-text Company field, not a real company account here.
- Shot: img/catering/18-companies-list-empty.png

## Step 19 — new-company-form
- URL: /catering/companies
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Since there were no company accounts yet, clicked "New company" and filled Company name "Hill Staffers LLC", Corporate domain "hillstaffers.com".
- Saw: Fields "Company name" and "Corporate domain (optional)" with helper text "Emails from this domain auto-attribute to this company. Personal domains (gmail, etc.) can't be used — attach those contacts by hand." Buttons "Create" / "Cancel".
- Shot: img/catering/19-new-company-form.png

## Step 20 — company-detail
- URL: /catering/companies
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Clicked "Create", then clicked the new "Hill Staffers LLC" row to expand it.
- Saw: "Auto-attribution domains" heading listing "hillstaffers.com" with a "Remove domain" (×) control and a field to add another domain. "Contacts" heading with "No contacts attributed yet." and a field "Attach an existing contact by email — for personal-email clients that can't auto-attribute."
- Shot: img/catering/20-company-detail.png
- Confused: Erin Walsh's email (erin.walsh@hillstaffers.com) matches the domain I just added, but she still shows "No contacts attributed yet." — auto-attribution doesn't appear to run retroactively on domains added after the customer already existed.

## Step 21 — insights-full
- URL: /catering/insights
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Navigated to Catering Insights (default range "This month").
- Saw: Heading "Catering Insights", subtext "Leads, booked catering and feedback — by week, month, 30 days or all time." Range toggle buttons "This week" / "This month" (pressed) / "Last 30 days" / "All time". Stat tiles: "New leads" 7, "Booked events" 5, "Confirmed (upcoming)" $3,386.57 (5 events), "Completed" $0.00 (0 events), "Win rate" 80%, "Lost" 1, "Avg. headcount" 23, "Open pipeline" $900.00. Caption: "Money counts by event date; leads count by the day they arrived." Collapsible sections "Leads by source" (5 sources), "Events by stage" (8 events), and an expanded "Booked catering calendar" (6 booked) with a legend (Confirmed / Out for delivery / Completed) and a September 2026 month grid with dots on Aug 31, Sep 5, Sep 6, and Sep 11; selected day Tue, Sep 8 read "No booked catering this day." A "Customer feedback" section read "No feedback yet."
- Shot: img/catering/21-insights-full.png

## Step 22 — order-landing
- URL: /order
- Persona / viewport: logged out / 1280x800
- Action: Signed out via the user menu ("Sign out" menuitem), then navigated to /order.
- Saw: The public storefront: banner "Compliments Only" with "Menu" and "Sign in" links, hero "Where every bite deserves a compliment." with subtext "Chef-inspired subs and house-made ingredients, built the morning of your event and delivered on time — for 10 to 500." and buttons "Start your order" / "See the menu". Below: "Serves 4–500 • Delivery or free pickup • Built the morning of • Allergens on every item", then platter/lunch-box/footer-sub/à-la-carte/sides/sweets/drinks menu sections.
- Shot: img/catering/22-order-landing.png

## Step 23 — order-start-empty
- URL: /order/start
- Persona / viewport: logged out / 1280x800
- Action: Clicked "Start your order".
- Saw: Heading "Let's cater your event." with an empty form: "Your name", "Email" ("This is your login — we'll email a link to confirm."), "Company (optional)", "Contact phone (optional)", "Event date", "Guests" (defaulted to 20), "Event / order name (optional)", "Event type / occasion (optional)", "Time window (optional)", "Delivery or pickup?" toggle (delivery/pickup), "Nearest shop" toggle (Capitol Hill/P Street), "Delivery address", "Preferred drop-off door (optional)", "Dietary & allergen notes (optional)". A disabled "Continue →" button, "Ordered with us before? Sign in", a tip "💡 Good to know — New here? Order for your best-guess headcount — we confirm the final count with you.", and footer text "No passwords to remember — your email is your account."
- Shot: img/catering/23-order-start-empty.png

## Step 24 — order-start-filled
- URL: /order/start
- Persona / viewport: logged out / 1280x800
- Action: Filled the form with fake values: Your name "Jordan Blake", Email "jordan.blake@hillstaffers.com", Company "Hill Staffers LLC", Contact phone "(202) 555-0142", Event date 2026-09-18, Guests 25, Event/order name "Friday Office Lunch", Event type "Corporate", Time window "12:00-12:30 PM", Nearest shop "P Street", Delivery address "1200 Pennsylvania Ave NW, Washington, DC 20004", Preferred drop-off door "Front desk". Left "Delivery or pickup?" on its default "delivery".
- Saw: All fields populated as entered; "Continue →" became enabled once required fields were filled.
- Shot: img/catering/24-order-start-filled.png

## Step 25 — order-check-email
- URL: /order/start
- Persona / viewport: logged out / 1280x800
- Action: Clicked "Continue →".
- Saw: The page swapped to a confirmation screen (same URL, /order/start): "✉️ Check your email" — "We sent a link to jordan.blake@hillstaffers.com to confirm your order and set up your account. Click it and you'll pick up right where you left off." and "The link works once and expires in 30 minutes."
- Shot: img/catering/25-order-check-email.png
- Confused: The walk expected a straight-through /order/start → /order/build → /order/review → /order/verify flow, but the real flow gates on a magic-link email between "start" and "build" — there is no way to proceed to /order/build without clicking a real emailed link, which this sim environment doesn't deliver anywhere reachable from the browser.

## Step 26 — order-build-blocked
- URL: /order/build
- Persona / viewport: logged out / 1280x800
- Action: Navigated directly to /order/build to see if a session already existed.
- Saw: Heading "Start your order" (not the build screen) with message "We couldn't find an order to build. Start a new one and we'll email you a link to pick up right where you left off." and a "Start your order →" link back to /order/start.
- Shot: img/catering/26-order-build-blocked.png
- BLOCKED goal 6 (order/build, order/review): could not reach the actual builder or review screens — they require a confirmed session from clicking the real magic-link email, which isn't deliverable/clickable in this browser session. Tried: (1) direct navigation to /order/build — blocked with "couldn't find an order to build"; (2) direct navigation to /order/review — silently redirected back to a blank /order/start form; (3) direct navigation to /order/account — redirected to /order/start. No dev/sim bypass for the email step was found.

## Step 27 — order-verify-link-expired
- URL: /order/verify
- Persona / viewport: logged out / 1280x800
- Action: Navigated directly to /order/verify (no token) to see what the verification step asks for.
- Saw: "🔗 Link expired" — "This link has expired, was already used, or was replaced by a newer one. Only your most recent link works, and links expire after 30 minutes." with a "Request a new link →" link back to /order/start, and footer "No passwords to remember — your email is your account." Did NOT click "Request a new link" (would trigger a new email). /order/verify does not ask the customer to type anything — it only reads a token from the emailed link's URL; with no valid token it always shows this expired-link message.
- Shot: img/catering/27-order-verify-link-expired.png

## Step 28 — pipeline-after-funnel
- URL: /catering/pipeline
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Logged back in as Marcus Webb (P Street → General Manager → Marcus Webb → PIN 9999) and reopened the pipeline to check for the "Jordan Blake / Hill Staffers LLC" funnel submission from Step 24.
- Saw: No "Jordan Blake" card anywhere on the board. Columns unchanged from Step 06 (Inquiry 0, Quote sent 2 — Erin Walsh + Maybe Corp, Confirmed 4, Out for delivery 1, Completed 1, Lost 1). The /order/start submission never became a pipeline lead because the customer never completed the email-verification step.
- Shot: img/catering/28-pipeline-after-funnel.png

## Step 29 — admin-catering-hub
- URL: /admin/catering
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Navigated to /admin/catering (read-only for this goal).
- Saw: Heading "Catering", subtext "Packages, pricing, capacity, delivery zones, and menu FAQ." Link tiles: "Packages", "Catering Menu", "Capacity & Blackouts", "Delivery Zones", "FAQ", "Prep Demand", "LTO & discounts", "Fulfillment Zones", "Catering workspace". No separate "Pricing" or "Rate rules" tile is listed here.
- Shot: img/catering/29-admin-catering-hub.png

## Step 30 — admin-catering-menu
- URL: /admin/catering/menu
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Opened "Catering Menu" (no edits).
- Saw: Heading "Catering Menu", subtext "Flag items available for catering (à la carte) and, optionally, catering-only. Changes need a password step-up." Tabs "Menu" / "Toast". A callout: "How this list works — Toast items come from the store menu and are named in Toast. Catering items exist only here — tubs, cases, waters — and get their sizes and prices here. Rows appear to customers under the same headings you see below, in the same order." Filter buttons "All" / "On menu" / "Hidden" / "Toast items" / "Catering items", a search box, and a "Preview as customer" checkbox. A "Packages" summary row ("16 active", link "Open packages →"). Collapsible category groups: Drinks (21 on the menu of 21), Sides (22 on the menu of 23), Desserts (4 on the menu of 4), Add-ons (1 on the menu of 1), Cooks (1 on the menu of 9), Sauces (0 on the menu of 11), Slicing (0 on the menu of 9), Veg (0 on the menu of 11), Build Your Own (0 on the menu of 9), Gear (0 on the menu of 2), Subs (9 on the menu of 15) — each row shows per-item "Feeds" people count and toggle buttons "On catering menu" / "Catering only" / "Sold by portion".
- Shot: img/catering/30-admin-catering-menu.png

## Step 31 — admin-catering-packages
- URL: /admin/catering/packages
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Opened "Packages" (no edits).
- Saw: Heading "Catering Packages", subtext "Build the catering packages customers can order, with pricing and what's included." An "ADD PACKAGE" button. Packages are duplicated per location (separate "8 pc platter" rows for "P Street" and "Capitol Hill", etc.), each showing "Per platter", price, "Min N people", "24h lead time", "Serves N", item count, with "Edit" / "Deactivate" / "Show details" controls.
- Shot: img/catering/31-admin-catering-packages.png

## Step 32 — admin-catering-zones
- URL: /admin/catering/zones
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Opened "Delivery Zones" (no edits).
- Saw: Heading "Delivery zones", subtext "Per-location delivery zones: fee and minimum order." Two sections, "Capitol Hill (MEP)" and "P Street (EM)", each with an "ADD ZONE" button and the message "No zones yet for this location." This explains why the quote builder's Delivery-zone dropdown only offered "None" and why the "No pricing rule for this location" banner appeared.
- Shot: img/catering/32-admin-catering-zones.png

## Step 33 — admin-catering-fulfillment
- URL: /admin/catering/fulfillment
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Opened "Fulfillment Zones" (no edits).
- Saw: Heading "Fulfillment Zones", subtext "Set each store's delivery zone: drag the pin to center, adjust the radius, and toggle delivery / pickup availability." A "Location" dropdown reading "Capitol Hill — not set", an interactive OpenStreetMap/Leaflet map with a draggable pin and a 5-mile radius circle, a "Delivery radius (miles)" field showing "5", and a checked "Offers delivery" checkbox. This is a distinct concept from "Delivery Zones" (Step 32) — one sets the service radius/pin, the other would set fee/minimum-order zones.
- Shot: img/catering/33-admin-catering-fulfillment.png

## Step 34 — admin-catering-capacity
- URL: /admin/catering/capacity
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Opened "Capacity & Blackouts" (no edits).
- Saw: Heading "Capacity & Blackouts", subtext "Per-location booking caps, lead time, and blackout dates." Both "Capitol Hill" and "P Street" show a "NOT CONFIGURED" pill, "Max covers per day: No cap · Max events per day: No cap · Minimum lead time (hours): No cap", a "Configure" button, "Blackout dates — No blackout dates.", and a Date + Reason (optional) row with an "ADD BLACKOUT" button.
- Shot: img/catering/34-admin-catering-capacity.png

## Step 35 — admin-catering-faq
- URL: /admin/catering/faq
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Opened "FAQ" (no edits).
- Saw: Heading "Catering FAQ", subtext "Manage frequently asked questions shown to catering clients." An "ADD FAQ" button and "No FAQs yet. Add one above."
- Shot: img/catering/35-admin-catering-faq.png

## Step 36 — admin-catering-lto
- URL: /admin/catering/lto
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Opened "LTO & discounts" (no edits).
- Saw: Heading "Surplus → LTO / discount", subtext "Turn surplus into a featured LTO or a discount." Location dropdown "Capitol Hill". Two panels: "Surplus available to promote" — "No perishable surplus to act on." and "LTOs & discounts" — "No LTOs or discounts yet."
- Shot: img/catering/36-admin-catering-lto.png

## Step 37 — admin-catering-prep-demand
- URL: /admin/catering/prep-demand
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Opened "Prep Demand" (no edits).
- Saw: Heading "Catering Prep Demand", subtext "Upcoming prep required by confirmed catering leads, with over-par alerts for the next 14 days." Location "Capitol Hill", date range "Tue, Sep 8 – Tue, Sep 22". Tabs "Prep" (selected) / "Raw / SKU" / "Surplus" / "Sales". Body: "No upcoming catering prep demand for this location."
- Shot: img/catering/37-admin-catering-prep-demand.png
- BLOCKED goal 7 (pricing, rate-rules): the admin catering hub (Step 29) has no "Pricing" or "Rate rules" tile, and direct navigation to both /admin/catering/pricing and /admin/catering/rate-rules silently redirected to /dashboard rather than showing a page or a 404 — these two named admin surfaces don't exist as separate routes in this build. (The pricing-rule concept itself is visible only indirectly, via the quote builder's "No pricing rule for this location" banner from Step 08.)

## Step 38 — pipeline-source-badges
- URL: /catering/pipeline
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Reopened the pipeline board and looked for leads with an EZCater or Toast source badge.
- Saw: PRESENT. In "Confirmed": "EZCater order SIM2" tagged "EZCater" ($1,209.93, Sun Sep 6, 40 ppl) and "Nav Gill" tagged "Toast catering" ($289.48, Sat Sep 5, 12 ppl). In "Out for delivery": "EZCater order SIM1" tagged "EZCater" ($1,021.80, Sat Sep 5, 24 ppl). The Source filter dropdown also lists "Toast catering" and "EZCater" as selectable values alongside "Online portal", "Staff entered", "Phone", "Walk-in", "Direct invoice", "Other".
- Shot: img/catering/38-pipeline-source-badges.png

## Step 39 — logged-out
- URL: /
- Persona / viewport: logged out / 1280x800
- Action: Opened the user menu and clicked "Sign out".
- Saw: Returned to the location-tile screen: "Compliments Only", "Operations", "Manager login →", heading "Where are you?" with tiles "Capitol Hill" (MEP) and "P Street" (EM).
- Shot: img/catering/39-logged-out.png

# Supplement B — quote builder re-shoot (Marcus Webb, 2026-09-08)

## Step 40 — new-quote-form-filled
- URL: /catering/quotes
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Logged in fresh (P Street → General Manager → Marcus Webb → PIN 9999; carried over from Supplement A's session), opened /catering/quotes, clicked "New quote", set Location to "P Street", Pipeline lead to the existing "Erin Walsh · Hill Staffers LLC", and typed Client email "erin.walsh@hillstaffers.com", Client name "Erin Walsh", Company "Hill Staffers LLC", Event date "2026-09-18", Headcount "25".
- Saw: The "New quote" panel with every field holding the typed value; picking the pipeline lead did NOT auto-fill client email/name/company — those still had to be typed by hand.
- Confused: The Client email field is a combobox (has a dropdown arrow) but accepted free-typed text with no visible suggestion list.
- Shot: img/catering/40-new-quote-form-filled.png

## Step 41 — quote-builder-with-lines
- URL: /catering/quotes
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: From "Add package" selected "16 pc platter — $115.00" (auto-inserted a "Choose your subs (×8)" line, Qty 8, Unit price blank) and typed 115 into its Unit price; then selected "Full Lunch — $19.99" (auto-inserted a second "Choose your sub" line, Qty 1, Unit price blank) and typed 19.99 into its Unit price; then from "Add à la carte" selected "Napkins & Utensils — $20.00" only (no other à-la-carte item touched); then ticked "Delivery" (a "Delivery zone" dropdown appeared, left at "None").
- Saw: Three line-item rows — "Choose your subs (×8)" qty 8 @ 115, "Choose your sub" qty 1 @ 19.99, "Napkins & Utensils" qty 1 @ 20 — sitting above the package/à-la-carte pickers and the now-checked Delivery box.
- Confused: The "Choose your subs (×8)" line prices as Unit price × Qty (115 × 8 = $920), not as a flat $115 package price — typing the package's listed price into Unit price the way the task described inflates that line to 8× the sticker price.
- Shot: img/catering/41-quote-builder-with-lines.png

## Step 42 — quote-totals-area
- URL: /catering/quotes
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Scrolled to the bottom of the builder to read the totals block.
- Saw: "Subtotal $959.99" / "Tax $96.00" / "Total $1,055.99" / "Deposit due $264.00" — a tax line now renders (it did not in the earlier Capitol Hill attempt, which banner-warned "No pricing rule for this location"), computed at 10% of subtotal ($96.00 on $959.99, rounded). No gratuity line and no separate service-charge line appear anywhere in the totals block.
- Shot: img/catering/42-quote-totals-area.png

## Step 43 — quote-saved-draft-detail
- URL: /catering/quotes
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Clicked "Save draft".
- Saw: The draft saved on the FIRST TRY with no error — the screen swapped straight from the builder to the quote's own detail view: a "draft" status label, "$1,055.99" / "2026-09-18 · 25 covers" / "Expires: Tue, Sep 22", a "Line items" list already showing all three rows with their prices, the same Subtotal/Tax/Total/Deposit-due block, and three actions — "Send quote", "Revise", "Print labels". There was no separate toast or banner reading "saved" — landing on this detail page WAS the success signal.
- Shot: img/catering/43-quote-saved-draft-detail.png

## Step 44 — quote-detail-line-items
- URL: /catering/quotes
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Navigated back to /catering/quotes, found the new "$1,055.99 · 2026-09-18 · 25 covers · draft" tile under "draft · 3", and clicked it to reopen the saved quote's detail.
- Saw: A "DRAFT" status pill at the top right, and the "Line items" section listing "Choose your subs (×8) × 8 — $920.00", "Choose your sub × 1 — $19.99", "Napkins & Utensils × 1 — $20.00" — confirming the rows persisted correctly after the save/reload round-trip.
- Shot: img/catering/44-quote-detail-line-items.png

## Step 45 — send-quote-password-stepup
- URL: /catering/quotes
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Clicked "Send quote".
- Saw: A dialog headed "Confirm your password" with body "Re-enter your password to confirm this action." and a single Password field with "Confirm" / "Cancel" buttons — a password step-up, not a PIN pad (unlike the closing checklist's confirm in Supplement A).
- Shot: img/catering/45-send-quote-password-stepup.png

## Step 46 — quote-sent-state
- URL: /catering/quotes
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Typed the password "sim-marcus-pw" and clicked "Confirm".
- Saw: The status pill flipped to "sent" and a line appeared reading exactly: "Quote marked sent. No customer email on file, so nothing was emailed." The action buttons changed to "Resend", "Revise", "Mark accepted", "Mark declined", "Print labels".
- Bug?: The quote WAS built with a client email ("erin.walsh@hillstaffers.com" typed into the builder's Client email field in Step 40), yet the send confirmation claims no customer email is on file — the typed email evidently isn't being read as "on file" for the send-notification check, or it lives on a different record (e.g. a customer/company row) than the one this check reads.
- Shot: img/catering/46-quote-sent-state.png

## Step 47 — quote-label-page
- URL: /catering/quotes/fdd2b4fa-5aed-499e-84a5-d0c665aa50b0/label
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Clicked "Print labels" (opened in a new tab) and switched to it.
- Saw: Heading "Food Labels" / "Print allergen labels for this quote's items." with a "Print" button, and one label block per line item — "Choose your subs (×8)" Qty 8, "Choose your sub" Qty 1, "Napkins & Utensils" Qty 1 — each carrying "⚠ Allergen info not on file — verify before serving."
- Shot: img/catering/47-quote-label-page.png

## Step 48 — pipeline-hillstaffers-quotesent
- URL: /catering/pipeline
- Persona / viewport: Marcus Webb, General Manager / 1280x800
- Action: Closed the label tab and opened /catering/pipeline to find the Hill Staffers lead.
- Saw: The lead now sits under "Quote sent · 2" as "Erin Walsh / Hill Staffers LLC / Fri, Sep 18 / 25 ppl / Phone / @Marcus Webb" — moved into the Quote-sent column with an owner badge, but (unlike its column-mate "Maybe Corp … $900.00") it carries NO dollar-amount badge, even though the quote behind it totals $1,055.99.
- Confused: Why the Erin Walsh card shows no price chip while the other "Quote sent" card does — possibly because this lead's quote total is read from the pipeline lead's own stored value rather than the just-sent quote, and that field was never populated by this flow.
- Shot: img/catering/48-pipeline-hillstaffers-quotesent.png

## Step 49 — logged-out
- URL: /
- Persona / viewport: logged out / 1280x800
- Action: Opened the user menu and clicked "Sign out".
- Saw: Returned to the location-tile screen — "Compliments Only" / "Operations" / "Manager login →" and "Where are you?" with tiles "Capitol Hill" (MEP) and "P Street" (EM).
- Shot: img/catering/49-logged-out.png
