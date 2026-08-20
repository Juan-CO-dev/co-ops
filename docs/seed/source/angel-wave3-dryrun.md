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
3. **The STOP list is RESOLVED — and it produced a distinction worth keeping.** The first
   dry run refused five weights as unexplained. Juan's 2026-08-20 ruling: those live values
   are **his own surprise measurements**, so they are not a competing opinion about one
   number — they are a *different* number. **Operational** (what a slice really weighs)
   versus **spec** (what it is supposed to weigh) had been sharing one column. Costing and
   depletion take operational. Nothing is written to those five rows; the seed-10 constants
   are amended to match so a re-run cannot regress his measurements.
4. **The jug supersede corrects a pack and a price together, or not at all.** Oregano
   and onion powder are single jugs. Writing the jug price against our quarter-jug pack
   would produce a **four-fold** cost error — worse than today. Section C shows the
   arithmetic that makes the paired write cost-per-ounce NEUTRAL.
5. **Section D now unblocks BOTH pairs.** With PFG/Ham mirroring the Baldor twin's measured
   1.2 oz, seed 18's pin gate passes for ham as well as mozzarella, so both recipe pins
   follow the par to the PFG primaries on execute. Predicted, not assumed: the gate is
   computed here through the real production function against post-§B shapes.

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

── THE SLICE TABLE: SPEC vs OPERATIONAL ──
`derived` is piece_oz / slices_per_piece — the piece model's implied slice weight. Note what
it is NOT: the harvest computed `slices_per_piece` as floor(piece_oz / the SPEC oz-per-slice),
so dividing back is near-identity. `derived` and `spec` agreeing means the harvest's own
arithmetic is self-consistent, and says nothing about what the line produces.

**The `LIVE` column is the operational weight, and Juan's ruling makes it the one that
counts.** Where a `ruled` value appears, that row is settled: live stands, nothing is written,
and the seed-10 constant moves to match it.

| our SKU | piece oz / slices | derived | spec (seed 10) | LIVE | ruled (Juan) | spec vs live gap | action |
|---|---:|---:|---:|---:|---:|---:|---|
| Turkey | 148 / 148 | 1.0000 | 1 | 1 | _(unruled)_ | ≈0% | no-op (already right) |
| Roast Beef | 110.9 / 74 | 1.4986 | 1.5 | 1.5 | _(unruled)_ | ≈0% | no-op (already right) |
| Provolone | 88 / 117 | 0.7521 | 0.75 | 0.7 | **0.7** ✓ruled | **+7.4%** | **KEEP LIVE (ruled)** |
| Genoa | 103 / 103 | 1.0000 | 1 | 0.4 | **0.4** ✓ruled | **+150.0%** | **KEEP LIVE (ruled)** |
| Capicola | 57.5 / 57 | 1.0088 | 1 | 0.4 | **0.4** ✓ruled | **+152.2%** | **KEEP LIVE (ruled)** |
| Ever Roast Chicken | 74.1 / 74 | 1.0014 | _(no entry)_ | NULL | _(unruled)_ | NULL | **WRITE 1** (spec — pending weigh) |
| Pepperoni | 55.9 / 224 | 0.2496 | 0.25 | 0.2 | **0.2** ✓ruled | **+24.8%** | **KEEP LIVE (ruled)** |

Read the gap column as *how far spec sits above operational*: `+150.0%` on Genoa means the
spec slice is two and a half times the real one — the line cuts genoa **60% thinner than the
spec assumed.** Four of five gaps run the same direction (operational lighter than spec),
which is what you would expect from a line slicing to a visual target rather than a scale,
and ham runs the other way (+20% heavier). None of that is a defect; it is the difference
between an intention and a measurement, and it is exactly the quantity costing needs.

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


### B3 — PFG Ham avg_oz_per_each = 1.2 (mirrors the Baldor twin's measured weight)

```
PFG/Ham    [804cb32d-ea68-4467-8479-b82f34a143a0] avg_oz_per_each = NULL  (seed 18 PRIMARY: holds the par, the price and — eventually — the pins)
Baldor/Ham [15944b2d-881b-419e-bcdb-8d8c5412de5a] avg_oz_per_each = 1.2  (seed 18 BACKUP: holds the pins today)
Juan's ruling (2026-08-20):        1.2 oz — the OPERATIONAL weight, surprise 3-sample average
seed 10's SPEC table (superseded): 1 oz — "unit = one thin deli slice"
```

**The earlier dry run proposed 1.0 here and that was wrong.** It read the seed-10 table as
floor truth and the live 1.2 as an unexplained edit. Juan's ruling inverts that: the 1.2 is
his own surprise measurement and the 1.0 was the aspirational figure. So the PFG twin takes
**1.2**, and the reason it may take it from the Baldor row rather than needing its own weigh
is physical, not clerical: **it is the same ham through the same slicer.** The twins are two
vendor identities for one product — that is the entire premise of the P1 adjudication — so a
slice off the PFG case and a slice off the Baldor case are the same slice. One measurement
covers both.

  → PFG/Ham NULL -> **1.2**, and with 1.2 on both twins section D's ham gate now PASSES.

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
| Ham | Ham (portioned) · 1 unit | Baldor 1.2 oz | PFG 1.2 oz | **GATE PASSES -> pin moves** |

Predicted: **2 pin(s) move, 0 still refuse.**

**Both pairs clear the gate.** Mozzarella was always going to once the PFG twin had a slice
weight. Ham is the one the ruling unlocked: the earlier dry run proposed writing the spec 1.0
to the PFG twin, which would have left the gate comparing 1.0 against the backup's measured
1.2 and refusing a second time — the right refusal for the wrong reason. Mirroring the
operational 1.2 instead makes the two sides agree because they now describe the same physical
slice, which is what the gate was always asking about.

Worth being precise about what the gate proves and what it does not. It proves the pinned
line's oz value is IDENTICAL before and after the move, so no recipe silently changes what it
costs or depletes. It does not prove 1.2 is the right number — that comes from Juan's scale,
not from this script. The gate is a preservation check, and preservation is exactly what a
re-point should guarantee.

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
| Section D — seed-18 re-run | — | — | 2 pin move(s) predicted |
| Section E — decision tables only | 0 | 0 | 0 |
| **TOTAL would-write rows** | **11** | **4** | **10** |

`source` stamped on every written price row: `angel-harvest2-2026-08-20`
`effective_date`: per-product `last_seen` from the harvest, never today.


## RESOLVED — the STOP list, settled by Juan's ruling (5 rows)

The first dry run refused five weights because production carried values matching neither the
seed-10 table nor the piece model, with no audit row explaining them. The ruling:

> Juan 2026-08-20: the live avg_oz_per_each values are HIS OWN measurements — 3-sample averages taken as a SURPRISE check, slicing unchanged and unbiased. Live = OPERATIONAL truth (what a slice really weighs); the seed-10 table = ASPIRATIONAL/SPEC weights (what it is supposed to weigh). Slices are normal thickness; operations differ from spec. Costing and depletion use the operational number. Do not 'correct' back from spec sheets.

**Why that is more than a tie-break.** The two numbers were never rival measurements of one
quantity — they are two quantities that had been sharing a column. A slice's SPEC weight is
what it should be at the intended thickness; its OPERATIONAL weight is what the line actually
produces. Costing and depletion answer "how much product left the building", so they take the
operational number. The measurements were taken as a SURPRISE check, so nobody was slicing to
the scale — which is what makes them usable as a baseline rather than a demonstration.

**No measured row is overwritten.** Every value in the `operational` column below is left
exactly as production carries it — the original refusal stands, now for a good reason rather
than an unresolved one. What DOES change is `scripts/seed/10-fill-sku-weights.ts`: its
constants move to the operational values with the ruling recorded inline, so a future re-run
of that seed cannot quietly restore the spec numbers over his measurements.

The one write in this neighbourhood is §B3, and it is a fill rather than an overwrite: the
PFG ham twin held NULL and now MIRRORS the Baldor twin's measured 1.2. Same ham, same slicer,
so one measurement covers both identities — and it is what lets §D's ham pin move.

| our SKU | spec (was) | **operational (live, kept)** | gap | slices/piece spec -> real | $/slice spec -> real | harvest doc said |
|---|---:|---:|---:|---:|---:|---:|
| Provolone | 0.75 | **0.7** | **-6.7%** | 117 -> **125** | $0.1641 -> **$0.1536** | $0.1636 |
| Genoa | 1 | **0.4** | **-60.0%** | 103 -> **257** | $0.2744 -> **$0.1100** | $0.2744 |
| Capicola | 1 | **0.4** | **-60.0%** | 57 -> **143** | $0.3437 -> **$0.1370** | $0.3406 |
| Pepperoni | 0.25 | **0.2** | **-20.0%** | 223 -> **279** | $0.0813 -> **$0.0650** | $0.0795 |
| Ham (Baldor — the measured twin) | 1 | **1.2** | **+20.0%** | — | — | n/a (not a Delmar piece) |

**The last three columns are the deliverable.** The harvest's own slices-per-piece and $/slice
tables were computed off the spec constants, so for these five they are wrong in the direction
that matters most: they UNDERSTATE how many slices a piece yields and therefore OVERSTATE what
a slice costs. Genoa is the extreme — 103 slices at $0.2744 on paper against 257 at $0.1100 on
the line, a 2.5x error in per-slice cost. Anyone costing a sandwich off the harvest doc rather
than this table is working from the wrong number.

Note the ruling does NOT reach every weight in this wave, and the boundary is physical rather
than clerical. It governs portions **we** cut, because only observing our line can tell you
what our slice weighs. Bacon (vendor-portioned 12/14 layer box) and fresh mozzarella
(manufacturer-sliced 32 CT log) are cut before they reach us, so the vendor spec IS their
operational fact — there is no slicer of ours for a surprise weigh to observe. Both also never
moved after seed 10 ran, where all five ruled SKUs did; that movement is the fingerprint of a
measurement, and its absence is the fingerprint of an untouched estimate.

── STOP LIST: 0 — none of these are written; each needs Juan's word ──
_(none — the ruling cleared the list, and no row has drifted off it since.)_

── REFUSALS / NO-OPS: 8 ──

**ALREADY_CORRECT** — 3

> The live row already carries the corrected value. Idempotency working — reported, not written.

- §A **Turkey** (avg_oz_per_each): live 1 matches both the spec table and the piece model — spec and operations agree here
- §A **Roast Beef** (avg_oz_per_each): live 1.5 matches both the spec table and the piece model — spec and operations agree here
- §B2 **Baldor/Fresh Mozzarella** (avg_oz_per_each): already 1

**OPERATIONAL_KEEP_LIVE** — 4

> RESOLVED by Juan's 2026-08-20 ruling: the live value is his own surprise-measured 3-sample average — the OPERATIONAL weight — and the seed-10 figure was the aspirational/spec one. Live stands, no write. The seed-10 constant is amended to match so a future re-run cannot regress the measurement.

- §A **Provolone** (avg_oz_per_each): live 0.7 = the ruled operational weight; spec was 0.75
- §A **Genoa** (avg_oz_per_each): live 0.4 = the ruled operational weight; spec was 1
- §A **Capicola** (avg_oz_per_each): live 0.4 = the ruled operational weight; spec was 1
- §A **Pepperoni** (avg_oz_per_each): live 0.2 = the ruled operational weight; spec was 0.25

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

The `class` column carries Juan's spec-vs-operational distinction into the data. **OPERATIONAL**
= observed, or set by whoever actually cuts the portion. **SPEC** = derived and awaiting a
weigh — a placeholder, not a peer of the measured values. It rides into the audit row so a
future reader can tell which numbers were seen and which were inferred.

| § | SKU | vendor | class | from | to | arithmetic | depletion impact |
|---|---|---|---|---|---|---|---|
| A | Ever Roast Chicken | Boar's Head | **SPEC** ⚠ | NULL | **1** | 74.1 oz / 74 slices = 1.0014 -> 1 | no count-unit recipe pin — this SKU's lines are weight-denominated, so nothing depletes differently |
| B | Bacon | Boar's Head | OPERATIONAL | 0.75 | **1.23** | 16 oz / 13 strips-per-lb (the "12/14" spec) = 1.2308 -> 1.23 | Cooked Bacon: 9 oz -> 14.76 oz (**+64.0%**) |
| B | Fresh Mozzarella | PFG | OPERATIONAL | NULL | **1** | the SKU name says it: MOZZ 1OZ SLCD, and 32 CT x 1 oz = 2 lb closes against the 6/2 LB pack field | none today (this twin carries no recipe pins); it is what lets section D's pin move preserve its oz meaning |
| B | Ham | PFG | OPERATIONAL | NULL | **1.2** | mirror of Baldor/Ham's live 1.2 oz — the same physical ham through the same slicer | none today (the PFG twin carries no recipe pins). Its purpose is section D: with 1.2 on both twins the pin's oz meaning is preserved and seed 18's gate passes, so the ham pin can finally follow the par to the primary. |

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
