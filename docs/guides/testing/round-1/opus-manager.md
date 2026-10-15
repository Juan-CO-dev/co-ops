# Report — opus — manager guide
Model I am: Claude Opus 5.5 (claude-opus-5-5)

## Goals
| # | Goal | Result (done / partly / stuck) | Actions used |
|---|---|---|---|
| 1 | Log in | done | 8 |
| 2 | Take the morning report for yourself | done | 6 |
| 3 | Open the shop: verify, submit Part 1, prep and finalize Part 2 | done | ~90 |
| 4 | Check in a produce delivery with one short item | done | ~14 |
| 5 | Mid-day prep back to par | done | ~32 |
| 6 | See station coverage and what is late; leave a handoff note | done | ~12 |
| 7 | Closing count (AM prep) | done | ~45 |
| 8 | PM report: grade one person, pick MVP | done | ~23 |
| 9 | Record tonight's cash | done | 9 |
| 10 | Finish the closing | done | ~110 (about 20 of these were my own repeat taps on one temp line, see below) |
| 11 | Start a full count of the shelves | done | ~19 |
| 12 | Start the next order for one vendor | done | ~11 |
| 13 | Find today's delivery in the reports | done | ~9 |

Action counts include every `look`. Big counts in 3, 7 and 10 come from the number of rows (44 opening lines, 38 prep rows, 42 AM prep rows, 61 closing lines), not from being lost.

## Where I got stuck
No goal got stuck. These are the places where the guide and the app did not match:

- **Goal 3, `/operations/opening`, "Opening Report — Phase 1".** "Check each station" says *"Tap **Verified**. Then type the fridge temp in its box."* The temp box is inside the station card, and every card except the first starts collapsed. You have to open each card to find its box. The footer only told me *"Temp reading required for 3rd-Party Fridge temp"*, one at a time. The guide does not say the cards are collapsed.
- **Goal 3, Phase 2.** Tomato and Caesar Dressing showed *"Prep need: verify section first"* after their sections were already verified. The guide is right ("A row with no par says…"), but the app's wording sends you back to Phase 1 for nothing. I typed 0.
- **Goal 4, `/operations/receiving`.** "Confirm the delivery" says *"Some usual-order lines may not be counted yet. Then the first tap lists them: **Some expected items were never confirmed**."* That did not happen. Baldor's usual order was one line, Cholula, which I left blank. One tap on **Delivery confirmed** confirmed the delivery with no list and no "Tap again to confirm". Also, the "usual order" for a produce vendor was a hot sauce. Lettuce and Onions had to be added with **Pick a SKU…** / **+ Add item**.
- **Goal 5, `/operations/mid-day`, Phase 2.** "Prep and finish (not shown)" says *"In Phase 2, type what you made in **Prepped**. Tap **Finalize prep**."* Each row also has its own **SAVE** button. A row does not count as done until you tap it. The guide does not mention it, and there is no screenshot for this step.
- **Goal 7, `/operations/am-prep`.** "Count every row" talks only about **ON HAND** / **BACK UP**. In Sauces and Slicing the first box is called **LINE**, and in Sides it is called **PORTIONED**. Sides is covered ("the first box is for portioned items"), but LINE is not.
- **Goal 10, `/operations/closing`.** "Keep the closing checklist moving" says *"The closing has its own fridge temp lines"* but never says how to fill one. Tapping a temp line opens a box labelled **COUNT** (for a temperature), a notes box and a **SAVE** button. The line does not tick until you tap SAVE. My script kept re-tapping the line about 20 times before I saw this.
- **Goal 11, `/operations/counts`.** "Add your lines" says *"Type a **Unit**"*. It is a dropdown (Capicola offered only "piece").
- **Goal 13, Reports Hub.** "Reports Hub" says *"**Inventory** shows **Receiving**…"*. That link opens the live Receiving page, not a report. The delivery is there under **Recent deliveries**, but tapping the row does nothing, so there is no detail view.

## Notes for the team
- **What would make the guide better:**
  - Say that station and section cards are collapsed and must be opened to type temps and recounts.
  - Add the per-row **SAVE** in mid-day Phase 2.
  - Explain the closing temp lines (tap the line → COUNT box → SAVE).
  - Name the **LINE** column in AM prep.
  - Say that Counts' **Unit** is a pick list.
  - Say that Reports Hub → Receiving is the live receiving page.
  - Fix the "Some expected items were never confirmed" step, or say when it shows.
  - "Take the morning report": say plainly that there is no Take button. You just open **Opening prep** and work it, and the board then says "Taken by …".
- **What is hard in the app for no reason:**
  - Long forms where every section starts collapsed.
  - Closing temp entry hidden behind a tap and a separate SAVE.
  - The Pulse does not list missed vendor cutoffs as late. At 3:15 PM, Boar's Head and Cardinal Bakery (3:00 PM cutoff) only showed "no draft yet" in the Inventory card. **Needs attention** listed only uncovered stations and one low item.
  - The PM report starts with only the people who touched the app, which was just me. I had to add Angel Reyes from **Select employee…**, and I was graded "Good" on all four by default on submit.
- **Steps that confused me even when the guide was right:**
  - The opening page title still says "Phase 1 — Verification" during Phase 2 (the guide warns about this).
  - The receiving line says "QTY (UNITS)" and also "No pack chain — enter quantity in packs."
  - The Closing Manager report lines say "Pending — submit from the dashboard", but the guide says to use the board.
  - After the 4th PIN digit the keypad goes grey with no message for a second or two.
- **Anything that looked broken:**
  - After **Finalize prep**, the mid-day page showed *"The interactive count and prep forms ship in the next build. Items below are the template for this mid-day prep."* The finalize did work (the dashboard shows "Finalized at 3:14 PM").
  - The on-hand list on Counts shows many negative amounts (for example -433.0 oz and -261.3 oz). Capicola showed -189.0 oz right after I recorded 4 pieces, then 230.0 oz on the next look.
  - On the closing checklist, the screen-reader labels for "Cash deposited" and "PM Report submitted" say "tap to submit from the AM Prep page". The first tap on the AM Prep link did not navigate.
  - The cash form inputs and the On-shift checkboxes have no labels (they read as "0.00" and ""). The empty form shows "Deposit -$200.00 · $200.00 short". An even deposit reads "$0.00 over".
  - After the closing was confirmed, the "Confirm with your PIN" text was still in the page.
  - The vendor credit for the short lettuce shows "—" for the amount. I gave no price, so this may be expected.
  - The Reports Hub shop card says "Last close · Mon, Oct 12 · No activity recorded" after today's closing was confirmed.
  - After the PM report was submitted, its text boxes lost their labels.

## The 5 best things CO-OPS does for a restaurant
1. **The opening report turns last night's count into a prep list.** For each item it shows par, closer count and how much to prep, and saves each row with your name and time. The opener knows exactly what to make before doors open, and there is a record of who did it.
2. **The closing checklist ticks itself from the other reports.** Opening, mid-day prep, AM prep, the PM report and cash all tick their lines on their own. The checklist then needs the walk-out and a PIN to confirm. The manager can't close with the cash or the counts missing, and the night has a clear signed end ("Closing confirmed · 3:25 PM").
3. **Receiving flags a short line and opens a vendor credit.** It also notes "Photo missing" and keeps the invoice number. Short deliveries become money owed instead of being forgotten on the dock.
4. **The Mid-Shift Pulse puts the whole shop on one screen.** It shows uncovered stations with an Assign button, all 8 fridge temps in range, items low against par, today's order cutoffs, which reports are done, and handoff notes. A manager walking in can see what needs doing in seconds and leave a note for the next shift.
5. **The ordering walk builds a vendor draft order from par.** It has quick buttons (Suggest / Empty / We're full) and produces a numbered draft order with the vendor minimum and portal. Ordering becomes a short walk instead of guesswork, before each vendor's cutoff.
