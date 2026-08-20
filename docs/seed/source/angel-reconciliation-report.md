# Angel-catalog RECONCILIATION REPORT

**Purpose:** turn Angel Spend's 153-row catalog export into concrete, decision-ready actions against the CO-OPS inventory spine.
**Status:** ANALYSIS ONLY — **no writes were performed**, none are authorized by this document. This feeds a Juan sitting.
**Prepared:** 2026-08-20. Every schema/data claim below comes from a live read of prod (`bgcvurheqzylyfehqgzh`) on that date, not from docs.

## Sources

| # | Source | What it is | Trust |
|---|---|---|---|
| 1 | `docs/seed/source/angel-product-catalog.csv` | 153 rows, Angel purchase catalog + spend | SOURCE WITH DOCUMENTED DEFECTS |
| 2 | `docs/angel-spend-insights.md` | §6.3 hand-built name map, §3.3 pickles bug, §6.4 missing list | Hand-built, verified against #1 here |
| 3 | Live prod: `vendors`, `vendor_items`, `vendor_price_history`, `sku_pack_levels`, `vendor_delivery_items`, `po_lines` | The spine | GROUND TRUTH |
| 4 | `docs/seed/source/inventory-costing.csv` | 2024 manual costing ancestor | Historical, unversioned, internally inconsistent in places |
| 5 | `AGENTS.md` | Repo law (ground-truth verification, tenant vocabulary) | Law |

### Query shapes used (all read-only SELECTs)

```sql
-- schema pre-flight (ran BEFORE asserting any column)
select table_name, ordinal_position, column_name, data_type, is_nullable, column_default
from information_schema.columns where table_schema='public' and table_name in (...);

-- price-column census across the whole schema
select column_name, table_name from information_schema.columns
where table_schema='public' and (column_name ilike '%price%' or column_name ilike '%cost%' or column_name ilike '%_usd%');

-- vendor roster + per-vendor SKU counts
select v.id, v.name, v.active, (select count(*) from vendor_items vi where vi.vendor_id=v.id) ... from vendors v;

-- coverage census (single row)
select (select count(*) from vendor_items) , (select count(*) from vendor_price_history), ... ;

-- full registry dump (string_agg to stay inside result limits)
select string_agg(line, E'\n' order by line) from ( select v.name||' | '||vi.name||' | '||... ) s;

-- pack chains for the high-spend SKUs
select vi.name, string_agg(spl.label||'='||spl.contains_qty||...) from vendor_items vi
join sku_pack_levels spl on spl.sku_id=vi.id and spl.active group by ...;

-- every price that exists anywhere (3-way union)
select 'vph',... from vendor_price_history union all select 'vdi',... union all select 'po_line',...;
```

---

## 0. THE HEADLINE FINDINGS (read these four first)

**F1 — `vendor_items` has NO price column. The entire price spine holds ONE row.**
Prices live only in `vendor_price_history` (append-only: `vendor_item_id, unit_price, effective_date, recorded_at, recorded_by`) and denormalized on `vendor_delivery_items.unit_price`. Live census:

| table | rows | priced |
|---|---|---|
| `vendor_price_history` | **1** | 1 (Banana Peppers, $20.00, effective 2026-07-01) |
| `vendor_delivery_items` | 8 | **1** of 8 has a `unit_price` |
| `po_lines` | 15 | **0** of 15 have `price_cents_at_order` |
| `vendor_items` | 182 (161 active) | n/a — no price column exists |

So **price coverage is 1 SKU out of 182 (0.5%)**. Section C's "AGREES / CONFLICTS" buckets are therefore almost vacuous against *our* stored prices — there is nothing to conflict with. Angel is not correcting our prices; it is the first real price data the system would ever hold.

**F2 — Delmar Provisions is NOT a registered vendor, and it is 37.4% of spend.**
`vendors` holds 17 rows; there is no Delmar. Angel's Delmar rows are the Boar's Head lane: two Delmar rows in the export literally carry `brand = Boar's Head` (`BANANA PEPPER RINGS`, `CEL-RAY DR. BROWNS`), and the product set (OvenGold turkey, London Broil, mild provolone, Genoa, cappy, Dr. Brown's sodas, pickles) is exactly our `Boar's Head` vendor's 23 SKUs. **Angel models the DISTRIBUTOR; we model the BRAND.** This is a modeling decision, not a data error — see Action J2.

**F3 — Angel's case price cannot be dropped into `unit_price`. Our pack ≠ Angel's case for most SKUs.**
`vendor_price_history.unit_price` is the price of *one of OUR packs* (`lib/admin/cost.ts:37` — "Current pack price per SKU"; consumed by `skuCostPerOz(packPrice, contentOz)` in `lib/recipe-math.ts:173`). Of the matched rows where both sides resolve to ounces:

| relation | rows | meaning |
|---|---|---|
| **PACK-AGREES** | 12 | Angel case oz == our pack oz → case price usable **as-is** |
| **CASE-MULTIPLE** | 18 | our pack is ONE unit inside Angel's case → price must be **divided** (÷2 … ÷36) |
| **CONFLICT** | 8 | neither equal nor a clean multiple → needs adjudication |
| no weight either side | 74 | count/volume parse or `NO_PACK_SIZE` → no oz comparison possible |

Worked example: `HAM 35% WATER FC 4X6 TFF` case = $36.06 for `1/13 LB` (208 oz). Our `Baldor/Ham` pack chain is `case = 16 oz`. Writing $36.06 as that SKU's `unit_price` would overstate ham cost **13×**. The correct fill is $36.06 ÷ 13 = **$2.77/lb** — which independently matches `inventory-costing.csv`'s Ham row ($2.72/16 oz, +2%). **The division is the whole job.** A naive bulk import is the single most dangerous outcome of this exercise.

**F4 — Angel's parse cannot pay down Juan's weigh-checklist. It confirms 2 of 8 HIGH-priority items and 0 of ~24 LOW-priority ones.**
Per-each weights need a count↔weight bridge Angel structurally lacks (its own doc §3.2 says so). Detail in §D.

---

## A. Vendor mapping

### A.1 Angel's vendors vs ours

Angel's 153 rows carry exactly three vendor values. Aggregates computed from the CSV (`total_spend_usd` summed; total **$55,144.01**):

| Angel vendor | rows | spend | share | `NO_PACK_SIZE` | In our `vendors`? |
|---|---:|---:|---:|---:|---|
| **PFG** | 78 | $27,793.76 | 50.4% | 0 | **YES** — 82 SKUs (80 active). Actionable lane. |
| **Delmar Provisions** | 27 | $20,604.35 | 37.4% | **27 / 27** | **NO** — absent from `vendors`. See A.2. |
| **US Foods** | 48 | $6,745.90 | 12.2% | 0 | YES, but **vestigial**: 1 SKU (`Oven Cleaner`). See A.3. |

Our `vendors` table (17 rows, all `active = true`, all `transmission_tier = 'manual'`), with live SKU counts:

| vendor | SKUs | active | note |
|---|---:|---:|---|
| PFG | 82 | 80 | the primary distributor lane |
| Baldor | 25 | **6** | **legacy lane** — 19 deactivated; see A.4 |
| Boar's Head | 23 | 23 | = Angel's "Delmar Provisions" product set |
| Trimark | 17 | 17 | chemicals/smallwares, not in Angel |
| Webstaurant | 10 | 10 | smallwares, not in Angel |
| Amazon | 8 | 8 | sundries, not in Angel |
| US Foods | 1 | 1 | oven cleaner only |
| Sysco, Continental Tape, Penny Candy, Sarah, Vistaprint | 1 each | 1 | long tail |
| Cardinal Bakery, Costco, Country Snacks, Cristian, Saval | **0** | 0 | **registered but carry zero SKUs** |
| *(no vendor)* | 11 | 11 | `vendor_id IS NULL` — includes **Sub Roll**, Mortadella, Worcestershire |

### A.2 Delmar Provisions — the broker-direct lane (DECISION REQUIRED)

Delmar is the highest-value and lowest-quality slice of the export:

- **All 27 rows are flagged `NO_PACK_SIZE|BROKER_DIRECT`.** Not one carries a pack string, units-per-case, case weight, or a derived `$/lb`. Every Delmar row gives us **a case price and nothing else**.
- It carries the top-spend item in the whole dataset (`OVENGOLD TURKEY`, $7,913.31 = 14.4% of all spend) and 5 of the top 11.
- Spend at risk of mis-costing: **$20,237.05** across 23 matched Delmar rows.

Evidence that Delmar == our Boar's Head lane:
1. Two Delmar rows carry `brand = Boar's Head` outright (`BANANA PEPPER RINGS`, `CEL-RAY DR. BROWNS`).
2. `inventory-costing.csv` uses vendor code `BH` for exactly this product set (capicola, genoa, pepperoni, roast beef, turkey, provolone, bacon, pickles, hot/sweet peppers, Coke, Dr. Brown's).
3. Our `Boar's Head` vendor's 23 SKUs map 1:1 onto 23 of the 27 Delmar rows (the 4 leftovers are the three "Just" cans and Deer Park).

**The decision for Juan:** does Delmar get registered as its own vendor (distributor model, matching how ordering/receiving actually happen), or does Boar's Head stay the vendor of record (brand model, matching how the kitchen talks)? This is a *tenant vocabulary* question in the AGENTS.md sense — it decides what a PO says and who the receiving screen names. **Recommendation: register Delmar Provisions as a vendor and re-point the 23 Boar's Head SKUs to it, keeping "Boar's Head" as brand.** Rationale: POs and invoices go to Delmar; `vendors.name` drives ordering/transmission, and it should name whoever actually receives the order. But this is a data-model change touching 23 SKUs and it is Juan's call, not ours.

### A.3 US Foods — historical, not actionable

Our `US Foods` vendor carries exactly **1** SKU (`Oven Cleaner`). Meanwhile `inventory-costing.csv` lists "US foods" as the vendor for Celery, Iceberg, Lemon Juice, Radish, Tomatoes, Cheddar, Mozzarella, Ham, cooked Eggs, Duke's Mayo, Olive Oil, Pasta, Crushed Tomatoes — **all of which now sit under PFG in the live registry.** We already migrated US Foods → PFG. Angel's 48 US Foods rows are therefore **old order guides**: a second, redundant naming dialect for products we now buy from PFG.

**Disposition: treat US Foods rows as HISTORICAL — useful only as a price cross-check, never as the price of record.** They are the main source of the near-duplicate clusters in §B.3. One exception: `Cleaner, Oven & Grill K44` genuinely maps to our one live US Foods SKU.

### A.4 Baldor — the legacy lane

25 SKUs, only **6 active**. The 19 deactivated rows include nine house-made preps that were mistakenly registered as purchasable SKUs (Garlic Aioli, Caesar Dressing, Mustard Aioli, Cholula Mayo, Honey Chili Aioli, Salsa Verde, Oil/Balsamic Mix, Lemon/Oil Mix, Caramelized Onions) — that cleanup already happened and needs no action. Of the 6 still active, three (`Onions`, `Salami`, `White Cheddar`) look like duplicates of live PFG/Boar's Head SKUs. Flagged in §B.4, not resolved here.

---

## B. SKU matching — all 153 rows dispositioned

Method: exact/normalized name → §6.3's hand map → fuzzy leftovers → manual adjudication against the live 182-row registry. **All 153 rows are accounted for; zero unmapped.**

| Disposition | rows | spend | share of spend |
|---|---:|---:|---:|
| **MATCHED** — we carry it | **109** | $45,893.61 | 83.2% |
| **NON-FOOD / IGNORE** — packaging, disposables, chemicals | **33** | $5,135.99 | 9.3% |
| **AMBIGUOUS** — needs Juan | **3** | $3,686.92 | 6.7% |
| **NEW-SKU CANDIDATE** — we don't carry it | **8** | $427.49 | 0.8% |
| | **153** | **$55,144.01** | 100% |

The 109 matched rows collapse onto **76 distinct SKUs** in our registry (because of Angel's duplicate clusters — §B.3).

### B.1 NEW-SKU CANDIDATES (8 rows, $427.49)

All are low-spend; none is urgent. Ranked:

| spend | Angel product | vendor | note |
|---:|---|---|---|
| $119.60 | Just Dragon Green Can | Delmar | "Just" brand canned drink — not in registry |
| $119.60 | Just Lemon Tea Can | Delmar | ditto |
| $119.60 | Just Raspberry Tea Can | Delmar | ditto |
| $24.37 | Flour, White Bread Unbleached Special Spring (King Arthur) | US Foods | in `inventory-costing.csv` ($24.05/400 oz) but **not in the registry** |
| $17.88 | MINT FRSH | PFG | fresh mint — genuinely new |
| $11.41 | STRAWBERRIES FRSH | PFG | genuinely new |
| $8.50 | Deer Park Loose | Delmar | in `inventory-costing.csv`, not in registry |
| $6.53 | VINEGAR APPLE CIDER 5% ACIDITY | PFG | in `inventory-costing.csv`, not in registry |

**Reading:** the three "Just" cans are a real beverage line we buy and don't track ($358.80 combined). Flour, apple-cider vinegar and Deer Park are registry *gaps* our own 2024 costing sheet already knew about — a small, clean backfill.

### B.2 AMBIGUOUS (3 rows, $3,686.92 — disproportionately expensive)

| spend | Angel product | The ambiguity |
|---:|---|---|
| $2,164.94 | `HAM 35% WATER FC 4X6 TFF` | We have **two Ham SKUs**: `PFG/Ham` (INACTIVE, `case=16 oz`) and `Baldor/Ham` (ACTIVE, `case=16 oz`, `avg_oz_per_each=1.2`). The Angel row is a PFG product but the live SKU sits under Baldor. Known issue — the weigh-checklist's "Data-quality follow-ups #1" names this exact dup pair. |
| $1,365.90 | `CHEESE MOZZ 1OZ SLCD LOG 32 CT` | Same shape: `Baldor/Fresh Mozzarella` (ACTIVE, `case=72 × 1 each`) vs `PFG/Fresh Mozzarella` (INACTIVE, `72 count`). Also named in the weigh-checklist follow-ups. |
| $156.08 | `CHEESE MOZZ PROV 50/50 SHRED` | A mozzarella/provolone blend. Is this our `PFG/Shredded Mozz`, or a second product we buy alongside it? Angel lists **both** it and `CHEESE MOZZ LMWM SHRED` with separate spend, suggesting two real products. |

The first two are the *same* pre-existing defect the weigh checklist flagged in July: an auto-placeholder SKU (which recipes reference) plus a real twin with pack data. Angel's export puts a price tag on the cost of leaving it unresolved — **$3.53K of annual spend flows through two ambiguous SKU identities.**

### B.3 Angel's near-duplicate clusters (25 clusters, 62 rows → 25 of our SKUs)

Angel has no canonical-item grouping (its own doc §3.10), so the same product appears under multiple feeds. Confirmed from the export:

| our SKU | Angel rows | the rows |
|---|---:|---|
| **PFG/Iceberg** | **4** | LETTUCE ICEBERG LINER · LETTUCE ICEBERG C&T · LETTUCE CELLO ICEBERG CA · *Lettuce, Iceberg Cleaned & Trimmed* (USF) |
| PFG/Ham *(ambiguous)* | 3 | HAM 35% WATER FC 4X6 TFF · *Ham, Cooked Rectangle 4x6 Hwp 39%* · *Ham, Cooked Hwp 35%* |
| PFG/Tomatoes | 3 | TOMATO 5X6 · TOMATO 6X6 · *Tomato, Round 4x5* |
| PFG/Onion (White) | 3 | ONION YLW COLOSSAL BAG · ONION YLW JUMBO · *Onion, Yellow Jumbo 3"+* |
| PFG/Lemon Juice | 3 | JUICE LEMON ALL NAT · JUICE LEMON FZ · *Juice, Lemon Not-From-Concentrate* |
| PFG/Cheddar | 3 | CHEESE CHED SHARP WHI BLOCK TF · CHEESE CHED WHI MED LOAF · *Cheese, Cheddar White Sharp Print* |
| PFG/Basil | 3 | BASIL FRSH (FRSH ADV) · BASIL FRSH (PEAK FRS) · *Basil, Fresh Herb* |
| PFG/Heavy Cream | 3 | CREAM HVY WHIPPING 40% · CREAM HVY 36% · *Cream, Whipping Heavy 40%* |
| PFG/Oregano | 3 | OREGANO LEAVES (1/5 LB) · OREGANO LEAVES (1/24 OZ) · *Spice, Oregano Leaf Dried* |
| PFG/Employee Water | 3 | WATER PURIFIED DRINKING · *Water, Purified Plastic Bottle* · *Water, Spring Plastic Bottle* |
| *(14 more at 2 rows each)* | 2 | Arugula, Lemonade, Shredded Mozz, Tuna, Garlic, Crushed Tomato, Saratoga, Cucumber, Cooked Eggs, Ricotta, Celery, Radish, Balsamic, Beef Base, Raw Eggs, Sour Cream |

**Why this matters for pricing, concretely:** the two `BASIL FRSH` rows are $10.34/lb and $19.55/lb — an 89% spread for the same line item. The two `OREGANO LEAVES` rows are $11.05/lb and $16.27/lb. **Which duplicate you pick changes the derived cost by up to 2×.** Any price fill must name the specific Angel row it came from; "Angel says basil is $X" is not a well-formed statement.

*(Italicized rows above are US Foods = historical. Rule of thumb: **when a cluster contains a PFG row and a US Foods row, take the PFG row** — it is the current lane.)*

### B.4 Duplicate SKUs on OUR side (pre-existing, surfaced again)

Independent of Angel: `Ham` ×2, `Fresh Mozzarella` ×2 (both named in the July weigh-checklist), plus three suspect active Baldor rows (`Onions`, `Salami`, `White Cheddar`) that appear to duplicate live PFG/Boar's Head SKUs. Not caused by Angel; worth a dedup pass before any price import, because **a price written to the wrong twin is invisible** (the twin the recipes reference stays unpriced).

### B.5 NON-FOOD / IGNORE (33 rows, $5,135.99)

Gloves (7 rows across 3 sizes and 2 materials), shopping bags (4), deli containers and lids (7), napkins/towels (5), wax paper/foil (4), plates/bowls/forks (4), can liners, register rolls, oven cleaner. We carry most of these under PFG/Trimark/Webstaurant with `sku_class = 'packaging'`.

**Disposition: EXCLUDE from all costing work.** They carry no `$/lb`, never enter a recipe, and `sku_class='packaging'` already filters them out of the ingredient pickers. Note however that two of them are top-20 spend items (`BAG PAPER KRAFT SHOPPER BISTRO` $963, `Bag, Shopping 10x6.75x12` $801) — real money, just not *food* cost. If anyone ever wants a true COGS number, packaging is $5.1K/yr of it.

---

## C. Price reconciliation (matched + ambiguous rows: 112)

### C.1 The buckets are degenerate, and that is the finding

The brief asks for FILLS / AGREES / CONFLICTS / UNTRUSTWORTHY against *our stored price*. Live reality (F1): **we store one price.** So:

| bucket | rows | spend |
|---|---:|---:|
| **FILLS** (we have no price; Angel supplies one) | **111 of 112** | $49,580.53 |
| **AGREES** (within ~10%) | 0 | — |
| **CONFLICTS** (>10%) | **1** | — |
| **UNTRUSTWORTHY** (never propagate) | 26 *(subset of FILLS)* | $20,477.87 |

The single CONFLICT is instructive: our one stored price is **Banana Peppers $20.00** (`vendor_price_history`, effective 2026-07-01, recorded via a smoke-test delivery). Angel's `BANANA PEPPER RINGS` (Delmar, Boar's Head brand) latest case price is **$8.75**, and `inventory-costing.csv` says Banana Peppers $7.90 / 96 oz (Baldor). Two independent sources cluster near $8; our stored $20.00 is the outlier and is best explained as smoke-test data, not a real invoice. **Treat the one price we have as untrusted.**

### C.2 Trustworthiness of Angel's price data (the real C-section)

Since every matched row is a FILL, the useful classification is *how much can this row be trusted*:

| tier | rows | spend | what Angel gives you |
|---|---:|---:|---|
| **TIER 1 — usable `$/lb`** (weight parse, unflagged) | 61 | $14,833.97 | case price **and** a derived `$/lb` |
| **TIER 2 — case price only** (count/volume parse) | 25 | $14,268.69 | case price; `$/lb` not derivable without a density or count↔weight bridge |
| **TIER 3 — UNTRUSTWORTHY, `NO_PACK_SIZE`** (all Delmar) | 23 | **$20,237.05** | a bare case price with **no pack denominator at all** |
| **TIER 3 — UNTRUSTWORTHY, `HIGH_PPL_REVIEW`** | 3 | $240.82 | a `$/lb` the exporter itself flagged as implausible |

The three `HIGH_PPL_REVIEW` rows, verbatim:

| product | pack | Angel `$/lb` | case |
|---|---|---:|---:|
| CHIVES FRSH | `1/8 OZ` | **$35.76** | $17.88 |
| THYME FRSH | `1/4 OZ` | **$66.16** | $16.54 |
| Spice, Chive Chopped Plastic Shaker | `6/1.12 OZ` | **$23.14** | $9.72 |

These are arithmetically correct but operationally misleading — tiny herb packs genuinely do cost a lot per pound. They are not parse bugs; they are the category-band problem the insights doc §4.5 describes. **Do not propagate them as if they were bulk commodity prices**, and note that `THYME FRSH` at $66.16/lb vs the 2024 sheet's $24.00/lb (+176%) is the largest disagreement in the whole dataset.

### C.3 The pickles bug — corrected

The insights doc §3.3 states `PICKLES CHIPS 1/4` prices at **$35.95/lb**. **The export does not reproduce this.** The CSV row is:

```
PICKLES CHIPS 1/4,,,Delmar Provisions,,,35.95,,-0.0%,826.85,,,,,,,NO_PACK_SIZE|BROKER_DIRECT
```

`est_price_per_lb_usd` is **empty**. $35.95 is the **case price**, and the CSV's parser correctly refused to emit a `$/lb` because there is no pack size. The `$35.95/lb` figure was **Angel's UI** dividing a case price by an assumed ~1 lb.

Two consequences:
1. **The export is more conservative than Angel's own UI** — a point in the export's favor, and it means the doc's §6.2 menu-item numbers (which inflate Crunchy Boi and It's a BOI by ~$1 each) are wrong in a way the CSV is not.
2. **The defect class is real and unfixed**: all 23 matched Delmar rows have this exact shape (case price, no denominator). Any of them could produce a $35.95/lb-style disaster if someone supplies the missing pack size by guessing. **Refuse all Delmar `$/lb` derivations until Juan supplies real pack sizes.**

### C.4 Triangulation: Angel vs the 2024 costing sheet

Where both sources give a `$/lb` for the same product (25 comparable pairs), **9 agree within 10%, 16 conflict.** This is the closest thing we have to a validity check on Angel, and it is a mixed result.

| item | costing $/lb (2024) | Angel $/lb | delta | verdict |
|---|---:|---:|---:|---|
| Ground Beef | $4.90 | $4.92 | +0% | **AGREES** |
| Heavy Cream | $1.85 | $1.86 | +0% | **AGREES** |
| Onion (red) | $1.10 | $1.11 | +1% | **AGREES** |
| Ham | $2.72 | $2.77 | +2% | **AGREES** |
| Shredded Mozz | $3.00 | $2.84 | −5% | **AGREES** |
| Garlic | $3.71 | $3.94 | +6% | **AGREES** |
| Tomatoes | $1.25 | $1.33 | +6% | **AGREES** |
| Sour Cream | $1.75 | $1.62 | −7% | **AGREES** |
| Onion (White) | $0.58 | $0.63 | +8% | **AGREES** |
| Salt | $2.60 | $2.33 | −11% | conflict |
| Tuna | $2.57 | $2.88 | +12% | conflict |
| Arugula | $5.97 | $5.17 | −13% | conflict |
| Honey | $3.08 | $3.55 | +15% | conflict |
| Cheddar | $4.26 | $3.55 | −17% | conflict |
| Panko | $1.45 | $1.09 | −25% | conflict |
| Mustard (Dijon) | $2.74 | $2.06 | −25% | conflict |
| Parsley | $12.05 | $15.20 | +26% | conflict |
| Ground Pork | $3.38 | $2.39 | −29% | conflict |
| Ricotta | $2.51 | $3.41 | +36% | conflict |
| Butter | $4.72 | $2.25 | −52% | conflict *(1-lb retail print vs 36-lb case — different products)* |
| Black Pepper | $20.65 | $8.96 | −57% | conflict *(ground jar vs whole peppercorn bulk — different products)* |
| Chives | $22.00 | $35.76 | +63% | conflict *(`HIGH_PPL_REVIEW`)* |
| Oregano | $8.84 | $16.27 | +84% | conflict *(picked the 24-oz dup; the 5-lb dup gives $11.05 = +25%)* |
| Basil | $10.34 | $19.55 | +89% | conflict *(picked the PEAK FRS dup; the FRSH ADV dup gives **$10.34 = exact match**)* |
| Thyme | $24.00 | $66.16 | +176% | conflict *(`HIGH_PPL_REVIEW`)* |

**How to read this.** The nine agreements are strong — Ground Beef at +0%, Ham at +2%, Heavy Cream at +0% are independent confirmations across a two-year gap and two different data-collection methods. That is real validation.

The conflicts split into three kinds, and only one is alarming:
- **Different product, same name** (Butter, Black Pepper): not disagreements at all. The 2024 sheet priced a 1-lb retail butter print and a 16-oz ground-pepper jar; Angel priced a 36-lb case and bulk whole peppercorn. Both right.
- **Duplicate-selection artifacts** (Basil, Oregano): the "conflict" vanishes if you pick the other Angel duplicate. Basil's FRSH ADV row is an **exact** $10.34 match. This is §B.3 biting.
- **Genuine two-year price drift** (Panko −25%, Ricotta +36%, Ground Pork −29%, Mustard −25%): the real signal, and the reason to prefer Angel over the 2024 sheet where they disagree.

**Net verdict on Angel as a price source: adequate for the PFG weight-parse lane (Tier 1), unusable for the Delmar lane (Tier 3), and requiring per-SKU duplicate adjudication throughout.**

---

## D. Weight / pack cross-check

### D.1 Where Angel can and cannot see weight

| Angel vendor | matched rows | rows carrying `est_case_weight_lb` |
|---|---:|---:|
| PFG | 59 | 44 (75%) |
| US Foods | 30 | 20 (67%) |
| **Delmar Provisions** | 23 | **0 (0%)** |

**The entire deli lane is weight-blind.** Turkey, roast beef, provolone, genoa, capicola, pepperoni, bacon, prosciutto, pickles, hot/sweet peppers — every item whose per-slice weight Juan actually needs to measure — comes from Delmar and carries no pack size, no case weight, no units-per-case.

### D.2 Pack-unit comparison (the actionable table)

**PACK-AGREES (12) — Angel's case oz equals our pack oz. Case price is directly usable.**

| spend | Angel product | our SKU | oz (both) | Angel case $ |
|---:|---|---|---:|---:|
| $1,181 | BEEF GRND BULK 80/20 | PFG/Ground Beef | 160 | $49.20 |
| $322 | GARLIC WHL PLD DOM | PFG/Garlic | 80 | $19.72 |
| $186 | BASIL FRSH | PFG/Basil | 16 | $10.34 |
| $186 | CREAM HVY WHIPPING 40% TFF | PFG/Heavy Cream | 384 | $46.32 |
| $134 | CREAM HVY 36% TFF | PFG/Heavy Cream | 384 | $44.63 |
| $122 | PARSLEY FRSH FLAT ITAL | PFG/Parsley | 16 | $15.20 |
| $98 | BASIL FRSH *(dup)* | PFG/Basil | 16 | $19.55 |
| $72 | SOUR CREAM REAL | PFG/Sour Cream | 80 | $8.10 |
| $42 | *Cheese, Ricotta Impastata* (USF) | PFG/Ricotta | 160 | $41.57 |
| $36 | HONEY AMBER EXTRA LIGHT | PFG/Honey | 80 | $17.77 |
| $17 | THYME FRSH | PFG/Thyme | 4 | $16.54 |
| $16 | *Basil, Fresh Herb* (USF) | PFG/Basil | 16 | $16.08 |

**CASE-MULTIPLE (18) — our pack is one unit inside Angel's case. Price MUST be divided.**

| spend | Angel product | ours (oz) | Angel case (oz) | divisor | case $ | **→ correct pack price** |
|---:|---|---:|---:|---:|---:|---:|
| $2,165 | HAM 35% WATER FC 4X6 TFF | 16 | 208 | **÷13** | $36.06 | **$2.77** |
| $434 | PORK GRND 80/20 | 80 | 160 | ÷2 | $23.90 | $11.95 |
| $414 | CHEESE MOZZ LMWM SHRED | 80 | 480 | ÷6 | $85.14 | $14.19 |
| $360 | TUNA CHNK LIGHT CHN | 66.6 | 399 | ÷6 | $71.91 | $12.00 |
| $308 | CHEESE CHED SHARP WHI BLOCK | 16 | 160 | ÷10 | $35.46 | $3.55 |
| $251 | SALT KSHR COARSE | 48 | 432 | ÷9 | $62.83 | $6.98 |
| $215 | CHIVES FRSH | 4 | 8 | ÷2 | $17.88 | $8.94 |
| $171 | BUTTER SOLID UNSLTD | 16 | 576 | **÷36** | $81.11 | $2.25 |
| $156 | CHEESE MOZZ PROV 50/50 SHRED | 80 | 480 | ÷6 | $81.71 | $13.62 |
| $136 | CHEESE RICOTTA IMPASTATA WM | 160 | 320 | ÷2 | $68.19 | $34.09 |
| $111 | OREGANO LEAVES | 20 | 80 | ÷4 | $55.27 | $13.82 |
| $103 | CHEESE CHED WHI MED LOAF | 16 | 160 | ÷10 | $51.73 | $5.17 |
| $74 | *Tuna, Light Skipjack* (USF) | 66.6 | 399 | ÷6 | $74.49 | $12.43 |
| $63 | *Tomato, Round 4x5* (USF) | 160 | 320 | ÷2 | $29.98 | $14.99 |
| $48 | *Cheese, Cheddar White Sharp* (USF) | 16 | 160 | ÷10 | $48.12 | $4.81 |
| $33 | ONION PWDR | 16 | 80 | ÷5 | $33.25 | $6.65 |
| $26 | *Garlic, White Whole Clove* (USF) | 80 | 320 | ÷4 | $105.08 | $26.27 |
| $9 | *Sour Cream, Cultured* (USF) | 80 | 320 | ÷4 | $34.08 | $8.52 |

**CONFLICT (8) — no clean relation; needs adjudication.**

| spend | Angel product | ours (oz) | Angel (oz) | ratio | reading |
|---:|---|---:|---:|---:|---|
| $1,133 | ARUGULA BABY | 48 | 64 | 1.33 | ours came from a Baldor 48-oz pack; Angel's PFG pack is `2/2 LB`. **Our pack size is stale.** |
| $732 | TOMATO 5X6 | 160 | 400 | 2.50 | ours models a 10-lb case; Angel's is `1/25 LB`. Stale. |
| $392 | JUICE LEMON ALL NAT | 202.86 | 192 | 0.95 | ours = 6 L; Angel = `6/32 OZ`. Different product form (frozen vs refrigerated). |
| $335 | *Arugula, Baby* (USF) | 48 | 64 | 1.33 | same as above |
| $70 | TOMATO 6X6 | 160 | 400 | 2.50 | same as above |
| $49 | OREGANO LEAVES (24 oz) | 20 | 24 | 1.20 | ours = 20 oz (2024 sheet); Angel offers both 24 oz and 5 lb |
| $41 | *Juice, Lemon NFC* (USF) | 202.86 | 192 | 0.95 | same as above |
| $29 | *Spice, Oregano Leaf* (USF) | 20 | 24 | 1.20 | same as above |

**Highest-value weight finding: `PFG/Arugula` is modelled at 48 oz but Angel says the PFG pack is 4 lb / 64 oz.** At $1,468 combined spend that is our largest single pack-data error, and it silently understates arugula depletion by 33%.

### D.3 Internal inconsistency found in our own data

`PFG/Tomatoes Crushed (10#)` carries `each_size = 1626 oz` (top pack) **and** `avg_oz_per_each = 109` with `units_per_pack = 1`. Those cannot both be right: 1626 oz ÷ a #10 can of ~109 oz = 15 cans, but the pack chain says the case *is* 1626 oz as a single level. The 1626 figure traces to `inventory-costing.csv` ("Tomatoes Crushed (10#), $34.65, 1626 oz"). Angel's row is `6/#10 CN` — a **count** parse with no weight, so **Angel cannot resolve this.** Flag for Juan: how many #10 cans in the case, and what does one weigh?

### D.4 Juan's weigh-checklist — what Angel actually pays down

Source: `~/aggie-projects/CHIEF/03-PROJECTS/co-ops/2026-07-22-sku-weight-checklist.md`. Every `avg_oz_per_each` in the system today is a self-described **estimate** from `scripts/seed/10-fill-sku-weights.ts`.

**HIGH priority (weight does NOT cancel — these scale depletion and cost directly):**

| SKU | recipe unit | current estimate | Angel's parse | verdict |
|---|---|---:|---|---|
| Tuna | can | 66.6 oz | `6/66.5 OZ`, case 24.94 lb | ✅ **CONFIRMS 66.5 oz/can.** Answers the checklist's open question ("is 1 can the big 66.6-oz can or a small ~5-oz can?") — **it is the big can.** |
| Heavy Cream | quart | 32 oz | `12/32 OZ`, case 24 lb | ✅ **CONFIRMS 32 oz/quart** exactly. |
| Duke's Mayo | gallon | 130 oz | `4/1 GA` — **volume parse, no weight** | ❌ no help |
| Tomatoes Crushed | #10 can | 109 oz | `6/#10 CN` — **count parse, no weight** | ❌ no help (and see D.3) |
| Olive Oil | Tbsp | 0.48 oz | `3/3 LT` — **volume parse, no weight** | ❌ no help (standard value, fine as-is) |
| Mixed Herbs | quart | 4 oz *(flagged "very unsure")* | **not in Angel's catalog** | ❌ no help |
| Confectioners Sugar | cup | 4 oz | **not in Angel's catalog** | ❌ no help |
| Vanilla Bean Paste | tsp | 0.2 oz | **not in Angel's catalog** | ❌ no help |

**Score: 2 confirmed of 8. Six still require the scale.**

**LOW priority (~24 count items — slices, rolls, whole vegetables, handfuls): Angel confirms ZERO.**
Every one needs a count↔weight bridge. Angel has no `avg_oz_per_each` equivalent — its "Count ingredient + pack count" widget is per-line and stores nothing reusable (insights doc §3.2). Worse, the deli slices (ham, capicola, genoa, turkey, provolone, cheddar, pepperoni, prosciutto, bacon, pickle slices) are all **Delmar** rows with `NO_PACK_SIZE` — Angel doesn't even know the case weight, let alone the slice weight.

Where Angel gives a *case* weight for a count item, it constrains but does not determine the per-each value. Two examples worth handing Juan as sanity checks rather than fills:
- `PFG/Iceberg`: our pack is 640 oz; Angel's `LETTUCE CELLO ICEBERG CA` is `1/24 CT`. 640 ÷ 24 = **26.7 oz/head**, vs our estimate of 20 oz/unit — but only if "unit" means a whole head, which the checklist itself flags as LOW confidence.
- `PFG/Cucumber`: our pack is 158 oz; Angel's is `1/12 CT`. 158 ÷ 12 = **13.2 oz each**, vs our estimate of 8 oz. A 65% gap on a genuinely uncertain value.

**Bottom line for Juan: Angel saves you two weighings out of thirty-odd. Budget the scale time anyway.**

---

## E. Spend insights

### E.1 Top 20 by spend → disposition

Top 20 = **$37,878.86 = 68.7% of all spend.** Buckets: 16 MATCHED · 2 AMBIGUOUS · 2 NON-FOOD · **0 unregistered.**

| # | spend | disp | Angel product | vendor | our SKU |
|---:|---:|---|---|---|---|
| 1 | $7,913 | M | OVENGOLD TURKEY | Delmar | Boar's Head/Turkey |
| 2 | $5,771 | M | MAYO HD | PFG | PFG/Duke's Mayo |
| 3 | $3,534 | M | OIL OLIVE 100% EXTRA VIRGIN | PFG | PFG/Olive Oil |
| 4 | $2,650 | M | LONDON BROIL | Delmar | Boar's Head/Roast Beef *(proxy)* |
| 5 | $2,165 | **A** | HAM 35% WATER FC 4X6 TFF | PFG | Ham dup pair |
| 6 | $2,074 | M | MILD PROVOLONE | Delmar | Boar's Head/Provolone |
| 7 | $1,390 | M | LETTUCE ICEBERG LINER | PFG | PFG/Iceberg |
| 8 | $1,366 | **A** | CHEESE MOZZ 1OZ SLCD LOG 32 CT | PFG | Fresh Mozzarella dup pair |
| 9 | $1,357 | M | DILANDRI GENOA SALAME | Delmar | Boar's Head/Genoa |
| 10 | $1,181 | M | BEEF GRND BULK 80/20 | PFG | PFG/Ground Beef |
| 11 | $1,175 | M | HOT BUTT CAPPY | Delmar | Boar's Head/Capicola |
| 12 | $1,133 | M | ARUGULA BABY | PFG | PFG/Arugula |
| 13 | $1,050 | M | *Lettuce, Iceberg C&T* | US Foods | PFG/Iceberg *(historical)* |
| 14 | $963 | **X** | BAG PAPER KRAFT SHOPPER BISTRO | PFG | PFG/Kraft Small Bags |
| 15 | $827 | M | PICKLES CHIPS 1/4 | Delmar | Boar's Head/Pickle slices |
| 16 | $801 | **X** | *Bag, Shopping 10x6.75x12* | US Foods | PFG/Kraft Small Bags |
| 17 | $732 | M | TOMATO 5X6 | PFG | PFG/Tomatoes |
| 18 | $633 | M | IMP LAYER BACON 12/14 | Delmar | Boar's Head/Bacon |
| 19 | $584 | M | *Mayonnaise, Heavy* | US Foods | PFG/Duke's Mayo *(historical)* |
| 20 | $579 | M | ONION YLW COLOSSAL BAG | PFG | PFG/Onion (White) |

**The good news, stated plainly: there is NO high-spend item our registry fails to carry.** Every one of the top 20 already exists as a SKU. The registry's *coverage* is sound; its *price and pack accuracy* is the gap. That is a much better problem to have.

The two AMBIGUOUS entries at #5 and #8 are the finding worth acting on: **$3,531 of top-20 spend flows through duplicated SKU identities.**

### E.2 What we carry that Angel omits (the Delmar/PFG split, in reverse)

Of **120 non-packaging SKUs** in our registry, Angel's catalog covers **76** and omits **44**:

| lane | omitted | reading |
|---|---:|---|
| **Baldor** | 22 | 19 are already deactivated (9 of them house preps wrongly registered as SKUs — cleanup already done). The 3 active (`Onions`, `Salami`, `White Cheddar`) look like duplicates of live PFG/BH SKUs. **Not a coverage gap — a cleanup backlog.** |
| ***(no vendor)*** | 9 | **Lemon Oil, Mixed Herbs, Mortadella, Pepperoncini, Sub Roll, Utz Ripples, Vanilla Bean Paste, White Wine, Worcestershire** — real ingredients with no vendor assigned AND no Angel row. **This is the true blind spot.** |
| **PFG** | 9 | Balsamic Glaze, Chili Flake, Confectioners Sugar, Fusilli Pasta, Garlic Powder, Grapeseed Oil, Mustard (Whole), Old Bay, Red wine vinegar — we buy them from PFG but they're absent from the Angel export (likely below its capture threshold, or bought on a different guide). |
| Amazon / Penny Candy / Sarah / Sysco | 4 | long-tail single-SKU vendors, correctly absent |

**`Sub Roll` is the headline.** It is #1 on the insights doc's §6.4 missing list, it is in every sandwich at ~$0.70, it has a full 3-level pack chain (`flat=5 → Packs=6 → Sub roll=4 oz`), and it has **no vendor and no price**. Angel cannot help — Cardinal Bakery is registered in `vendors` with **zero SKUs**. Angel's absence here confirms rather than fills the gap: the doc's estimate that every sandwich is under-costed by ~$0.70 (≈4–5% FC) stands, and **only Juan can close it.**

Cross-checking against the doc's §6.4 ranked missing list: Capicola is **not** actually missing from our registry (we have `Boar's Head/Capicola`, and Angel has `HOT BUTT CAPPY` at $1,175) — that item was missing from *Angel*, not from us. Raw eggs likewise exist (`PFG/Eggs`). **Our registry is meaningfully more complete than Angel's catalog**, which is exactly what insights §3.1 predicted.

---

## F. RECOMMENDED ACTIONS

Conservative by construction. **Nothing here has been executed.** Grouped by what to write, what to ask Juan, and what to refuse.

### F.1 What to WRITE (only after Juan's sitting; each needs the pack-unit divisor applied)

The write mechanism already exists and is append-only with provenance semantics: `recordSkuPrice` (`lib/admin/cost.ts:139-170`) → `POST /api/admin/skus/[id]/price` (`app/api/admin/skus/[id]/price/route.ts:24`, gated `actorLevel >= 6`) → appends to `vendor_price_history`. Read back by `loadCurrentSkuPrices` (`lib/admin/cost.ts:37`) and `loadLatestPriceCentsBySku` (`lib/purchase-orders.ts:612`).

- **W1 — 12 direct price fills (PACK-AGREES rows, §D.2).** Case price goes in as-is. Lowest-risk, immediately correct. Covers Ground Beef, Garlic, Basil, Heavy Cream, Parsley, Sour Cream, Ricotta, Honey, Thyme.
- **W2 — 18 divided price fills (CASE-MULTIPLE rows, §D.2).** Use the computed pack price in the final column. **Every one must be eyeballed by Juan before write** — the divisor encodes an assumption about what our pack *is*.
- **W3 — pack-data correction: `PFG/Arugula` 48 oz → 64 oz.** Highest-value weight fix ($1,468 spend, 33% depletion error). **Note the mechanism:** `each_size`/`each_measure`/`units_per_pack`/`pack_format` are **NOT hand-editable** — they are derived server-side from the pack chain by `syncSkuFlatFieldsFromChain` (`lib/admin/pack-chain.ts:258-277`). The correct path is `replaceSkuPackChain` (`lib/admin/pack-chain.ts:289-339`) via the admin PackChainWizard, not a column UPDATE.
- **W4 — two weigh-checklist confirmations:** `Tuna` 66.6 → 66.5 oz/can and `Heavy Cream` 32 oz/quart (already correct; mark as *confirmed*, not estimated). `avg_oz_per_each` IS directly editable via SkuBuilder.
- **W5 — 4 new low-spend SKUs** where our own 2024 sheet already knows the product: bread flour, apple-cider vinegar, Deer Park, and the three "Just" cans ($358.80 combined — arguably one line item).

**Provenance caveat, and it is a real gap:** `vendor_price_history` has columns `id, vendor_item_id, unit_price, effective_date, recorded_at, recorded_by` — **there is no `source` or `note` column.** There is nowhere to stamp "this price came from the Angel export dated 2026-08-14, row `MAYO HD`, divided by 4." The only provenance carriers today are `recorded_by` (a user id) and the `audit_log` row. Given §B.3 (duplicate rows differing by up to 2×), *which Angel row a price came from is load-bearing information.* **Recommend a migration adding `source text` + `source_note text` to `vendor_price_history` BEFORE any bulk Angel import** — otherwise these become unattributable numbers indistinguishable from invoice-derived ones, which destroys exactly the trust advantage insights §4.4 identifies as co-ops' differentiator over Angel.

### F.2 What to QUEUE for Juan (decisions we must not make)

- **J1 — Resolve the two duplicate SKU pairs** (`Ham`, `Fresh Mozzarella`): repoint `recipe_inputs` to the real SKU, deactivate the placeholder. **$3,531 of top-20 spend rides on this**, and a price written to the wrong twin is invisible. Pre-existing (flagged July 2026); Angel just priced the cost of the delay.
- **J2 — Delmar Provisions: register as a vendor, or keep Boar's Head?** 37.4% of spend, 23 SKUs affected. Distributor-model vs brand-model (§A.2). Recommend registering Delmar; Juan decides.
- **J3 — Supply pack sizes for the Delmar lane.** All 23 matched Delmar rows are `NO_PACK_SIZE`. Until Juan says what a case of OvenGold or London Broil *is*, $20,237 of spend cannot be costed per-ounce. **This is the single highest-leverage question in the whole report** — one conversation unlocks more than every PFG fill combined.
- **J4 — Adjudicate the 8 CONFLICT pack rows** (§D.2), especially Tomatoes (160 vs 400 oz) and Lemon Juice (frozen vs refrigerated — possibly two real products).
- **J5 — `CHEESE MOZZ PROV 50/50 SHRED`: one product or two?** Angel lists it with separate spend from plain shredded mozz.
- **J6 — `Tomatoes Crushed (10#)` internal inconsistency** (§D.3): 1626 oz vs 109 oz/can can't both be right.
- **J7 — `Sub Roll` has no vendor and no price**, and `Cardinal Bakery` is registered with zero SKUs. Every sandwich is under-costed ~$0.70. Angel cannot help. **Floor-time item.**
- **J8 — Duplicate-cluster tie-breaks** (§B.3): for the 25 clusters, which Angel row is the price of record? Default rule proposed: *prefer the PFG row over the US Foods row*; where two PFG rows exist (Basil, Oregano, Heavy Cream, Tomatoes, Onion), Juan picks.
- **J9 — Three suspect active Baldor SKUs** (`Onions`, `Salami`, `White Cheddar`) — dedupe against PFG/BH twins?

### F.3 What to REFUSE (do not propagate, under any framing)

- **R1 — All 23 Delmar `$/lb` derivations.** `NO_PACK_SIZE` means there is no denominator. Inventing one is precisely the `PICKLES CHIPS $35.95/lb` failure (§C.3). Case prices may be recorded *as case prices* only where our pack chain provably equals a case — which for Delmar is nowhere, because we don't know their case.
- **R2 — The 3 `HIGH_PPL_REVIEW` rows** as commodity prices (CHIVES $35.76/lb, THYME $66.16/lb, chive shaker $23.14/lb). Arithmetically fine, operationally misleading; Thyme disagrees with our own sheet by +176%.
- **R3 — Any bulk/scripted import of `latest_price_per_case_usd` into `unit_price`.** F3 and §D.2 show our pack equals Angel's case in only 12 of 38 comparable cases. A bulk import would overstate Ham 13×, Butter 36×, Cheddar 10×. **If one recommendation survives this document, it is this one.**
- **R4 — The insights doc's §6.2 menu-item cost table** as a parity-test oracle. It bakes in the $35.95/lb pickles bug (inflating two menu items by ~$1), the uncosted sub roll, and uncosted capicola. Rebuild those numbers from the corrected data before using them to validate a co-ops costing engine.
- **R5 — Treating the one existing `vendor_price_history` row as real** (Banana Peppers $20.00). Two independent sources say ~$8. It is smoke-test residue (§C.1).
- **R6 — Using US Foods rows as prices of record.** Historical order guides for a lane we migrated to PFG (§A.3). Cross-check only.
- **R7 — Writing `guide_position`, `unit`, `unit_size`, or `category` on `vendor_items`.** Verified vestigial: `unit`/`unit_size`/`category` have zero reads anywhere in app code (declared vestigial in `lib/admin/skus.ts:15-16` and migration `0096`); `guide_position` has a reader (`lib/purchase-orders.ts:226,412`) but **no writer anywhere** and is always NULL. Don't feed dead columns.

### F.4 Suggested sequence

1. **J3 first** (Delmar pack sizes) — unblocks 37% of spend in one conversation.
2. **J1** (dedupe Ham + Fresh Mozzarella) — must precede any price write, or prices land on the wrong twin.
3. **Migration: `vendor_price_history.source`** — must precede bulk fills, or provenance is lost forever.
4. **W1** (12 direct fills) — safe, immediate, lights up `hasPrice` readiness (`lib/admin/readiness-load.ts:59`).
5. **W3** (Arugula pack fix) + **W4** (2 weight confirmations).
6. **W2** (18 divided fills), one Juan eyeball per row.
7. Everything else.

---

## Appendix — coverage arithmetic (all figures live-verified 2026-08-20)

| metric | value |
|---|---:|
| Angel rows | 153 |
| Angel total spend | $55,144.01 |
| Angel vendors | 3 (PFG, Delmar Provisions, US Foods) |
| `vendors` rows (ours) | 17 (0 named Delmar) |
| `vendor_items` rows | 182 (161 active; 11 with `vendor_id IS NULL`) |
| non-packaging SKUs | 120 |
| …covered by Angel | 76 |
| …omitted by Angel | 44 |
| `vendor_price_history` rows | **1** |
| `vendor_delivery_items` rows / priced | 8 / **1** |
| `po_lines` rows / priced | 15 / **0** |
| `sku_pack_levels` rows / SKUs chained | 122 / 53 |
| SKUs with `avg_oz_per_each` | 38 (all estimates) |
| `sku_count_events` | **0** (first physical count still pending) |
| MATCHED / NON-FOOD / AMBIGUOUS / NEW | 109 / 33 / 3 / 8 |
| Angel duplicate clusters | 25 clusters covering 62 rows |
| PACK-AGREES / CASE-MULTIPLE / CONFLICT | 12 / 18 / 8 |
| Angel rows with usable `$/lb` | 68 of 153 (61 matched, unflagged) |
| Angel rows flagged untrustworthy | 27 `NO_PACK_SIZE` + 3 `HIGH_PPL_REVIEW` |
| weigh-checklist HIGH items Angel can confirm | **2 of 8** |
| weigh-checklist LOW (count) items Angel can confirm | **0** |
