# Photo-walk findings (2026-10-13)

What the three Sonnet photo walkers ran into on the sim. Each item is a guide fix (we make it), an app
idea (for Juan), or a sim-only issue. Production checks are marked.

## Fixed during the walk

- **AM prep page crashed at both shops (sim only).** One Cannoli Cream prep item per prep list had its
  par saved as text (`"0.5"`) instead of a number. The strict shape check threw (`PrepShapeError …
  prepMeta failed isPrepMeta()`, REF 35447673 / 789350329), which took down the whole AM prep page.
  - Production checked read-only: no prep item has a text par. AM prep is safe tonight.
  - The app's own edit screens always save a number (`app/api/admin/checklist-templates/[id]/items/route.ts:45`,
    `.../par/route.ts:35`), so this came from sim-only data. Fixed on the sim (4 rows).
  - App idea: one bad item should not blank the whole page. Skip it and show the rest, with a note to a
    manager.

## App ideas (for Juan)

- **Catering lead notes** can only be typed on the "+ Add lead" form. An opened lead has no way to add one.
- **A customer's page says "Pipeline: None yet" and "Orders: None yet"** while that customer has a lead and a
  $352 draft quote. Catering Insights "OPEN PIPELINE" reads $0.00 at the same time.
- **A GM who logs in at P Street lands on Capitol Hill's dashboard** and has to switch shops (both the
  dashboard and the Reports Hub).
- **An opened lead shows an amber "Order comparison is currently unavailable."** line every time. Likely a bug, per the catering fixer's code read: on a lead with no ezCater order, the fallback lookup sends an array filter against the jsonb `candidates` column, errors, and returns `available:false` every time (`components/catering/pipeline/EzcaterReconciliationPanel.tsx:27-30`).
- **The catering setup hub's sub-line** still lists "pricing", but Pricing is not on the hub for a GM.
- **Opening Phase 2 tab title** still reads "Phase 1 — Verification" while the Phase 2 tab is open.
- **Fractions in prep entry:** a prep need of "5 1/3 Pan" can't be typed as "5 1/3" (the box stays empty).
- **Opening recount boxes stay red-bordered** even after they are filled.
- **The round user button floats over page content** at phone and tablet widths: it covers the ORDERING › breadcrumb on Receiving, the VEG **Verified** button on the opening, and (with the REVIEW & SUBMIT pill) closing headers and an **Add note** (photo check, manager 18/19/20/22/40).
- **The DASHBOARD breadcrumb is hidden behind the round user button** on `/my-feedback` and
  `/reports/written` at phone width (also seen by both flash testers in the probes).
- **Closing checklist amber note** says "AM Prep had 0 items saved today - check with the opener." AM prep
  is the closer's count, so "check with the opener" points at the wrong person.
- **Equipment and stations still say "Walk-In Fridge" / "WALK INS STATION"** although the shops have no
  walk-ins (AGENTS.md).
- **Closing confirm showed "Just modified by someone else — try again."** right after the PIN, yet the closing
  WAS saved ("Closing submitted with incomplete items · 1:53 PM by Nicole Boyd"). A false conflict message
  at the last step of the night will make closers redo or doubt it. Worth a look before tonight.
- **Production has no menu path.** `/operations/production` alone bounces to the dashboard; it opens only
  with `?location=<shop id>`.
- **Counts need a unit the form doesn't suggest.** Typing "case" for a 1/2-pint item fails with a long
  conversion message; the unit list isn't offered up front.
- **Receiving "didn't arrive" only works against a purchase order.** With no expected order, a short has to
  be flagged on a hand-added line. "Photo later" must be ticked before DELIVERY CONFIRMED enables.
- **Trends says "Fridge Temp Flags 8" while the Reports Hub says "Temperature flags: 0"** for the same day.
- **Closing checklist line times differ from the reports' own times** (PM report 1:45 vs line 1:47; opening
  finalized 1:32 vs line 1:42).
- **The Pulse live floor map renders with overlapping labels** at tablet width.
- **Assigning a task** happens per person ("Who has what" → **ASSIGN TASK**) and saves at once, with no
  confirm step.
- **After finalizing mid-day prep, the page says "The interactive count and prep forms ship in the next
  build."** — a leftover placeholder; it reads as if the work was lost (it saved: the dashboard shows
  "Finalized … SUBMITTED"). (Opus staff tester, round 1)
- **Mid-day prep Phase 2 on a phone:** after typing in a box the page zooms and shifts sideways; **SAVE** and
  **FINALIZE PREP** sit partly off screen and stop taking taps (only keyboard Tab/Enter worked). Likely the
  iOS-style input zoom on small fonts. (Opus staff tester, round 1)
- **A station whose closing lines are all done drops back to "No station"** and the My station card goes away,
  instead of showing "Closed" with the time. (Opus staff tester, round 1)
- **After End my shift the card still offers START BREAK and CLAIM / CHANGE STATION.** (Opus staff tester)
- **Rows with no par (Tomato, Caesar Dressing) still say "verify section first"** after the section is verified.
- **Probe testers:** the PIN pad gives no feedback (no dots); one tester needed a fifth tap.

## Guide fixes (writers)

- An assigned crew member opens AND submits the opening (not "a key holder's job").
- Order: Phase 1 verify → **Submit Opening** → **Phase 2 — Prep Entry** → **Finalize Phase 2**.
- Prep rows save when you leave the box ("Saved by … at …" plus **UNDO**).
- A closing line's **Add note** appears only after the line is ticked.
- Report lines in the closing's manager section are links ("submit from the dashboard"), not tick boxes.
- **End my shift** opens the app's own "Confirm change" box with an optional reason; after it, your report
  tiles and station card go away.
- **AM prep won't submit until the closing checklist is started** ("Closing not yet started — start it from
  the dashboard, then re-submit AM Prep"). Entries are kept ("Picked up where you left off …"). Every AM prep
  row is required; BACK UP is optional; TOTAL fills itself.
- Claiming a station: open the **Stations** row, pick from the list, **CLAIM / CHANGE STATION**, confirm.

## Photo retakes owed (photo check, 2026-10-13) — after round 1, so the sim is free

- staff/15-my-shift.png — scroll to the My shift board.
- staff/19-station-claimed.png — show the board's "Stations — 1 of 1 assigned" / "Claimed · time".
- staff/41-my-performance.png — wait for the chart to settle.
- manager/31-closing-full.png — stitching flaw (sticky progress bar drawn mid-page); retake as two viewport shots or wait for the bar to settle.
- manager/10-assign-task.png — scroll up so the person's name is in frame.
- catering/10-lead-detail.png — amber line gone; **Edit details** button now there.
- catering/15-quote-saved.png — now shows **Client** and **Lead** lines.
- catering/17-customer-detail.png — now has a **Quotes** list.
- catering/13-quote-builder.png (optional) — picking a lead now pre-fills the quote.
- catering/32-setup-prep-demand.png (optional) — the "Sub — par comparison in W4b" dev text is gone.

