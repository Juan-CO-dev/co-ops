# Angel price fill — DRY RUN

**Status: NOTHING HAS BEEN WRITTEN.** This is the output of
`scripts/seed/17-angel-price-fill.ts` in its default (dry-run) mode. The script writes
only under an explicit `--execute` flag, and that flag is not to be used until Juan has
eyeballed the table below.

**Generated:** 2026-08-20, against `docs/seed/source/angel-product-catalog.csv` (153 rows)
and live prod (`bgcvurheqzylyfehqgzh`). SKU ids resolved live; all 14 resolved cleanly.

| | |
|---|---:|
| rows parsed | 153 |
| **would write** | **14** |
| refused (with reason) | 44 |
| not candidates | 95 |
| unresolved SKU names | 0 |
| spend covered by the 14 fills | $5,806.51 |
| `source` stamped on every row | `angel-catalog-2026-08` |
| `effective_date` on every row | `2026-08-14` (the export's date, not today's) |

---

## The one thing to check

`vendor_price_history.unit_price` is **the price of one of OUR packs**. Angel quotes
**the price of one of ITS cases**. Those are the same number for only 5 of the 14 rows
below; the other 9 are divided.

The divisor is the whole risk. `HAM 35% WATER FC 4X6 TFF` is $36.06 for a 13 lb case;
our Ham pack is 16 oz. Writing the case price straight through would say ham costs
**13× what it does**, and every recipe and plate cost downstream would inherit that.
Butter would be 36× wrong. So the question worth Juan's minute per row is not "is that
price right?" but **"is that what one of our packs actually is?"** — the divisor encodes
an assumption about our pack, and Juan is the one who knows.

## The 14 would-write rows

| our SKU | Angel product | case $ | ÷ | unit price | flag |
|---|---|---:|---:|---:|---|
| Ham | `HAM 35% WATER FC 4X6 TFF` [ROMA] 1/13 LB | $36.06 | ÷13 | **$2.77** | CASE-MULTIPLE · rounded |
| Ground Beef | `BEEF GRND BULK 80/20` [WEST CRK] 2/5 LB | $49.20 | ÷1 | **$49.20** | PACK-AGREES |
| Ground Pork | `PORK GRND 80/20 ALL NAT FZ` [WEST CRK] 2/5 LB | $23.90 | ÷2 | **$11.95** | CASE-MULTIPLE |
| Shredded Mozz | `CHEESE MOZZ LMWM SHRED` [GPREMIO] 6/5 LB | $85.14 | ÷6 | **$14.19** | CASE-MULTIPLE |
| Tuna | `TUNA CHNK LIGHT CHN` [WRLDDCK] 6/66.5OZ | $71.91 | ÷6 | **$11.99** | CASE-MULTIPLE · rounded |
| Garlic | `GARLIC WHL PLD DOM` [PEAK FRS] 1/5 LB | $19.72 | ÷1 | **$19.72** | PACK-AGREES |
| Salt | `SALT KSHR COARSE` [DMND CRY] 9/3 LB | $62.83 | ÷9 | **$6.98** | CASE-MULTIPLE · rounded |
| Butter | `BUTTER SOLID UNSLTD` [SLVR SRC] 36/1 LB | $81.11 | ÷36 | **$2.25** | CASE-MULTIPLE · rounded |
| Ricotta | `CHEESE RICOTTA IMPASTATA WM` [ROMA] 4/5 LB | $68.19 | ÷2 | **$34.10** | CASE-MULTIPLE · rounded |
| Parsley | `PARSLEY FRSH FLAT ITAL` [PEAK FRS] 1/1 LB | $15.20 | ÷1 | **$15.20** | PACK-AGREES |
| Oregano | `OREGANO LEAVES` [ROMA] 1/5 LB | $55.27 | ÷4 | **$13.82** | CASE-MULTIPLE · rounded |
| Sour Cream | `SOUR CREAM REAL` [DAISY] 1/5 LB | $8.10 | ÷1 | **$8.10** | PACK-AGREES |
| Honey | `HONEY AMBER EXTRA LIGHT` [WEST CRK] 1/5 LB | $17.77 | ÷1 | **$17.77** | PACK-AGREES |
| Onion Powder | `ONION PWDR` [ROMA] 1/5 LB | $33.25 | ÷5 | **$6.65** | CASE-MULTIPLE |

"rounded" means the exact quotient carried more than two decimals and was rounded to
cents. The unrounded value is preserved verbatim in each row's `source_note`, so nothing
is lost.

### Sanity check against the 2024 costing sheet

Converting the fills to $/lb and comparing with `inventory-costing.csv` — an independent
source, collected two years earlier by a different method:

| SKU | fill → $/lb | 2024 sheet | delta | reading |
|---|---:|---:|---:|---|
| Ham | $2.77 | $2.72 | **+2%** | strong independent confirmation of the ÷13 |
| Salt | $2.33 | $2.60 | −11% | ordinary drift |
| Tuna | $2.88 | $2.57 | +12% | ordinary drift |
| Ricotta | $3.41 | $2.51 | +36% | real two-year drift (report §C.4) |
| Butter | $2.25 | $4.72 | −52% | **not a disagreement** — the 2024 row priced a 1-lb retail print, Angel a 36-lb case |

Ham landing within 2% of a sheet built two years ago by hand is the best evidence
available that the division method is right.

---

## Refused: 44 rows

A refusal here is a finding, not a silence. Each row was reachable and was deliberately
not written.

### DELMAR_NO_PACK_SIZE — 27 rows, $20,604.35

Every Delmar row is a case price with **no denominator at all** (`NO_PACK_SIZE|BROKER_DIRECT`).
There is nothing to divide by, and inventing one is exactly how Angel's own UI turned a
$35.95 *case* price for `PICKLES CHIPS 1/4` into "$35.95/lb". This is the single largest
blocked slice — 37% of captured spend, including the top-spend item in the whole dataset
(`OVENGOLD TURKEY`, $7,913) — and **one conversation with Juan unlocks more than every
fill above combined** (report J3).

Includes: OVENGOLD TURKEY · LONDON BROIL · MILD PROVOLONE · DILANDRI GENOA SALAME ·
HOT BUTT CAPPY · PICKLES CHIPS 1/4 · IMP LAYER BACON · Food Service Prosciutto ·
EVERROAST CHICKEN · Pepperoni Slicing · HOT CHERRY PEPPERS · SWEET PEPPERS ·
5 GALLON GARLIC PICKLES · BANANA PEPPER RINGS · the Dr. Brown's / Coke / Just / water lines.

### HIGH_PPL_REVIEW — 3 rows, $240.82

The exporter itself flagged the derived $/lb as implausible. Not parse bugs — tiny herb
packs genuinely cost a lot per pound — but they must never propagate as commodity prices.

- `CHIVES FRSH` (PFG) case $17.88 → would have been Chives at $8.94 ($35.76/lb)
- `THYME FRSH` (PFG) case $16.54 → would have been Thyme at $16.54 ($66.16/lb; **+176%** vs our own sheet, the largest disagreement in the dataset)
- `Spice, Chive Chopped Plastic Shaker` (US Foods) case $9.72 ($23.14/lb)

### US_FOODS_HISTORICAL — 7 rows, $277.81

We already migrated the US Foods lane to PFG; these are old order guides — a redundant
naming dialect for products we now buy from PFG. Useful as a cross-check, never as the
price of record. Refusing them also stops a historical row from contesting a live PFG row
and blocking a good fill (Ricotta, Tuna, Garlic and Sour Cream all fill cleanly *because*
the US Foods twin drops out first).

### AMBIGUOUS_PRODUCT_IDENTITY — 1 row, $156.08

- `CHEESE MOZZ PROV 50/50 SHRED` (PFG) case $81.71 → **Shredded Mozz?**

Angel lists this mozzarella/provolone blend with spend *separate* from plain shredded
mozz, which suggests two real products rather than two quotes for one. Pricing our
Shredded Mozz from a 50/50 blend would be a silent mis-cost. **Juan: one product or two?**
(report J5)

### DUPLICATE_CLUSTER — 6 rows, $1,015.01

Three of our SKUs are each quoted by **two live PFG rows at different prices**. There is
no defensible automatic winner — picking the first would make our cost depend on CSV row
order — so both are refused and Juan picks (report J8). **These are the three highest-value
decisions on this page after Delmar:**

| our SKU | option A | option B | spread |
|---|---|---|---:|
| **Basil** | `BASIL FRSH` [FRSH ADV] → **$10.34** | `BASIL FRSH` [PEAK FRS] → **$19.55** | **89%** |
| **Heavy Cream** | `CREAM HVY WHIPPING 40%` → **$46.32** | `CREAM HVY 36%` → **$44.63** | 4% |
| **Cheddar** | `CHEESE CHED SHARP WHI BLOCK` [LOL] → **$3.55** | `CHEESE CHED WHI MED LOAF` [TILLAMK] → **$5.17** | 46% |

Notes to help the pick:
- **Basil** — the FRSH ADV row at $10.34/lb is an *exact* match to the 2024 costing sheet's
  $10.34. That is a strong hint, but it is still Juan's call which basil we actually buy.
- **Heavy Cream** — these are genuinely different products (40% vs 36% butterfat), not
  duplicate quotes. If we buy both, this may want two SKUs rather than a pick.
- **Cheddar** — likewise: a sharp white block vs a Tillamook medium loaf. Possibly two
  real products.

### Not candidates — 95 rows

No entry in the reconciliation report's §D.2 pack-relation tables: count/volume parses
with no weight, non-food packaging, new-SKU candidates, or the 8 genuine pack CONFLICTs
still awaiting adjudication (report J4 — Tomatoes 160 vs 400 oz, Lemon Juice frozen vs
refrigerated, etc.). **No divisor is ever inferred for these.** Absence from the table
means "not fillable", never "fill it some other way".

---

## Two arithmetic corrections to the reconciliation report

While reproducing §D.2's division table, two of its printed results came out slightly
different. Both are half-cent ties, both are in our favour to state precisely, and the
values in the table above are the corrected ones:

| row | report printed | computed | note |
|---|---:|---:|---|
| Tuna (`TUNA CHNK LIGHT CHN`) | $12.00 | **$11.99** | 71.91 ÷ 6 = 11.985 exactly |
| Ricotta (`CHEESE RICOTTA IMPASTATA WM`) | $34.09 | **$34.10** | 68.19 ÷ 2 = 34.095 exactly, rounds up |

Neither changes any conclusion in the report.

## One data note (not fixed here)

Our `Tuna` SKU records **66.6 oz/can**; Angel's parse says **66.5** (`6/66.5 OZ`), which is
also the answer to the weigh-checklist's open question about that can (report W4). The
0.15% gap does not move the price and correcting it is a SKU *weight* edit, not a price
edit — so it is deliberately left alone here and flagged for the weight pass.

---

## To proceed

Once Juan has signed off on the 14 rows:

```
npx tsx --conditions=react-server --env-file=.env.local scripts/seed/17-angel-price-fill.ts --execute
```

Every written row carries `source = 'angel-catalog-2026-08'` and a `source_note` naming
the Angel row verbatim with its arithmetic, e.g.:

```
HAM 35% WATER FC 4X6 TFF [ROMA] 1/13 LB | case $36.06 = 208 oz ÷ 13
  = our 16 oz pack → $2.77 per pack
```

so any of these numbers can be reconstructed and told apart from an invoice-derived
price later. The write is append-only and re-run-safe: a second `--execute` detects the
existing `(sku, source, effective_date)` rows and skips them rather than double-appending.
