
# Angel fill — WAVE 2 DRY RUN

**Status: NOTHING HAS BEEN WRITTEN.** This is the output of
`scripts/seed/19-angel-fill-wave2.ts` in its default (dry-run) mode. The script writes
only under an explicit `--execute` flag, and that flag is not used until Juan has
eyeballed the tables below.

**Generated:** 2026-08-20, against `docs/angel-products-rollup.csv` (159 products, angel-product-catalog.csv for the wave-1 join)
and live prod (`bgcvurheqzylyfehqgzh`). Every SKU id, vendor id and pack chain below was
resolved live at run time, not read from a report.

---

## The four things worth your minute

Wave 2 writes very little on purpose. The harvest's own §5 is the reason: Angel's
measured weight and our pack chain disagree on 18 of 81 parseable rows, and the
harvest's instruction is to **defer to neither blindly** — the disagreement is the
signal. So a measured weight is a second opinion here, not a licence to fill. Most of
the value below is in the questions, not the two prices.

1. **Is our `flat` of Sub Roll really 30 rolls?** The whole §1 price hangs on it. Our
   pack chain says `flat → 5 Packs → 6 Sub roll`, and Angel sells a 12-count. If a
   flat is not 30 rolls, $19.68 is wrong by exactly that ratio.
2. **Is our Boar's Head `Case of 2` the same case Delmar ships?** (§2 decision table.)
   We know what Delmar's case weighs; we do not know what our pack is. Answering this
   once unlocks 7 SKUs including OvenGold turkey — the single biggest line in the
   dataset — and fills in their missing pack chains at the same time.
3. **Four wave-1 prices are now in question** (§3 conflicts). Angel's measured weight
   contradicts the pack string wave 1 divided by. Two of them (Oregano, Onion Powder)
   have a divisor in doubt, so the PRICE is suspect; two (Garlic, Parsley) have the
   right price but an understated pack weight, so their cost-per-OUNCE is ~20–40% high.
4. **The Basil tie-break from wave 1 is answered** (§3). The $10.34 option was never a
   real per-pound price — Angel fabricated its weight. Wave 1's "exact match to the
   2024 sheet" was a coincidence between two case prices.

## Section 1 — Sub Roll → Cardinal Bakery

```
Vendor      : Cardinal Bakery  (id 2bc50ff3-a50a-4506-a7d2-882ad8f76dd9, active=true) — VERIFIED LIVE
Our SKU     : Sub Roll  (id 9478c3e2-868e-444f-95f4-009a7b3b507b) — VERIFIED LIVE
  current vendor_id : NULL (vendorless)
  pack chain        : flat → 5 Packs → 6 Sub roll → 4 oz
  → one flat = 120 oz = 30 × Sub roll
Angel row   : Large Hero Hearth [Cardinal Bakery] pack "12 ct" @ $7.87
  observed Aug 13, 2026; 20 × $7.87 = $157.40
  Angel shows NO $/lb for this row (Cardinal's feed sends no weight, and Angel
  correctly prints "—" rather than fabricating 1.0 lb). The relation is COUNT-only.
```

```
Arithmetic  :
  $7.87 ÷ 12 rolls = $0.6558/roll × 30 rolls per flat = $19.68
  exact = 1967.5 cents → rounded half-up to cents

Cross-check :
  2024 costing sheet: "Sub Roll, Cardinal, $0.70, 1, ea" — an INDEPENDENT source,
  hand-collected two years earlier, naming the same vendor. Our derived $0.6558/roll
  is -6.3% against it. Same order, same vendor — strong corroboration.
```

── the vendor binding (the only vendor_items write in this script) ──
| our SKU | current vendor | → new vendor | evidence |
|---|---|---|---|
| Sub Roll | NULL | Cardinal Bakery (2bc50ff3-a50a-4506-a7d2-882ad8f76dd9) | Juan-confirmed + 2024 costing sheet + Angel Aug-13 invoice line |

## Section 2 — Delmar / Boar's Head catch-weight pricing

Angel prices these per POUND against a VARIABLE case weight, so $/lb is the stable
term and the case price is noise. Every fill below is $/lb × OUR pack's weight.
Our pack weight comes from the live pack chain; where the chain cannot say what one
pack weighs, the row is REFUSED rather than related to a pack we cannot measure.

── WOULD WRITE ──
| our SKU | Angel product | $/lb | our pack | unit price | check |
|---|---|---:|---:|---:|---|
| Bacon | `IMP LAYER BACON 12/14` | $4.69/lb | 15 lb | **$70.35** | agree 1.000× · DIRECT |

── DECISION TABLE: measured case weight, but OUR pack cannot be measured ──
Angel knows what its case weighs; our SKU has no pack chain and no `each_size`, so
there is nothing to multiply. These are NOT refusals to be re-run — they are one
question each. If our `Case of N` is the same physical case Delmar ships, the
implied per-unit weight in the last column is the answer, and it also fills in the
SKU's missing pack chain.

| our SKU | Angel product | $/lb | Angel case wt | our pack says | if same case → implied |
|---|---|---:|---:|---|---:|
| Turkey | `OVENGOLD TURKEY` | $6.29/lb | 9.23 lb | Case of 2 | **4.61 lb** each → $58.05/case |
| Roast Beef | `LONDON BROIL` | $8.69/lb | 6.87 lb | Case of 2 | **3.43 lb** each → $59.69/case |
| Provolone | `MILD PROVOLONE` | $3.49/lb | 5.51 lb | Case of 6 | **0.92 lb** each → $19.21/case |
| Genoa | `DILANDRI GENOA SALAME` | $4.39/lb | 6.42 lb | Case of 6 | **1.07 lb** each → $28.16/case |
| Capicola | `HOT BUTT CAPPY` | $5.45/lb | 3.59 lb | Case of 5 | **0.72 lb** each → $19.58/case |
| Ever Roast Chicken | `EVERROAST CHICKEN` | $5.99/lb | 4.65 lb | _(no pack data at all)_ | — |
| Pepperoni | `Pepperoni Slicing` | $5.19/lb | 3.49 lb | Case of 3 | **1.16 lb** each → $18.12/case |

## Section 3 — re-sweep of wave 1 against the measured weights

Wave 1's divisors came from Angel's PACK STRING. The harvest supplies an independent
MEASURED weight for the same rows. Where they agree, wave 1 is corroborated; where
they disagree by >15%, neither side wins automatically and the row becomes a question.

The distinction that matters, and it is easy to get backwards:
  · PACK-AGREES rows (divisor 1) — our pack IS one whole Angel case, so we pay the
    case price for it. A weight disagreement does NOT move the price by a penny; what
    is wrong is our SKU's recorded pack WEIGHT, and so every derived cost-PER-OUNCE.
  · CASE-MULTIPLE rows (divisor N>1) — the divisor N came from the same pack string
    the weight just contradicted, so the DIVISOR is in doubt, and the price with it.

Wave 1's `--execute` has already run: 15 of its price rows are LIVE in
prod under `source = 'angel-catalog-2026-08'` (read live by this script, not assumed). So a
conflict below is not a veto on a pending write — it is a number already feeding plate
costs today that the harvest says to look at again.

── CONFLICTS: 7 rows (wave 2 writes none of them; question for Juan) ──
| our SKU | Angel row | w1 ÷ | pack-string oz | measured oz | ratio | wave-1 price | impact |
|---|---|---:|---:|---:|---:|---:|---|
| Garlic | `GARLIC WHL PLD DOM` [PEAK FRS] | ÷1 | 80 oz | 96.0 oz | 1.200× | **LIVE $19.72** | pack weight only |
| Parsley | `PARSLEY FRSH FLAT ITAL` [PEAK FRS] | ÷1 | 16 oz | 22.4 oz | 1.400× | **LIVE $15.20** | pack weight only |
| Basil | `BASIL FRSH` [PEAK FRS] | ÷1 | 16 oz | 23.2 oz | 1.450× | no | pack weight only |
| Thyme | `THYME FRSH` [PEAK FRS] | ÷1 | 4 oz | 7.5 oz | 1.880× | no | pack weight only |
| Chives | `CHIVES FRSH` [PEAK FRS] | ÷2 | 8 oz | 13.0 oz | 1.620× | no | **PRICE IN DOUBT** |
| Oregano | `OREGANO LEAVES` [ROMA] | ÷4 | 80 oz | 96.0 oz | 1.200× | **LIVE $13.82** | **PRICE IN DOUBT** |
| Onion Powder | `ONION PWDR` [ROMA] | ÷5 | 80 oz | 96.0 oz | 1.200× | **LIVE $6.65** | **PRICE IN DOUBT** |

── CORROBORATED: 21 wave-1 rows whose measured weight AGREES ──
| our SKU | Angel row | w1 ÷ | pack-string oz | measured oz | ratio | wave-1 price | impact |
|---|---|---:|---:|---:|---:|---:|---|
| Ground Beef | `BEEF GRND BULK 80/20` [WEST CRK] | ÷1 | 160 oz | 172.6 oz | 1.079× | **LIVE $49.20** | — |
| Heavy Cream | `CREAM HVY WHIPPING 40% TFF` [NTRSBST] | ÷1 | 384 oz | 441.0 oz | 1.148× | no | — |
| Heavy Cream | `CREAM HVY 36% TFF` [NTRSBST] | ÷1 | 384 oz | 430.1 oz | 1.120× | no | — |
| Sour Cream | `SOUR CREAM REAL` [DAISY] | ÷1 | 80 oz | 88.0 oz | 1.100× | **LIVE $8.10** | — |
| Ricotta | `Cheese, Ricotta Impastata Whole Milk Tub Ref Del Pastaio` [Grande Cheese Company] | ÷1 | 160 oz | 159.9 oz | 0.999× | no | — |
| Honey | `HONEY AMBER EXTRA LIGHT` [WEST CRK] | ÷1 | 80 oz | 84.9 oz | 1.061× | **LIVE $17.77** | — |
| Ham | `HAM 35% WATER FC 4X6 TFF` [ROMA] | ÷13 | 208 oz | 208.0 oz | 1.000× | **LIVE $2.77** | — |
| Ground Pork | `PORK GRND 80/20 ALL NAT FZ` [WEST CRK] | ÷2 | 160 oz | 170.9 oz | 1.068× | **LIVE $11.95** | — |
| Shredded Mozz | `CHEESE MOZZ LMWM SHRED` [GPREMIO] | ÷6 | 480 oz | 500.5 oz | 1.043× | **LIVE $14.19** | — |
| Tuna | `TUNA CHNK LIGHT CHN` [WRLDDCK] | ÷6 | 399 oz | 456.6 oz | 1.144× | **LIVE $11.99** | — |
| Cheddar | `CHEESE CHED SHARP WHI BLOCK TF` [LOL] | ÷10 | 160 oz | 160.4 oz | 1.002× | no | — |
| Salt | `SALT KSHR COARSE` [DMND CRY] | ÷9 | 432 oz | 444.8 oz | 1.030× | **LIVE $6.98** | — |
| Butter | `BUTTER SOLID UNSLTD` [SLVR SRC] | ÷36 | 576 oz | 600.4 oz | 1.042× | **LIVE $2.25** | — |
| Shredded Mozz | `CHEESE MOZZ PROV 50/50 SHRED` [GALBANI] | ÷6 | 480 oz | 500.4 oz | 1.043× | no | — |
| Ricotta | `CHEESE RICOTTA IMPASTATA WM` [ROMA] | ÷2 | 320 oz | 335.7 oz | 1.049× | **LIVE $34.10** | — |
| Cheddar | `CHEESE CHED WHI MED LOAF` [TILLAMK] | ÷10 | 160 oz | 176.1 oz | 1.101× | no | — |
| Tuna | `Tuna, Light Skipjack Chunk In Water Can Shelf Stable Imported` [Harvest Value] | ÷6 | 399 oz | 398.6 oz | 0.999× | no | — |
| Tomatoes | `Tomato, Round 4x5 #1 Grade Fresh Ref 2 Layer Box` [Cross Valley Farms] | ÷2 | 320 oz | 319.8 oz | 0.999× | no | — |
| Cheddar | `Cheese, Cheddar White Sharp Print Vacuum-Pack Ref` [Glenview Farms] | ÷10 | 160 oz | 167.4 oz | 1.046× | no | — |
| Garlic | `Garlic, White Whole Clove Peeled Fresh Ref` [Cross Valley Farms] | ÷4 | 320 oz | 320.3 oz | 1.001× | no | — |
| Sour Cream | `Sour Cream, Cultured All Natural Rbst Free Tub Ref` [Glenview Farms] | ÷4 | 320 oz | 320.8 oz | 1.002× | no | — |

  ⚠ 4 of those clear the 15% bar only narrowly (>10% apart). They are
  passing a threshold, not matching. The harvest explains the cluster: on a packaged
  LIQUID, Angel's "net weight" includes carton and bottle tare, so it reads 10–20%
  heavy and any $/lb on it is a $/lb-OF-PACKAGE. That does not touch these prices —
  cream and tuna relate to our pack by VOLUME and COUNT, not weight — but it does mean
  the measured weight is not independent evidence for them either way:
    · Heavy Cream ← `CREAM HVY WHIPPING 40% TFF` — 1.148× (÷1, not filled)
    · Heavy Cream ← `CREAM HVY 36% TFF` — 1.120× (÷1, not filled)
    · Tuna ← `TUNA CHNK LIGHT CHN` — 1.144× (÷6, wave-1 fill)
    · Cheddar ← `CHEESE CHED WHI MED LOAF` — 1.101× (÷10, not filled)

── EXCLUDED BY RULE: 2 assumed-weight + 0 no-measured-weight ──
  · Basil ← `BASIL FRSH` [FRSH ADV] — weight_source = assumed_default_1lb (the basil trap)
  · Basil ← `Basil, Fresh Herb` [Cross Valley Farms] — weight_source = assumed_default_1lb (the basil trap)

── the chive shaker, excluded by name ──
  `Spice, Chive Chopped Plastic Shaker Shelf Stable Seasoning` (US Foods) — Angel reports $138.86/lb.
  Angel recorded ONE 1.12-oz shaker's weight as the whole 6-pack case's: the ratio is
  exactly 1/6, so its $/lb is 6× high. True cost is $9.72 ÷ 0.42 lb = $23.14/lb, which
  lands in line with the other dried spices. NOT WRITTEN — the Angel record is corrupt,
  and the corrected figure is recorded here for Juan rather than propagated as data.

── wave-1 refusals the harvest does NOT change ──
  14 rows: Wave 1 refused this row for a reason the harvest does not touch (US Foods historical lane, unresolved product identity, or a duplicate cluster needing Juan's pick). The new weight data changes nothing about it.
    · AMBIGUOUS_PRODUCT_IDENTITY: 1
    · US_FOODS_HISTORICAL: 7
    · DUPLICATE_CLUSTER: 6

  One of them IS resolved in substance, even though it still needs Juan's word:
  the Basil duplicate cluster. Wave 1 could not choose between `BASIL FRSH` [FRSH ADV]
  at $10.34 and [PEAK FRS] at $19.55, and noted that $10.34 matched the 2024 sheet
  exactly. The harvest shows FRSH ADV's weight is the FABRICATED 1.0 lb while Peak
  Fresh's 1.4505 lb is measured — so the $10.34/lb was never a real per-pound price,
  and the exact match to the 2024 sheet is a coincidence between two numbers that are
  both case prices. Neither row may be written; the cluster is now a documented
  question rather than a coin flip.

## Section 4 — price movement (report only, no writes)

48 of 159 products changed price per pound across the capture
window (Jul 10 – Aug 14, 2026 — about five weeks, NOT a year; read these as recent
movement, not an annual trend). Rows whose weight is assumed or unknown are excluded:
their "$/lb" is a case price in disguise, so movement in it is not a per-pound signal.

For a catch-weight product the $/lb is the contract term and the case price wobbles
with the actual weight — so $/lb is the only honest lens here.

| spend | product | vendor | $/lb low → high | move |
|---:|---|---|---:|---:|
| $4096.32 | `OIL OLIVE 100% EXTRA VIRGIN` | PFG | $4.63 → $4.69 | **+1.3%** |
| $2675.85 | `HAM 35% WATER FC 4X6 TFF` | PFG | $2.76 → $2.81 | **+1.8%** |
| $1937.92 | `LETTUCE ICEBERG LINER` | PFG | $0.72 → $0.79 | **+9.7%** |
| $1445.80 | `ARUGULA BABY` | PFG | $3.63 → $4.47 | **+23.1%** |
| $1269.94 | `BAG PAPER KRAFT SHOPPER BISTRO` | PFG | $2.26 → $2.44 | **+8.0%** |
| $1050.15 | `Lettuce, Iceberg Cleaned & Trimmed Fresh Ref` | US Foods | $1.27 → $2.16 | **+70.1%** |
| $864.98 | `TOMATO 5X6` | PFG | $1.30 → $1.39 | **+6.9%** |
| $801.09 | `Bag, Shopping 10x6.75x12 Paper Kraft Brown W/ Handle Carry-Out` | US Foods | $2.26 → $2.78 | **+23.0%** |
| $720.28 | `ONION YLW COLOSSAL BAG` | PFG | $0.64 → $0.71 | **+10.9%** |
| $584.33 | `Mayonnaise, Heavy Plastic Shelf Stable` | US Foods | $2.66 → $2.83 | **+6.4%** |
| $529.58 | `PORK GRND 80/20 ALL NAT FZ` | PFG | $2.24 → $2.56 | **+14.3%** |
| $498.18 | `CHEESE MOZZ LMWM SHRED` | PFG | $2.57 → $2.77 | **+7.8%** |
| $400.47 | `GARLIC WHL PLD DOM` | PFG | $3.11 → $3.29 | **+5.8%** |
| $378.70 | `CHEESE CHED SHARP WHI BLOCK TF` | PFG | $3.33 → $3.54 | **+6.3%** |
| $355.43 | `Glove, Latex Medium Powder-Free Natural Imported Thailand Ambidextrous` | US Foods | $5.51 → $7.17 | **+30.1%** |
| $355.30 | `TOMATO CRUSHED EXTRA HVY PUREE` | PFG | $0.70 → $0.80 | **+14.3%** |
| $345.90 | `BAG PAPER SHOPPER REGAL` | PFG | $2.22 → $2.30 | **+3.6%** |
| $322.06 | `Pepperoni Slicing` | Delmar Provisions | $5.09 → $5.19 | **+2.0%** |
| $275.21 | `Glove, Latex Large Powder-Free Natural Imported Thailand Ambidextrous` | US Foods | $6.11 → $7.94 | **+30.0%** |
| $250.34 | `WATER SPRKLNG SPRING GLASS` | PFG | $0.72 → $0.75 | **+4.2%** |
| $234.85 | `CHEESE MOZZ PROV 50/50 SHRED` | PFG | $2.38 → $2.61 | **+9.7%** |
| $232.08 | `CREAM HVY WHIPPING 40% TFF` | PFG | $1.68 → $1.69 | **+0.6%** |
| $222.86 | `CUCUMBER EURO SDLS` | PFG | $3.40 → $4.18 | **+22.9%** |
| $212.92 | `Ham, Cooked Rectangle 4x6 Hwp 39% Ref 1-Diamond Pork` | US Foods | $2.67 → $2.78 | **+4.1%** |
| $209.22 | `EGG HRD CKD PLD DRY PACK` | PFG | $2.12 → $2.50 | **+17.9%** |
| $187.16 | `CHICKEN BRST RAND B/F B/S HALA` | PFG | $1.54 → $1.59 | **+3.2%** |
| $178.77 | `CREAM HVY 36% TFF` | PFG | $1.66 → $1.67 | **+0.6%** |
| $171.47 | `BUTTER SOLID UNSLTD` | PFG | $2.16 → $2.41 | **+11.6%** |
| $171.18 | `Ham, Cooked Hwp 35% Ref Pork` | US Foods | $3.18 → $3.40 | **+6.9%** |
| $170.40 | `Tomato, Crushed Pear Canned` | US Foods | $1.07 → $1.09 | **+1.9%** |
| $156.58 | `PEPPER BLK WHL` | PFG | $8.42 → $8.75 | **+3.9%** |
| $138.25 | `BASIL FRSH` | PFG | $13.48 → $13.97 | **+3.6%** |
| $134.28 | `MUSTARD DIJON` | PFG | $1.91 → $2.01 | **+5.2%** |
| $127.94 | `CAN LINER 45 GA XHW BLK 40X46` | PFG | $2.61 → $3.04 | **+16.5%** |
| $127.51 | `SHELL CANNOLI SM` | PFG | $10.61 → $10.67 | **+0.6%** |
| $115.68 | `Onion, Yellow Jumbo 3"+ Fresh Ref Bag` | US Foods | $0.64 → $0.85 | **+32.8%** |
| $96.34 | `SOUR CREAM REAL` | PFG | $1.27 → $1.47 | **+15.7%** |
| $81.84 | `BREAD CRUMBS TOASTED PANKO` | PFG | $1.06 → $1.08 | **+1.9%** |
| $70.97 | `Water, Sparkling Glass Bottle Blue Carbonated Seltzer` | US Foods | $1.95 → $1.99 | **+2.1%** |
| $68.40 | `WATER PURIFIED DRINKING` | PFG | $0.15 → $0.16 | **+6.7%** |
| $62.76 | `Tomato, Round 4x5 #1 Grade Fresh Ref 2 Layer Box` | US Foods | $1.50 → $1.64 | **+9.3%** |
| $60.33 | `ONION YLW JUMBO` | PFG | $0.57 → $0.61 | **+7.0%** |
| $55.32 | `Radish, Fresh Ref` | US Foods | $2.86 → $2.93 | **+2.4%** |
| $54.98 | `Wrap, 12x10.75 Wax Paper White Interfold` | US Foods | $2.97 → $3.40 | **+14.5%** |
| $50.68 | `Water, Purified Plastic Bottle Twist Cap Shelf Stable` | US Foods | $0.30 → $0.34 | **+13.3%** |
| $45.54 | `Celery, Stalk Fresh Ref Box` | US Foods | $3.14 → $3.37 | **+7.3%** |
| $35.26 | `Water, Spring Plastic Bottle Special Print` | US Foods | $0.20 → $0.24 | **+20.0%** |
| $28.29 | `BASE BEEF NO MSG JAR` | PFG | $1.27 → $1.40 | **+10.2%** |

Biggest movers by percentage (the same list re-sorted — these are where the money is
actually moving, as distinct from where the money is):
  · Lettuce, Iceberg Cleaned & Trimmed Fresh Ref — +70.1% ($1.27 → $2.16/lb, $1050.15 spend)
  · Onion, Yellow Jumbo 3"+ Fresh Ref Bag — +32.8% ($0.64 → $0.85/lb, $115.68 spend)
  · Glove, Latex Medium Powder-Free Natural Imported Thailand Ambidextrous — +30.1% ($5.51 → $7.17/lb, $355.43 spend)
  · Glove, Latex Large Powder-Free Natural Imported Thailand Ambidextrous — +30.0% ($6.11 → $7.94/lb, $275.21 spend)
  · ARUGULA BABY — +23.1% ($3.63 → $4.47/lb, $1445.80 spend)

## Section 5 — the remaining vendorless SKUs (report only, no writes)

11 active global SKUs carry no vendor. Section 1 binds Sub Roll, leaving 10.
Nothing below is written — this is a decision table. Where the evidence is thin the
row says so; a labelled "none" is more useful than a confident guess.

| our SKU | best-guess vendor | confidence | evidence |
|---|---|---|---|
| Beef Base | PFG | HIGH | Angel carries `BASE BEEF NO MSG JAR` (PFG, 1/1 LB, $9.72). Note the pack string is wrong — measured 6.97 lb, i.e. it is a 6-pack, not one jar. |
| Dried Chives | Baldor (or PFG) | LOW | 2024 sheet: "Dried Chives, b, $3.95 / 2 oz" (b = Baldor). Angel's only dried-chive row is the US Foods shaker — the corrupt 1/6 record. PFG's `CHIVES FRSH` is a different (fresh) product. |
| Lemon Oil | — none | NONE | Appears in the sandwich build sheet (0.1 oz) but in no order guide, no 2024 sheet row, and no Angel row. Floor question. |
| Mixed Herbs | — none (likely house blend) | NONE | No purchase evidence anywhere. avg_oz_per_each = 4 was flagged "very unsure" in the weigh checklist. May be a house mix rather than a purchased SKU. |
| Mortadella | Boar's Head / Delmar | HIGH | 2024 sheet: "Mortadella, BH, $4.29 / 16 oz". BH = the Boar's Head lane. Absent from Angel's 5-week window, so we buy it rarely — not that we don't buy it. |
| Pepperoncini | Boar's Head / Delmar | MEDIUM | No direct row. The whole jarred-pepper family (hot cherry, sweet, banana) sits on the Delmar/BH lane, and pepperoncini is on the Chicken Parm build. |
| Utz Ripples | Country Snacks | MEDIUM | `Country Snacks` is registered with ZERO SKUs and is the only snack-shaped vendor on the books. 2024 sheet has "Utz Chips $3.60 / 7.75 oz" with no vendor. Inference from vendor purpose, not from a document. |
| Vanilla Bean Paste | — none | NONE | 2024 sheet: "$54.80 / 32 oz", vendor blank. Not in Angel. Amazon is plausible (it carries the sundries lane) but nothing supports it. |
| White Wine | — none | NONE | No row in any guide, sheet or export. Alcohol is very likely a separate purchasing lane we have never modelled. |
| Worcestershire | Baldor | MEDIUM | 2024 sheet: "Worcestershire, b, $31.79 / 128 oz" (b = Baldor). Baldor is a legacy lane (6 active SKUs) so this may want re-sourcing to PFG rather than binding to Baldor. |

## Summary

|  |  |
|---|---:|
| rollup products parsed | 159 |
| **would write — section 1 (Sub Roll)** | **1** price + 1 vendor binding |
| **would write — section 2 (Boar's Head)** | **1** |
| **would write — section 3 (re-sweep)** | **0** |
| would write — TOTAL price rows | 2 |
| refused (with reason) | 7 |
| conflicts for Juan (section 3) | 7 |
| wave-1 rows corroborated | 21 |
| price-movement rows (report only) | 48 |
| vendorless decision rows (report only) | 10 |
| `source` stamped on every written row | `angel-harvest-2026-08-20` |
| `effective_date` | per-product `last_seen` from the harvest |

── REFUSALS: 7 ──

**OUR_PACK_UNRESOLVABLE** — 7 row(s)

> Our own SKU cannot say what one pack weighs: no pack chain, and the flat columns carry no each_size/each_measure. Angel's case weight cannot be related to a pack we cannot measure.

- **Turkey** ← `OVENGOLD TURKEY`: no pack chain, and the flat columns are missing each_size, each_measure
- **Roast Beef** ← `LONDON BROIL`: no pack chain, and the flat columns are missing each_size, each_measure
- **Provolone** ← `MILD PROVOLONE`: no pack chain, and the flat columns are missing each_size, each_measure
- **Genoa** ← `DILANDRI GENOA SALAME`: no pack chain, and the flat columns are missing each_size, each_measure
- **Capicola** ← `HOT BUTT CAPPY`: no pack chain, and the flat columns are missing each_size, each_measure
- **Ever Roast Chicken** ← `EVERROAST CHICKEN`: no pack chain, and the flat columns are missing units_per_pack, each_size, each_measure
- **Pepperoni** ← `Pepperoni Slicing`: no pack chain, and the flat columns are missing each_size, each_measure

NOTHING WAS WRITTEN. Re-run with --execute once Juan has signed off on the tables above.
Seed 19 done (dry run).
