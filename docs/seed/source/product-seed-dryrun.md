# Product identity — seed 24 DRY RUN (the 8-pair adjudication sheet)

> **STATUS: NOTHING HAS BEEN WRITTEN.** This is the output of `scripts/seed/24-product-identity.ts` in its default (dry-run) mode. The script writes only under an explicit `--execute` flag, and that flag is **gate S1** — it is not used until Juan has eyeballed section 3 and adjudicated the open pairs.

**Generated:** 2026-08-21, against live prod (`bgcvurheqzylyfehqgzh`) with migration `0179_product_identity` applied. Every SKU id, vendor, par, weight, pack content, price and delivery date below was resolved **live at run time** — nothing is copied from the audit's tables.

**Sources:** docs/superpowers/specs/2026-08-20-product-identity-design.md §2 · docs/superpowers/plans/2026-08-20-product-identity.md Phase 2 · docs/seed/source/twin-adjudication-dryrun.md (ham/mozz) · docs/seed/source/angel-wave4-dryrun.md §B (lettuce), §D1 (the 8 pairs)

## 1 — Discovery (computed live, this run)

182 SKUs in the registry. **11 names carry 2+ distinct vendors right now** — recomputed from `vendor_items`, not copied from the audit.

| product | vendor | state | par wd/we | avg_oz_per_each | content | pins | latest price | product_id |
|---|---|---|---:|---:|---:|---:|---|---|
| Banana Peppers | Baldor | inactive | — | 512 | 512 oz | 0 | $20.00 (2026-07-01) | — |
| Banana Peppers | Boar's Head | **active** | 1/– | — | — | 1 | — | — |
| Capicola | Baldor | inactive | — | — | — | 0 | — | — |
| Capicola | Boar's Head | **active** | 8/16 | 0.4 | 57.5 oz | 1 | $19.59 (2026-08-10) | — |
| Fresh Mozzarella | Baldor | **active** | — | 1 | 192 oz | 0 | — | — |
| Fresh Mozzarella | PFG | **active** | 12/– | 1 | 192 oz | 1 | $47.10 (2026-08-14) | — |
| Ham | Baldor | **active** | — | 1.2 | 16 oz | 0 | $2.77 (2026-08-14) | — |
| Ham | PFG | **active** | 3/– | 1.2 | 16 oz | 1 | $2.77 (2026-08-14) | — |
| Hot Peppers | Baldor | inactive | — | — | — | 1 | — | — |
| Hot Peppers | Boar's Head | **active** | 6/8 | 1 | — | 1 | — | — |
| Iceberg | PFG | **active** | 4/– | 20 | 640 oz | 1 | — | — |
| Lettuce | Baldor | **active** | — | — | — | 0 | — | — |
| Lettuce | Sysco | **active** | — | — | 225 oz | 0 | — | — |
| Pepperoni | Baldor | inactive | — | — | — | 0 | — | — |
| Pepperoni | Boar's Head | **active** | 3/5 | 0.2 | 55.9 oz | 1 | $18.13 (2026-08-10) | — |
| Provolone | Baldor | inactive | — | — | — | 0 | — | — |
| Provolone | Boar's Head | **active** | 8/16 | 0.7 | 88 oz | 1 | $19.20 (2026-08-10) | — |
| Roast Beef | Baldor | inactive | — | — | — | 0 | — | — |
| Roast Beef | Boar's Head | **active** | 2/4 | 1.5 | 110.9 oz | 1 | $60.23 (2026-08-10) | — |
| Sweet Peppers | Baldor | inactive | — | — | — | 0 | — | — |
| Sweet Peppers | Boar's Head | **active** | 6/8 | 4 | — | 1 | — | — |
| Turkey | Baldor | inactive | — | — | — | 0 | — | — |
| Turkey | Boar's Head | **active** | 9/22 | 1 | 148 oz | 1 | $58.18 (2026-08-10) | — |

> Every multi-vendor name discovered live is carried by the plan, and every planned product exists live. No drift.

### 1b — Receipt evidence (what the ladder's rung 2 can see)

| product | vendor | state | location | last received |
|---|---|---|---|---|
| Banana Peppers | Baldor | **inactive** | Capitol Hill | 2026-07-01 |

**This is the finding the plan did not anticipate.** Rung 2 of the ladder (*most-recently-RECEIVED active member*) is effectively dark across this whole candidate set: the only delivery line on file for any member sits on an **inactive** row, and `resolveProductMember` ignores inactive members by construction. So an unruled pair does **not** resolve on receipt recency — it falls to rung 3 (any active member, skuId-ascending). Rung 3 is stable and deterministic, never arbitrary at runtime, but it is decided by a uuid sort rather than by anything operational. The ladder column in section 3 shows what each pair answers today.

### 1c — Re-checking what the source documents claim (discipline zero, executed)

| the source document says | source | expected | live now | verdict |
|---|---|---|---|---|
| PFG/Ham carries avg_oz_per_each = NULL, so a product pin would resolve to null on the PFG side | seed 18 dry run · plan deviation D2 | NULL | 1.2 | **MOVED** |
| the Ham recipe pin sits on the BALDOR twin (seed 18 refused to move it) | seed 18 dry run §3 · audit P1 update | 1 pin(s) on Baldor/Ham | 0 pin(s) on Baldor/Ham | **MOVED** |
| PFG/Fresh Mozzarella carries avg_oz_per_each = NULL and its pack content is UNRESOLVABLE | seed 18 dry run §4 | NULL / content — | 1 / content 192 oz | **MOVED** |
| Baldor/Lettuce is INACTIVE | wave 4 §D1 table (before its §B activation ran) | inactive | active | **MOVED** |

> **4 of 4 claims have MOVED since the source documents were written.** That is information, not a fault, and `audit_log` says exactly why:

> - **18:51:53** — wave 3 (`scripts/seed/20-angel-wave3.ts`, `sku.weight_fill`) MIRRORED Juan's 1.2 oz onto the PFG ham twin *("applied to the PFG twin by MIRROR rather than by its own measurement because the twins are two vendor identities for one product")* and settled the mozzarella twin at 1 oz.
> - **18:51:56–57** — **seed 18 was re-run**, its oz-preservation gate passed for the first time, and both pins moved Baldor → PFG (`recipe.update` / `op: component_sku_repoint`). Seed 18 predicted this verbatim: *"re-running this script afterwards passes the gate and moves the pins with no code change."*
> - **19:58** — wave 4 §B activated the Baldor lettuce backup. **22:09** — seed 22 then re-denominated the portioned lines on the now-PFG pins.

> Two consequences worth naming. **(a)** The ham and mozzarella twins now **agree** on what one unit weighs — which is why `members disagree?` reads *no* for both in section 2, and why the Phase-4 re-point refusal the plan worries about is already discharged for those two pairs. **(b)** The pin state deviation D2 describes is not the pin state live. **Nothing in this seed depends on either claim** — it writes identity and nothing else — but the paragraphs of the plan that cite them should be read against this table rather than from memory.

## 2 — The plan, product by product

Every row below is a would-write in `--execute` mode. `products` rows are created, `vendor_items.product_id` is set, `product_primaries` rows are inserted **only where somebody actually ruled**, and `products.unit_oz` is filled **only from a measurement**.

| product | products row | name_es | # | members | primary (global) | unit_oz | members disagree? |
|---|---|---|---:|---|---|---:|---|
| Ham | CREATE | Jamón | 2 | PFG · Baldor | **PFG** | **1.2** (OPERATIONAL) | no |
| Fresh Mozzarella | CREATE | Mozzarella fresca | 2 | PFG · Baldor | **PFG** ⚠ *inferred* | — *(NULL, honest)* | no |
| Lettuce | CREATE | — *(no item match)* | 2 | Sysco · Baldor | **Sysco** ⚠ *inferred* | — *(NULL, honest)* | no |
| Iceberg | CREATE | Lechuga iceberg | 1 | PFG | — *(none; single member)* | — *(NULL, honest)* | no |
| Turkey | CREATE | Pavo | 2 | Boar's Head · Baldor *(inactive)* | **none — awaiting Juan** *(proposal: Boar's Head)* | — *(NULL, honest)* | no |
| Roast Beef | CREATE | Roast beef | 2 | Boar's Head · Baldor *(inactive)* | **none — awaiting Juan** *(proposal: Boar's Head)* | — *(NULL, honest)* | no |
| Provolone | CREATE | Provolone | 2 | Boar's Head · Baldor *(inactive)* | **none — awaiting Juan** *(proposal: Boar's Head)* | **0.7** (OPERATIONAL) | no |
| Capicola | CREATE | Capicola | 2 | Boar's Head · Baldor *(inactive)* | **none — awaiting Juan** *(proposal: Boar's Head)* | **0.4** (OPERATIONAL) | no |
| Pepperoni | CREATE | Pepperoni | 2 | Boar's Head · Baldor *(inactive)* | **none — awaiting Juan** *(proposal: Boar's Head)* | **0.2** (OPERATIONAL) | no |
| Banana Peppers | CREATE | — *(no item match)* | 2 | Boar's Head · Baldor *(inactive)* | **none — awaiting Juan** *(proposal: Boar's Head)* | — *(NULL, honest)* | no |
| Hot Peppers | CREATE | Pimientos picantes | 2 | Boar's Head · Baldor *(inactive)* | **none — awaiting Juan** *(proposal: Boar's Head)* | — *(NULL, honest)* | no |
| Sweet Peppers | CREATE | Pimientos dulces | 2 | Boar's Head · Baldor *(inactive)* | **none — awaiting Juan** *(proposal: Boar's Head)* | — *(NULL, honest)* | no |

> `name_es` is **carried from the prep layer's own item**, never authored here — the kitchen has called ham *Jamón* since the operational seed, and a product inventing a second Spanish word for the same thing is exactly the drift the system-key-vs-display-string rule prevents. No unambiguous active item of that name → NULL.

### 2b — Who decided each product, and where that is an inference

- **Ham** — Juan 2026-08-20, EXPLICIT — PFG primary / Baldor backup (seed 18). unit_oz 1.2 is his own weighing; it is what unblocks the Phase-4 ham re-point that seed 18 refused itself over.
  - primary basis (Juan 2026-08-20 (explicit)): The Angel row behind the spend (`HAM 35% WATER FC 4X6 TFF` [ROMA], $2,164.94/yr) is a PFG product, and PFG is the live distributor lane. Recorded in seed 18.
- **Fresh Mozzarella** — Juan 2026-08-20 for the SHAPE; the SIDE is an INFERENCE carried forward from seed 18 and still flagged. No unit_oz: mozzarella is not in OPERATIONAL_SLICE_OZ, so nobody has weighed it.
  - primary basis (Juan 2026-08-20 (shape only) — SIDE INFERRED by seed 18): Juan said 'both — one primary, one backup' without naming which. PFG was inferred from the same evidence shape as ham (`CHEESE MOZZ 1OZ SLCD LOG 32 CT` [ROMA] is a PFG row, $1,365.90/yr) and from ham's explicit answer. Veto = swap the vendor on this one line.
- **Lettuce** — Juan 2026-08-20 for the SHAPE; the SIDE is an INFERENCE carried forward from wave 4 §B and still flagged. See the ICEBERG section — whether this product and ICEBERG are ONE product is an OPEN question this seed does not answer.
  - primary basis (Juan 2026-08-20 (shape only) — SIDE INFERRED by seed 21 wave 4 §B): Juan named the shape (both-active, primary + backup, like ham). Sysco was inferred because it is the currently-active twin and the only one with a pack chain (box = 15 × 15 oz = 225 oz); the Baldor row is packless, priceless and pinless. Veto = swap the vendor on this one line.
- **Iceberg** — Created per spec §2/§Payoff ('ICEBERG product absorbs the $3,231 attribution'). NO primary row: with exactly one member the ladder already answers it on rung 3, and designating a primary before the MEMBERSHIP question is settled would encode an answer to the open question. See the ICEBERG section.
- **Turkey** — UNADJUDICATED — awaiting Juan (gate S1). Product + members only; NO primary row is written.
- **Roast Beef** — UNADJUDICATED — awaiting Juan (gate S1). Product + members only; NO primary row is written.
- **Provolone** — UNADJUDICATED primary — awaiting Juan. unit_oz 0.7 IS ruled (Juan's own weighing) and is written regardless: what one slice weighs is a fact about the product, not about which vendor sells it.
- **Capicola** — UNADJUDICATED primary — awaiting Juan. unit_oz 0.4 IS ruled (Juan's own weighing) and is written regardless.
- **Pepperoni** — UNADJUDICATED primary — awaiting Juan. unit_oz 0.2 IS ruled (Juan's own weighing) and is written regardless.
- **Banana Peppers** — UNADJUDICATED — awaiting Juan (gate S1). Product + members only; NO primary row is written.
- **Hot Peppers** — UNADJUDICATED — awaiting Juan (gate S1). This is the ONE pair that is not the common shape: a pin sits on the INACTIVE Baldor row too. Product identity is what eventually fixes that (Phase 4 re-points both pins at the product), but this seed does not touch a pin.
- **Sweet Peppers** — UNADJUDICATED — awaiting Juan (gate S1). Product + members only; NO primary row is written.

## 3 — THE DECISION TABLE: 8 pairs awaiting Juan's word 🔒 GATE S1

**This table is the adjudication sheet.** For each pair: which vendor is PRIMARY, and is that answer explicit or an inference. A default is proposed for every row — the reading the live data already supports — so the sitting is a confirm-or-amend, not a blank page. **Nothing in this section is written until the answers are encoded in `PRODUCTS` and the dry run is re-run.**

| pair | proposed primary | the other member | DEFAULT | ladder answers today | Juan |
|---|---|---|---|---|---|
| Turkey | Boar's Head (active, par 9/22, 1 pin) | Baldor (inactive, 0 pin) | **Boar's Head** | Boar's Head *(rung 3 · any active member)* | ☐ confirm  ☐ amend → ______ |
| Roast Beef | Boar's Head (active, par 2/4, 1 pin) | Baldor (inactive, 0 pin) | **Boar's Head** | Boar's Head *(rung 3 · any active member)* | ☐ confirm  ☐ amend → ______ |
| Provolone | Boar's Head (active, par 8/16, 1 pin) | Baldor (inactive, 0 pin) | **Boar's Head** | Boar's Head *(rung 3 · any active member)* | ☐ confirm  ☐ amend → ______ |
| Capicola | Boar's Head (active, par 8/16, 1 pin) | Baldor (inactive, 0 pin) | **Boar's Head** | Boar's Head *(rung 3 · any active member)* | ☐ confirm  ☐ amend → ______ |
| Pepperoni | Boar's Head (active, par 3/5, 1 pin) | Baldor (inactive, 0 pin) | **Boar's Head** | Boar's Head *(rung 3 · any active member)* | ☐ confirm  ☐ amend → ______ |
| Banana Peppers | Boar's Head (active, par 1/–, 1 pin) | Baldor (inactive, 0 pin) | **Boar's Head** | Boar's Head *(rung 3 · any active member)* | ☐ confirm  ☐ amend → ______ |
| Hot Peppers | Boar's Head (active, par 6/8, 1 pin) | Baldor (inactive, 1 pin) | **Boar's Head** | Boar's Head *(rung 3 · any active member)* | ☐ confirm  ☐ amend → ______ |
| Sweet Peppers | Boar's Head (active, par 6/8, 1 pin) | Baldor (inactive, 0 pin) | **Boar's Head** | Boar's Head *(rung 3 · any active member)* | ☐ confirm  ☐ amend → ______ |

> **Why this default.** Boar's Head is the only ACTIVE member and holds the par; the Baldor twin is inactive, parless and priceless. The resolution ladder already answers Boar's Head today (rung 3 — see the ladder column); a primary row makes that explicit and keeps it true the day the Baldor row is reactivated as a backup.

> **Confirming the default changes nothing operationally today** — the ladder already lands on the same member, because it is the only active one. What the primary row buys is durability: the day a Baldor row is reactivated as a backup, resolution keeps answering Boar's Head instead of silently re-deciding on rung 3.

> **Amending is one field.** Swap `proposed` → `primary` with the other vendor in `PRODUCTS` and re-run the dry run; nothing else in this script encodes the choice.

> ⚠ **Not all 8 are the same shape.** **Hot Peppers** carries a recipe pin on MORE THAN ONE member — including an inactive one. That is audit gap P5 (two recipes pinning different vendors, resolved by a row-order coin flip inside `buildRecipeGraph`). Product identity is the eventual fix; this seed does not touch a pin.

> **Per-location primaries are not seeded.** Every primary here is the GLOBAL row (`location_id` NULL), which both shops (Capitol Hill · P Street) resolve against. A per-shop override is one row and can be added from `/admin/products` the day a shop genuinely disagrees; writing two identical rows today would only be two rows to maintain.

## 4 — ICEBERG: the $3,230.74 attribution question 🔒 DECISION, NOT A WRITE

Angel invoiced **$3,230.74 of iceberg across 15 lines** in the five-week window. Every one of those rows is a **PFG** or **US Foods** row. Our registry's lettuce lane is **Sysco** and **Baldor** — neither twin appears in the purchase history once, under any spelling (wave 4 §B1).

| Angel row | brand | vendor | pack | lines | spend | reading |
|---|---|---|---|---:|---:|---|
| LETTUCE ICEBERG LINER | PEAK FRS | PFG | 24/1 CT | 5 | $1,937.92 | The dominant row by a distance — 61 units. ~42 lb per 24-count case ≈ 1.75 lb/head, which reads like whole heads. |
| Lettuce, Iceberg Cleaned & Trimmed Fresh Ref | Cross Valley Farms | US Foods | 4/6 EA | 5 | $1,050.15 | The biggest percentage price mover in the whole harvest (+70.1%). On the US Foods lane we migrated away from. |
| LETTUCE ICEBERG C&T | PACKER | PFG | 4/6 CT | 3 | $140.61 | PFG's own cleaned-&-trimmed line. Price never moved across 3 lines. |
| LETTUCE CELLO ICEBERG CA | PACKER | PFG | 1/24 CT | 2 | $102.06 | Cello-wrapped, 24 count. The most likely occasional substitute rather than a standing buy. |


### 4a — what we actually hold, live

| our SKU | state | par wd/we | pack content | pins | latest price |
|---|---|---:|---:|---:|---:|
| PFG/Iceberg | active | 4/– | 640 oz | 1 | — |
| Sysco/Lettuce | active | — | 225 oz | 0 | — |
| Baldor/Lettuce | active | — | — | 0 | — |

Three facts that bear on the question and are easy to miss: (a) the **prep layer already calls this thing Iceberg** — there is an active `items` row named *Iceberg* and **no item named Lettuce**; (b) the only SKU carrying a par, a recipe pin and a price is **PFG/Iceberg**; (c) both `Lettuce` twins carry **zero** pins, **zero** pars and no price, and the Baldor one has no pack chain at all.


### 4b — the question, and the three dispositions

**Does the ICEBERG product absorb the Lettuce twins, or are they two different products?**

- **A — one product.** Attach `Sysco/Lettuce` and `Baldor/Lettuce` to **ICEBERG** as members and retire the separate LETTUCE product (`active = false`; nothing is ever deleted). Reading: shredduce is shredduce, the vendor lane moved to PFG, and the Sysco/Baldor rows are the backup lane. This is the disposition the live data leans toward — but leaning is not ruling.
- **B — two products.** ICEBERG (the PFG whole-head lane, which is what the recipes consume) stays distinct from LETTUCE (the Sysco/Baldor lane). Reading: `LETTUCE ICEBERG LINER` at ~1.75 lb/head is whole heads, while the C&T rows are a genuinely different, pre-trimmed product — two products that happen to share a word.
- **C — retire the twins.** If the Sysco/Baldor lettuce lane is simply dead history, deactivate both SKUs and let ICEBERG be a singleton. Reading: the twins have never been received, priced, pinned or par'd. **Note this is the one disposition that touches `active`, which this seed will not do** — it would be a separate, named write.

> **This seed answers none of the three.** It creates the ICEBERG product with `PFG/Iceberg` attached and **no primary row**, and it creates LETTUCE with its ruled (inferred) Sysco primary. Whichever way Juan rules, the move is one attach/detach and one `active` flip from `/admin/products` — no migration, no re-seed. What the product row buys today is a **grain for the question to live at**, which is the whole reason the spec names ICEBERG explicitly.

> **What it does NOT decide.** Whether a `PFG/Lettuce` SKU should be created for `LETTUCE ICEBERG LINER` (wave 4 §B1's open registry question) is still open and still not a thing a script can infer from a spend table.

## 5 — unit_oz: what is RULED (written) vs what is merely OBSERVED (not written)

`products.unit_oz` is what ONE unit of the product weighs, and it is what keeps a product-pinned recipe line meaning the same ounces after a member flip (deviation D2). Only a **measurement** is written.


### 5a — written this run

| product | unit_oz | class | live member values | provenance |
|---|---:|---|---|---|
| Ham | 1.2 | OPERATIONAL | PFG 1.2 · Baldor 1.2 | Juan's weighing (OPERATIONAL_SLICE_OZ) |
| Provolone | 0.7 | OPERATIONAL | Boar's Head 0.7 | Juan's weighing (OPERATIONAL_SLICE_OZ) |
| Capicola | 0.4 | OPERATIONAL | Boar's Head 0.4 | Juan's weighing (OPERATIONAL_SLICE_OZ) |
| Pepperoni | 0.2 | OPERATIONAL | Boar's Head 0.2 | Juan's weighing (OPERATIONAL_SLICE_OZ) |

### 5b — left NULL (reported only)

| product | candidate | live member values | why not written |
|---|---:|---|---|
| Fresh Mozzarella | 1 | PFG 1 · Baldor 1 | members agree — but two estimates agreeing is still not a measurement |
| Lettuce | — *(no member value)* | — | no active member carries a weight — nothing to observe |
| Iceberg | 20 | PFG 20 | ONE member's estimate — a candidate, not a measurement |
| Turkey | 1 | Boar's Head 1 | ONE member's estimate — a candidate, not a measurement |
| Roast Beef | 1.5 | Boar's Head 1.5 | ONE member's estimate — a candidate, not a measurement |
| Banana Peppers | — *(no member value)* | — | no active member carries a weight — nothing to observe |
| Hot Peppers | 1 | Boar's Head 1 | ONE member's estimate — a candidate, not a measurement |
| Sweet Peppers | 4 | Boar's Head 4 | ONE member's estimate — a candidate, not a measurement |

> **Agreement between two estimates is not a measurement.** Every `avg_oz_per_each` in column 3 that is not one of Juan's five ruled values is a seed-10 estimate. NULL is the honest value (the 0161 LOCK-1 doctrine: *a sentinel would be a SILENT-WRONG-NUMBER trap*), and the Phase-4 re-point script refuses a count-denominated line whose product has no `unit_oz` rather than resolving it through whichever member happens to be primary that day — which is exactly the refusal seed 18 made.
> Genoa (0.4) is in `OPERATIONAL_SLICE_OZ` and is deliberately **absent** here: Genoa is a single-vendor SKU, so it is an implicit singleton and needs no product row. Its weight already lives where it belongs, on the SKU.

## 6 — What this seed will NOT touch

- **`active`, `weekday_par`, `weekend_par`** on any SKU. Seed 18 adjudicated orderability and seed 21 §B finished the lettuce pair; re-litigating either here would silently undo Juan's P1 decision. The execute run snapshots all three columns on every member and re-reads them afterwards — any movement is a FATAL, not a warning.
- **`recipe_inputs`.** Not one pin moves. Re-pointing is Phase 4, deliberately after the reader exists (deviation D1).
- **`vendor_price_history`.** Append-only and untouched; no price is derived, corrected or attributed here.
- **`avg_oz_per_each`** on any SKU. The SKU layer's weights are the SKU layer's business; `products.unit_oz` is a new, separate fact.
- **Any behavior.** Nothing in the app reads `vendor_items.product_id` until Phase 3, so every board, walk and count sheet renders byte-identically after this runs.

## 7 — Writes

```
Ham
  would CREATE products row
  would attach 2 members
  would set primary = PFG
  would set unit_oz = 1.2 (OPERATIONAL)
Fresh Mozzarella
  would CREATE products row
  would attach 2 members
  would set primary = PFG  ⚠ INFERRED
Lettuce
  would CREATE products row
  would attach 2 members
  would set primary = Sysco  ⚠ INFERRED
Iceberg
  would CREATE products row
  would attach 1 member
  NO primary row (single member)
Turkey
  would CREATE products row
  would attach 2 members
  NO primary row — UNADJUDICATED (proposal: Boar's Head)
Roast Beef
  would CREATE products row
  would attach 2 members
  NO primary row — UNADJUDICATED (proposal: Boar's Head)
Provolone
  would CREATE products row
  would attach 2 members
  NO primary row — UNADJUDICATED (proposal: Boar's Head)
  would set unit_oz = 0.7 (OPERATIONAL)
Capicola
  would CREATE products row
  would attach 2 members
  NO primary row — UNADJUDICATED (proposal: Boar's Head)
  would set unit_oz = 0.4 (OPERATIONAL)
Pepperoni
  would CREATE products row
  would attach 2 members
  NO primary row — UNADJUDICATED (proposal: Boar's Head)
  would set unit_oz = 0.2 (OPERATIONAL)
Banana Peppers
  would CREATE products row
  would attach 2 members
  NO primary row — UNADJUDICATED (proposal: Boar's Head)
Hot Peppers
  would CREATE products row
  would attach 2 members
  NO primary row — UNADJUDICATED (proposal: Boar's Head)
Sweet Peppers
  would CREATE products row
  would attach 2 members
  NO primary row — UNADJUDICATED (proposal: Boar's Head)
```

## 8 — Summary

| would write | count |
|---|---:|
| `products` rows | 12 |
| member attachments (`vendor_items.product_id`) | 23 |
| `product_primaries` rows | 3  *(1 explicit, 2 inferred)* |
| `products.unit_oz` fills | 4 |
| **pairs left UNADJUDICATED (no primary row)** | **8** |
| rows touching `active` / par / pins / prices | **0** |

**8 of 12 products will have no primary row after this seed runs.** That is the designed end-state of the dry run, not a shortfall: resolution answers them on the ladder's lower rungs (section 3's ladder column shows exactly what each one answers today), and a primary nobody designated would be a fact invented by a script.


### To proceed

```
# 1. Juan adjudicates section 3 (and rules on section 4's ICEBERG question).
# 2. LEAD encodes the answers in PRODUCTS (swap `proposed` -> `primary`) and re-runs the dry run.
# 3. LEAD runs, and pastes the output into the PR:
npx tsx --conditions=react-server --env-file=.env.local scripts/seed/24-product-identity.ts --execute
```

Every write is guarded on the live row still reading the state the plan was built against — `.is("product_id", null)` on an attach, `.is("unit_oz", null)` on a weight, an existing-row check before a primary — so a second run reports "already" on everything and writes nothing.

Seed 24 done (dry run).
**NOTHING WAS WRITTEN.**
