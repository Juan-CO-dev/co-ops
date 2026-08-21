# Product identity — seed 24 DRY RUN (adjudication RULED, 2026-08-21)

> **STATUS: NOTHING HAS BEEN WRITTEN.** This is the output of `scripts/seed/24-product-identity.ts` in its default (dry-run) mode. The script writes only under an explicit `--execute` flag, which is **gate S1** and belongs to the lead.

> **Juan's rulings of 2026-08-21 are encoded in this revision** — all 8 pairs confirmed at the Boar's Head default (§3), and ICEBERG ruled at disposition A with a PFG primary (§4). This page is the record of what WILL be written, not a page of open questions.

**Generated:** 2026-08-21, against live prod (`bgcvurheqzylyfehqgzh`) with migration `0179_product_identity` applied. Every SKU id, vendor, par, weight, pack content, price and delivery date below was resolved **live at run time** — nothing is copied from the audit's tables.

**Sources:** docs/superpowers/specs/2026-08-20-product-identity-design.md §2 · docs/superpowers/plans/2026-08-20-product-identity.md Phase 2 · docs/seed/source/twin-adjudication-dryrun.md (ham/mozz) · docs/seed/source/angel-wave4-dryrun.md §B (lettuce), §D1 (the 8 pairs)

## 1 — Discovery (computed live, this run)

182 SKUs in the registry. **11 names carry 2+ distinct vendors right now** — recomputed from `vendor_items`, not copied from the audit.

| SKU name | → product | vendor | state | par wd/we | avg_oz_per_each | content | pins | latest price | product_id |
|---|---|---|---|---:|---:|---:|---:|---|---|
| Banana Peppers | Banana Peppers | Baldor | inactive | — | 512 | 512 oz | 0 | $20.00 (2026-07-01) | — |
| Banana Peppers | Banana Peppers | Boar's Head | **active** | 1/– | — | — | 1 | — | — |
| Capicola | Capicola | Baldor | inactive | — | — | — | 0 | — | — |
| Capicola | Capicola | Boar's Head | **active** | 8/16 | 0.4 | 57.5 oz | 1 | $19.59 (2026-08-10) | — |
| Fresh Mozzarella | Fresh Mozzarella | Baldor | **active** | — | 1 | 192 oz | 0 | — | — |
| Fresh Mozzarella | Fresh Mozzarella | PFG | **active** | 12/– | 1 | 192 oz | 1 | $47.10 (2026-08-14) | — |
| Ham | Ham | Baldor | **active** | — | 1.2 | 16 oz | 0 | $2.77 (2026-08-14) | — |
| Ham | Ham | PFG | **active** | 3/– | 1.2 | 16 oz | 1 | $2.77 (2026-08-14) | — |
| Hot Peppers | Hot Peppers | Baldor | inactive | — | — | — | 1 | — | — |
| Hot Peppers | Hot Peppers | Boar's Head | **active** | 6/8 | 1 | — | 1 | — | — |
| Iceberg | Iceberg | PFG | **active** | 4/– | 20 | 640 oz | 1 | — | — |
| Lettuce | Iceberg | Baldor | **active** | — | — | — | 0 | — | — |
| Lettuce | Iceberg | Sysco | **active** | — | — | 225 oz | 0 | — | — |
| Pepperoni | Pepperoni | Baldor | inactive | — | — | — | 0 | — | — |
| Pepperoni | Pepperoni | Boar's Head | **active** | 3/5 | 0.2 | 55.9 oz | 1 | $18.13 (2026-08-10) | — |
| Provolone | Provolone | Baldor | inactive | — | — | — | 0 | — | — |
| Provolone | Provolone | Boar's Head | **active** | 8/16 | 0.7 | 88 oz | 1 | $19.20 (2026-08-10) | — |
| Roast Beef | Roast Beef | Baldor | inactive | — | — | — | 0 | — | — |
| Roast Beef | Roast Beef | Boar's Head | **active** | 2/4 | 1.5 | 110.9 oz | 1 | $60.23 (2026-08-10) | — |
| Sweet Peppers | Sweet Peppers | Baldor | inactive | — | — | — | 0 | — | — |
| Sweet Peppers | Sweet Peppers | Boar's Head | **active** | 6/8 | 4 | — | 1 | — | — |
| Turkey | Turkey | Baldor | inactive | — | — | — | 0 | — | — |
| Turkey | Turkey | Boar's Head | **active** | 9/22 | 1 | 148 oz | 1 | $58.18 (2026-08-10) | — |

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
| Iceberg | CREATE | Lechuga iceberg | 3 | PFG · Sysco · Baldor | **PFG** | — *(NULL, honest)* | no |
| Turkey | CREATE | Pavo | 2 | Boar's Head · Baldor *(inactive)* | **Boar's Head** | — *(NULL, honest)* | no |
| Roast Beef | CREATE | Roast beef | 2 | Boar's Head · Baldor *(inactive)* | **Boar's Head** | — *(NULL, honest)* | no |
| Provolone | CREATE | Provolone | 2 | Boar's Head · Baldor *(inactive)* | **Boar's Head** | **0.7** (OPERATIONAL) | no |
| Capicola | CREATE | Capicola | 2 | Boar's Head · Baldor *(inactive)* | **Boar's Head** | **0.4** (OPERATIONAL) | no |
| Pepperoni | CREATE | Pepperoni | 2 | Boar's Head · Baldor *(inactive)* | **Boar's Head** | **0.2** (OPERATIONAL) | no |
| Banana Peppers | CREATE | — *(no item match)* | 2 | Boar's Head · Baldor *(inactive)* | **Boar's Head** | — *(NULL, honest)* | no |
| Hot Peppers | CREATE | Pimientos picantes | 2 | Boar's Head · Baldor *(inactive)* | **Boar's Head** | — *(NULL, honest)* | no |
| Sweet Peppers | CREATE | Pimientos dulces | 2 | Boar's Head · Baldor *(inactive)* | **Boar's Head** | — *(NULL, honest)* | no |

> `name_es` is **carried from the prep layer's own item**, never authored here — the kitchen has called ham *Jamón* since the operational seed, and a product inventing a second Spanish word for the same thing is exactly the drift the system-key-vs-display-string rule prevents. No unambiguous active item of that name → NULL.

### 2b — Who decided each product, and where that is an inference

- **Ham** — Juan 2026-08-20, EXPLICIT — PFG primary / Baldor backup (seed 18). unit_oz 1.2 is his own weighing; it is what unblocks the Phase-4 ham re-point that seed 18 refused itself over.
  - primary basis (Juan 2026-08-20 (explicit)): The Angel row behind the spend (`HAM 35% WATER FC 4X6 TFF` [ROMA], $2,164.94/yr) is a PFG product, and PFG is the live distributor lane. Recorded in seed 18.
- **Fresh Mozzarella** — Juan 2026-08-20 for the SHAPE; the SIDE is an INFERENCE carried forward from seed 18 and still flagged. No unit_oz: mozzarella is not in OPERATIONAL_SLICE_OZ, so nobody has weighed it.
  - primary basis (Juan 2026-08-20 (shape only) — SIDE INFERRED by seed 18): Juan said 'both — one primary, one backup' without naming which. PFG was inferred from the same evidence shape as ham (`CHEESE MOZZ 1OZ SLCD LOG 32 CT` [ROMA] is a PFG row, $1,365.90/yr) and from ham's explicit answer. Veto = swap the vendor on this one line.
- **Iceberg** — Juan 2026-08-21, EXPLICIT — disposition A (merge) + PFG primary. There is deliberately NO separate LETTUCE product: 'retire the separate LETTUCE product' is discharged by never creating it, since nothing had been written. Both twins keep their current active/par state as backups; this seed does not touch either.
  - primary basis (Juan 2026-08-21 (explicit) — 'go with PFG for iceberg'): Disposition A of the seed-24 dry run §4b: the Lettuce twins fold into ICEBERG as members and PFG/Iceberg is primary. It is the SKU that carries the par, the recipe pin and the pack (640 oz), the prep layer already calls the thing Iceberg, and every Angel iceberg row in the window is PFG or US Foods. SUPERSEDES the Sysco-primary side-inference that wave 4 §B recorded for the Lettuce pair — that inference was about a Lettuce product which, under this ruling, does not exist.
  - **SUPERSEDES:** wave 4 §B's INFERRED Sysco-primary designation for the Lettuce twins (docs/seed/source/angel-wave4-dryrun.md §B). Juan named the shape there and the side was read off the evidence; he has now named the side, and it is PFG at the ICEBERG grain. The wave 4 SKU-level writes (Baldor/Lettuce activation) stand untouched — only the product-layer primary is decided here.
- **Turkey** — RULED 2026-08-21 — Juan confirmed the proposed Boar's Head default. Product + members + the global primary row.
- **Roast Beef** — RULED 2026-08-21 — Juan confirmed the proposed Boar's Head default. Product + members + the global primary row.
- **Provolone** — RULED 2026-08-21 — Juan confirmed the proposed Boar's Head default. unit_oz 0.7 was already ruled by his own weighing and is written independently: what one slice weighs is a fact about the product, not about which vendor sells it.
- **Capicola** — RULED 2026-08-21 — Juan confirmed the proposed Boar's Head default. unit_oz 0.4 was already ruled by his own weighing and is written independently.
- **Pepperoni** — RULED 2026-08-21 — Juan confirmed the proposed Boar's Head default. unit_oz 0.2 was already ruled by his own weighing and is written independently.
- **Banana Peppers** — RULED 2026-08-21 — Juan confirmed the proposed Boar's Head default. Product + members + the global primary row.
- **Hot Peppers** — RULED 2026-08-21 — Juan confirmed the proposed Boar's Head default, and the confirmation is worth MORE here than on the other seven: this is the one pair that is not the common shape, because a pin sits on the INACTIVE Baldor row too (audit P5). A designated primary is what Phase 4 will re-point both pins at. This seed still touches no pin.
- **Sweet Peppers** — RULED 2026-08-21 — Juan confirmed the proposed Boar's Head default. Product + members + the global primary row.

> **The 8 confirmed defaults share one basis**, because they were one decision applied 8 times (Juan 2026-08-21 (confirmed the proposed default, all 8 in one sitting)): Juan read the proposed default in the seed-24 dry run (§3) and CONFIRMED all eight at Boar's Head. Boar's Head is the only ACTIVE member and holds the par; the Baldor twin is inactive, parless and priceless. The resolution ladder already answers Boar's Head today (rung 3 — see the ladder column); a primary row makes that explicit and keeps it true the day the Baldor row is reactivated as a backup. This is a confirmation of a default the script proposed, not a value the script inferred: the proposal was presented as a decision row and he answered it.

## 3 — THE 8 PAIRS: ✅ RULED (Juan, 2026-08-21)

**Gate S1's adjudication is done.** The previous revision of this page proposed a Boar's Head default for all 8 pairs and asked Juan to confirm or amend each. **He confirmed all 8 in one sitting** — which is what wave 4 §D1 predicted would happen (*"one decision applied eight times … worth one question to Juan rather than eight"*). Every row below now writes a global `product_primaries` row.

| pair | PRIMARY (ruled) | backup member | ladder answers without the row | Juan 2026-08-21 |
|---|---|---|---|---|
| Turkey | **Boar's Head** (active, par 9/22, 1 pin) | Baldor (inactive, 0 pin) | Boar's Head *(rung 3 · any active member)* | ✅ **CONFIRMED** — writes a primary row |
| Roast Beef | **Boar's Head** (active, par 2/4, 1 pin) | Baldor (inactive, 0 pin) | Boar's Head *(rung 3 · any active member)* | ✅ **CONFIRMED** — writes a primary row |
| Provolone | **Boar's Head** (active, par 8/16, 1 pin) | Baldor (inactive, 0 pin) | Boar's Head *(rung 3 · any active member)* | ✅ **CONFIRMED** — writes a primary row |
| Capicola | **Boar's Head** (active, par 8/16, 1 pin) | Baldor (inactive, 0 pin) | Boar's Head *(rung 3 · any active member)* | ✅ **CONFIRMED** — writes a primary row |
| Pepperoni | **Boar's Head** (active, par 3/5, 1 pin) | Baldor (inactive, 0 pin) | Boar's Head *(rung 3 · any active member)* | ✅ **CONFIRMED** — writes a primary row |
| Banana Peppers | **Boar's Head** (active, par 1/–, 1 pin) | Baldor (inactive, 0 pin) | Boar's Head *(rung 3 · any active member)* | ✅ **CONFIRMED** — writes a primary row |
| Hot Peppers | **Boar's Head** (active, par 6/8, 1 pin) | Baldor (inactive, 1 pin) | Boar's Head *(rung 3 · any active member)* | ✅ **CONFIRMED** — writes a primary row |
| Sweet Peppers | **Boar's Head** (active, par 6/8, 1 pin) | Baldor (inactive, 0 pin) | Boar's Head *(rung 3 · any active member)* | ✅ **CONFIRMED** — writes a primary row |

> **The ruling is recorded as a CONFIRMED DEFAULT, not as an inference and not as a cold instruction.** `product_primaries.note` and every audit row carry `primary_is_inferred: false` **and** `confirms_proposed_default: true`, because "he said Boar's Head" and "he read our reading and said yes" are both explicit but only one of them started life as ours — and an auditor a year from now should be able to tell which.

> **What the rows buy.** Operationally nothing changes today: the ladder already lands on Boar's Head for all 8, because it is the only ACTIVE member (rung 3, the column above). What the designation buys is durability — the day a Baldor row is reactivated as a backup, resolution keeps answering Boar's Head instead of silently re-deciding on a uuid sort.

> ⚠ **One of them was never the same shape.** **Hot Peppers** carries a recipe pin on MORE THAN ONE member — including an inactive one. That is audit gap P5 (two recipes pinning different vendors, resolved by a row-order coin flip inside `buildRecipeGraph`). The ruled primary is exactly what Phase 4 will re-point both pins at; this seed still touches no pin.

> **Per-location primaries are not seeded.** Every primary here is the GLOBAL row (`location_id` NULL), which both shops (Capitol Hill · P Street) resolve against. A per-shop override is one row and can be added from `/admin/products` the day a shop genuinely disagrees; writing two identical rows today would only be two rows to maintain.

## 4 — ICEBERG: the $3,230.74 attribution question — ✅ RULED (Juan, 2026-08-21)

Angel invoiced **$3,230.74 of iceberg across 15 lines** in the five-week window. Every one of those rows is a **PFG** or **US Foods** row, while our registry's lettuce lane was **Sysco** and **Baldor** — neither twin appears in the purchase history once, under any spelling (wave 4 §B1). Juan's merge ruling is what closes that gap: after this seed, those invoices attribute to a product we hold.

| Angel row | brand | vendor | pack | lines | spend | reading |
|---|---|---|---|---:|---:|---|
| LETTUCE ICEBERG LINER | PEAK FRS | PFG | 24/1 CT | 5 | $1,937.92 | The dominant row by a distance — 61 units. ~42 lb per 24-count case ≈ 1.75 lb/head, which reads like whole heads. |
| Lettuce, Iceberg Cleaned & Trimmed Fresh Ref | Cross Valley Farms | US Foods | 4/6 EA | 5 | $1,050.15 | The biggest percentage price mover in the whole harvest (+70.1%). On the US Foods lane we migrated away from. |
| LETTUCE ICEBERG C&T | PACKER | PFG | 4/6 CT | 3 | $140.61 | PFG's own cleaned-&-trimmed line. Price never moved across 3 lines. |
| LETTUCE CELLO ICEBERG CA | PACKER | PFG | 1/24 CT | 2 | $102.06 | Cello-wrapped, 24 count. The most likely occasional substitute rather than a standing buy. |


### 4a — what we actually hold, live

| our SKU | role | state | par wd/we | pack content | pins | latest price |
|---|---|---|---:|---:|---:|---:|
| PFG/Iceberg | **PRIMARY** | active | 4/– | 640 oz | 1 | — |
| Sysco/Lettuce | backup | active | — | 225 oz | 0 | — |
| Baldor/Lettuce | backup | active | — | — | 0 | — |

Three facts stood behind the ruling: (a) the **prep layer already calls this thing Iceberg** — there is an active `items` row named *Iceberg* and **no item named Lettuce**; (b) the only SKU carrying a par, a recipe pin and a resolved pack is **PFG/Iceberg**; (c) both `Lettuce` rows carry **zero** pins, **zero** pars and no price, and the Baldor one has no pack chain at all.


### 4b — the ruling

**Juan 2026-08-21, disposition A: one product, PFG primary.** *"go with PFG for iceberg."*

- `Sysco/Lettuce` and `Baldor/Lettuce` attach to **ICEBERG** as members. Shredduce is shredduce; the vendor lane is PFG and the two Lettuce rows are the backup lane. This is the reading the live data leaned toward and it is now ruled rather than leaned.
- **No separate LETTUCE product is created.** Disposition A says to retire it; nothing had been written, so retiring it means never creating it. That is the cleanest possible discharge of the ruling — no row to deactivate, no orphaned identity, no second Spanish word for one thing.
- **`PFG/Iceberg` is the global primary.** It carries the par (4), the recipe pin and the only resolved pack (640 oz); the prep layer already calls the thing *Iceberg*; and every Angel iceberg row in the window is PFG or US Foods.

> **This SUPERSEDES a standing inference, and says so out loud.** Wave 4 §B recorded a **Sysco-primary** designation for the Lettuce pair — Juan named the shape there and the SIDE was read off the evidence (Sysco was the active twin with the only pack chain). That inference was about a LETTUCE product which, under this ruling, does not exist. The supersession is written into `product_primaries.note` and into the audit row's `supersedes` key rather than being quietly dropped — a ruling replaced silently is a ruling nobody can audit.

> **The SKU layer is untouched.** Wave 4's activation of `Baldor/Lettuce` stands; both twins keep their current `active` state and their NULL pars, exactly as backups should. This seed writes identity only, and the orderability assertion in section 6 proves it rather than promising it.

> **What is still open.** Whether a `PFG/Lettuce` SKU should be created for `LETTUCE ICEBERG LINER` (wave 4 §B1's registry question) is untouched by this ruling, and neither twin has ever carried a par — so ICEBERG is now one product with three vendor lanes and still no floor number. A par is a floor decision; seed 18's rule holds: *refusing to invent one.*

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
| Iceberg | 20 | PFG 20 | ONE member's estimate — a candidate, not a measurement |
| Turkey | 1 | Boar's Head 1 | ONE member's estimate — a candidate, not a measurement |
| Roast Beef | 1.5 | Boar's Head 1.5 | ONE member's estimate — a candidate, not a measurement |
| Banana Peppers | — *(no member value)* | — | no active member carries a weight — nothing to observe |
| Hot Peppers | 1 | Boar's Head 1 | ONE member's estimate — a candidate, not a measurement |
| Sweet Peppers | 4 | Boar's Head 4 | ONE member's estimate — a candidate, not a measurement |

> **Agreement between two estimates is not a measurement.** Every `avg_oz_per_each` in column 3 that is not one of Juan's five ruled values is a seed-10 estimate. NULL is the honest value (the 0161 LOCK-1 doctrine: *a sentinel would be a SILENT-WRONG-NUMBER trap*), and the Phase-4 re-point script refuses a count-denominated line whose product has no `unit_oz` rather than resolving it through whichever member happens to be primary that day — which is exactly the refusal seed 18 made.
> Genoa (0.4) is in `OPERATIONAL_SLICE_OZ` and is deliberately **absent** here: Genoa is a single-vendor SKU, so it is an implicit singleton and needs no product row. Its weight already lives where it belongs, on the SKU.
> **ICEBERG is now the sharpest NULL in the table.** After the merge ruling its three members denominate differently — PFG/Iceberg is a 640 oz case with a 20 oz/head estimate, the Sysco row is a 15 × 15 oz box, the Baldor row has no pack at all. "One unit of ICEBERG" therefore has no honest number yet, and that is exactly the condition `unit_oz` exists to make visible rather than paper over. It is the first row the Phase-6 weight board should rank.

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
Iceberg
  would CREATE products row
  would attach 3 members
  would set primary = PFG
Turkey
  would CREATE products row
  would attach 2 members
  would set primary = Boar's Head  (confirmed default)
Roast Beef
  would CREATE products row
  would attach 2 members
  would set primary = Boar's Head  (confirmed default)
Provolone
  would CREATE products row
  would attach 2 members
  would set primary = Boar's Head  (confirmed default)
  would set unit_oz = 0.7 (OPERATIONAL)
Capicola
  would CREATE products row
  would attach 2 members
  would set primary = Boar's Head  (confirmed default)
  would set unit_oz = 0.4 (OPERATIONAL)
Pepperoni
  would CREATE products row
  would attach 2 members
  would set primary = Boar's Head  (confirmed default)
  would set unit_oz = 0.2 (OPERATIONAL)
Banana Peppers
  would CREATE products row
  would attach 2 members
  would set primary = Boar's Head  (confirmed default)
Hot Peppers
  would CREATE products row
  would attach 2 members
  would set primary = Boar's Head  (confirmed default)
Sweet Peppers
  would CREATE products row
  would attach 2 members
  would set primary = Boar's Head  (confirmed default)
```

## 8 — Summary

| would write | count |
|---|---:|
| `products` rows | 11 |
| member attachments (`vendor_items.product_id`) | 23 |
| `product_primaries` rows | 11  *(2 named outright · 8 confirmed defaults · 1 inferred)* |
| `products.unit_oz` fills | 4 |
| products left with NO primary row | 0 |
| rows touching `active` / par / pins / prices | **0** |

**Every one of the 11 products carries a designated primary.** Gate S1's adjudication is complete: 2 named outright by Juan, 8 confirmed at the default this seed proposed, and 1 still carrying an INFERENCE flag (Fresh Mozzarella — Juan named the shape, never the side, and the flag stays until he does).

> **Why the merge did not RAISE these counts.** The previous revision planned 12 products / 23 attachments / 3 primaries. Folding the Lettuce twins into ICEBERG **moves** two attachments rather than adding them — `vendor_items.product_id` is a single FK, so a SKU belongs to exactly one product — and it removes the LETTUCE product along with the primary row it would have carried. Net: one product fewer, the same 23 attachments, and 8 more primaries from the confirmed defaults. A merge can only ever reduce the product count.


### To proceed

```
# Gate S1's adjudication is DONE. The lead runs this and pastes the output into the PR:
npx tsx --conditions=react-server --env-file=.env.local scripts/seed/24-product-identity.ts --execute
```

Every write is guarded on the live row still reading the state the plan was built against — `.is("product_id", null)` on an attach, `.is("unit_oz", null)` on a weight, an existing-row check before a primary — so a second run reports "already" on everything and writes nothing.

Seed 24 done (dry run).
**NOTHING WAS WRITTEN.**
