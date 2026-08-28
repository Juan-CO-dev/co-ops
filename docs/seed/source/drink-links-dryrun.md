# Seed 31 — drink depletion links: recon + dry run

**Date:** 2026-08-28 · **Branch:** `feat/drink-depletion-links` · **Status:** DRY RUN ONLY, nothing written.
**Juan's order:** *"we do the drink links and anything else that needs linking for depletion."*

All figures below are live prod reads (project `bgcvurheqzylyfehqgzh`), read-only.
Sales window: **2026-08-07 → 2026-08-27** (21 days; `toast_sales_events`, `voided = false`).

---

## 0. The finding that shaped the seed

**A recipe alone would have depleted nothing, and would have looked finished.**

`lib/recipe-math.ts` deliberately ignores `to_base_factor` for **volume** measures — a
documented, test-locked design decision (a volume base cannot reach the weight-oz universe
without a density we do not store), so a volume-measured SKU converts through the
human-entered `avg_oz_per_each` exactly like a count unit.

Every beverage SKU is `each_measure = 'fl oz'` (volume) with **`avg_oz_per_each = NULL`**.
So *every* candidate denomination dies at the same place:

| Denomination tried | Path taken | Result |
|---|---|---|
| `12 fl oz` | measure registry → volume → `avg_oz_per_each` | **null** |
| `1 each` | measure registry → count → `avg_oz_per_each` | **null** |
| `1 Case` | legacy `packFormat` → `each_size × ozPerMeasureUnit('fl oz')` | **null** |

A null poisons the flatten to an empty map, so `perUnitDirectSkuOzForMenuItem` returns
nothing and no `toast_daily_depletion` row is ever written.

**This also means seed 30's stated outcome never landed for the drinks.** Its header claims
`35 × 12 fl oz` "resolves to a 420 oz order unit with no new unit law" — with a NULL avg it
resolves to NULL. Confirmed live: **all nine chain-less beverage SKUs still report
`no_weight_basis`** on the latest `par_auto_moves` run. Seed 30 wrote the pack *shape*; the
volume path still needed its per-unit weight.

Hence two phases. Phase A supplies the basis, Phase B authors the links, and Phase B
**refuses** any SKU that would still lack a basis — so a zero-depleting recipe cannot be born.

### The denomination convention (found, not invented)

`avg_oz_per_each = 1` — *one fluid ounce of soda weighs one ounce*. This **mirrors a live
precedent**: `Hot Peppers` is already `each_measure 'fl oz'` with `avg_oz_per_each = 1` in
prod. It is ~4% conservative (water is 1.043 oz/fl oz), which understates depletion rather
than inflating it, and it makes the pack arithmetic finally agree with Juan's own labels.

Recipe denomination follows from it: **a 12 fl oz can sold whole = `12 fl oz` of that SKU**,
`batch_yield 1`, one output at `yield 1` → share 1 → `direct_oz = 12` per unit sold.

---

## 1. Phase A — weight basis (dry run)

```
✓ Coke                 avg_oz_per_each ∅ → 1   (pack now resolves to 420 oz)
✓ Diet Coke            avg_oz_per_each ∅ → 1   (pack now resolves to 420 oz)
✓ Saratoga             avg_oz_per_each ∅ → 1   (pack now resolves to 288 oz)
✓ DB Cel Ray           avg_oz_per_each ∅ → 1   (pack now resolves to  72 oz)
✓ DB Cherry Soda       avg_oz_per_each ∅ → 1   (pack now resolves to  72 oz)
✓ DB Cream Soda        avg_oz_per_each ∅ → 1   (pack now resolves to  72 oz)
✓ DB Diet Cherry Soda  avg_oz_per_each ∅ → 1   (pack now resolves to  72 oz)
✓ DB Diet Cream Soda   avg_oz_per_each ∅ → 1   (pack now resolves to  72 oz)
✓ DB Root Beer         avg_oz_per_each ∅ → 1   (pack now resolves to  72 oz)
✓ Branded (C/O) Water  avg_oz_per_each ∅ → 1   (pack now resolves to 288 oz)
```

Each resolved pack equals Juan's label exactly: Coke 35 × 12 = **420**, Saratoga and the
branded water 24 × 12 = **288**, every Dr. Brown's 6 × 12 = **72**. This closes
`no_weight_basis` for all ten.

Branded (C/O) Water gets its basis even though its *link* is held — the pack fact is Juan's
own label and is not in question; only which menu item it serves is.

---

## 2. Phase B — linked by this seed (11)

Output = the menu item (`yield 1`), input = its SKU at `12 fl oz`, `batch_yield 1`.

| # | Menu item | → SKU | 21d qty | Container | Note |
|---|---|---|---|---|---|
| 1 | Diet Coke | Diet Coke | **676** | can | exact name match |
| 2 | Dr. Browns Root Beer | DB Root Beer | 310 | can | `DB` is the catalog's Dr. Brown's prefix |
| 3 | Dr. Browns Diet Cream Soda | DB Diet Cream Soda | 170 | can | |
| 4 | Dr. Brown's Cream Soda | DB Cream Soda | 148 | can | menu item carries the apostrophe; diet twin does not |
| 5 | Dr. Browns Black Cherry | DB Cherry Soda | 147 | can | Dr. Brown's ships one cherry flavor; SKU spelled "Cherry Soda" |
| 6 | Dr. Browns Diet Black Cherry | DB Diet Cherry Soda | 129 | can | diet twin of the above |
| 7 | Coke | Coke | 108 | can | see the `Coca-Cola` crosswalk gap below |
| 8 | Saratoga | Saratoga | 99 | bottle | both Toast spellings already crosswalk here |
| 9 | Happy Hour Diet Coke | Diet Coke | 87 | can | stated assumption — same can, promo price |
| 10 | Dr. Browns Cel-Ray Soda | DB Cel Ray | 55 | can | |
| 11 | Happy Hour Coke | Coke | 29 | can | stated assumption — same can, promo price |

**Total: 1,958 units / 21 days that currently deplete nothing.**

*Happy Hour rows:* not treated as ambiguous. They map to exactly one SKU, are not a size
variant, and CO has no fountain — the difference is $1 vs $2.79. The assumption is stated
inline in the seed rather than hidden. Two menu items pinning one SKU is not a dual-producer
conflict (that hazard is two recipes producing *the same output*).

### Why a recipe is the right mechanism here

`toast_menu_map` has a `sku_id` column, which would be a shorter path — but
`lib/catering/toast-sales.ts` reads it **only for modifier rows**
(`.filter((m) => m.is_modifier && …)`). For a non-modifier item the target is
`menu_item_id ?? item_id ?? package_id`. So menu_item → recipe → SKU is genuinely the only
lane for a sold drink. Verified in code, not assumed.

### Guards this seed clears honestly

- **Mass balance:** not tripped, and not evaded — `massBalanceIndex` iterates
  `graph.byOutputItem` only, and these recipes produce menu_items exclusively, so they are
  structurally outside the guard. (Verified in `lib/menu-costing-shared.ts`.)
- **Double-count law:** not in play. SKU inputs only, zero item refs → these contribute to
  `direct_oz` and never to `flattened_oz`.
- **Audit vocabulary:** `vendor_item.update` and `recipe.create` are both already registered
  in `DESTRUCTIVE_ACTIONS`. **No new action name was required.**
- **Refusals (hard):** a menu item that already has an active recipe; a SKU that would still
  have no weight basis; and in Phase A, any SKU already carrying an avg, not `fl oz`, or
  bearing an **active pack chain** (the chain wins — a flat avg beside it is a second opinion).

---

## 3. HELD — ambiguous, a question not a guess (4)

| Item | 21d | The question |
|---|---|---|
| **Natalie's Lemonade** | 161 | Its SKU carries an **active one-level pack chain** (`case` contains 6 `count`) that contradicts its flat fields (6 × 12 fl oz). A chain wins over flat fields, so the chain wants `avg = 12` (oz per bottle) while the flat path wants `1`. One column cannot answer both; it currently reports **`unresolvable_pack`** — a different and worse fault than the other ten. **Repair the chain to two levels (case → 6 bottle → 12 fl oz) and leave avg NULL, or retire the chain and let the flat fields stand?** The link itself is trivial once that lands. |
| **Water Bottle** | 133 | Two candidate SKUs: `Branded (C/O) Water` (24 × 12 fl oz) and `Employee Water` (no pack facts). Seed 30 records Juan distinguishing them — *"Juan's 24×12 was the BRANDED water"*. The $1.99 price suggests the branded bottle, but staff water and sold water are deliberately separate SKUs and the wrong pick depletes the wrong inventory silently. **Does the "Water Bottle" button sell the branded C/O bottle?** |
| **24 Mixed Sodas** | 2 | An assortment — 24 cans across an unspecified mix of Coke, Diet Coke and six Dr. Brown's. Any split we invent would put fabricated oz on eight SKUs at once. **Standard mix, or packed to order?** |
| **Dozen Waters** | 7 | 12 × the bottle the Water Bottle question is about. Blocked behind that same answer. |

---

## 4. NEEDS A CROSSWALK, not a recipe (8)

Menu item *and* SKU both exist; the Toast button is simply not mapped. The crosswalk snapshot
dates to 2026-07-27, so these are newer buttons.

| Toast button | 21d | Target |
|---|---|---|
| **`Coca-Cola`** | **284** | menu_item `Coke` — **the single largest drink gap**, almost certainly the other shop's Coke button |
| `Diet Coke` (2nd GUID) | 5 | menu_item `Diet Coke` |
| `Dr. Browns Cream Soda` | 3 | menu_item `Dr. Brown's Cream Soda` |
| `Coke` (2nd GUID) | 2 | menu_item `Coke` |
| `Just Iced Tea Lemon Tea` | 1 | also needs a SKU |
| `Just Iced Tea Raspberry` | 1 | also needs a SKU |
| `Dr. Browns Diet Cream Soda` | 1 | menu_item `Dr. Browns Diet Cream Soda` |
| `Dr. Browns Root Beer` | 1 | menu_item `Dr. Browns Root Beer` |

Once `Coca-Cola` is mapped, the `Coke (build)` recipe in this seed covers it with no further
work — the recipe hangs off the menu item, not the button.

---

## 5. NEEDS A SKU, not a recipe (6)

Menu item + confirmed crosswalk exist; there is no `vendor_items` row to link to.

| Menu item | 21d | Note |
|---|---|---|
| JustIced Tea- Lemon Tea | 139 | seed 30 already recorded the fact for creation: **12 × 12 fl oz** per Juan |
| JustIced Tea - Dragon Green tea | 83 | same case pack |
| JustIced Tea- Raspberry Tea | 73 | same case pack |
| Red Bull | 8 | no SKU, no pack fact yet |
| Red Bull - Sugar Free | 7 | no SKU, no pack fact yet |
| Topo Chico Lime | 2 | no SKU; also carries a stale `rejected` crosswalk row under the name `Topo Chico` |

**The three iced teas alone are 295 units / 21 days** — the largest single block still dark
after this seed, and it is unblocked by three SKU creations Juan has already given the pack
fact for.

---

## 6. The Doctor's needs-link queue — EMPTY, and it answers a different question

`loadNeedsLinkQueue` (`lib/admin/needs-link.ts`) surfaces **active `checklist_template_items`
count-lines** with `item_id`, `vendor_item_id` **and** `equipment_id` all null.

Live, as shipped: **0 rows.**

| Measure | Count |
|---|---|
| Active count-lines on active templates | 32 |
| …unlinked on item + SKU | 32 |
| …**also** unlinked on equipment (the shipped filter) | **0** |

All 32 are fridge/equipment temperature lines that gained an `equipment_id` with migration
0181. The queue is genuinely clear.

**So the Doctor's definition does not reach this errand.** It is about checklist count-lines
finding a master-list target; depletion linking is about menu items finding a recipe. The
authoritative "needs linking for depletion" list is §2–§5 above (the sales-weighted list),
not the Doctor's queue — reported here rather than silently substituting a new definition.

---

## 7. Non-drink rows that need linking for depletion — my read

Every row below has Toast sales, a confirmed crosswalk, and **no active recipe**. None are
authored here; each needs something this seed cannot honestly supply.

| Menu item | 21d | My read |
|---|---|---|
| Utz Sour Cream & Onion | 553 | **NEEDS SKUs.** The whole chips cohort has exactly **one** SKU — `Utz Ripples`. There is no per-flavor SKU for Sour Cream & Onion, Salt & Vinegar, BBQ, Original, Salt & Pepper or Mini. Linking six menu items to one flavor-agnostic SKU would fabricate the flavor breakdown that ordering actually needs. Wants Juan's order guide → six SKUs → then a seed exactly like this one. |
| Utz Salt & Vinegar Chips | 500 | same |
| Utz Original Chips | 431 | same |
| Utz BBQ Chips | 376 | same |
| Mini Chips- Utz Original | 232 | same (and a genuinely different pack — mini bags) |
| Salt & Pepper Chips | 171 | same |
| Deli Pickle | 295 | **BLOCKED ON A WEIGH.** `Whole pickles` SKU exists but is **variable weight** by Juan's own ruling (seed 30: *"they come in different sizes… avg weigh = the open errand"*), `avg_oz_per_each` NULL. A link today depletes zero; a fixed oz would be a fabrication. Unblocked by the 3-sample surprise-weigh, not by code. |
| Whisked Chocolate Chip Cookie | 203 | **NEEDS A SKU.** No `vendor_items` row. |
| Berger Cookies - 2 pk | 198 | **NEEDS A SKU.** No row; also a 2-pack, so the per-each fact matters. |
| Berger Cookies- Large | 77 | **NEEDS A SKU.** |
| Fruity Pebble Cannolis | 72 | **BLOCKED ON A WEIGH + a build.** `Cannoli Shell` (count, avg NULL) and `Fruity Pebbles` (entirely empty) both exist. Seed 30: per-shell weight stays open *"until Juan weighs one"*. It is also a multi-input build, not a 1:1 resale link. |
| Bacon Caesar Pasta Salad · Garlic Bread · Quart of Pickle Spears · Stuffed Peppers · Roasted Red Peppers · House Greek Salad | 30 / 28 / 18 / 3 / 3 / 3 | **DIFFERENT LANE.** These are PREP outputs, not resale goods — they want `component_item_id` recipes against the prep registry, which is the item-graph errand, not the drink-link one. |

**Chips are the single largest unlinked block in the app (2,263 units / 21 days)** and the
clearest next errand after the drinks — but it starts with SKU creation, not recipes.

### Adjacent data smell found on the way (not fixed here)

`Sweet Peppers` and `Hot Peppers` are the same physical pack (4 × 128 fl oz) but carry
`avg_oz_per_each` **4** and **1** respectively — so their packs resolve to **2048 oz** and
**512 oz**, a 4× disagreement. `Hot Peppers` (1) matches the convention used throughout this
seed; `Sweet Peppers` looks like a stale per-pepper weight left behind when `each_measure`
became `fl oz`. Flagged for the lead; deliberately **not** touched, since neither SKU is part
of this errand and a silent fix would move live cost numbers.

---

## 8. Run it

```bash
npx tsx --conditions=react-server --env-file=.env.local \
  scripts/seed/31-drink-depletion-links.ts             # DRY RUN (default)
npx tsx --conditions=react-server --env-file=.env.local \
  scripts/seed/31-drink-depletion-links.ts --execute   # WRITES — lead-gated, on Juan's word
```

**Summary:** 11 links · 0 refused · 10 SKUs given a weight basis · 4 held · 8 need a
crosswalk · 6 need a SKU.
