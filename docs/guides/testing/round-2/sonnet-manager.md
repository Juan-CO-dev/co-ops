# Report — sonnet — manager guide
Model I am: Sonnet 5.5 (claude-sonnet-5-5)

## Goals
| # | Goal | Result (done / partly / stuck) | Actions used |
|---|---|---|---|
| 1 | Log in | done | ~14 (shop, role, name, 4 PIN taps, plus waiting on "Loading…") |
| 2 | Take the morning report | done (tapped Opening prep on the board) | ~5 |
| 3 | Open the shop: verify, submit Part 1, prep, finish | done. Phase 2 shows "PHASE 2 FINALIZED" | ~170 (long: 10 stations, 8 temps, 38 recount rows, 38 prep rows) |
| 4 | Check in produce delivery with one short item | done (Baldor, Lettuce flagged Short, Onions added, 1 vendor credit opened) | ~14 |
| 5 | Mid-day prep back to par | done ("Finalized — prep made", 17 rows) | ~50 |
| 6 | See stations covered / late, leave a note | done (Pulse: 0 covered, 10 uncovered, 4 missed vendor cutoffs; handoff note posted) | ~8 |
| 7 | Closing count (AM prep) | done ("AM Prep submitted at 7:58 PM") | ~65 |
| 8 | Night report: grade one person, MVP | done, but I could not confirm the MVP stuck (see notes) | ~16 |
| 9 | Record tonight's cash | done ($845.00, Even, signed) | ~11 |
| 10 | Finish the closing | done, but only as "Closing submitted with incomplete items": I gave a reason for 49 open lines instead of doing them | ~63 |
| 11 | Start a full count of the shelves | partly. I recorded a count for one item only (Iceberg, 4 head). The page first crashed, and the first item I tried (Ham) was refused | ~14 |
| 12 | Start the next order for one vendor | done (Baldor, Cholula x1, "Walk recorded", added to today's draft) | ~8 |
| 13 | Find today's delivery in the reports | done (via Reports Hub > Inventory > Receiving > Recent deliveries) | ~6 |

## Where I got stuck
No goal was fully stuck. These are the places where I lost time or got a wrong result.

- Goal 11, Inventory Audit (/operations/counts, heading "Inventory Audit"). The first open showed the error page "Something went wrong / Algo salió mal". "Try again" did not help. Going in again from the dashboard tile worked after a long wait on "Loading…". My first line (Ham, unit typed as "bundle", count 4) was refused with: "Can't convert "bundle" to ounces for Ham — nothing was saved. Pick a unit from that item's list...". The guide covers this ("A unit is required... If a unit won't work for an item, a red message says nothing was saved") but does not say which items have no unit list. Ham has none, so I had to try other items. Iceberg has a list (Case / head) and worked. The form kept my typed values after the error, which was good.
- Goal 11, step 3 in the guide ("Confirm it"): "AGMs and up: tap Record audit. Then type your password in Confirm your password." The password box showed up and I typed it. Afterwards the form still showed my old Ham values and the error text at the bottom, so I could not tell if the audit had saved. The "Anchored to the audit on Wed, Oct 14" line was already on the page before my count. I only knew Iceberg worked because it showed "112.0 oz on hand".
- Goal 10, Confirm the closing: the guide says tick the lines or give reasons. I did not do 49 lines of closing tasks. I typed one reason in each of 49 boxes. The result page listed reasons with repeated names ("Restock", "Wipe inside & outside"... each repeated), with no station name next to them, so I cannot tell which station each reason is for. The review panel did list station names (for example "EXPO STATION · RESTOCK BEVS"), but the final page does not.
- Goal 8: after I tapped "Submit PM Report", the MVP box and my MVP choice were gone from the page. I could not check that Luis Herrera stayed saved as MVP.

## Notes for the team
- What would make the guide better:
  - Goal 3 is very long (about 130 taps for the opening). The guide says it is long, but it does not say the Opening Report can take 40+ minutes on a night where AM prep was missed. A "if you only have 5 minutes" note for the missed-closing case would help.
  - The guide says "A row saves when you leave its box". In practice, when I typed the value and tapped the next box, the previous row did save. When I typed the last row I needed to press Tab or tap outside, or it stayed on "Not saved". Say so for the last row.
  - The guide says "Tap Finalize Phase 2" with no pop-up. A "Below prep need" window had been left open from an earlier tap, and the whole page was greyed out. Tapping Finalize failed over and over (5 tries) until I noticed the window and pressed Cancel. Add: "If a window is open, the buttons behind it do not work."
  - The guide says "Start closing" is done from the dashboard. It is, but "Start closing" also covers AM prep warning text on the closing page. Fine.
  - "Check in a delivery": the Baldor "usual order" had only Cholula (a hot sauce) for a produce truck. The guide says the usual order "may not match today's truck", which is right, but a produce example (add Lettuce with Pick a SKU then + Add item) would help.
  - Guide page for the PM report says "Select employee… at the bottom" to add people. This matters because a lone manager is the only person listed at first, so the page invites you to grade yourself.
  - The goal says "morning report" and the guide calls it Opening Report / Opening prep / Opening verification. The board only says "Opening prep". Add "Opening prep (the morning report)" near the top of the Morning section.
  - Clock oddness: the board showed "Taken by Nicole Boyd · 1:16 AM" for Counts and Ordering at the start, and "Saved by Nicole Boyd at 7:47 PM" later. The guide says times are "the time" of each step, but a reader will be thrown by this.
- What is hard in the app for no reason:
  - The Opening Report is very long for a new manager (10 station cards, 8 temp boxes, 5 prep sections with 38 recount rows, then 38 prep rows again). The 38 recount rows only appear because last night's AM prep was missing. Most numbers I typed twice.
  - In the Opening Report, the prep rows on screen text are cut off after a point in my tool's text view (not sure if it is the app or the tool). I had to read the "Prep need" numbers from screenshots for the last 20 rows.
  - The temperature box hides inside the closed station card. The guide says so, and it is still easy to miss.
  - The closing review asks a reason for each of the 49 open lines in 49 separate boxes. There is no "same reason for all" button.
  - The Pulse "Needs attention" shows "+7" more but the guide says "See more". It works, but I did not need it.
- Steps that confused me even when the guide was right:
  - After typing PIN digit 4 the screen showed all the keys greyed out and "Loading…" for a few seconds. I thought it had hung.
  - Many pages show "Loading…" for 5 to 10 seconds the first time. Counts and Receiving were the slowest.
  - Mid-day prep (Phase 2): each row has a SAVE button and rows show "SAVED ✓" only briefly. I could not tell which rows were saved until the section header changed to "6 of 6 done". The guide says the row says "Saved ✓", which is true.
  - Cash deposit: after the 4th PIN digit nothing visible happens for a moment, then the green line shows. The guide says to wait.
- Anything that looked broken:
  - /operations/counts crashed once with "Something went wrong" (first open, from the board). It worked on the second open from the dashboard after a long load.
  - Closing: the "Reasons given for unfinished lines" list repeats the same line names with no station, so duplicates look like a bug.
  - The Inventory Audit page still showed the old error text ("Can't convert 'bundle'...") after I switched to a different item and saved successfully.
  - "Closing submitted with incomplete items" was allowed even though the Cash deposit line and walk-out were done but 49 lines had a throwaway reason. That is how the guide describes it, but it means a manager can close with no real work.
  - Dashboard says "Boar's Head: missed cutoff" etc. all day (4 vendors) with the clock reading night time. It is probably right for the test clock.

## The 5 best things CO-OPS does for a restaurant
1. Opening verification against last night's count. Each station, each fridge temperature and each prep row is checked, with a name and time on every step. It matters because the opener can see right away what the closer left, and nobody can say "it was fine" without a record.
2. Prep sheets that tell you the number to make (Par, Closer count, Prep need) and flag it when you make less or more, with a reason. It matters because the morning crew does not guess what to prep, and shortfalls get written down and sent to managers.
3. Receiving with a "Short" flag that opens a vendor credit by itself. I checked in a produce delivery, marked Lettuce short, and "Open vendor credits: 1 open" appeared, and the delivery showed in the list with its invoice number and total. It matters because short deliveries become money the vendor owes, instead of getting lost.
4. The Mid-Shift Pulse. One screen showed 0 of 10 stations covered, four missed vendor cutoffs ("call the vendor"), all 8 fridges at 38°F, and a place to leave a handoff note for the next shift. It matters because a manager sees what is wrong right now, without walking the whole shop.
5. The night close chain: AM prep count (becomes tomorrow's Closer count), PM report grades, cash deposit signed with a PIN (it checked the drawer against the projected sales and said "Even"), and a closing that records a reason for every unfinished line. It matters because tomorrow's opener starts with real numbers, and every night has a signed record of cash and of who did what.
