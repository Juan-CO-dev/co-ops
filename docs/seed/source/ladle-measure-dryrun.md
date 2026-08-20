# Ladle measure — DRY RUN (gate CLOSED)

**Status: NOTHING HAS BEEN WRITTEN.** Output of `scripts/seed/23-ladle-measure.ts` in its
default (dry-run) mode, run live against prod (`bgcvurheqzylyfehqgzh`) on 2026-08-20.

## The ruling, and why the row is not in the database yet

> Juan 2026-08-20: **a ladle is 4 oz.**

That is a fact about the ladle and it belongs in `measure_units`. What it is *not* — yet —
is a safe write, and the script refuses to make it for the same arithmetic reason PR #271
gave when it refused the jus line (§4, `NO_PAR_WEIGHT_FALLBACK`).

`1 ladle` appears exactly once in prod: **Our French Dip (build) → Jus**. Registering
`ladle` as a 4 oz WEIGHT measure makes `itemRefParUnits` convert that line as
`4 oz / oz-per-par-unit of Jus`. Jus declares **no** `oz_per_par_unit`, so the conversion
falls back to the sub-recipe's per-par-unit INPUT mass — **2.248 oz**, because the Jus
recipe adds water it never records. The line would land at **1.7794 par-units of Jus for
one ladle**, i.e. nearly two quarts of jus on one sandwich. That is worse than the number
it replaces, arrived at more confidently, so the gate stays shut.

**UNBLOCK:** weigh a finished quart of Jus, set `items.oz_per_par_unit`
(id `f1e2d0a3-183f-45fe-a680-9d1cb8ba4022`), re-run. The gate is computed per row through
the real production function, so it releases the moment that weight exists. Note #271's
warning: declaring finished weights for the cooked liquid preps also exposes their
missing-water recipes to the mass-balance guard — a real finding, and its own arc.

## What the line does in the meantime

Before this PR an unregistered unit fell silently into the par-unit branch, so `1 ladle`
read as **one QUART** of jus and the board printed a confident cost from it. Since the
unknown-unit refusal landed (`lib/prep-consumption-graph.ts`, `itemRefParUnits`), the line
REFUSES instead: Our French Dip flattens to nothing and reads `unresolved` on the costing
board. That is the honest state — and it is why leaving the measure unregistered is a
position rather than an omission.

## Disposition

**Seed-data, dry-run gated. No migration is owed.** `measure_units` is a data registry:
migration 0096 created the table and seeded nine labels, and every label added since
(`each`, `handful`, `quart`, `unit`, `clove`, `leaf`, `sprig`, `cup`, `Tbsp`, `tsp`, `can`,
`#10 can`) arrived through the live MoO+ admin path `addMeasureUnit`
(`lib/admin/skus.ts`). Seed 23 writes the same row the same way — idempotent on the unique
label, reactivating rather than duplicating.

## Verbatim dry-run output

```
=== Seed 23 — register "ladle" = 4 oz (weight) ===
Mode: DRY RUN

Ruling: Juan 2026-08-20: a ladle is 4 oz. Registered as a WEIGHT measure because the ruling is about how much product one ladle delivers, not about fluid volume (lib/recipe-math.ts refuses volume→weight without a density).

Consuming lines on ACTIVE recipes: 1 (1 item-ref, 0 SKU-ref)

── Item-ref lines: what registering the unit would do ──
  recipe                          sub-item           qty   declared oz/par   input mass    today    after  verdict
  Our French Dip (build)          Jus                  1              NULL     2.248 oz  refused   1.7794  ⛔ NO_PAR_WEIGHT_FALLBACK

── GATE: CLOSED ──
  1 line(s) would convert through the sub-item's INPUT MASS rather than a
  declared finished weight. That is PR #271 §4's refusal, and it has not moved:
    · Our French Dip (build): 1 ladle of Jus, which declares no oz_per_par_unit — 1.78 par-units of Jus for ONE ladle
      UNBLOCK: weigh a finished Jus par-unit, set items.oz_per_par_unit (id f1e2d0a3-183f-45fe-a680-9d1cb8ba4022), re-run.

  Be aware, per #271: declaring those weights also exposes the missing-water
  recipes to the mass-balance guard. That is a real finding and its own arc.

NOTHING WAS WRITTEN. Seed 23 done (gate closed).
```
