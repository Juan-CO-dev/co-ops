<!-- tester glm/glm-5.3-flash · session glmflash-catering-r1 · 143 actions · 857s -->
# Report — glmflash — catering guide
Model I am: GLM (glmflash-catering-r1 run)

## Goals
| # | Goal | Result (done / partly / stuck) | Actions used |
|---|---|---|---|
| 1 | Log in and open catering | done | ~16 (on-screen PIN keypad never registered; "Use system keyboard" worked) |
| 2 | Add Hill Staffers Glmflash R1 LLC as a lead (25 ppl, next Friday, vegetarian note) | done | ~11 |
| 3 | Quote from a package tied to their lead | done | ~15 (Full Lunch ×25 @ $19.99 + Greek Salad; Pipeline lead selected; draft $562.93, deposit due $140.73) |
| 4 | Move the lead forward so the kitchen plans the food | done | ~12 (sent quote w/ password check, marked accepted, moved lead to Confirmed) |
| 5 | Find the catering orders from ezCater | partly — searched properly; there are none | ~14 (Source=EZCater on both shops: all columns "None"; no "Not in Toast yet" panel; Catering sales: "0 ezCater orders · $0.00") |
| 6 | Find the catering customers list and open one | done | ~7 (opened my new contact; grouped under its company exactly as the guide says) |
| 7 | Check this month's catering numbers | done | ~5 (Insights → This month: 6 leads, 5 booked, $562.93 confirmed upcoming, Fri Oct 23 has 4 booked) |
| 8 | Find where catering is set up (look only) | done | ~4 (/admin/catering tiles + Packages page viewed; nothing changed) |

## Where I got stuck
**Goal 5 (ezCater orders) — nothing to find.**
- Screen: `/catering/pipeline`, heading "Catering Pipeline", and `/reports/sales/catering`, heading "Catering sales".
- What I tried: set **Source** to **EZCater** on the pipeline at P Street, then switched shops to Capitol Hill and did it again (both times every column read **None**); looked for the **Not in Toast yet** panel (never appears); opened **Catering sales**, which reads "0 ezCater orders · $0.00 — Matched in Toast: 0, Not in Toast: 0, Amount does not match: 0; ezCater orders in this range: Nothing in this range."
- The guide didn't mislead me — under "Find an ezCater order" it honestly says *"This is not shown in photos. Our practice board had no ezCater orders."* This run's practice data also has none, so the goal can't be completed; I verified it from both places the guide points to.

## Notes for the team
- **What would make the guide better:**
  - Under "Log in": warn that the on-screen keypad may not respond to taps and that **Use system keyboard** is the reliable path. I burned ~6 actions on "Wrong PIN. Try again." with the correct PIN.
  - Under "Find an ezCater order": one more line — "if the filter shows None on both shops and Catering sales shows 0 orders, there are none in this copy" — would save the double-shop hunt I did.
  - Under "Get to catering" / "Read the board": the pipeline board shows **no shop name anywhere**. Tell readers how to tell which shop they're on (the URL `?location=…` is the only clue I found).
- **What is hard in the app for no reason:**
  - No shop indicator on the Catering Pipeline/Quotes/Insights pages; you can't confirm which shop you're pricing for.
  - The dashboard's "TODAY'S OPERATIONS" label kept saying **Capitol Hill** even after I switched to P Street; it looks stale, and the shop-switch buttons intermittently time out on first click.
  - The lead card can't take a note later, and Add lead has no phone/email boxes (the guide admits both, but it's still awkward).
  - The saved quote page doesn't show the client's name or email, and the deposit rate is never shown — you can't sanity-check the deposit math.
- **Steps that confused me even when the guide was right:**
  - "The last digit logs you in" — true only via the system keyboard; keypad taps did nothing.
  - The **Insights** range row has **All time** where I expected nothing — I tapped the wrong control once.
  - The amber "Order comparison is currently unavailable." line on my typed lead is scary the first time; the guide's "Ignore it" is what kept me moving.
  - First click after a navigation often times out; a retry always worked.
- **Anything that looked broken:** on-screen PIN keypad (no response); dashboard shop-switcher first-click timeouts; quote emails never deliver ("the email could not be delivered" — expected in a practice copy, and the guide's instruction to hand-send the price and tell the GM covered it).

## The 5 best things CO-OPS does for a restaurant
1. **Catering Pipeline board** — every lead is a card you can open and move with one tap from Inquiry to Confirmed and on; moving to Confirmed is what tells the kitchen to plan the food. It matters because whoever answers the phone can run a whole job from one board without asking anyone.
2. **Quote builder tied to the lead** — pick a package and it drops in as priced lines, totals/tax/deposit update live, and the quote is linked to the lead so the kitchen plans from the right numbers. It matters because pricing a 25-person lunch takes a minute, not a spreadsheet, and the money is right.
3. **Catering Customers roll-up** — saving a quote with a client email puts that person in the directory grouped under their company automatically (I watched my new client appear there). It matters because repeat office buyers are your best catering revenue and no one has to re-type who they are.
4. **Catering Insights money by event date** — one page splits Confirmed (upcoming) / Completed / Open pipeline, counts booked events, and dots a calendar by day (my accepted $562.93 job showed up immediately under This month, Fri Oct 23 already carrying 4 bookings). It matters because you can see next Friday's load before you promise another one.
5. **ezCater tracking end to end** — orders come in on their own, the pipeline has an EZCater source filter, and Catering sales counts Matched in Toast / Not in Toast / Amount does not match. It matters because third-party orders are easy to forget at the register, and this makes the missed ones visible instead of discovered at the end of the week.
