# Toast depletion into drift — design (read-track #3)

> Owner-called 2026-07-31 ("run the build per your rec"). The last blind spot in
> the Feed/Verify model: ~8k banked toast_sales_events (live since 07-23) derive
> a complete consumption projection (`salesConsumption`) that NOTHING consumes —
> counts' drift/variance reads only prep-production consumption
> (`sumConsumedOzSince` over `production_inputs`), so retail-sold stock reads as
> unexplained shrinkage.

## The double-count law (the design crux)

A raw SKU physically leaves the shelf exactly once — either when PREP transforms
it (beef → meatballs, recorded by `recordProductionFromPrep` → `production_inputs`,
the working lane) or when it is DIRECTLY sold/used at the register (bread on a
sold sub, a bag of chips, a sub roll removed for a salad). `salesConsumption`'s
`skuConsumed` currently sums BOTH the direct lane AND the item-flatten lane
(sold meatball subs flattened through the recipe graph back to beef oz). Feeding
the flatten lane into drift would deplete beef twice — once at production, once
at sale.

**THE LAW: only the DIRECT lane feeds drift.**
- direct = `perUnitDirectSkuOzForMenuItem` (direct SKU inputs of sold menu items)
  + the SKU-modifier lane (`skuPortionOz` applications, signed) — clamped ≥0 per
  SKU per day.
- flattened = `perUnitSkuOzForItemFromGraph` over item par-units — NEVER feeds
  drift (those SKUs deplete at production). Stored alongside for transparency and
  future prep-item-par drift; consciously excluded from the consumed term.
- Corollary: items whose production is never RECORDED leave their raw SKUs blind
  on both lanes — a data-practice gap (the AM-prep adoption recovery, arc
  2026-07-30), not a model gap. The law stays clean.

## Storage: a materialized daily ledger (not derive-on-read)

`salesConsumption` is too heavy to derive per counts-page load × N days (full
crosswalk + recipe graph per day). New table `toast_daily_depletion` (migration
0166): one row per (location_id, business_date, sku_id) with `direct_oz` +
`flattened_oz` (both ≥0, post-clamp) + `computed_at`. UNIQUE on the triple;
re-materialization = delete-day + insert (idempotent — re-pulls/void revisions
recompute the day). Writer `materializeDailyDepletion(locationId, businessDate)`
runs inside the nightly sales-pull cron AFTER a successful pull, and a one-shot
backfill script covers the banked 07-23..present days.

## The drift merge

`loadOnHand` (lib/counts.ts): consumed side becomes
`production_inputs SUM + sales direct_oz SUM`, where the sales term is
`SUM(direct_oz) WHERE business_date >= anchorAt's operational date`.
- **Day-grain boundary (events carry NO per-event timestamp):** the anchor's own
  business date is INCLUDED — matches morning-count practice (count before the
  day's sales). Documented bias: an evening count over-subtracts at most that
  day's direct sales for that SKU; advisory doctrine accepts it, the caveat
  renders in the UI hint.
- **Ledger lag:** today's sales exist only after tonight's pull — the sales term
  is complete through the last materialized business date; the UI hint names the
  coverage date.
- **Count-dimension SKUs** (packaging/etc., units not oz): sales term converts
  oz → units via `avg_oz_per_each`; missing weight → null-taint (existing
  advisory-null doctrine, never a silent 0).
- Variance (`computeVariance`) inherits the same consumed term — no math change,
  just the richer input.

## Catering boundary (already handled, documented here)

The sales lane excludes catering via `toast_ingest_exclusions` (+ suspected-
catering advisory). The W4a catering ledger never fed drift, so no overlap is
introduced. Outside-platform catering remains the named gap from the ingest spec.

## Cuts

1. **Refactor `salesConsumption`**: split the internal `sku` map into direct +
   flattened lanes (removals net against DIRECT — a "No bread" nets the bread
   the sub would have used; clamp per-lane ≥0). Surface: `skuConsumed` rows gain
   `directOz` + `flattenedOz` (sum preserved as `oz` — existing consumers
   unchanged); export a pure `dailyDepletionRows(consumption)` for the writer.
2. **Migration 0166 + writer**: table + `materializeDailyDepletion` + cron hook
   (after successful pull, per location; failure logs, never fails the pull) +
   `scripts/backfill-toast-depletion.ts` for the banked days.
3. **Drift merge**: `sumSalesDirectOzSince(sb, skuIds, locationId, anchorDates)`
   + merge into `loadOnHand`'s consumed term + the counts UI hint (sales term
   shown in the row detail: "sold −N oz (through <date>)").
4. **Verification against reality**: backfill prod, then spot-check ≥3 SKUs ×
   ≥2 days: ledger row == fresh salesConsumption derivation; and one full
   loadOnHand before/after diff reviewed by hand.

## Explicitly OUT
- Prep-item par drift from `prepConsumed` units (future; the ledger's
  flattened_oz + toast_sales_events keep it derivable).
- Per-event-timestamp boundary precision (events are day-grain; revisit only if
  Toast order timestamps get ingested).
- Dynamic Pars velocity (next design session; reads the same events).

## Tests
Pure: the lane split (direct vs flattened vs removals netting), dailyDepletionRows
shape, oz→units conversion null-taint. Integration-shaped: the window rule
(anchor-date inclusion) as a pure date predicate.
