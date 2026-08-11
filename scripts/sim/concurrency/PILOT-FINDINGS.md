# CONCURRENCY SIM — pilot findings (2026-08-11)

Focused concurrency pilot to prove the harness + hammer the hottest shared-write
surfaces before the full directed-crew day. Directed-crew authority model: baton
passes GM/AGM (early) → SL (midday) → KH (closes alone). Harness in
`scripts/sim/concurrency/` (driver · coverage · races · race2-quantify), all
API-driven with service-role DB probes for invariants. Sim sandbox, prod untouched.

## VERDICT: harness proven, real signal found on the first pilot. GO for the full run.

## COVERAGE-GAP HUNT (the headline — authority baton vs enforced role floors)
Grounded the app's role floors against Juan's shift-authority schedule and
live-probed enforcement. Two real gaps, both CONFIRMED enforced:

- **CGAP-1 · Physical count = AGM+ (level 6); the KH who closes alone = level 4.**
  Live-probed: KH → counts = hard 403. An evening/closing count (the variance
  anchor) CANNOT be done by whoever actually closes the store. → Juan decides:
  intended manager-ritual, or should the closer be able to count?
- **CGAP-2 · PO reconcile = AGM+ (level 6); afternoon top role = SL (level 5).**
  An invoice needing reconciliation after the AGM leaves is stuck till morning.

Cleared (no gap): cash report, closing-confirm (dynamic floor resolved to L3 —
every closing item ≤ KH, so the lone closer CAN confirm), receive, par-walk, PM.

## RACE-INJECTION BATTERY
- **RACE1 PASS** · simultaneous get-or-create → exactly ONE instance (idempotent under race).
- **RACE3 PASS** · two people complete DIFFERENT items at once → both land, no lost write.
- **RACE2 ⭐ REAL FINDING (quantified 90%)** · two people complete the SAME item at the
  same tick → **18/20 trials produce TWO live completion heads, silently**; the app's
  documented `supersede_failed` guard fires only 2/20. Root cause: `completeItem` is a
  non-atomic two-phase write (insert via authed client, THEN supersede-prior via
  service-role) — under simultaneity neither insert sees the other, so neither
  supersedes. The docstring PREDICTS this exact state ("two live completions … worse
  than failing") but the guard misses it under a true race. Impact: duplicate live
  completions on a station item during a rush (Juan's exact multi-writer scenario);
  for an expects_count item, a potential double-count; downstream confirm/report logic
  assumes ONE live head per item. **Fix direction (post-pilot PR, NOT hot-fixed —
  load-bearing checklist path):** DB-enforce a single live head — a partial unique
  index on (instance_id, template_item_id) WHERE superseded_at IS NULL AND revoked_at
  IS NULL, with the second insert conflict-handled (mirrors the SIM-6 credit-index
  lesson from Day 1: same partial-unique-index family). Needs migration + lib change +
  test.
- **RACE4 DEFERRED (not an app failure)** · the double-confirm race couldn't run in the
  pilot: closing confirm correctly requires the Walk-Out Verification station complete
  (C.26 lock-up gate, `finalize_not_authorized/walk_out`) — a well-designed gate, and my
  harness completed random items, not the walk-out. Belongs in the directed-crew run
  where a real closer completes the walk-out naturally. Day 1 already evidenced confirm
  race-safety (0 duplicate final confirms under a full messy day).

## FOR THE FULL DIRECTED-CREW RUN
- Fix RACE2 first (its PR), then re-run the battery to confirm green.
- Add the marquee scenarios that need realistic setup: two-manager simultaneous confirm
  (post walk-out), staggered station closes (Crunchy Boi 1:30 → 3rd party 3:30 → rest 8pm)
  all writing one closing instance, KH mark-not-done racing a completion, two par-walks
  minting one vendor draft, two deliveries against one PO.
- Model the authority baton + shift-change SEAMS (highest overlap/contention).
- The full run keeps Day 1's data aged to "yesterday" so opening-verification chains.

## PILOT PROCESS NOTE
First race run showed 3 "fails" — verified each against the actual contracts BEFORE
reporting: RACE2 = real (docstring-predicted), RACE4 = harness-setup (invalid
preconditions, then the walk-out gate). Separating harness bugs from app bugs before
crying wolf is the whole discipline. Net: 1 hard quantified race + 2 coverage gaps.
