# CO-OPS ROADMAP — the living "what's left" list

> **Canonical.** Council-produced 2026-07-29 (session `.claude/council/2026-07-29-roadmap/`,
> six blind seats, repo-verified). **Supersedes `docs/REMAINING_SCOPE.md`** (2026-06-13,
> severely stale — do not plan from it). Update this file at every arc-close; keep NOW
> capped at 3 builds. Dated entries; delete, don't strikethrough.
>
> **Last refreshed 2026-08-20** (costing-engine arc close). Every figure in the
> 2026-08-20 blocks was re-verified live against prod, not carried from a handoff.

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
3. **Two-minute decisions:** photo storage target (recommended: Supabase Storage);
   cash-gate → hard_gate fold (a single data flip on the template item — zero code).
4. Standing data errands (tools all built and waiting): 9 deli pack chains (the
   wizard) · 34-line needs-link backlog (the builder's Doctor) · shop weigh pass 2
   (calibration checklist) · catalog curation (on_hand flips, cleaning/misc classes)
   · fulfillment nodes radius config · catering rate rules authoring.
5. **Strategic decision when ready:** payment provider (Stripe/Square/Toast) — gates
   portal launch; has tax/accounting implications; deserves its own sit-down.
6. ⭐ **THE COSTING OPEN LIST (2026-08-20)** — the Angel arc priced everything a
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

**Engine hardening still owed:** `computeSkuCostPerOz` (`lib/admin/cost.ts`) is
**pack-chain-blind** — it takes no `packChain`, so it silently uses the LEGACY flat-field
path while 50 of the 77 recipe-referenced SKUs carry chains. `/admin/menu-costing` already
routes around it (it derives cost/oz from the graph's own pack data); **`/admin/skus` and
`/admin/vendors/[id]` do not**, so those two surfaces can show a different $/oz than the
costing board for the same SKU. Flagged in #271, deliberately not fixed there — different
surface, own PR.

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
- **Dynamic Pars — design session** (owner-called) once a count cycle + sales
  velocity have a couple of weeks of data. Weather bootstraps from the existing
  manual weather field on the daily report before any feed is built. Then
  EZCater 2c-b when the ezManage token lands.
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
| `computeSkuCostPerOz` pack-chain-blind on /admin/skus + /admin/vendors/[id] | next cost-surface touch (menu-costing already routes around it) |
| `ladle` measure row — seed 23 written, gate CLOSED | `Jus.oz_per_par_unit` filled (see the costing open list) |
| Seed 22 §4 refusals: the radish line | Juan rules on "4 Julliened" |
| `location_sku_settings` STILL unseeded (0 rows) — but the overlay is no longer counts-blind: Phase 3 routes counts AND costing through `loadProductIndex`, which resolves `active` as `resolveActive(overlay, global)`. What remains is purely the DATA task | "shops use what they carry" becomes real (seed the overlay) |
| ~~`skuNameCollisions` will nag on doctrine-correct twins~~ — **CLOSED** (P7, folded into the product-identity arc: same-product twins are AFFIRMED, not nagged) | — |
| ~~Count sheet shows no vendor label on twins~~ — **CLOSED** (#267, and consumed by the count sheet's C-mode split rows) | — |
| `lib/types.ts` `VendorItem` ~10 columns stale (missing locationId, packFormat, unitsPerPack, eachSize, eachMeasure, avgOzPerEach, eachContainerLabel, inventoryOnly, skuClass, guidePosition) + vendorId/unit mistyped as non-nullable | next `types.ts` touch |
| `/admin/menu-costing` is location-blind (`loadMenuCostingBoard` takes no location) — with per-location product primaries two shops could cost a sandwich differently; it prices against the GLOBAL primary today | when a shop's primaries genuinely diverge (deviation D7) |

### Product-identity arc — the sim day's leftovers (2026-08-21)

Full detail, class labels and file:line in `docs/sim/2026-08-21-product-identity-simday.md`.
Six P1s were fixed inside the sim PR; these are what it left.

| Item | Fire when |
|---|---|
| **P1 · `loadProductLots` / `loadLastReceivedAt` spend the FULL delivery-id list as a GET `.in()` filter** — unbounded by design ("the full receipt history"), ~39 bytes/uuid against Kong's 8–16 KB request line ⇒ a hard 414/400 at roughly 200–400 deliveries. `loadCountFormData` has no try/catch, so it 500s the whole count sheet, not just the product rows | **BEFORE receiving starts writing lots against member SKUs** — that is the day the list starts growing |
| **P1 · `loadProductIndex` reads `products` with no `.eq("active", true)`** — a retired product keeps costing, depleting, routing and rendering a count row, while `lib/recipes.ts` refuses writes on the premise that it would not. **Needs a lead ruling on what retirement MEANS** (registry-only, or operational), then one filter or one comment | next products touch — the ambiguity is the bug |
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
| P2 · seven new `product.*` / `*.weight_fill` audit actions absent from `DESTRUCTIVE_ACTIONS`; 0181's 32-row backfill wrote no `migration_apply` audit row (it cites 0071, which does) | next audit-vocabulary touch |
| P2 · `.or()` string interpolation without the house UUID guard in `loadProductIndex` (`lib/ordering.ts` has the same gap pre-existing) | one sweep, both sites |
| P2 · product routes hardcode `< 6` / `< 7` instead of importing `PRODUCT_READ_MIN` / `PRODUCT_WRITE_MIN`; 0179's two `alter table … add/drop constraint` statements are not re-runnable | next products touch |
| P2 · dead/unwired: `trimStandardForItem` (zero references), `lib/types.ts` `Product` + `VendorItem.productId` (zero importers), `attributeFifo` (named in the module header as one of the three answers, no app consumer) | next `types.ts` / knip sweep |
| **DATA · 4 of 11 product rows have an EMPTY level picker** (Banana Peppers, **Ham**, Hot Peppers, Sweet Peppers) — their resolved primary has no pack chain, so the count sheet asks the operator to type the unit. Not a code defect; the weigh / pack-chain errand surfacing as a UX cliff | Juan's first count — **tell him before it, not during** |
