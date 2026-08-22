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

---

## ROUND-2 AMENDMENTS (six seats re-reviewed the amended whole, 2026-08-21 eve — full synthesis: ~/.claude/council/2026-08-21-dynamic-pars/report-r2 section of report.md. Verdict: 12 of 13 clusters HOLD; one BROKEN-BY fixed below; all new gaps closed.)

**THE FIX (unanimous, prod-grounded): the band speaks in PAR STEPS, not units.** 36/141 pars are deliberately fractional (0.25-case Dijon etc.); 77% are < 4. As previously written (±1 unit AND ≤25%) the auto tier was empty for par ≤ 3 and would have inflated 34 fractional pars up to 4×. RESTATED: each SKU carries a **par step** (its quantum — default 1, fractional-par SKUs their observed grain, e.g. 0.25); auto-move magnitude = **max(1 step, 25% of par)**, floor = never below one positive step, rounding = to the step; **the machine never creates a par slot that doesn't exist** (121 SKUs have no weekend par — an auto weekend write would flip which number governs Fri/Sat/Sun; slot creation is suggestion-only forever); fractional pars render as fractions (they're real), order qty ceils.

**Closures (converged, adopted):**
1. **Rhythm storage home**: per-location delivery days + lead live in a location-scoped rhythm element (the `vendor_cutoffs` location-scoping pattern; `vendors.delivery_days` is vendor-global and is NOT it) — the plan names the exact schema.
2. **Trust ramp gets a denominator + a decline verb**: `par.suggestion_dismiss` adjudicated (human, non-destructive — declining changes nothing); ramp = N accepted of M offered within a window (defaults N=10, config-in-code); accept/dismiss affordances live on the walker suggestion itself. A post-graduation revert counts against standing.
3. **Graduation widens the TRIGGER, never the write set**: auto-apply writes only lane-lit SKUs regardless of location graduation; dark-lane SKUs stay advisory-null. Count-anchor oracle = physical `sku_count_events` at that location.
4. **Shadow writes get their own audit name** (`par.auto_tune_shadow`) — one action name may not mean computed in v1 and applied in v2 under the compiler-closed vocabulary.
5. **The lane gate clamps longitudinally too**: observed-day denominators clamp per SKU-lane to `lane_start_at` (the day production capture starts, 18 of 21 window days are structural zeros — the half-seen base in time, not just in lane).
6. **Standing auto values self-invalidate** when the global par they were computed against changes (the row records its computed-against baseline; a human's global edit always reasserts the human lane).
7. **Shadow SIMULATES the full guard stack** — the ledger records would-apply vs suppressed-by-WHICH-guard with simulated budget + pin, so the guards are battle-tested before graduation flips the write bit (same code, mode flag; sonnet's defer-the-write-path scope note resolves the same way).
8. **Budget + PIN grain = per (SKU, location, day-slot)**, matching the band. Budget consumed by auto-writes and reverts ONLY — a human accepting a suggestion never burns it (the incentive must never punish engagement). Revert keeps the PIN, drops the double-guard budget burn... corrected: reverts DO consume budget (they are non-manual par writes) — final: budget consumed by auto-writes + reverts; accepts free; PIN stands until a human par edit on that slot clears it (a manual write = the human re-engaged); no auto-expiry, intended and stated.
9. **Reason lane's home = the attention lane / an admin aggregate** (per-cause errand list). In v1 it fires on ~94% of rows — three claimants on one walker row at 6 AM is over-correction; the walker badges silence only once silence is the minority.
10. **Velocity keeps BOTH gates**: 3+ day persistence AND a minimum item-volume floor (a sustained 3-item/day +200% ratio passes time but not volume).
11. **Day-class boundary = the SHIPPED definition** (weekend = Fri/Sat/Sun, `lib/ordering.ts`): 21 days ≈ 9 weekend points, not 6; the base and the par slots share one boundary.
12. **Stated v1 limitation**: recurring-event consumption pollutes the base once per cycle (single-count) until the productions quote-link enabler ships.
13. **The data critical path, named**: weight basis (82 missing) → vendor rhythm (18 vendors) → cushion classes (~120 rows). Coverage is dead without the first two; the reason lane generates this list live and the vendor-admin touch batches the middle one.

---

## ROUND-3 AMENDMENTS — THE EXHAUSTIVE PASS (six seats, deep tier, 2026-08-22. Verdict: GO ×5, NO-GO ×1 whose two conditions are RULED below. Full responses + synthesis: the council dir. THE ROUND'S REFRAME (opus): three rounds specified the AUTO tier — but v1 ships the SUGGESTION tier, which was ungoverned. Fixed below. Scope honesty, prod-walked: exactly 14 rows (7 SKUs × 2 locations, one vendor, weekday-only) can produce a coverage number in v1 — THE REASON LANE IS THE PRODUCT.)

**The two head rulings that clear the NO-GO:**
- **R3-A (horizon timing)**: the coverage horizon is a READ-TIME pure selection evaluated at walk-time cutoff state (the walker already loads cutoff state at render; the write-on-read law forbids mutations, not selection). The nightly ledger records the horizon it computed with; the rendered suggestion recomputes the horizon live — the 9:58 and 10:02 walks correctly differ, with the covered-to delivery named in the reason string. `nextDeliveryAfter` never reuses `governingCutoffTime` (its earliest-cutoff tiebreak is a display rule).
- **R3-B (flip write-home)**: auto values are conceptually product-grain, physically homed on the STABLE PRIMARY's slot via the resolution ladder — never written to a transient carrier (a backup write orphans on restore).

**Suggestion-lane governance (the tier v1 actually ships):** hysteresis + a stable suggestion GENERATION-ID govern what renders — the walker may not read 12→1 Monday and 12→2 Tuesday · the trust ramp counts DISTINCT GENERATIONS, not nightly renders (a standing suggestion re-offered 14 nights = 1 offer) · superseded-unactioned offers expire without ramp penalty.

**Degenerate-suggestion quarantine:** NULL `lane_start_at` = advisory-null, stated · a zero target is NEVER a suggestion (reason-lane row) · a target <50% or >200% of the standing par = "par unit looks wrong" reason row, never a number (the Fresh-Mozz eaches-vs-cases bomb) · suggestions FLOOR at observed-peak coverage (max-run/p90 over the horizon within the window) until the statistical socket fills — a percentage on a mean is not a service level (the Prosciutto proof: mean+20% suggested a par the worst observed weekend cleared by 2%).

**PIN/lane semantics, final:** the act that sets a PIN never clears it (a revert is a human write — r2's clause was self-defeating) · only a DIRECT human par edit at the same (SKU, location, slot) clears a PIN — global edits invalidate auto VALUES but leave pins standing · a human blanking their own override also NULLS the auto column on that slot (blank-to-global must not resurrect a stale machine number) · both `item_par.update` and `par.suggestion_accept` clear pins (two names, one column-write).

**Authz + concurrency (accept was a privilege escalation):** ONE par-write authority fn with an actor-kind (admin / accept / machine); accept/dismiss/revert floor = **GM ≥6** (render visible ≥4 for transparency; today's only par-writer is GM + step-up — a KH one-tap would escalate) · all three routes carry idempotency/409 guards keyed on the suggestion generation (the SIM-22 race, proven on this exact surface) · `location_sku_settings` RLS stance stated in the migration (service-role-only law) · the existing admin settings route EXCLUDES the auto columns (the machine-lane bypass).

**Cron + data-trust:** a `depletion_current_through` watermark per location gates the pars step — materialize-failed locations get advisory-null, never stale-computed (the pull is verifiably best-effort today) · idempotent per (run_date, SKU, location, slot); retries never double-write · full-gap days (zero events AND zero ledger — invisible to the existing guardrail, measured 8.3% silent down-bias) become a named gap class: EXCLUDE the day, never null the window · audit volume: ONE run-level row per (location, night); per-SKU detail lives in `par_auto_moves` (282 rows/night would be 21× the entire audit log annually).

**Rhythm schema, final:** order→delivery PAIRS (the arrays don't map — Baldor orders 3 days, delivers 2) · rhythm rows are EXPLICITLY per-location (no NULL=all-shops inheritance — the ghost kitchen must not silently inherit P Street's trucks) · legacy `vendors.delivery_days` is never read.

**Shadow honesty:** "in shadow" is ONE global walker banner, never a per-row reason (100% of rows would badge) · shadow notices say "WOULD tune 3→4"; the revert affordance is disabled until application is real · `par.auto_tune_shadow` registered (incl. the SQL-emitted/RESERVED path if the cron emits in SQL).

**Small-par + band, final:** pars ≤3 steps are BELOW THE BAND'S RESOLUTION — manual-only, suggestions labeled as such (max(1 step, 25%) silently overrode the cap upward exactly where ±1 step is the largest relative swing) · the cap clamps AFTER rounding · budget grain = day-CLASS (two slots; "day-slot" renamed throughout) · the weekend slot's auto-move optimizes the longest-gap walk day (Friday); per-walk-day nuance rides the R3-A read-time horizon · a within-band-but-budget-blocked delta gets its own reason cause (never a silent stale par).

**Also final:** count-anchor requires `allocated_from_product_id IS NULL` (a product-count allocation must not anchor every member at once) · a vendor-down week gets a one-off rhythm-skip affordance (else the manager's outage handling reads as par disagreement and burns state) · sibling inheritance carries per-SKU lane-lit/dark status (darkness must not launder into a prior) · migration sequencing per the 0180 probe precedent, auto columns LAST, byte-identical walker pre-apply · i18n: full-sentence keys per cause, en+es, `formatDateLabel` for day names · day-class boundary (weekend=Fri/Sat/Sun) = one named tenant-shaped constant · known conflict class: 26 par'd SKUs carry contradictory flat weights (each_size ≠ avg_oz_per_each) — the weight board's next census, listed not guessed.

**SPEC IS FINAL. GO for writing-plans.**
