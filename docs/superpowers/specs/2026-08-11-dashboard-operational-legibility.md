# Dashboard build — operational legibility (spec seed, 2026-08-11)

**The problem (proven, not assumed):** the concurrency+persona sim's #1 finding,
3/3 managers independently (Priya/Nicole/Marcus): **the dashboard can't show the
operation.** After a real day of deliveries, counts, and placed orders, the
landing page still renders the empty "log a delivery when a truck arrives" CTA
*next to* a logged delivery, and the count/order state is invisible or buried.
Managers had to open /operations/receiving + /counts + /ordering across 2
locations to reconstruct the day. Only cash/close surface cleanly today.

**The build:** make the dashboard (and mid-shift) COMPOSE today's operational
state — deliveries, counts, orders — so the accountable person sees the day from
the landing surface alone. This is the recomposition arc's deferred dashboard PR,
now with a proven content spec.

## Foundation already in place (don't rebuild)
- **Layout**: PR #245 gave the dashboard the house width shell + a responsive tile
  grid (2-up tablet, 3-up desktop) + the composed header zone. The SHAPE is done;
  this build adds CONTENT surfaces into it.
- **Loaders already exist** (read surfaces over new workflows — house law): 
  `loadTodaysOrders` (lib/purchase-orders.ts — today's PO board incl. status),
  `loadRecentDeliveries` (lib/receiving.ts — today's deliveries w/ badges + PO code
  thread + missing-photo flags), the counts on-hand/last-count state
  (lib/counts.ts). The dashboard already renders OpeningTile/AmPrepTile/
  MidDayPrepTile/ReceivingTile/CountsTile/CashDepositTile/PmReportTile — but the
  operational ones are ACTION nav tiles ("log a delivery"), not STATUS surfaces.

## Design intent (brainstorm with Juan before building)
The gap is action-tiles where status-tiles belong. Candidate shape (to confirm):
- **ReceivingTile → status**: "2 deliveries today · 1 missing photo · last: Baldor
  EM-…-PFG" instead of the static "log a delivery" CTA. Empty-state stays the CTA.
- **CountsTile → status**: last count date + whether today's walk/count happened.
- **A today's-orders strip**: vendors ordered today + status (draft/placed), cutoffs
  still open — reuse loadTodaysOrders + the ordering attention item.
- **Mid-shift page**: same operational composition (it's the mid-day pulse surface;
  the sim found its "All fridges in range" false all-clear (SIM-25) — fix that here
  too: a no-reading fridge must never render in-range).
- Curated elevation, EmptyState for genuine empties, the tile grid from #245.

## Sim findings this build should ALSO close (bundle candidates)
- **SIM-25 (safety-adjacent)**: mid-shift shows "All fridges in range" while alerting
  "8 have no reading" — false all-clear on a food-safety surface. Fix the fridge
  aggregation. + one close reads 3 ways across 3 screens → one source of truth.
- **SIM-18b**: the ordering board didn't live-update after a walk (router.refresh gap).
- **SIM-13**: on-hand panel is unreadable as a gauge (no par/variance/cost) — probably
  its own follow-up, not this build, but note the overlap.

## Process
Brainstorm the exact tile/strip shapes with Juan (his floor knowledge = which 3-4
facts a GM most needs at a glance), then subagent-driven build per the house loop,
Juan smokes on preview (visual = his eyes gate), PR. No migration expected (read
surfaces over existing artifacts). Related: recomposition arc, sim-day memory.
