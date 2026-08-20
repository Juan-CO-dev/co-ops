# Twin adjudication — DRY RUN

> **STATUS: EXECUTED 2026-08-20 16:11 UTC.** This page is the pre-write plan, kept as the
> record of what was proposed. The `--execute` run then landed exactly it — 2 activations
> + 1 price row, 2 pin re-points refused, 1 price refused — and the live end-state is
> reproduced under [After the execute run](#after-the-execute-run) at the foot of this
> page. Prod writes for this scope were Juan-approved; nothing outside it was touched.

Output of `scripts/seed/18-twin-adjudication.ts` in its default (dry-run) mode, against
live prod (`bgcvurheqzylyfehqgzh`) on **2026-08-20**. The script writes only under an
explicit `--execute` flag.

**Juan's decision (2026-08-20):** for Ham and Fresh Mozzarella, **both twins go ACTIVE** —
one primary, one backup. The primary holds the par, the recipe pins and the price; the
backup is active so it is orderable on demand but carries **no par**, so the par-pass
walker cannot suggest one product to two vendors before the P2 product-identity node
exists above SKUs.

**PFG is primary in both pairs — and for Fresh Mozzarella that is an INFERENCE.** Juan
said "both — one primary, one backup" without naming which. Ham's answer is explicit (the
Angel row behind the $2,164.94 spend is a PFG product). Mozzarella's primary was inferred
from the same evidence shape (`CHEESE MOZZ 1OZ SLCD LOG 32 CT` [ROMA] is a PFG row,
$1,365.90/yr) and from ham's explicit answer. **It is veto-able.** Flipping to
Baldor-primary is only par + pin placement: swap `primary` and `backup` in the
`MOZZARELLA` entry of `PAIRS` and re-run. Nothing else in the script encodes the choice.

---

## What this run found that the brief did not expect

The brief assumed the pinned recipe lines are denominated in **ounces**. They are not.

Live, both pins read `quantity = 1, unit = "unit", portioned = true`, and `unit` is a
**count** measure in `measure_units` (`to_base_factor` 1). So `ozForRecipeInput` takes
neither the chain path nor the legacy pack-label path — it falls through to step 3, the
measure registry, where a count dimension resolves through **the SKU's own
`avg_oz_per_each`** (`lib/recipe-math.ts:128-167`).

| pinned line | on the Baldor twin | on the PFG twin |
|---|---:|---:|
| `Ham (portioned)` · 1 unit | **1.2 oz** (`avg_oz_per_each = 1.2`) | **null** (`avg_oz_per_each = NULL`) |
| `Fresh Mozzarella (portioned)` · 1 unit | **1 oz** (`avg_oz_per_each = 1`) | **null** (`avg_oz_per_each = NULL`) |

Re-pointing those pins would not shift a number — it would **delete** one. Every recipe
consuming ham or fresh mozzarella would fall out of costing *and* out of depletion,
silently, because the engine returns `null` rather than guessing. That is the brief's own
stop condition ("if the line's semantics depend on per-SKU `avg_oz_per_each` … that
CHANGES the line's oz meaning, STOP that pair and report"), so **the pin move refuses
itself on both pairs** and the pins stay on the Baldor twins.

The refusal is not a script limitation. It is **P2 (product identity) surfacing inside the
P1 fix**: the two twins do not agree on what one "unit" of the product weighs, and until
something above the SKU level owns that fact, the pin cannot follow the par. The unblock
is one of:

1. give the PFG twins the same `avg_oz_per_each` (1.2 / 1) — a SKU *weight* edit, a
   separate decision, and note that both figures are self-described **estimates** from
   `scripts/seed/10-fill-sku-weights.ts`, not weighings; or
2. build the P2 product-identity node and resolve the pin there.

Either way, re-running this script afterwards passes the gate and moves the pins with no
code change. The gate is a live computation through the real production function, not a
hardcoded refusal.

**Activation, par placement and the price fill are unaffected by that refusal** — they are
what makes the pairs orderable, which is the P1 headline.

---

## What the execute run will do

| step | Ham | Fresh Mozzarella |
|---|---|---|
| activate PFG twin | **write** (`active` false → true) | **write** (`active` false → true) |
| Baldor twin | stays active — no write | stays active — no write |
| par | PFG keeps `weekday_par = 3.00`; Baldor asserted NULL, left NULL | PFG keeps `weekday_par = 12.00`; Baldor asserted NULL, left NULL |
| location overlay | none on either twin (verified) | none on either twin (verified) |
| recipe pin | **REFUSED** (see above) — stays on Baldor | **REFUSED** — stays on Baldor |
| price | **write** $2.77 on the PFG twin | **REFUSED** — no defensible divisor |

### Ham price — re-attribution, not recomputation

Seed 17 wrote Ham $2.77 to the **Baldor** twin because that was the only ACTIVE SKU named
"Ham" at the time, while the Angel row it came from (`HAM 35% WATER FC 4X6 TFF` [ROMA]
1/13 LB) is a **PFG** product. The crossed attribution was recorded in that row's
`source_note`. `vendor_price_history` is append-only, so **that row is not touched**.

This run derives the divisor from the **PFG twin's own live pack content**, not from the
figure the earlier row used:

```
Angel case $36.06 = 208 oz
PFG twin pack content (live) = 16 oz   →  divisor 208/16 = 13
unit_price = $2.77   (exact 2.773846153846154, rounded to cents)
```

The PFG pack happens to be the same 16 oz Baldor's is, so the number is unchanged and the
new row corrects the **vendor attribution** rather than the arithmetic. Had PFG's pack
differed, the price would have recomputed automatically. This matters beyond tidiness: the
PFG twin is the one that will carry the PO, and `loadLatestPriceCentsBySku`
(`lib/purchase-orders.ts:612`) reads price per SKU — without this row the PO line would
have been unpriced.

### Fresh Mozzarella price — refused

Angel's row is `CHEESE MOZZ 1OZ SLCD LOG 32 CT` [ROMA] PFG, `6/2 LB` = **192 oz** at
**$47.10** (the CSV's own `est_price_per_lb_usd` is 3.925; the insights doc §6.3's $3.69/lb
does not reproduce from the export — the CSV wins).

Our PFG twin's pack is `72 count` with `avg_oz_per_each = NULL`, so **its content in ounces
is unresolvable** — there is no denominator. And even granting the Baldor twin's 1 oz/each
reading (72 oz), `192 / 72 = 2.67` is not a whole pack relation. That is precisely why the
row is absent from the reconciliation report's §D.2 pack-relation tables and why seed 17
classed it "not a candidate". Inventing a divisor here is the `PICKLES CHIPS $35.95/lb`
failure (report §C.3). **It stays unpriced, and says so.**

Same root cause worth naming: because the PFG mozzarella twin's pack content is
unresolvable, `perOrderUnitOz` (`lib/ordering.ts:192-205`) also returns null for it, so the
walker will list the SKU and accept a manual quantity but will show **no advisory on-hand
and no Suggest chip** until that pack is resolved. Orderable, not yet advisable.

---

## Lettuce and the rest — still pending

Juan adjudicated Ham and Fresh Mozzarella **only**. Lettuce is a different shape
(Sysco active with no par, Baldor inactive, **zero** recipe pins either side): nothing is
unorderable and nothing is mis-costed today, and it has not been decided. **No writes.**
The audit's other multi-vendor products are likewise untouched — 11 products carry SKUs
from 2+ vendors, and this adjudication covers 2 of them.

---

## Verbatim dry-run output

```
══ DRY RUN (default) — no writes. Pass --execute to write. ══

DECISION: Juan 2026-08-20: both twins ACTIVE — PFG primary (par + pins + price), Baldor backup (active, NO par) so the par-pass walker cannot double-suggest one product to two vendors before the P2 product-identity node exists.
SOURCES:  docs/audits/2026-08-20-multivendor-semantics-audit.md P1 · docs/seed/source/angel-reconciliation-report.md J1

══════════════════════════════════════════════════════════════════════════════
PAIR: Ham
══════════════════════════════════════════════════════════════════════════════
BEFORE
  PRIMARY  PFG/Ham [804cb32d-ea68-4467-8479-b82f34a143a0] active=false weekday_par=3 weekend_par=NULL pack=Each (no case) 1×16oz avg_oz_per_each=NULL content=16 oz pins=0 prices=0
  BACKUP   Baldor/Ham [15944b2d-881b-419e-bcdb-8d8c5412de5a] active=true weekday_par=NULL weekend_par=NULL pack=case 1×16oz avg_oz_per_each=1.2 content=16 oz pins=1 prices=1

[1] ACTIVATE PRIMARY
  would set active=true on PFG/Ham [804cb32d-ea68-4467-8479-b82f34a143a0]
  = Baldor/Ham stays ACTIVE as the backup — no write.

[2] PAR PLACEMENT (assert-only — no par is created, moved or cleared)
  ✓ PRIMARY holds the par: weekday=3 weekend=NULL (kept as-is)
  ✓ BACKUP pars are NULL (weekday + weekend) — left NULL. The walker cannot double-suggest.
  ✓ no location_sku_settings overlay on either twin — global values are the resolved values.

[3] RECIPE PINS — move BACKUP → PRIMARY, gated on oz-meaning preservation
  · Ham (portioned) · 1 unit (portioned)
      on BACKUP  Baldor: 1.2 oz
      on PRIMARY PFG: UNRESOLVABLE (null)
      ✗ REFUSING to re-point: the line resolves to NULL on the PRIMARY. unit "unit" is a COUNT measure, so ozForRecipeInput falls to the measure registry and reads the SKU's own avg_oz_per_each — Baldor has 1.2, PFG has NULL.
        Moving it would not shift a number, it would DELETE one — every recipe consuming this product would fall out of costing and depletion silently.
        UNBLOCK: give PFG/Ham the same avg_oz_per_each as Baldor/Ham, or resolve it properly at the P2 product-identity layer. Then re-run — this gate passes and the pin moves.

[4] PRICE ON PRIMARY
  Angel row: HAM 35% WATER FC 4X6 TFF [ROMA] 1/13 LB — case $36.06 = 208 oz
  PRIMARY pack content (live): 16 oz  →  divisor 208/16 = 13
  unit_price = $2.77 (exact 2.773846153846154, rounded to cents)
  = pack matches the 16 oz basis the earlier row used, so the figure is unchanged; this row corrects the VENDOR ATTRIBUTION, not the arithmetic.
  would append vendor_price_history row on PFG/Ham

AFTER (read back from the destination)
  PRIMARY  PFG/Ham [804cb32d-ea68-4467-8479-b82f34a143a0] active=false weekday_par=3 weekend_par=NULL pack=Each (no case) 1×16oz avg_oz_per_each=NULL content=16 oz pins=0 prices=0
  BACKUP   Baldor/Ham [15944b2d-881b-419e-bcdb-8d8c5412de5a] active=true weekday_par=NULL weekend_par=NULL pack=case 1×16oz avg_oz_per_each=1.2 content=16 oz pins=1 prices=1
  ORDERABLE: NO — the walker needs active AND a resolved par on the SAME row (lib/ordering.ts:417-486). PFG active=false par=3/NULL; Baldor active=true par=NULL/NULL (backup, no par → no second chip).

══════════════════════════════════════════════════════════════════════════════
PAIR: Fresh Mozzarella   ⚠ PRIMARY IS AN INFERENCE (see header)
══════════════════════════════════════════════════════════════════════════════
BEFORE
  PRIMARY  PFG/Fresh Mozzarella [27066f2a-8e5c-4c60-8a0f-a62980241998] active=false weekday_par=12 weekend_par=NULL pack=Case 1×72count avg_oz_per_each=NULL content=UNRESOLVABLE (null) pins=0 prices=0
  BACKUP   Baldor/Fresh Mozzarella [c35dfb4f-492a-43e9-8551-3a0558b695f7] active=true weekday_par=NULL weekend_par=NULL pack=case 72×1each avg_oz_per_each=1 content=72 oz pins=1 prices=0

[1] ACTIVATE PRIMARY
  would set active=true on PFG/Fresh Mozzarella [27066f2a-8e5c-4c60-8a0f-a62980241998]
  = Baldor/Fresh Mozzarella stays ACTIVE as the backup — no write.

[2] PAR PLACEMENT (assert-only — no par is created, moved or cleared)
  ✓ PRIMARY holds the par: weekday=12 weekend=NULL (kept as-is)
  ✓ BACKUP pars are NULL (weekday + weekend) — left NULL. The walker cannot double-suggest.
  ✓ no location_sku_settings overlay on either twin — global values are the resolved values.

[3] RECIPE PINS — move BACKUP → PRIMARY, gated on oz-meaning preservation
  · Fresh Mozzarella (portioned) · 1 unit (portioned)
      on BACKUP  Baldor: 1 oz
      on PRIMARY PFG: UNRESOLVABLE (null)
      ✗ REFUSING to re-point: the line resolves to NULL on the PRIMARY. unit "unit" is a COUNT measure, so ozForRecipeInput falls to the measure registry and reads the SKU's own avg_oz_per_each — Baldor has 1, PFG has NULL.
        Moving it would not shift a number, it would DELETE one — every recipe consuming this product would fall out of costing and depletion silently.
        UNBLOCK: give PFG/Fresh Mozzarella the same avg_oz_per_each as Baldor/Fresh Mozzarella, or resolve it properly at the P2 product-identity layer. Then re-run — this gate passes and the pin moves.

[4] PRICE ON PRIMARY
  ✗ REFUSING to price. Angel `CHEESE MOZZ 1OZ SLCD LOG 32 CT` [ROMA] 6/2 LB = 192 oz @ $47.10, but the PFG twin's pack is `72 count` with avg_oz_per_each NULL — its content in oz is UNRESOLVABLE, so there is no denominator to divide by. Even granting the Baldor twin's 1 oz/each reading (72 oz), 192/72 = 2.67 is not a whole pack relation. Absent from the reconciliation report's §D.2 tables for exactly this reason. Inventing a divisor is the PICKLES CHIPS $35.95/lb failure (report §C.3).

AFTER (read back from the destination)
  PRIMARY  PFG/Fresh Mozzarella [27066f2a-8e5c-4c60-8a0f-a62980241998] active=false weekday_par=12 weekend_par=NULL pack=Case 1×72count avg_oz_per_each=NULL content=UNRESOLVABLE (null) pins=0 prices=0
  BACKUP   Baldor/Fresh Mozzarella [c35dfb4f-492a-43e9-8551-3a0558b695f7] active=true weekday_par=NULL weekend_par=NULL pack=case 72×1each avg_oz_per_each=1 content=72 oz pins=1 prices=0
  ORDERABLE: NO — the walker needs active AND a resolved par on the SAME row (lib/ordering.ts:417-486). PFG active=false par=12/NULL; Baldor active=true par=NULL/NULL (backup, no par → no second chip).

══════════════════════════════════════════════════════════════════════════════
STILL PENDING — reported, NOT written
══════════════════════════════════════════════════════════════════════════════
  Sysco/Lettuce [7c161441-848f-4290-bc68-a8088e112961] active=true weekday_par=NULL weekend_par=NULL pins=0
  Baldor/Lettuce [8cbebce5-b2e5-4da4-8a17-17a2d756ec12] active=false weekday_par=NULL weekend_par=NULL pins=0
  → Juan adjudicated Ham and Fresh Mozzarella ONLY. Lettuce (Sysco active/no-par + Baldor
    inactive, zero recipe pins either side) is a DIFFERENT shape — nothing is unorderable
    and nothing is mis-costed today — and it has not been decided. NO WRITES.
    The other 8 multi-vendor products from the audit are likewise untouched.

══════════════════════════════════════════════════════════════════════════════
SUMMARY
══════════════════════════════════════════════════════════════════════════════
  Ham                activate=PLANNED  pins moved=0 refused=1  price=PLANNED
  Fresh Mozzarella   activate=PLANNED  pins moved=0 refused=1  price=REFUSED

  2 pin re-point(s) REFUSED — the pins stay on the backup twin.
  This is the P2 product-identity gap surfacing inside the P1 fix: the two twins do not
  agree on what one 'unit' of the product weighs (avg_oz_per_each), so the pin cannot follow
  the par without changing what every consuming recipe costs and depletes. Activation, par
  placement and the price fill are unaffected — the pairs are ORDERABLE regardless.

Seed 18 done (dry run).
NOTHING WAS WRITTEN.
```

---

## To proceed

```
npx tsx --conditions=react-server --env-file=.env.local scripts/seed/18-twin-adjudication.ts --execute
```

Every write is guarded on the live row still reading the state the plan was built against
(`.eq("active", false)` on the activation, `.eq("component_sku_id", <backup>)` on a pin
move, an existing-`(sku, source, effective_date)` check before the price append), so a
second run reports "already" on everything and writes nothing.

---

## After the execute run

Ran 2026-08-20 16:11 UTC. Live re-query (independent of the script's own read-back):

```sql
select vi.name, v.name as vendor, vi.active, vi.weekday_par, vi.weekend_par,
       (select count(*) from recipe_inputs ri where ri.component_sku_id=vi.id) as pins,
       (select count(*) from vendor_price_history h where h.vendor_item_id=vi.id) as prices,
       (vi.active and (vi.weekday_par is not null or vi.weekend_par is not null)) as walker_eligible
from vendor_items vi left join vendors v on v.id=vi.vendor_id
where lower(vi.name) in ('ham','fresh mozzarella','lettuce') order by vi.name, vendor;
```

| SKU | vendor | active | weekday_par | weekend_par | pins | prices | walker-eligible |
|---|---|---|---:|---:|---:|---:|---|
| Fresh Mozzarella | Baldor *(backup)* | **true** | NULL | NULL | 1 | 0 | false |
| Fresh Mozzarella | PFG *(primary)* | **true** | **12.00** | NULL | 0 | 0 | **TRUE** |
| Ham | Baldor *(backup)* | **true** | NULL | NULL | 1 | 1 | false |
| Ham | PFG *(primary)* | **true** | **3.00** | NULL | 0 | **1** | **TRUE** |
| Lettuce | Baldor | false | NULL | NULL | 0 | 0 | false *(untouched)* |
| Lettuce | Sysco | true | NULL | NULL | 0 | 0 | false *(untouched)* |

**Both pairs are now ORDERABLE** — exactly one twin per pair satisfies the walker's
active-AND-par-on-the-same-row gate, so there is one Suggest chip per product, not two.
Ham's $2,164.94/yr of spend is reachable by the par pass for the first time.

Price history for Ham (append-only — the earlier row is intact, `recorded_at` unchanged):

| row | SKU | unit_price | effective | recorded_at | note |
|---|---|---:|---|---|---|
| `5232dc3c…` | Baldor/Ham | $2.77 | 2026-08-14 | 15:52:48 | seed 17's row — **untouched** |
| `06c2b3da…` | PFG/Ham | $2.77 | 2026-08-14 | 16:11:02 | new; `source_note` names the arithmetic + the attribution it corrects |

Audit rows written — 3, all with `metadata.phase = 'multivendor_p1_twin_adjudication'`,
`metadata.decision` carrying Juan's words verbatim and `metadata.primary_is_inferred`
recording where the primary was inferred:

| action | resource | destructive | note |
|---|---|---|---|
| `vendor_item.activate` | `vendor_items` / PFG Ham | true | `primary_is_inferred: false` |
| `vendor_item.price_recorded` | `vendor_price_history` / PFG Ham | false | divisor 13, our_pack_oz 16 |
| `vendor_item.activate` | `vendor_items` / PFG Fresh Mozzarella | true | **`primary_is_inferred: true`** |

Re-running `--execute` a second time produced **zero** further writes and **zero** further
audit rows (`activate=already-active`, `price=already-present`) — idempotency verified
against prod, not asserted.

## Known follow-on, not fixed here

`skuNameCollisions` (`lib/admin/catalog-shared.ts:425`) compares SKU names without a vendor
comparison, so once these pairs are both-active it will nag on twins that are now
doctrine-correct. That is audit gap **P7** and is being handled separately.
