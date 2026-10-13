# Report — fable — manager guide
Model I am: Fable 5.1 (claude-fable-5-1)

## Goals
| # | Goal | Result (done / partly / stuck) | Actions used |
|---|---|---|---|
| 1 | Log in | done | 7 |
| 2 | Take the morning report for yourself | done (opened Opening prep from the board; board then showed "Taken by Nicole Boyd") | 3 |
| 3 | Open the shop: verify, submit Part 1, prep, finalize | done ("Phase 2 finalized") | ~130 (10 Verified taps, 8 temps, 38 recounts, 5 Verify section, 1 reason, submit, 38 prep entries, ~20 expand/collapse/scroll, finalize) |
| 4 | Check in a produce delivery, one item short | done (Baldor #BAL-10132; Lettuce SHORT; "Open vendor credits · 1 open") | 18 |
| 5 | Mid-day prep back to par | done (Pulse: "mid-day Done"; closing shows "Mid-day Prep ×1 Submitted") | ~63 |
| 6 | Pulse: stations covered, what is late; handoff note | done (note posted "For everyone", Got it / Retract shown) | 5 |
| 7 | AM prep closing count | done (form locked after submit) | 56 |
| 8 | PM report: grade one person, pick MVP | done ("Submitted 6:21 PM by Nicole Boyd") | 16 |
| 9 | Record tonight's cash | done ("Deposited $1,045.00 · signed by Nicole Boyd at 6:22 PM") | 20 |
| 10 | Finish the closing | done ("Closing confirmed · 6:25 PM by you") | 88 |
| 11 | Start a full count of the shelves | done ("Anchored to the audit on Tue, Oct 13") | 13 |
| 12 | Start the next order for one vendor | done ("Walk recorded — 2 SKUs. PFG: added to today's draft — PO MEP-20261013-PFG") | 7 |
| 13 | Find today's delivery in the reports | done (Reports Hub → Inventory → Receiving → Recent deliveries → delivery detail) | 5 |

## Where I got stuck
No goal was left undone or stuck. Three places cost me extra actions even though I finished:

- **Opening verification, fridge temps** — screen: `/operations/opening`, heading "OPENING REPORT / Phase 1 — Verification". The guide ("Morning › Opening verification › 2. Check each station") says: "Tap **Verified**. Then type the fridge temp in its box." The temp box is inside the station's collapsed card. After tapping Verified on all ten stations, the footer said "Temp reading required for 3rd-Party Fridge temp" and only one temp box existed on screen. I had to tap each station header to open it before I could type the temp. The guide never says to open the station.
- **Opening verification, Submit stayed grey** — same screen. With 44/44 verified and 8/8 temps in, the footer said only "Submit disabled". The reason was the pink "NO PRIOR CLOSING DATA DETECTED" box: Submit does not turn on until you pick a reason. The guide's step 4 ("4. Submit Opening", Worth knowing: "The button stays grey until each station is ticked, each temp is typed and every prep section says Verified.") does not list the reason pick. The box is only mentioned in step 3.
- **Cash deposit, "$200 short"** — screen: `/cash`, heading "Cash Deposit". The guide ("Night › Cash deposit › 2. Fill it in") says "**$200 stays in the register**. The deposit is the drawer total minus $200." I typed Projected 1045 and Drawer total 1045 and the app said "Deposit $845.00 · $200.00 short". I had to back out of the PIN keypad and re-enter the drawer as 1245. The guide should say the drawer total includes the $200 bank, so when you are even the drawer total is the projected amount plus $200.
- **AM prep from the closing checklist** — screen: `/operations/closing`, heading "CLOSING CHECKLIST". The guide ("Night › AM prep › 2. Open AM prep") says "You can also tap the AM Prep line on the closing checklist." I tapped "AM Prep List" under Closing Manager and nothing happened; I went through the board instead.

## Notes for the team
- What would make the guide better:
  - Opening Part 1: say "Tap the station's name to open it; the fridge temp box is inside." and add "pick a reason in the pink No prior closing data box" to the list of things that keep Submit grey.
  - Opening Part 2: "A row with no par says **Prep need: verify section first**" implies verifying fixes it. It doesn't: Tomato and Caesar Dressing still said that after Veg and Sauces were Verified, and I still had to type a number in each to finalize. Say: "Type what you made anyway; the row still counts."
  - Mid-day prep step 3 ("Prep and finish (not shown)") says "type what you made in **Prepped**. Tap **Finalize prep**." Every row also has its own **Save** button and the row reads "SAVED ✓" after it; Finalize only counts saved rows. Add the Save.
  - Cash deposit: add one line that the drawer total includes the $200 bank (see above).
  - Counts: "Type a **Unit**" — once you pick an item, Unit becomes a dropdown of that item's units (Iceberg: Case / head; Turkey: piece). Say "Pick a unit".
  - Reports Hub: the goal "find today's delivery" is not covered. **Inventory › Receiving** in the hub opens the live Receiving page, not a report list; the delivery is under **Recent deliveries**, and tapping it opens a detail page (`/operations/receiving/<id>`) with items, flags and vendor credits. Add a step for that.
  - Receiving: say that the vendor's "usual order" can be short or odd (Baldor loaded one line, Cholula) and that produce items are added with **Pick a SKU… → + Add item**.
  - Mid-day prep from the board: after you finalize, tapping **Mid-day prep** on the board jumps straight into the finished one (no list, no "+ New"). Worth a line so people don't think it is broken.
- What is hard in the app for no reason:
  - Opening with no closer data = 38 recount boxes plus 38 prep boxes, typed one by one, plus 8 temps and 15 header taps. One report took ~130 actions.
  - Every station and prep section is collapsed by default on Opening, AM prep, Mid-day and Closing; the required fields hide inside.
  - Closing: 56 line taps plus 8 temps each with their own Save; the temp line also opens an "Anything noteworthy?" box every time.
  - Cash deposit shows "Deposit -$200.00 · $200.00 short" before you type anything.
  - PM report: the card Save only shows "SAVED ✓" after a delay; the MVP Save showed "SAVING…" and never a saved state in text.
  - The dashboard "My shift" card said "Take or assign stations 0 of 1 assigned" while the board said "0 of 12 assigned" and the Pulse listed 11 uncovered stations.
- Steps that confused me even when the guide was right:
  - Phase 2 of the opening keeps the title "Phase 1 — Verification" and the header text "Recount items without closer data first" under every section even after they are verified (the guide warns about the title, not the recount text).
  - The Short / Over / Damaged / Sub buttons give no visible "pressed" state in the control list; I only knew Short stuck when the delivery detail said SHORT and a vendor credit opened.
  - The Reports Hub shop card said "Last close · Mon, Oct 12 · No activity recorded" minutes after I confirmed today's closing; "Reports: 7" did not match.
  - "AM prep" for the night count is still a strange name, even with the guide's warning.
- Anything that looked broken:
  - Finalized mid-day prep page shows a developer placeholder: "The interactive count and prep forms ship in the next build. Items below are the template for this mid-day prep." There is no "finalized" banner; the page is just the par template with no controls.
  - Closing checklist, Closing Manager: the link labels read "Cash deposited — tap to submit from the AM Prep page" and "PM Report submitted — tap to submit from the AM Prep page" (wrong page named), and the "AM Prep List — tap to submit from the AM Prep page" link does not navigate.
  - AM Prep: after Submit the form locks but no "AM Prep submitted at … by …" banner appeared in the screen text (the guide promises one).
  - Ordering: after Record walk, a "DRAFT ORDERS" heading appears with nothing under it; the draft is only in "Today's orders" at the top. The "Delivery options (email, portal, phone) appear once you submit" line never showed options.
  - Practice data: at login the board already said Counts and Ordering were "Taken by Nicole Boyd · 1:56 PM / 1:58 PM", and PFG/Trimark drafts already existed, although the brief said nothing was assigned to me. The Pulse showed "Last par walk 3:27 PM by Nicole Boyd" before I had done one.
  - Receiving: the "Scan / Scanner ready" button appeared only after picking a vendor and is not in the guide.

## The 5 best things CO-OPS does for a restaurant
1. **Opening Report math** — after Part 1 it shows Par, Closer count and Prep need on every row and marks "At par" as you type, with who saved it and when. The opener knows exactly what to make and the GM can see it was done.
2. **Closing checklist that fills itself** — the Opening, Mid-day Prep, AM Prep, Cash and PM Report lines ticked themselves the moment each report was filed, every line records who ticked it and when, and the night ends with a PIN-signed "Closing confirmed · 6:25 PM by you". Nothing gets skipped quietly.
3. **Receiving with built-in vendor credits** — count the line, tap Short, and the delivery is filed with invoice number, per-line notes, "Photo missing" status and an open vendor credit to chase. The money a vendor owes you stops living on a sticky note.
4. **Mid-Shift Pulse** — one page shows uncovered stations with an Assign button, all 8 fridge temps in range, today's order cutoffs and drafts, items at 86 risk, which reports are in, and the handoff notes. A manager can read the whole shop in a minute.
5. **Ordering walk** — each item shows par, estimated on hand and a one-tap Suggest; Record walk turns the marks into a numbered PO draft per vendor and the cutoff times are right there. Ordering becomes a short walk instead of a guess.
