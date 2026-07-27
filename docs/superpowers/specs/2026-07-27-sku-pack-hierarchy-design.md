# SKU Pack Hierarchy + Counts + Receiving Form — design (2026-07-27)

**Status: APPROVED (Juan, 2026-07-27, remote session). Preceded by a read-only
audit (opus, session b2d43828) — findings summarized in §Audit below.**

## Problem (Juan, verbatim gist)
"Sub rolls come in flats, 5 packs, 6 rolls each — the average oz should be per
roll; right now it reads as per pack. Capicola comes in a case, 4 logs each,
~34oz per log, then the avg bundle, then the avg slice. That's how we get the
actual math, and the managers get actual ground truth of what we have."

## Audit (ground truth driving this design)
- The middle tier has NO storage: `units_per_pack` conflates case→log and
  flat→roll; `each_container_label` is a dead code hook (recipe-math.ts:108)
  filled 0/182. Capicola's 5 levels collapse to one scalar (slice=0.4oz).
- 24/74 recipe-referenced SKUs (ALL sliced deli) resolve no content_oz → no
  pack count, no cost/oz (W4b + cost.ts silently blank).
- Receiving: `qty_received` bare numeric, implicit unit; NO physical count
  surface exists anywhere; on-hand is derived-only (production.ts:133-163
  admits unit mixing). "2 cases + 3 loose logs" is unrecordable.
- 11 duplicate SKU names; pack_format free-text drift (Case/case/tub/jar);
  weekday/weekend_par dormant in a third grain; `ladle`×2 unregistered.

## Decisions (locked)
1. **Shape 1 — per-SKU unit chain.** New table `sku_pack_levels`:
   `(sku_id, level_ordinal, label, contains_qty, contains_unit)` — e.g.
   Capicola: case→4 log; log→34 oz; slice→0.4 oz. Any depth. Recipes,
   receiving, and counts may speak ANY level by label. Conversion spine
   (recipe-math skuContentOz/ozForRecipeInput) walks the chain; existing
   two-level fields become the backfill source (56 clean, 24 need Juan).
2. **Counts included this arc.** A manager count surface: physical counts in
   MIXED levels ("2 cases + 3 loose logs"), stored per level, converted via
   the chain; on-hand becomes count-anchored + derived-drift, advisory
   comparison surfaced (the ground-truth payoff).
3. **Receiving form upgrade (Juan expansion):** the delivery log becomes a
   full receiving form — per-SKU line notes/comments + PHOTOS (reuse the
   checklist photo storage machinery) + a receipt attachment per delivery;
   qty entered at any chain level (unit column added, no more implicit packs).

## Cleanups riding along
Pack-label registry enforcement (casing drift), register `ladle`, dup-SKU
canonicalization pass (Juan adjudicates the 11 via a queue, not auto-merge),
retire dormant weekday/weekend_par columns from the form (leave columns).

## Out of scope
Auto-reorder/PO generation (Phase-5 ordering); barcode/scale integrations;
supplier price sync.

## Build shape (own arc, likely 2 PRs: model+math, then counts+receiving)
Migration 0159 (sku_pack_levels + receiving unit column + backfill) staged;
conversion-spine rewrite with the #180-style invariant (chain walk ===
legacy two-level math for all 56 clean backfills, vitest-pinned); SkuForm
chain editor; counts surface; receiving form; adversarial review; PR; HOLD.

## Verification
Vitest: chain-walk conversions + legacy-parity invariant + mixed-level count
math. Post-merge: Capicola + Sub Roll chains entered w/ Juan's real numbers;
CH benchmark unchanged (depletion parity); a real mixed-level count recorded.

## COUNCIL DESIGN LOCKS (round 1, 2026-07-27 — six-seat counsel; full report: .claude/council/2026-07-27-sku-pack-hierarchy/report.md)
L1 split link columns (contains_level_id XOR contains_measure_unit, CHECK; pointer-directed walk, ordinal display-only; UNIQUE(sku_id,label); label not in measure_units labels). L2 leaf law: chains terminate in weight-dim measure; count levels dual-identity; depth-1 valid. L3 history: effective_from+active on chain rows superseded as a SET; receiving/count lines persist entered level+qty AND resolved_oz at write; consumers read stored oz; spine date-blind. L4 per-location = separate location-scoped SKU rows (existing law). L5 counts: one count EVENT, disjoint-by-law UI (full containers + loose below + partial-container annotation), anchor = oz snapshot, drift in oz, anchor age surfaced, retro-edit staleness flag. L6 backfill by id; label canonicalization in lockstep with recipe_inputs.unit + recipe_inputs.each_container_label; 3-level candidates flagged; chain-unverified badge. L7 four invariants: legacy parity, per-level round-trip, reachability+leaf-termination totality, and the CAPICOLA detached-sibling named regression (naive ordinal-walk = 54.4oz vs correct 136 — must fail loudly). L8 observed oz becomes level-scoped; shrinkage delta surfaced with reason code.
