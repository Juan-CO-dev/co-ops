# Report — haiku — manager guide
Model I am: claude-haiku-5-5 (Haiku 5.5)

## Goals
| # | Goal | Result (done / partly / stuck) | Actions used |
|---|---|---|---|
| 1 | Log in | done | ~13 |
| 2 | Take the morning report for yourself | done (board shows "OPENING PREP — Taken by Nicole Boyd · 8:09 PM") | ~10 |
| 3 | Open the shop: verify, send Part 1, then Part 2 and finish | done, with a caveat: the 38 "recount" values were placeholders (2), because I had no real shelf count | ~125 |
| 4 | Check in the produce delivery, one item short | done (Baldor, 2 lines, Onions flagged Short, 1 vendor credit opened) | ~14 |
| 5 | Lunch rush over: get the line back to par | done (Phase 1 counts, Phase 2 saved row by row, "Finalized — prep made") | ~32 |
| 6 | See covered stations and late items; leave a handoff note | done (Pulse: 0 covered / 10 uncovered, 4 missed vendor cutoffs; note posted) | ~14 |
| 7 | Closing time: count what is left (AM prep) | partly: AM prep submitted, but every ON HAND value was a placeholder (1), because I had no real count | ~40 |
| 8 | Night report: grade one person, pick MVP | done (Angel Reyes graded on all 4 lines, MVP + "why", PM report submitted) | ~22 |
| 9 | Record tonight's cash | partly: deposit signed ($845.00, Even), but the Projected (Toast) figure was not visible to me, so I typed the guide's example numbers ($845 / $1,045) | ~12 |
| 10 | Finish the closing | done ("Closing confirmed · 8:28 PM by you", 61/61 lines) | ~80 |
| 11 | Start a full count of the shelves | partly: opened the audit, picked Iceberg (Unit and How many appear). Did not record: no real counts, and the guide says to run it when the owner asks | ~7 |
| 12 | Start the next order for one vendor | done (Webstaurant: 1 line, Review order, Record walk → draft PO MEP-20261014-WEBSTA) | ~9 |
| 13 | Find today's delivery in the reports | done (Reports Hub → Receiving → Recent deliveries: "Baldor 2026-10-14, PHOTO MISSING, 2 items") | ~5 |

Counts are approximate (I counted tool calls from each goal's start).

## Where I got stuck
For each goal that is not done (7, 9, 11).

**Goal 7 — AM prep.** Screen: `/operations/am-prep`, heading "AM PREP".
- What I tried: opened AM Prep from the Closing Manager section ("AM Prep List — tap to open AM prep"), then filled ON HAND for each row, left BACK UP empty, and answered the four Misc YES/NO questions. Submitted.
- The guide sentence that misled or was missing: "**Type what is on the line in ON HAND.**" (under *AM prep: the closing count → 3. Count every row*). It does not say what to do when you have no shelf count to type. I entered 1 everywhere, which is not a real count.
- Also: I first tapped "AM Prep List" and the screen did not change; the second tap worked. The guide does not mention lag.

**Goal 9 — Cash deposit.** Screen: `/cash`, heading "Cash Deposit".
- What I tried: opened it from the board ("CASH REPORT"), typed Projected, Drawer total, tips, ticked the people on shift, then "Sign & submit deposit" and PIN 8888.
- The guide sentence that was missing: "**Type the Projected (from Toast) amount.**" (under *Cash deposit → 2. Fill it in*). It does not say where a key holder or AGM gets that number. Sales are GM-only in this guide ("Sales needs a GM or up"), so I had no figure. I used the guide's example values ($845 projected, $1,045 drawer), which are not real data.

**Goal 11 — Full count.** Screen: `/operations/counts`, heading "Inventory Audit".
- What I tried: opened Counts from the board, picked Iceberg from "Pick an item…".
- The guide sentence in conflict: "**Run a full count when the owner asks for one.**" (under *Counts (Inventory Audit)*). The task said to start one, so I stopped at the first line and did not record it. The guide also does not say how to start without recording.

## Notes for the team
- **What would make the guide better:**
  - Say where each number comes from: the Toast projected cash figure, and the shelf counts for AM prep and Opening recounts. Say what to type when you do not have it.
  - In *Opening → 2. Check each station*, the sentence "Tap **Verified**. Then type the fridge temp in the box inside the card" is out of date in practice: tapping Verified collapses the card and the temp box disappears. You have to tap the station name again. Say so.
  - In *Opening → 3. Check the prep sections*, the grey "Recount items without closer data first" appears when there is no closer count. Phase 2 then shows a closer count for the same rows. Explain why.
  - In *Handoff notes*, say that the form is inside the Handoff card and that the posted note can take a moment to show.
  - In *Closing checklist*, warn that tapping a line while it is still saving can untick it. I unticked "Change & stock cannoli pan" by accident and had to tick it again.
  - In *PM report*, say what happens to a card you did not save (it is submitted with no grade). Say that the "Why MVP?" box only appears after you pick an MVP.
- **What is hard in the app for no reason:**
  - Opening Phase 2 takes one box and one save per row, about 38 rows, in five sections.
  - The closing checklist has about 60 lines. Most need a separate tap, and a temp line needs its own box and Save.
  - The receiving "Recent deliveries" list sits at the bottom of the page, under the form.
- **Steps that confused me even when the guide was right:**
  - "Verify section" stays grey with no hint that the row recount is the blocker.
  - The button text "Submit ready" and "Submit disabled" appear in the bottom bar, and the wording changes after you submit.
  - Walk-In temp line says "Record cooler temp in Fahrenheit" in small text, which looks like a different step.
- **Anything that looked broken:**
  - Several pages showed "Loading…" with no controls for a moment. Taps during that time failed.
  - After I posted the handoff note, the next screen still showed the empty form. The note appeared on the following look.
  - Opening Phase 2 showed closer counts (e.g. "2 Quart") for rows that Phase 1 had said had no prior closing data.
  - Ordering walk listed Cholula as a Baldor usual-order line, and the screen also said "Use exceeds recorded receipts — receiving history incomplete".
  - Inventory audit shows many "below zero — count it" items and "backdated delivery" warnings on the dashboard before any count of mine.

## The 5 best things CO-OPS does for a restaurant
1. **Receiving with a short flag and vendor credit.** You check the truck line by line, flag a short item, and the app opens a vendor credit you can chase. It matters because a short delivery that is never claimed is money the shop loses.
2. **Ordering walk with cutoffs and draft orders.** It lists each vendor's cutoff, marks the ones missed, and turns the walk into a draft PO per vendor. It matters because a missed cutoff means the stock does not arrive on time.
3. **Mid-Shift Pulse.** One screen shows uncovered stations, late tasks, missed vendor cutoffs, fridge temps and the handoff notes. It matters because a manager can fix a gap (an empty station, a missed cutoff) during the shift, not after.
4. **Opening report with prep need from par.** Each prep row shows par, last night's closer count and the amount to make to reach par. It matters because the crew starts the day knowing exactly what to prep.
5. **Cash deposit with projected vs drawer check and PIN signature.** It shows "Even", over or short against the projected amount, then locks the deposit once you sign with your PIN. It matters because cash is checked the same way every night and a signed record is kept.
