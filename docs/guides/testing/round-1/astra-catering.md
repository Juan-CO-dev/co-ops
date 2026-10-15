<!-- tester codex/gpt-6-astra · session astra-catering-r1 -->
# Report — astra — catering guide
Model I am: GPT-6

## Goals

Actions count includes `look`, taps, typing, scrolling and failed attempts.

| # | Goal | Result (done / partly / stuck) | Actions used |
|---|---|---|---|
| 1 | Log in and open catering | done | 16 |
| 2 | Add Hill Staffers Astra R1 LLC for 25, with vegetarian note | done — P Street, October 16 | 13 |
| 3 | Make a package quote and link the lead | done — 25 Light Lunches, $330 draft | 25 |
| 4 | Move the lead forward for kitchen planning | done — moved to Confirmed with dated quote linked | 8 |
| 5 | Find ezCater orders | partly — found the views; no orders appeared | 16 |
| 6 | Open a catering customer | done — Jordan Sample | 9 |
| 7 | Check this month’s catering numbers | done | 6 |
| 8 | Find catering setup without changes | done | 4 |

## Where I got stuck

**Goal 5:** At `/catering/pipeline`, heading **Catering Pipeline**, I selected **Source → EZCater** and checked the board. Every column showed zero. There was no **Not in Toast yet** panel.

I also checked **Catering sales** at `/reports/sales/catering?location=d2cced11-b167-49fa-bab6-86ec9bf4ff09&range=last7&from=2026-10-07&to=2026-10-13&compare=false`. It showed zero ezCater orders and “Nothing in this range.”

Under **Find an ezCater order**, the guide says: “Tap a card to open it.” There were no cards. Its warning—“Our practice board had no ezCater orders”—was accurate. The practice copy needs a sample order to let a new manager finish this exercise.

## Notes for the team

- **What would make the guide better:** Add a complete lead-to-quote-to-confirmation example, including what to do without a contact name or email, and how to finish the package’s “Choose your sub” line.
- **What is hard in the app for no reason:** Repeatedly selecting P Street; retyping company details after linking a lead; manually changing package quantities to match headcount; identifying quotes whose list shows only price and date.
- **Steps that confused me even when the guide was right:** Confirming the lead leaves the quote in Draft. Jordan’s customer history said “None yet” despite a visible pipeline lead. This month showed 9 booked events but only $562.93 upcoming revenue; the guide explains that draft quotes do not count toward money.
- **Anything that looked broken:** Shop selection reverted to Capitol Hill. A manually entered lead displayed “Order comparison is currently unavailable.” Two package-selection failures came from my command input; correcting it worked, so those were not app defects.

## The 5 best things CO-OPS does for a restaurant

1. **Catering pipeline:** Keeps dates, headcounts, dietary notes, ownership and stage together so managers can track each job.
2. **Package quotes:** Builds priced lines and calculates tax, total and deposit, reducing manual quoting arithmetic.
3. **Monthly catering numbers:** Shows bookings, upcoming money, completed money and average headcount so managers can judge business volume.
4. **Booking calendar:** Marks days with catering events and booking counts, helping managers spot busy days.
5. **Customer directory:** Groups contacts by company and opens their details, helping staff find the right customer quickly.
