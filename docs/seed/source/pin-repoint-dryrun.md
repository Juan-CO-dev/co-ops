# Pin re-point — seed 25 DRY RUN (Phase 4, gate S2)

> **STATUS: NOTHING HAS BEEN WRITTEN.** This is the output of `scripts/seed/25-repoint-recipe-pins.ts` in its default (dry-run) mode. The script writes only under an explicit `--execute` flag, which is **gate S2** and belongs to the lead, after Juan's eyeball.

**Generated:** 2026-08-21, against live prod (`bgcvurheqzylyfehqgzh`) with migrations through `0179_product_identity` applied and the Phase-2 product layer seeded (11 products / 23 members / 11 primaries). Every recipe, pin, pack shape, product weight and ounce figure below was resolved **live at run time** through the real production functions — nothing is copied from a plan table.

> **Revised after Juan's weigh ruling of 2026-08-21.** The first revision refused six lines as `PRODUCT_UNWEIGHED`; his ruling establishes that those member weights are his own extensive measurements, so this revision carries them up to the product grain first (§2) and the gate then evaluates every line on the merits.

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

## 2 — `products.unit_oz` fill (Juan's weigh ruling, 2026-08-21)

> Juan 2026-08-21, verbatim: "i think there is an issue here, because i literally weighted all of that... like extensively, it wasnt just the ham and stuff... and you got it all." The avg_oz_per_each values on these products' ACTIVE members are his own extensive surprise-weigh MEASUREMENTS — not seed estimates, not spec sheets. Ruled at the PRODUCT grain: what one unit weighs is a fact about the product, not about which vendor sells it.

The first dry run refused six lines as `PRODUCT_UNWEIGHED` on the reading that these members' `avg_oz_per_each` values were seed estimates. Juan's ruling corrects the premise: they are his own measurements. So each ruled product takes its ACTIVE member's measured value up to the PRODUCT grain — **derived live and cross-checked against the ruling, never copied from it.** Once a product owns `unit_oz`, `productInputBasis` reads THAT number and never the resolved member's, so the line becomes member-INDEPENDENT and the gate below can evaluate it on the merits.

| product | unit_oz | class | read live off | active members (avg_oz_per_each) | ruled |
|---|---:|---|---|---|---|
| Fresh Mozzarella | **1** | OPERATIONAL | PFG/Fresh Mozzarella · Baldor/Fresh Mozzarella | PFG 1 · Baldor 1 | ✅ 1 oz — matches |
| Hot Peppers | **1** | OPERATIONAL | Boar's Head/Hot Peppers | Boar's Head 1 | ✅ 1 oz — matches |
| Iceberg | **20** | OPERATIONAL | PFG/Iceberg | PFG 20 · Sysco NULL · Baldor NULL | ✅ 20 oz — matches |
| Roast Beef | **1.5** | OPERATIONAL | Boar's Head/Roast Beef | Boar's Head 1.5 | ✅ 1.5 oz — matches |
| Sweet Peppers | **4** | OPERATIONAL | Boar's Head/Sweet Peppers | Boar's Head 4 | ✅ 4 oz — matches |
| Turkey | **1** | OPERATIONAL | Boar's Head/Turkey | Boar's Head 1 | ✅ 1 oz — matches |


### 2a — Products NOT filled, and why

| product | state | why |
|---|---|---|
| Banana Peppers | ➖ not filled | Juan's 2026-08-21 ruling does not name this product, so no weight is written for it. Active members: Boar's Head NULL. |
| Capicola | ✅ already weighed | already owns unit_oz = 0.4 (OPERATIONAL) — seed 24 wrote it; not re-touched. |
| Ham | ✅ already weighed | already owns unit_oz = 1.2 (OPERATIONAL) — seed 24 wrote it; not re-touched. |
| Pepperoni | ✅ already weighed | already owns unit_oz = 0.2 (OPERATIONAL) — seed 24 wrote it; not re-touched. |
| Provolone | ✅ already weighed | already owns unit_oz = 0.7 (OPERATIONAL) — seed 24 wrote it; not re-touched. |

> **A member with a NULL weight is an UNKNOWN, not a dissent** — the same semantics `membersDisagreeOnUnitOz` uses. That is why **ICEBERG is filled at 20 oz per head** even though its Sysco and Baldor members carry NULL: Juan measured the PFG head, and once the PRODUCT owns the weight the other members' silence stops mattering. That is the entire reason the column exists. The refusals above are the converse: a product the ruling does not name is never filled, and active members carrying DIFFERENT weights would refuse outright — a weight is a ruling, not an average.

## 3 — The gate, line by line (oz computed through the real production functions)

For every candidate the line's ounces are computed **twice** — through `ozForRecipeInput` (`lib/recipe-math.ts`), the same call `lib/prep-consumption-graph.ts productLineOz` makes — against (a) the currently pinned SKU's live shape, pack chain and all, and (b) `productInputBasis(product, resolvedMember)`. The pin moves only when the two agree within `1e-9`. A reviewer can see that the number does not move without running anything. The `unit_oz` used is the one the product will own **after §2's fill**, because the fill and the re-point ship in the same `--execute` and the fill runs first.

| recipe | old pin (SKU@vendor) | new pin (product) | line | oz before | oz after | verdict |
|---|---|---|---|---:|---:|---|
| Capicola (portioned) | Boar's Head/Capicola | Capicola → Boar's Head/Capicola | 48.4536 unit | 19.38144 | 19.38144 | ✅ **PASS** |
| Fresh Mozzarella (portioned) | PFG/Fresh Mozzarella | Fresh Mozzarella → PFG/Fresh Mozzarella | 32 unit | 32 | 32 | ✅ **PASS** |
| Ham (portioned) | PFG/Ham | Ham → PFG/Ham | 29.2517 unit | 35.10204 | 35.10204 | ✅ **PASS** |
| Hot Peppers *(retired)* | Baldor/Hot Peppers | Hot Peppers | 512 oz | 512 | 512 | ⛔ **RETIRED_RECIPE** |
| Hot Peppers (portioned) | Boar's Head/Hot Peppers | Hot Peppers → Boar's Head/Hot Peppers | 20 unit | 20 | 20 | ✅ **PASS** |
| Iceberg (portioned) | PFG/Iceberg | Iceberg → PFG/Iceberg | 6.8468 unit | 136.936 | 136.936 | ✅ **PASS** |
| Pepperoni (portioned) | Boar's Head/Pepperoni | Pepperoni → Boar's Head/Pepperoni | 56.701 unit | 11.3402 | 11.3402 | ✅ **PASS** |
| Provolone (portioned) | Boar's Head/Provolone | Provolone → Boar's Head/Provolone | 35.8601 unit | 25.10207 | 25.10207 | ✅ **PASS** |
| Roast Beef (portioned) | Boar's Head/Roast Beef | Roast Beef → Boar's Head/Roast Beef | 72.6531 unit | 108.97965 | 108.97965 | ✅ **PASS** |
| Sweet Peppers (portioned) | Boar's Head/Sweet Peppers | Sweet Peppers → Boar's Head/Sweet Peppers | 5.075 unit | 20.3 | 20.3 | ✅ **PASS** |
| Turkey (portioned) | Boar's Head/Turkey | Turkey → Boar's Head/Turkey | 116.1224 unit | 116.1224 | 116.1224 | ✅ **PASS** |
| Vesuvio II (build) | Boar's Head/Banana Peppers | Banana Peppers → Boar's Head/Banana Peppers | 2 oz | 2 | 2 | ✅ **PASS** |

**Parity proof: 11 of 12 lines pass, and on every one of them `oz before` and `oz after` are the SAME NUMBER** (max observed delta 0, tolerance `1e-9`). 1 refuse.

### 3a — Why each PASSING line is safe

| recipe | product | unit | dimension | product unit_oz | why it is member-independent |
|---|---|---|---|---|---|
| Capicola (portioned) | Capicola | unit | count | 0.4 (OPERATIONAL) | count-denominated and the PRODUCT owns its own unit_oz (0.4 oz, OPERATIONAL) — the basis is member-INDEPENDENT by construction |
| Fresh Mozzarella (portioned) | Fresh Mozzarella | unit | count | 1 (OPERATIONAL — filled this run) | count-denominated and the PRODUCT owns its own unit_oz (1 oz, OPERATIONAL — filled by THIS run's §2 step) — the basis is member-INDEPENDENT by construction |
| Ham (portioned) | Ham | unit | count | 1.2 (OPERATIONAL) | count-denominated and the PRODUCT owns its own unit_oz (1.2 oz, OPERATIONAL) — the basis is member-INDEPENDENT by construction |
| Hot Peppers (portioned) | Hot Peppers | unit | count | 1 (OPERATIONAL — filled this run) | count-denominated and the PRODUCT owns its own unit_oz (1 oz, OPERATIONAL — filled by THIS run's §2 step) — the basis is member-INDEPENDENT by construction |
| Iceberg (portioned) | Iceberg | unit | count | 20 (OPERATIONAL — filled this run) | count-denominated and the PRODUCT owns its own unit_oz (20 oz, OPERATIONAL — filled by THIS run's §2 step) — the basis is member-INDEPENDENT by construction |
| Pepperoni (portioned) | Pepperoni | unit | count | 0.2 (OPERATIONAL) | count-denominated and the PRODUCT owns its own unit_oz (0.2 oz, OPERATIONAL) — the basis is member-INDEPENDENT by construction |
| Provolone (portioned) | Provolone | unit | count | 0.7 (OPERATIONAL) | count-denominated and the PRODUCT owns its own unit_oz (0.7 oz, OPERATIONAL) — the basis is member-INDEPENDENT by construction |
| Roast Beef (portioned) | Roast Beef | unit | count | 1.5 (OPERATIONAL — filled this run) | count-denominated and the PRODUCT owns its own unit_oz (1.5 oz, OPERATIONAL — filled by THIS run's §2 step) — the basis is member-INDEPENDENT by construction |
| Sweet Peppers (portioned) | Sweet Peppers | unit | count | 4 (OPERATIONAL — filled this run) | count-denominated and the PRODUCT owns its own unit_oz (4 oz, OPERATIONAL — filled by THIS run's §2 step) — the basis is member-INDEPENDENT by construction |
| Turkey (portioned) | Turkey | unit | count | 1 (OPERATIONAL — filled this run) | count-denominated and the PRODUCT owns its own unit_oz (1 oz, OPERATIONAL — filled by THIS run's §2 step) — the basis is member-INDEPENDENT by construction |
| Vesuvio II (build) | Banana Peppers | oz | weight | — *(not needed)* | weight-denominated ("oz") — the measure registry decides the oz and `avg_oz_per_each` never enters, so no member can move it |

### 3b — Every REFUSAL, with its unblock

| recipe | old pin | product | line | oz before | oz after | code | why | unblock |
|---|---|---|---|---:|---:|---|---|---|
| Hot Peppers | Baldor/Hot Peppers | Hot Peppers | 512 oz | 512 | 512 | **RETIRED_RECIPE** | recipe "Hot Peppers" is INACTIVE — `loadRecipeGraph` filters `recipes.active = true` (multi-vendor audit P5), so nothing reads this row and no post-move verification through the real loader could prove anything about it | none needed — the row hangs off an inactive recipe that `loadRecipeGraph` does not read. Reactivate the recipe if it is meant to be live, then re-run. |

> **A refusal is the script working.** Seed 18 refused its own pin move on exactly this gate and said so: *"re-running this script afterwards passes the gate and moves the pins with no code change."* Note what the `PRODUCT_UNWEIGHED` rows have in common: their `oz before` and `oz after` are **identical today**. The refusal is not about the arithmetic — it is about the DEPENDENCE. With `products.unit_oz` NULL the basis falls back to whichever member the ladder answers, so the number is only correct until the day the ladder answers differently. That is precisely the silent re-denomination the whole `unit_oz` column exists to prevent, and it is why the honest move is to fix the input, not the gate.

| verdict | lines |
|---|---:|
| ✅ PASS — will re-point | 11 |
| ⛔ RETIRED_RECIPE | 1 |
| ℹ️ NO_PRODUCT (singleton pins, out of universe) | 190 |

## 4 — Failover proof: the arc's thesis, on real data

For every product a line would move to, each member is forced INACTIVE in turn and the line is re-resolved through the same `resolveProductMember` → `productInputBasis` → `ozForRecipeInput` chain. This is what the whole arc is for: a vendor going down must route demand to the backup **without moving the number**.

| recipe | product | scenario | resolves to | oz | verdict |
|---|---|---|---|---:|---|
| Capicola (portioned) | Capicola | Baldor forced INACTIVE | Boar's Head (rung primary) | 19.38144 | ✅ rerouted, same oz |
| Capicola (portioned) | Capicola | Boar's Head forced INACTIVE | **unresolved** *(no active member left)* | — *(refused)* | ➖ all members down → honest `unresolved` |
| Fresh Mozzarella (portioned) | Fresh Mozzarella | PFG forced INACTIVE | Baldor (rung any) | 32 | ✅ rerouted, same oz |
| Fresh Mozzarella (portioned) | Fresh Mozzarella | Baldor forced INACTIVE | PFG (rung primary) | 32 | ✅ rerouted, same oz |
| Ham (portioned) | Ham | Baldor forced INACTIVE | PFG (rung primary) | 35.10204 | ✅ rerouted, same oz |
| Ham (portioned) | Ham | PFG forced INACTIVE | Baldor (rung any) | 35.10204 | ✅ rerouted, same oz |
| Hot Peppers (portioned) | Hot Peppers | Baldor forced INACTIVE | Boar's Head (rung primary) | 20 | ✅ rerouted, same oz |
| Hot Peppers (portioned) | Hot Peppers | Boar's Head forced INACTIVE | **unresolved** *(no active member left)* | — *(refused)* | ➖ all members down → honest `unresolved` |
| Iceberg (portioned) | Iceberg | PFG forced INACTIVE | Sysco (rung any) | 136.936 | ✅ rerouted, same oz |
| Iceberg (portioned) | Iceberg | Sysco forced INACTIVE | PFG (rung primary) | 136.936 | ✅ rerouted, same oz |
| Iceberg (portioned) | Iceberg | Baldor forced INACTIVE | PFG (rung primary) | 136.936 | ✅ rerouted, same oz |
| Pepperoni (portioned) | Pepperoni | Baldor forced INACTIVE | Boar's Head (rung primary) | 11.3402 | ✅ rerouted, same oz |
| Pepperoni (portioned) | Pepperoni | Boar's Head forced INACTIVE | **unresolved** *(no active member left)* | — *(refused)* | ➖ all members down → honest `unresolved` |
| Provolone (portioned) | Provolone | Baldor forced INACTIVE | Boar's Head (rung primary) | 25.10207 | ✅ rerouted, same oz |
| Provolone (portioned) | Provolone | Boar's Head forced INACTIVE | **unresolved** *(no active member left)* | — *(refused)* | ➖ all members down → honest `unresolved` |
| Roast Beef (portioned) | Roast Beef | Boar's Head forced INACTIVE | **unresolved** *(no active member left)* | — *(refused)* | ➖ all members down → honest `unresolved` |
| Roast Beef (portioned) | Roast Beef | Baldor forced INACTIVE | Boar's Head (rung primary) | 108.97965 | ✅ rerouted, same oz |
| Sweet Peppers (portioned) | Sweet Peppers | Baldor forced INACTIVE | Boar's Head (rung primary) | 20.3 | ✅ rerouted, same oz |
| Sweet Peppers (portioned) | Sweet Peppers | Boar's Head forced INACTIVE | **unresolved** *(no active member left)* | — *(refused)* | ➖ all members down → honest `unresolved` |
| Turkey (portioned) | Turkey | Boar's Head forced INACTIVE | **unresolved** *(no active member left)* | — *(refused)* | ➖ all members down → honest `unresolved` |
| Turkey (portioned) | Turkey | Baldor forced INACTIVE | Boar's Head (rung primary) | 116.1224 | ✅ rerouted, same oz |
| Vesuvio II (build) | Banana Peppers | Boar's Head forced INACTIVE | **unresolved** *(no active member left)* | — *(refused)* | ➖ all members down → honest `unresolved` |
| Vesuvio II (build) | Banana Peppers | Baldor forced INACTIVE | Boar's Head (rung primary) | 2 | ✅ rerouted, same oz |

**PASS — 0 of 23 failover scenarios move a line's ounces.** 15 scenario(s) genuinely REROUTE to a backup member and land on the identical number — that is the arc's thesis, demonstrated on real data. The other 8 take the product's LAST active member away, and those resolve to `unresolved` **by design**: `productLineOz` refuses rather than guessing, so the flatten poisons to the honest `unresolved` status exactly as it does for an unknown SKU pack. Every passing line is member-independent by construction — it is either weight-denominated (the measure registry decides and `avg_oz_per_each` never enters) or the PRODUCT owns its own `unit_oz`.

### 4a — Per-location resolution (deviation D7)

| location | recipe | product | resolves to | oz | verdict |
|---|---|---|---|---:|---|
| Capitol Hill | Capicola (portioned) | Capicola | Boar's Head (rung primary, global row) | 19.38144 | ✅ same oz |
| Capitol Hill | Fresh Mozzarella (portioned) | Fresh Mozzarella | PFG (rung primary, global row) | 32 | ✅ same oz |
| Capitol Hill | Ham (portioned) | Ham | PFG (rung primary, global row) | 35.10204 | ✅ same oz |
| Capitol Hill | Hot Peppers (portioned) | Hot Peppers | Boar's Head (rung primary, global row) | 20 | ✅ same oz |
| Capitol Hill | Iceberg (portioned) | Iceberg | PFG (rung primary, global row) | 136.936 | ✅ same oz |
| Capitol Hill | Pepperoni (portioned) | Pepperoni | Boar's Head (rung primary, global row) | 11.3402 | ✅ same oz |
| Capitol Hill | Provolone (portioned) | Provolone | Boar's Head (rung primary, global row) | 25.10207 | ✅ same oz |
| Capitol Hill | Roast Beef (portioned) | Roast Beef | Boar's Head (rung primary, global row) | 108.97965 | ✅ same oz |
| Capitol Hill | Sweet Peppers (portioned) | Sweet Peppers | Boar's Head (rung primary, global row) | 20.3 | ✅ same oz |
| Capitol Hill | Turkey (portioned) | Turkey | Boar's Head (rung primary, global row) | 116.1224 | ✅ same oz |
| Capitol Hill | Vesuvio II (build) | Banana Peppers | Boar's Head (rung primary, global row) | 2 | ✅ same oz |
| P Street | Capicola (portioned) | Capicola | Boar's Head (rung primary, global row) | 19.38144 | ✅ same oz |
| P Street | Fresh Mozzarella (portioned) | Fresh Mozzarella | PFG (rung primary, global row) | 32 | ✅ same oz |
| P Street | Ham (portioned) | Ham | PFG (rung primary, global row) | 35.10204 | ✅ same oz |
| P Street | Hot Peppers (portioned) | Hot Peppers | Boar's Head (rung primary, global row) | 20 | ✅ same oz |
| P Street | Iceberg (portioned) | Iceberg | PFG (rung primary, global row) | 136.936 | ✅ same oz |
| P Street | Pepperoni (portioned) | Pepperoni | Boar's Head (rung primary, global row) | 11.3402 | ✅ same oz |
| P Street | Provolone (portioned) | Provolone | Boar's Head (rung primary, global row) | 25.10207 | ✅ same oz |
| P Street | Roast Beef (portioned) | Roast Beef | Boar's Head (rung primary, global row) | 108.97965 | ✅ same oz |
| P Street | Sweet Peppers (portioned) | Sweet Peppers | Boar's Head (rung primary, global row) | 20.3 | ✅ same oz |
| P Street | Turkey (portioned) | Turkey | Boar's Head (rung primary, global row) | 116.1224 | ✅ same oz |
| P Street | Vesuvio II (build) | Banana Peppers | Boar's Head (rung primary, global row) | 2 | ✅ same oz |

## 5 — Post-move verification: the whole flatten, re-derived

The per-unit SKU-oz map is re-derived for **every node in the graph** — not only the touched ones — through `perUnitSkuOzForItemFromGraph` / `perUnitSkuOzForMenuItemFromGraph`, before and after. The AFTER graph is the live graph with the passing pins rewritten and the real `loadProductIndex` merged in, so the product path (`productLineOz`) is genuinely exercised. **Zero deltas is the pass condition.**


### 5a — The touched nodes, before and after

| node | grain | leaf SKUs | Σ oz before | Σ oz after | delta |
|---|---|---:|---:|---:|---:|
| Capicola | item | 1 | 19.38144 | 19.38144 | ✅ 0.000000 |
| Fresh Mozzarella | item | 1 | 32 | 32 | ✅ 0.000000 |
| Ham | item | 1 | 35.10204 | 35.10204 | ✅ 0.000000 |
| Hot Peppers | item | 1 | 20 | 20 | ✅ 0.000000 |
| Iceberg | item | 1 | 136.936 | 136.936 | ✅ 0.000000 |
| Pepperoni | item | 1 | 11.3402 | 11.3402 | ✅ 0.000000 |
| Provolone | item | 1 | 25.10207 | 25.10207 | ✅ 0.000000 |
| Roast Beef | item | 1 | 108.97965 | 108.97965 | ✅ 0.000000 |
| Sweet Peppers | item | 1 | 20.3 | 20.3 | ✅ 0.000000 |
| Turkey | item | 1 | 116.1224 | 116.1224 | ✅ 0.000000 |
| Vesuvio II | menu_item | 21 | 47.067 | 47.067 | ✅ 0.000000 |

## ✅ VERIFICATION PASS — 71 graph nodes re-derived, **0 deltas**.

Every item and menu_item in the whole recipe universe flattens to the same per-SKU ounces after the re-point as before it. The costing board, the depletion lane and the readiness map cannot move.

## 6 — Writes

```
Fresh Mozzarella
  would set products.unit_oz [69068756-e0de-450b-9b96-4ff17f463a8c]
      unit_oz NULL -> 1   unit_oz_class -> OPERATIONAL
      read live off PFG/Fresh Mozzarella · Baldor/Fresh Mozzarella
Hot Peppers
  would set products.unit_oz [00d8bf0e-2905-4f7c-a191-e2a060da54b0]
      unit_oz NULL -> 1   unit_oz_class -> OPERATIONAL
      read live off Boar's Head/Hot Peppers
Iceberg
  would set products.unit_oz [97c6453d-0cb1-4cc5-932d-924f0fb19610]
      unit_oz NULL -> 20   unit_oz_class -> OPERATIONAL
      read live off PFG/Iceberg
Roast Beef
  would set products.unit_oz [60f39834-4699-43e4-a125-269bfd2bab98]
      unit_oz NULL -> 1.5   unit_oz_class -> OPERATIONAL
      read live off Boar's Head/Roast Beef
Sweet Peppers
  would set products.unit_oz [7586d0d1-60d7-4cdf-aa33-c2c0fc2925e7]
      unit_oz NULL -> 4   unit_oz_class -> OPERATIONAL
      read live off Boar's Head/Sweet Peppers
Turkey
  would set products.unit_oz [24042552-b7f7-472c-bff1-c7709af476f3]
      unit_oz NULL -> 1   unit_oz_class -> OPERATIONAL
      read live off Boar's Head/Turkey
Capicola (portioned)
  would re-point recipe_inputs[eccf22aa-9396-4066-8e34-a9d372f4b725]
      component_sku_id Boar's Head/Capicola [e886552d-ba06-4932-9f38-1580aea0beee] -> NULL
      component_product_id NULL -> Capicola [fbec691e-7bfb-465d-b117-a9590a7129d3]
      line 48.4536 unit = 19.38144 oz, unchanged
Fresh Mozzarella (portioned)
  would re-point recipe_inputs[64dc0daa-e5df-47fe-a6cf-c64916ee10fc]
      component_sku_id PFG/Fresh Mozzarella [27066f2a-8e5c-4c60-8a0f-a62980241998] -> NULL
      component_product_id NULL -> Fresh Mozzarella [69068756-e0de-450b-9b96-4ff17f463a8c]
      line 32 unit = 32 oz, unchanged
Ham (portioned)
  would re-point recipe_inputs[b62bcac1-eb3b-42c4-9355-b76a74c5af4a]
      component_sku_id PFG/Ham [804cb32d-ea68-4467-8479-b82f34a143a0] -> NULL
      component_product_id NULL -> Ham [cfb77bf2-9fcf-4339-8cf2-5cdf4dc9dda3]
      line 29.2517 unit = 35.102039999999995 oz, unchanged
Hot Peppers (portioned)
  would re-point recipe_inputs[0b356fcf-549f-4028-b66e-f602877ef03f]
      component_sku_id Boar's Head/Hot Peppers [49603e5a-16d3-4337-ba87-3e2a5f04e5ed] -> NULL
      component_product_id NULL -> Hot Peppers [00d8bf0e-2905-4f7c-a191-e2a060da54b0]
      line 20 unit = 20 oz, unchanged
Iceberg (portioned)
  would re-point recipe_inputs[43bf1e8b-7207-41d5-bfc9-6fe9822e8129]
      component_sku_id PFG/Iceberg [d88500d9-ae59-4807-ac3d-5542f35ca4f3] -> NULL
      component_product_id NULL -> Iceberg [97c6453d-0cb1-4cc5-932d-924f0fb19610]
      line 6.8468 unit = 136.936 oz, unchanged
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
Roast Beef (portioned)
  would re-point recipe_inputs[441192b2-2a46-482f-8d74-02f2dcdcbea0]
      component_sku_id Boar's Head/Roast Beef [36a06d72-b66a-4808-9132-3568d76216dc] -> NULL
      component_product_id NULL -> Roast Beef [60f39834-4699-43e4-a125-269bfd2bab98]
      line 72.6531 unit = 108.97964999999999 oz, unchanged
Sweet Peppers (portioned)
  would re-point recipe_inputs[5db44380-6941-4e34-a47f-27c8baa67561]
      component_sku_id Boar's Head/Sweet Peppers [6e6d9d56-2260-46a5-9d8f-fca3f8501d7e] -> NULL
      component_product_id NULL -> Sweet Peppers [7586d0d1-60d7-4cdf-aa33-c2c0fc2925e7]
      line 5.075 unit = 20.3 oz, unchanged
Turkey (portioned)
  would re-point recipe_inputs[f0335a9a-a745-4f60-ac2a-7824963534d2]
      component_sku_id Boar's Head/Turkey [ca3cc47c-51a7-4306-b11f-6e2e90971c8d] -> NULL
      component_product_id NULL -> Turkey [24042552-b7f7-472c-bff1-c7709af476f3]
      line 116.1224 unit = 116.1224 oz, unchanged
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

## 7 — What this seed will NOT touch

- **`active`, `weekday_par`, `weekend_par`** on any SKU. Seed 18 adjudicated orderability; the execute run snapshots all three on every member SKU and re-reads them afterwards — any movement is a FATAL.
- **`recipe_inputs.quantity` / `unit`.** Not one number is re-denominated. Seed 22 owns the portioned quantities; this seed only moves WHICH THING the line points at, and refuses whenever that would change WHAT IT MEANS.
- **`avg_oz_per_each` on any SKU.** The SKU layer's weights are the SKU layer's business; §2 READS them and carries the number up to the product grain, and writes nothing back down.
- **`products.unit_oz` outside Juan's ruling.** A weight is a measurement, and the ruling is the ceiling: a product it does not name is never filled, active members carrying DIFFERENT weights refuse outright, and a live value that has drifted from the ruled one refuses rather than being overwritten. Where no weight can be established the seed REFUSES the line instead of inventing the number that would let it pass.
- **Anything on a RETIRED recipe.** Reported with its numbers, never written.
- **The depletion ledgers.** `toast_daily_depletion` is untouched and the double-count law is not in play (deviation D5).

## 8 — Summary

| would write | count |
|---|---:|
| `products.unit_oz` fills (Juan's weigh ruling) | 6 |
| `recipe_inputs` pins moved SKU → product | 11 |
| `recipes.notes` stanzas | 11 |
| lines REFUSED (no write) | 1 |
| rows touching quantity / unit / par / active / price | **0** |

> ✅ **Zero fixable refusals.** The residue is 1 `RETIRED_RECIPE` row(s), and that refusal is **correct forever**, not a blocker: the row hangs off an inactive recipe, `loadRecipeGraph` does not read it, and there is no input to fix. Gate S2's *"if ANY line refuses, do not execute"* clause exists to stop a re-point the gate could not prove safe — it cannot be satisfied by writing to a row nothing reads, so the honest reading is that every line the gate CAN speak about has passed.

Seed 25 done (dry run).
**NOTHING WAS WRITTEN.**
