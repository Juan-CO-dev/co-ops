# Dynamic Pars — design (2026-08-21)

Brainstormed with Juan 2026-08-21 (text session, from the shop — the day the ghost kitchen passed inspection). Every locked decision is his; drafting is CC's. Thesis, his words, already at the head of the ROADMAP entry: **"The system recognizes what's going on before the human does."**

Foundations this stands on (all shipped): the product-identity layer (resolution ladder, FIFO lots, per-location primaries) · cause-attributed par-review advisories (#283 — the event-driven special case this generalizes) · Toast nightly depletion (direct_oz lane, the double-count law) · the catering prep/SKU-demand ledgers (W4a/W4b) · vendor cutoffs + order-day config (0174/0175) · per-location overlay (`location_sku_settings`).

## The locked model

**Autonomy — TIERED ("A with a little auto on it," option C):**
- The system computes a suggested par per SKU per location per day-class (weekday/weekend, the existing split).
- **Small drifts self-apply**: band = **±1 order unit** AND **max one auto-move per SKU per week** (the thrash guard — a par that wiggles daily teaches managers to ignore pars; same law as false alarms). Every auto-move writes an audit row with the full why (demand terms, coverage math) and renders as a visible "par auto-tuned N→M" notice with one-tap revert.
- **Bigger moves are suggestions**: rendered on the walker beside the par ("par 3 → suggested 5") with the explanation and a one-tap accept. Nothing beyond the band ever moves itself.
- Velocity spikes may SUGGEST immediately; they AUTO-apply at most weekly.

**Demand — three layers (option C, Juan-extended):**
1. **Base**: trailing consumption average per SKU per location per day-class (the usageRank lanes: `production_inputs.input_oz` + `toast_daily_depletion.direct_oz` — never `flattened_oz`; the double-count law is inviolate). Window: trailing 21 days, day-class-split (tunable constant, config-in-code).
2. **Events**: booked catering demand from the prep/SKU-demand ledgers (W4a/W4b) — per-SKU oz already computed per order. The walker names the event: "par 3 → suggest 5 this order: [event] Thursday needs 38 oz."
3. **Velocity (Juan's addition)**: momentum from Toast sales — menu-item sales velocity flows through the recipe flatten to per-SKU demand trend ("Crunchy Boi up 18% over 2 weeks → mozz demand trending up"). The leading-indicator layer: it nudges the expectation BEFORE the trailing average catches up. Velocity contributes a bounded adjustment to the base rate (cap its influence — a viral week must not triple a par unaided; constant, config-in-code).

**Coverage — model A with C's socket:**
- **Par = demand-rate × days-until-next-delivery × (1 + cushion)**, computed against the vendor's actual order days/cutoffs (0174 config). Adding a delivery day automatically reshapes every suggestion.
- **Cushion = POLICY, not statistic**: a tunable percentage per SKU class (protein/produce/dry — defaults conservative, config-in-code with the class table documented). Explainable on the walker in kitchen terms: "4 covers you to Friday's truck plus 20%."
- **The C-socket**: the cushion term is a single pure function seam (`cushionFor(sku, location, demandStats)`). When a year of per-location variance history exists, a statistical safety-stock implementation (service-level z × σ × √lead-time) screws into the same socket without touching anything else. Documented as the deliberate upgrade path; NOT built now (thin variance data = confident nonsense).
- **Degradation ladder**: no vendor rhythm configured → fall back to delta-nudging (suggest proportional to demand shift, no coverage claim) · thin/no consumption history → advisory-null (NO suggestion, never a fabricated one) — the honest-null law.

**Scale-readiness (Juan: "ready to scale, not rebuild it" — CO is expanding NOW: ghost kitchen passed inspection + a third full store):**
- **Per-location from birth**: every rate, suggestion, band state, and audit row is location-keyed. No global par math anywhere.
- **Sibling-prior cold start**: a new location designates a SIBLING location; until its own history accumulates, demand rates inherit from the sibling (scaled by a tunable factor), decaying to own-data as it arrives (blend weight shifts with data volume; pure fn, tested). The ghost kitchen's sibling likely borrows the delivery/catering-shaped slice of P Street's pattern, not walk-in — the sibling designation carries an optional channel filter (delivery-only demand as the prior) if the data supports it cleanly; else whole-pattern prior, documented limitation.
- The "Add a Location" onboarding arc (SEPARATE, Juan-queued for its own brainstorm) will consume this: sibling designation is one field of location onboarding.

## Surfaces

- **The walker**: suggestion beside the par (accept = one tap, writes par + audit); auto-moves render as the tuned notice with revert. The existing par-review advisory lane (#283) carries the cause-attributed explanations — this build feeds it richer causes (velocity, events, coverage).
- **Ordering attention lane**: aggregate line ("3 pars auto-tuned this week · 2 suggestions waiting").
- **No new admin surface** in v1 — the walker IS the surface (read-surfaces-over-new-workflows law). A par-history drawer (the audit trail per SKU) rides the existing SKU detail if cheap.

## What it never does

Never moves beyond the band unaided · never suggests from thin data (advisory-null) · never fabricates a demand term (each of the three layers independently degrades to absent) · never mutates pars outside the audited paths · never overrides the retirement suppression (#283 — a retired product's pars get NO suggestions, only the down-tune advisory) · never touches the double-count law's lanes.

## Verification

Vitest for every pure term: base-rate windows, day-class split, velocity bounding, event summation, coverage math, cushion classes, band + thrash guard, sibling blend + decay, degradation ladder. Sim-day scenario before arc close: a demand-shift week (menu change mid-week) + an event week (catering spike) + a cold-start location. Juan smokes the walker per phase.

## Out of scope (named)

The statistical cushion (C — the socket exists, the implementation waits for variance-worthy history) · the "Add a Location" arc (own brainstorm) · resale/inventory-only SKU demand modeling (no recipe flatten — needs the resale marker filed in ROADMAP) · multi-vendor split-ordering optimization (which vendor to order a product from is the primary's job; cost-optimizing across vendors is a future conversation).

## Council review

Per Juan's instruction (2026-08-21): this spec goes to the seven-seat council for a gap-check before the implementation plan is written. Findings + dispositions will be appended.

---

## COUNCIL AMENDMENTS (six seats, 2026-08-21 — full report: ~/.claude/council/2026-08-21-dynamic-pars/report.md; all dispositions adopted)

**The v1 shape changes: SHADOW MODE first.** Opus's prod probe: the base can honestly speak for 9 of 141 par'd SKUs (6%) — production capture (0 rows) is the gate, not the first count; 82/141 lack a weight basis; 57/141 are inventory-only. v1 computes everything, writes the `par_auto_moves` ledger + notices, applies NOTHING. Suggestion-mode unlocks per-SKU as its lanes light (lane-coverage gate: prep-mediated SKUs = advisory-null until production flows — a half-seen base is silently low, worse than null). Auto-apply graduates per-location after a trust ramp (N accepted suggestions) + a count anchor. **The "why this par is silent" reason lane ships in v1** (no production capture · no weight basis · no vendor rhythm · thin history) — the flagship deliverable: the system recognizing what it can't yet recognize, generating Juan's data-errand list live.

**Structural corrections (unanimous or code-grounded):**
1. **Event layer = advisory-only in v1** (6/6: fulfilled events already enter the base via toast/production; `productions` carries no catering attribution so the base can't be cleaned). Named on the walker, never summed into a tunable number. Enabler filed: quote-link on productions.
2. **Coverage horizon config doesn't exist** — `vendor_cutoffs` has no delivery mapping; `delivery_days` on 4/18 vendors, not location-scoped, unloaded. The arc ships per-location delivery-days + lead on the EXISTING vendor admin; ONE authority fn `nextDeliveryAfter` (cutoff-aware); horizons crossing day-class boundaries sum per-day-class rates (never rate×days). No rhythm → honest delta-nudging.
3. **Rates at PRODUCT grain** (depletion rows are stamped with the resolved member; a primary flip would read as demand collapse at SKU grain). Suggestions attach via the product ladder to the par-carrying SKU; backup twins are never written.
4. **The machine writes its own lane**: `location_sku_settings.auto_weekday_par/auto_weekend_par/auto_applied_at`; `resolvePar` = human ?? auto ?? global. Human numbers always win; revert = null the auto column + a PIN (no re-apply while it stands, and reverts consume the budget); global `vendor_items` pars never auto-written.
5. **Band fully specified**: per (SKU, location, day-slot); ±1 order unit AND ≤25% of par; floor par≥1; auto-to-zero forbidden (suggestion only); ONE budget per (SKU, location) per rolling 7d consumed by every non-manual write; hysteresis deadband + two-consecutive-run direction confirmation (integer rounding oscillates otherwise).
6. **Velocity restructured**: a bounded dimensionless RATIO (residual above trend — recent Toast is already inside the trailing base, so a level term double-counts), 3+ day persistence, series resets on recipe edits, `suspectedCatering`-excluded (the detector exists, display-only — gets wired), suggestion-lane ONLY in v1; drops to v1.1 costlessly if the plan runs heavy.
7. **Denominators**: oz→order-unit runs through `perOrderUnitOz`; unresolvable pack → advisory-null with the reason. The pack/weight census gates coverage — the weight board is this system's foundation.
8. **Audit adjudication now** (compiler-closed vocab): `par.auto_tune` = system observation (actor null, non-destructive; the resolution_flip precedent) · `par.suggestion_accept` + `par.auto_tune_revert` = human acts, destructive.
9. **Cushion classes = per-SKU DATA** (tenant law; the taxonomy doesn't exist — authored in the same vendor-admin touch), percentages stay code. `cushionFor(sku, location, demandStats)` signature pinned with demandStats unused.
10. **Base mechanics**: day-class-segmented with OBSERVED-day denominators (mid-shift open-day guardrail inherited); per-day-class thin thresholds (21d ≈ 6 weekend points); 21d-rate vs 30d-usageRank divergence deliberate and documented.
11. **Sibling prior**: whole-pattern only in v1 (the depletion ledger has no channel grain — the delivery-only filter is structurally infeasible without a ledger extension; deferred to Add-a-Location); sibling-qualification threshold; per-SKU blend decaying by observed days.
12. **Scope walls**: resale + inventory-only SKUs OUT (a receiving-cadence model, different arc) · un-par'd SKUs get a named advisory, never an auto first par · new-SKU-at-existing-location cold start = known limitation · auto-apply runs in the nightly cron after depletion materialization, never on the walker's read path · walker renders ONE number pair (accepting a suggestion live-recomputes order qty; the #283 cause advisory and the numeric suggestion never co-render).
