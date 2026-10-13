# Report — opus — catering guide
Model I am: Claude Opus 5.5 (claude-opus-5-5)

## Goals
| # | Goal | Result (done / partly / stuck) | Actions used |
|---|---|---|---|
| 1 | Log in and open catering | done | 10 |
| 2 | Add Hill Staffers Opus R1 LLC as a lead (25 ppl, next Friday, vegetarian note) | done | 11 |
| 3 | Quote from a package, tied to the lead | done | 16 |
| 4 | They said yes: move the lead so the kitchen plans the food | done | 6 (4 to move it, 2 to check Prep Demand) |
| 5 | Find the catering orders that came in from ezCater | partly | 9 |
| 6 | Find the list of catering customers and open one | done | 4 |
| 7 | Check this month's catering numbers | done | 3 |
| 8 | Find where catering is set up (look only) | done | 2 |

Actions count taps, types and scrolls. They do not count `look`.

What I did, briefly:
- **Goal 2:** I added the lead with contact "Opus R1 Contact", company "Hill Staffers Opus R1 LLC", event date Fri Oct 23 2026, headcount 25, order lead Marcus Webb, location P Street. The note says "Lunch for 25 people next Friday. They want vegetarian options." The card appeared in Inquiry with the note.
  - Today in the app is Tue Oct 13, so "next Friday" could mean Oct 16 or Oct 23. I used Oct 23.
- **Goal 3:** I built the quote on P Street, Oct 23, 25 people, with a made-up test email, and set Pipeline lead to this lead. I used the Light Lunch package with Qty 25, plus "Choose your sub" at 25, and added a vegetarian note.
  - Saved draft: Subtotal $300.00, Tax $30.00, Total $330.00, Deposit due $82.50, expires Tue Oct 27.
- **Goal 4:** I tapped Move to > Confirmed. The lead moved to Confirmed.
  - Admin > Catering > Prep Demand (P Street) then listed "Fri, Oct 23 · 1 items · Choose your sub · NEEDS PICK".
- **Goal 7:** I picked This month in Catering Insights. It shows 5 new leads, 3 booked events, Confirmed (upcoming) $0.00 for 3 events, Completed $0.00, win rate 100%, average headcount 25, Open pipeline $0.00. The calendar has dots on Oct 16 and Oct 23.
- **Goal 8:** Admin & setup opened /admin/catering. The tiles were Packages, Catering Menu, Capacity & Blackouts, Delivery Zones, FAQ, Prep Demand, LTO & discounts, Fulfillment Zones and Catering workspace. This matches the guide's GM table. I changed nothing.

## Where I got stuck

**Goal 5 — ezCater orders (partly)**
- **Screens:**
  - `/catering/pipeline`, heading "Catering Pipeline", with Source set to EZCater. Every column said "None" and no "Not in Toast yet" panel showed.
  - `/reports/sales/catering`, heading "Catering sales", for P Street over the last 90 days. It said "0 ezCater orders · $0.00", "Matched in Toast: 0 / Not in Toast: 0 / Amount does not match: 0" and "ezCater orders in this range: Nothing in this range."
- **What I tried:** I followed "Find an ezCater order" ("2. Set **Source** to **EZCater**."). Then I checked the GM route in "Sales and catering sales". I found where the orders would be and confirmed there are none. There was no ezCater card to open, so I never saw the "**ezCater order** box".
- **Guide:** under "Find an ezCater order" it says "This is not shown in photos. Our practice board had no ezCater orders." That was accurate.
- **What is missing:** the guide does not say whether the pipeline board shows one shop or both. The board has no shop picker, so I could not tell if Capitol Hill had ezCater orders I wasn't seeing.

**Goal 4 — done, with a gap**
- **The sub choice:** after Confirmed, Prep Demand shows the job as "Choose your sub — NEEDS PICK". "Add packages and items" says the Light Lunch package "also added a 'Choose your sub' line with no price". It never says how to pick the sub, or that the kitchen will see NEEDS PICK until someone does.
- **"They said yes":** the guide never ties this to the quote's status. "Read the saved quote" says "**Mark accepted** and **Mark declined** do not show on a draft". "Catering Insights" says "Only an accepted quote counts in the money tiles."
  - So a manager who just moves the lead to Confirmed, as "Move a lead" says, gets the kitchen plan but $0.00 in Insights.
  - The guide should say: send the quote, then Mark accepted, then move the lead to Confirmed.

## Notes for the team
- **What would make the guide better:**
  - Add an "After they say yes" step list: Send quote → Mark accepted → Move to Confirmed → check Prep Demand. Explain "NEEDS PICK" and how to choose the sub on a Light Lunch quote (Revise?).
  - Say that the new quote form starts with one empty line (Description blank, Qty 1, no price) above any package you add. Remove it with ×, or it may save as an empty line.
  - Say the "No caps set" line and the amber "Order comparison is currently unavailable." line take a second to appear after you open a lead card. My first look at the open card did not have them.
  - Reports Hub has a direct **Catering sales** link under Sales. The guide's route is "Sales → Catering tab".
  - Say whether the pipeline board is per shop or both shops.
- **What is hard in the app for no reason:**
  - The app keeps falling back to Capitol Hill when I logged in as P Street. This happened on the dashboard after login, Reports Hub, Catering sales, the New quote form's Location, and Prep Demand's Location.
  - Twice my first tap on the P Street button (on the dashboard, and on Reports) did not switch shops. I had to tap again.
  - On Insights, the picked range (THIS MONTH) shows only as a black button. Nothing in the text says which range you are looking at.
- **Steps that confused me even when the guide was right:**
  - After the 4th PIN digit, the keypad greys out with no spinner. Then a bare "Loading…" screen shows before the dashboard.
  - On the customer page, Pipeline and Orders both said "None yet." even though this customer has a lead and a quote tied to it. The guide warns about this, but it still looks wrong.
  - On Insights, Confirmed (upcoming) shows "$0.00" next to "3 events", which looks like a bug until you read the guide's accepted-quote rule.
- **Anything that looked broken:**
  - The shop switching above.
  - The hub card says "Leads from inquiry to confirmed." The pipeline page says "from inquiry to completed".
  - "Leads by source 1 sources" (plural with 1).
  - Other testers' leads on the board have the company name typed as the contact name, so the board shows the same text twice. That is data, not the app, but the board does not flag it.

## The 5 best things CO-OPS does for a restaurant
1. **A confirmed lead goes straight into the kitchen's Prep Demand.** Moving the lead to Confirmed put the Oct 23 job on P Street's 14-day prep list. The kitchen sees catering work without anyone re-typing it.
2. **The quote builder prices a package in seconds.** Picking Light Lunch and setting 25 gave Subtotal, Tax, Total and Deposit due live, then saved as a draft with an expiry date. Managers quote the same, correct price every time.
3. **The pipeline board shows every job's stage at a glance and moves it with one tap.** The new lead appeared in Inquiry with its note, and one tap moved it to Confirmed. Nobody loses track of a catering job or who owns it.
4. **Catering Insights shows the month's numbers and a booked calendar.** It gave leads, booked events, win rate and average headcount, with dots on the Oct 16 and Oct 23 job days. The GM can see the month and plan staffing for busy days.
5. **Customers build themselves from quotes.** Saving the quote with an email added the person to Catering Customers, grouped under their company, with no extra form. The shop builds a catering contact list as a side effect of normal work.
