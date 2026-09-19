# Receipts vendor-export diff — 2026-09-18

Generated offline from CC photo transcriptions. All receipts belong to P Street per source notes; account IDs remain source-specific. One observation per printed line, including repeated items on different receipts. Receipt date is purchase evidence, not current price entitlement. Baldor 2026-07-01 is old pricing. Freight, tax and surcharges are not silently allocated into item prices.

Summary: 31 lines; 10 receipts; 8 vendors. Catalog identity/price/pack fields are absent in the supplied readiness snapshot; all name matches are hypotheses.

## Input inventory

| File | Observations | SHA-256 | Evidence |
| --- | --- | --- | --- |
| docs/seed/source/vendor-exports/receipts/receipts-2026-09-18-batch1.json | 12 | f59500da64f87afac0a522321cfa53ecd60bbf8b8bfe77eee971c1e3d538fe26 | [receipts-2026-09-18-batch1.json:16](../receipts/receipts-2026-09-18-batch1.json#L16) |
| docs/seed/source/vendor-exports/receipts/receipts-2026-09-18-batch2.json | 19 | a7d599059e31b3ed0598bb8c27e7bc32b316f1827a91af1c3f6f49c8ab3aad90 | [receipts-2026-09-18-batch2.json:14](../receipts/receipts-2026-09-18-batch2.json#L14) |


## A. Guide gaps

Receipts are partial dated deliveries, not complete order guides; an unbought line is not a missing SKU. The laminate still defines order [order-guide-2026-09-13.json:1](../../order-guide-2026-09-13.json#L1). Boar's Head Version A pack notes are evidence about pieces/case, never fixed catch weight [boars-head-order-guide-vA.md:13](../../boars-head-order-guide-vA.md#L13).

| Boar's Head laminate line absent from these receipts | Interpretation | Evidence |
| --- | --- | --- |
| Prosciutto | No purchase observation in this batch; not proof of inactivity | [order-guide-2026-09-13.json:118](../../order-guide-2026-09-13.json#L118) |
| Provolone | No purchase observation in this batch; not proof of inactivity | [order-guide-2026-09-13.json:121](../../order-guide-2026-09-13.json#L121) |
| Ever Roast Chicken | No purchase observation in this batch; not proof of inactivity | [order-guide-2026-09-13.json:123](../../order-guide-2026-09-13.json#L123) |
| Pickle slices | No purchase observation in this batch; not proof of inactivity | [order-guide-2026-09-13.json:124](../../order-guide-2026-09-13.json#L124) |


## B. Bought-but-unknown candidates

### Baldor

| Item | Description | Purchase | Catalog name candidates | Evidence |
| --- | --- | --- | --- | --- |
| A3 | ARUGULA BABY 4 LB | 2026-07-01: 2 CTN | None; candidate gap only | [receipts-2026-09-18-batch1.json:59](../receipts/receipts-2026-09-18-batch1.json#L59) |
| PAMILKRB1 | BUTTERMILK WHOLE 1 QT | 2026-07-01: 2 EACH | None; candidate gap only | [receipts-2026-09-18-batch1.json:68](../receipts/receipts-2026-09-18-batch1.json#L68) |
| D | DILL 4 OZ | 2026-07-01: 2 EACH | None; candidate gap only | [receipts-2026-09-18-batch1.json:77](../receipts/receipts-2026-09-18-batch1.json#L77) |
| RA1A | RADISH CELLO 6 OZ EACH | 2026-07-01: 3 EACH | None; candidate gap only | [receipts-2026-09-18-batch1.json:86](../receipts/receipts-2026-09-18-batch1.json#L86) |
| ICE1 | ICEBERG CELLO 24 CT | 2026-07-01: 2 CTN | None; candidate gap only | [receipts-2026-09-18-batch1.json:95](../receipts/receipts-2026-09-18-batch1.json#L95) |


### Berger

| Item | Description | Purchase | Catalog name candidates | Evidence |
| --- | --- | --- | --- | --- |
| 1001 | CHOCOLATE CREME | 2026-09-09: 24 EA | None; candidate gap only | [receipts-2026-09-18-batch1.json:169](../receipts/receipts-2026-09-18-batch1.json#L169) |
| 1010 | Snackpacks | 2026-09-09: 100 EA | None; candidate gap only | [receipts-2026-09-18-batch1.json:177](../receipts/receipts-2026-09-18-batch1.json#L177) |


### Boar's Head

| Item | Description | Purchase | Catalog name candidates | Evidence |
| --- | --- | --- | --- | --- |
| 546 | IMP LAYER BACON 12/14 | 2026-09-16: 1 PIECE | Bacon [readiness-list-prod-2026-09-16.json:985](../context/readiness-list-prod-2026-09-16.json#L985) | [receipts-2026-09-18-batch2.json:86](../receipts/receipts-2026-09-18-batch2.json#L86) |
| 137 | HOT BUTT CAPPY | 2026-09-16: 5 PIECE | Capicola [readiness-list-prod-2026-09-16.json:2024](../context/readiness-list-prod-2026-09-16.json#L2024) | [receipts-2026-09-18-batch2.json:95](../receipts/receipts-2026-09-18-batch2.json#L95) |
| 278 | OVENGOLD TURKEY | 2026-09-16: 4 PIECE | Turkey [readiness-list-prod-2026-09-16.json:9911](../context/readiness-list-prod-2026-09-16.json#L9911) | [receipts-2026-09-18-batch2.json:104](../receipts/receipts-2026-09-18-batch2.json#L104) |
| 505 | DILANDRI GENOA SALAME | 2026-09-16: 6 PIECE | Genoa [readiness-list-prod-2026-09-16.json:4174](../context/readiness-list-prod-2026-09-16.json#L4174) | [receipts-2026-09-18-batch2.json:113](../receipts/receipts-2026-09-18-batch2.json#L113) |
| 558 | Pepperoni Slicing | 2026-09-16: 3 PIECE | Pepperoni [readiness-list-prod-2026-09-16.json:7047](../context/readiness-list-prod-2026-09-16.json#L7047) | [receipts-2026-09-18-batch2.json:122](../receipts/receipts-2026-09-18-batch2.json#L122) |
| 30 | HOT CHERRY PEPPERS | 2026-09-16: 4 EA | Hot Peppers [readiness-list-prod-2026-09-16.json:5124](../context/readiness-list-prod-2026-09-16.json#L5124) | [receipts-2026-09-18-batch2.json:131](../receipts/receipts-2026-09-18-batch2.json#L131) |
| 795 | 5 GALLON GARLIC PICKLES | 2026-09-16: 1 EA | Whole pickles [readiness-list-prod-2026-09-16.json:10556](../context/readiness-list-prod-2026-09-16.json#L10556) | [receipts-2026-09-18-batch2.json:139](../receipts/receipts-2026-09-18-batch2.json#L139) |
| 12011 | LONDON BROIL | 2026-09-15: 4 PIECE | Roast Beef [readiness-list-prod-2026-09-16.json:8403](../context/readiness-list-prod-2026-09-16.json#L8403) | [receipts-2026-09-18-batch2.json:157](../receipts/receipts-2026-09-18-batch2.json#L157) |
| 278 | OVENGOLD TURKEY | 2026-09-15: 8 PIECE | Turkey [readiness-list-prod-2026-09-16.json:9911](../context/readiness-list-prod-2026-09-16.json#L9911) | [receipts-2026-09-18-batch2.json:166](../receipts/receipts-2026-09-18-batch2.json#L166) |
| 75 | COKE | 2026-09-15: 1 EA (case) | Coke [readiness-list-prod-2026-09-16.json:2516](../context/readiness-list-prod-2026-09-16.json#L2516) | [receipts-2026-09-18-batch2.json:175](../receipts/receipts-2026-09-18-batch2.json#L175) |
| 76 | DIET COKE | 2026-09-15: 1 EA (case) | Coke [readiness-list-prod-2026-09-16.json:2516](../context/readiness-list-prod-2026-09-16.json#L2516); Diet Coke [readiness-list-prod-2026-09-16.json:2887](../context/readiness-list-prod-2026-09-16.json#L2887) | [receipts-2026-09-18-batch2.json:183](../receipts/receipts-2026-09-18-batch2.json#L183) |
| 84 | CREAM DR. BROWNS | 2026-09-15: 1 EA (case) | None; candidate gap only | [receipts-2026-09-18-batch2.json:191](../receipts/receipts-2026-09-18-batch2.json#L191) |
| 85 | DIET CREAM DR. BROWNS | 2026-09-15: 1 EA (case) | None; candidate gap only | [receipts-2026-09-18-batch2.json:199](../receipts/receipts-2026-09-18-batch2.json#L199) |
| DM101 | Compliments Branded Water | 2026-09-15: 1 EA (case) | Branded (C/O) Water [readiness-list-prod-2026-09-16.json:1464](../context/readiness-list-prod-2026-09-16.json#L1464) | [receipts-2026-09-18-batch2.json:207](../receipts/receipts-2026-09-18-batch2.json#L207) |
| 30 | HOT CHERRY PEPPERS | 2026-09-15: 4 EA | Hot Peppers [readiness-list-prod-2026-09-16.json:5124](../context/readiness-list-prod-2026-09-16.json#L5124) | [receipts-2026-09-18-batch2.json:215](../receipts/receipts-2026-09-18-batch2.json#L215) |


### Cardinal Bakery

| Item | Description | Purchase | Catalog name candidates | Evidence |
| --- | --- | --- | --- | --- |
| 1030 | LARGE HERO HEARTH | 2026-09-12: 84 DZ | Sub Roll [readiness-list-prod-2026-09-16.json:9346](../context/readiness-list-prod-2026-09-16.json#L9346) | [receipts-2026-09-18-batch2.json:37](../receipts/receipts-2026-09-18-batch2.json#L37) |
| 3290 | SPECIALTY FOOTER - NUMBERS | 2026-09-12: 2 EA | None; candidate gap only | [receipts-2026-09-18-batch2.json:45](../receipts/receipts-2026-09-18-batch2.json#L45) |
| 1030 | LARGE HERO HEARTH | 2026-09-07: 80 DZ | Sub Roll [readiness-list-prod-2026-09-16.json:9346](../context/readiness-list-prod-2026-09-16.json#L9346) | [receipts-2026-09-18-batch2.json:65](../receipts/receipts-2026-09-18-batch2.json#L65) |


### Country Snacks

| Item | Description | Purchase | Catalog name candidates | Evidence |
| --- | --- | --- | --- | --- |
| not printed | Utz single-serve potato chip bags, mixed flavors (the '/14' on the carbon = 14 bags per case) | 2026-09-08: 23 CASE (14 bags) | None; candidate gap only | [receipts-2026-09-18-batch2.json:14](../receipts/receipts-2026-09-18-batch2.json#L14) |


### Thompson Delivers

| Item | Description | Purchase | Catalog name candidates | Evidence |
| --- | --- | --- | --- | --- |
| 27149 | 12.5 oz Utz Rip Chip | 2026-09-17: 108 EA (bag) | None; candidate gap only | [receipts-2026-09-18-batch1.json:16](../receipts/receipts-2026-09-18-batch1.json#L16) |
| 00602 | 60 oz Utz Club Pk Reg Chip | 2026-09-17: 2 EA (bag) | None; candidate gap only | [receipts-2026-09-18-batch1.json:26](../receipts/receipts-2026-09-18-batch1.json#L26) |


### TriMark

| Item | Description | Purchase | Catalog name candidates | Evidence |
| --- | --- | --- | --- | --- |
| 20970 | DISPENSER PRO TRANSPARENT BLACK/CHROME 1L 1ea | 2026-09-16: 4 EACH | None; candidate gap only | [receipts-2026-09-18-batch1.json:139](../receipts/receipts-2026-09-18-batch1.json#L139) |
| 95967 | PAPER BUTCHER WHITE 40# 18x24" 1000/BUNDLE | 2026-09-16: 5 BNDL (1000 sheets) | Butcher Paper [readiness-list-prod-2026-09-16.json:1645](../context/readiness-list-prod-2026-09-16.json#L1645) | [receipts-2026-09-18-batch1.json:148](../receipts/receipts-2026-09-18-batch1.json#L148) |


### Whisked

| Item | Description | Purchase | Catalog name candidates | Evidence |
| --- | --- | --- | --- | --- |
| not printed | Cookie, Individually Packaged, Chocolate Chip - Case of 54 | 2026-09-18: 1 case (54) | None; candidate gap only | [receipts-2026-09-18-batch1.json:118](../receipts/receipts-2026-09-18-batch1.json#L118) |


## C. Item-number / description families

Repeated receipt observations are not collapsed into one purchase. Country Snacks has no printed product number or flavor breakdown: one mixed-flavor purchase SKU, priced per case; do not create per-flavor purchase history. Thompson Delivers is a different Utz distributor and pack regime; a shared brand does not merge vendor identity.

## D. Receipt prices, unit conversions and catalog deltas

Catch-weight qty is printed pieces; invoice extension uses Net Wgt in pounds. Decimal cents are retained for /oz and per-roll comparisons. Catalog /oz, if supplied in dollars on an exact vendor/item identity, converts ×16 to dollars/lb; nominal pack weight never replaces measured weight. Name-only matches do not produce numeric deltas.

### Baldor

| Item / date | Billed unit rate | Net lb / printed qty | Comparable unit costs | Catalog comparison | Evidence |
| --- | --- | --- | --- | --- | --- |
| A3 / 2026-07-01 | $19.50 per case; printed $19.50 per case | n/a lb / 2 CTN | No unsupported unit conversion | unavailable; missing or ambiguous identity/basis | [receipts-2026-09-18-batch1.json:59](../receipts/receipts-2026-09-18-batch1.json#L59) |
| PAMILKRB1 / 2026-07-01 | $3.29 per each; printed $3.29 per each | n/a lb / 2 EACH | $3.29/each | unavailable; missing or ambiguous identity/basis | [receipts-2026-09-18-batch1.json:68](../receipts/receipts-2026-09-18-batch1.json#L68) |
| D / 2026-07-01 | $5.50 per each; printed $5.50 per each | n/a lb / 2 EACH | $5.50/each | unavailable; missing or ambiguous identity/basis | [receipts-2026-09-18-batch1.json:77](../receipts/receipts-2026-09-18-batch1.json#L77) |
| RA1A / 2026-07-01 | $1.50 per each; printed $1.50 per each | n/a lb / 3 EACH | $1.50/each | unavailable; missing or ambiguous identity/basis | [receipts-2026-09-18-batch1.json:86](../receipts/receipts-2026-09-18-batch1.json#L86) |
| ICE1 / 2026-07-01 | $72.75 per case; printed $72.75 per case | n/a lb / 2 CTN | No unsupported unit conversion | unavailable; missing or ambiguous identity/basis | [receipts-2026-09-18-batch1.json:95](../receipts/receipts-2026-09-18-batch1.json#L95) |


### Berger

| Item / date | Billed unit rate | Net lb / printed qty | Comparable unit costs | Catalog comparison | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1001 / 2026-09-09 | $8.79 per each; printed $8.79 per each | n/a lb / 24 EA | $8.79/each | unavailable; missing or ambiguous identity/basis | [receipts-2026-09-18-batch1.json:169](../receipts/receipts-2026-09-18-batch1.json#L169) |
| 1010 / 2026-09-09 | $2.25 per each; printed $2.25 per each | n/a lb / 100 EA | $2.25/each | unavailable; missing or ambiguous identity/basis | [receipts-2026-09-18-batch1.json:177](../receipts/receipts-2026-09-18-batch1.json#L177) |


### Boar's Head

| Item / date | Billed unit rate | Net lb / printed qty | Comparable unit costs | Catalog comparison | Evidence |
| --- | --- | --- | --- | --- | --- |
| 546 / 2026-09-16 | $4.69/lb; printed $4.69 per lb | 15 lb / 1 PIECE | $0.29313/oz; weight extension $70.35 | unavailable delta: identity unverified (name/family hypothesis only); [readiness-list-prod-2026-09-16.json:985](../context/readiness-list-prod-2026-09-16.json#L985) | [receipts-2026-09-18-batch2.json:86](../receipts/receipts-2026-09-18-batch2.json#L86) |
| 137 / 2026-09-16 | $5.45/lb; printed $5.45 per lb | 17.96 lb / 5 PIECE | $0.34063/oz; weight extension $97.88 | unavailable delta: identity unverified (name/family hypothesis only); [readiness-list-prod-2026-09-16.json:2024](../context/readiness-list-prod-2026-09-16.json#L2024) | [receipts-2026-09-18-batch2.json:95](../receipts/receipts-2026-09-18-batch2.json#L95) |
| 278 / 2026-09-16 | $6.29/lb; printed $6.29 per lb | 35.96 lb / 4 PIECE | $0.39313/oz; weight extension $226.19 | unavailable delta: identity unverified (name/family hypothesis only); [readiness-list-prod-2026-09-16.json:9911](../context/readiness-list-prod-2026-09-16.json#L9911) | [receipts-2026-09-18-batch2.json:104](../receipts/receipts-2026-09-18-batch2.json#L104) |
| 505 / 2026-09-16 | $4.39/lb; printed $4.39 per lb | 42.34 lb / 6 PIECE | $0.27437/oz; weight extension $185.87 | unavailable delta: identity unverified (name/family hypothesis only); [readiness-list-prod-2026-09-16.json:4174](../context/readiness-list-prod-2026-09-16.json#L4174) | [receipts-2026-09-18-batch2.json:113](../receipts/receipts-2026-09-18-batch2.json#L113) |
| 558 / 2026-09-16 | $4.99/lb; printed $4.99 per lb | 11.3 lb / 3 PIECE | $0.31188/oz; weight extension $56.39 | unavailable delta: identity unverified (name/family hypothesis only); [readiness-list-prod-2026-09-16.json:7047](../context/readiness-list-prod-2026-09-16.json#L7047) | [receipts-2026-09-18-batch2.json:122](../receipts/receipts-2026-09-18-batch2.json#L122) |
| 30 / 2026-09-16 | $8.95 per each; printed $8.95 per each | n/a lb / 4 EA | $8.95/each | unavailable delta: identity unverified (name/family hypothesis only); [readiness-list-prod-2026-09-16.json:5124](../context/readiness-list-prod-2026-09-16.json#L5124) | [receipts-2026-09-18-batch2.json:131](../receipts/receipts-2026-09-18-batch2.json#L131) |
| 795 / 2026-09-16 | $35.95 per each; printed $35.95 per each | n/a lb / 1 EA | $35.95/each | unavailable delta: identity unverified (name/family hypothesis only); [readiness-list-prod-2026-09-16.json:10556](../context/readiness-list-prod-2026-09-16.json#L10556) | [receipts-2026-09-18-batch2.json:139](../receipts/receipts-2026-09-18-batch2.json#L139) |
| 12011 / 2026-09-15 | $8.69/lb; printed $8.69 per lb | 25.91 lb / 4 PIECE | $0.54312/oz; weight extension $225.16 | unavailable delta: identity unverified (name/family hypothesis only); [readiness-list-prod-2026-09-16.json:8403](../context/readiness-list-prod-2026-09-16.json#L8403) | [receipts-2026-09-18-batch2.json:157](../receipts/receipts-2026-09-18-batch2.json#L157) |
| 278 / 2026-09-15 | $6.29/lb; printed $6.29 per lb | 73.8 lb / 8 PIECE | $0.39313/oz; weight extension $464.20 | unavailable delta: identity unverified (name/family hypothesis only); [readiness-list-prod-2026-09-16.json:9911](../context/readiness-list-prod-2026-09-16.json#L9911) | [receipts-2026-09-18-batch2.json:166](../receipts/receipts-2026-09-18-batch2.json#L166) |
| 75 / 2026-09-15 | $25.45 per case; printed $25.45 per case | n/a lb / 1 EA (case) | No unsupported unit conversion | unavailable delta: identity unverified (name/family hypothesis only); [readiness-list-prod-2026-09-16.json:2516](../context/readiness-list-prod-2026-09-16.json#L2516) | [receipts-2026-09-18-batch2.json:175](../receipts/receipts-2026-09-18-batch2.json#L175) |
| 76 / 2026-09-15 | $25.45 per case; printed $25.45 per case | n/a lb / 1 EA (case) | No unsupported unit conversion | unavailable; missing or ambiguous identity/basis | [receipts-2026-09-18-batch2.json:183](../receipts/receipts-2026-09-18-batch2.json#L183) |
| 84 / 2026-09-15 | $14.95 per case; printed $14.95 per case | n/a lb / 1 EA (case) | No unsupported unit conversion | unavailable; missing or ambiguous identity/basis | [receipts-2026-09-18-batch2.json:191](../receipts/receipts-2026-09-18-batch2.json#L191) |
| 85 / 2026-09-15 | $14.95 per case; printed $14.95 per case | n/a lb / 1 EA (case) | No unsupported unit conversion | unavailable; missing or ambiguous identity/basis | [receipts-2026-09-18-batch2.json:199](../receipts/receipts-2026-09-18-batch2.json#L199) |
| DM101 / 2026-09-15 | $12.95 per case; printed $12.95 per case | n/a lb / 1 EA (case) | No unsupported unit conversion | unavailable delta: identity unverified (name/family hypothesis only); [readiness-list-prod-2026-09-16.json:1464](../context/readiness-list-prod-2026-09-16.json#L1464) | [receipts-2026-09-18-batch2.json:207](../receipts/receipts-2026-09-18-batch2.json#L207) |
| 30 / 2026-09-15 | $8.95 per each; printed $8.95 per each | n/a lb / 4 EA | $8.95/each | unavailable delta: identity unverified (name/family hypothesis only); [readiness-list-prod-2026-09-16.json:5124](../context/readiness-list-prod-2026-09-16.json#L5124) | [receipts-2026-09-18-batch2.json:215](../receipts/receipts-2026-09-18-batch2.json#L215) |


### Cardinal Bakery

| Item / date | Billed unit rate | Net lb / printed qty | Comparable unit costs | Catalog comparison | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1030 / 2026-09-12 | $7.87 per dozen; printed $7.87 per dozen | n/a lb / 84 DZ | $0.65583/each | unavailable delta: identity unverified (name/family hypothesis only); [readiness-list-prod-2026-09-16.json:9346](../context/readiness-list-prod-2026-09-16.json#L9346) | [receipts-2026-09-18-batch2.json:37](../receipts/receipts-2026-09-18-batch2.json#L37) |
| 3290 / 2026-09-12 | $35.24 per each; printed $35.24 per each | n/a lb / 2 EA | $35.24/each | unavailable; missing or ambiguous identity/basis | [receipts-2026-09-18-batch2.json:45](../receipts/receipts-2026-09-18-batch2.json#L45) |
| 1030 / 2026-09-07 | $7.87 per dozen; printed $7.87 per dozen | n/a lb / 80 DZ | $0.65583/each | unavailable delta: identity unverified (name/family hypothesis only); [readiness-list-prod-2026-09-16.json:9346](../context/readiness-list-prod-2026-09-16.json#L9346) | [receipts-2026-09-18-batch2.json:65](../receipts/receipts-2026-09-18-batch2.json#L65) |


### Country Snacks

| Item / date | Billed unit rate | Net lb / printed qty | Comparable unit costs | Catalog comparison | Evidence |
| --- | --- | --- | --- | --- | --- |
| not printed / 2026-09-08 | $25.20 per case; printed $25.20 per case | n/a lb / 23 CASE (14 bags) | No unsupported unit conversion | unavailable; missing or ambiguous identity/basis | [receipts-2026-09-18-batch2.json:14](../receipts/receipts-2026-09-18-batch2.json#L14) |


### Thompson Delivers

| Item / date | Billed unit rate | Net lb / printed qty | Comparable unit costs | Catalog comparison | Evidence |
| --- | --- | --- | --- | --- | --- |
| 27149 / 2026-09-17 | $4.37 per each; printed $4.37 per bag | n/a lb / 108 EA (bag) | $4.37/each | unavailable; missing or ambiguous identity/basis | [receipts-2026-09-18-batch1.json:16](../receipts/receipts-2026-09-18-batch1.json#L16) |
| 00602 / 2026-09-17 | $0.39 per each; printed $23.35 per 60-bag club pack | n/a lb / 2 EA (bag) | $0.39/each | unavailable; missing or ambiguous identity/basis | [receipts-2026-09-18-batch1.json:26](../receipts/receipts-2026-09-18-batch1.json#L26) |


### TriMark

| Item / date | Billed unit rate | Net lb / printed qty | Comparable unit costs | Catalog comparison | Evidence |
| --- | --- | --- | --- | --- | --- |
| 20970 / 2026-09-16 | $0.00 per each; printed $0.00 per each | n/a lb / 4 EACH | $0.00/each | unavailable; missing or ambiguous identity/basis | [receipts-2026-09-18-batch1.json:139](../receipts/receipts-2026-09-18-batch1.json#L139) |
| 95967 / 2026-09-16 | $70.14 per bundle; printed $70.14 per bundle | n/a lb / 5 BNDL (1000 sheets) | No unsupported unit conversion | unavailable delta: identity unverified (name/family hypothesis only); [readiness-list-prod-2026-09-16.json:1645](../context/readiness-list-prod-2026-09-16.json#L1645) | [receipts-2026-09-18-batch1.json:148](../receipts/receipts-2026-09-18-batch1.json#L148) |


### Whisked

| Item / date | Billed unit rate | Net lb / printed qty | Comparable unit costs | Catalog comparison | Evidence |
| --- | --- | --- | --- | --- | --- |
| not printed / 2026-09-18 | $59.40 per case; printed $59.40 per case | n/a lb / 1 case (54) | No unsupported unit conversion | unavailable; missing or ambiguous identity/basis | [receipts-2026-09-18-batch1.json:118](../receipts/receipts-2026-09-18-batch1.json#L118) |


### D.1 Purchase-unit decisions

| Line | Observed / calculated basis | Evidence |
| --- | --- | --- |
| Thompson 27149 | 9 bags × $4.37 = $39.33/box; 12.5 OZ/bag. Printed 108 bags = 12 boxes. | [receipts-2026-09-18-batch1.json:16](../receipts/receipts-2026-09-18-batch1.json#L16) |
| Thompson 00602 | 60 bags × $0.39 = $23.40/box; 1 OZ/bag. Rounded bag rate implies $23.40/box versus billed $23.35/box: $0.05 difference. Billed implied bag rate $0.38917. Printed 2 club packs; billed extension $46.70. | [receipts-2026-09-18-batch1.json:26](../receipts/receipts-2026-09-18-batch1.json#L26) |
| Country Snacks mixed flavors | 14 bags × $1.80 = $25.20/case; 23 cases = 322 bags = $579.60. Purchase flavors untracked. | [receipts-2026-09-18-batch2.json:14](../receipts/receipts-2026-09-18-batch2.json#L14) |
| Cardinal 1030 / 2026-09-12 | $7.87/dozen = $0.65583/roll; 84 dozen = 1008 rolls ($661.08). | [receipts-2026-09-18-batch2.json:37](../receipts/receipts-2026-09-18-batch2.json#L37) |
| Cardinal 1030 / 2026-09-07 | $7.87/dozen = $0.65583/roll; 80 dozen = 960 rolls ($629.60). | [receipts-2026-09-18-batch2.json:65](../receipts/receipts-2026-09-18-batch2.json#L65) |


Cardinal delivery Mon/Wed/Thu/Fri/Sat; order before 3 pm. [receipts-2026-09-18-batch2.json:29](../receipts/receipts-2026-09-18-batch2.json#L29)

## E. Pack mismatches

Missing catalog packs/identity prevent a proven mismatch. Receipt quantity, pieces/case and pounds are distinct. Soda/water billed EA (case) stays per case. Country Snacks flavor names cannot reconstruct the mixed case's flavors.

| Vendor / item | Observed pack | Catalog pack | Comparison | Evidence |
| --- | --- | --- | --- | --- |
| TriMark / 95967 | 1/1000 EA | not supplied | unavailable: identity unverified | [receipts-2026-09-18-batch1.json:148](../receipts/receipts-2026-09-18-batch1.json#L148); [readiness-list-prod-2026-09-16.json:1645](../context/readiness-list-prod-2026-09-16.json#L1645) |
| Cardinal Bakery / 1030 | 1/1 DZ | not supplied | unavailable: identity unverified | [receipts-2026-09-18-batch2.json:37](../receipts/receipts-2026-09-18-batch2.json#L37); [readiness-list-prod-2026-09-16.json:9346](../context/readiness-list-prod-2026-09-16.json#L9346) |
| Cardinal Bakery / 1030 | 1/1 DZ | not supplied | unavailable: identity unverified | [receipts-2026-09-18-batch2.json:65](../receipts/receipts-2026-09-18-batch2.json#L65); [readiness-list-prod-2026-09-16.json:9346](../context/readiness-list-prod-2026-09-16.json#L9346) |
| Boar's Head / 546 | not supplied | not supplied | unavailable: identity unverified | [receipts-2026-09-18-batch2.json:86](../receipts/receipts-2026-09-18-batch2.json#L86); [readiness-list-prod-2026-09-16.json:985](../context/readiness-list-prod-2026-09-16.json#L985) |
| Boar's Head / 137 | not supplied | not supplied | unavailable: identity unverified | [receipts-2026-09-18-batch2.json:95](../receipts/receipts-2026-09-18-batch2.json#L95); [readiness-list-prod-2026-09-16.json:2024](../context/readiness-list-prod-2026-09-16.json#L2024) |
| Boar's Head / 278 | not supplied | not supplied | unavailable: identity unverified | [receipts-2026-09-18-batch2.json:104](../receipts/receipts-2026-09-18-batch2.json#L104); [readiness-list-prod-2026-09-16.json:9911](../context/readiness-list-prod-2026-09-16.json#L9911) |
| Boar's Head / 505 | not supplied | not supplied | unavailable: identity unverified | [receipts-2026-09-18-batch2.json:113](../receipts/receipts-2026-09-18-batch2.json#L113); [readiness-list-prod-2026-09-16.json:4174](../context/readiness-list-prod-2026-09-16.json#L4174) |
| Boar's Head / 558 | not supplied | not supplied | unavailable: identity unverified | [receipts-2026-09-18-batch2.json:122](../receipts/receipts-2026-09-18-batch2.json#L122); [readiness-list-prod-2026-09-16.json:7047](../context/readiness-list-prod-2026-09-16.json#L7047) |
| Boar's Head / 30 | not supplied | not supplied | unavailable: identity unverified | [receipts-2026-09-18-batch2.json:131](../receipts/receipts-2026-09-18-batch2.json#L131); [readiness-list-prod-2026-09-16.json:5124](../context/readiness-list-prod-2026-09-16.json#L5124) |
| Boar's Head / 795 | not supplied | not supplied | unavailable: identity unverified | [receipts-2026-09-18-batch2.json:139](../receipts/receipts-2026-09-18-batch2.json#L139); [readiness-list-prod-2026-09-16.json:10556](../context/readiness-list-prod-2026-09-16.json#L10556) |
| Boar's Head / 12011 | not supplied | not supplied | unavailable: identity unverified | [receipts-2026-09-18-batch2.json:157](../receipts/receipts-2026-09-18-batch2.json#L157); [readiness-list-prod-2026-09-16.json:8403](../context/readiness-list-prod-2026-09-16.json#L8403) |
| Boar's Head / 278 | not supplied | not supplied | unavailable: identity unverified | [receipts-2026-09-18-batch2.json:166](../receipts/receipts-2026-09-18-batch2.json#L166); [readiness-list-prod-2026-09-16.json:9911](../context/readiness-list-prod-2026-09-16.json#L9911) |
| Boar's Head / 75 | not supplied | not supplied | unavailable: identity unverified | [receipts-2026-09-18-batch2.json:175](../receipts/receipts-2026-09-18-batch2.json#L175); [readiness-list-prod-2026-09-16.json:2516](../context/readiness-list-prod-2026-09-16.json#L2516) |
| Boar's Head / 76 | not supplied | not supplied | unavailable: ambiguous catalog identity | [receipts-2026-09-18-batch2.json:183](../receipts/receipts-2026-09-18-batch2.json#L183); [readiness-list-prod-2026-09-16.json:2516](../context/readiness-list-prod-2026-09-16.json#L2516) |
| Boar's Head / 76 | not supplied | not supplied | unavailable: ambiguous catalog identity | [receipts-2026-09-18-batch2.json:183](../receipts/receipts-2026-09-18-batch2.json#L183); [readiness-list-prod-2026-09-16.json:2887](../context/readiness-list-prod-2026-09-16.json#L2887) |
| Boar's Head / DM101 | not supplied | not supplied | unavailable: identity unverified | [receipts-2026-09-18-batch2.json:207](../receipts/receipts-2026-09-18-batch2.json#L207); [readiness-list-prod-2026-09-16.json:1464](../context/readiness-list-prod-2026-09-16.json#L1464) |
| Boar's Head / 30 | not supplied | not supplied | unavailable: identity unverified | [receipts-2026-09-18-batch2.json:215](../receipts/receipts-2026-09-18-batch2.json#L215); [readiness-list-prod-2026-09-16.json:5124](../context/readiness-list-prod-2026-09-16.json#L5124) |


## F. Purchase evidence and liveness

| Vendor | Lines | Dates | Evidence |
| --- | --- | --- | --- |
| Baldor | 5 | 2026-07-01 | [receipts-2026-09-18-batch1.json:59](../receipts/receipts-2026-09-18-batch1.json#L59); [receipts-2026-09-18-batch1.json:68](../receipts/receipts-2026-09-18-batch1.json#L68); [receipts-2026-09-18-batch1.json:77](../receipts/receipts-2026-09-18-batch1.json#L77); [receipts-2026-09-18-batch1.json:86](../receipts/receipts-2026-09-18-batch1.json#L86); [receipts-2026-09-18-batch1.json:95](../receipts/receipts-2026-09-18-batch1.json#L95) |
| Berger | 2 | 2026-09-09 | [receipts-2026-09-18-batch1.json:169](../receipts/receipts-2026-09-18-batch1.json#L169); [receipts-2026-09-18-batch1.json:177](../receipts/receipts-2026-09-18-batch1.json#L177) |
| Boar's Head | 15 | 2026-09-15, 2026-09-16 | [receipts-2026-09-18-batch2.json:86](../receipts/receipts-2026-09-18-batch2.json#L86); [receipts-2026-09-18-batch2.json:95](../receipts/receipts-2026-09-18-batch2.json#L95); [receipts-2026-09-18-batch2.json:104](../receipts/receipts-2026-09-18-batch2.json#L104); [receipts-2026-09-18-batch2.json:113](../receipts/receipts-2026-09-18-batch2.json#L113); [receipts-2026-09-18-batch2.json:122](../receipts/receipts-2026-09-18-batch2.json#L122); [receipts-2026-09-18-batch2.json:131](../receipts/receipts-2026-09-18-batch2.json#L131); [receipts-2026-09-18-batch2.json:139](../receipts/receipts-2026-09-18-batch2.json#L139); [receipts-2026-09-18-batch2.json:157](../receipts/receipts-2026-09-18-batch2.json#L157); [receipts-2026-09-18-batch2.json:166](../receipts/receipts-2026-09-18-batch2.json#L166); [receipts-2026-09-18-batch2.json:175](../receipts/receipts-2026-09-18-batch2.json#L175); [receipts-2026-09-18-batch2.json:183](../receipts/receipts-2026-09-18-batch2.json#L183); [receipts-2026-09-18-batch2.json:191](../receipts/receipts-2026-09-18-batch2.json#L191); [receipts-2026-09-18-batch2.json:199](../receipts/receipts-2026-09-18-batch2.json#L199); [receipts-2026-09-18-batch2.json:207](../receipts/receipts-2026-09-18-batch2.json#L207); [receipts-2026-09-18-batch2.json:215](../receipts/receipts-2026-09-18-batch2.json#L215) |
| Cardinal Bakery | 3 | 2026-09-07, 2026-09-12 | [receipts-2026-09-18-batch2.json:37](../receipts/receipts-2026-09-18-batch2.json#L37); [receipts-2026-09-18-batch2.json:45](../receipts/receipts-2026-09-18-batch2.json#L45); [receipts-2026-09-18-batch2.json:65](../receipts/receipts-2026-09-18-batch2.json#L65) |
| Country Snacks | 1 | 2026-09-08 | [receipts-2026-09-18-batch2.json:14](../receipts/receipts-2026-09-18-batch2.json#L14) |
| Thompson Delivers | 2 | 2026-09-17 | [receipts-2026-09-18-batch1.json:16](../receipts/receipts-2026-09-18-batch1.json#L16); [receipts-2026-09-18-batch1.json:26](../receipts/receipts-2026-09-18-batch1.json#L26) |
| TriMark | 2 | 2026-09-16 | [receipts-2026-09-18-batch1.json:139](../receipts/receipts-2026-09-18-batch1.json#L139); [receipts-2026-09-18-batch1.json:148](../receipts/receipts-2026-09-18-batch1.json#L148) |
| Whisked | 1 | 2026-09-18 | [receipts-2026-09-18-batch1.json:118](../receipts/receipts-2026-09-18-batch1.json#L118) |


There is no receipt-based full LIVE list. Two Cardinal and two Boar's Head deliveries demonstrate dated buying; a missing item in ten photos does not prove inactivity.

## G. Floor questions

[Merged floor questions (draft spec §9)](../../../../superpowers/specs/2026-09-18-vendor-ordering-v3c-import-design.md#9-open-questions-for-juan--floor-answers-only). Cardinal schedule and mini-chip size are answered by these sources.

## H. Cross-vendor twin candidates

Separate SKU per vendor; a human selects the active twin at each shop. Family matches are review candidates, not approved equivalents or proof of simultaneous buying. Preserve PFG purchase dates and US Foods undated purchase-proxy membership. Missing US Foods prices prevent savings claims.

| Family | PFG | US Foods | Review |
| --- | --- | --- | --- |
| Duke's mayonnaise | 32118: MAYONNAISE HEAVY_DUTY; 4/1 GA; $73.99 CS; last purchase 2026-09-17 [purchase-history-2026-09-18.csv:51](../pfg/purchase-history-2026-09-18.csv#L51) | 9189275: MAYONNAISE, HEAVY-DUTY SOYBEAN OIL PLASTIC JUG SHELF STABLE; 4/1 GA      ; unavailable ; purchase proxy YES [list-daily-2026-09-18.csv:123](../usfoods/list-daily-2026-09-18.csv#L123) | Confirm pack, grade and intended use before choosing the active vendor line |
| Saratoga sparkling | 986454: WATER SPARKLING SPRING GLASS; 24/12 OZ; $25.73 CS; last purchase 2026-09-05 [purchase-history-2026-09-18.csv:12](../pfg/purchase-history-2026-09-18.csv#L12) | 1292481: WATER, SPARKLING GLASS BOTTLE BLUE CARBONATED SELTZER; 24/12 OZ    ; unavailable ; purchase proxy YES [order-guide-514925-managed-2026-09-18.csv:24](../usfoods/order-guide-514925-managed-2026-09-18.csv#L24) | Confirm pack, grade and intended use before choosing the active vendor line |
| Natalie's lemonade | 1020546: JUICE LEMONADE NATURAL; 6/12 OZ; $10.63 CS; last purchase 2026-09-17 [purchase-history-2026-09-18.csv:10](../pfg/purchase-history-2026-09-18.csv#L10) | 1163624: JUICE, LEMONADE DRINK 22% NATURAL SS PLASTIC BOTTLE REF; 6/12 OZ     ; unavailable ; purchase proxy YES [list-master-2026-09-18.csv:47](../usfoods/list-master-2026-09-18.csv#L47); 1433014: JUICE, LEMONADE DRINK 20% PLASTIC BOTTLE REF; 6/16 OZ     ; unavailable ; list-only [list-daily-2026-09-18.csv:242](../usfoods/list-daily-2026-09-18.csv#L242) | Confirm pack, grade and intended use before choosing the active vendor line |
| Iceberg | 907437: LETTUCE ICEBERG LINER; 24/1 CT; $43.82 CS; last purchase 2026-09-17 [purchase-history-2026-09-18.csv:85](../pfg/purchase-history-2026-09-18.csv#L85); 975303: LETTUCE ICEBERG CLEAN_&_TRIMMED; 4/6 CT; $41.89 CS; last purchase 2026-07-15 [purchase-history-2026-09-18.csv:105](../pfg/purchase-history-2026-09-18.csv#L105); 994274: LETTUCE CELLO ICEBERG CALIFORNIA; 1/24 CT; $45.34 CS; last purchase 2026-08-27 [purchase-history-2026-09-18.csv:100](../pfg/purchase-history-2026-09-18.csv#L100) | 2326411: LETTUCE, ICEBERG FRESH REF BOX; 24 EA       ; unavailable ; purchase proxy YES [list-daily-2026-09-18.csv:19](../usfoods/list-daily-2026-09-18.csv#L19); 3711637: LETTUCE, ICEBERG CLEANED and TRIMMED FRESH REF; 6 EA        ; unavailable ; purchase proxy YES [order-guide-514925-managed-2026-09-18.csv:9](../usfoods/order-guide-514925-managed-2026-09-18.csv#L9); 5326426: LETTUCE, ICEBERG CLEANED and TRIMMED FRESH REF; 4/6 EA      ; unavailable ; purchase proxy YES [list-daily-2026-09-18.csv:18](../usfoods/list-daily-2026-09-18.csv#L18) | Confirm pack, grade and intended use before choosing the active vendor line |
| Hard-cooked eggs | 439686: EGG HARD COOKED PEELED DRY PACK; 12/12 CT; $39.97 CS; last purchase 2026-09-10 [purchase-history-2026-09-18.csv:20](../pfg/purchase-history-2026-09-18.csv#L20); 466355: EGG HARD COOKED PEELED DRY PACK; 12/12 CT; $39.97 CS; last purchase 2026-08-25 [purchase-history-2026-09-18.csv:23](../pfg/purchase-history-2026-09-18.csv#L23) | 827428: EGG, HARD COOKED PEELED WHOLE REF DRY PILLOW PACK; 12/1 DZ     ; unavailable ; purchase proxy YES [order-guide-514925-managed-2026-09-18.csv:14](../usfoods/order-guide-514925-managed-2026-09-18.csv#L14) | Confirm pack, grade and intended use before choosing the active vendor line |
| Ham (not turkey) | 231710: HAM 35% WATER FULLY-COOKED 4X6 0 GRAMS TRANS FAT PER SERVING; 1/13 LB; $2.72630/lb; last purchase 2026-09-17 [purchase-history-2026-09-18.csv:80](../pfg/purchase-history-2026-09-18.csv#L80); 799843: HAM COOKED WATER_ADDED GOLD VACUUM-PACKED; 2/12 LB; $83.13 CS; last purchase 2026-09-10 [purchase-history-2026-09-18.csv:82](../pfg/purchase-history-2026-09-18.csv#L82) | 2514396: HAM, PROSCIUTTO SLICED DRY CURED COOKED REF PORK; 6/1 LB      ; unavailable ; list-only [list-daily-2026-09-18.csv:78](../usfoods/list-daily-2026-09-18.csv#L78); 3701604: HAM, PROSCIUTTO SLICED DRY CURED COOKED DOMESTIC REF GAS FLUSHED PORK; 12/16 OZ; unavailable ; list-only [list-daily-2026-09-18.csv:79](../usfoods/list-daily-2026-09-18.csv#L79); 3938214: HAM, BONELESS D-SHAPED APPLEWOOD SMOKED NATURAL REF DELI-FACED PORK; 2/7 LBA     ; unavailable ; list-only [list-daily-2026-09-18.csv:63](../usfoods/list-daily-2026-09-18.csv#L63); 5888342: HAM, BONELESS PIT WATER-ADDED HARDWOOD SMOKED COOKED REF VACUUM-PACK 2-DIAM; 2/16 LBA    ; unavailable ; list-only [list-daily-2026-09-18.csv:65](../usfoods/list-daily-2026-09-18.csv#L65); 5888441: HAM, BONELESS PIT STYLE WATER-ADDED HARDWOOD SMOKED COOKED REF 2-DIAMOND VA; 2/12 LBA    ; unavailable ; list-only [list-daily-2026-09-18.csv:64](../usfoods/list-daily-2026-09-18.csv#L64); 5888482: HAM, BONELESS D-SHAPED NATURAL-JUICE HARDWOOD SMOKED CURED COOKED 3-DIAMOND; 2/9-10 LBA  ; unavailable ; list-only [list-daily-2026-09-18.csv:62](../usfoods/list-daily-2026-09-18.csv#L62); 6497260: HAM, COOKED RECTANGLE 4X6 HWP 39% REF 1-DIAMOND PORK; 2/13 LB; unavailable ; purchase proxy YES [list-master-2026-09-18.csv:7](../usfoods/list-master-2026-09-18.csv#L7); 7196058: HAM, CAPICOLA HOT STICK DOMESTIC COOKED REF VACUUM-PACK; 2/6 LBA     ; unavailable ; list-only [list-daily-2026-09-18.csv:60](../usfoods/list-daily-2026-09-18.csv#L60); 7757217: HAM, PROSCIUTTO SLICED DRY CURED REF PORK; 12/3 OZ     ; unavailable ; list-only [list-daily-2026-09-18.csv:80](../usfoods/list-daily-2026-09-18.csv#L80); 9269994: HAM, COOKED HWP 35% REF PORK; 2/13 LB     ; unavailable ; purchase proxy YES [list-daily-2026-09-18.csv:3](../usfoods/list-daily-2026-09-18.csv#L3); 9781253: HAM, BONELESS D-SHAPED FIRE SMOKED REF PORK; 2/5 LBA     ; unavailable ; list-only [list-daily-2026-09-18.csv:61](../usfoods/list-daily-2026-09-18.csv#L61) | Confirm pack, grade and intended use before choosing the active vendor line |
| Fresh mozzarella | 397845: CHEESE MOZZARELLA THIN SLICED LOG 32 COUNT 1.0 OUNCE FRESH MOZZARELLA CRYOVAC; 6/2 LB; $47.10 CS; last purchase 2026-09-15 [purchase-history-2026-09-18.csv:15](../pfg/purchase-history-2026-09-18.csv#L15); 541963: CHEESE MOZZARELLA LOG FRESH CRYOVAC; 8/1 LB; $32.31 CS; last purchase 2026-06-30 [purchase-history-2026-09-18.csv:29](../pfg/purchase-history-2026-09-18.csv#L29) | 7141673: CHEESE, MOZZARELLA LOG SLICED WHOLE MILK DRY PACK 1 OZ RBST FREE REF FRESH; 6/1 LB      ; unavailable ; purchase proxy YES [list-daily-2026-09-18.csv:96](../usfoods/list-daily-2026-09-18.csv#L96); 864959: CHEESE, MOZZARELLA WHOLE MILK SLICED 1 OZ VACUUM-PACK REF LOG; 8/1 LB      ; unavailable ; list-only [list-daily-2026-09-18.csv:95](../usfoods/list-daily-2026-09-18.csv#L95); 9697558: CHEESE, MOZZARELLA LOG SLICED WHOLE MILK DRY PACK 1 LB RBST FREE REF FRESH; 6/1 LB      ; unavailable ; purchase proxy YES [order-guide-514925-managed-2026-09-18.csv:97](../usfoods/order-guide-514925-managed-2026-09-18.csv#L97) | Confirm pack, grade and intended use before choosing the active vendor line |
| Shredded mozzarella (blend requires review) | 1715: CHEESE MOZZARELLA PROVOLONE 50/50 SHREDDED WHOLE MILK; 6/5 LB; $75.92 CS; last purchase absent [list-comp-only-opening-2026-09-18.csv:48](../pfg/list-comp-only-opening-2026-09-18.csv#L48); 288533: CHEESE MOZZARELLA LOW_MOISTURE_WHOLE_MILK SHREDDED; 6/5 LB; $81.89 CS; last purchase 2026-08-29 [purchase-history-2026-09-18.csv:22](../pfg/purchase-history-2026-09-18.csv#L22) | 3382389: CHEESE, PREMIUM MOZZARELLA PART-SKIM PROVOLONE BLEND SHREDDED FEATHER 50/50; 4/5 LB      ; unavailable ; purchase proxy YES [list-master-2026-09-18.csv:25](../usfoods/list-master-2026-09-18.csv#L25); 6382386: CHEESE, PREMIUM MOZZARELLA LOW-MOISTURE-WHOLE-MILK SHREDDED FEATHER BAG REF; 4/5 LB      ; unavailable ; purchase proxy YES [list-daily-2026-09-18.csv:109](../usfoods/list-daily-2026-09-18.csv#L109) | Confirm pack, grade and intended use before choosing the active vendor line |
| Cheddar | 320320: CHEESE CHEDDAR WHITE MEDIUM LOAF VINTAGE; 2/5 LB; $51.73 CS; last purchase 2026-07-07 [purchase-history-2026-09-18.csv:28](../pfg/purchase-history-2026-09-18.csv#L28); 328716: CHEESE CHEDDAR SHARP WHITE BLOCK 0 GRAMS TRANS FAT PER SERVING; 1/10 LB; $34.01 CS; last purchase 2026-09-12 [purchase-history-2026-09-18.csv:18](../pfg/purchase-history-2026-09-18.csv#L18) | 2177707: CHEESE, CHEDDAR MEDIUM LOAF RBST FREE YELLOW REF; 2/5 LB      ; unavailable ; list-only [list-daily-2026-09-18.csv:91](../usfoods/list-daily-2026-09-18.csv#L91); 232015: CHEESE, CHEDDAR WHITE SHARP PRINT VACUUM-PACK REF; 10 LBA; unavailable ; purchase proxy YES [list-daily-2026-09-18.csv:5](../usfoods/list-daily-2026-09-18.csv#L5); 5880836: CHEESE, CHEDDAR MILD PRINT WRAPPED YELLOW REF YELLOW; 10 LB; unavailable ; list-only [list-daily-2026-09-18.csv:92](../usfoods/list-daily-2026-09-18.csv#L92); 8434056: CHEESE, CHEDDAR MILD HICKORY SMOKED LOAF CVP REF; 2/5 LBA     ; unavailable ; list-only [list-daily-2026-09-18.csv:90](../usfoods/list-daily-2026-09-18.csv#L90) | Confirm pack, grade and intended use before choosing the active vendor line |
| Ricotta | 138065: CHEESE RICOTTA IMPASTATA WHOLE MILK 65% MOISTURE; 4/5 LB; $68.19 CS; last purchase 2026-09-08 [purchase-history-2026-09-18.csv:21](../pfg/purchase-history-2026-09-18.csv#L21) | 3783867: CHEESE, RICOTTA WHOLE MILK DOMESTIC CUP REF WHEY; 6/3 LB      ; unavailable ; list-only [list-daily-2026-09-18.csv:108](../usfoods/list-daily-2026-09-18.csv#L108); 386664: CHEESE, RICOTTA TENERA WHOLE MILK DOMESTIC PLASTIC TUB REF FINE; 6/3 LB      ; unavailable ; list-only [list-daily-2026-09-18.csv:107](../usfoods/list-daily-2026-09-18.csv#L107); 998294: CHEESE, RICOTTA IMPASTATA WHOLE MILK TUB REF DEL PASTAIO; 2/5 LB      ; unavailable ; purchase proxy YES [list-daily-2026-09-18.csv:106](../usfoods/list-daily-2026-09-18.csv#L106) | Confirm pack, grade and intended use before choosing the active vendor line |
| Parmesan | 232190: CHEESE PARMESAN GRATED TUB; 4/5 LB; $76.74 CS; last purchase 2026-07-28 [purchase-history-2026-09-18.csv:25](../pfg/purchase-history-2026-09-18.csv#L25); 238641: CHEESE PARMESAN GRATED TUB; 1/5 LB; $20.13 CS; last purchase 2026-09-12 [purchase-history-2026-09-18.csv:19](../pfg/purchase-history-2026-09-18.csv#L19) | 1056945: CHEESE, PARMESAN GRATED BAG REF; 2/5 LB      ; unavailable ; list-only [list-daily-2026-09-18.csv:101](../usfoods/list-daily-2026-09-18.csv#L101); 3587482: CHEESE, PARMESAN GRATED BAG REF IMPORTED; 4/5 LB      ; unavailable ; purchase proxy YES [list-daily-2026-09-18.csv:98](../usfoods/list-daily-2026-09-18.csv#L98); 3587797: CHEESE, PARMESAN ROMANO BLEND GRATED 50/50 BAG REF; 2/5 LB      ; unavailable ; list-only [list-daily-2026-09-18.csv:99](../usfoods/list-daily-2026-09-18.csv#L99); 8869847: CHEESE, PARMESAN GRATED BAG REF; 2/5 LB      ; unavailable ; list-only [list-daily-2026-09-18.csv:100](../usfoods/list-daily-2026-09-18.csv#L100) | Confirm pack, grade and intended use before choosing the active vendor line |
| Provolone | 1715: CHEESE MOZZARELLA PROVOLONE 50/50 SHREDDED WHOLE MILK; 6/5 LB; $75.92 CS; last purchase absent [list-comp-only-opening-2026-09-18.csv:48](../pfg/list-comp-only-opening-2026-09-18.csv#L48) | 9419516: CHEESE, PROVOLONE SLICED .75 OZ TWIN PACK REF; 6/1.5 LB    ; unavailable ; list-only [list-daily-2026-09-18.csv:105](../usfoods/list-daily-2026-09-18.csv#L105) | Confirm pack, grade and intended use before choosing the active vendor line |
| Fresh peeled garlic | 275595: GARLIC WHOLE PEELED DOMESTIC; 4/5 LB; $79.15 CS; last purchase 2026-06-25 [purchase-history-2026-09-18.csv:104](../pfg/purchase-history-2026-09-18.csv#L104); 283987: GARLIC WHOLE PEELED DOMESTIC; 1/5 LB; $20.74 CS; last purchase 2026-09-12 [purchase-history-2026-09-18.csv:91](../pfg/purchase-history-2026-09-18.csv#L91) | 7489339: GARLIC, WHITE WHOLE CLOVE PEELED FRESH REF; 4/5 LB      ; unavailable ; purchase proxy YES [list-daily-2026-09-18.csv:16](../usfoods/list-daily-2026-09-18.csv#L16); 8030348: GARLIC, WHITE WHOLE CLOVE PEELED FRESH REF; 4/5 LB      ; unavailable ; list-only [list-daily-2026-09-18.csv:17](../usfoods/list-daily-2026-09-18.csv#L17) | Confirm pack, grade and intended use before choosing the active vendor line |
| Fresh basil | 23097: BASIL FRESH; 1/1 LB; $10.34 CS; last purchase 2026-09-05 [purchase-history-2026-09-18.csv:95](../pfg/purchase-history-2026-09-18.csv#L95); 855571: BASIL FRESH; 1/1 LB; $20.95 CS; last purchase 2026-09-12 [purchase-history-2026-09-18.csv:87](../pfg/purchase-history-2026-09-18.csv#L87) | 4326401: BASIL, FRESH HERB; 1 LB        ; unavailable ; purchase proxy YES [list-daily-2026-09-18.csv:51](../usfoods/list-daily-2026-09-18.csv#L51); 4331971: BASIL, FRESH HERB; 8 OZ        ; unavailable ; purchase proxy YES [list-daily-2026-09-18.csv:50](../usfoods/list-daily-2026-09-18.csv#L50) | Confirm pack, grade and intended use before choosing the active vendor line |
| Yellow onion | 898641: ONION YELLOW COLOSSAL BAG; 1/50 LB; $33.52 CS; last purchase 2026-09-15 [purchase-history-2026-09-18.csv:86](../pfg/purchase-history-2026-09-18.csv#L86); 907426: ONION YELLOW JUMBO BOX AND BAG; 1/50 LB; $29.05 CS; last purchase 2026-09-03 [purchase-history-2026-09-18.csv:99](../pfg/purchase-history-2026-09-18.csv#L99) | 3011822: ONION, YELLOW JUMBO FRESH REF BOX; 10 LB       ; unavailable ; list-only [list-daily-2026-09-18.csv:27](../usfoods/list-daily-2026-09-18.csv#L27); 4821458: ONION, YELLOW JUMBO BULK FRESH REF; 5 LB        ; unavailable ; list-only [list-daily-2026-09-18.csv:26](../usfoods/list-daily-2026-09-18.csv#L26); 8011819: ONION, YELLOW MEDIUM FRESH REF; 10 LB       ; unavailable ; list-only [list-daily-2026-09-18.csv:28](../usfoods/list-daily-2026-09-18.csv#L28); 8326696: ONION, YELLOW JUMBO 3+ FRESH REF BAG; 50 LB       ; unavailable ; purchase proxy YES [list-daily-2026-09-18.csv:4](../usfoods/list-daily-2026-09-18.csv#L4) | Confirm pack, grade and intended use before choosing the active vendor line |
| Red onion | 907425: ONION RED JUMBO; 1/25 LB; $14.80 CS; last purchase 2026-07-25 [purchase-history-2026-09-18.csv:103](../pfg/purchase-history-2026-09-18.csv#L103); 974102: ONION RED WHOLE UNPEELED; 1/5 LB; $10.40 CS; last purchase absent [list-comp-only-opening-2026-09-18.csv:60](../pfg/list-comp-only-opening-2026-09-18.csv#L60) | 4326690: ONION, RED JUMBO FRESH REF BAG; 25 LB       ; unavailable ; list-only [list-daily-2026-09-18.csv:25](../usfoods/list-daily-2026-09-18.csv#L25); 7649753: ONION, RED JUMBO BAG FRESH REF; 5 LB        ; unavailable ; purchase proxy YES [list-daily-2026-09-18.csv:24](../usfoods/list-daily-2026-09-18.csv#L24) | Confirm pack, grade and intended use before choosing the active vendor line |
| Heavy cream | 199406: CREAM HEAVY 36% 0 GRAMS TRANS FAT PER SERVING ULTRA-HIGH-TEMPERATURE STABILIZED; 12/32 OZ; $42.50 CS; last purchase 2026-09-15 [purchase-history-2026-09-18.csv:16](../pfg/purchase-history-2026-09-18.csv#L16); 997152: CREAM HEAVY WHIPPING 40% 0 GRAMS TRANS FAT PER SERVING ULTRA-HIGH-TEMPERATURE STABILIZED ULTRA PASTEURIZED; 12/32 OZ; $44.08 CS; last purchase 2026-08-13 [purchase-history-2026-09-18.csv:24](../pfg/purchase-history-2026-09-18.csv#L24) | 7340979: CREAM, WHIPPING HEAVY 36% BUTTERFAT UHT DAIRY CARTON REF; 12/1 QT     ; unavailable ; list-only [list-daily-2026-09-18.csv:93](../usfoods/list-daily-2026-09-18.csv#L93); 8340978: CREAM, WHIPPING HEAVY 40% BUTTERFAT UHT DAIRY CARTON GABLE TOP REF; 12/1 QT     ; unavailable ; purchase proxy YES [list-daily-2026-09-18.csv:94](../usfoods/list-daily-2026-09-18.csv#L94) | Confirm pack, grade and intended use before choosing the active vendor line |
| Sour cream | 247189: SOUR CREAM REAL 18% BUTTERFAT; 1/5 LB; $8.10 CS; last purchase 2026-09-15 [purchase-history-2026-09-18.csv:17](../pfg/purchase-history-2026-09-18.csv#L17) | 2739175: SOUR CREAM, CULTURED ALL NATURAL RBST FREE TUB REF; 4/5 LB      ; unavailable ; list-only [list-daily-2026-09-18.csv:102](../usfoods/list-daily-2026-09-18.csv#L102); 7635170: SOUR CREAM, CULTURED TUB REF; 2/5 LB      ; unavailable ; purchase proxy YES [list-daily-2026-09-18.csv:104](../usfoods/list-daily-2026-09-18.csv#L104); 7635261: SOUR CREAM, CULTURED TUB REF; 4/5 LB      ; unavailable ; list-only [list-daily-2026-09-18.csv:103](../usfoods/list-daily-2026-09-18.csv#L103) | Confirm pack, grade and intended use before choosing the active vendor line |
| Butter | 1051772: BUTTER SOLID UNSALTED; 36/1 LB; $80.30 CS; last purchase 2026-09-15 [purchase-history-2026-09-18.csv:14](../pfg/purchase-history-2026-09-18.csv#L14) | 877506: BUTTER, SALTED SOLID AA GRADE PAPER WRAPPED REF; 36/1 LB     ; unavailable ; list-only [list-daily-2026-09-18.csv:88](../usfoods/list-daily-2026-09-18.csv#L88); 899807: BUTTER, UNSALTED SOLID AA GRADE PAPER WRAPPED REF; 36/1 LB     ; unavailable ; purchase proxy YES [list-daily-2026-09-18.csv:89](../usfoods/list-daily-2026-09-18.csv#L89) | Confirm pack, grade and intended use before choosing the active vendor line |
| Shell eggs | 517842: EGG WHITE MEDIUM AA LOOSE; 1/15 DZ; $13.36 CS; last purchase 2026-07-18 [purchase-history-2026-09-18.csv:27](../pfg/purchase-history-2026-09-18.csv#L27); 517879: EGG WHITE LARGE AA LOOSE; 1/30 DZ; $32.76 CS; last purchase 2026-07-25 [purchase-history-2026-09-18.csv:26](../pfg/purchase-history-2026-09-18.csv#L26) | 823005: EGG, SHELL EXTRA-LARGE GRADE AA WHITE LOOSE PACK FRESH; 15 DZ       ; unavailable ; list-only [list-daily-2026-09-18.csv:52](../usfoods/list-daily-2026-09-18.csv#L52); 823013: EGG, SHELL LARGE GRADE AA WHITE LOOSE PACK FRESH EXP; 15 DZ       ; unavailable ; purchase proxy YES [list-daily-2026-09-18.csv:53](../usfoods/list-daily-2026-09-18.csv#L53); 823021: EGG, SHELL MEDIUM GRADE AA WHITE LOOSE PACK FRESH; 15 DZ       ; unavailable ; purchase proxy YES [list-daily-2026-09-18.csv:54](../usfoods/list-daily-2026-09-18.csv#L54) | Confirm pack, grade and intended use before choosing the active vendor line |
| Fresh tomatoes | 878064: TOMATO 6X6; 1/25 LB; $38.16 CS; last purchase 2026-08-01 [purchase-history-2026-09-18.csv:102](../pfg/purchase-history-2026-09-18.csv#L102); 878065: TOMATO 5X6; 1/25 LB; $38.17 CS; last purchase 2026-09-10 [purchase-history-2026-09-18.csv:94](../pfg/purchase-history-2026-09-18.csv#L94) | 2331353: TOMATO, ROUND 5X6 #1 GRADE FRESH REF BULK; 25 LB       ; unavailable ; purchase proxy YES [list-daily-2026-09-18.csv:47](../usfoods/list-daily-2026-09-18.csv#L47); 4332938: TOMATO, ROUND 4X5 #1 GRADE FRESH REF 2 LAYER BOX; 20 LB       ; unavailable ; purchase proxy YES [list-daily-2026-09-18.csv:46](../usfoods/list-daily-2026-09-18.csv#L46); 7333024: TOMATO, ROUND 5X6 #1 GRADE FRESH REF 1 LAYER BOX; 10 LB       ; unavailable ; purchase proxy YES [list-daily-2026-09-18.csv:45](../usfoods/list-daily-2026-09-18.csv#L45) | Confirm pack, grade and intended use before choosing the active vendor line |
| Arugula | 242470: ARUGULA BABY; 2/2 LB; $19.27 CS; last purchase 2026-09-17 [purchase-history-2026-09-18.csv:84](../pfg/purchase-history-2026-09-18.csv#L84) | 9546982: ARUGULA, BABY CLEANED LOOSE LEAF WILD FRESH REF BAG; 2/2 LB      ; unavailable ; purchase proxy YES [list-daily-2026-09-18.csv:11](../usfoods/list-daily-2026-09-18.csv#L11) | Confirm pack, grade and intended use before choosing the active vendor line |
| Lemon juice (not lemonade) | 417586: JUICE LEMON ALL NATURAL; 6/32 OZ; $32.70 CS; last purchase 2026-09-17 [purchase-history-2026-09-18.csv:9](../pfg/purchase-history-2026-09-18.csv#L9); 495063: JUICE LEMON FROZEN; 12/1 LT; $62.66 CS; last purchase 2026-08-01 [purchase-history-2026-09-18.csv:13](../pfg/purchase-history-2026-09-18.csv#L13) | 6773394: JUICE, LEMON MEYER BLEND NOT-FROM-CONCENTRATE PLASTIC JUG REF; 12/32 OZ    ; unavailable ; list-only [list-daily-2026-09-18.csv:20](../usfoods/list-daily-2026-09-18.csv#L20); 6898142: JUICE, LEMON NOT-FROM-CONCENTRATE PLASTIC BOTTLE REF; 6/32 OZ     ; unavailable ; purchase proxy YES [list-daily-2026-09-18.csv:21](../usfoods/list-daily-2026-09-18.csv#L21) | Confirm pack, grade and intended use before choosing the active vendor line |
| Cucumber | 23280: CUCUMBER EUROPEAN SEEDLESS; 1/12 CT; $21.46 CS; last purchase 2026-09-12 [purchase-history-2026-09-18.csv:90](../pfg/purchase-history-2026-09-18.csv#L90) | 2264516: CUCUMBER, LARGE ENGLISH SEEDLESS HOT HOUSE BULK FRESH REF; 12 EA       ; unavailable ; purchase proxy YES [list-daily-2026-09-18.csv:14](../usfoods/list-daily-2026-09-18.csv#L14) | Confirm pack, grade and intended use before choosing the active vendor line |
| Gloves (size/material require review) | 240767: GLOVE LATEX LARGE POWDER FREE ROLLED CUFF; 10/100 CT; $68.35 CS; last purchase 2026-09-05 [purchase-history-2026-09-18.csv:37](../pfg/purchase-history-2026-09-18.csv#L37); 240782: GLOVE LATEX MEDIUM POWDER ROLLED CUFF; 10/100 CT; $65.25 CS; last purchase 2026-08-08 [purchase-history-2026-09-18.csv:48](../pfg/purchase-history-2026-09-18.csv#L48); 240787: GLOVE LATEX MEDIUM POWDER FREE ROLLED CUFF; 4/100 CT; $44.46 CS; last purchase 2026-09-01 [purchase-history-2026-09-18.csv:38](../pfg/purchase-history-2026-09-18.csv#L38); 265693: GLOVE LATEX EXTRA_LARGE POWDER FREE ROLLED CUFF; 10/100 CT; $68.35 CS; last purchase 2026-09-05 [purchase-history-2026-09-18.csv:36](../pfg/purchase-history-2026-09-18.csv#L36) | 1462156: GLOVE, EXTRA LARGE POWDER FREE NONMEDICAL NITRILE GLOVES; 10/100 EA   ; unavailable ; list-only [order-guide-514925-managed-2026-09-18.csv:66](../usfoods/order-guide-514925-managed-2026-09-18.csv#L66); 1703916: GLOVE, NITRILE LARGE POWDER-FREE BLACK BEADED CUFF TEXTURED TIPS AMBIDEXTRO; 10/100 EA   ; unavailable ; list-only [list-daily-2026-09-18.csv:160](../usfoods/list-daily-2026-09-18.csv#L160); 4882283: GLOVE, NITRILE MEDIUM POWDER-FREE BLACK BEADED CUFF TEXTURED TIPS AMBIDEXTR; 10/100 EA   ; unavailable ; list-only [list-daily-2026-09-18.csv:161](../usfoods/list-daily-2026-09-18.csv#L161); 6969505: GLOVE, VINYL LARGE POWDER-FREE NATURAL AMBIDEXTROUS; 10/100 EA   ; unavailable ; list-only [order-guide-514925-managed-2026-09-18.csv:70](../usfoods/order-guide-514925-managed-2026-09-18.csv#L70); 6969703: GLOVE, LATEX MEDIUM POWDER-FREE NATURAL IMPORTED THAILAND AMBIDEXTROUS; 10/100 EA   ; unavailable ; purchase proxy YES [list-master-2026-09-18.csv:58](../usfoods/list-master-2026-09-18.csv#L58); 6969729: GLOVE, LATEX LARGE POWDER-FREE NATURAL IMPORTED THAILAND AMBIDEXTROUS; 10/100 EA   ; unavailable ; purchase proxy YES [list-master-2026-09-18.csv:57](../usfoods/list-master-2026-09-18.csv#L57); 6969752: GLOVE, LATEX XL POWDER-FREE NATURAL IMPORTED THAILAND AMBIDEXTROUS; 10/100 EA   ; unavailable ; purchase proxy YES [list-master-2026-09-18.csv:49](../usfoods/list-master-2026-09-18.csv#L49); 7632987: GLOVE, NITRILE SMALL POWDER-FREE BLUE AMBIDEXTROUS; 10/100 EA   ; unavailable ; list-only [list-daily-2026-09-18.csv:162](../usfoods/list-daily-2026-09-18.csv#L162); 9932178: GLOVE, NITRILE XL POWDER-FREE BLACK BEADED CUFF TEXTURED TIPS AMBIDEXTROUS; 10/100 EA   ; unavailable ; list-only [list-daily-2026-09-18.csv:159](../usfoods/list-daily-2026-09-18.csv#L159) | Confirm pack, grade and intended use before choosing the active vendor line |
| Foil sheets | 240314: FOIL SHEET INTERFOLD 12X10.75; 12/200 CT; $133.39 CS; last purchase absent [list-izzy-main-2026-09-18.csv:54](../pfg/list-izzy-main-2026-09-18.csv#L54) | 1079339: WRAP, FOIL 9X10.75 INTERFOLD POP UP SHEET ALUMINUM 100% RECYCLED; 6/500 EA    ; unavailable ; list-only [list-daily-2026-09-18.csv:189](../usfoods/list-daily-2026-09-18.csv#L189); 9328311: WRAP, 12X10.75 FOIL INTERFOLD POP UP SHEET ALUMINUM EMBOSSED; 12/200 EA   ; unavailable ; purchase proxy YES [list-daily-2026-09-18.csv:188](../usfoods/list-daily-2026-09-18.csv#L188) | Confirm pack, grade and intended use before choosing the active vendor line |


**Not twins:** Ovengold turkey 278: OVENGOLD TURKEY; ; $6.29/lb; last purchase 2026-09-16 [receipts-2026-09-18-batch2.json:104](../receipts/receipts-2026-09-18-batch2.json#L104) is turkey; US Foods rectangle 4x6 ham 6497260: HAM, COOKED RECTANGLE 4X6 HWP 39% REF 1-DIAMOND PORK; 2/13 LB; unavailable ; purchase proxy YES [list-master-2026-09-18.csv:7](../usfoods/list-master-2026-09-18.csv#L7) is pork. Neither substitutes for the other. Saratoga still/sparkling and shell/hard-cooked eggs remain separate families.

Doctrine: [2026-09-16-vendor-ordering-v3a-order-guides-design.md:165](../../../../superpowers/specs/2026-09-16-vendor-ordering-v3a-order-guides-design.md#L165); per-shop activation: [location-sku-shared.ts:150](../../../../../lib/location-sku-shared.ts#L150).
