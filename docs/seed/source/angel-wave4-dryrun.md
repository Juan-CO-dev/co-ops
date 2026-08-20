# Angel fill — WAVE 4 DRY RUN (the refusal resolutions)

**Status: NOTHING HAS BEEN WRITTEN.** This is the output of
`scripts/seed/21-angel-wave4.ts` in its default (dry-run) mode. The script writes only
under an explicit `--execute` flag, and that flag is not used until Juan has eyeballed
the tables below.

**Generated:** 2026-08-20, against `docs/angel-purchase-history.csv`, `docs/angel-products-rollup.csv` and `docs/angel-pack-recheck.csv`
and live prod (`bgcvurheqzylyfehqgzh`). Every SKU id, vendor, pack chain, par and existing
price below was resolved live at run time.

---

## Read this first — the five things that matter

1. **Nothing in this wave changes what anything DEPLETES.** Every write here moves a
   pack CONTENT or a vendor attribution; not one touches `avg_oz_per_each`, which is the
   column a count-unit recipe line consumes. Wave 3 moved bacon by 64% and that was worth
   a callout — this wave's equivalent callout is that there is nothing to call out.
   Costing moves; depletion does not.
2. **This is the SECOND dry run, and two of its predecessors' held rows are now writes.**
   Run 1 refused Beef Base (no pack on our side, two competing Angel rows) and held garlic
   (caught between Juan's own two rulings), tabling both with the arithmetic finished. He
   ruled on 2026-08-20 and both are folded in below — §A2 and §C — with his words quoted at
   the point of the write. **The garlic ratification also narrows the scale gate to oregano
   and onion powder alone**, which is now the only physical measurement this arc still waits
   on. One row from the herb policy is still refused: fresh chives breaks the policy's
   hidden premise (that one of our packs is one Angel unit).
3. **Angel's lettuce belongs to neither twin.** Our registry says Sysco or Baldor; every
   head of iceberg in the window came from PFG or US Foods, for $3,230.74. The pair can
   be shaped correctly (section B) and cannot be priced at all. Section B names the four
   candidate rows; it creates no SKU.
4. **The 8 unadjudicated multi-vendor pairs are enumerated here for the first time.** The
   audit that found them recorded only the count; the list itself lived in a subagent
   transcript nobody filed. All 8 share one shape, so they are probably one decision
   rather than eight.
5. **`INVOICE_DERIVED` is a new weight class, not a relabelling.** Wave 3 split SPEC from
   OPERATIONAL. Fresh herbs are neither: nobody here weighs them and the label is
   fiction, so the honest number is what the grower actually delivered, averaged. The
   class rides into every audit row so the queued weight audit can tell the three apart.

## Section A — the four vendor bindings

All four SKUs below sat in wave 2's `vendor unknown` decision table. Juan ruled on
2026-08-20 and this section spends those rulings. Three confirm wave 2's guess; one
(Dried Chives) overrides a LOW-confidence guess with a found invoice, which is the
system working as designed.

**A binding is not a price, and two of these four bind and stop.** Mortadella and Utz
Ripples have no Angel row at all — one because nothing on the menu uses it, one because
Angel has never seen a bag of chips — so there is no invoice to derive a price from and
there never will be. That is the intended outcome rather than a shortfall: binding an
unpriceable SKU still makes it ORDERABLE, which is what a vendor is for.

The other two both had packless SKUs on our side, and run 1 refused both prices for it. Juan
has since supplied the missing pack for each — the wave-3 table for Dried Chives (§A1) and
the jar model for Beef Base (§A2) — so both now carry a pack and a price.

| our SKU | vendor (Juan) | binding | price | Angel row |
|---|---|---|---|---|
| Beef Base | PFG | **BIND** (vendor was NULL) | price follows (§A1) | `BASE BEEF NO MSG` |
| Mortadella | Boar's Head | **BIND** (vendor was NULL) | bind only | _(no Angel row)_ |
| Utz Ripples | Country Snacks | **BIND** (vendor was NULL) | bind only | _(no Angel row)_ |
| Dried Chives | US Foods | **BIND** (vendor was NULL) | price follows (§A1) | `Spice, Chive Chopped Plastic Shaker Shelf Stable Seasoning` |

Vendor registry checked live: every vendor Juan named is **already registered and active**,
so the seed-15 (Delmar) registration path is not needed by this wave. `Country Snacks` in
particular has been on the books with zero SKUs since before the Angel arc started — wave 2
noticed that and used it as the basis for its MEDIUM-confidence guess. This binding is the
first SKU it has ever held.

### A1 — Dried Chives: the pack wave 3 tabled, now written

Wave 3 found this product completely — vendor, pack, case price, true $/lb — and still
refused, because OUR side had no pack: no vendor, no format, no units, no each_size, no
chain. It published the answer as a five-row decision table and said in terms: *approve
that pack and the vendor binding plus the price follow in one step.*

**Juan approved the item, and this section reads that as approval of the tabled package.**
That is an INFERENCE and is flagged as one, exactly like section B's primary. If he meant
the vendor only, the pack and price come straight back out and the binding stands alone.

```
Angel row : Spice, Chive Chopped Plastic Shaker Shelf Stable Seasoning
            [Monarch] · US Foods · 6/1.12 OZ · $9.72/case · 1 purchase (Jul 17, 2026)
Pack      : 6 x 1.12 oz = 6.72 oz = 0.42 lb per case
Price     : $9.72 / 0.42 lb = $23.14/lb
            Angel prints $138.86/lb — exactly 6.0x too high, the dropped-x6 bug
            (Angel stored ONE 1.12 oz shaker's weight as the whole 6-pack case's).
Our SKU   : Dried Chives [d0ae6c94-26e8-48a7-9b73-857d4428270a] vendor=(no vendor) chain_levels=0 each_size=NULL
```

→ WOULD WRITE pack `case=6→shaker / shaker=1.12oz` and price **$9.72** (eff 2026-07-17), giving **$23.14/lb**.

### A2 — Beef Base: the jar model, ratified

The first dry run bound the vendor and refused the price, for two reasons: our SKU had no
pack of any kind, and PFG shows two competing beef-base rows that fail in opposite
directions. It tabled both questions with the arithmetic finished and a recommendation.
Juan took the recommendation.

> Juan 2026-08-20: Beef Base takes the jar model — the MINORS `BASE BEEF NO MSG` row, pack = 6 x 16 oz jars, unit_price = the $62.61 case price. The $/lb route is rejected: Angel's $9.34/lb is the case price over a GROSS weight that includes the glass jar (6.703 lb against a 6.0 lb nominal = 1.117x, the tare pattern harvest 2 §5 names for bottles), so multiplying it back by a nominal pack understates by 10.5%.

**The two candidate rows, kept in the record because a pick only means something beside
what it rejected:**

| Angel row | brand | pack | case $ | Angel $/lb | measured lb | nominal lb | lines | last seen | implied $/1 lb jar |
|---|---|---|---:|---:|---:|---:|---:|---|---:|
| `BASE BEEF NO MSG` | MINORS | 6/1 LB | $62.61 | $9.34 | 6.703 | 6 | 1 | Jul 24, 2026 | **$10.44** |
| `BASE BEEF NO MSG JAR` | RDGCRST | 1/1 LB | $9.72 | $1.40 | 6.943 | 1 | 3 | Aug 14, 2026 | **$9.72** |

- `BASE BEEF NO MSG` [MINORS] — A 6-pack of 1 lb jars. 6.703/6.0 = 1.117x = glass tare, so the 6.0 lb is the product and the case price is the contract term.
- `BASE BEEF NO MSG JAR` [RDGCRST] — Pack string says one 1 lb jar; the weight field says 6.943 lb. One of the two is wrong and Angel cannot say which. Bought 3x to MINORS' 1x, and more recently — so this may well be the actual buy.

**Why `$9.34/lb x our pack` was rejected, and why that reasoning outlives this row.** It is a
rule about a CLASS of product, not a fact about beef base. `priceFromPerLb` exists for
CATCH-WEIGHT goods — Delmar's deli meats — where the $/lb is the contract term and the
delivered weight is what varies; anchoring on $/lb there is right, and reading one invoice's
case price would freeze that delivery's particular weight into our cost forever. A Minor's
beef base is the mirror image: a manufactured fixed pack whose contract term IS the case
price. And Angel's weight here is worse than incidental —
```
  Angel measured case : 6.703 lb   against a 6 lb nominal = 1.117x
                        = the glass/bottle TARE pattern harvest 2 §5 names (bottles 1.17x)
  so Angel's $/lb     : $62.61 / 6.703 lb = $9.34/lb  <- case price over GROSS weight
  rejected route      : $9.34/lb x 6 lb = $56.04
  written instead     : $62.61 (the case price) = $10.44/lb of CONTENT
  gap                 : -10.5% — an understatement arrived at by an arithmetic
                        that looks MORE rigorous than the one it replaces
```

→ WOULD WRITE pack `case=6→jar / jar=16oz` (96 oz) and price **$62.61** (eff 2026-07-24), giving **$10.44/lb** of content.

**What this lights up.** The pin below is un-costed today — the SKU has no pack, so there is
no denominator to turn a recipe line into money. Nothing about its DEPLETION changes (a
weight-denominated line consumes the same ounces either way); what changes is that the line
acquires a cost for the first time.

| recipe | line | costs today | costs after |
|---|---|---:|---:|
| Beef Jus | 5 oz | **NULL — un-costed** | $3.26 |

## Section B — the lettuce pair: both-active, Sysco primary

Seed 18 listed Lettuce in `PENDING_PRODUCTS` and deliberately did not touch it: *"nothing
is unorderable and nothing is mis-costed today, and it has not been decided."* Juan has now
decided the shape — both-active, primary + backup, like ham.

**The route is not ham's route, and that decides which row gets written.** Ham had an
INACTIVE primary and an active backup, so seed 18 activates the PRIMARY (its step-1 write is
guarded `.eq("active", false)` on the primary id). Lettuce is the mirror image: the primary
is already active and the BACKUP is the inactive one. Seed 18 has no branch for that — at
its line 430 it emits a warning and moves on, explicitly "out of adjudicated scope". So the
write below is one seed 18 cannot make, and it is the only structural write in this section.

```
PRIMARY (inferred)  Sysco/Lettuce [7c161441-848f-4290-bc68-a8088e112961]
                    active=true weekday_par=NULL weekend_par=NULL pins=0
                    pack: box=15→level / inner=15oz
BACKUP              Baldor/Lettuce [8cbebce5-b2e5-4da4-8a17-17a2d756ec12]
                    active=false weekday_par=NULL weekend_par=NULL pins=0
                    pack: (no chain) flat - -x-
```

**The primary is an INFERENCE and is veto-able in one word.** Sysco is the currently-ACTIVE twin and the only one with a pack chain (box = 15 x 15 oz = 225 oz); the Baldor row is inactive, packless, priceless and pinless. Juan named the SHAPE, not the sides.

- backup activation: **WOULD WRITE** — Baldor/Lettuce `active: false -> true`.
- backup pars: already NULL, as the backup role requires. Nothing to do.

**⚠ The one thing the ruling does not reach.** Ham's primary holds a par (weekday 3), which
is what makes that pair orderable. **Neither lettuce twin has ever had a par.** So after this
section runs, the pair is correctly shaped and still unorderable — the walker has nothing to
suggest. Seed 18's rule on this is exact and wave 4 keeps it: *"Refusing to invent one."*
A par is a floor decision, and it is the one remaining thing standing between lettuce and a
working order line.

Both twins carry **zero recipe pins**, so no pin can move and none needs to — seed 18's
pin-preservation gate has nothing to gate. That is also why this pair was safe to leave
undecided for as long as it was: an un-adjudicated pair with no pins mis-costs nothing.

### B1 — the PFG-lettuce attribution finding

Our registry says lettuce comes from Sysco or Baldor. **Angel says every head of iceberg
bought in the five-week window came from PFG or US Foods.** Neither twin appears anywhere in
the purchase history — not once, under any spelling.

Both statements can be true at once: the twins are the ORDERING lane and Angel is the
INVOICE lane, and a distributor change that never reached the SKU registry would look exactly
like this. But they cannot both be COMPLETE, and the gap is not small:

| Angel row | brand | vendor | pack | lines | spend | unit price | lb/unit |
|---|---|---|---|---:|---:|---:|---:|
| `LETTUCE ICEBERG LINER` | PEAK FRS | PFG | 24/1 CT | 5 | **$1937.92** | $30.23–$32.98 | 41.726–42.2363 |
| `Lettuce, Iceberg Cleaned & Trimmed Fresh Ref` | Cross Valley Farms | US Foods | 4/6 EA | 5 | **$1050.15** | $35.49–$60.53 | 27.945–28.0231 |
| `LETTUCE ICEBERG C&T` | PACKER | PFG | 4/6 CT | 3 | **$140.61** | $46.87 | 41.114 |
| `LETTUCE CELLO ICEBERG CA` | PACKER | PFG | 1/24 CT | 2 | **$102.06** | $34.02 | 45.973 |

- `LETTUCE ICEBERG LINER` — The dominant row by a distance — 61 units, $1,937.92, and the one a new PFG/Lettuce SKU would most plausibly BE. A 24-count case at ~42 lb is ~1.75 lb per head, which reads like whole heads rather than the trimmed product.
- `Lettuce, Iceberg Cleaned & Trimmed Fresh Ref` — The single biggest PERCENTAGE price mover in the whole harvest ($1.27 -> $2.16/lb, +70.1%, wave 2 §4). Cleaned & trimmed, so a different product from the liner even though both are 'iceberg'. On the US Foods lane we migrated away from.
- `LETTUCE ICEBERG C&T` — PFG's own cleaned-&-trimmed line, and the direct competitor to the US Foods row above. Price never moved across 3 lines.
- `LETTUCE CELLO ICEBERG CA` — Cello-wrapped, 24 count. The smallest of the four and the one most likely to be an occasional substitute rather than a standing buy.

**$3230.74 of iceberg across 15 invoice lines, attributable to no SKU we hold.** For scale, that is
larger than any single line this arc HAS priced. It is also why wave 4 cannot price lettuce:
not "declines to" — cannot. There is no Angel row attributable to either twin, so any number
would be an attribution guess wearing arithmetic's clothes.

**Decision, not a write: does a PFG/Lettuce SKU need to exist?** The candidate is
`LETTUCE ICEBERG LINER` — 5 lines, 61 units, the dominant row by a distance. Creating it is a
registry decision with knock-on effects (it would make lettuce a THREE-vendor product, and
the walker would then need to know which of three to suggest), so it is listed and **NOT
created**. If Juan says the lettuce lane moved to PFG, the cleaner answer may be re-pointing
the Sysco twin rather than adding a third row — but that is his call about the real world,
not an inference this script can make from a spend table.

## Section C — the fresh-herb / variable-catch weight policy

> Juan 2026-08-20: for fresh herbs and the variable-catch produce class, pack weight = the AVERAGE of the derived invoice weights, refreshed as new invoices land. The pack string is a unit size, not a content weight; the invoice is the measurement. Applies to basil, thyme, chives, parsley, garlic. The jug trio (oregano, onion powder, and the garlic pack WEIGHT) stays SCALE-GATED — that cluster is a separate question and one tub on a scale settles it.

**And the amendment, recorded rather than folded back in** — because a ruling edited in place
is a ruling nobody can audit:

> Juan 2026-08-20 (amending the jug-trio carve-out): the invoice evidence is accepted — a weight that VARIES per delivery is a real weighing and a weight that never moves is a feed constant. Garlic is the produce tub, it varies, so it takes the INVOICE_DERIVED average like the other fresh produce. The scale gate now covers ONLY oregano and onion powder, whose weights are byte-identical on every invoice.

Run 1 held garlic rather than picking, because the policy's two halves both landed on it: it
is named in the variable class AND our `Garlic` SKU is the very produce tub the jug-trio scale
gate covers. What it could add to the decision was one fact nobody had — the `spread` column
below. Garlic's per-tub weight moves between deliveries; oregano's is byte-identical on every
invoice for three months. Same 1.20x ratio, opposite fingerprints. Juan accepted that reading,
so garlic is written here and the gate narrows to the two jugs.

**Why this is a third weight class rather than a variant of the two we have.** Wave 3 split
one column into SPEC (what the label says) and OPERATIONAL (what our line produces). A box of
basil is neither: nobody here weighs it, and its `1 LB` pack string is a unit size rather than
a content weight. The honest number is what the grower actually delivered — averaged, because
for a bunch product there is no single true value to measure, only a distribution to summarise.

| class | means |
|---|---|
| `OPERATIONAL` | Observed here, or set by whoever actually produces the portion. Juan's surprise 3-sample slice averages are the canonical case; a vendor's own spec counts too when the vendor does the portioning and we do not (bacon's 12/14 layer box). |
| `SPEC` | Derived from a label, a pack string or an arithmetic identity, and awaiting a scale. A placeholder, not a peer of a measured value — wave 3 established that spec and operational diverge by -20% to -60% on every deli item Juan has actually weighed. |
| `INVOICE_DERIVED` | The average of what the vendor actually delivered, across every invoice line in the capture window. Neither a label nor a local measurement. This is the right class when the pack weight is genuinely a RANGE — bunch and catch-weight produce — because there is no single true number to measure, only a distribution to summarise. Refreshed as new invoices land. |

**Average, defined:** total net pounds received / total units received (quantity-weighted), over invoice lines whose weight_source is invoice_catch_weight. Two readings of "average" exist and they are
different computations; this one is the average weight of a box we actually RECEIVED (a line
covering four boxes counts four times) and it divides raw totals rather than figures the CSV
has already rounded. On today's data the two agree to better than 0.01% everywhere, which is
exactly why it is worth pinning now — while nothing depends on the choice.

**The exclusion that makes this safe.** Lines whose `weight_source` is not
`invoice_catch_weight` are dropped before any arithmetic. That is not hygiene, it is the whole
safety property — and section C1 shows it earning its keep on basil.

── WOULD WRITE: pack weight + the price that moves with it ──
| our SKU | Angel row | lines / units | avg lb | range | vs nominal | pack oz | price before | price after | $/oz before | $/oz after | $/oz change |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Basil | `BASIL FRSH` [PEAK FRS] | 4 / 7 | 1.4501 lb | 1.4495–1.4505 | 1.45x | 16 -> **23.2 oz** | — | $20.25 | — | **$0.8728** | _(was unpriced)_ |
| Thyme | `THYME FRSH` [PEAK FRS] | 1 / 1 | 0.47 lb | 0.47–0.47 | 1.88x | 4 -> **7.52 oz** | — | $16.54 | — | **$2.1995** | _(was unpriced)_ |
| Parsley | `PARSLEY FRSH FLAT ITAL` [PEAK FRS] | 6 / 8 | 1.3998 lb | 1.3995–1.4 | 1.4x | 16 -> **22.4 oz** | $15.20 | $15.20 | $0.9500 | **$0.6786** | **-28.6%** |
| Garlic | `GARLIC WHL PLD DOM` [PEAK FRS] | 7 / 21 | 5.996 lb | 5.9935–6.0077 | 1.199x | 80 -> **95.94 oz** | $19.72 | $19.72 | $0.2465 | **$0.2055** | **-16.6%** |

**Read the `$/oz change` column as the whole point of section C.** These are all corrections
in the SAFE direction — the pack gets bigger, so cost per ounce falls. A 16 oz nominal box of
basil that really holds 23.2 oz was making every basil-bearing recipe look 45% more expensive
than it is. Nothing here makes anything cheaper to BUY; it makes the cost we record match
what we actually received.

**Two of the four are live movers, and garlic is the bigger one.** Basil and thyme were
carrying no price at all, so their change is NULL-to-a-number and nothing re-costs. Parsley
and garlic already had prices, so every recipe consuming them re-costs the first time this
lands. Garlic's move also arrives exactly where wave 3 forecast it: its §C pending-recheck
table predicted $0.2465 -> $0.2054, -17%.

Recipe lines affected, read live rather than asserted:

| SKU | pins | recipes that re-cost |
|---|---:|---|
| Parsley | 1 | Garlic Bread / Compound Butter |
| Garlic | 8 | Garlic Mayo (Aioli) · Honey Chili Aioli · Mustard Aioli · Italian Salsa Verde · Garlic Bread / Compound Butter · Marinara · Green Goddess · Cesear Dressing |

**On garlic's 95.94 oz, where the ruling said 96.** The policy's own output is the invoice
mean, 5.9960 lb = 95.94 oz, and that is what is written. 96 is the same number to the nearest
ounce and reads better in a sentence, but hand-rounding it here would make the NEXT refresh —
which recomputes from the invoices — look like an unexplained drift of 0.06 oz. The other
three rows took their computed value for the same reason. Difference in cost per ounce:
0.06%.

**And nothing here changes depletion.** `avg_oz_per_each` is the column a count-unit recipe
line consumes, and section C does not touch it on any SKU. Basil's `6 leaf` pin still resolves
through its 0.017 oz/leaf; thyme's `12 sprig` still resolves through 0.02 oz/sprig. Only the
cost side moves.

── EVERY SKU THE POLICY NAMES, AND WHAT HAPPENED TO IT ──
| our SKU | our pack | Angel nominal | premise | invoice avg | spread | verdict |
|---|---:|---:|---|---:|---:|---|
| Basil | 16 oz | 16 oz | ✓ our pack = 1 Angel unit | 1.4501 lb (n=4) | 0.00069 | **WRITE pack 16 -> 23.2 oz + price $20.25** |
| Thyme | 4 oz | 4 oz | ✓ our pack = 1 Angel unit | 0.47 lb (n=1) | _(n=1 — no spread)_ | **WRITE pack 4 -> 7.52 oz + price $16.54** ⚠ n=1 |
| Parsley | 16 oz | 16 oz | ✓ our pack = 1 Angel unit | 1.3998 lb (n=6) | 0.00036 | **WRITE pack 16 -> 22.4 oz** (price already correct) |
| Chives | 4 oz | 8 oz | ⚠ OUR_PACK_IS_A_FRACTION | 0.81 lb (n=7) | **0 — never moved** | **REFUSED — OUR_PACK_IS_A_FRACTION** |
| Garlic | 80 oz | 80 oz | ✓ our pack = 1 Angel unit | 5.996 lb (n=7) | 0.00237 | **WRITE pack 80 -> 95.94 oz** (price already correct) |

**The `spread` column is the column to read twice.** It answers one binary question —
*did this number ever move?* — and it is the only thing in this table that distinguishes a
weight somebody weighed from a weight somebody stored. The ratio column cannot: garlic and
oregano both sit at 1.20x nominal, and one of them varies per delivery while the other is
byte-identical on every invoice for three months.

It is also the column that settled garlic. **Garlic moves; oregano does not** — and the
ratification turns that observation into the rule the next refresh will apply: a varying
weight is a weighing and takes the average, a frozen one is a stored number and waits for a
scale. Note what that does NOT claim: a zero spread is not proof of fabrication (a
manufactured jug fill really is constant). It proves only that no evidence of weighing is
present, which is exactly the state in which ninety seconds with a scale is worth spending.

Two rows still deserve a second look before approval:

- **Thyme rests on ONE invoice line.** An average of one is that one. The policy still
  applies — Juan's ruling is about which SOURCE to trust, not about sample size — and 0.47 lb
  against a 0.25 lb nominal is the largest gap in the set (1.88x), so leaving it at 4 oz is
  certainly wrong. But this is the row most likely to move when the next thyme invoice lands,
  and it is the one to re-run the policy over first.
- **Fresh chives never moved across 7 lines** (0.81 lb every time). That is a second,
  independent reason for caution beyond the pack-premise refusal that already stops it: a
  bunch product whose weight is identical seven times running does not behave like the bunch
  products this policy was written for.

### C1 — the basil duplicate, resolved by a filter rather than a judgement

Three Angel rows answer to our one `Basil` SKU, and wave 1's own division table carries all
three. The trap harvest 2 §2(c) names is that **because the pack string genuinely IS `1 LB`,
a fabricated 1.0 lb is indistinguishable from a correct 1.0 lb by inspection.** The only
reason the fabrication was ever caught is that a sibling with the identical pack string
measured 1.45 lb.

`weight_source` catches it with no sibling needed, which is why the resolution below is a
filter the code applies rather than a call someone makes:

| Angel row | brand | vendor | case $ | weight_source | verdict |
|---|---|---|---:|---|---|
| `BASIL FRSH` | PEAK FRS | PFG | $20.25 | `invoice_catch_weight` | **USE** |
| `BASIL FRSH` | FRSH ADV | PFG | $10.34 | `assumed_default_1lb` | REJECT |
| `Basil, Fresh Herb` | Cross Valley Farms | US Foods | $16.08 | `assumed_default_1lb` | REJECT |

- `BASIL FRSH` [PEAK FRS] — The only basil row in Angel with a real weight. 4 invoice lines, 1.4495-1.4505 lb/box — a narrow but non-zero spread, which is what a weighed bunch product looks like.
- `BASIL FRSH` [FRSH ADV] — Net weight is EXACTLY 1.0 x quantity on all 7 lines — Angel's fabrication, not a measurement. Its $10.34/lb is a case price wearing a $/lb label, which is why Angel ranks it as the mid-priced basil when it is very likely the cheapest. Pricing our pack from it would be the PICKLES CHIPS failure with better camouflage.
- `Basil, Fresh Herb` [Cross Valley Farms] — Same 1.000 signature, and additionally on the US Foods lane we migrated away from. Two independent reasons to leave it.

Note what the rejection costs and what it saves. The FRSH ADV row is the CHEAPEST basil on
the invoice at $10.34 a box, so rejecting it looks like leaving money on the table. It is the
opposite: its $10.34/lb is a case price wearing a $/lb label, and harvest 2's estimate is that
the box really weighs ~1.45 lb like its sibling, making its true cost **$7.13/lb** — the
cheapest of the three by a distance, where Angel ranks it in the middle. We reject it as a
PRICING SOURCE while noting it may well be the better BUY. Those are different questions and
this wave only answers the first.

## Section D — the still-stuck ledger (report only)

Everything wave 4 leaves exactly where it found it, with the one fact that would move each.

**The categories matter more than the rows.** `SUPPLY_RUN` is not a backlog — no future
harvest resolves it, because Angel can only cost what arrives on an integrated vendor's
invoice. `SCALE_GATED` is ninety seconds of Juan's time for a whole cluster.
`UNADJUDICATED_PAIR` is a decision, not a lookup. `POLICY_PREMISE` is a ruling that turned
out not to reach a row it named. Filing them all as "TODO" would lose exactly the
distinction that tells you which to do first.


**SCALE_GATED** — 1

| item | stuck on | unblock |
|---|---|---|
| Oregano (both jug sizes) + Onion Powder — pack WEIGHT | Angel measures the 5 lb jug at 6.001 lb on all THREE oregano lines and 6.002 on onion powder's single line — oregano's never moved in three months. A weight that never moves is a stored number rather than a weighing, so the 1.20x may be a feed artifact, in which case cost/oz is overstated by 17%. **This is now the WHOLE of the scale gate**: garlic left the cluster on 2026-08-20 when Juan accepted that its varying per-delivery weight is evidence of a real weighing, which is exactly the evidence these two lack. | One oregano jug on a scale. Settles both jugs at once — and it is the only physical measurement this arc is still waiting on for pricing. |

**WEIGH_PENDING** — 1

| item | stuck on | unblock |
|---|---|---|
| Ever Roast Chicken — oz per slice | Wave 3 filled 1.0 oz as a SPEC-class placeholder (74.1 oz piece / 74 slices). Every deli item Juan has actually weighed came in 20-60% under its spec, so this one almost certainly will too. | A surprise 3-sample weigh, the same way the five ruled SKUs were settled. |

**SUPPLY_RUN** — 3

| item | stuck on | unblock |
|---|---|---|
| Lemon Oil · Mixed Herbs · Vanilla Bean Paste · White Wine · Worcestershire | Genuinely absent from Angel — searched by name AND by class. Bought on a grocery or restaurant-supply run, so no distributor invoice will ever carry them. | One receipt, entered once, by hand. This is the category co-ops can hold and Angel structurally cannot. |
| Utz Ripples — PRICE (vendor now bound) | Section A binds the vendor Juan named, but Angel has no chips of any kind, so the PRICE side of this row stays on the supply-run list. Vendor and price were always separable questions; this is the row that demonstrates it. | A Country Snacks receipt. The SKU already carries a full pack (Box of 9 x 12.5 oz bags), so the price lands in one step. |
| Pepperoncini — vendor | Not in Angel under that name. Two functional Delmar neighbours exist (`BANANA PEPPER RINGS`, `HOT CHERRY PEPPERS`) but BOTH carry Angel's fabricated 1.0 lb weight, so neither can be costed by weight even if adopted. | Juan's word on whether banana pepper rings are the sourcing answer, plus a real case weight. |

**POLICY_PREMISE** — 1

| item | stuck on | unblock |
|---|---|---|
| Chives (fresh) — pack weight | The herb policy names chives, but our pack is HALF an Angel unit (divisor 2 from a pack string the measurement contradicts at 1.62x). Wave 2's rule for exactly this shape: when the divisor comes from a falsified pack string, the price is in doubt too. | Confirm what one of our chive packs physically is — a whole 8 oz box, or half of one. |

**UNADJUDICATED_PAIR** — 1

| item | stuck on | unblock |
|---|---|---|
| 8 multi-vendor pairs (Turkey · Roast Beef · Provolone · Capicola · Pepperoni · Banana Peppers · Hot Peppers · Sweet Peppers) | Named here for the first time — the audit recorded only the COUNT (11 products, minus Ham, Fresh Mozzarella and Lettuce = 8) and the enumeration lived in a subagent transcript that was never filed. All 8 share one shape: Boar's Head active and holding the par, Baldor inactive and empty. | Juan's per-pair word, or a single ruling covering the shape — every one of the 8 is the same decision. |

### D1 — the 8 unadjudicated multi-vendor pairs, enumerated

The multi-vendor audit of 2026-08-20 recorded that *"11 products have SKUs from 2+ vendors"*
and that *"Lettuce and the other 8 multi-vendor products were NOT adjudicated"*. It recorded
the COUNT. **The list itself lived in a subagent transcript that was never filed** — so no
artifact in the repo has ever said which 8. Below they are, derived live from
`vendor_items` rather than copied from anywhere, which is also a check that the count is
still 11.

| product | vendors | state | par held by (wkday/wkend) | adjudication |
|---|---|---|---|---|
| Banana Peppers | Baldor _(inactive)_ · Boar's Head | 1 active / 1 inactive | Boar's Head 1/– | **UNADJUDICATED** |
| Capicola | Baldor _(inactive)_ · Boar's Head | 1 active / 1 inactive | Boar's Head 8/16 | **UNADJUDICATED** |
| Fresh Mozzarella | Baldor · PFG | 2 active / 0 inactive | PFG 12/– | seed 18 (wave 3) |
| Ham | Baldor · PFG | 2 active / 0 inactive | PFG 3/– | seed 18 (wave 3) |
| Hot Peppers | Baldor _(inactive)_ · Boar's Head | 1 active / 1 inactive | Boar's Head 6/8 | **UNADJUDICATED** |
| Lettuce | Sysco · Baldor _(inactive)_ | 1 active / 1 inactive | **none** | **§B, this wave** |
| Pepperoni | Baldor _(inactive)_ · Boar's Head | 1 active / 1 inactive | Boar's Head 3/5 | **UNADJUDICATED** |
| Provolone | Baldor _(inactive)_ · Boar's Head | 1 active / 1 inactive | Boar's Head 8/16 | **UNADJUDICATED** |
| Roast Beef | Baldor _(inactive)_ · Boar's Head | 1 active / 1 inactive | Boar's Head 2/4 | **UNADJUDICATED** |
| Sweet Peppers | Baldor _(inactive)_ · Boar's Head | 1 active / 1 inactive | Boar's Head 6/8 | **UNADJUDICATED** |
| Turkey | Boar's Head · Baldor _(inactive)_ | 1 active / 1 inactive | Boar's Head 9/22 | **UNADJUDICATED** |

**11 multi-vendor products live; 2 settled by seed 18, 1 settled by §B above, 8 still open.**

**They share one shape, and that is the useful finding.** Every one of the open 8 is
Boar's Head ACTIVE and holding the par, against a Baldor row that is inactive, parless,
priceless and pinless. Not one of them looks like Ham (where both twins were live and the pins
sat on the wrong one) or like Lettuce (where the active side has no par). So these are
probably **one decision applied eight times** — most likely "the Baldor rows are dead history,
deactivate-and-forget" — rather than eight separate adjudications. Worth one question to Juan
rather than eight, and worth NOT guessing, because deactivating a row is the kind of thing
that is only obviously right until someone needs the second lane back.

## Summary

|  | vendor binds | activations | pack chains | prices |
|---|---:|---:|---:|---:|
| **Section A — vendor bindings** | **4** | **0** | **2** | **2** |
| **Section B — the lettuce pair** | **0** | **1** | **0** | **0** |
| **Section C — herb weight policy** | **0** | **0** | **4** | **2** |
| Section D — report only | 0 | 0 | 0 | 0 |
| **TOTAL would-write rows** | **4** | **1** | **6** | **4** |

`source` stamped on every written price row: `angel-wave4-2026-08-20`
`effective_date`: the observed invoice date, never today.

**Weight classes written this wave:** `SPEC`, `INVOICE_DERIVED`. No `avg_oz_per_each` is touched anywhere in this wave, so nothing depletes differently.

── REFUSALS / NO-OPS: 7 ──

**NO_ANGEL_ROW** — 2

> Angel has never invoiced this product, so there is no price to derive — only a vendor to bind. Not a lookup that failed: a product bought outside the integrated-distributor lane.

- §A **Mortadella** (price): No Angel row exists, so there is no current price to derive. The 2024 sheet's $4.29/16 oz is two years old and is not written. The SKU already carries a complete 16 oz pack and a 1 oz slice weight, so the day a mortadella invoice does land it is priceable in one step.
- §A **Utz Ripples** (price): Angel structurally cannot see this product, so no invoice-derived price exists or ever will. This SKU stays on the permanent supply-run list for PRICING even though its VENDOR is now settled — the two questions were always separable and this is the row that proves it.

**PAR_ABSENT** — 1

> Neither twin carries a par, so the pair is correctly shaped and still unorderable. Seed 18's rule holds: a par is Juan's call and this script refuses to invent one.

- §B **Lettuce** (primary par): neither twin has ever carried a par, so both-active leaves the pair correctly shaped and still unorderable

**ATTRIBUTION_UNRESOLVED** — 1

> Angel's rows for this product belong to vendors that are not either of our twins, so no Angel price can be attributed to our SKU. Any number would be an attribution guess wearing arithmetic's clothes.

- §B1 **Lettuce** (price): Angel's 4 iceberg rows ($3230.74) are all PFG or US Foods; our twins are Sysco and Baldor. No Angel price is attributable to either twin.

**ALREADY_CORRECT** — 2

> The live row already carries the value this wave would write. Idempotency working — reported, not written.

- §C **Parsley** (price): live price is already $15.20 — only the pack moves, and cost/oz moves with it
- §C **Garlic** (price): live price is already $19.72 — only the pack moves, and cost/oz moves with it

**PACK_PREMISE_BROKEN** — 1

> The herb policy assumes one of OUR packs is one ANGEL unit. Here it is not, so the average would have to be divided by a number that came from the same pack string the measurement just contradicted. Per wave 2's conflictImpact rule, that puts the price in doubt as well as the weight.

- §C **Chives** (pack weight): our pack is 4 oz against an Angel nominal of 8 oz (OUR_PACK_IS_A_FRACTION). Our pack is HALF an Angel unit (wave 1 records it as CASE_MULTIPLE, divisor 2) — so the policy's premise does not hold and the average cannot be applied directly. Note this is the FRESH chive, a different product from the `Dried Chives` SKU section A binds to US Foods.

── EVERY WOULD-WRITE ROW, IN FULL ──

**Vendor bindings (4)** — `vendor_items.vendor_id`, filling a NULL. Never an overwrite:
a SKU that already carries a vendor is refused as `VENDOR_DRIFT`, because re-attributing is a
different decision from attributing.

| § | SKU | vendor | ruling |
|---|---|---|---|
| A | Beef Base | PFG | Juan 2026-08-20: Beef Base -> PFG, and the jar model — MINORS row, 6 x 16 oz jars, $62.61/case. |
| A | Mortadella | Boar's Head | Juan 2026-08-20: Mortadella -> Boar's Head. His note: no current sub uses mortadella — keep it anyway, a shelf for the future. |
| A | Utz Ripples | Country Snacks | Juan 2026-08-20: Utz Ripples -> Country Snacks. |
| A | Dried Chives | US Foods | Juan 2026-08-20: Dried Chives -> US Foods. |

**Activations (1)** — `vendor_items.active`, false -> true, guarded on the row still reading inactive.

| § | SKU | vendor | role | why |
|---|---|---|---|---|
| B | Lettuce | Baldor | backup | Juan 2026-08-20: the Lettuce pair goes BOTH-ACTIVE, primary + backup like ham. The backup is the inactive side here, which is the mirror of the ham case seed 18 handles. |

**Pack chains (6)** — supersede-as-a-SET, then flat fields derived through the same
pure function the admin lib's sync-on-save uses. Never an in-place UPDATE, never a DELETE.

| § | SKU | vendor | class | before | after |
|---|---|---|---|---|---|
| A | Dried Chives | US Foods | `SPEC` | `(no chain) flat - -x-` | `case=6→shaker / shaker=1.12oz \| flat case 6x1.12oz` |
| A | Beef Base | PFG | `SPEC` | `(no chain) flat - -x-` | `case=6→jar / jar=16oz \| flat case 6x16oz` |
| C | Basil | PFG | `INVOICE_DERIVED` | `case=16oz` | `case=23.2oz \| flat case 1x23.2oz` |
| C | Thyme | PFG | `INVOICE_DERIVED` | `case=4oz` | `case=7.52oz \| flat case 1x7.52oz` |
| C | Parsley | PFG | `INVOICE_DERIVED` | `container=16oz` | `container=22.4oz \| flat container 1x22.4oz` |
| C | Garlic | PFG | `INVOICE_DERIVED` | `case=80oz` | `case=95.94oz \| flat case 1x95.94oz` |

⚠ **One deliberate non-change inside the chain sync.** `deriveFlatFieldsFromChain` derives
`pack_format` from the chain's ROOT LABEL, and on three of these SKUs the stored `pack_format`
already disagrees with that label (`Parsley` stores `Each (no case)` against a `container`
root; `Basil` and `Thyme` store `Case` against a lower-case `case`). Letting the sync run
would silently rename a display field this wave was not asked to touch, so the stored value is
**preserved** where one exists. The pre-existing desync is flagged rather than fixed — it
belongs to whoever owns that mirror, not to a weight-policy wave.

**Prices (4)** — appended to `vendor_price_history`; nothing is ever modified in place.

| § | SKU | vendor | Angel row | unit price | effective | arithmetic |
|---|---|---|---|---:|---|---|
| A | Dried Chives | US Foods | `Spice, Chive Chopped Plastic Shaker Shelf Stable Seasoning` | **$9.72** | 2026-07-17 | $9.72 per case / 1 (our pack IS the case: 6.72 oz) = $9.72  [= $23.14/lb] |
| A | Beef Base | PFG | `BASE BEEF NO MSG` | **$62.61** | 2026-07-24 | $62.61 per case / 1 (our pack IS the case: 96 oz) = $62.61  [= $10.44/lb of content, $10.44/jar] |
| C | Basil | PFG | `BASIL FRSH` | **$20.25** | 2026-08-14 | $20.25 per 1/1 LB unit / 1 (our pack IS one Angel unit) = $20.25  [= $0.8728/oz at the corrected 23.2 oz] |
| C | Thyme | PFG | `THYME FRSH` | **$16.54** | 2026-08-07 | $16.54 per 1/4 OZ unit / 1 (our pack IS one Angel unit) = $16.54  [= $2.1995/oz at the corrected 7.52 oz] |

---

**NOTHING WAS WRITTEN.** Re-run with `--execute` once Juan has signed off on the tables above.
Seed 21 done (dry run).
