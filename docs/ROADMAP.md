# CO-OPS ROADMAP — the living "what's left" list

> **Canonical.** Council-produced 2026-07-29 (session `.claude/council/2026-07-29-roadmap/`,
> six blind seats, repo-verified). **Supersedes `docs/REMAINING_SCOPE.md`** (2026-06-13,
> severely stale — do not plan from it). Update this file at every arc-close; keep NOW
> capped at 3 builds. Dated entries; delete, don't strikethrough.
>
> **Last refreshed 2026-08-28** (Dynamic Pars arc close). Every figure in the
> 2026-08-20 and 2026-08-28 blocks was re-verified live against prod, not carried from
> a handoff.

**The strategic read (unanimous):** the center of gravity has moved from BUILDING to
LIGHTING UP. The deepest stacks (Toast depletion, the catering moat, pack chains) are
built and dormant behind owner externals. Converting dormant→live outranks new builds.

> ### ⭐ THE FIRST PHYSICAL COUNT IS UNBLOCKED (2026-08-20)
>
> Both engine defects that would have made its numbers meaningless have landed:
> **receiving now binds a receipt line to the delivering vendor** (#267, mig 0178 — before
> it, a cross-vendor line wrote price and slice weight onto the WRONG twin) and **the
> portioned recipes carry real masses** (#271 + seed 22 — before it, a 1.2 oz ham slice
> "became" a 34.4 oz bundle at ratios from 4.2× to 113.8×). Count today and the variance
> is arithmetic; count last week and it was noise.
>
> This does **not** revive the mandatory-count gate — the 2026-08-02 truth-model reframe
> below still stands, the shop still never census-counts, and the page is still the
> owner-invoked **Inventory Audit tool**. What changed is that running it is now worth
> doing: it lays the first `census` anchor (live: `sku_count_events` = **0**), and every
> downstream signal that waits on one — variance, the queued low-stock item, `loadOnHand`
> batching — fires off the back of it.

---

## JUAN'S ERRANDS (the highest-leverage list in this file)

1. ✅ **DONE — Toast is LIVE (verified 2026-07-31 against prod: live auth probe +
   daily cron.success + ~8k toast_sales_events since 07-23, both shops; GUIDs set
   07-25; crosswalk confirmed 07-25..27).** This errand was stale — the keystone
   already turned. What it unlocks is now a BUILD queue, not an errand: sales are
   banked but nothing consumes them yet → **depletion-into-drift is the real NEXT.**
2. **Resend DNS** → magic links reach real customers (today the allowlist gates them
   to juan@). Unlocks: real catering leads → the W1/W4 moat finally breathes.
3. ~~⚡ author PFG's and Boar's Head's order→delivery rhythm~~ ✅ **DONE 2026-08-28,
   the same day it was filed** — Cristian's schedule via Juan, seed 29 (executed,
   lead-gated): 50 pairs + 25 cutoffs across PFG · Boar's Head · Trimark · Cardinal ·
   Leonard Paper; vendors Leonard Paper / Whisked / Berger created. The recompute
   rendered **the arc's first suggestion** (P Street Prosciutto weekend 6→4) and its
   first five `par_unit_suspect` quarantine catches. Residue: confirm Leonard's
   next-day delivery (assumption A3, vendor-admin correctable); author Whisked/Berger
   pairs when their real weekly day is known; order MINIMUMS (PFG 10 cases · Leonard
   $350 · Trimark $350) still need a schema home.
4. **Two-minute decisions:** photo storage target (recommended: Supabase Storage);
   cash-gate → hard_gate fold (a single data flip on the template item — zero code).
5. Standing data errands (tools all built and waiting): 9 deli pack chains (the
   wizard) · 34-line needs-link backlog (the builder's Doctor) · shop weigh pass 2
   (calibration checklist) · catalog curation (on_hand flips, cleaning/misc classes)
   · fulfillment nodes radius config · catering rate rules authoring.
6. **Strategic decision when ready:** payment provider (Stripe/Square/Toast) — gates
   portal launch; has tax/accounting implications; deserves its own sit-down.
7. ⭐ **THE COSTING OPEN LIST (2026-08-20)** — the Angel arc priced everything a
   distributor invoice can reach; what is left needs a scale or a receipt, and each row
   below unblocks a specific number rather than a vague "more data". Ordered by leverage:
   - **Finished-jus quart weight** — the highest-leverage single weigh on this list.
     `Jus.oz_per_par_unit` is NULL, so `1 ladle` on Our French Dip cannot be costed at all
     (the line reads `unresolved` today, deliberately — see the arc note below). Filling it
     releases seed 23's gate AND opens the **missing-water recipe arc**: the cooked liquid
     preps (Jus, Vodka Sauce) don't record the water they add, so declaring their finished
     weights exposes them to the mass-balance guard. Expect that; it is the guard working.
   - **Five never-weighed preps** — Cucumber · Mortadella · Onion · Pickles · Radish ·
     Tomato still carry the stage-3d `1 unit` placeholder against a NULL par weight. Weigh
     one finished container of each and fill `items.oz_per_par_unit`. Until then the board
     refuses to cost the 10 menu items behind them (`unweighed`, 2026-08-20) rather than
     printing ~6×–160×-under figures. **Radish additionally needs Juan's ruling** on what
     "4 Julliened" means (#271 §4 — four radishes, or four strips?).
   - **Surprise-weigh pass 2** — EverRoast Chicken (its 1 oz/slice is SPEC, not measured —
     the only unmeasured entry in the piece model) + the tomato and cucumber slice
     guesses, which shipped graded EDUCATED GUESS.
   - **The 1.20× jug cluster — one tub on a scale settles four SKUs.** Angel measures the
     5 lb garlic tub at 6.00 lb and both jugs at exactly 1.20× nominal, which reads like a
     feed artifact rather than tare. If the scale says 6 lb, garlic's cost/oz falls 17%.
     Parsley's 1.40× is a separate question (likely a real weight).
   - **Pepperoncini vendor** — not in Angel under that name. Two Delmar neighbours exist
     (Banana Pepper Rings, Hot Cherry Peppers), both carrying Angel's fabricated 1.0 lb
     weight, so neither can be costed by weight until a real case weight exists. A live
     sourcing question, not a permanent gap.
   - **Six supply-run prices, from a receipt** — Lemon Oil · Mixed Herbs · Vanilla Bean
     Paste · White Wine · Worcestershire · Utz Ripples. Bought on a grocery run, so Angel
     structurally cannot see them and no future harvest will resolve them. Naming the
     category is the point: they need manual pricing ONCE, and co-ops can hold that because
     it starts from invoices generally rather than one distributor's feed.

## THE COSTING ENGINE — arc state (2026-08-20)

**✅ ANGEL ARC COMPLETE (waves 1–4 + harvest 2).** 31 price rows across 29 distinct SKUs,
every one dry-run-gated and Juan-eyeballed before `--execute`. Structural wins beyond the
prices: the **Boar's Head piece model** (Delmar invoices by the PIECE — the hidden `1 CT`
field — so seven deli SKUs got a one-piece pack chain and a `$/lb × piece-lb` price), the
**jug supersedes** (paired pack+price writes, cost-per-ounce provably neutral), and Juan's
**spec-vs-operational ruling**, which is the durable one: a slice's SPEC weight and its
OPERATIONAL weight had been sharing a column, costing and depletion take the operational
number, and `10-fill-sku-weights.ts`'s constants were amended so a re-run cannot regress
his measurements. Dry runs: `docs/seed/source/angel-wave{2,3,4}-dryrun.md`.

**✅ PORTIONING FIX LANDED (#271 + seed 22).** The 13 `(portioned)` recipes carried
stage-3d's `1 unit` placeholder, so the graph believed one ham slice became a whole bundle
— mass violations from 4.2× to 113.8×. Fixed against a named standard-trim registry
(Juan's ruling, evidence-graded per class), plus 11 build-line re-denominations and the
Horsey Mayo yield correction (4 → 2.25, verified live). Board: 21 `inconsistent` → 0.
Ham Sub $0.6777 → $1.2920; Roast Beef Sub $0.6941 → $3.4269.

**✅ CLEANUP BATCH (this PR).** Four engine-honesty fixes: unknown units REFUSE instead of
silently meaning par-units · `loadRecipeGraph` filters `recipes.active` (a RETIRED recipe
was defining Hot Peppers' and Antipasto Pasta's costs) · duplicate ACTIVE producers raise a
readiness warning · the mass guard's blind spot (never-weighed placeholder preps) gets its
own `unweighed` status instead of flipping to `costed` the moment a price lands.

**Engine hardening ✅ DONE (2026-08-21).** `computeSkuCostPerOz` was
**pack-chain-blind** — it took no `packChain`, so `/admin/skus` and
`/admin/vendors/[id]` used the LEGACY flat-field path while `/admin/menu-costing`
derived cost/oz from the graph's own chain-carrying pack data. The chain map is now a
REQUIRED argument (both pages already loaded it for the readiness badge), and the same
derivation feeds the received-oz ledger and consumed dollars, which were blind too —
fixing only the displayed $/oz would have put two disagreeing numbers in one drawer.

Correction to the old filing, verified live before building: the two paths did **not**
disagree in production. All 182 SKUs (63 chained) produced identical content_oz, because
`replaceSkuPackChain` writes a compensating flat-field mirror on every chain save. But that
mirror is a documented stopgap, it fails NON-FATALLY ("chain saved; flat fields stale"),
and `PATCH /api/admin/skus/[id]` writes `units_per_pack` without touching the chain — so
the agreement was one failed sync away from a silent, permanent split. With a stale mirror
the old code reported HALF the true $/oz. Pure math split to `lib/admin/cost-shared.ts` per
the `*-shared` law so it is finally testable (10 tests incl. a board-parity oracle).

## NOW (build — small, unblocked, dormant→live)

**✅ NOW COLUMN COMPLETE (2026-07-30):** photo uploader (#211, mig 0164), Written
Reports + Settings (#212), ops guardrails (#213 — cron visibility, backup runbook,
adoption card, mark-paid wiring, orphaned-mirror check). The board now waits on the
owner keystones below; the next NOW column gets written when one of them turns.

**✅ OWNER-INTERRUPT ARC (2026-07-30, same day):** the checklist FULL-EDIT arc —
meatball-question hotfix (#214) → prep full-edit floor (#215) → question input
types for closing lists (#216, mig 0165) → prep overview + Doctor in the builder
(#217). Council session `.claude/council/2026-07-30-checklist-fulledit/`. Named
follow-up with trigger: question input types on OPENING lists (fire when the
opening Phase-1 answer path learns input_type). Trust-recovery errand (Juan):
paper-audit the AM prep template + walk the opener through it once.

**✅ QUALITY-HARDENING PASS (2026-07-31):** 8-seat whole-app council → 5 fix
batches ALL merged (#224–#233): security/correctness (finalize gate, toast-map
IDOR, operational-day UTC family, sales silent-zero taint), visible breakage
(order-review cart-loss), the batching pass (reports-hub ~182→~5 queries),
seam hygiene (honest toast/shifts stubs, prune-sessions cron), UX/i18n
(IdleTimeoutWarning app-wide, /lto into (authed), specific link errors).
Q1/Q2 owner decisions closed in #234 (toast_daily_data KEPT + annotated;
gate-predicate engine kept, stale comments fixed). Register:
`.claude/council/2026-07-31-quality-hardening/report.md`. Deferred w/ triggers
→ DEBT table below.

**✅ MID-SHIFT PULSE ARC (2026-07-31/08-01):** 7-seat council (incl. a blind
Fable seat that caught the open-day gap-taint interaction) → 3 PRs ALL merged:
#235 live Toast sales panel + same-day pull triggers (closing-confirm +
45-min-debounced on-visit; EVENTS-ONLY law — nightly cron stays the sole
ledger materializer; open-day gap guardrail) · #236 location tabs +
active-today attribution + parallel loaders (~3-4×) + named overdue states ·
#237 Pulse Score (green/yellow/red) + catering-due-today strip (quiet when
empty — owner-confirmed) + unchecked-fridge alert. Session:
`.claude/council/2026-07-31-midshift-pulse/report.md`.

**✅ POST-HANDOFF AUDIT (2026-08-01):** full verification pass over the
2026-07-31 work (the arc was finished by a different model after a
mid-session handoff). 3 adversarial reviews (#235/#236/#237) + 1 review
(#232–#234) + a Batch A–D survivorship sweep: **every load-bearing law
verified CLEAN** (events-only lane, open-day guardrail × taint, price SUM,
IDOR binds, *-shared split, i18n parity) and **A–D ALL-INTACT**. Four real
P2s fixed in #238 (`ec7de7c`, deployed): sales-lane isolation (a Toast read
error no longer 500s /mid-shift), paginated+ordered day reads (snapshot-
versioned table vs the 1000-row cap), chronological catering-strip sort
(`timeWindowMinutes`, test-pinned — lexicographic put 1 PM before 10 AM),
and the **names-at-KH ratification** (owner 2026-08-01: strip shows
event/customer names at level 4, a deliberate exception to the pipeline's
level-5 floor; revenue stays 5+; recorded in `loadCateringDueToday`).
Logged-deferred → DEBT table.

## NEXT

- ✅ **Toast-depletion-into-drift DONE (PR #220 `a2ec9bd`, 2026-07-31; mig 0166).**
  Register sales now feed counts' consumed side via the direct-lane daily ledger
  (the double-count law: direct-sale SKUs vs production-covered SKUs, never both).
  Backfilled + lane-verified against the banked week (Sub Roll 4,728 oz direct /
  0 flattened at Cap Hill — ~150 rolls/day).
- ⭐ **TRUTH MODEL REFRAMED (Juan, 2026-08-02) — the "first physical count" errand is
  SUPERSEDED.** The shop never census-counts; the mandatory-count gate is dead by
  design (spec: `docs/superpowers/specs/2026-08-02-delivery-intake-ordering-design.md`).
  Ground truth = delivery intake (in) + depletion (out) + par-pass order signals, with
  source-tagged anchors `census > par_estimate > inferred`. The counts page becomes the
  on-demand **Inventory Audit tool** (owner-invoked, gates unchanged); cold start comes
  from a prep-activity inference base that real intakes accrue onto. Variance computes
  between census anchors only; estimate divergence surfaces as a shrinkage signal.
  **P1 (door ceremony) is BUILT** — count-by-exception intake, required receipt photo,
  discrepancy flags → `vendor_credits` ledger, offline drafts, dedupe/partial guards
  (migration 0168). The two queued builds (mid-shift low-stock item; counts `loadOnHand`
  batching) now fire on the FIRST PAR-PASS or audit instead (P3/P2 of the spec).
- ⭐⭐ **DYNAMIC PARS v1 IS SHIPPED AND WATCHING (2026-08-22/28, PRs #288–#292,
  migrations 0182 + 0183 both applied — gates M1 and M2 cleared).** The par now moves
  with demand and explains itself, in SHADOW: every night, chained after depletion
  materialization, the engine computes a base consumption rate (trailing 21 days,
  day-class split, observed-day denominators, lane- and time-clamped), a bounded
  velocity ratio, a coverage window off the vendor's real order→delivery rhythm, a
  policy cushion and an observed-peak floor — then simulates the FULL guard stack and
  records would-apply-vs-suppressed-by-which-guard. **Nothing applies itself**
  (`PAR_AUTO_APPLY_ENABLED` is false), and nothing can: `sku_count_events` is still 0,
  so the graduation gate's count anchor is unreachable by construction.

  **Live, re-probed 2026-08-28:** three nights have run (2026-08-25/26/27), **1 692
  ledger rows = 282 per shop per night** (141 par'd SKUs × 2 day-classes), all
  `mode = shadow`, exactly **one `par.auto_tune_shadow` audit row per (location,
  night)** — the Phase-3 success measure hit on the nose. Latest histogram per shop:
  `inventory_only` 114 · `no_lane_start` 98 · `no_weight_basis` 54 ·
  `no_production_capture` 10 · `no_vendor_rhythm` 4 · `unresolvable_pack` 2.
  **Zero suggestions render, and that is the arc succeeding, not failing** — the scope
  read was always "the reason lane is the product". **All 282 rows carry a correct,
  specific cause**, in English and Spanish, generated live: 114 are the NOT-A-FAULT
  `inventory_only` (packaging was never demand-derived, and it ranks first in the reason
  ladder precisely so those 114 never land on Juan's list as false chores), and **70 are
  a genuine, actionable errand** — 54 weigh-ins, 10 production captures, 4 rhythm
  authorings, 2 pack chains.

  ⚡ **THE ARC'S OWN #1 ERRAND, and it is five minutes: author PFG's and Boar's Head's
  order→delivery rhythm** (`/admin/vendors/[id]`, the new rhythm card). Live
  `vendor_delivery_rhythm` pairs: **0**. Those four `no_vendor_rhythm` rows per shop are
  the ONLY rows that clear every other rung — they are one authoring session away from
  the first number this arc ever renders. (Note the honest delta from the plan's
  forecast of ~14 lit rows: the engine's own first three nights say **4 per shop** reach
  the rhythm rung, because more SKUs sit at `no_lane_start` than the pre-build probe
  predicted. The ledger is now the authority on that number, not the estimate.)

  Spec `docs/superpowers/specs/2026-08-21-dynamic-pars-design.md` (four binding layers)
  · plan `docs/superpowers/plans/2026-08-22-dynamic-pars.md` (five phases, 16 blessed
  deviations, four lead-ruling blocks) · scenario regressions
  `scripts/sim/dynamic-pars/scenarios.ts` + `tests/dynamic-pars-scenarios.test.ts`.

- **Dynamic Pars — the enablers v1 named and did NOT build.** Each unblocks a specific
  term; none is a vague "more data".
  - **Quote-link on `productions`** — a production row cannot say which catering quote
    it was for, so the event layer can only NAME a catering date on the walker, never
    net it out of demand. This is also what kills the **single-count pollution** r2-12
    documents (a catering-driven prep is counted once, as ordinary demand). One FK and
    one capture field; it is the cheapest of the six and it upgrades the event layer
    from advisory to arithmetic. | trigger: real catering volume, or the first time an
    event visibly distorts a par |
  - **The resale marker on `vendor_items`** — still absent, still the blocker it was on
    2026-08-21 (below): "no recipe uses this" cannot be told apart from "sold as-is",
    and 16 of the 20 non-inventory par'd SKUs with zero recipe references are
    sodas/water/candy that are correct as they are. Dynamic Pars inherits the same wall:
    resale SKUs are scope-walled OUT of demand, and a marker is what would let them
    back in honestly. | trigger: a resale SKU's par actually going wrong |
  - **The statistical cushion** — the socket is BUILT and pinned (`cushionFor(sku,
    location, demandStats)`, `DemandStats.stdDevOzPerDay` reserved); the implementation
    (z × σ × √lead) waits on its data precondition: a year of per-location variance
    history. Until then cushion is POLICY (a per-class percentage) and the observed-peak
    floor carries the service level. Screwing the real one in touches no caller. |
    trigger: ~12 months of `toast_daily_depletion` at both shops |
  - **Add-a-Location / sibling designation** — the cold-start prior. `siblingBlendWeight`
    ships tested and DELIBERATELY unwired; the whole v1 footprint is that seam plus the
    `no_local_history` cause. Whole-pattern only — the depletion ledger has no channel
    grain, so a delivery-only prior is structurally infeasible without a ledger
    extension (r1-11). | trigger: shop #3 |
  - **The 27 par'd SKUs with contradictory flat weights** (`each_size ≠ avg_oz_per_each`,
    live-probed 2026-08-22) — **listed, never guessed.** This is the weight board's next
    census, and it sits directly behind `no_weight_basis`, the third-largest cause in the
    histogram above (54 rows/shop). | trigger: the next `/admin/weights` pass |
  - **The day-class boundary as tenant config** — "weekend = Fri/Sat/Sun" is CO's
    vocabulary, not a product invariant; a second restaurant's busy days differ. It is
    already a single named constant (`isWeekendParDow`, `lib/et-day-shared.ts`) and
    `dayClassForDate` is its one consumer in this arc, so the extraction is small — but
    it belongs with `tenant_role_labels` in the T1 wave, not before it. | trigger:
    tenant-config T1 (gate unchanged: 30 days of real use OR a named prospect) |
  - **The par-history drawer** — spec'd "if cheap", not built. `par_auto_moves` is
    indexed for exactly this read; it is one query and one `CollapsibleSection` on the
    SKU page, and it is what turns the nightly ledger into something a human can browse.
    | trigger: whenever the lead wants it — no dependency |

  - **THE THESIS IS JUAN'S, stated while ruling on product retirement (2026-08-21):**
    > *"it should be loud about going and changing the pars down… suggesting lower
    > pars when ordering because demand is lower from retiring a product from a
    > recipe… the pars should be loud about why they need to be tuned down when
    > demand lessens because of retirement. **The system recognizes what's going on
    > before the human does.**"*

    Pars are DOWNSTREAM of demand — they exist because recipes create demand — and
    that is the whole arc in one sentence. PR #283 shipped the **event-attributed**
    half: a retired product's par'd members are suppressed from the walk (suppressed,
    never mutated, so a restore is exact), and a SKU whose recipe stopped using it
    gets a cause-named par-review advisory that points at the par edit.
    **What #283 deliberately did NOT ship is the NUMBER** — "try 3 instead of 5"
    needs demand-rate math over a velocity window. **That is the arc above, and it is
    now shipped**: `parReviewAdvisory`'s binary, cause-attributed form was EXTENDED,
    never replaced, and the two lanes are structurally forbidden from co-rendering
    (the number wins; `lib/ordering.ts`'s one row builder enforces it).
  - **Two known blockers on the STATIC form, both live-verified 2026-08-21 and both
    still open:** (a) there is no RESALE marker on `vendor_items`, so "no recipe uses
    this" cannot be told apart from "sold as-is" — 16 of the 20 non-inventory par'd
    SKUs with zero recipe references are sodas/water/candy and are correct; (b)
    trailing usage is zero for all 20 (no `toast_daily_depletion.direct_oz` reaches
    resale SKUs and none has ever been received), so usage cannot substitute for the
    marker today. A resale flag, or a depletion path that reaches resale SKUs, unblocks
    the static sweep — and until one exists, static-state advisories stay refused.
    **Dynamic Pars did not dissolve this**: it scope-walls resale and inventory-only
    SKUs out of demand entirely (`inventory_only` is 114 of the 282 rows/shop, ranked
    FIRST in the reason ladder precisely so 114 false chores never reach the errand
    list). The marker is filed as an enabler above.
  - **Deferred detection half:** a `recipe_input` row DELETED outright leaves no trace
    in the graph, so it needs the `recipe_input.remove` audit trail rather than the
    active/inactive-recipe derivation #283 uses. Live count of those rows today: ZERO,
    so it was not built onto the walk's hot read path. **The Dynamic Pars half of this
    trigger has now fired and did NOT need it** — the demand engine reads oz lanes and
    observability oracles, never recipe topology, so a removed input reaches it as a
    falling rate like any other demand change. The trigger reduces to one condition. |
    trigger: the first real `recipe_input.remove` |
- ✅ **P2 — THE PRODUCT-IDENTITY ARC IS SHIPPED (2026-08-20/21, PRs #273–#281, migrations
  0179/0180/0181 applied).** The audit's deepest finding is closed: `products` sits above
  `vendor_items`, recipes pin the PRODUCT, and ONE pure resolution ladder
  (`resolveProductMember`, run once at graph build) answers for costing, depletion,
  production, counts and ordering — never four private opinions. A vendor going down now
  reroutes the par to the backup with the demand intact; two twins roll up to one on-hand
  number with a per-vendor split and a FIFO lot shelf underneath; a product-level count
  writes per-SKU lines that sum to the counted number exactly, so the mirrored false
  SHORT/OVER pair is dead. Shipped alongside: the weight & trim audit board
  (`/admin/weights`), the equipment link that dropped the needs-link backlog 34 → 2, and
  the twin-affirming collision check. Spec
  `docs/superpowers/specs/2026-08-20-product-identity-design.md` · plan
  `docs/superpowers/plans/2026-08-20-product-identity.md` · audit
  `docs/audits/2026-08-20-multivendor-semantics-audit.md` · sim day
  `docs/sim/2026-08-21-product-identity-simday.md`.
  **The follow-ons it created are in DEBT below; the two P1s there should land before
  receiving starts writing lots against member SKUs.**
- **P6 — usageRank seeded from Angel spend as a null-fallback.** Explicitly deferred out
  of the product-identity arc and now UNBLOCKED by it: members of one product already
  share the product's live trailing usage (`rollupUsageByProduct`), so the seed is a pure
  null-fallback beneath a working signal rather than the only signal. Prefer a nullable
  `seed_usage` column read ONLY when live rank is null (it decays naturally); **not**
  `guide_position`, which is a dead column with different semantics (walk order).
- **Weight / trim audit — SHIPPED as a board (`/admin/weights`); one thing still owed.**
  (a) ✅ **RULED 2026-08-21 — the `ESTIMATE` WEIGHT class is APPROVED** and minted in
  `lib/angel-wave4.ts` (`WeightClass`, ranked below every measured class by
  `WEIGHT_CLASS_RANK`). Seed 26's Phase-6a backfill ran on it — see below.
  ⚠ **This ruling covered the WEIGHT vocabulary, NOT the TRIM one.** The trim registry's
  `OPERATIONAL_ESTIMATE` (`lib/trim-standards-shared.ts`, `TrimEvidence`, four of its five
  classes) is a SEPARATE question and remains **open**: does an estimated trim class keep
  its own name forever, or is it a temporary badge that observed trim retires? The board
  ranks them but cannot rule. Do not assume the weight ruling settled this one.
  (b) First in line to be replaced by observed trim once production capture runs — pair it
  with the surprise-weigh pass so one floor session settles both.
- ✅ **Every product primary is now EXPLICIT — no inferences remain (2026-08-21).** Fresh
  Mozzarella was the last one: Juan gave the SHAPE on 2026-08-20 ("both active — one
  primary, one backup") but never the sides, so seed 18 inferred PFG and seed 24 wrote it
  flagged (`primary_is_inferred: true`). Juan confirmed it out loud on 2026-08-21 ("mozz is
  pfg confirmed"). `scripts/seed/27-mozz-primary-confirm.ts` updated the note and appended
  an `audit.metadata_correction` against the stale seed-24 row (audit rows are never
  edited). Verified live: all 11 primaries read `primary_is_inferred: false`.
- ✅ **Weight provenance backfill (seed 26) — COMPLETE 2026-08-21. 38 of 41 weighed SKUs
  carry a class** (28 ESTIMATE · 9 OPERATIONAL · 1 SPEC). Two sections, two authorities:
  **§1** copies the class EVIDENCE recorded and refuses wherever that evidence describes a
  superseded value; **§2** supplies OPERATIONAL from Juan's 2026-08-20 standing widening
  (*"the live values are what i weighted myself... it wasnt just the ham and stuff... you
  got it all"*) for six rows §1 refused — Genoa 0.4 · Capicola 0.4 · Provolone 0.7 ·
  Pepperoni 0.2 · Ham 1.2 (Baldor twin) · Cheddar 0.4. Their re-value had landed **without
  its own `sku.weight_fill` audit row**, which is exactly why §1 would not touch them.
  The audit trail records the two evidence strengths separately (`evidence_basis`): five
  are corroborated by `OPERATIONAL_SLICE_OZ`, **Cheddar rests on the widening alone**.
  Both sections re-run to zero writes.
- **THREE weights still carry no class, and each needs a different thing.**
  (a) **Utz Ripples (1.0 → 2.2) — ON THE WEIGH LIST.** Deliberately excluded from the §2
  widening: its change came out of **wave 4's PACK work, not off Juan's scale**, and a
  pack-derived number is not a measurement of a handful. **Weigh one handful** and the row
  settles itself. (b) **Basil (0.017)** — audited, but seed 11's `data_cleanup` row never
  claimed `estimate: true`, so the ESTIMATE ruling does not reach it; reading "estimate"
  out of its prose would be inferring a class from tone. Weigh or rule. (c) **Banana
  Peppers (Baldor, 512 oz)** — no audit row anywhere; nobody can say where it came from.
- **Retire the legacy `OPERATIONAL_SLICE_OZ` hardcode — FILED, NOT DONE (checked
  2026-08-21).** The consumer set is **not** mechanical: `lib/weights.ts` is LIVE CODE and
  uses it twice — the board's `ruling` field (`:502`) and the weigh-session drift tripwire
  (`:783`) — on top of three seed scripts and the test suite. The blocker is not the call
  sites, it is that **the table encodes a second fact the 0179 columns do not carry**: the
  ruled value as an INDEPENDENT reference, which is what makes `RULED_DRIFTED` detectable.
  `weight_class = OPERATIONAL` says a number was measured; it cannot say the row has since
  moved OFF the measured value, because nothing remembers what that value was. **Retiring
  the table therefore costs drift detection unless a `weight_ruled_oz` column lands first**
  — a migration plus a `rulingStatus` rewrite, not a mechanical swap. Do it as its own
  piece of work, or not at all.

## LATER (sequenced, not forgotten)

- **UX Phase 3 — the two approved proposals** (input-type picker · receipt-attach) from
  the 2026-08-19/20 refresh arc (#253–#262, ten PRs, all merged). Approved, not built.
- **Go-live batch — PARKED until Juan flips it.** The refresh arc's remaining go-live
  items ship as one batch on his word, not incrementally.

- **Store Ordering (Phase 5)** — the capstone every inventory arc points at (SKU par
  → purchase orders; sku_par + purchase_order tables are greenfield). After
  depletion-live. Par input starts STATIC (valid v1); Dynamic Pars enriches it.
- **Storefront i18n (`/order/*` Spanish)** — deliberately re-timed: the portal is not
  customer-live while payment + DNS pend; translate BEFORE launch, not before.
- **Deep Cleaning (#15)** — post-photo-seam (photo-verified by design); the template
  builder already supports the deep_cleaning type (lower lift than assumed).
- **Tip Pool (#11)** — decide the 7shifts-adapter question first (no adapter exists;
  without it, hours are manual entry permanently).
- **The comms family** — Announcements (schema exists) → Internal Comms → incident
  escalation path. Then: Shift Overlay + Prep Sheet + Today's Synthesis (read
  surfaces; want Written Reports live first) · staff Recipes viewer (cheap read) ·
  Rollups / AI Insights (need months of data) · Module #17 LTO measurement (needs
  lto_events volume) · admin Audit/Locations/Pars pages.
- **Food-cost % / margin dashboard** — the owner's number; natural fast-follow once
  Toast sales + inventory costs are both live. Not yet designed; on the radar.
- **Tenant-config T1** — GATE UNCHANGED: 30 consecutive days of real CO use OR a
  named warm prospect. Do not build speculatively.

## RADAR (named risks — not builds yet)

Monitoring/alerting (sustained 5xx at 6 AM = nobody knows; audit is fail-open by
design) · bus-factor/credential SPOF (one person holds every key; runbook + break-
glass access) · CCPA/data-export for portal customers (design before volume) ·
void/comp visibility depends entirely on Toast sales-pull · count-validation workflow
(periodic manual count vs the received−used advisory sharpens W4b TODAY, no code) ·
offline/dead-zone resilience (walk-ins, basements) · customer-facing menu display
(exists? wanted?) · first-live cred rotation when Toast write access lands.

## DEBT (each with its trigger)

| Item | Fire when |
|---|---|
| Opening photo capture UI (server ready) | next opening-client touch |
| Orphaned-mirror Doctor check | NOW (comment already promises it) |
| reconcileRefTrackItems N+1 batch | before ref_track real adoption |
| Spine-link DB CHECK + item_id FK action — **RE-TRIGGERED, NOT RETIRED**: the 0163 DEFERRED block was commented out because a `NOT VALID` CHECK would 500 the es-fill campaign on 34 legacy unlinked rows. Migration 0181 dropped that backlog to **2**, so the constraint is finally near-shippable | the last 2 unlinked lines get a target (then enable the 0163 block) |
| warn/info token surface hex collision | next theme touch |
| TemplateBuilderClient updater side-effect | next builder-client touch |
| order/build textarea aria association | next storefront touch |
| i18n dead-key sweep (whitelist-aware) | after stub modules build (their keys resolve) |
| rk()/TranslationKey cast class | when the i18n key map next churns |
| Storefront back-link constellation (~10 pages) | with the storefront-i18n arc |
| Dead exports: fetchPlatformOrders | delete opportunistically |
| AGENTS.md migration count + stale live-list line | fixed in this docs push |
| counts loadOnHand + detectRetroEditStaleness per-SKU batch | first SKU count (verify against real data) |
| loadPublicCateringMenu 3×/cart-cycle threading (D20 path) | real customer cart traffic |
| midshift low-stock/under-par attention item (designed) | first SKU count |
| lto_events pos_push_status write-back | Toast write-access phase |
| 108 `as TranslationKey` casts (folds into the rk() row) | i18n key-map churn |
| gate-predicate convergence (author opening predicate, delete loadPriorClosingState) | if/when configurable gates get a 2nd customer |
| midshift per-location EXPECTED_BY hours | when MEP/EM store hours diverge |
| catering_pipeline (location_id, event_date) index | real catering volume (table tiny today) |
| maybeRefreshTodaySales audit_log debounce — one-time EXPLAIN | audit_log growth felt on /mid-shift loads |
| loadMaintenanceOverview per-fridge serial loads | next maintenance-lib touch |
| ~~`computeSkuCostPerOz` pack-chain-blind on /admin/skus + /admin/vendors/[id]~~ — **✅ FIXED, engine-hardening batch (2026-08-21).** Chain map now a required argument; the received-oz ledger and consumed dollars share the same derivation. No live divergence existed (a compensating flat-field mirror was hiding it) — see the §Costing note above | — |
| `ladle` measure row — seed 23 written, gate CLOSED | `Jus.oz_per_par_unit` filled (see the costing open list) |
| Seed 22 §4 refusals: the radish line | Juan rules on "4 Julliened" |
| `location_sku_settings` STILL unseeded (0 rows) — but the overlay is no longer counts-blind: Phase 3 routes counts AND costing through `loadProductIndex`, which resolves `active` as `resolveActive(overlay, global)`. What remains is purely the DATA task | "shops use what they carry" becomes real (seed the overlay) |
| ~~`skuNameCollisions` will nag on doctrine-correct twins~~ — **CLOSED** (P7, folded into the product-identity arc: same-product twins are AFFIRMED, not nagged) | — |
| ~~Count sheet shows no vendor label on twins~~ — **CLOSED** (#267, and consumed by the count sheet's C-mode split rows) | — |
| `lib/types.ts` `VendorItem` ~10 columns stale (missing locationId, packFormat, unitsPerPack, eachSize, eachMeasure, avgOzPerEach, eachContainerLabel, inventoryOnly, skuClass, guidePosition) + vendorId/unit mistyped as non-nullable | next `types.ts` touch |
| **Receiving + PO panels are product-UNAWARE**: neither `lib/receiving.ts` nor `lib/purchase-orders.ts` reads `products`, so receiving or hand-adding a member of a DISCONTINUED product works with no badge saying so. Working-as-intended (burning down a final order is real — PR #283 documents the fall-through in both modules); what is missing is only the WARN. A notice is a new loader integration on two product-unaware modules, not a widened read — cheapest seams are `lib/receiving.ts` loadReceivingFormData's picker payload and `lib/purchase-orders.ts` loadPoDetail | first time a product is actually retired (zero today) |
| `/admin/menu-costing` is location-blind (`loadMenuCostingBoard` takes no location) — with per-location product primaries two shops could cost a sandwich differently; it prices against the GLOBAL primary today | when a shop's primaries genuinely diverge (deviation D7) |

### Product-identity arc — the sim day's leftovers (2026-08-21)

Full detail, class labels and file:line in `docs/sim/2026-08-21-product-identity-simday.md`.
Six P1s were fixed inside the sim PR; these are what it left.

| Item | Fire when |
|---|---|
| ~~**P1 · `loadProductLots` / `loadLastReceivedAt` spend the FULL delivery-id list as a GET `.in()` filter**~~ — **✅ FIXED, engine-hardening batch (2026-08-21).** Both loaders now scope to a location through an embedded join on `vendor_deliveries` instead of building the id list, so the request line is CONSTANT in the delivery count and the extra paged scan of the delivery ledger disappears. The embed must be disambiguated by FK constraint name (`vendor_delivery_items` carries TWO FKs to `vendor_deliveries` — 0178's composite binding is the second — and a bare `!inner` fails PGRST201; verified live, not inferred). Row-for-row parity confirmed before the swap. Arithmetic pinned at synthetic scale in `tests/supabase-paginate.test.ts` | — |
| ~~**P1 · `loadProductIndex` reads `products` with no `.eq("active", true)`**~~ — **✅ SHIPPED PR #283 (2026-08-21).** Juan ruled A+ ("Option A + loud recipes"): retirement is OPERATIONAL. `resolveProductMember` refuses a retired product at a new rung ⓪ with a named `reason`, so `lib/recipes.ts`'s premise is finally true. The fix is deliberately NOT the SQL filter — a filtered-away row poisons with no name; the active flag rides into the pure resolver instead. Plus a discontinue affordance that warns "N recipes still pin this" and never blocks, a loud recipe-line badge, and two readiness codes (`retired_product` red · `retired_sku` amber, loudness-only). Zero live triggers today | — |
| P2 · the 0179 provenance quartet goes stale — `lib/receiving.ts` + `lib/admin/skus.ts` overwrite `avg_oz_per_each` without touching `weight_class`/`weight_established_*`, so the board renders "OPERATIONAL, established by <old person>" for a number they never weighed | next receiving or SKU-editor touch (INVOICE_DERIVED already exists as the class for it) |
| P2 · item weights edited through the normal admin path write `item.update`, which the weight board's provenance lookup does not match → every one reads "nobody recorded where this came from" | with the quartet row above |
| P2 · `PATCH /api/admin/skus/[id]` sets `product_id` with none of `attachMember`'s invariants (silent re-parenting, attach-to-inactive, composite-FK **500** where the other writer raises a named 409) | next SKU-editor touch |
| P2 · `ReconcileSource.equipmentId` never populated → "Make B match A" on a fridge temp line is falsely refused as `unlinked_count`, the exact false positive 0181 exists to clear; and `copyItemsToVersion` writes `equipment_id` across versions with **no location check** | next template-builder touch (fix together — the second opens when the first closes) |
| P2 · `RecipeReadout` omits product lines from the per-batch oz while leaving `anyOz` true — prints a partial as a total on all 11 re-pointed recipes | next recipe-builder touch |
| P2 · `readiness-load` pushes nothing into `skuStatuses` for a RESOLVED product line → a recipe whose inputs are all product pins reads READY with every member SKU incomplete | next readiness touch |
| P2 · a member deactivated *at this location only* appears on neither the count sheet's product row nor its singleton list — uncountable, while `OnHandPanel` still shows its stock | when `location_sku_settings` gets seeded (the two rows are one task) |
| P2 · `CountForm` picks its advisory sentence off `absorbedByVendorName` when the field that means "nothing absorbed it" is `absorbedBySkuId` (which the client type does not carry) | next counts-UI touch |
| P2 · `QuickAdd` filters link targets by name only — no kind filter and **no location filter**, unlike the two pickers that were fixed | next template-builder touch |
| P2 · `lib/weights.ts` slices a UTC ISO to compare against an ET `business_date`; and `num(input_oz) ?? 0` fabricates a zero into the **denominator** of observed trim | next weights touch |
| ~~P2 · seven new `product.*` / `*.weight_fill` audit actions absent from `DESTRUCTIVE_ACTIONS`~~ — **✅ FIXED, engine-hardening batch (2026-08-21).** The live enumeration found **ten**, not seven: `product.set_active` postdates the filing (#283 deferred it here), `sku.weight_fill` predates the arc (#163), and `section_question.update` / `item_question.update` sat unregistered beside their own registered create/disable siblings. The registry header's "requires step-up auth" claim was STALE and had already caused one wrong decision — `isDestructive` only feeds the audit row's `destructive` column; step-up is enforced by route. So the additions are forensic-filter-only, zero behaviour change. Also added `lib/audit-actions.ts`: all 216 emitted actions adjudicated destructive/non-destructive with no silent third state, `AuditInput.action` typed as that union so an unlisted spelling is now a BUILD failure, + 24 tests. **Lead ruled on the 4 open families (2026-08-21):** `sku.pack_chain_update` and `item.set_type` are now **destructive** — both alter a basis other data silently depends on (the oz denominator every cost divides by; the item's semantic class), which is the registry's own criterion, and the forensic-only finding meant zero behaviour risk. `catering.kb.*` and `measure_unit.create` deliberately **left as-is** — see the row below | — |
| P2 · **classify the `catering.kb.*` shared-config family and `measure_unit.create`** — they look destructive by the same criterion as the registered `category.create`, but the real question underneath is *what exactly earns the flag*, which the registry-criterion review this batch's header fix started should settle. Not a drive-by: the answer likely reclassifies several families at once | **one sitting, as a criterion review** — not per-action |
| P2 · 0181's 32-row backfill wrote no `migration_apply` audit row (it cites 0071, which does) | next audit-vocabulary touch |
| P2 · `.or()` string interpolation without the house UUID guard in `loadProductIndex` (`lib/ordering.ts` has the same gap pre-existing) | one sweep, both sites |
| P2 · product routes hardcode `< 6` / `< 7` instead of importing `PRODUCT_READ_MIN` / `PRODUCT_WRITE_MIN`; 0179's two `alter table … add/drop constraint` statements are not re-runnable | next products touch |
| P2 · dead/unwired: `trimStandardForItem` (zero references), `lib/types.ts` `Product` + `VendorItem.productId` (zero importers), `attributeFifo` (named in the module header as one of the three answers, no app consumer) | next `types.ts` / knip sweep |
| **DATA · 4 of 11 product rows have an EMPTY level picker** (Banana Peppers, **Ham**, Hot Peppers, Sweet Peppers) — their resolved primary has no pack chain, so the count sheet asks the operator to type the unit. Not a code defect; the weigh / pack-chain errand surfacing as a UX cliff | Juan's first count — **tell him before it, not during** |
