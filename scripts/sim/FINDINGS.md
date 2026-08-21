# SIM DAY — findings report (2026-08-11)

One compressed operational day, both shops, 9 AI-driven staff personas (haiku line
staff · sonnet KH/SL · opus AGM+/GM), one designated gremlin, two español personas.
Full narrated journals in `journals/`; blow-by-blow controller ledger in
`journals/_incidents.md`. The app was the REAL codebase against a byte-identical
prod-schema clone (`co-ops-sim`), all external legs dormant.

## VERDICT
The operational SPINE works end to end and is data-safe. Final DB integrity probe
after the full day: **0 duplicate final-confirms, 0 forked production heads** — the
council-arc flip-first/idempotence code held under real messy usage (gremlin,
500-retry, double-taps). 2 deliveries · 2 placed POs + transmissions · 2 first-ever
UI counts · 2 cash reports · 1 PM report — all clean. Every role gate repelled every
stranger, gremlin, and wrong-door attempt.

The GAP is not correctness — it's **legibility**. Individual screens are strong; the
dashboard doesn't compose their state.

## FIXED IN THIS PR (2 live P1s + hardening — all found by the sim, none seen in owner smokes)
- **SIM-6 · Lined-discrepancy credits never filed (P1, live since V1).** A `short`/
  `over`/`damaged` flagged ON a delivery line 500'd (`credit_write_failed`) while the
  delivery saved — the vendor debt silently lost. Cause: `vendor_credits_line_reason_uq`
  is a PARTIAL unique index; Postgres refuses it as a bare `ON CONFLICT` arbiter and
  supabase-js can't emit the predicate. Fix: app-side idempotency (read existing
  (line,reason) pairs → insert missing). Never seen because prior smokes used the
  missing-item path. `lib/receiving.ts`.
- **SIM-11 · /ordering 500'd for every key-holder (P1).** The walker's advisory on-hand
  called `loadOnHand`, which carries the counts SURFACE gate (AGM+) — so the walk died
  for the exact role it's designed for. Never seen: all prior smokes ran at owner level.
  Fix: derivation/surface split — `loadOnHandDerived` self-gates at the walker's KH+
  floor + location bind (hardened per the automated security review: an exported
  service-role read carries its own gate, never caller-delegated); the counts page keeps
  AGM+. `lib/counts.ts`, `lib/ordering.ts`.
- **i18n:** `receiving.error.credit_write_failed` en+es (was a raw key leak at the door).

## DEFERRED — needs clean-room debug, NOT guess-fixed (load-bearing)
- **SIM-22 · closing confirm 500-then-retry-200.** Final state CLEAN (no dup) so
  idempotence held; root cause ambiguous (race-loser surfacing raw guard error vs a
  closing-path status-precondition mismatch). Repro + systematic-debugging post-sim.

## TOP POST-SIM BUILD (3/3 manager convergence)
- **SIM-18 · The dashboard can't show the operation.** Priya, Nicole, Marcus — unanimous,
  independent. Deliveries/counts/orders are invisible or buried; the dashboard renders
  the empty "log a delivery" CTA WHILE a delivery exists. Put deliveries, counts, and
  orders ON the dashboard + mid-shift. **Dovetails with the recomposition arc's queued
  dashboard PR — same surface, now with a proven content spec.**

## OTHER REAL FINDINGS (ranked; full detail in _incidents.md)
- **SIM-25 (P1-display, safety-adjacent):** mid-shift shows "All fridges in range" while
  alerting "8 fridges have no reading" — false all-clear on a food-safety surface. Plus
  one close reads 3 different ways across 3 screens — pick one source of truth.
- **SIM-19 (count UX):** SKUs with no pack chain get a free-text unit box that accepts any
  word then rejects the WHOLE audit at submit; managers can't tell what's un-auditable.
- **SIM-16 (ordering):** Suggest doesn't net out already-on-order → double-order risk.
- **SIM-13 (on-hand panel):** honest plumbing, unreadable gauge — oz-only, no par/variance/
  cost; managers can't answer "am I short?" (feeds Dynamic Pars design).
- **SIM-9/SIM-10 (shared-tablet):** BACK repaints prior user's cached page; stale on-device
  receiving draft resurrects into a fresh intake. Need no-store on authed pages + user/day
  draft keying. (Repro on a prod build before filing.)
- **SIM-3 (discovery):** AM-prep + mid-day-prep unfindable by employees (3/3 employee agents).
- **SIM-12 (step-up UX):** count step-up prompts BEFORE payload validation — credential
  spent on a doomed save. Validate first.
- **SIM-20/21/23/24/26/27:** money absent across ordering/receiving (three-way can't close),
  invoice# shown where PO-code belongs + unordered-truck not flagged, cash "from Toast"
  not prefilled, drawer-float mental-model trap, eval opt-out-"Good" bias, /rollups stub.

## DATA (Juan) — SIM-4/SIM-15
- **Location codes/names are CROSSED in prod:** code `EM` → "P Street", code `MEP` →
  "Capitol Hill". Stamped on every PO display code. Intended or a real data bug?
- **Seed pack weights wrong/missing:** Ham 1 case=16oz vs Bacon 240oz; 37/79 PFG SKUs
  "no weight set" (the T13 missing-weight hints correctly flagged them — the app now
  points at exactly which SKUs your weigh-checklist errand needs).

## PROCESS
Two P1s hot-fixed mid-sim (unambiguous, obvious fix, re-verified live). One deferred
(load-bearing + ambiguous root cause). Automated security review caught the first
hot-fix's caller-delegated-gate shape → hardened. Data-integrity proven post-run.
Go/no-go: **GO for the full multi-day run** once the dashboard-legibility build lands —
that's the surface a multi-day run most needs to be worth watching.

---

# SIM DAY — product identity (2026-08-21)

Two days against the product-identity arc (#273–#280): a **vendor-down day** and a
**two-vendor count day**, per the spec's own verification clause. Full report:
`docs/sim/2026-08-21-product-identity-simday.md`. Harness: `scripts/sim/product-identity/`.

**Different shape from the 2026-08-11 day, deliberately.** That one drove nine Playwright
personas against a prod-schema clone (`co-ops-sim`). No clone exists today and this ran at
08:58 ET on a Friday, so instead the day runs the REAL server code against REAL production
rows behind a **mechanical write guard** — every non-GET PostgREST request is intercepted
at the fetch boundary and either captured (payload asserted on) or refused. Zero rows
written to prod. "The vendor is out" is injected in the PostgREST *response*, so every
layer above the wire is untouched real code. Trade: no fixture drift; writes proven by
captured payload rather than read back.

**VERDICT: 43 assertions, 0 failures.** All five of the arc's payoffs proved out — the walk
reroutes with the par carried, the cost board moves **0 of 68 rows** under a member flip,
the cook can record from the backup, two par'd twins give one suggestion, and a product
count writes member lines summing exactly to the entered oz with `allocated_from_product_id`
set. The mirrored false SHORT/OVER pair nets to zero at the product grain.

**6 P1s found and fixed, every one a path that had never executed** — invisible to a
phase-by-phase smoke by construction:
- the `product.resolution_flip` trail had **never been written once** (`audit_log.created_at`
  does not exist; fail-open + `void` dispatch hid it completely);
- the same misspelling in `maybeRefreshTodaySales` (pre-existing) meant the mid-shift Toast
  debounce **never debounced** — a fresh API pull on every render;
- the vendor-down walk rendered a false amber "nothing will be suggested" **above** its own
  blue "1 par moved to a backup" notice (the August SIM-25 class, sign flipped);
- two product lines for one product wrote two anchors per member SKU (council-L5);
- the recipe builder's new product picker was a **dead end** (the wire mapper dropped the field);
- the template publish guard rejected the new `equipment` link kind, failing the whole batch;
- plus a tenancy hole: a location-bound GM could set another shop's product primary.

**Open (data state, not code):** the entire delivery ledger holds ONE line for any product
member and its `resolved_oz` is NULL, so every FIFO surface is correct-but-silent until
receiving runs · 4 of 11 product rows (incl. HAM) have an empty level picker because their
primary has no pack chain — tell Juan before his first count, not during · the two-grain
on-hand panel is dark for HAM until that count.
