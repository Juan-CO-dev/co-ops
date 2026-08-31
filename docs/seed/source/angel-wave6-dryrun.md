# Angel fill — WAVE 6 DRY RUN (the full price fill) + the receiving price-wiring recon

**Status: NOTHING HAS BEEN WRITTEN.** This is the output of
`scripts/seed/34-wave6-price-fill.ts` in its default (dry-run) mode. The script writes only
under an explicit `--execute` flag, and that flag is lead-gated and not used until Juan has
eyeballed the tables below.

**Generated:** 2026-08-30, against `docs/seed/source/angel-product-catalog.csv` and
`docs/seed/source/inventory-costing.csv`, and live prod (`bgcvurheqzylyfehqgzh`). Every SKU id,
pack shape and existing price below was resolved live at run time; every `ourPackOz` was
re-verified through the chain-aware `contentOzForSku` — the same derivation the cost board and
the receiving ledger ride — not the raw flat columns.

**The order (Juan, 2026-08-29), verbatim:**

> "why haven't we added the prices to the SKUs if we have all the pricing already… pricing
> should update from what we are receiving. But we can and should seed it since we have it
> basically on tap with angel spend."

That is two questions. § A–D answer the seed half. **§ E answers the receiving half**, and it is
the more consequential finding of the two.

---

## Read this first — the five things that matter

1. **11 SKUs get a price; coverage goes 29 → 40 of 169 active SKUs (17.2% → 23.7%).** That is
   the honest yield, and it is far short of "we have all the pricing already". The rest of this
   document is the answer to *why*, SKU by SKU, with the arithmetic finished on every row so
   each one can be ratified in a single line.
2. **The 2024 costing sheet is not a second source — it is our own echo.** The brief for this
   wave named `inventory-costing.csv` as a co-equal price source. It cannot be one:
   `scripts/seed/02-skus.ts:137` (`loadInventoryPacks`) **seeded our SKUs' `each_size` from
   column 4 of that very file** — the column beside the price. So "the 2024 row matches our pack
   exactly" is a tautology for ~20 of the priceless SKUs, not corroboration. Details in § B.
3. **The single largest blocker is Delmar, at 15 SKUs — and it is one question, not fifteen.**
   Every Delmar row carries a case price and no denominator. All 15 need the same sentence from
   Juan: *is one Delmar unit one of our packs?* Three of them (Branded Water, Coke, Diet Coke)
   already have the count independently confirmed from two other sources.
4. **62 of the 140 priceless SKUs are the SUPPLY-RUN class and can never be closed from this
   source.** Angel Spend is a menu-costing service; its vendors are PFG, US Foods, Delmar,
   Cardinal and Baldor. Trimark, Webstaurant, Amazon, Vistaprint and Continental Tape do not
   appear in it at all, and most of those SKUs carry no pack fields either. Saying so plainly is
   the finding — not a shortfall to be papered over with a guessed number.
5. **The receiving price wire is NOT dead code. It fired, once, and wrote the only non-seed row
   in the ledger.** The price box exists and works; it is rendered *only on an expanded line*,
   and the ordinary door flow collapses every templated line. See § E — this is an affordance
   gap, not a plumbing bug, which is why this PR changes no receiving code.

---

## § A — WOULD WRITE: 11 price rows

Every row below is `unit_price` = **the price of ONE OF OUR PACKS** (our order unit), which is
the series' convention and the whole job: Angel quotes the price of one of its CASES, and
writing that straight through overstates cost by the divisor. The `2024 cross-check` column is
printed for scrutiny only — **it is never an input to the price.**

| our SKU | Angel row | case $ | ÷ | unit price | relation | 2024 cross-check |
|---|---|---:|---:|---:|---|---|
| Duke's Mayo | `MAYO HD` [DUKES] 4/1 GA | $73.99 | ÷4 | **$18.50** | CASE_MULTIPLE · rounded | $18.50 / 128 oz — agrees **to the cent** |
| Olive Oil | `OIL OLIVE 100% EXTRA VIRGIN` [ASSOLUTI] 3/3 LT | $93.72 | ÷3 | **$31.24** | CASE_MULTIPLE | $30.86 / 101.43 oz — 1.2% under |
| Balsamic Vin | `VINEGAR BALSAMIC` [PIANCONE] 2/5 LT | $34.51 | ÷2 | **$17.26** | CASE_MULTIPLE · rounded | $15.65 / 169.07 oz — 10% under, two years back |
| Canola Oil | `OIL CANOLA CLR FRY` [PACKER] 1/35 LB | $40.56 | ÷1 | **$40.56** | PACK_AGREES | — none |
| Arugula | `ARUGULA BABY` [PACKER] 2/2 LB | $20.67 | ÷1 | **$20.67** | PACK_AGREES | $17.91 / **48** oz — a different pack, old lane |
| Parmesan (Grated) | `CHEESE PARMESAN GRATED TUB` [ROMA] 4/5 LB | $76.03 | ÷1 | **$76.03** | PACK_AGREES | no parmesan row (Pecorino ≠ Parmesan, not conflated) |
| Watermelon Radish | `RADISH WATERMELON` [PACKER] 1/10 LB | $24.02 | ÷1 | **$24.02** | PACK_AGREES | $0.70 / 6 oz — a per-bunch line, not comparable |
| Black peppercorn | `PEPPER BLK WHL` [ROMA] 1/5.75LB | $51.53 | ÷1 | **$51.53** | PACK_AGREES | sheet lists it **twice**, $1.29 and $1.14/oz (retail tubs) |
| Saratoga | `WATER SPRKLNG SPRING GLASS` [SARATOGA] 24/12 OZ | $24.86 | ÷1 | **$24.86** | PACK_AGREES | — none |
| Natalie's Lemonade | `JUICE LEMONADE NAT` [NATALIES] 6/12 OZ | $10.63 | ÷1 | **$10.63** | PACK_AGREES | $11.05 / 6 ea — 4% over, old lane |
| Cannoli Shell | `SHELL CANNOLI SM` [ROMA] 1/120 CT | $42.67 | ÷1 | **$42.67** | COUNT_AGREES | $57.70 / **200** ea — a different pack |

### Three things about this table

**`COUNT_AGREES` is new, and it is deliberate.** Cannoli Shell's pack is `120 count` with no
per-shell weight on our side — seed 30 left that open in writing (*"the per-shell WEIGHT stays
open until Juan weighs one"*). It does not need one: when our pack **is** Angel's pack, the
price needs no denominator at all. Wave 2 did this once for the Cardinal sub roll; wave 6 makes
it a named relation so nobody later "fixes" it by inventing an ounce basis — which would be the
§C.3 PICKLES CHIPS failure exactly.

**Four rows are same-row consistent by construction.** Canola Oil, Parmesan, Watermelon Radish
and Cannoli Shell had their pack shapes DERIVED by seed 30 from the very catalog rows now
pricing them. Pack and price come from one line of one document, so `unit_price` is definitionally
the price of that pack — the strongest form available short of an invoice.

**Two rows land on a half-cent and round up.** `$73.99 ÷ 4 = $18.4975` and
`$34.51 ÷ 2 = $17.255`. The tie rule is live data here, not a hypothetical, and both notes carry
the unrounded quotient so the ledger row can be reconstructed without re-reading the CSV.

---

## § B — Why the 2024 costing sheet is not a price source

The brief named `inventory-costing.csv` as one of "the two price sources". The repo disagrees in
three independent places, and the third is decisive:

1. **The reconciliation report's own source table** rates it *"2024 manual costing ancestor —
   Historical, unversioned, internally inconsistent in places"*, against the catalog's "SOURCE
   WITH DOCUMENTED DEFECTS". Its §C.4 triangulates 25 comparable pairs: **9 agree, 16 conflict.**
2. **Wave 4 already set the precedent.** It refused the sheet as a price of record when a fresher
   Angel row existed (*"two years old, and on a lane we migrated away from"*), and for Mortadella
   it bound the vendor and **deliberately declined to write the price** with the sheet's
   `$4.29 / 16 oz` sitting right there. Wave 6 follows that ruling rather than reversing it.
3. **It cannot corroborate our packs, because it *is* our packs.** `scripts/seed/02-skus.ts:137`:

   ```ts
   const rows = readCsv("inventory-costing.csv");
   …
   idx.set(key, { unitsPerPack: 1, eachSize: qty, eachMeasure: measure });   // qty = column 4
   ```

   Our `each_size` was seeded from the same row whose column 3 is the price. When Celery's sheet
   row says `96 oz` and our SKU says `96 oz`, that is one number counted twice. Roughly twenty of
   the priceless SKUs show this exact-match signature, and reading it as agreement would be
   reading our own echo back as evidence.

The sheet's internal looseness is visible in this wave's own data: it carries **Black Pepper
twice** at $1.29 and $1.14/oz, **tomato paste twice** at $10.70/111 oz and $64.25/1626 oz (a 15×
denominator disagreement inside one file), and prices red-wine and apple-cider vinegar at an
identical $13.39/169.07.

**So it is used here in exactly two roles:** as a printed cross-check beside a fill (§ A), and as
a HELD tier of 9 SKUs (`COSTING_SHEET_ONLY_2024`) presented with finished arithmetic for Juan to
ratify or reject. Nothing is written from it.

---

## § C — REFUSED: 47 SKUs, each with the arithmetic finished

| code | SKUs | what is actually blocked |
|---|---:|---|
| `DELMAR_NO_PACK_SIZE` | 15 | Case price, no denominator. **One question, fifteen rows.** |
| `COSTING_SHEET_ONLY_2024` | 9 | Only candidate is the 2024 ancestor (§ B). Held, not written. |
| `NO_OZ_BASIS` | 6 | Angel's row is a count/volume parse; our pack is in ounces. |
| `DUPLICATE_CLUSTER` | 5 | Two+ live rows quote one SKU at different prices. |
| `PACK_CONFLICT` | 3 | Both packs are real numbers with no whole relation between them. |
| `US_FOODS_HISTORICAL` | 3 | A lane we already migrated off. Cross-check only. |
| `OUR_PACK_UNRESOLVABLE` | 3 | Our SKU has no pack fields at all — nothing to denominate. |
| `PACK_SHAPE_OPEN` | 1 | **Our own** pack shape is a flagged-open question. |
| `AMBIGUOUS_PRODUCT_IDENTITY` | 1 | The candidate may be a different product. |
| `HIGH_PPL_REVIEW` | 1 | The exporter flagged its own $/lb implausible. |

Six codes are reused verbatim from waves 1–2 — **an unchanged reason keeps its name**, because a
second spelling for one reason is the drift this series exists to prevent. Four are new to wave 6.

### The rows most likely to become writes on one sentence from Juan

| SKU | code | would be | the one question |
|---|---|---:|---|
| **Branded (C/O) Water** | DELMAR | **$12.95** | Angel's $12.95 matches the 2024 sheet's `$12.95 / 24 ea` **to the cent across two years**, and Juan independently labelled the pack 24 × 12 fl oz on 2026-08-28. Three sources agree. Is one Delmar unit our 24-pack? |
| **Coke** / **Diet Coke** | DELMAR | **$25.45** ea | Juan labelled 35 × 12 fl oz; the sheet says $23.95 / 35 ea, so the COUNT is independently confirmed and Angel is +6% over two years. Same question. |
| **Cholula** | US_FOODS | **$17.47** | $69.86 ÷ 4 sits **2% from the sheet's $17.85** — two independent sources agree. Blocked only because our SKU is a Baldor line and the sole Angel row is US Foods. A PFG/Baldor quote makes this an instant write. |
| **Horseradish** | US_FOODS | **$21.23** | Pack relation is clean (1 GA = 128 oz = our pack). Only the lane is wrong. |
| **Roasted Red Peppers** | NO_OZ_BASIS | **$49.81** | Our 612 oz already implies ~102 oz per #10 can, which is self-consistent — but implying is not reading. One can label closes it. |

### The refusals that are really about *our* data, not Angel's

- **Chicken Breast** (`PACK_SHAPE_OPEN`) — seed 30 A-flagged the case-vs-bag question **in
  writing**: *"if CO actually orders the 4-bag case, units_per_pack becomes 4"*. Live now reads as
  the case, which is the **opposite** of what seed 30 proposed to write. The two answers are
  **$63.58 and $15.90 — 4× apart.** Pricing against an open pack is how a 4× error ships quietly.
- **Tomatoes Crushed (10#)** (`NO_OZ_BASIS`) — the SKU's own pack is self-contradictory:
  `each_size 1626 oz` with `units_per_pack 1` **and** `avg_oz_per_each 109` cannot both be true.
  The reconciliation report flagged this months ago and it is still open.
- **Cucumber** (`NO_OZ_BASIS`) — our SKU holds two disagreeing weight opinions before Angel is
  even consulted: 158 oz ÷ 12 count = 13.2 oz each, while `avg_oz_per_each` says 8.
- **Eggs** (`AMBIGUOUS_PRODUCT_IDENTITY`) — Angel's `1/30 DZ` = 360 is **exactly** our
  `units_per_pack`, which is tempting. But our SKU does not say a grade, and Angel's large and
  medium rows sit **2.1× apart per egg** — far too wide for a genuine grade spread, meaning one
  is anomalous. Naming the grade resolves it; guessing prices every egg dish wrong.
- **Onion (White)** (`DUPLICATE_CLUSTER`) — doubly blocked: two PFG rows 10% apart, **and** both
  say YELLOW onion while our SKU says White.

### Standing refusals, restated not re-litigated

**Heavy Cream**, **Cheddar** and **Chives** were refused by wave 1 and remain priceless for the
same reasons, under their original codes. One new fact worth recording: the 2024 sheet's
Heavy Cream ($44.46) sits **0.4% from Angel's 36% row** and 4% from the 40% row — weak, but it
points. Juan names the butterfat.

---

## § D — NO SOURCE: 82 SKUs, and the 62 that can never be closed here

**62 are the SUPPLY-RUN class** (`inventory_only` — packaging, chemicals, smallwares, office):
Trimark's cleaning chemicals, Webstaurant's smallwares, Amazon's office supplies, Vistaprint's
loyalty cards, Continental Tape's logo tape. **Angel Spend is a menu-costing service and does not
carry these vendors at all.** Most also have no pack fields, so they are blocked twice over. A
handful have a superficially plausible PFG/US-Foods disposables row (gloves, wax paper, register
rolls, can liners) — those fail on `OUR_PACK_UNRESOLVABLE` regardless, because our SKUs carry no
denominator to price against. **This gap is structural, and no Angel export will ever close it.**

**20 are other SKUs with no row in either source** — the Baldor/Sysco twins with no pack
(`Lettuce` ×2, `Onions`, `Salami`, `White Cheddar`, `Fresh Mozzarella`), the six Utz chip SKUs
(wave 4: *"Angel has never seen a bag of chips"*), and the loose tail already sitting on **Juan's
open list § A**: `Fusilli Pasta`, `Frooties`, `Fruity Pebbles`, `Employee Water`,
`Balsamic Glaze`, `Gluten Free Bread`, `Pepperoncini`, `Lemon Oil`, `Mixed Herbs`, `White Wine`.

**Every priceless SKU lands in exactly one bucket, and the script asserts it:**
`11 write + 47 refused + 0 blocked + 82 no-source = 140`. If a refusal ever names a SKU that is
already priced or misspelled, the run aborts rather than printing a coverage number that is
quietly wrong — that number is the one Juan reads.

---

## § E — WIRING NOTE: "pricing should update from what we are receiving"

**Findings only. This PR changes no receiving code** — the fix is a UI decision that deserves its
own PR, and stating that plainly is the point of this section.

### E.1 — What triggers the price insert today

There are **two** insert sites, both in `lib/receiving.ts`, and both are gated on the same thing:

| site | function | gate |
|---|---|---|
| `lib/receiving.ts:503-509` | `recordDelivery` (the door ceremony) | `input.lines.filter((l) => l.unitPrice != null)` |
| `lib/receiving.ts:1121-1127` | `addDeliveryLines` (the partial/append path) | `lines.filter((l) => l.unitPrice != null)` |

```ts
const priced = input.lines.filter((l) => l.unitPrice != null);
if (priced.length > 0) {
  const { error: pErr } = await sb.from("vendor_price_history").insert(
    priced.map((l) => ({ vendor_item_id: l.skuId, unit_price: l.unitPrice,
                         effective_date: input.deliveryDate, recorded_by: actor.user.id })),
  );
```

So the trigger is exactly one field: **a non-null `unitPrice` on a delivery line.** There is no
PO-match path, no email-receipt path, and no invoice parse that sets it — those seams read prices,
they do not write them (see E.4).

### E.2 — The capture path exists end-to-end, and it is not broken

Traced upward, every layer carries the field:

- **The input renders** — `components/receiving/IntakeLineRow.tsx:342-357`, a numeric
  `receiving.form.price` field (label `:345`) bound to `line.unitPrice` (`:353`, `onChange :355`).
- **The form submits it** — `components/receiving/ReceivingForm.tsx:612` (`unitPrice: num(l.unitPrice)`)
  and `:600` for the line-less `missingLines`.
- **The routes validate and pass it** — `app/api/operations/receiving/route.ts:60` and
  `app/api/operations/receiving/continue/route.ts:42-43` (which 400s on a non-numeric value
  rather than silently stripping it).

**Nothing is missing from the wire.** This matters: the usual suspects for a dead contract — a
field absent from the route schema, a form that drops it, a reader with no writer — are all ruled
out here.

### E.3 — Why zero prices have flowed: the box is behind an expand

The price input's own comment states the condition verbatim
(`components/receiving/IntakeLineRow.tsx:341`):

> `{/* Optional unit price + observed oz/each — expanded only; collapsed path untouched. */}`

And `ReceivingForm.tsx:143` builds every line seeded from a PO or last-delivery template with
**`expanded: false`**, while a manually-added overage line gets `expanded: true` (`:119`).

**So the ordinary door flow — receive what you ordered, off a template — renders every line
collapsed, and a collapsed line has no price field at all.** A price is captured only when the
operator manually adds a line, or deliberately expands one.

**Prod confirms this precisely.** All 7 `delivery.received` audit rows are smoke tests:

| when | deliveries | `priced_lines` |
|---|---:|---|
| 2026-07-01 (07:13 → 07:40) | 3 | **1 each** — someone deliberately expanded a line |
| 2026-08-09 → 08-10 | 4 | **0 across all four** |

Across all 8 delivery lines ever written, exactly **1** carries a `unit_price`.

**Correcting the premise this wave was briefed on:** it is not true that zero receiving-source
rows exist. The ledger's one non-seed row — `Banana Peppers $20.00`, `effective_date 2026-07-01`,
`recorded_by` a real user — was written **by `recordDelivery`**. Its `recorded_at` is
`07:40:31.513`, **97 ms before** the `delivery.received` audit row at `07:40:31.610`, and in
`recordDelivery` the price insert (`:505`) precedes the audit call. **The mechanism is proven to
work in production. The door simply never asks.**

*(That row also explains the report's old "our one stored price is untrusted smoke-test residue"
note: it sits on the **inactive Baldor** `Banana Peppers`, while the active Boar's Head SKU of the
same name is one of the 140 priceless — which is also why the seed resolves SKUs by
name **and** requires exactly one ACTIVE GLOBAL match before writing anything.)*

### E.4 — The PO seam reads prices; it never writes them

`lib/purchase-orders.ts:618-640` (`latest price in CENTS per SKU`) sources
`price_cents_at_order` **from** `vendor_price_history`, newest-first, and the module header is
explicit that it is *"NEVER fabricated"*. So the direction is one-way: **POs consume prices,
receiving produces them.** With receiving silent, the only producers are seeds — which is exactly
the state § A is sweeping, and exactly why it is a stopgap rather than a fix.

### E.5 — A provenance gap worth naming

**Neither receiving insert sets `source` or `source_note`**, and `recordSkuPrice`
(`lib/admin/cost.ts:242-247`) does not either. Migration 0177 added those columns and the seeds
populate them faithfully — so today a `source IS NULL` row could be a price typed at the door OR
one typed in the admin cost panel, and **the column alone cannot tell you which.** Distinguishing
them currently requires joining `recorded_at` against the delivery audit trail, which is how the
Banana Peppers row was attributed above. That is forensics, not a data model.

Stated as a finding, not a fix: once receipts start flowing, "where did this price come from?"
becomes a question the ledger should answer by itself.

### E.6 — What would make receiving-driven pricing actually flow

In dependency order, as findings:

1. **The price field must be reachable in the default collapsed line** — this is the whole gap.
   Whether that means a compact always-visible price cell, a price-only quick-entry, or
   auto-expanding lines on a vendor whose invoice is in hand is a design question, not a bug fix.
2. **An operator has to have the invoice at the door.** Even a perfectly placed field captures
   nothing if the paper arrives later; a "add prices from the invoice" pass on an already-received
   delivery is what `addDeliveryLines` could serve, and today it has no surface pointed at it.
3. **`source`/`source_note` on both receiving inserts** (E.5), so a received price is
   distinguishable from a hand-entered one without forensics.
4. **Then, and only then, the seeded prices are superseded naturally** — `vendor_price_history` is
   append-only and every reader takes the newest row, so a real receipt silently outranks a wave-6
   estimate the day it lands. **No migration, no backfill, no cleanup of this seed's rows is
   needed.** That is the design working as intended, and it is why seeding now costs nothing later.

---

## Appendix — how to re-run

```bash
# DRY RUN (default) — prints everything above, writes nothing
npx tsx --conditions=react-server --env-file=.env.local scripts/seed/34-wave6-price-fill.ts

# the markdown tables in this document
npx tsx --conditions=react-server --env-file=.env.local scripts/seed/34-wave6-price-fill.ts --markdown

# WRITES — lead-gated, only after Juan's eyeball
npx tsx --conditions=react-server --env-file=.env.local scripts/seed/34-wave6-price-fill.ts --execute
```

**Safety properties of `--execute`:** it refuses to run at all if the rule tables are internally
inconsistent (a SKU both filled and refused, listed twice, or overlapping wave 1's
`DIVISION_RULES`); it re-verifies every pack against the LIVE chain-aware derivation and drops any
SKU whose pack has moved under its transcribed divisor; it **skips any SKU that already holds a
price row** (this seed authors a FIRST price only — superseding belongs to receiving and the admin
panel, not to a seed); and it aborts if the disposition buckets do not sum to the live priceless
count. A second `--execute` is a no-op by construction.
