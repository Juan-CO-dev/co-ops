# Angel fill — WAVE 3 DRY RUN (the piece model)

**Status: NOTHING HAS BEEN WRITTEN.** This is the output of
`scripts/seed/20-angel-wave3.ts` in its default (dry-run) mode. The script writes only
under an explicit `--execute` flag, and that flag is not used until Juan has eyeballed
the tables below.

**Generated:** 2026-08-20, against `docs/angel-piece-structure.csv`, `docs/angel-pack-recheck.csv` and `docs/angel-products-rollup.csv`
(Claude Cowork's harvest-2 capture) and live prod (`bgcvurheqzylyfehqgzh`). Every SKU id,
vendor, pack chain and existing price below was resolved live at run time.

---

## Read this first — the five things that matter

1. **Seven Boar's Head SKUs become priceable.** Delmar invoices by the PIECE, not the
   case (the hidden `1 CT` subtitle). Wave 2 refused all seven for
   `OUR_PACK_UNRESOLVABLE`; harvest 2 supplies the missing denominator. Each gets a
   one-piece pack chain and a `$/lb x piece-lb` price.
2. **Bacon is 64% understated, and this changes nightly depletion.** `avg_oz_per_each`
   0.75 -> 1.23 oz/strip. See the callout in section B — it is the only change in this
   wave that moves a number the business already consumes every night.
3. **Four SKUs STOP.** Genoa, Capicola, Provolone and Pepperoni carry live
   `avg_oz_per_each` values that are neither Juan's measured table nor the piece-derived
   figure, and **no audit row explains how they got there**. Their packs and prices are
   written; their weights are not. This is the wave's most valuable finding and it
   needs Juan's word, not a script's.
4. **The jug supersede corrects a pack and a price together, or not at all.** Oregano
   and onion powder are single jugs. Writing the jug price against our quarter-jug pack
   would produce a **four-fold** cost error — worse than today. Section C shows the
   arithmetic that makes the paired write cost-per-ounce NEUTRAL.
5. **Section D's pin move unblocks for mozzarella and stays blocked for ham** — for the
   same unexplained-live-weight reason as (3). Predicted, not assumed: the gate is
   computed here through the real production function.

## Section A — the Boar's Head piece model (7 SKUs)

Harvest 2's structural find: every Delmar item carries `1 CT` in a subtitle the Purchases
grid never showed, and `Net Weight / Quantity` is the weight of ONE PIECE. There is no
case. So our pack becomes one piece, priced at `$/lb x piece-lb` — the $/lb is the
contract term and the piece weight is what varies.

Three independent checks run on every row before anything is planned:
  1. the rollup's `weight_source` must be `invoice_catch_weight` (never a fabricated 1.0 lb);
  2. harvest 2's per-piece weight must fall inside the min/max range harvest 1 derived
     ALGEBRAICALLY from the same invoices (two routes, one number);
  3. the implied oz-per-slice is cross-checked against Juan's measured table AND against
     what the live row actually carries.

── WOULD WRITE: pack chain + price ──
| our SKU | Angel product | $/lb | piece | piece oz | unit price | pack change |
|---|---|---:|---:|---:|---:|---|
| Turkey | `OVENGOLD TURKEY` | $6.29/lb | 9.251 lb | 148 oz | **$58.18** | 2x -> 1x148oz |
| Roast Beef | `LONDON BROIL` | $8.69/lb | 6.93 lb | 110.9 oz | **$60.23** | 2x -> 1x110.9oz |
| Provolone | `MILD PROVOLONE` | $3.49/lb | 5.502 lb | 88 oz | **$19.20** | 6x -> 1x88oz |
| Genoa | `DILANDRI GENOA SALAME` | $4.39/lb | 6.44 lb | 103 oz | **$28.26** | 6x -> 1x103oz |
| Capicola | `HOT BUTT CAPPY` | $5.45/lb | 3.592 lb | 57.5 oz | **$19.59** | 5x -> 1x57.5oz |
| Ever Roast Chicken | `EVERROAST CHICKEN` | $5.99/lb | 4.633 lb | 74.1 oz | **$27.74** | -x -> 1x74.1oz |
| Pepperoni | `Pepperoni Slicing` | $5.19/lb | 3.494 lb | 55.9 oz | **$18.13** | 3x -> 1x55.9oz |

**Two cent-level notes, so nobody has to wonder why these differ from the harvest doc.**

*The `pack change` column.* Five of these carry a legacy `Case of N` from the order-guide
seed. Harvest 2 says there is no case — the vendor invoices one piece — and Juan's own pars
already count pieces ("8 pcs", "5 Logs", "22 (not prepped)"). A par of 8 pieces against a
pack of one piece is exact; against a `Case of 5` it is 1.6 cases and the walker has to
invent a rounding rule. **This is the one structural change in the wave** — flagged rather
than buried in a summary count.

*Prices land ±$0.01 from the harvest doc's `cost_per_piece`.* We multiply by `oz_per_piece`
(the CSV's 1-dp figure, which IS our pack and divides evenly into the slice count); the doc
multiplied by `lbs_per_piece` at 3 dp. Turkey is $58.18 here vs $58.19 there — 148 oz is
9.2500 lb, 9.251 lb is 148.016 oz. Using our own pack's ounces keeps `unit_price` and pack
content the same fact; borrowing the doc's cent would not. Pepperoni is the one real gap:
the piece CSV quotes $5.09/lb (the window's FIRST price) while the rollup's latest is
$5.19 — we use the latest, which is why $18.13 here vs $17.79 in the doc.

── THE SLICE CROSS-CHECK (three opinions per SKU) ──
`derived` is piece_oz / slices_per_piece. Note what it is NOT: the harvest computed
`slices_per_piece` as floor(piece_oz / Juan's oz-per-slice), so dividing back is close to
an identity and the `vs Juan` column is a ROUNDING check, not corroboration. The column
that earns its place is `vs LIVE`.

| our SKU | piece oz / slices | derived | Juan (seed 10) | LIVE | derived vs Juan | derived vs LIVE | action |
|---|---:|---:|---:|---:|---|---:|---|
| Turkey | 148 / 148 | 1.0000 | 1 | 1 | ✓ | ✓ | no-op (already right) |
| Roast Beef | 110.9 / 74 | 1.4986 | 1.5 | 1.5 | ✓ | ✓ | no-op (already right) |
| Provolone | 88 / 117 | 0.7521 | 0.75 | 0.7 | ✓ | **+7.4%** | **STOP (live unexplained)** |
| Genoa | 103 / 103 | 1.0000 | 1 | 0.4 | ✓ | **+150.0%** | **STOP (live unexplained)** |
| Capicola | 57.5 / 57 | 1.0088 | 1 | 0.4 | ✓ | **+152.2%** | **STOP (live unexplained)** |
| Ever Roast Chicken | 74.1 / 74 | 1.0014 | _(no entry)_ | NULL | n/a | NULL | **WRITE 1** |
| Pepperoni | 55.9 / 224 | 0.2496 | 0.25 | 0.2 | ✓ | **+24.8%** | **STOP (live unexplained)** |

Read the `derived vs LIVE` percentages in that direction: `+150.0%` on Genoa means the piece
model's slice is two and a half times the live one — equivalently, production carries a slice
**60% lighter** than both other sources say.

## Section B — weight-file corrections (DB + the seed-10 constants)

Each correction below lands in TWO places in this PR: the live row, and the constant in
`scripts/seed/10-fill-sku-weights.ts`, so a future re-run of that seed cannot regress it.


### B1 — Bacon 0.75 -> 1.23 oz/strip ⚠ THIS MOVES NIGHTLY TOAST DEPLETION

```
Angel subtitle : GROCERY-REF-FZN · BACON · LAYER BACON · 12/14 · 1 CT
  "12/14" is a SLICE SPEC, not a size code: 12-14 strips per POUND.
Arithmetic     : 16 oz / 13 strips-per-lb = 1.2308 -> 1.23 oz/strip
  corroborated : the 240 oz box / 1.23 oz = 195 strips, inside the 180-210 the spec implies
  live today   : 0.75 oz/strip, which implies 21.3 strips/lb for bacon spec'd at 12-14
  understatement: +64.0%
Pack           : case=240oz — ALREADY CORRECT (240 oz = Angel's 15.0 lb box to the ounce). Not touched.
Price          : wave 2 already wrote $70.35 against that 240 oz box. Not touched.
```

**Depletion impact — read this before approving.** `avg_oz_per_each` is what a COUNT-unit
recipe line consumes, and bacon has one:

| recipe | line | depletes today | depletes after | change |
|---|---|---:|---:|---:|
| Cooked Bacon | 12 each | 9 oz | 14.76 oz | **+64.0%** |

Every batch of that recipe made from tonight forward depletes 64% more bacon than it does
today. That is the fix working — co-ops was under-consuming a real ingredient — but it will
visibly move bacon's on-hand burn and its variance the first night it runs, and Juan should
expect that rather than discover it. **Historical rows are untouched**: depletion is
append-only and every past row was point-in-time correct against the weight then in force.
On the Regular BLT (2-3 strips) this is $0.28-$0.42 of cost that was missing from a $10 item.


### B2 — Fresh Mozzarella 72 -> 192 slices, and the price that follows

```
1 log  = 32 CT x 1 oz = 32 oz = 2 lb    <- matches the "6/2 LB" pack field
1 case = 6 logs       = 12 lb            <- matches the "12 LB" subtitle
1 case = 192 slices  = 192 oz
The live 72 implies a 4.5 lb case — neither the 12 lb nominal nor the 12.76 lb measured.
Angel's measured net is 12.7642 lb (192 oz nominal x 1.064). That gap is brine and
packaging, not cheese, so the pack is 192 oz of CHEESE and the price divides by that.
```

Case price verified live from the rollup: unit_price_min = unit_price_max = $47.10 across
7 purchases (no price movement to model), and independently $3.69/lb x
12.7643 lb = $47.10. Two routes, one number.

**PFG/Fresh Mozzarella** [27066f2a-8e5c-4c60-8a0f-a62980241998] — primary (seed 18)
  before: (no chain) flat Case 1x72count avg_oz_per_each=NULL content=NULL
  after:  case=192x inner / inner=1 each, avg_oz_per_each=1 -> content=192 oz

**Baldor/Fresh Mozzarella** [c35dfb4f-492a-43e9-8551-3a0558b695f7] — backup (seed 18)
  before: case=72→level / inner=1each avg_oz_per_each=1 content=72 oz
  after:  case=192x inner / inner=1 each, avg_oz_per_each=1 -> content=192 oz
  ⚠ This twin is the row `10-fill-sku-weights.ts` actually wrote its 72 to (audit 2026-07-22).
    The harvest's punch-list item 2 names that file, so this row is the literal target of the
    correction — but its Angel evidence is the PFG/ROMA/BelGioioso line, so applying it here
    is an INFERENCE that both distributors ship the same BelGioioso case. It is safe (this
    twin carries no price rows, and its recipe pin resolves through avg_oz_per_each, which
    does not change) and it is what makes the two twins structurally identical, which is
    what section D needs. Flagged rather than buried.


### B3 — PFG Ham avg_oz_per_each = 1.0 (from Juan's own measured table)

```
PFG/Ham   [804cb32d-ea68-4467-8479-b82f34a143a0] avg_oz_per_each = NULL  (seed 18 PRIMARY: holds the par, the price and — eventually — the pins)
Baldor/Ham [15944b2d-881b-419e-bcdb-8d8c5412de5a] avg_oz_per_each = 1.2  (seed 18 BACKUP: holds the pins today)
Juan's measured table (seed 10): Ham 1.0 oz, "unit = one thin deli slice"
```


⚠ **This does NOT unblock section D for ham, and the brief expected it to.** Seed 18's pin
gate requires the line's oz MEANING to be identical on both twins. The Baldor twin carries
**1.2** oz/slice, not 1 — so after this write the gate compares 1.2 against 1, still
refuses, and the pins stay on the backup. Writing 1.0 here is nonetheless correct: it is
Juan's own measured number and the PFG twin currently has nothing at all. What is NOT
resolved is which twin is wrong, and that is the same unexplained-live-weight question as
section A's four STOPs. See the STOP list.

### B4 — Ever Roast Chicken: a new entry in the weights file

Handled in section A above (it is one of the seven piece-model SKUs). Restated here because
the harvest's punch list numbers it separately: the SKU exists live under Boar's Head with
`avg_oz_per_each = NULL` and no pack data of any kind, which is why wave 2 could not even
frame a decision-table row for it. Harvest 2 gives it both. The 1.0 oz/slice is the harvest's
proposal ("a sliced deli chicken breast, behaves like turkey"), corroborated by the piece
model at 74.1 oz / 74 slices = 1.0014 — and it is a fill into a NULL, not an overwrite.

## Section C — wave-1 price corrections (append-only supersede)

The pack recheck answers the oregano question outright: **`units_per_case = 1`. It is one
jug.** So wave 1's div-4 (oregano) and div-5 (onion powder) were not merely uncertain — the
way wave 2's re-sweep left them — they were wrong. There is no inner unit to divide by.

**Why the pack moves with the price, and why that is not scope creep.** `unit_price` is the
price of ONE OF OUR PACKS. Writing the jug price while our SKU still models a 20 oz
quarter-jug gives $55.27 / 20 oz = **$2.76/oz** against a true $0.69/oz — a four-fold error,
strictly worse than the state it replaces. The divisor and the pack are one fact seen twice,
so this section writes both or neither. The proof that this is safe is in the last two
columns: cost-per-ounce does not move by a hundredth of a cent.

**What is deliberately NOT corrected: the jug's WEIGHT.** These sit in a four-SKU cluster
Angel measures at exactly 1.20x nominal (5.0 -> 6.0 lb, and 1.5 -> 1.8 on the small oregano),
which is a feed artifact's signature rather than tare's — real tare does not scale
proportionally. The jug ounces below are the pack string's nominal 5 lb, which is also
verbatim the `angelCaseOz` wave 1's own division table already asserts. If Juan's scale says
6 lb, that is a separate one-line change to a different column.

── WOULD WRITE: pack + price, together ──
| our SKU | Angel row | divisor | before (price / pack) | after (price / pack) | $/oz before | $/oz after | check |
|---|---|---|---:|---:|---:|---:|---|
| Oregano | `OREGANO LEAVES` | ÷4 -> ÷1 | $13.82 / 20 oz | **$55.27** / 80 oz | $0.6910 | $0.6909 | **unchanged ✓** |
| Onion Powder | `ONION PWDR` | ÷5 -> ÷1 | $6.65 / 16 oz | **$33.25** / 80 oz | $0.4156 | $0.4156 | **unchanged ✓** |

── PENDING: the recheck rows wave 3 does NOT write ──
| our SKU | Angel row | the question | unblock |
|---|---|---|---|
| Garlic | `GARLIC WHL PLD DOM` | Price $19.72 is right (divisor was always 1). Angel measures the 5 lb tub at 6.00 lb — the same exact 1.20× as the two jugs. If real, cost/oz falls from $0.2465 to $0.2054 (-17%). | One garlic tub on the scale. The same 90 seconds settles all four members of the 1.20× cluster. |
| Parsley | `PARSLEY FRSH FLAT ITAL` | Price $15.20 is right (divisor 1). Angel measures the 1 lb box at 1.40 lb — 1.40×, which does NOT belong to the 1.20× cluster and for a bunch product is likely a real weight, not an artifact. | Weigh one box, or read a PFG invoice line. The harvest's own §2(b) says for fresh herbs the invoice weight is the trustworthy side and the pack string should be ignored — but that is a rule, not this box. |

There is also a SECOND oregano row in Angel — `OREGANO LEAVES` [ROMA] `1/24 OZ`, a 1.5 lb jug
at $24.41 — which quotes the same one SKU at a different size. That is a duplicate cluster in
wave 1's sense and needs Juan's pick of the row of record; it is out of scope here and
untouched. The 1/5 LB row is the one wave 1 used and the one corrected above.

## Section D — re-run seed 18's twin adjudication

Seed 18 refused to move the Ham and Fresh Mozzarella recipe pins from the Baldor backups to
the PFG primaries, and its refusal was exactly right: both pins read `1 unit`, `unit` is a
COUNT measure, so the line's oz value is the SKU's OWN `avg_oz_per_each` — which the PFG
twins did not have. Moving a pin would not have shifted a number, it would have DELETED one,
silently un-costing and un-depleting every consuming recipe.

Section B supplies the missing weights, so the gate is re-runnable. Below is what it will do,
computed HERE through `ozForRecipeInput` — the same production function seed 18 calls and
`lib/prep-consumption-graph.ts` uses — against the post-section-B shapes. This is a
prediction with the real function, not a claim.

| pair | pinned line | oz on BACKUP | oz on PRIMARY (post-B) | predicted gate |
|---|---|---|---|---|
| Fresh Mozzarella | Fresh Mozzarella (portioned) · 1 unit | Baldor 1 oz | PFG 1 oz | **GATE PASSES -> pin moves** |
| Ham | Ham (portioned) · 1 unit | Baldor 1.2 oz | PFG 1 oz | **GATE REFUSES -> pin stays** |

Predicted: **1 pin(s) move, 1 still refuse.**

The ham refusal is NOT the same failure seed 18 reported. Seed 18 refused because the PFG
side resolved to NULL — nothing to preserve. After section B it resolves to a real number
that simply is not the backup's, so the gate now refuses for the honest reason: **the two
twins disagree about what one slice of ham weighs.** That is the P2 product-identity gap the
seed-18 header predicted, arriving on schedule. It is in the STOP list.

In `--execute` mode this script then RUNS `scripts/seed/18-twin-adjudication.ts --execute` as a child process,
after sections A-C have landed, and reads the post-state back from the destination. In dry-run
it does not, and seed 18 is not invoked at all.

## Section E — Dried Chives, and the permanent supply-run gap


### E1 — Dried Chives -> US Foods (found, but not writable)

```
Angel row : Spice, Chive Chopped Plastic Shaker Shelf Stable Seasoning
            [Monarch] · US Foods · 6/1.12 OZ · $9.72/case · 1 purchase (Jul 17, 2026)
True cost : $9.72 / (6 x 1.12 oz = 6.72 oz = 0.42 lb) = **$23.14/lb**
            Angel prints $138.86/lb — exactly 6.0x too high, the dropped-multiplier bug
            (Angel stored ONE 1.12 oz shaker's weight as the whole 6-pack case's).
Our SKU   : Dried Chives [d0ae6c94-26e8-48a7-9b73-857d4428270a] vendor=(no vendor) pack_format=NULL units_per_pack=NULL each_size=NULL avg_oz_per_each=NULL chain_levels=0
```

**NOT WRITTEN.** The vendor hunt succeeded completely — we know the product, the vendor, the
pack and the true $/lb. What we do not have is a pack on OUR side: this SKU carries no
vendor, no pack format, no units, no each_size and no avg_oz_per_each. There is no
denominator. Binding a price to a SKU with no pack is precisely how `PICKLES CHIPS` became
$35.95/lb, so the answer goes in a decision table with the arithmetic already done:

| field | proposed value | evidence |
|---|---|---|
| vendor | US Foods | harvest 2 §4 — the only dried-chive row in Angel, found by name AND class search |
| pack chain | case = 6 x shaker; shaker = 1.12 oz | Angel pack string `6/1.12 OZ` |
| content | 6.72 oz (0.42 lb) | 6 x 1.12 |
| unit_price | $9.72 | Angel case price, 1 purchase Jul 17, 2026 |
| -> $/lb | $23.14 | in line with the other dried spices; Angel's $138.86 is the 6x bug |

Approve that pack and the vendor binding plus the price follow in one step. The competing
candidate is the 2024 costing sheet's "Dried Chives, b, $3.95 / 2 oz" (b = Baldor), which is
$31.60/lb — 37% higher and two years old. US Foods at $23.14/lb is the better and more
recent number, but it IS a lane we migrated away from, so it is Juan's call, not the
script's. The vendor binding is separable from the price if he wants only that.

### E2 — the permanent supply-run gap (a named category, not a backlog)

Six items were searched for in harvest 2 — by name AND by class, on a search that fuzzy-
matches both — and are genuinely absent from Angel. Not a lookup that failed: a category
Angel structurally cannot see. Five are low-volume, high-flavour-impact pantry goods and one
is resale snacks; all are bought on a grocery or restaurant-supply run rather than off a
distributor truck, and Angel can only ever cost what arrives on an integrated vendor's
invoice.

**The point of naming the category:** these must not sit in a vendor-unknown queue waiting for
a future harvest to resolve them. No harvest will. They need manual pricing, once, from a
receipt — and co-ops can hold that, because it starts from invoices generally rather than
from one distributor's feed. That is the actual competitive difference, stated as six rows.

| our SKU | finding |
|---|---|
| Lemon Oil | Nothing in Angel. Only lemon JUICE (3 SKUs) and lemonade. Appears on the sandwich build sheet at 0.1 oz. |
| Mixed Herbs | No product. `SPICES-SEASONINGS` exists as a class but carries no blend SKU. Likely a house mix rather than a purchased SKU. |
| Vanilla Bean Paste | No "vanilla" match anywhere in Angel. 2024 costing sheet has $54.80 / 32 oz with the vendor column blank. |
| White Wine | No alcohol in the account at all. Alcohol is very likely a purchasing lane we have never modelled. |
| Worcestershire | Nothing. Nearest condiment is a Cholula hot sauce (US Foods, 4/64 OZ). 2024 sheet: Baldor, $31.79 / 128 oz. |
| Utz Ripples | NO CHIPS OF ANY KIND across all four vendors — the only "CHIP" match is `PICKLES CHIPS 1/4`. Chips are bought outside Angel entirely. |

One near-miss worth keeping separate: **Pepperoncini** is not in Angel under that name, but two
functional neighbours are, both Delmar — `BANANA PEPPER RINGS` (Boar's Head, $8.75/case) and
`HOT CHERRY PEPPERS` ($8.95/case). Banana pepper rings are the closest match for a sandwich
line. **Both carry Angel's fabricated 1.0 lb weight**, so neither can be costed by weight until
a real case weight exists. That is a live sourcing question, not a permanent gap — it belongs
with the vendorless decision table from wave 2, not on the list above.

## Summary

|  | pack chains | weights | prices |
|---|---:|---:|---:|
| **Section A — Boar's Head piece model** | **7** | **1** | **7** |
| **Section B — weight corrections** | **2** | **3** | **1** |
| **Section C — jug supersedes** | **2** | **0** | **2** |
| Section D — seed-18 re-run | — | — | 1 pin move(s) predicted |
| Section E — decision tables only | 0 | 0 | 0 |
| **TOTAL would-write rows** | **11** | **4** | **10** |

`source` stamped on every written price row: `angel-harvest2-2026-08-20`
`effective_date`: per-product `last_seen` from the harvest, never today.

── STOP LIST: 5 — none of these are written; each needs Juan's word ──

#### Provolone — live avg_oz_per_each 0.7 is neither Juan's 0.75 nor the piece-derived 0.7521 — and no audit row explains it

```
  Juan's measured table (seed 10):   0.75 oz/slice — written 2026-07-22, audit row present
  piece model (harvest 2):           0.7521 oz/slice = 88 oz / 117 slices
  LIVE in prod today:                0.7 oz/slice (+7.4% from the piece model)
  slices per piece at the live weight: 125 (harvest 2 reports 117)
  $/slice at the live weight:        $0.1536 (harvest 2 reports $0.1636) — the harvest's $/slice is computed off seed 10's constants, so if LIVE is right this whole column is wrong
  depletion if overwritten:          "Provolone (portioned)" 1 unit -> 0.7 oz becomes 0.75 oz
```
> **UNBLOCK:** Confirm the real slice weight with Juan. If 0.7 is his floor number, seed 10's constant is the stale one and BOTH the harvest's slices-per-piece and its $/slice need recomputing. If 0.75 is right, an unaudited edit is live in production.

#### Genoa — live avg_oz_per_each 0.4 is neither Juan's 1 nor the piece-derived 1.0000 — and no audit row explains it

```
  Juan's measured table (seed 10):   1 oz/slice — written 2026-07-22, audit row present
  piece model (harvest 2):           1.0000 oz/slice = 103 oz / 103 slices
  LIVE in prod today:                0.4 oz/slice (+150.0% from the piece model)
  slices per piece at the live weight: 257 (harvest 2 reports 103)
  $/slice at the live weight:        $0.1100 (harvest 2 reports $0.2744) — the harvest's $/slice is computed off seed 10's constants, so if LIVE is right this whole column is wrong
  depletion if overwritten:          "Genoa (portioned)" 1 unit -> 0.4 oz becomes 1 oz
```
> **UNBLOCK:** Confirm the real slice weight with Juan. If 0.4 is his floor number, seed 10's constant is the stale one and BOTH the harvest's slices-per-piece and its $/slice need recomputing. If 1 is right, an unaudited edit is live in production.

#### Capicola — live avg_oz_per_each 0.4 is neither Juan's 1 nor the piece-derived 1.0088 — and no audit row explains it

```
  Juan's measured table (seed 10):   1 oz/slice — written 2026-07-22, audit row present
  piece model (harvest 2):           1.0088 oz/slice = 57.5 oz / 57 slices
  LIVE in prod today:                0.4 oz/slice (+152.2% from the piece model)
  slices per piece at the live weight: 143 (harvest 2 reports 57)
  $/slice at the live weight:        $0.1370 (harvest 2 reports $0.3406) — the harvest's $/slice is computed off seed 10's constants, so if LIVE is right this whole column is wrong
  depletion if overwritten:          "Capicola (portioned)" 1 unit -> 0.4 oz becomes 1 oz
```
> **UNBLOCK:** Confirm the real slice weight with Juan. If 0.4 is his floor number, seed 10's constant is the stale one and BOTH the harvest's slices-per-piece and its $/slice need recomputing. If 1 is right, an unaudited edit is live in production.

#### Pepperoni — live avg_oz_per_each 0.2 is neither Juan's 0.25 nor the piece-derived 0.2496 — and no audit row explains it

```
  Juan's measured table (seed 10):   0.25 oz/slice — written 2026-07-22, audit row present
  piece model (harvest 2):           0.2496 oz/slice = 55.9 oz / 224 slices
  LIVE in prod today:                0.2 oz/slice (+24.8% from the piece model)
  slices per piece at the live weight: 279 (harvest 2 reports 224)
  $/slice at the live weight:        $0.0650 (harvest 2 reports $0.0795) — the harvest's $/slice is computed off seed 10's constants, so if LIVE is right this whole column is wrong
  depletion if overwritten:          "Pepperoni (portioned)" 1 unit -> 0.2 oz becomes 0.25 oz
```
> **UNBLOCK:** Confirm the real slice weight with Juan. If 0.2 is his floor number, seed 10's constant is the stale one and BOTH the harvest's slices-per-piece and its $/slice need recomputing. If 0.25 is right, an unaudited edit is live in production.

#### Ham — Baldor/Ham carries 1.2 oz/slice; Juan's measured table and seed 10's own audit row both say 1

```
  Juan's measured table (seed 10): 1 oz — and the audit row from 2026-07-22 records seed 10 writing exactly 1 to this row
  LIVE on Baldor/Ham today:        1.2 oz — changed since, with NO audit row
  PFG/Ham (the primary):           NULL
  consequence: seed 18's pin gate compares 1.2 vs 1 and REFUSES; the ham pin stays on the backup twin
```
> **UNBLOCK:** Decide the real ham slice weight. Setting PFG/Ham to 1.2 instead would make the gate pass immediately — but it would ratify an unaudited value over Juan's measured one, which is the wrong way round to decide it.

These four-plus-one all have one shape, and it is worth naming: **a live `avg_oz_per_each`
that matches neither Juan's measured table nor the piece model, with no audit row explaining
the change.** Seed 10's audit rows from 2026-07-22 record it writing Juan's values to these
exact SKU ids; the values in production today are different, and nothing in `audit_log`
covers the difference. Either an unaudited edit reached production, or Juan corrected these
by hand from the floor and the seed file is the stale copy. **Both readings are plausible and
they imply opposite fixes**, which is why this script writes neither. If the live numbers are
his, then the harvest's own slices-per-piece and $/slice tables are computed off stale
constants and need recomputing — the corrected figures are in the section A table.

── REFUSALS / NO-OPS: 8 ──

**ALREADY_CORRECT** — 3

> The live row already carries the corrected value. Idempotency working — reported, not written.

- §A **Turkey** (avg_oz_per_each): live 1 already matches Juan's table and the piece model
- §A **Roast Beef** (avg_oz_per_each): live 1.5 already matches Juan's table and the piece model
- §B2 **Baldor/Fresh Mozzarella** (avg_oz_per_each): already 1

**LIVE_WEIGHT_UNEXPLAINED** — 4

> The LIVE avg_oz_per_each is neither Juan's table value nor the piece-derived value, and no audit row explains how it got there. Overwriting it would silently change what every consuming recipe depletes, in a direction nobody has signed off. Adjudicate before writing.

- §A **Provolone** (avg_oz_per_each): live 0.7, Juan's table 0.75, piece-derived 0.7521
- §A **Genoa** (avg_oz_per_each): live 0.4, Juan's table 1, piece-derived 1.0000
- §A **Capicola** (avg_oz_per_each): live 0.4, Juan's table 1, piece-derived 1.0088
- §A **Pepperoni** (avg_oz_per_each): live 0.2, Juan's table 0.25, piece-derived 0.2496

**OUR_PACK_UNRESOLVABLE** — 1

> Our own SKU cannot say what one pack is: no chain, and the flat columns carry no each_size/each_measure. There is no denominator, and inventing one is the PICKLES CHIPS $35.95/lb failure.

- §E1 **Dried Chives** (vendor + price): no vendor, no pack format, no units_per_pack, no each_size, no chain — nothing to price

── EVERY WOULD-WRITE ROW, IN FULL ──

**Pack chains (11)** — supersede-as-a-SET, then flat fields derived through the same
pure function the admin lib's sync-on-save uses. Never an in-place UPDATE, never a DELETE.

| § | SKU | vendor | before | after |
|---|---|---|---|---|
| A | Turkey | Boar's Head | `(no chain) flat Case 2x-` | `piece=148oz \| flat piece 1x148oz` |
| A | Roast Beef | Boar's Head | `(no chain) flat Case 2x-` | `piece=110.9oz \| flat piece 1x110.9oz` |
| A | Provolone | Boar's Head | `(no chain) flat Case 6x-` | `piece=88oz \| flat piece 1x88oz` |
| A | Genoa | Boar's Head | `(no chain) flat Case 6x-` | `piece=103oz \| flat piece 1x103oz` |
| A | Capicola | Boar's Head | `(no chain) flat Case 5x-` | `piece=57.5oz \| flat piece 1x57.5oz` |
| A | Ever Roast Chicken | Boar's Head | `(no chain) flat - -x-` | `piece=74.1oz \| flat piece 1x74.1oz` |
| A | Pepperoni | Boar's Head | `(no chain) flat Case 3x-` | `piece=55.9oz \| flat piece 1x55.9oz` |
| B | Fresh Mozzarella | PFG | `(no chain) flat Case 1x72count` | `case=192x inner / inner=1 each` |
| B | Fresh Mozzarella | Baldor | `case=72→level / inner=1each` | `case=192x inner / inner=1 each` |
| C | Oregano | PFG | `case=20oz` | `jug=80oz \| flat jug 1x80oz` |
| C | Onion Powder | PFG | `case=16oz` | `jug=80oz \| flat jug 1x80oz` |

**Weights (4)** — `vendor_items.avg_oz_per_each`, the value every COUNT-unit recipe line depletes.

| § | SKU | vendor | from | to | arithmetic | depletion impact |
|---|---|---|---|---|---|---|
| A | Ever Roast Chicken | Boar's Head | NULL | **1** | 74.1 oz / 74 slices = 1.0014 -> 1 | no count-unit recipe pin — this SKU's lines are weight-denominated, so nothing depletes differently |
| B | Bacon | Boar's Head | 0.75 | **1.23** | 16 oz / 13 strips-per-lb (the "12/14" spec) = 1.2308 -> 1.23 | Cooked Bacon: 9 oz -> 14.76 oz (**+64.0%**) |
| B | Fresh Mozzarella | PFG | NULL | **1** | the SKU name says it: MOZZ 1OZ SLCD, and 32 CT x 1 oz = 2 lb closes against the 6/2 LB pack field | none today (this twin carries no recipe pins); it is what lets section D's pin move preserve its oz meaning |
| B | Ham | PFG | NULL | **1** | Juan's measured slice table, scripts/seed/10-fill-sku-weights.ts: { name: "Ham", avgOz: 1.0, note: "unit = one thin deli slice" } | none today (the PFG twin carries no recipe pins); it exists so section D's pin move has a value to preserve |

**Prices (10)** — appended to `vendor_price_history`; nothing is ever modified in place.

| § | SKU | vendor | Angel row | unit price | effective | arithmetic |
|---|---|---|---|---:|---|---|
| A | Turkey | Boar's Head | `OVENGOLD TURKEY` | **$58.18** | 2026-08-10 | $6.29/lb x 9.25 lb (one piece = 148 oz) = $58.18 |
| A | Roast Beef | Boar's Head | `LONDON BROIL` | **$60.23** | 2026-08-10 | $8.69/lb x 6.9313 lb (one piece = 110.9 oz) = $60.23 |
| A | Provolone | Boar's Head | `MILD PROVOLONE` | **$19.20** | 2026-08-10 | $3.49/lb x 5.5 lb (one piece = 88 oz) = $19.20 |
| A | Genoa | Boar's Head | `DILANDRI GENOA SALAME` | **$28.26** | 2026-08-10 | $4.39/lb x 6.4375 lb (one piece = 103 oz) = $28.26 |
| A | Capicola | Boar's Head | `HOT BUTT CAPPY` | **$19.59** | 2026-08-10 | $5.45/lb x 3.5938 lb (one piece = 57.5 oz) = $19.59 |
| A | Ever Roast Chicken | Boar's Head | `EVERROAST CHICKEN` | **$27.74** | 2026-08-10 | $5.99/lb x 4.6312 lb (one piece = 74.1 oz) = $27.74 |
| A | Pepperoni | Boar's Head | `Pepperoni Slicing` | **$18.13** | 2026-08-10 | $5.19/lb x 3.4937 lb (one piece = 55.9 oz) = $18.13 |
| B | Fresh Mozzarella | PFG | `CHEESE MOZZ 1OZ SLCD LOG 32 CT` | **$47.10** | 2026-08-14 | $47.10 per case / 1 (our pack IS the case: 192 oz = Angel's 192 oz) = $47.10  [= $0.2453/slice] |
| C | Oregano | PFG | `OREGANO LEAVES` | **$55.27** | 2026-08-14 | $55.27 per jug / 1 (units_per_case = 1) = $55.27  [was $13.82 = $55.27 / 4] |
| C | Onion Powder | PFG | `ONION PWDR` | **$33.25** | 2026-07-31 | $33.25 per jug / 1 (units_per_case = 1) = $33.25  [was $6.65 = $33.25 / 5] |

---

**NOTHING WAS WRITTEN.** Re-run with `--execute` once Juan has signed off on the tables above.
Seed 20 done (dry run).
