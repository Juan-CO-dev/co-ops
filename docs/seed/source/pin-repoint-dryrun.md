# Pin re-point — seed 25 DRY RUN (Phase 4, gate S2)

> **STATUS: NOTHING HAS BEEN WRITTEN.** This is the output of `scripts/seed/25-repoint-recipe-pins.ts` in its default (dry-run) mode. The script writes only under an explicit `--execute` flag, which is **gate S2** and belongs to the lead, after Juan's eyeball.

**Generated:** 2026-08-21, against live prod (`bgcvurheqzylyfehqgzh`) with migrations through `0179_product_identity` applied and the Phase-2 product layer seeded (11 products / 23 members / 11 primaries). Every recipe, pin, pack shape, product weight and ounce figure below was resolved **live at run time** through the real production functions — nothing is copied from a plan table.

**Sources:** docs/superpowers/specs/2026-08-20-product-identity-design.md §3 · docs/superpowers/plans/2026-08-20-product-identity.md Phase 4 (D1, D3) · docs/seed/source/product-identity-dryrun.md (seed 24, gate S1) · scripts/seed/18-twin-adjudication.ts (the gate this one generalizes)

## 1 — Discovery (computed live, this run)

322 `recipe_inputs` rows live. **12** carry a pin on a SKU that belongs to a PRODUCT — that is the re-point universe, re-discovered here rather than assumed. 190 more are pinned to an implicit SINGLETON (`NO_PRODUCT` — correct and expected, not a fault), and 0 already name a product.

| population | rows |
|---|---:|
| `recipe_inputs` total | 322 |
| SKU-pinned | 202 |
| → pinned to a PRODUCT MEMBER (the candidate set) | **12** |
| → pinned to a singleton SKU (`NO_PRODUCT`) | 190 |
| already product-pinned (idempotence: not re-touched) | 0 |
| item-pinned / other | 120 |

> The unit census across every live `recipe_inputs` row is the reason `PACK_LABEL_LINE` is a **backstop, not a blocker**: 1 unregistered unit spelling(s) exist repo-wide — `ladle` ×1 — and **none of them appears on a candidate line**, so the gate has nothing to refuse on. It stays as a backstop because the census can change and the failure would otherwise be silent.

## 2 — The gate, line by line (oz computed through the real production functions)

For every candidate the line's ounces are computed **twice** — through `ozForRecipeInput` (`lib/recipe-math.ts`), the same call `lib/prep-consumption-graph.ts productLineOz` makes — against (a) the currently pinned SKU's live shape, pack chain and all, and (b) `productInputBasis(product, resolvedMember)`. The pin moves only when the two agree within `1e-9`. A reviewer can see that the number does not move without running anything.

| recipe | old pin (SKU@vendor) | new pin (product) | line | oz before | oz after | verdict |
|---|---|---|---|---:|---:|---|
| Capicola (portioned) | Boar's Head/Capicola | Capicola → Boar's Head/Capicola | 48.4536 unit | 19.38144 | 19.38144 | ✅ **PASS** |
| Fresh Mozzarella (portioned) | PFG/Fresh Mozzarella | Fresh Mozzarella | 32 unit | 32 | 32 | ⛔ **PRODUCT_UNWEIGHED** |
| Ham (portioned) | PFG/Ham | Ham → PFG/Ham | 29.2517 unit | 35.10204 | 35.10204 | ✅ **PASS** |
| Hot Peppers *(retired)* | Baldor/Hot Peppers | Hot Peppers | 512 oz | 512 | 512 | ⛔ **RETIRED_RECIPE** |
| Hot Peppers (portioned) | Boar's Head/Hot Peppers | Hot Peppers | 20 unit | 20 | 20 | ⛔ **PRODUCT_UNWEIGHED** |
| Iceberg (portioned) | PFG/Iceberg | Iceberg | 6.8468 unit | 136.936 | 136.936 | ⛔ **PRODUCT_UNWEIGHED** |
| Pepperoni (portioned) | Boar's Head/Pepperoni | Pepperoni → Boar's Head/Pepperoni | 56.701 unit | 11.3402 | 11.3402 | ✅ **PASS** |
| Provolone (portioned) | Boar's Head/Provolone | Provolone → Boar's Head/Provolone | 35.8601 unit | 25.10207 | 25.10207 | ✅ **PASS** |
| Roast Beef (portioned) | Boar's Head/Roast Beef | Roast Beef | 72.6531 unit | 108.97965 | 108.97965 | ⛔ **PRODUCT_UNWEIGHED** |
| Sweet Peppers (portioned) | Boar's Head/Sweet Peppers | Sweet Peppers | 5.075 unit | 20.3 | 20.3 | ⛔ **PRODUCT_UNWEIGHED** |
| Turkey (portioned) | Boar's Head/Turkey | Turkey | 116.1224 unit | 116.1224 | 116.1224 | ⛔ **PRODUCT_UNWEIGHED** |
| Vesuvio II (build) | Boar's Head/Banana Peppers | Banana Peppers → Boar's Head/Banana Peppers | 2 oz | 2 | 2 | ✅ **PASS** |

**Parity proof: 5 of 12 lines pass, and on every one of them `oz before` and `oz after` are the SAME NUMBER** (max observed delta 0, tolerance `1e-9`). 7 refuse.

### 2a — Why each PASSING line is safe

| recipe | product | unit | dimension | product unit_oz | why it is member-independent |
|---|---|---|---|---|---|
| Capicola (portioned) | Capicola | unit | count | 0.4 (OPERATIONAL) | count-denominated and the PRODUCT owns its own unit_oz (0.4 oz, OPERATIONAL) — the basis is member-INDEPENDENT by construction |
| Ham (portioned) | Ham | unit | count | 1.2 (OPERATIONAL) | count-denominated and the PRODUCT owns its own unit_oz (1.2 oz, OPERATIONAL) — the basis is member-INDEPENDENT by construction |
| Pepperoni (portioned) | Pepperoni | unit | count | 0.2 (OPERATIONAL) | count-denominated and the PRODUCT owns its own unit_oz (0.2 oz, OPERATIONAL) — the basis is member-INDEPENDENT by construction |
| Provolone (portioned) | Provolone | unit | count | 0.7 (OPERATIONAL) | count-denominated and the PRODUCT owns its own unit_oz (0.7 oz, OPERATIONAL) — the basis is member-INDEPENDENT by construction |
| Vesuvio II (build) | Banana Peppers | oz | weight | — *(not needed)* | weight-denominated ("oz") — the measure registry decides the oz and `avg_oz_per_each` never enters, so no member can move it |

### 2b — Every REFUSAL, with its unblock

| recipe | old pin | product | line | oz before | oz after | code | why | unblock |
|---|---|---|---|---:|---:|---|---|---|
| Fresh Mozzarella (portioned) | PFG/Fresh Mozzarella | Fresh Mozzarella | 32 unit | 32 | 32 | **PRODUCT_UNWEIGHED** | the line is count-denominated ("unit"), so its oz reads through `avg_oz_per_each`, and `products.unit_oz` is NULL — the basis falls back to the RESOLVED MEMBER's own weight (PFG 1 · Baldor 1), so the line would mean whatever the ladder answers that day | weigh it (Phase 6 weight board) or set `products.unit_oz` from OPERATIONAL_SLICE_OZ, then re-run — this gate passes and the pin moves with no code change. |
| Hot Peppers | Baldor/Hot Peppers | Hot Peppers | 512 oz | 512 | 512 | **RETIRED_RECIPE** | recipe "Hot Peppers" is INACTIVE — `loadRecipeGraph` filters `recipes.active = true` (multi-vendor audit P5), so nothing reads this row and no post-move verification through the real loader could prove anything about it | none needed — the row hangs off an inactive recipe that `loadRecipeGraph` does not read. Reactivate the recipe if it is meant to be live, then re-run. |
| Hot Peppers (portioned) | Boar's Head/Hot Peppers | Hot Peppers | 20 unit | 20 | 20 | **PRODUCT_UNWEIGHED** | the line is count-denominated ("unit"), so its oz reads through `avg_oz_per_each`, and `products.unit_oz` is NULL — the basis falls back to the RESOLVED MEMBER's own weight (Boar's Head 1), so the line would mean whatever the ladder answers that day | weigh it (Phase 6 weight board) or set `products.unit_oz` from OPERATIONAL_SLICE_OZ, then re-run — this gate passes and the pin moves with no code change. |
| Iceberg (portioned) | PFG/Iceberg | Iceberg | 6.8468 unit | 136.936 | 136.936 | **PRODUCT_UNWEIGHED** | the line is count-denominated ("unit"), so its oz reads through `avg_oz_per_each`, and `products.unit_oz` is NULL — the basis falls back to the RESOLVED MEMBER's own weight (PFG 20 · Sysco NULL · Baldor NULL), so the line would mean whatever the ladder answers that day | weigh it (Phase 6 weight board) or set `products.unit_oz` from OPERATIONAL_SLICE_OZ, then re-run — this gate passes and the pin moves with no code change. |
| Roast Beef (portioned) | Boar's Head/Roast Beef | Roast Beef | 72.6531 unit | 108.97965 | 108.97965 | **PRODUCT_UNWEIGHED** | the line is count-denominated ("unit"), so its oz reads through `avg_oz_per_each`, and `products.unit_oz` is NULL — the basis falls back to the RESOLVED MEMBER's own weight (Boar's Head 1.5), so the line would mean whatever the ladder answers that day | weigh it (Phase 6 weight board) or set `products.unit_oz` from OPERATIONAL_SLICE_OZ, then re-run — this gate passes and the pin moves with no code change. |
| Sweet Peppers (portioned) | Boar's Head/Sweet Peppers | Sweet Peppers | 5.075 unit | 20.3 | 20.3 | **PRODUCT_UNWEIGHED** | the line is count-denominated ("unit"), so its oz reads through `avg_oz_per_each`, and `products.unit_oz` is NULL — the basis falls back to the RESOLVED MEMBER's own weight (Boar's Head 4), so the line would mean whatever the ladder answers that day | weigh it (Phase 6 weight board) or set `products.unit_oz` from OPERATIONAL_SLICE_OZ, then re-run — this gate passes and the pin moves with no code change. |
| Turkey (portioned) | Boar's Head/Turkey | Turkey | 116.1224 unit | 116.1224 | 116.1224 | **PRODUCT_UNWEIGHED** | the line is count-denominated ("unit"), so its oz reads through `avg_oz_per_each`, and `products.unit_oz` is NULL — the basis falls back to the RESOLVED MEMBER's own weight (Boar's Head 1), so the line would mean whatever the ladder answers that day | weigh it (Phase 6 weight board) or set `products.unit_oz` from OPERATIONAL_SLICE_OZ, then re-run — this gate passes and the pin moves with no code change. |

> **A refusal is the script working.** Seed 18 refused its own pin move on exactly this gate and said so: *"re-running this script afterwards passes the gate and moves the pins with no code change."* Note what the `PRODUCT_UNWEIGHED` rows have in common: their `oz before` and `oz after` are **identical today**. The refusal is not about the arithmetic — it is about the DEPENDENCE. With `products.unit_oz` NULL the basis falls back to whichever member the ladder answers, so the number is only correct until the day the ladder answers differently. That is precisely the silent re-denomination the whole `unit_oz` column exists to prevent, and it is why the honest move is to fix the input, not the gate.

| verdict | lines |
|---|---:|
| ✅ PASS — will re-point | 5 |
| ⛔ PRODUCT_UNWEIGHED | 6 |
| ⛔ RETIRED_RECIPE | 1 |
| ℹ️ NO_PRODUCT (singleton pins, out of universe) | 190 |

## 3 — Failover proof: the arc's thesis, on real data

For every product a line would move to, each member is forced INACTIVE in turn and the line is re-resolved through the same `resolveProductMember` → `productInputBasis` → `ozForRecipeInput` chain. This is what the whole arc is for: a vendor going down must route demand to the backup **without moving the number**.

| recipe | product | scenario | resolves to | oz | verdict |
|---|---|---|---|---:|---|
| Capicola (portioned) | Capicola | Baldor forced INACTIVE | Boar's Head (rung primary) | 19.38144 | ✅ rerouted, same oz |
| Capicola (portioned) | Capicola | Boar's Head forced INACTIVE | **unresolved** *(no active member left)* | — *(refused)* | ➖ all members down → honest `unresolved` |
| Ham (portioned) | Ham | Baldor forced INACTIVE | PFG (rung primary) | 35.10204 | ✅ rerouted, same oz |
| Ham (portioned) | Ham | PFG forced INACTIVE | Baldor (rung any) | 35.10204 | ✅ rerouted, same oz |
| Pepperoni (portioned) | Pepperoni | Baldor forced INACTIVE | Boar's Head (rung primary) | 11.3402 | ✅ rerouted, same oz |
| Pepperoni (portioned) | Pepperoni | Boar's Head forced INACTIVE | **unresolved** *(no active member left)* | — *(refused)* | ➖ all members down → honest `unresolved` |
| Provolone (portioned) | Provolone | Baldor forced INACTIVE | Boar's Head (rung primary) | 25.10207 | ✅ rerouted, same oz |
| Provolone (portioned) | Provolone | Boar's Head forced INACTIVE | **unresolved** *(no active member left)* | — *(refused)* | ➖ all members down → honest `unresolved` |
| Vesuvio II (build) | Banana Peppers | Boar's Head forced INACTIVE | **unresolved** *(no active member left)* | — *(refused)* | ➖ all members down → honest `unresolved` |
| Vesuvio II (build) | Banana Peppers | Baldor forced INACTIVE | Boar's Head (rung primary) | 2 | ✅ rerouted, same oz |

**PASS — 0 of 10 failover scenarios move a line's ounces.** 6 scenario(s) genuinely REROUTE to a backup member and land on the identical number — that is the arc's thesis, demonstrated on real data. The other 4 take the product's LAST active member away, and those resolve to `unresolved` **by design**: `productLineOz` refuses rather than guessing, so the flatten poisons to the honest `unresolved` status exactly as it does for an unknown SKU pack. Every passing line is member-independent by construction — it is either weight-denominated (the measure registry decides and `avg_oz_per_each` never enters) or the PRODUCT owns its own `unit_oz`.

### 3a — Per-location resolution (deviation D7)

| location | recipe | product | resolves to | oz | verdict |
|---|---|---|---|---:|---|
| Capitol Hill | Capicola (portioned) | Capicola | Boar's Head (rung primary, global row) | 19.38144 | ✅ same oz |
| Capitol Hill | Ham (portioned) | Ham | PFG (rung primary, global row) | 35.10204 | ✅ same oz |
| Capitol Hill | Pepperoni (portioned) | Pepperoni | Boar's Head (rung primary, global row) | 11.3402 | ✅ same oz |
| Capitol Hill | Provolone (portioned) | Provolone | Boar's Head (rung primary, global row) | 25.10207 | ✅ same oz |
| Capitol Hill | Vesuvio II (build) | Banana Peppers | Boar's Head (rung primary, global row) | 2 | ✅ same oz |
| P Street | Capicola (portioned) | Capicola | Boar's Head (rung primary, global row) | 19.38144 | ✅ same oz |
| P Street | Ham (portioned) | Ham | PFG (rung primary, global row) | 35.10204 | ✅ same oz |
| P Street | Pepperoni (portioned) | Pepperoni | Boar's Head (rung primary, global row) | 11.3402 | ✅ same oz |
| P Street | Provolone (portioned) | Provolone | Boar's Head (rung primary, global row) | 25.10207 | ✅ same oz |
| P Street | Vesuvio II (build) | Banana Peppers | Boar's Head (rung primary, global row) | 2 | ✅ same oz |

## 4 — Post-move verification: the whole flatten, re-derived

The per-unit SKU-oz map is re-derived for **every node in the graph** — not only the touched ones — through `perUnitSkuOzForItemFromGraph` / `perUnitSkuOzForMenuItemFromGraph`, before and after. The AFTER graph is the live graph with the passing pins rewritten and the real `loadProductIndex` merged in, so the product path (`productLineOz`) is genuinely exercised. **Zero deltas is the pass condition.**


### 4a — The touched nodes, before and after

| node | grain | leaf SKUs | Σ oz before | Σ oz after | delta |
|---|---|---:|---:|---:|---:|
| Capicola | item | 1 | 19.38144 | 19.38144 | ✅ 0.000000 |
| Ham | item | 1 | 35.10204 | 35.10204 | ✅ 0.000000 |
| Pepperoni | item | 1 | 11.3402 | 11.3402 | ✅ 0.000000 |
| Provolone | item | 1 | 25.10207 | 25.10207 | ✅ 0.000000 |
| Vesuvio II | menu_item | 21 | 47.067 | 47.067 | ✅ 0.000000 |

## ✅ VERIFICATION PASS — 71 graph nodes re-derived, **0 deltas**.

Every item and menu_item in the whole recipe universe flattens to the same per-SKU ounces after the re-point as before it. The costing board, the depletion lane and the readiness map cannot move.

## 5 — Writes

```
Capicola (portioned)
  would re-point recipe_inputs[eccf22aa-9396-4066-8e34-a9d372f4b725]
      component_sku_id Boar's Head/Capicola [e886552d-ba06-4932-9f38-1580aea0beee] -> NULL
      component_product_id NULL -> Capicola [fbec691e-7bfb-465d-b117-a9590a7129d3]
      line 48.4536 unit = 19.38144 oz, unchanged
Ham (portioned)
  would re-point recipe_inputs[b62bcac1-eb3b-42c4-9355-b76a74c5af4a]
      component_sku_id PFG/Ham [804cb32d-ea68-4467-8479-b82f34a143a0] -> NULL
      component_product_id NULL -> Ham [cfb77bf2-9fcf-4339-8cf2-5cdf4dc9dda3]
      line 29.2517 unit = 35.102039999999995 oz, unchanged
Pepperoni (portioned)
  would re-point recipe_inputs[c091127b-9662-40f8-b60f-ffd1a281371c]
      component_sku_id Boar's Head/Pepperoni [9eced455-d0c2-4b2f-8884-4b741d4d1edf] -> NULL
      component_product_id NULL -> Pepperoni [908b9d1b-87aa-4376-8018-c9277c073b8d]
      line 56.701 unit = 11.340200000000001 oz, unchanged
Provolone (portioned)
  would re-point recipe_inputs[946d4b37-8335-48fd-9cb4-8aa9776f049c]
      component_sku_id Boar's Head/Provolone [8a2297e2-2121-4a02-9234-e46e1af2a19b] -> NULL
      component_product_id NULL -> Provolone [e92a5b1d-e424-4889-b920-fe06d6de10cd]
      line 35.8601 unit = 25.10207 oz, unchanged
Vesuvio II (build)
  would re-point recipe_inputs[d5676c48-54a1-453e-8689-66d658a14da7]
      component_sku_id Boar's Head/Banana Peppers [f97d28a1-1320-4030-9575-d84e14db00d1] -> NULL
      component_product_id NULL -> Banana Peppers [62b825d6-b992-48e1-9fec-2e635ed5c026]
      line 2 oz = 2 oz, unchanged
```

Sample notes stanza (Capicola (portioned)):
```
[product-pin product-identity-2026-08-20] Capicola now pins the PRODUCT Capicola, not Boar's Head Capicola. Line oz unchanged (19.38144 oz). Resolution is per-location primary-first.
```

## 6 — What this seed will NOT touch

- **`active`, `weekday_par`, `weekend_par`** on any SKU. Seed 18 adjudicated orderability; the execute run snapshots all three on every member SKU and re-reads them afterwards — any movement is a FATAL.
- **`recipe_inputs.quantity` / `unit`.** Not one number is re-denominated. Seed 22 owns the portioned quantities; this seed only moves WHICH THING the line points at, and refuses whenever that would change WHAT IT MEANS.
- **`products.unit_oz`.** A weight is a measurement and belongs to seed 24 / the Phase-6 weight board. Where one is missing this seed REFUSES the line rather than inventing the number that would let it pass.
- **Anything on a RETIRED recipe.** Reported with its numbers, never written.
- **The depletion ledgers.** `toast_daily_depletion` is untouched and the double-count law is not in play (deviation D5).

## 7 — Summary

| would write | count |
|---|---:|
| `recipe_inputs` pins moved SKU → product | 5 |
| `recipes.notes` stanzas | 5 |
| lines REFUSED (no write) | 7 |
| rows touching quantity / unit / par / active / price | **0** |

> ⚠ **7 line(s) refuse.** Gate S2's protocol is explicit: *"If ANY line refuses, do not execute."* The refusals and their unblocks go to Juan; a refusal is the script working, and the honest move is to fix the input, not the gate. Everything that passes is independently safe, so a partial execute is defensible — but that is the LEAD's call with Juan, not this script's.

Seed 25 done (dry run).
**NOTHING WAS WRITTEN.**
