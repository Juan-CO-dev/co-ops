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
