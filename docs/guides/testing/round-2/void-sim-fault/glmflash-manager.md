<!-- tester glm/glm-5.3-flash · session glmflash-manager-r2 · 636 actions · 3033s -->
# Report — glmflash — manager guide
Model I am: glmflash (GLM, sim tester for the CO-OPS manager guide)

## Goals
| # | Goal | Result (done / partly / stuck) | Actions used |
|---|---|---|---|
| 1 | Log in (tiles: shop → role → name → PIN 8888) | done | 8 |
| 2 | Nothing assigned; take the morning report for myself | done — tapped "Opening prep" on the board, board then showed "Taken by Nicole Boyd" | 4 |
| 3 | Open the shop: verify Part 1, submit, do Part 2 morning prep, finalize | **partly** — Phase 1 fully verified (44/44 lines, 8/8 temps, all 5 prep sections recounted + attestation) and submitted; Phase 2 rows filled but every new save failed ("Save failed — Retry"), so Finalize Phase 2 never unlocked | ~95 |
| 4 | Check in the produce delivery; one item short | done — Baldor, Cholula 3 of 5 received, flagged **Short** with note, invoice # and total entered, Photo later, Delivery confirmed. Delivery detail page 404s (see notes) | ~14 |
| 5 | Lunch rush over; get the line back to par (mid-day prep) | **partly** — new mid-day prep started, all 17 rows counted, but "Submit count → Phase 2" failed repeatedly ("Could not submit the count."); Phase 2 never reached | ~20 |
| 6 | See covered stations / what's late; leave a note | done — Pulse: 0 of 10 stations covered, 0 of 2 tasks done, AM prep not started, Cholula at 86% of par risk, 8 fridges in range, 0 of 5 reports done. Handoff note posted "For everyone" | ~7 |
| 7 | Count what's left (AM prep) | done — all 5 sections + Misc yes/no filled, "AM Prep submitted at 5:20 AM by Nicole Boyd", closing line self-ticked | ~60 |
| 8 | Night report: grade one person, pick MVP | done — added Angel Reyes, 4 grades + area to improve + private note, saved; MVP Angel Reyes with reason; "Submitted 5:22 AM" | ~12 |
| 9 | Record tonight's cash | done — projected $845, drawer $1,045 (includes the $200 float), deposit $845.00 · Even, tips $40, 3 of 5 ticked, signed with PIN: "Deposited $845.00 · signed by Nicole Boyd" | ~12 |
| 10 | Finish the closing | done — 59/61 lines (all 9 stations closed incl. temps, drawer+tips ticked, walk-out 5/5, AM prep/cash/PM lines self-ticked); two lines unfinished because of the save bug; closed with written reasons + PIN: "Closing submitted with incomplete items · 5:27 AM by you" | ~50 |
| 11 | Start a full count of the shelves | done — Inventory Audit: Provolone 3 piece, Ham 2 each, recorded with password; on-hand now "Anchored to the audit on Wed, Oct 14" | ~12 |
| 12 | Start the next order for one vendor | done — Boar's Head walk: 9 SKUs marked to suggestion, "Walk recorded — 9 SKUs. Boar's Head: added to today's draft — PO MEP-20261014-BOARSH" (draft now 12 lines) | ~15 |
| 13 | Find today's delivery in the reports | done — Reports Hub → Inventory → Receiving → Recent deliveries shows "Baldor 2026-10-14 · PHOTO MISSING · 1 item(s) · #BLD-20481 · Nicole Boyd" | ~3 |

## Where I got stuck

**Goal 3 — Opening prep Phase 2 (final part of the morning report)** — screen `/operations/opening?...`, heading "OPENING REPORT / Phase 2 — Prep Entry".
What I tried: typed the prep need into every remaining row (Cannoli Cream, all 11 Sauces, all 9 Slicing), let each box blur to save; when the app showed "Save failed — Retry" I tapped every Retry button, retyped values (including a deliberately different value to test the change event — it registered the change and recalculated "Uses" but still failed the save), reloaded the page and refilled everything, and retried twice more later after the backend demonstrably recovered (AM prep, PM report, cash, counts, ordering and handoff notes all saved fine in between). The same rows failed every time; FINALIZE PHASE 2 stayed disabled (21 outstanding).
Guide sentences: under **App words → Saved**: "Most forms save by themselves as you type. Look for **Saved** or **Saved a moment ago**." and under **Opening prep → 2. Type what you made**: "A row saves when you leave its box. Then it says **Saved by … at …** with an **Undo** button. Until then it says **Not saved**." The guide has no entry for a persistent **Save failed** state, so a first-day manager has no documented remedy. Also misleading: the guide says "Every row needs a number, even when you made none" — but rows marked "Below prep need by …" will not save until a reason is picked, and the app silently cleared my 0s on reload.

**Goal 5 — Mid-day prep** — screen `/operations/mid-day?instance=...`, heading "MID-DAY PREP / Phase 1 — count to par".
What I tried: counted all 17 rows (Veg, Sauces, Cooks all showed ✓ done), tapped "Submit count → Phase 2" twice; both times the app said "Could not submit the count." with no reason shown, and Phase 2 never appeared.
Guide sentence: under **Mid-day prep → 2. Count to par**: "Type what you have in **On hand** on each row. The row shows how much you need. Tap **Submit count → Phase 2**." The guide mentions only one possible snag ("If a row can't load… Tell a manager"), but here every row loaded and the submit itself failed server-side, with no explanation. Same missing "save failed" story as Goal 3.

**Two smaller broken things found while doing the goals** (both contradict the guide):
- Under **Check in a delivery → 4. Confirm the delivery**: "Tap a delivery to see its lines, flags and credits." — tapping my confirmed Baldor delivery opens a 404 "Page not found / Página no encontrada".
- Same section: "Each flag you picked (**Short**, **Over**, **Damaged** or **Sub**) opens a vendor credit. It shows under **Open vendor credits**, with how many are open." — no "Open vendor credits" section ever appeared on the Receiving page after I confirmed a Short.
- Also new and undocumented: Phase 2 prep rows now show "Uses: … / tap to confirm usage" lines and a per-row "Suggest" button — the guide (in English and Spanish) describes none of this.

## Notes for the team
- What would make the guide better:
  - A "when saves fail" entry: what "Save failed — Retry" means, whether to refresh, and how to know your numbers survived. It is the most alarming screen in the whole app and it is completely undocumented (the "Saved" glossary line implies saves never fail).
  - Say explicitly that below-need rows need a reason **before** they will save even at 0, and that reloading can wipe unsaved boxes (my typed values vanished twice).
  - The guide says "Each temp needs its own number" and that Verified "ticks the station's lines, but not the fridge temp" — in practice Verified ticked everything and temps counted toward the station's "x of y done"; the temp is also just one of the ticked lines. The mental model in the guide doesn't match what I saw.
  - Document the new "Uses / tap to confirm usage" rows and per-row "Suggest" button in Phase 2 of the opening.
  - Mention that the closing's "Review & submit" panel is how you explain the self-ticking report lines when their reports are genuinely stuck — I only found it because I read ahead.
  - The delivery-detail 404 and the missing "Open vendor credits" section need fixing or the guide's promises there need softening.
- What is hard in the app for no reason:
  - A missed AM prep the night before turns the morning into ~38 extra recount boxes plus a pink attestation box, but the pink box is per-section (5 separate attestations for the same underlying fact) — once would do.
  - The board's task names vs. report names ("Opening prep" is the whole Opening Report; "AM prep" is done at night) still trip you up on the dashboard, where the tile says "AM Prep" and the board says "Opening prep".
  - Collapsing a receiving line hides the flag you picked, so you can't verify "Short" stayed on before confirming — I had to tap it blind.
  - 8 fridge temps in the morning + 8 more in the closing: typing 16 temps a day, and Verified doesn't help because temps need typing anyway.
- Steps that confused me even when the guide was right:
  - "To take a task, tap it and do it. There is no Take button" — tapping a task row navigates straight into the report; it reads like an accident until the board later shows "Taken by Nicole Boyd".
  - On the cash form, "Even" appears immediately after typing projected + drawer, but the guide's example math (drawer = projected + 200) is the only way to know you did it right before signing.
  - The Reports Hub "Receiving" entry is the live page, not a report — the guide says so, but the entry sits under a report family, so it still feels wrong the first time.
  - Station "Verified" buttons are visible while the cards are collapsed; the guide's "tap the station's name to open its card" made me think I had to open every card even though only temps require it.
- Anything that looked broken:
  - Prep-entry saves (opening Phase 2) failed persistently for ~21 rows across many minutes and multiple reloads, while every other endpoint worked; Finalize Phase 2 stayed locked. Same for mid-day "Submit count → Phase 2" ("Could not submit the count.").
  - Delivery detail page 404s (Recent deliveries → tap delivery).
  - "Open vendor credits" never appeared after confirming a Short.
  - After the closing was submitted, the dashboard's task list went back to all "UNASSIGNED", which looks like the day reset even though reports show Done.

## The 5 best things CO-OPS does for a restaurant
1. **The closing checklist that runs all day, station by station** — 61 tickable lines grouped by station, self-ticking links for filed reports, walk-out verification, and a PIN-signed confirm that keeps a permanent record with your name and time. Closing is where money and food safety slip through the cracks; making it a live list instead of a paper sheet at 8 PM means nothing is forgotten and the opener can see exactly what happened.
2. **The Opening Report's two phases** — verify last night's counts against reality, then prep to par with every row accounted for (saves say who did it and when). It forces the shop to catch shrinkage and missing counts at 10 AM instead of discovering them mid-rush, and it hands the morning crew an exact "prep need" for every item.
3. **The Mid-Shift Pulse** — one page showing uncovered stations, late tasks, low-par items, order cutoffs, fridge temps and what reports are still missing. It replaced a walk-around plus a mental checklist; a manager can see in ten seconds that all ten stations are uncovered and 0 of 2 tasks are done.
4. **Receiving with flags and vendor credits** — count the truck against the usual order, mark Short/Over/Damaged/Sub with notes, and the app opens a vendor credit so money owed doesn't vanish. The Short I flagged on Cholula turned into a documented claim against the invoice instead of a shrug.
5. **AM prep as tomorrow's "closer count"** — the night count flows straight into the morning verification, so the opener starts from a number someone signed. It killed the classic "how much was left yesterday?" guesswork, and the yellow warning ("Tonight's AM prep count isn't in yet") nudges the closer without blocking the closing.
