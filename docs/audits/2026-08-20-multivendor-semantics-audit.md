# Multi-vendor SKU semantics audit — 2026-08-20

Read-only audit (Opus subagent, CC-verified anchors) of every surface's behavior against Juan's ratified multi-vendor doctrine: separate SKU per vendor · multiple active as backups · vendor-down routes to the other · shops use the SKUs they actually carry · guidance by what we buy most.

## The architectural headline

**There is no product-identity layer above SKUs.** `vendor_items` has no `item_id`/group/parent column (CC-verified live: 0 association columns); `item_components` holds exactly 1 row (dead); the live recipe graph runs on `recipe_inputs` with an enforced one-SKU-XOR-one-item per line (`lib/recipes.ts:311`). Two vendors' hams are two independent universes; nothing knows they are one product. The separation half of the doctrine is airtight; the backup/failover/guidance half has NO representation. (`scripts/seed/02-skus.ts:19-20` documents the deferred "Q3 search-time grouping model" — never built.)

## Live bleed (CC-verified 2026-08-20)

11 products have SKUs from 2+ vendors; in all 11 exactly one twin is active. **Ham and Fresh Mozzarella are UNORDERABLE in prod today**: par sits on the INACTIVE PFG twin (3.00 / 12.00), active+recipe-pin sit on the Baldor twin with NO par — the walker requires both on one row (`lib/ordering.ts:419,484`). The only 2 par-but-inactive SKUs in the registry are exactly these twins. Ham = $2,164.94/yr spend the walker cannot suggest. (The Angel price fill wrote Ham $2.77 to the ACTIVE Baldor twin — visible to costing, vendor-attribution knowingly crossed, recorded in its source_note; resolved by the P1 adjudication.)

> **UPDATE 2026-08-20 — P1 EXECUTED, and the paragraph above is now HISTORY for those two pairs.** Per Juan's adjudication both twins of each pair are ACTIVE with **PFG primary** (holds the par + the price) and **Baldor backup** (active, pars NULL so the walker cannot double-suggest). Ham and Fresh Mozzarella are ORDERABLE in prod. Script + evidence: `scripts/seed/18-twin-adjudication.ts` · `docs/seed/source/twin-adjudication-dryrun.md`. **Two things did NOT move and are still open:** (a) the recipe pins stay on the Baldor twins — the pinned lines are `1 unit` (a COUNT measure), so their oz value is the SKU's own `avg_oz_per_each` (Baldor 1.2 / 1; PFG NULL), and re-pointing would resolve them to null rather than to a different number; (b) Fresh Mozzarella is still unpriced (Angel's `6/2 LB` = 192 oz case has no whole relation to our `72 count` PFG pack). Both are P2 wearing a P1 costume — the pin cannot follow the par until something owns what one "unit" of the product weighs. Lettuce and the other 8 multi-vendor products were NOT adjudicated and were not touched.

## Per-surface verdicts

- **COSTING — honors.** Pure per-SKU map lookups; no first-wins among vendor SKUs anywhere; pins are authoring-time and deliberate. ONE adjacent accident: `buildRecipeGraph` first-wins on DUAL-RECIPE producers (`prep-consumption-graph.ts:210`) with an unordered `recipes` select (`prep-consumption.ts:99`) — and live, the two Hot Peppers recipes pin DIFFERENT vendors (Baldor 512 oz inactive vs Boar's Head 1 unit active), so a row-order coin-flip picks a vendor and a 512× oz basis. Also `loadSkuPack` includes inactive SKUs (correct for historical replay; means deactivation never unpins).
- **DEPLETION/COUNTS — violates. Deepest break.** Per-SKU grain, zero roll-up, consumed term bound to the recipe pin with no active-check/fallback. Pin A dead + receive B ⇒ A drifts negative (reads OVER, glossed as uncounted receipt) while B inflates (reads SHORT, glossed as shrinkage) — mirrored false alarms, nothing nets them. Amplifiers: production dropdown derives from pins so a cook CANNOT record production from the backup SKU (`lib/production.ts:90-108`); inferred baselines skip the unpinned twin and freeze first values (`lib/counts.ts:446,468`); inflated on-hand suppresses reorders via the ordering advisory. Counts also never reads `location_sku_settings`, and `CountSkuOption` carries no vendor label — two active twins render as two identical "Ham" rows.
- **ORDERING — violates.** Model is per-vendor walk, gate = par(overlay-resolved) AND active on the same row. (1) Vendor-down = bare `continue` — demand evaporates, no notice, no rerouting; backup ordered only if it independently has a par, and it sorts last (null usage → -Infinity). (2) Both-active = double-order path: dedupe is SKU-identity only; two Suggest chips, two POs, no warning. (3) `createSku` has no duplicate check. `par_levels` table fully dead; no item-level par exists.
- **RECEIVING — ambiguous (leans violate).** Vendor-scoped in the browser only; the shared server validation (`lib/receiving.ts:596-601`) never selects vendor_id — a cross-vendor line writes price + avg_oz_per_each onto the WRONG twin; credit path same (`:729-734`); no composite DB constraint. po-match's safety is inherited from PO scoping, so this gap transitively breaks it. Email matchers clean.
- **USAGE GUIDANCE — violates the intent.** usageRank = trailing-30-day consumed oz (recomputed live; no stored column) — follows the recipe PIN, not purchases: the twin with the real spend reads null and sorts LAST. No cross-vendor "we buy this most" signal exists. Seat for Angel spend: NOT `guide_position` (dead column, different semantics — walk order; recon R7 already ruled against); prefer a nullable `seed_usage` fallback read only when live rank is null (decays naturally).
- **REVERSE FAILURE — clean.** No surface aggregates incompatible packs across vendors; every accumulator is per-SKU keyed. Risk is entirely over-separation (the safer failure). `skuNameCollisions` will nag on doctrine-correct twins (no vendor comparison) once pairs go both-active.

## Prioritized gaps

| # | Gap | Effort | Coupling |
|---|---|---|---|
| ~~P1~~ | ~~Ham + Fresh Mozzarella unorderable~~ — **DONE 2026-08-20** (seed 18). Juan chose BOTH-ACTIVE / PFG-primary rather than deactivating a loser, so par + price moved to the primary and the backup stays orderable-without-a-par. Pins did NOT move (blocked on P2 — see the Live-bleed update); mozz still unpriced. | S | none |
| P2 | Consumption pin has no failover → invent the PRODUCT IDENTITY node above SKUs (canonical node recipes pin; per-location resolution rule at flatten). Truth-model decision — brainstorm w/ Juan | L | HIGH: flatten, depletion, counts, ordering, production, usageRank — the arc |
| P3 | Server doesn't bind receipt lines to delivering vendor (+ credit path; + composite DB constraint) | S | low, independent |
| P4 | Deactivation silently evaporates demand → "vendor down, N products unroutable" notice | S–M | low |
| P5 | buildRecipeGraph dual-producer first-wins + unordered select (Hot Peppers picks a VENDOR by accident) → deterministic order now; admin warning after | S/M | fold w/ #264 follow-up |
| P6 | usageRank seed for "what we buy most" (Angel spend as null-fallback) | M | SEQUENCE AFTER P2 |
| P7 | skuNameCollisions vendor-aware (warn same-vendor only; affirm cross-vendor twins) | XS | none |
| P8 | Count sheet shows vendor label on twins | XS | blocks P2's usefulness |

## What already works (negative findings)

Costing deterministic end-to-end · per-location activation overlay BUILT and correct, just unseeded (0 `location_sku_settings` rows) — "shops use what they carry" is a data task for ordering (counts doesn't read the overlay: real gap) · receiving UX vendor-scoping correct by design · invoice matching never guesses · zero over-aggregation · double-count law holds across all three consumers · variance honestly non-persisted · the twin problem was independently found by the Angel reconciliation (§ :170/:200) — this audit adds the ordering/depletion/variance blast radius.

*Full trace detail (mechanisms, file:line, live probes) in the audit agent's session output; anchors re-verified by CC against prod before filing.*
