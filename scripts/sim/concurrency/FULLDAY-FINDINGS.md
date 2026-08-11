# FULL DIRECTED-CREW DAY — findings (2026-08-11)

Ran the marquee multi-writer surfaces of a busy day as genuine concurrency
(`scripts/sim/concurrency/fullday.mjs` + `schedule.mjs`), on the sim sandbox with
the 0176 completion fix live. 7/7 concurrency invariants passed — with two honest
asterisks below. The core question Juan raised — "can multiple people use this at
once" — is answered YES for the checklist spine.

## PROVEN SAFE (real passes)
- **A · 53 concurrent multi-writer completions across ONE closing instance → 0
  duplicate live heads, all 53 landed.** The 0176 flip-first + index holds under
  real multi-hand load (staggered station closes writing the same instance). This
  is Juan's exact rush scenario.
- **F · completion-race regression under full load → 0/8 dups.** Fix holds.
- **B · two managers CONFIRM the close at the same instant → exactly ONE final
  submission** (the deferred RACE4, now validated under true simultaneity).
- **SWEEP · zero forked live heads anywhere after the full day.**

## ⭐ SIM-22 RESOLVED (Day 1's ambiguous confirm-500 — now pinned + fixable)
Scenario B's confirm race returned `200, 500/internal_error`: the winner 200s, the
LOSER's guarded flip finds status already flipped → `confirmInstance update returned
0 rows` → surfaced as a generic **500**, not a friendly 409. DATA is always correct
(flip-first guarantees one winner; 1 final submission). This is the DETERMINISTIC
repro of Day-1 SIM-22, and it settles the root cause: it's the **race-loser** (a
concurrent confirm OR a client double-submit/retry), NOT a status-precondition bug.
FIX (small, now-unambiguous): in confirmInstance, when the guarded open→confirmed
flip returns 0 rows, re-read status; if already (incomplete_)confirmed, throw a
clean 409 `already_confirmed` (+ i18n) instead of the raw 500. P2, improves the
exact multi-user UX under test.

## HONEST CAVEATS (passes that didn't fully fire)
- **C · two par-walk draft-generates** passed trivially (≤1 draft) because the walk
  returned `no_suggestions` — nothing was orderable (no seeded pars/on-hand), so no
  draft was mintable and the idempotency race never truly fired. To exercise it
  needs seeded suggestable SKUs. NOT yet a real proof of draft-race idempotency.
- **cash payload 400** (harness bug, non-blocking): my cash body is missing/mis-shaping
  a field. The confirm still succeeded, which also suggests cash isn't a hard gate for
  this closing template's confirm (or the walk-out completion satisfied the finalize
  gate). Worth a small harness fix + a note.

## STILL TO EXERCISE (next extensions of the harness)
- Draft-race C with seeded pars (real idempotency proof).
- Two deliveries against one PO (double-receive) — needs a placed PO first.
- KH mark-not-done racing a completion on one item.
- Cross-location + the shift-change SEAMS as explicit contention windows.
- The staleness/realtime question is a CLIENT concern the API harness can't test
  (every GET is fresh) — belongs to an LLM-persona or a realtime probe; flagged.

## VERDICT
The checklist concurrency spine is SAFE for multiple simultaneous users — the
council-arc guards + the 0176 fix hold under 53-way concurrent load and a
two-manager confirm race. One real UX bug (SIM-22 loser-500), now pinned and
cheap to fix. Ordering/receiving concurrency (C/D) needs a seeded-data pass to
exercise meaningfully.

## ORDERING RACES (seeded pars — Juan-directed follow-up, 2026-08-11)
Seeded a low census on-hand for 6 PFG suggestable SKUs so the walk actually
suggests (the pilot's C was vacuous — nothing orderable).

- **⭐ C · draft-generate idempotency — REAL BUG FOUND + FIXED.** Two simultaneous
  generate_draft for one vendor minted TWO drafts (`EM-...-PFG` + `EM-...-PFG-2`) —
  a double-order risk. Root cause: `noCodeSuffixRetry` only guarded the INSERT-
  collision (23505) path, but a rival whose in-memory scan saw the base code got a
  clean `-2` from nextFreeCode with NO collision, bypassing the flag. Fix
  (lib/purchase-orders.ts): under noCodeSuffixRetry the base code IS the whole
  allocation — never a suffix; base-already-in-scan OR 23505 both → 409 po_exists.
  Re-run: `409/po_exists, 201` → exactly ONE draft. FIXED.
- **D · two deliveries vs one placed PO — PO integrity HELD.** The guarded
  advanceToReceived flipped placed→received exactly once (no double-advance, no
  corruption) — the critical invariant. Minor note: two IDENTICAL concurrent
  intakes with NO invoice number both filed (the dedupe key is invoice-based);
  acceptable under the partial-delivery model, and real deliveries carry invoices
  that would dedupe. Not fixed (by-design-adjacent).

## SIM-22 fix verified
The two-manager confirm race-loser now returns `409/instance_closed` ("This
checklist is already confirmed", client re-fetches) instead of the raw 500.

## NET (batch 2, PR after this)
Two prod fixes: confirm race-loser 409 (SIM-22) + draft-generate idempotency.
Both found/validated by the concurrency harness; both invisible to sequential
or owner-level testing.
