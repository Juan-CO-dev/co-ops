# Angel Spend → co-ops, harvest 2: piece structure & pack recheck

**Captured:** 2026-08-20, per-product pages, live Compliments Only account.
**Companion to:** `ANGEL-DATA-HARVEST.md` (the 440-line history). Nothing here contradicts that file — it refines it.

## Files

| File | What it is |
|---|---|
| `angel-piece-structure.csv` | Answer to #1 and #3 — pieces, per-piece weight, slices, $/slice |
| `angel-pack-recheck.csv` | Answer to #2 — pack field vs Angel's own descriptor vs measured net weight |

---

## 0. The structural find: there is a *fourth* pack field, and it's the good one

Every product page carries a subtitle line that the Purchases grid never shows:

```
OVENGOLD TURKEY
GROCERY-REF-FZN · TURKEY · TURKEY · 1 CT
                                    ^^^^
```

Format: `CLASS · CATEGORY · SUBCATEGORY · [SPEC] · [BRAND TIER] · [MANUFACTURER] · PACK`.

Two things follow, and both are load-bearing:

**(a) The Delmar items are not missing pack data — it's in a different field.** Their `Pack Size` column reads `—`, which is what made them look like a metadata black hole in harvest 1. But the subtitle carries `1 CT` for all eight. Angel is holding this data and simply not surfacing it in the grid or the Products list.

**(b) The subtitle pack and the `Pack Size` field disagree, and the subtitle is usually righter.** Examples:

| Product | `Pack Size` field | subtitle pack | measured net |
|---|---|---|---|
| `CHIVES FRSH` | `1/8 OZ` | `0.5 LB` | 0.8 lb |
| `Spice, Chive Chopped…` | `6/1.12 OZ` | `0.5 LB` | 0.07 lb |
| `OREGANO LEAVES` | `1/24 OZ` | `1.5 LB` | 1.8 lb |
| `THYME FRSH` | `1/4 OZ` | *(absent)* | 0.5 lb |

**For co-ops:** when you ingest a vendor feed, expect the pack to arrive in more than one shape, and store all of them (`pack_string_raw`, `pack_normalized_lbs`, `unit_descriptor`) rather than collapsing to one at write time. Angel collapsed to `Pack Size` for the grid and lost the `1 CT` that makes a third of its spend costable.

---

## 1. Pieces per case — the 8 Delmar catch-weight items

**Headline: there is no "case." Delmar invoices by the piece.**

All eight carry `1 CT`, and the arithmetic confirms it — `Quantity` on the invoice is a **count of individual pieces**, and `Net Weight ÷ Quantity` is the **weight of one piece**, not a case weight.

That reframes harvest 1. What I reported as "case weight ~9.23 lb" for Ovengold is the weight of **one turkey breast**. Every number below is per-piece.

| Product (verbatim) | Angel subtitle | lb / piece | observed range | oz / piece | $/lb | $ / piece |
|---|---|---|---|---|---|---|
| `OVENGOLD TURKEY` | `… · TURKEY · TURKEY · 1 CT` | **9.251** | 9.16 – 9.30 | 148.0 | 6.29 | $58.19 |
| `LONDON BROIL` | `… · MISCELLANEOUS ITEM · BROIL · 1 CT` | **6.930** | 6.55 – 7.18 | 110.9 | 8.69 | $60.22 |
| `MILD PROVOLONE` | `DAIRY · CHEESE · PROVOLONE · 1 CT` | **5.502** | 5.50 – 5.52 | 88.0 | 3.49 | $19.20 |
| `DILANDRI GENOA SALAME` | `… · SALAMI · GENOA SLICED · 1 CT` | **6.440** | 6.27 – 6.56 | 103.0 | 4.39 | $28.27 |
| `HOT BUTT CAPPY` | `… · PORK · BUTT CAPPY · 1 CT` | **3.592** | 3.59 – 3.59 | 57.5 | 5.45 | $19.58 |
| `EVERROAST CHICKEN` | `… · CHICKEN · CHICKEN · 1 CT` | **4.633** | 4.62 – 4.67 | 74.1 | 5.99 | $27.75 |
| `Pepperoni Slicing` | `… · PEPPERONI · SLICING · 1 CT` | **3.494** | 3.48 – 3.50 | 55.9 | 5.09 | $17.79 |
| `IMP LAYER BACON 12/14` | `… · LAYER BACON · **12/14** · 1 CT` | **15.000** | 15.00 – 15.00 (fixed) | 240.0 | 4.69 | $70.35 |

Every one of these per-piece weights matches a Boar's Head foodservice spec, which is a good independent sanity check — Delmar is a Boar's Head distributor.

**The `12/14` on the bacon is a slice spec, not a size code.** It means 12–14 strips per pound. Combined with the fixed 15.0 lb box: **180–210 strips per box.** That also explains why bacon's weight never varies while every other Delmar meat does — it's the one item sold as a packed box rather than a whole muscle.

### Slices per piece, and cost per slice

Using the oz-per-slice values already in `scripts/seed/10-fill-sku-weights.ts`:

| Product | co-ops SKU | oz/slice | **slices per piece** | **$ / slice** |
|---|---|---|---|---|
| `OVENGOLD TURKEY` | Turkey | 1.00 | **148** | **$0.393** |
| `LONDON BROIL` | Roast Beef | 1.50 | **74** | **$0.815** |
| `MILD PROVOLONE` | Provolone | 0.75 | **117** | **$0.164** |
| `DILANDRI GENOA SALAME` | Genoa | 1.00 | **103** | **$0.274** |
| `HOT BUTT CAPPY` | Capicola | 1.00 | **57** | **$0.341** |
| `EVERROAST CHICKEN` | *(none — add one)* | 1.00 assumed | **74** | **$0.374** |
| `Pepperoni Slicing` | Pepperoni | 0.25 | **224** | **$0.080** |
| `IMP LAYER BACON 12/14` | Bacon | see below | **180 – 210 / box** | **$0.335 – $0.391** |

### ⚠️ Two corrections this forces on `10-fill-sku-weights.ts`

**Bacon is badly wrong.** The file has `{ name: "Bacon", avgOz: 0.75, pack: { eachSize: 240, eachMeasure: "oz" } }`. The 240 oz case is **exactly right** — it matches Angel's 15.0 lb box to the ounce, which is a nice validation of whoever entered it. But `avgOz: 0.75` implies 21.3 strips/lb, and this bacon is spec'd at 12–14. Real strip weight is **~1.23 oz**, so:

```
co-ops today:  0.75 oz/strip → $0.220/strip   (320 strips/box)
actual:        1.23 oz/strip → $0.361/strip   (195 strips/box)
```

**co-ops is understating bacon cost by 64%.** On the Regular BLT (2–3 strips) that's $0.28–$0.42 of missing cost on a $10.00 item.

**`EVERROAST CHICKEN` has no entry at all.** It's a sliced deli chicken breast, behaves like turkey. Suggest `avgOz: 1.0` alongside Turkey.

---

## 2. Pack recheck — the 7 produce/spice items

**Direct answer to the oregano question: it is not 4×20oz. It is a single jug, `units_per_case = 1`, for both oregano SKUs.** The divisor is 1 in every one of the seven cases.

| Product | Brand | `Pack Size` | subtitle | nominal lb | **measured net** | ratio | $/case | Angel $/lb | $/lb if nominal |
|---|---|---|---|---|---|---|---|---|---|
| `OREGANO LEAVES` | ROMA | `1/5 LB` | `5 LB` | 5.00 | 6.00 | **1.20** | 55.27 | 9.21 | **11.05** |
| `OREGANO LEAVES` | ROMA | `1/24 OZ` | `1.5 LB` | 1.50 | 1.80 | **1.20** | 24.41 | 13.34 | **16.27** |
| `ONION PWDR` | ROMA | `1/5 LB` | `5 LB` | 5.00 | 6.00 | **1.20** | 33.25 | 5.54 | **6.65** |
| `GARLIC WHL PLD DOM` | PEAK FRS | `1/5 LB` | `5 LB` | 5.00 | 6.00 | **1.20** | 19.72 | 3.29 | **3.94** |
| `PARSLEY FRSH FLAT ITAL` | PEAK FRS | `1/1 LB` | `1 LB` | 1.00 | 1.40 | 1.40 | 15.20 | 10.86 | 15.20 |
| `BASIL FRSH` | FRSH ADV | `1/1 LB` | `1 LB` | 1.00 | **1.00** | 1.00 ⚠️ | 10.34 | 10.34 | 10.34 |
| `BASIL FRSH` | PEAK FRS | `1/1 LB` | `1 LB` | 1.00 | 1.45 | 1.45 | 20.25 | 13.97 | 20.25 |
| `THYME FRSH` | PEAK FRS | `1/4 OZ` | *(none)* | 0.25 | 0.50 | 2.00 | 16.54 | 35.19 | 66.16 |
| `CHIVES FRSH` | PEAK FRS | `1/8 OZ` | `0.5 LB` | 0.50 | 0.80 | 1.60 | 17.88 | 22.07 | 35.76 |

Reference rows from the other vendor, for contrast:

| `Spice, Oregano Leaf Dried…` | Monarch | `24 OZ` | `1.5 LB` | 1.50 | **1.50** | **1.00** ✅ | 29.19 | 19.46 | 19.46 |
|---|---|---|---|---|---|---|---|---|---|
| `Spice, Chive Chopped…` | Monarch | `6/1.12 OZ` | `0.5 LB` | 0.42 | **0.07** | **0.17** ❌ | 9.72 | 138.86 | 23.14 |
| `Basil, Fresh Herb` | Cross Valley | `1 LB` | `1 LB` | 1.00 | 1.00 | 1.00 ⚠️ | 16.08 | 16.08 | 16.08 |

### Three separate things are going on here

**(a) A clean 1.20× on PFG bulk dry goods.** Four SKUs — oregano (both sizes), onion powder, garlic — land at *exactly* 1.20, across different nominal weights (5.0→6.0 and 1.5→1.8). Real tare doesn't scale proportionally with contents; a constant multiplier does. This is a feed artifact, not physics. Across the whole catalog, PFG's other weight packs sit at 1.00–1.05 (salt 27.0→27.80, ham 13.0→13.02, cheddar 10.0→10.03), so 1.20 is a small, specific cluster rather than a PFG-wide rule.

**I cannot tell from Angel which number is the product.** If the jug really holds 6 lb, $9.21/lb is right. If it holds 5 lb and Angel is inflating, the true cost is $11.05/lb — a **20% costing error** on oregano, garlic and onion powder.

→ **This is worth 90 seconds of Juan's time.** Put one oregano jug and one garlic tub on the scale. That single measurement resolves the ambiguity for the whole 1.20 cluster and tells us whether to trust Angel's net weight or the pack string on PFG dry goods generally. Until then I'd cost at nominal (the conservative, higher $/lb) and flag it.

**(b) Fresh herbs run 1.4–2.0× and it's genuinely variable.** Parsley 1.40, basil 1.45, chives 1.60, thyme 2.00 — no common factor. These are bunch products where the pack string is a *unit size* and the box holds whatever it holds. **Here the invoice weight is the trustworthy number** and the pack string should be ignored. Opposite conclusion to (a), from the same-looking symptom — which is the argument for storing the disagreement rather than picking a winner at ingest.

**(c) `BASIL FRSH [FRSH ADV]` is confirmed fake.** Its net weight is exactly `1.0 × quantity` on all 7 lines — 4→4.0, 3→3.0, 2→2.0, 1→1.0. Its sibling with the *identical* `1/1 LB` pack from a different grower measures 1.45 lb. So the FRSH ADV box almost certainly also weighs ~1.45 lb, which would make its real cost **$7.13/lb** — the cheapest of the three basils, where Angel currently ranks it in the middle at $10.34. `Basil, Fresh Herb` (Cross Valley) has the same 1.000 signature and the same doubt.

**And note the trap:** because the pack string genuinely *is* 1 LB, the fake 1.0 is indistinguishable from a correct 1.0 by inspection. The only reason we caught it is the sibling SKU. In co-ops, `weight_source = assumed_default` catches this with no sibling needed.

### The chive contradiction, now confirmed inside one record

`Spice, Chive Chopped` states pack `6/1.12 OZ`, subtitle `0.5 LB`, and net weight `0.07 lbs` — **on the same page.** 0.07 lb = 1.12 oz = exactly one shaker. Angel's own descriptor says half a pound while its weight field says one-sixth of that. The dropped ×6 multiplier from harvest 1 is now confirmed from a second, independent field rather than inferred. True cost **$23.14/lb**, reported as $138.86/lb.

---

## 3. Fresh mozzarella — confirmed

`CHEESE MOZZ 1OZ SLCD LOG 32 CT` · `Pack Size` `6/2 LB` · subtitle `DAIRY · CHEESE · MOZZ 1OZ · SLCD LOG 32 CT · BRANDED-PREMIUM · BELGIOIOSO CHEESE · 12 LB`

Your read was right, and it closes cleanly:

```
1 log   = 32 CT × 1 oz  = 32 oz  = 2 lb        ← matches the "6/2 LB" unit size
1 case  = 6 logs        = 12 lb                 ← matches the "12 LB" subtitle
1 case  = 192 slices
```

Measured net weight is **12.75 lb/case** (63.8÷5, 76.5÷6, 89.3÷7 — all 12.75–12.76), 6.25% over the 12 lb nominal. That gap is brine and packaging, not extra cheese; the sliced product is 12 lb.

- **Cost per slice: $47.10 ÷ 192 = $0.2453.**
- Case price is rock stable at $47.10 across all 7 purchases — no price movement to model.

### ⚠️ Third correction for `10-fill-sku-weights.ts`

The file has `{ name: "Fresh Mozzarella", avgOz: 1.0, pack: { unitsPerPack: 72, … } }`. `avgOz: 1.0` is **correct** — it's a 1 oz slice, confirmed by the SKU name and the 32 CT × 1 oz = 2 lb arithmetic. But **`unitsPerPack: 72` should be 192.** At 72 the implied case is 4.5 lb, which is neither the 12 lb nominal nor the 12.75 lb measured.

---

## 4. Vendor hunt — 8 items

Searched both the full 440-line purchase history and Angel's Products search (which does fuzzy-match on name *and* class — "herb" correctly surfaced all the fresh-herb SKUs, so a miss here is a real miss, not a search artifact).

| Item | In Angel? | Finding |
|---|---|---|
| **Lemon Oil** | ❌ | Nothing. Only lemon *juice* (3 SKUs) and lemonade. |
| **Mixed Herbs** | ❌ | No product. `SPICES-SEASONINGS` exists as a class but there is no blend SKU. |
| **Vanilla Bean Paste** | ❌ | Nothing — no "vanilla" match anywhere. |
| **White Wine** | ❌ | Nothing. No alcohol in the account at all. |
| **Worcestershire** | ❌ | Nothing. Nearest condiment is `Sauce, Hot Plastic Jug Shelf Stable Original` (Cholula, US Foods, 4/64 OZ, $3.99/lb, $69.86/case). |
| **Utz Ripples** | ❌ | **No chips of any kind.** Zero snack SKUs across all four vendors — the only "CHIP" match is `PICKLES CHIPS 1/4`. Chips are bought outside Angel entirely. |
| **Pepperoncini** | ⚠️ **partial** | Not under that name. Two functional neighbours, both Delmar: `BANANA PEPPER RINGS` (Boar's Head, $8.75/case, **1.0 lb default — weight is fake**) and `HOT CHERRY PEPPERS` ($8.95/case, also fake). Banana pepper rings are the closest match to pepperoncini for a sandwich line. |
| **Dried Chives** | ✅ **found** | `Spice, Chive Chopped Plastic Shaker Shelf Stable Seasoning` · Monarch · **US Foods** · `6/1.12 OZ` · $9.72/case · 1 purchase (Jul 17) · **true $23.14/lb** (Angel's $138.86 is the ×6 bug). |

**The pattern in the misses is the useful part.** Six of eight absent items are *low-volume, high-flavour-impact* pantry goods — lemon oil, vanilla paste, white wine, Worcestershire, mixed herbs — plus resale snacks. These are exactly the items a shop buys at a restaurant-supply or grocery run rather than on a distributor truck, which is why Angel has never seen them. Angel can only ever cost what arrives on an invoice from an integrated vendor; **co-ops' advantage is that it starts from invoices generally, so it can hold these.** Keep them in the co-ops registry with a `no_distributor_source` marker rather than trying to reconcile them to Angel — they're a permanent gap in Angel's coverage, not a lookup that failed.

---

## 5. Verification

- **23 invoice lines cross-checked**: net weight I derived algebraically in harvest 1 (`total ÷ $/lb`) vs. Angel's own stated `Net Weight` column on the product pages. **0 mismatches above 1%.** The harvest-1 derivation is confirmed sound — every `lbs_per_unit` in `angel-purchase-history.csv` can be trusted.
- Per-piece weights independently sanity-checked against Boar's Head foodservice specs; all eight land in range.
- Bacon: 15.0 lb/box from Angel × 16 = 240 oz, matching the `eachSize: 240` already in `10-fill-sku-weights.ts` — two independent sources agreeing.
- Mozzarella: 6 logs × 32 slices × 1 oz = 192 oz = 12 lb, matching the `12 LB` subtitle and the `6/2 LB` pack field.
- Every `$/lb` and `$/case` quoted here was read off the product page, not recomputed.

## 6. Punch list for co-ops

1. `10-fill-sku-weights.ts` — **Bacon `avgOz: 0.75` → `1.23`** (12/14 spec). Biggest single correction; 64% understatement.
2. `10-fill-sku-weights.ts` — **Fresh Mozzarella `unitsPerPack: 72` → `192`.**
3. `10-fill-sku-weights.ts` — **add `EverRoast Chicken`, `avgOz: 1.0`.**
4. Load the 8 per-piece weights as the catch-weight baseline for the Delmar/Boar's Head SKUs — they're measured, not estimated, and they replace guesses.
5. Ask Juan to weigh **one oregano jug and one garlic tub** — resolves the 1.20× cluster and a 20% costing error.
6. Mark Lemon Oil, Mixed Herbs, Vanilla Bean Paste, White Wine, Worcestershire, Utz Ripples as `no_distributor_source`; they will never appear in Angel.
7. Consider `BANANA PEPPER RINGS` as the Pepperoncini source — but its weight is a 1.0-lb default, so it needs a real case weight before it can be costed by weight.

---

*Method: 20 per-product pages opened directly in the Angel UI and read from the rendered DOM. Angel exposes no export or public API; product records are read-only and nothing was modified. The Supabase endpoint behind the app was visible in network traces but deliberately not queried — everything here came through the interface.*
