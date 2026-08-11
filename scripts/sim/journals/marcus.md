# Marcus Webb — GM floating both shops — end-of-day sim journal
Date in sim: 2026-08-11 (Tue). Persona: accountable GM, sees the whole board.
Core question all shift: "Can I tell what happened today from the screens alone?"

---

## GOAL 1 — Log in — DONE
- Landing page = location picker ("Where are you?") with a "Manager login →" toggle. Tile login flow: location → role → user → 4-digit PIN keypad. Clean, fast, obvious. No one was signed in, so no logout needed.
- Picked P Street / General Manager / Marcus Webb / PIN 9999. Logged straight to /dashboard.
- FELT: smooth. The stepped tile login is nice for a shop tablet.
- CONFUSED / BUG?: I selected **P Street** at login, but the dashboard landed on **Capitol Hill** ("Today's operations at MEP · Capitol Hill"; nav links carry loc=54ce...=Capitol Hill). The login location choice did NOT carry into the dashboard's default view — it defaulted to the other shop. Minor, but as a GM with both shops that's a "wait, which store am I looking at?" beat on first load. The location switcher (top) makes it recoverable.

---

## GOAL 2 — PM Report for P Street + crew evals — DONE
Submitted 1:12 PM by Marcus Webb. Graded honestly:
- Rosa Delgado (KH, opened + truck, 116 tasks): all Great. Set as MVP.
- Tommy Nguyen (SL, close + cash): Great/Great/Good/Great — noted cash $2 short + closing submitted w/ incomplete items.
- Deshawn Carter (sloppy, 0 tasks logged): all Needs work + direct note re: pattern.
- Maya Torres (opening prep, timid): Great/Great/Great/Good — confidence-building note.

### Two-up eval layout verdict — WORKS
- Measured card positions: Rosa|Tommy share a row (left 248 / 528), Deshawn|Maya share the next. Genuine 2-column grid. Reads fine on a normal screen; each card is self-contained (4 dimensions + Area-to-improve + manager note + its own Save). No overlap, no cramping. The recomposition is good.

### Eval flow — how it FELT + friction (BUG?/FELT)
1. FELT: honest and fast once I understood it. Rating chips (Great/Good/Needs work) are quick to tap.
2. FRICTION — default is "Good" for everyone. Every dimension starts pre-selected on "Good," not blank. A rushed GM who just hits Submit rates the whole crew "Good" without a single deliberate choice. Grading is opt-OUT, not opt-in. This is the biggest flaw — it launders no-effort into a positive rating.
3. FRICTION — only crew with logged "shift activity" auto-appear as cards (Rosa, Tommy). Deshawn and Maya had to be ADDED from a dropdown. The irony: Deshawn logged 0 tasks and is the one most needing a "Needs work" — yet he's the one NOT surfaced automatically. Easy to forget to grade the person who did nothing in the system.
4. FRICTION — per-card Save button AND a global "Submit PM Report." Unclear whether Save-per-card is required before Submit. I did both to be safe. Redundant/ambiguous.
5. a11y nit — rating buttons expose no selected state to the accessibility tree (no aria-pressed); selection is conveyed by color only. Had to read computed styles to verify my clicks landed.
6. GAP — after submit, the MVP pick is NOT echoed in the read-only report readout (shift activity + eval cards show, MVP does not). I set Rosa as MVP but can't confirm it from the submitted view.
- No visible "saved ✓" confirmation on per-card Save (button just re-renders). Minor unease about whether it took.

---

## GOAL 3 — THE ACCOUNTABILITY TOUR — DONE
Visited BOTH dashboards + BOTH mid-shift pages, then dug into individual pages to establish ground truth.

### GROUND TRUTH (what actually happened today — found by DIGGING into individual pages)
- P STREET: Rosa opened + logged a Baldor delivery (#INV-88214, 5 items, PHOTO MISSING). Priya ran a physical inventory audit (On-hand list "Anchored to the audit Tue Aug 11"; Bacon/Duke's/Ham/Iceberg/Sub Roll/Tomatoes/Tuna all "Audited today"). Tommy did cash deposit 12:59 + closing 1:01 (dashboard: "Submitted with incomplete items"; cash −$2). Sales $270.25 / 3 checks. Maya prep, Deshawn 0 tasks.
- CAPITOL HILL: Angel logged a Baldor delivery (#BLD-88421, 5 items, PHOTO MISSING) AND placed a PFG order (MEP-20260811-PFG, 6 lines, "Placed"). Some par-pass/count activity (3-SKU discrepancy). NOT closed yet (Closing not started, cash not started). No Toast sales data. Opening "In progress."

### THE CENTRAL QUESTION: can a GM tell what happened from dashboard + mid-shift ALONE?  → NO.
Tested the four things a GM must see — deliveries, the count, orders placed, the close:

1. DELIVERIES → NO. Both DASHBOARDS show the generic empty CTA "Log a delivery when a truck arrives," even though a Baldor truck was received and logged at EACH shop today. MID-SHIFT has no receiving/deliveries panel at all. The "Photo missing" flag — exactly the kind of thing a GM chases — is buried two clicks deep on the receiving detail page. From the landing surfaces I would have sworn no truck came.

2. THE COUNT → NO. P Street's physical audit (Priya) is INVISIBLE on both the dashboard and mid-shift. The dashboard's "Inventory Audit" card shows the same generic "Run a full audit when the owner calls for one" whether or not a count happened. Cap Hill's inventory work surfaces ONLY as an oblique mid-shift alert — "Par-pass differs from computed on-hand for 3 SKUs — possible unrecorded waste" — which reads as a PROBLEM, not "a count was completed." (This count is the milestone event and you can't see it happened.)

3. ORDERS PLACED → NO. There is NO ordering status anywhere on the dashboard or mid-shift. Angel's placed PFG order only exists on /ordering. Zero signal on the landing surfaces that an order went out.

4. THE CLOSE → PARTIAL / the only one that works. P Street dashboard shows "Closing: Submitted with incomplete items" + "Cash: Deposited 12:59 PM by Tommy" — legible. Mid-shift shows Closing "Done" 1:01 + Cash "Done" 12:59. Cap Hill correctly shows close not started. BUT the two surfaces DISAGREE on quality: dashboard flags "incomplete items," mid-shift flattens the same close to a clean "Done." Mid-shift over-reports completion — a GM reading only mid-shift thinks the close was spotless.

### VERDICT: I had to open /operations/receiving, /operations/counts, and /ordering individually to reconstruct the day. Three of the four core events (deliveries, count, orders) do not surface — or surface only as a buried discrepancy alert — on the two pages that are supposed to BE the operational snapshot. Only cash/close reads cleanly, and even that mismatches between the two surfaces.

### OTHER BUGS/CONFUSED FROM THE TOUR
- BUG (Cap Hill mid-shift): Fridge temps panel says "All fridges in range" while the needs-action alert directly above says "8 fridges have no temp reading yet today." The empty state gives a FALSE all-clear. P Street (which had readings) showed real temps 36–39°F. Never show "all in range" when nothing's been read.
- Thin attribution: dashboard "Team" lists EVERYONE as "0 · Worth a check-in" even people who did real work (Angel received+ordered but shows tasks 0; Deshawn/Maya/Priya all 0). Mid-shift "Active today" only lists people who FILED A REPORT (Rosa/Tommy at P St; "No report activity yet today" at Cap Hill — despite Angel's delivery+order). Receiving/ordering/counts don't count as "activity."
- Reports statuses lie about the day: both shops show Opening "Overdue/In progress" and AM Prep "Overdue/Not started" — yet both ran a full day (sales, deliveries, P St closed). Can't trust the report statuses to tell me the shop opened.

---

## GOAL 4 — /reports hub — is today's story assembled? — DONE (verdict: PARTIALLY, and scattered)
- The Reports Hub IS a genuinely good report-artifact index: date range + search + Type filter + signal filters (under/over par, skipped, temp OOR, cash over/short). Today's P Street list: PM Report (Submitted, Marcus), Closing (incomplete_confirmed, Tommy), Cash ($2.00 short, Tommy), Opening (phase1_complete), Maintenance (OK).
- BEST fidelity on the close lives HERE, not on the landing surfaces: the hub shows Closing "incomplete_confirmed" and Cash "$2.00 short" inline — exactly what the mid-shift flattened to "Done." If I want the truth about the close, the hub beats the dashboard and mid-shift.
- BUT the hub only indexes REPORT-TYPE artifacts. It does NOT include the day's receiving (Baldor delivery), the inventory count/audit (Priya), or the placed order (PFG). Those three live in their own /operations/receiving, /operations/counts, /ordering silos and appear in NO aggregated view.
- /rollups (the natural home for "today assembled") = STUB: "Coming in Module #18 (Rollups)." Not built.
- Location-scoped only — no combined both-shops view. As a GM over both shops I re-read per location.
- VERDICT: today's story is SCATTERED. The report artifacts are assembled (well) in the hub; deliveries/counts/orders are not assembled anywhere. To know the full day I stitched together Reports Hub + Receiving + Counts + Ordering + mid-shift sales, times two locations. No single "here's the whole day, both shops" surface exists yet.

---

## GOAL 5 — Log out — DONE
- "Log out" button at the bottom of the dashboard. One click → returned cleanly to the "/" location picker. No confirmation prompt (fine for a shared tablet). Session ended.

---

## END-OF-SHIFT GM SUMMARY — "Can I see the operation from the screens?"
Short answer: only HALF of it, and only if I dig.
- What the landing surfaces (dashboard + mid-shift) show well: the CLOSE and CASH, sales (P St), fridge temps (when read), and overdue-report nudges.
- What they HIDE: deliveries received, the physical count/audit, and orders placed — the exact three things a floating GM most needs to confirm at end of day. All three happened at both shops today and are invisible/buried on the landing surfaces; I only confirmed them by opening /operations/receiving, /operations/counts, and /ordering directly.
- Consistency problem: the same close reads "Submitted with incomplete items" (dashboard) / "Done" (mid-shift) / "incomplete_confirmed" (reports hub). Three surfaces, three fidelities. The Reports Hub is the most truthful; the mid-shift is the most misleading.
- The Reports Hub assembles report artifacts well but not operations events; /rollups (the natural single-day home) is an unbuilt stub. No combined both-shops view.
