<!-- tester glm/glm-5.3 · session glm-catering-r1 · 232 actions · 1402s -->
# Report — glm — catering guide
Model I am: GLM-4.6 (run glm-catering-r1)

## Goals
| # | Goal | Result (done / partly / stuck) | Actions used |
|---|---|---|---|
| 1 | Log in and open catering | done | ~16 (PIN keypad rejected my correct PIN twice; "Use system keyboard" + typing 9999 worked) |
| 2 | Add Hill Staffers Glm R1 LLC as new lead (25 people next Friday, vegetarian note) | done | ~15 |
| 3 | Make a quote from a package, tied to their lead | done | ~26 |
| 4 | Move the lead forward so the kitchen plans the food | done | ~7 (Confirmed; verified in Prep Demand: Oct 23 prep now listed for P Street) |
| 5 | Find the catering orders that came in from ezCater | stuck (no ezCater data exists anywhere in the practice copy) | ~40 |
| 6 | Find catering customers list and open one | done | ~5 |
| 7 | Check this month's catering numbers | done | ~4 |
| 8 | Find where catering is set up (look only) | done | ~5 (viewed Packages; changed nothing) |

## Where I got stuck

**Goal 5 — ezCater orders (stuck).**
Screens tried:
- `/catering/pipeline` — "Catering Pipeline", set **Source** to **EZCater**: every column showed **0 / None**. I proved the filter itself works: Source = Staff entered → 10 leads; Source = Phone → 0. So there are simply no EZCater leads.
- Same page, scrolled top to bottom looking for the **Not in Toast yet** panel — it is not on the page at all.
- `/reports/sales/catering` — "Catering sales", for **both** P Street and Capitol Hill, for ranges Last 7 days, This month and Last 12 months: "**ezCater orders: 0 · $0.00**", Matched in Toast 0, Not in Toast 0, Amount does not match 0.
- `/mid-shift?location=…` — "Mid-shift Pulse" for both shops, Catering section: "NOT RUNG INTO TOAST: Every ezCater order is in Toast", "No catering due today / Tomorrow: no catering booked".

What the guide said that misled me / was missing: under the heading **"ezCater orders" → "Find an ezCater order"**, the guide's "Worth knowing" admits: *"This is not shown in photos. Our practice board had no ezCater orders."* The guide only documents two places to see ezCater orders (the Pipeline Source filter and the "Not in Toast yet" panel, which *"shows only when there is an order to list"*), plus the counts on Catering sales. With all of those empty, a new manager cannot tell "there are no ezCater orders" from "I'm looking in the wrong place." The guide needs one sentence like: "If the EZCater filter and Sales page both show none, there are no ezCater orders yet" — and the practice copy should be seeded with 1–2 ezCater orders so the filter and the panel can actually be practiced.

**Goal 1 friction (done, but worth recording):** on `/` ("Enter your 4-digit PIN") I tapped 9-9-9-9 on the on-screen keypad twice and got **"Wrong PIN. Try again."** both times, even though my PIN is 9999. Only **Use system keyboard** → typing 9999 logged me in. The guide's **"Log in"** section documents only the keypad (*"Tap your 4-digit PIN. There is no button to press after it. The last digit logs you in."*) and never mentions the system-keyboard fallback.

## Notes for the team
- What would make the guide better:
  - Add the "Use system keyboard" fallback to **Log in** — I needed it when the keypad kept rejecting a correct PIN.
  - In **Add a lead**, warn that the board may not refresh right after tapping **Add** — my Inquiry column still said "0 / None" until I searched and came back, yet the guide says *"The new card in Inquiry is your sign that it worked."*
  - In **Start a quote**, warn that the **Pipeline lead** dropdown shows only "contact · company" — with two same-named leads (an earlier session had already created a "Hill Staffers Glm R1 LLC" lead) they are indistinguishable. Suggest telling readers to verify afterwards: the Pipeline **Search** results show each lead's Quote status, which is how I confirmed I tied the quote to the right lead.
  - In **Prep Demand**, mention the page can take a moment to re-render after switching **Location** (it briefly showed "No upcoming catering prep demand" for P Street before showing the Oct 23 prep).
  - The ezCater section (see above): explain what "no results" means, and seed the practice data.
- What is hard in the app for no reason:
  - The app opens on Capitol Hill even when you log in as the P Street GM, and the shop context silently reverted to Capitol Hill more than once.
  - The Add lead form has no phone or email box, and you can never add a note to a lead later — one chance to capture what the client said.
  - Stage moves are one tap with no confirmation and Completed/Lost are final.
  - Identical labels in the **Pipeline lead** dropdown when two leads share a name.
  - The Capitol Hill / P Street tabs on the Sales and Pulse pages needed two taps before they switched.
- Steps that confused me even when the guide was right:
  - "**Qty** never follows the headcount": the guide is right, but "a package for 25 people" still fights with "package Qty = 1" in your head.
  - The amber "Order comparison is currently unavailable" line appears on every lead you type in — the guide says ignore it, but it reads like an error you should fix.
  - "**No caps set**" on the lead card is accurate but looks like something is wrong with my lead.
- Anything that looked broken:
  - The on-screen PIN keypad rejecting a correct PIN (twice).
  - The board not refreshing immediately after **Add lead**.
  - The dashboard shop switcher: my first "EM · P STREET" tap didn't change TODAY'S OPERATIONS; tapping the control by number did.
  - Prep Demand briefly showing stale "Capitol Hill" / empty data after switching Location to P Street.
  - Leftover state from earlier sessions of this same task sat on the board (a "Hill Staffers Glm R1 LLC" lead already Confirmed with a $330 draft quote, plus an accepted $562.93 quote). I followed my instructions and added the lead fresh, but then had to work around two identically-named leads. Other sessions' leads also kept appearing mid-task.

## The 5 best things CO-OPS does for a restaurant
1. **The Catering Pipeline board** — one board with every lead in stage columns (Inquiry → Quote sent → Confirmed → Out for delivery → Completed / Lost), filterable by person and source, searchable by name/company/phone. It answers "what catering jobs exist and where is each one?" at a glance, and moving a job forward is one tap with no forms.
2. **The quote builder with packages** — pick "Full Lunch" and the lines, unit prices, subtotal, tax, total and deposit drop in; totals update as you type, and à la carte items (e.g. House Greek Salad for the vegetarian ask) add in one pick. It turns a phone call into an accurate priced quote in about a minute, with no math and no guessing prices.
3. **Prep Demand** — when a lead with a tied, dated quote moves to Confirmed, the kitchen's next-14-days prep list builds itself (my confirmed Oct 23 job immediately showed "2 × House Greek Salad" and sub prep for P Street). The kitchen learns about catering work without anyone hand-carrying a paper.
4. **Catering Insights** — week / month / 30-day / all-time tiles for new leads, booked events, confirmed upcoming money, completed money, win rate, average headcount, plus a booked-days calendar. In two taps I answered "how is catering doing this month?" with real numbers (10 leads, 9 booked, $562.93 confirmed upcoming).
5. **The Catering Customers directory** — people grouped by company, with saved contact details and a per-person Pipeline/Orders history, and a customer record appears automatically when you save a quote with their email (the earlier session's quote created the events@hillstaffersglmr1.com entry). The shop builds a repeat-customer list just by doing its everyday quoting.
