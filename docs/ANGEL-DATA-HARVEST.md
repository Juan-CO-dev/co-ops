# Angel Spend → co-ops data harvest

**Captured:** 2026-08-20 from the live Compliments Only account (angelpurchasing.com).
**Scope:** all 440 purchase lines / 159 product records / $61,579.22 — the full account history, not a sample.

**Reconciliation check:** `sum(line_total)` over the 440 exported rows = **$61,579.22**, matching Angel's Purchases header exactly. The export is complete and transcription-clean.

> Note vs. the earlier pull (`angel-product-catalog.csv`): that snapshot was 390 lines / 153 products / $55,144.01. The account has since received Aug 13–14 deliveries. **This file supersedes it.**

## Files

| File | Rows | What it is |
|---|---|---|
| `angel-purchase-history.csv` | 440 | Full invoice-line history. The export you asked for. |
| `angel-products-rollup.csv` | 159 | SKU-level rollup with min/max price and derived weight ranges. |
| `angel-delmar-27.csv` | 27 | Answer to request #1 — every Delmar item with $/lb + derived case weight. |
| `angel-pack-vs-actual.csv` | 159 | Pack-size string vs. Angel's actual net weight. Read §5. |

### The two derived columns that matter

Angel's Purchases grid exposes `$/lb` but hides net weight behind the per-product page. **Net weight is recoverable algebraically** and I've done it for every line:

```
net_weight_lbs   = line_total / price_per_lb
lbs_per_unit     = net_weight_lbs / quantity      ← this is the case weight
unit_price_case  = line_total / quantity
```

Verified against a known ground truth: SALT KSHR COARSE, Jul 17, qty 2, $125.66 total, $2.26/lb → 55.60 lbs → 27.80 lb/case. The product page states 55.5 lbs / 27.75 lb per case. Agreement to rounding. **The derivation is sound; use `lbs_per_unit` as real data.**

`weight_source` classifies each line:
- `invoice_catch_weight` — Angel has a real measured weight.
- `assumed_default_1lb` — `lbs_per_unit` is exactly 1.000, i.e. the vendor feed sent no weight and Angel silently substituted 1 lb/unit. **`$/lb` on these rows is meaningless** (it just equals the case price).

---

## 1. All 27 Delmar Provisions items — $/lb and case weight

Sorted by spend. `case_wt` is derived per the formula above.

| # | Product (verbatim) | $/lb | $/case | case_wt (lb) | Weight | Cases | Spend |
|---|---|---|---|---|---|---|---|
| 1 | `OVENGOLD TURKEY` | 6.29 | 57.61 – 58.48 | 9.16 – 9.30 | ✅ measured | 136 | $7,913.31 |
| 2 | `LONDON BROIL` | 8.69 | 56.93 – 62.45 | 6.55 – 7.19 | ✅ measured | 44 | $2,650.38 |
| 3 | `MILD PROVOLONE` | 3.49 | 19.19 – 19.24 | 5.50 – 5.51 | ✅ measured | 108 | $2,073.66 |
| 4 | `DILANDRI GENOA SALAME` | 4.39 | 27.52 – 28.81 | 6.27 – 6.56 | ✅ measured | 48 | $1,357.22 |
| 5 | `HOT BUTT CAPPY` | 5.45 | 19.57 – 19.59 | 3.59 | ✅ measured | 60 | $1,174.69 |
| 6 | `PICKLES CHIPS 1/4` | 35.95 | 35.95 | 1.000 | ❌ **FAKE** | 23 | $826.85 |
| 7 | `IMP LAYER BACON 12/14` | 4.69 | 70.35 | 15.00 | ⚠️ fixed 15.0 | 9 | $633.15 |
| 8 | `DIET COKE` | 25.45 | 25.45 | 1.000 | ❌ **FAKE** | 20 | $509.00 |
| 9 | `HOT CHERRY PEPPERS` | 8.95 | 8.95 | 1.000 | ❌ **FAKE** | 56 | $501.20 |
| 10 | `Food Service Prosciutto` | 12.95 | 12.95 | 1.000 | ❌ **FAKE** | 30 | $388.50 |
| 11 | `COKE` | 25.45 | 25.45 | 1.000 | ❌ **FAKE** | 15 | $381.75 |
| 12 | `EVERROAST CHICKEN` | 5.99 | 27.69 – 28.01 | 4.62 – 4.68 | ✅ measured | 12 | $333.28 |
| 13 | `Pepperoni Slicing` | 5.09 – 5.19 | 17.79 – 18.09 | 3.486 – 3.495 | ✅ measured | 18 | $322.06 |
| 14 | `SWEET PEPPERS` | 10.25 | 10.25 | 1.000 | ❌ **FAKE** | 24 | $246.00 |
| 15 | `Compliments Branded Water` | 12.95 | 12.95 | 1.000 | ❌ **FAKE** | 18 | $233.10 |
| 16 | `5 GALLON GARLIC PICKLES` | 35.95 | 35.95 | 1.000 | ❌ **FAKE** | 6 | $215.70 |
| 17 | `Just Dragon Green Can` | 14.95 | 14.95 | 1.000 | ❌ **FAKE** | 8 | $119.60 |
| 18 | `Just Raspberry Tea Can` | 14.95 | 14.95 | 1.000 | ❌ **FAKE** | 8 | $119.60 |
| 19 | `Just Lemon Tea Can` | 14.95 | 14.95 | 1.000 | ❌ **FAKE** | 8 | $119.60 |
| 20 | `BLACK CHERRY DR. BROWNS` | 14.95 | 14.95 | 1.000 | ❌ **FAKE** | 8 | $119.60 |
| 21 | `ROOT BEER DR. BROWNS` | 14.95 | 14.95 | 1.000 | ❌ **FAKE** | 6 | $89.70 |
| 22 | `CREAM DR. BROWNS` | 14.95 | 14.95 | 1.000 | ❌ **FAKE** | 6 | $89.70 |
| 23 | `DIET CREAM DR. BROWNS` | 14.95 | 14.95 | 1.000 | ❌ **FAKE** | 5 | $74.75 |
| 24 | `BANANA PEPPER RINGS` | 8.75 | 8.75 | 1.000 | ❌ **FAKE** | 8 | $70.00 |
| 25 | `CEL-RAY DR. BROWNS` | 16.95 | 16.95 | 1.000 | ❌ **FAKE** | 1 | $16.95 |
| 26 | `DIET CHERRY DR. BROWNS` | 16.50 | 16.50 | 1.000 | ❌ **FAKE** | 1 | $16.50 |
| 27 | `Deer Park Loose` | 8.50 | 8.50 | 1.000 | ❌ **FAKE** | 1 | $8.50 |

**Headline for co-ops:** 8 of 27 Delmar SKUs carry a real catch weight; **19 do not.** The split is exactly along product lines — *sliced deli meat and cheese have measured weights; everything jarred, bucketed, or canned does not.* That's the shape of the vendor feed, and it's predictable enough to encode as a rule.

The 8 measured ones are the load-bearing numbers you wanted, and they're the ones you can trust:

```
OVENGOLD TURKEY          ~9.23 lb/case   $6.29/lb
LONDON BROIL             ~6.87 lb/case   $8.69/lb   (widest variance: 6.55–7.19)
MILD PROVOLONE           ~5.51 lb/case   $3.49/lb
DILANDRI GENOA SALAME    ~6.42 lb/case   $4.39/lb
HOT BUTT CAPPY           ~3.59 lb/case   $5.45/lb
EVERROAST CHICKEN        ~4.65 lb/case   $5.99/lb
Pepperoni Slicing        ~3.49 lb/case   $5.09/lb
IMP LAYER BACON 12/14    15.00 lb/case   $4.69/lb   ⚠️ see below
```

**Caveat on IMP LAYER BACON 12/14:** `lbs_per_unit` is *exactly* 15.000 on every one of its lines, never varying. Real catch weights wobble (see London Broil at 6.55–7.19). A perfectly constant 15.0 is either a genuinely fixed-weight case or a nominal weight typed in once. 15 lb is the standard case for Boar's Head imported layer bacon, so it's probably right — but treat it as `pack_chain`-sourced, not `invoice`-sourced.

### The 19 fakes — what they should actually be
Angel's `$/lb` for these is *the case price wearing a $/lb label*. For anything you cost by weight you need a real number. Best available estimates:

| Product | Angel says | Reality | True $/lb |
|---|---|---|---|
| `PICKLES CHIPS 1/4` | $35.95/lb | 5-gal bucket ≈ 40 lb | **~$0.90/lb** — 40× overstated |
| `5 GALLON GARLIC PICKLES` | $35.95/lb | 5-gal bucket ≈ 40 lb | **~$0.90/lb** |
| `HOT CHERRY PEPPERS` | $8.95/lb | gallon jar ≈ 7 lb drained | ~$1.28/lb |
| `SWEET PEPPERS` | $10.25/lb | gallon jar ≈ 7 lb drained | ~$1.46/lb |
| `BANANA PEPPER RINGS` | $8.75/lb | gallon jar ≈ 7 lb drained | ~$1.25/lb |
| `Food Service Prosciutto` | $12.95/lb | **plausibly correct** — 1 lb pack is a real Boar's Head SKU | ~$12.95/lb ✓ |
| all sodas / waters | $8.50–25.45/lb | cost by the **case/each**, never by weight | n/a |

Note the trap in that last group: prosciutto's $12.95 may well be right, and you *cannot distinguish it from the wrong ones inside Angel's UI*. That's the whole argument for `weight_source` as a first-class field.

---

## 2. Disputed rows — resolved

### Tomatoes: 160 oz vs 400 oz → **400 oz is right, and there are three distinct SKUs**

| Product (verbatim) | Vendor | Pack | Actual case wt | oz | $/lb | $/case |
|---|---|---|---|---|---|---|
| `TOMATO 5X6` | PFG | 1/25 LB | 24.91 – 25.06 lb | **~400 oz** | 1.30 – 1.39 | 32.58 – 34.82 |
| `TOMATO 6X6` | PFG | 1/25 LB | 26.99 lb | ~432 oz | 1.29 | 34.82 |
| `Tomato, Round 4x5 #1 Grade Fresh Ref 2 Layer Box` | US Foods | 20 LB | 19.99 lb | **320 oz** | 1.50 – 1.64 | 29.98 – 32.78 |

**Verdict:** 400 oz (25 lb) for the PFG 5x6 — measured across 7 purchase lines, dead consistent. Nothing in the account is 160 oz; that figure looks like a 10 lb assumption that never existed here. The US Foods box is a genuinely different 20 lb / 320 oz pack. `TOMATO 6X6` is a third SKU (different count size, slightly heavier box).

### Lemon juice: frozen vs refrigerated → **both exist. They are different SKUs, and the frozen is cheaper.**

| Product (verbatim) | Vendor | Pack | Case wt | $/lb | $/case | Lines |
|---|---|---|---|---|---|---|
| `JUICE LEMON FZ` | PFG | 12/1 LT | 31.02 lb | **$2.02** | $62.66 | 1 |
| `JUICE LEMON ALL NAT` | PFG | 6/32 OZ | 13.97 lb | **$2.34** | $32.70 | 6 |
| `Juice, Lemon Not-From-Concentrate Plastic Bottle Ref` | US Foods | 6/32 OZ | 13.49 lb | **$3.02** | $40.75 | 1 |

**Verdict:** not a duplicate, not a data error — three real SKUs. `JUICE LEMON FZ` is the frozen 12×1L; the other two are refrigerated 6×32oz NFC (Natalie's) from two vendors. PFG's refrigerated is **23% cheaper per lb** than US Foods' for what is functionally the same Natalie's product.

⚠️ **Do not fold `JUICE LEMONADE NAT` into this cluster.** It's *lemonade*, not lemon juice — 6/12 OZ, 4.50 lb/case, $2.36/lb, and $552.76 of spend across 7 lines. It's the single most-purchased juice SKU and the name similarity is a trap.

### The 3 HIGH_PPL_REVIEW items → **two are real, one is a genuine second bug class**

| Product (verbatim) | Vendor | Pack | Actual wt | Nominal | ratio | $/lb | Verdict |
|---|---|---|---|---|---|---|---|
| `CHIVES FRSH` | PFG | 1/8 OZ | 0.81 lb | 0.50 lb | 1.62× | $22.07 | **Real.** Herbs genuinely cost this. Pack string understates. |
| `THYME FRSH` | PFG | 1/4 OZ | 0.47 lb | 0.25 lb | 1.88× | $35.19 | **Real.** Same pattern. Single 1-case purchase. |
| `Spice, Chive Chopped Plastic Shaker Shelf Stable Seasoning` | US Foods | 6/1.12 OZ | **0.07 lb** | 0.42 lb | **0.167×** | **$138.86** | ❌ **BUG.** |

**The Spice Chive row is the find.** `0.167 = exactly 1/6`. Angel recorded the weight of **one shaker** (1.12 oz = 0.07 lb) as the weight of the whole **6-pack case**. It dropped the pack multiplier.

True cost: $9.72 / 0.42 lb = **$23.14/lb** — which lands right in line with the other dried spices. Angel reports it 6× high.

This is a **distinct failure mode from the 1.0-lb default**, and it's nastier, because:
- it does *not* produce the `$/lb == $/case` signature, so the detector for bug #1 misses it entirely;
- it can be off by any pack multiplier (2×, 6×, 24×), not a fixed factor;
- it's only visible by comparing declared net weight against the parsed pack string.

**Detector for co-ops:** flag any line where `invoice_net_weight / pack_chain_nominal_weight` rounds to `1/N` for integer N ≥ 2. That's not a catch-weight wobble; that's a dropped multiplier.

---

## 3. Duplicate pairs — verdicts

### Basil → **3 distinct SKUs, not duplicates. But 2 of 3 have fake weights.**

| Product | Brand / Grower | Vendor | Pack | Case wt | $/lb | $/case | Weight |
|---|---|---|---|---|---|---|---|
| `BASIL FRSH` | FRSH ADV / THE CLASS PRODUCE GROUP | PFG | 1/1 LB | 1.000 | $10.34 | $10.34 | ❌ default |
| `BASIL FRSH` | PEAK FRS / RUBY CO EUREKA | PFG | 1/1 LB | **1.4505** | $13.48–13.97 | $19.55–20.25 | ✅ measured |
| `Basil, Fresh Herb` | Cross Valley Farms | US Foods | 1 LB | 1.000 | $16.08 | $16.08 | ❌ default |

Same name, same vendor, same pack string, **different grower** — genuinely different products (Angel has no canonical-item layer to group them, which is exactly the gap co-ops' registry fills).

⚠️ **The price comparison here is invalid as displayed.** Peak Fresh's 1.45 lb is measured; the other two are assumed 1.0 lb. If FRSH ADV basil also ships ~1.45 lb, its true cost is **$7.13/lb, not $10.34** — making it the cheapest by a wide margin instead of the middle option. Angel's own $/lb ranking of these three is untrustworthy. This is the clearest single illustration of why `weight_source` has to be surfaced.

### Cheddar → **3 distinct SKUs; 2 are true cross-vendor equivalents**

| Product | Brand | Vendor | Pack | Case wt | $/lb | $/case |
|---|---|---|---|---|---|---|
| `CHEESE CHED SHARP WHI BLOCK TF` | LOL | PFG | 1/10 LB | 10.02–10.03 | **$3.33–3.54** | $33.40–35.46 |
| `Cheese, Cheddar White Sharp Print Vacuum-Pack Ref` | Glenview Farms | US Foods | 10 LBA | 10.46 | **$4.60** | $48.12 |
| `CHEESE CHED WHI MED LOAF` | TILLAMK | PFG | 2/5 LB | 11.01 | $4.70 | $51.73 |

Rows 1 and 2 are the **same product from two vendors** — white sharp cheddar, ~10 lb, block vs. print. All measured weights, so the comparison is clean: **PFG is $1.06–1.27/lb cheaper.** Actionable.
Row 3 is genuinely different (*medium*, not sharp; loaf, not block) — keep separate.

Note `10 LBA` on the US Foods row: **LBA = "lb average"**, an explicit catch-weight marker in the pack string itself. Worth adopting — see the insights doc.

### Heavy cream → **3 SKUs; 2 are cross-vendor equivalents, 1 is a different product**

| Product | Vendor | Pack | Case wt | $/lb | $/case |
|---|---|---|---|---|---|
| `CREAM HVY WHIPPING 40% TFF` | PFG | 12/32 OZ | 27.55 – 27.57 | **$1.68–1.69** | $46.32–46.56 |
| `Cream, Whipping Heavy 40% Butterfat Uht Dairy Carton Gable Top Ref` | US Foods | 12/1 QT | 25.04 | **$1.71** | $42.82 |
| `CREAM HVY 36% TFF` | PFG | 12/32 OZ | 26.87 – 26.89 | $1.66–1.67 | $44.63–44.88 |

Rows 1 and 2 are the same thing — 40% butterfat, 12 quarts. Row 3 is **36% butterfat**: a different product, don't merge (though it's a legitimate cheaper substitute in most applications).

🔍 **Subtle catch worth flagging to co-ops:** rows 1 and 2 are identical volumes — 12 quarts — yet Angel carries **27.55 lb** for one and **25.04 lb** for the other, a 10% spread. Physically impossible for the same liquid. One vendor is including carton tare and the other isn't. **Cross-vendor $/lb comparison silently inherits that 10% error.** Any co-ops "cheapest vendor for X" report needs to normalise on a canonical unit (volume or count), not on vendor-declared weight.

### Bonus: Oregano → **2 SKUs, same name/brand/vendor, different packs — and a 31% saving**

| Product | Vendor | Pack | Case wt | $/lb | $/case |
|---|---|---|---|---|---|
| `OREGANO LEAVES` | PFG | 1/5 LB | 6.001 | **$9.21** | $55.27 |
| `OREGANO LEAVES` | PFG | 1/24 OZ | 1.830 | **$13.34** | $24.41 |
| `Spice, Oregano Leaf Dried Plastic Jug Shelf Stable Seasoning` | US Foods | 24 OZ | 1.500 | $19.46 | $29.19 |

Identical product name, brand *and* vendor — distinguished only by pack size. The big jug is **31% cheaper per lb**, and the US Foods equivalent is **111% more expensive** than the PFG big jug. Both smaller SKUs are still being bought.

---

## 4. Purchase history export

`angel-purchase-history.csv` — 440 rows, newest first (Aug 14, 2026 → Jul 10, 2026), one row per invoice line.

```
date, product, brand, manufacturer, vendor, pack_size, quantity,
unit_price_per_case, price_per_lb, net_weight_lbs, lbs_per_unit,
weight_source, line_total
```

Columns 1–7, 9 and 13 are Angel's own values, verbatim (product names untouched, including the em-dash `—` Angel uses for null). Columns 8, 10, 11, 12 are derived by the formulas in the header section.

**Shape of the data:**

| Vendor | SKUs | Spend | Share | Pack size | Brand/Mfr |
|---|---|---|---|---|---|
| PFG | 83 | $34,071.57 | 55.3% | ✅ | ✅ |
| **Delmar Provisions** | 27 | **$20,604.35** | **33.5%** | ❌ all blank | ❌ mostly |
| US Foods | 48 | $6,745.90 | 11.0% | ✅ | ✅ |
| Cardinal Bakery | 1 | $157.40 | 0.3% | `12 ct` | ❌ |

Date range: **Jul 10 – Aug 14, 2026** (~5 weeks). Delivery days cluster Fri (PFG/US Foods) and Thu (Delmar).

**One-third of spend sits on the vendor with no pack metadata** — and that vendor is the broker's own direct-supply line. Worth restating to Juan's boss: Angel's broker-direct advantage buys accurate *prices*, not accurate *units*.

🆕 **`Cardinal Bakery` is now in the data** — `Large Hero Hearth`, Aug 13, 20 × $7.87 = $157.40, pack `12 ct`, **no $/lb at all** (Angel shows `—` rather than faking it). This is the sub roll. Two things follow: (a) the "roll not costed" gap in Menu Costing is now closable at $7.87/dozen ≈ **$0.656/roll** — cheaper than the $0.70 in `inventory-costing.csv`; (b) when a vendor sends *no* weight and *no* usable pack, Angel correctly shows `—`. It only fabricates 1.0 when the feed supplies a quantity-shaped field. Useful detail for reproducing the failure mode.

Also new since the last pull: `GARLIC PWDR` (MAGELLAN 3/6 LB, $10.61/lb), `PASTA FUSILLI` (DECECCO 4/5 LB, $1.83/lb), `VINEGAR WHI DISTILLED 40 GRAIN` (4/1 GA, $0.46/lb), `STRAWBERRIES` (8/1 LB, $2.88/lb), `WRAP DELI PAPER WAX 12X10.75`.

---

## 5. The finding you didn't ask for: **the pack-size string is unreliable in 22% of cases**

`angel-pack-vs-actual.csv` compares each SKU's parsed nominal pack weight against Angel's actual net weight. Of 81 SKUs whose pack string parses to a weight, **18 diverge by more than 15%**:

| ratio | Product | Pack | Nominal | Actual | Reading |
|---|---|---|---|---|---|
| **0.167×** | `Spice, Chive Chopped…` | 6/1.12 OZ | 0.42 | 0.07 | dropped ×6 multiplier (§2) |
| 1.16× | `VINEGAR BALSAMIC` | 2/5 LT | 22.05 | 25.56 | density — vinegar > water |
| 1.17× | `JUICE LEMON ALL NAT` | 6/32 OZ | 12.00 | 13.97 | bottle tare |
| 1.17× | `JUICE LEMON FZ` | 12/1 LT | 26.46 | 31.02 | bottle tare |
| 1.20× | `OREGANO LEAVES` | 1/5 LB | 5.00 | 6.00 | **pack string wrong** |
| 1.20× | `ONION PWDR` | 1/5 LB | 5.00 | 6.00 | **pack string wrong** |
| 1.20× | `GARLIC WHL PLD DOM` | 1/5 LB | 5.00 | 6.01 | **pack string wrong** |
| 1.20× | `RADISH WATERMELON` | 1/10 LB | 10.00 | 12.01 | **pack string wrong** |
| 1.25× | `ARUGULA BABY` | 2/2 LB | 4.00 | 5.01 | **pack string wrong** |
| 1.25× | `STRAWBERRIES FRSH` | 2/1 LB | 2.00 | 2.50 | **pack string wrong** |
| 1.40× | `PARSLEY FRSH FLAT ITAL` | 1/1 LB | 1.00 | 1.40 | herb bunch overpack |
| 1.40× | `MINT FRSH` | 1/1 LB | 1.00 | 1.40 | herb bunch overpack |
| 1.45× | `BASIL FRSH` (Peak Frs) | 1/1 LB | 1.00 | 1.45 | herb bunch overpack |
| 1.62× | `CHIVES FRSH` | 1/8 OZ | 0.50 | 0.81 | herb bunch overpack |
| 1.88× | `THYME FRSH` | 1/4 OZ | 0.25 | 0.47 | herb bunch overpack |
| 1.92× | `WATER SPRKLNG SPRING GLASS` | 24/12 OZ | 18.00 | 34.53 | **glass tare ≈ product weight** |
| **6.97×** | `BASE BEEF NO MSG JAR` | 1/1 LB | 1.00 | 6.97 | pack string says 1 jar; it's a 6-pack |

Three distinct causes, each needing different handling in co-ops:

1. **Tare inclusion** (glass 1.92×, bottles 1.17×, cartons ~1.10×). Angel's net weight is *gross-ish* — it includes packaging. Any $/lb on a packaged liquid is a **$/lb-of-package**, not $/lb-of-product. Costing a recipe by weight against these is wrong by up to 92%. Cost liquids by volume.
2. **Pack string is simply wrong** (the family of `1/5 LB → 6.0 lb`, and `BASE BEEF 1/1 LB → 6.97 lb`). The 1.2× cluster is suspiciously consistent — several unrelated PFG SKUs labelled `1/5 LB` all land at exactly 6.00 lb. Either PFG ships 6 lb in a "5 lb" case, or the feed's pack string is a size *code* rather than a weight. Don't trust it.
3. **Genuine product variance** (herbs at 1.4–1.9× — a "1 lb" bunch box that really holds 1.45 lb).

**The transferable rule:** co-ops' `pack-chain` derives weight structurally, and Angel's invoice weight is the "ground truth" you'd normally defer to. This table shows **you can't blindly defer.** The right design is to compute both, store both, and let disagreement be a *signal* rather than a resolution:

```
delivery_line.net_weight_oz        -- from invoice, when present
delivery_line.resolved_oz          -- from pack_chain
delivery_line.weight_source        -- invoice | pack_chain | assumed_default
delivery_line.weight_disagreement  -- net_weight / resolved, when both exist
```

Then: `weight_disagreement ≈ 1/N` → dropped multiplier (bug). `≈ 1.0` → confident. `1.1–1.3` on a liquid → tare, cost by volume. `> 1.3` with no explanation → review queue. And `weight_source = assumed_default` → never display a derived $/lb without a warning badge.

That one derived column catches every failure mode in this document, including the two Angel ships today.

---

## 6. Straight answers to the four asks

1. **Delmar $/lb + case weights** — §1, all 27, `angel-delmar-27.csv`. 8 have real weights; 19 are the 1.0-lb default and their $/lb must not be used.
2. **Disputed rows** — §2. Tomatoes = **400 oz** (25 lb), plus a separate 320 oz US Foods SKU. Lemon juice = **both frozen and refrigerated exist**, 3 distinct SKUs, frozen cheapest at $2.02/lb. Of the 3 HIGH_PPL items, **CHIVES and THYME are real prices**; **Spice Chive Chopped is a bug** — $138.86/lb should be $23.14/lb (dropped ×6).
3. **Duplicate pairs** — §3. Basil: 3 real SKUs, different growers, *but* 2 of 3 have fake weights so the price ranking is unreliable. Cheddar: 3 SKUs, 2 are cross-vendor equivalents, PFG cheaper by ~$1.10/lb. Heavy cream: 3 SKUs, 2 are equivalents (40%), 1 is genuinely different (36%) — and the two "identical" ones disagree on weight by 10%. Bonus: oregano, same name + brand + vendor, 31% cheaper in the big jug.
4. **Purchase history export** — §4, `angel-purchase-history.csv`, all 440 lines, reconciled to the penny.

---

*Method note: Angel exposes no export and no API surface I could read. The 440 lines were harvested by paginating all 30 pages of the Purchases grid with the hidden `Brand`, `Pack Size` and `$/lb` columns enabled, then verified by reconciling the summed line totals against Angel's own header figure ($61,579.22 — exact match). Product records are read-only in Angel; no data was modified during this capture.*
