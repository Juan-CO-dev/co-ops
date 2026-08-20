# Angel Spend (angelpurchasing.com) — Reverse-Engineering Notes for co-ops

**Source:** Full hands-on data-entry session, 2026-08-13/14. We entered Compliments Only's complete costing model into Angel's "Menu Costing" module: **30 prep recipes** and **32 menu items**, built against Angel's live purchase catalog (~130+ SKUs). Everything below is observed behavior, not documentation — Angel has no public docs we used. Written for Claude Code working on the co-ops repo (`C:\Users\conta\co-ops`), which already has a sibling system (item registry, vendor_items, recipes, pack chains, recipe-math). Cross-references to co-ops files are included so you can diff the two designs directly.

**The one-line thesis:** Angel's *data model* is simpler than co-ops' (in some places crudely so), but its *feedback loop* is dramatically better. The win available to co-ops is not Angel's schema — co-ops' schema is mostly superior — it's Angel's **live cost surfacing**: every keystroke re-prices the recipe, every menu item shows food-cost % and margin against menu price, and every gap ("1 unpriced") is visible inline. Co-ops has the harder half (data model, pack chains, oz-universe math) largely built; what it lacks is the Angel-style presentation layer on top.

---

## 1. Angel's architecture as observed

Angel is a purchasing platform first, costing tool second. The pipeline:

```
Vendor purchase data (broker-direct)          ← Angel's moat: prices arrive priced
        │
        ▼
  Purchase Catalog (SKUs)                     "MAYO HD · DUKES · SAUER BRANDS · 4/1 GA"
        │  every SKU carries: name, brand, vendor, pack string, derived $/lb
        ▼
  Recipes  ──can nest──▶ Recipes              (recipe-as-ingredient, cost rolls up)
        │
        ▼
  Menu Items (+ menu price)                   → Total Cost, Food Cost %, Margin
```

Because the operator behind Angel is a broker, the catalog IS the invoice stream — prices are authoritative and current without the restaurant doing anything. Co-ops inverts this: prices come from invoices the restaurant receives and does math on (`inventory-costing.csv` is the manual ancestor of this). That difference drives everything below: Angel never worries about price *entry*, so all its product effort went into price *consumption*. Co-ops has to do both.

### 1.1 Catalog item (Angel's `vendor_items` equivalent)

Observed fields per SKU, from the ingredient-picker subtitles and line behavior:

- **name** — vendor-style all-caps (`CHEESE MOZZ 1OZ SLCD LOG 32 CT`) or distributor long-form (`Tomato, Round 4x5 #1 Grade Fresh Ref 2 Layer Box`). Two naming dialects coexist, implying at least two upstream feeds (short-code feed + a Cross Valley/Glenview-style US Foods feed).
- **brand / vendor** — e.g. `DUKES · SAUER BRANDS`, `PEAK FRS · RUBY CO EUREKA`.
- **pack string** — `4/1 GA`, `6/2 LB`, `1/25 LB`, `12/32 OZ`, `6/#10 CN`, `1/12 CT`, `3/3 LT`. Single flat string, NOT a structured chain. This is exactly what co-ops' pack-chain design doc (`docs/superpowers/specs/2026-07-27-sku-pack-hierarchy-design.md`) calls the "collapsed scalar" problem — Angel lives entirely at that collapsed level and it mostly works for costing (though see cons: the pickles bug is precisely a collapsed-pack failure).
- **derived $/lb** — every SKU, even fluid ones (olive oil in liters shows $4.69/lb) and count ones, resolves to a per-lb cost. Angel normalizes everything to a **weight universe**, same philosophy as co-ops' oz-universe in `lib/recipe-math.ts` (weight → to_base_factor; count/volume → avg_oz_per_each), just at lb granularity with only lb/oz as line units.
- **fluid flag / count-capability** — line rows show `☐ Fluid ingredient ☐ Count ingredient`. Checking "Count ingredient" switches the line to count units and exposes a **"Pack count / case"** field (we used it once: hard-cooked eggs, 24 count against a 12/12 CT case). This is Angel's entire answer to co-ops' `avg_oz_per_each` + `measure_units` — a per-line, per-use ad-hoc count entry rather than a per-SKU stored conversion.

### 1.2 Recipe (Angel's `recipes` + `item_components` equivalent)

Fields: Name · Image · **Output Type** (we only ever saw/used "Weight") · **Unit Label** (free text — "batch (7.5 x 32oz bottles)") · **Weight per Unit** (number + lb) · Notes (free text) · ingredient lines.

Ingredient line: `[type: Ingredient|Recipe] [searchable ref] [Fluid ☐] [Count ☐] | Amount | Unit (lb/oz, or batch/lb/oz for recipe-refs) | Yield (%) | As (%) | LINE COST ($ + $/lb)`.

Key semantics observed:

- **Unit Label vs Weight per Unit are decoupled.** Label is pure display ("batch (~17 x 6oz delis)"); the math only uses Weight per Unit. This is a genuinely good pattern — kitchen language and math language don't fight. Co-ops' `containerLabel` + `batchYield` is the same idea; keep it.
- **Weight per Unit is authoritative and manual.** Angel does NOT sum the ingredient lines to derive batch weight — we entered it by hand every time, and it's how cost/lb is computed (`batch cost ÷ weight per unit`). This is both a feature (cook-down! Caramelized Onions: ~6.6 lb raw in, weight-per-unit set to 2.2 lb cooked → cost/lb correctly reflects finished weight) and a footgun (nothing warns you if lines sum to 12 lb and you typed 1.2).
- **Yield (%)** per line (default 100) — per-ingredient trim/waste. We never changed it, but it's the per-line counterpart to co-ops' shrinkage-delta concept (pack-chain L8). Cheap to add, immediately useful for produce.
- **"As (%)"** column — a unit-mode selector for the amount (% mode vs absolute); default `%` glyph, we always used absolute amounts. Low value; ignore.
- **Recipe-as-ingredient works and rolls up live.** A "Recipe" line searches saved recipes, shows `batch (~2.2 lb cooked) · 2.200 lb ea` as its subtitle, offers units batch/lb/oz, and prices from the referenced recipe's cost/lb. Proven chain: Caramelized Onions ($2.18/lb) → Beef Jus (4 oz = $0.54) → Our French Dip menu item (Jus 4 oz = $0.08/serving... note the jus itself is $0.32/lb because it's mostly water). Depth ≥ 3 (catalog → recipe → recipe → menu item) confirmed working. Co-ops' `item: true` recipe inputs are the same concept — the thing to verify in co-ops is that the *cost rollup* traverses it, not just the depletion.
- **The cost bar is live.** Bottom of the modal: `Cost per lb: $X.XX` + total, recomputed on every line change, and — the best single UI detail in the product — when a line's ref has no price it shows **`Cost per lb: — (1 unpriced)`**. A count of unpriced lines, inline, while you type. Steal this.

### 1.3 Menu item

Identical line model to recipes plus **Menu Price**, minus Output-Type/Weight (menu items aren't weighed). List view = the payoff screen: `Name | Menu Price | Total Cost | Food Cost % | Margin`, sortable, with food-cost % **rendered red above a threshold** (~30%+ observed: Side of Meatballs at 43.9% flags red; 27.7% does not). No configuration seen for the threshold.

This layer is where Angel earns its keep with an owner. Within seconds of the last save you can see: Turkey Caesar 12.1% FC / $14.75 margin vs Never Been Cheddar 23.0% / $11.77 — and the red flag on the $5.50 meatball side carrying $2.41 of cost. Co-ops has `menu_items.menu_price` seeded from Toast (`06b1-menu-subs.ts`) and consumer builds (`06b2-sub-builds.ts`); the FC%/margin/threshold list view is a thin, high-value screen away.

---

## 2. What Angel does well (adopt these)

1. **Zero-latency cost feedback.** Every amount/unit change re-prices the line and the batch in place. Costing feels like a calculator, not a report you run. Co-ops' equivalent (`lib/admin/cost.ts` + W4b) reads as batch/derived; the UX target should be: *while editing a recipe, the rolled-up cost is always on screen.*
2. **The `(N unpriced)` badge.** Angel never blocks on a missing price and never silently pretends the cost is complete — the count of unpriced lines rides along with every cost figure. Co-ops already has the concept of recipe placeholders ("5 recipe placeholders left" in the seed audit); surface that count on every cost display, not just in seed reports.
3. **Menu-price layer with threshold coloring.** FC% and $ margin per item, red over threshold. Trivial math, huge owner value. Co-ops has all inputs already seeded.
4. **Recipe-as-ingredient with per-unit metadata in the picker.** The picker subtitle (`batch (~2.2 lb cooked) · 2.200 lb ea`) tells you what one unit of the sub-recipe *is* at selection time. When co-ops builds recipe pickers, put `batchYield × containerLabel` and cost/oz in the option row.
5. **Display-label/math decoupling** (Unit Label vs Weight per Unit) — including its use for **cook-down costing** (cost per *finished* lb). Co-ops should make "finished weight ≠ sum of inputs" a first-class, documented pattern rather than an accident of two fields.
6. **Per-line Yield %** — a lighter-weight complement to pack-chain shrinkage; good for produce trim at the recipe layer.
7. **Search-first ingredient entry.** Type-ahead against the catalog with vendor/brand/pack subtitles beats any dropdown taxonomy. (Its ranking is weak — see cons — but the interaction model is right.)
8. **Notes as universal escape hatch.** Free-text notes on every recipe/menu item let us encode "PARTIAL COST — cabbage not in catalog (32 oz)" conventions. Crude but it meant *no information was lost*. Co-ops can do better (see §4.3) but should never do worse — always have somewhere to write the exception down.

## 3. Where Angel is weak (co-ops' openings)

1. **The catalog is a closed world.** Only broker-supplied SKUs exist. No manual/placeholder items, no way to add "Sub Roll, $0.70, Cardinal" yourself (or we found none). Result: every sandwich we entered is systematically under-costed by ~$0.70 (the roll), coleslaw is missing 70% of its mass (no cabbage/carrots), and Turkey Jus/Cranberry Sauce/Chili Flakes are $0.00 placeholders. **Co-ops' invoice-driven, self-owned item registry is strictly more powerful here.** An owner must be able to register any item with any price from any source. (Co-ops already does: `vendor_items` + manual seeds + the Cardinal/Amazon/grocery rows in `inventory-costing.csv`.)
2. **No stored count↔weight conversions.** Angel has no `avg_oz_per_each`. "3 slices of ham" had to be hand-converted to 3 oz using Juan's own measured slice weights (`scripts/seed/10-fill-sku-weights.ts`: ham/capicola/genoa/turkey 1.0 oz/slice, provolone/cheddar 0.75, pepperoni 0.25, prosciutto 0.5, fresh mozz 1.0/pc, bacon 0.75/strip, roll 4.0). The per-line "Count ingredient + pack count" widget exists but stores nothing reusable. **Co-ops' measure-unit registry + per-SKU avg_oz_per_each + pack chains is a full generation ahead.** Keep it; it's the moat.
3. **Collapsed pack strings produce silent price disasters.** `PICKLES CHIPS 1/4` prices at **$35.95/lb** — almost certainly a pack-size mis-parse (a $35.95 case read as ~1 lb). Angel shows no outlier warning; that one bad number was 32% of Crunchy Boi's food cost until you read the notes. This is the *exact* failure mode co-ops' pack-chain spec is designed to kill (the "CAPICOLA detached-sibling: 54.4 oz vs 136" named regression). Two lessons: (a) structured chains > flat strings, (b) **add $/lb sanity bounds per category** — flag any SKU whose derived $/lb is a category outlier (pickles at $35.95/lb should scream when tomatoes are $1.50/lb).
4. **Only lb/oz.** No volume units, no density handling; fluid SKUs (liters of oil) are silently priced per-lb. Fine in practice for a sub shop, but co-ops' volume-dimension handling (fl-oz + avg_oz_per_each fallback) is already more correct — don't regress toward Angel here.
5. **Weight-per-unit is unvalidated.** Nothing cross-checks it against the ingredient-line sum. Easy co-ops win: show `sum(inputs) = X oz` next to the declared batch weight, warn on large deltas *unless* a cook-down flag is set.
6. **No price provenance or history in the costing view.** You see today's derived $/lb, never "as of which invoice/date," no trend. For co-ops — where prices come from invoices — provenance is natural: stamp every cost figure with the source invoice date and flag staleness (>30/60 days). This turns co-ops' apparent disadvantage (manual price ingestion) into a *trust* feature Angel can't match: you know exactly where every number came from.
7. **No versioning/audit visible.** Edits overwrite; no recipe history. Co-ops already audits writes (`audit(...)` everywhere in seeds) — keep that and expose it.
8. **No API / no bulk import.** Everything we did was manual browser entry (~60 forms, several hours even with agents driving). Co-ops seeds 30 recipes from a script in seconds. For any migration/what-if tooling, co-ops' code-first seeding is an enormous structural advantage — this whole two-day exercise would be `npx tsx scripts/seed/...` against a costing engine.
9. **Search ranking is naive.** Prefix/substring with unstable ordering ("meatball" ranks Meatball Spice Mix over Meatballs; result order shifted between queries; only the first result is safely clickable). Co-ops: rank exact > starts-with > contains, keep ordering stable.
10. **Duplicate/near-duplicate SKUs** from multiple feeds (two balsamic vinegars, two arugulas, LETTUCE ICEBERG ×4) with no canonical-item grouping. Co-ops' item-registry unification (global roster + per-location SKUs) is the right answer; Angel doesn't have it.
11. **UI papercuts** (for the record, since co-ops builds forms too): unit dropdown needs 1–3 clicks depending on focus/blur state (non-deterministic); dropdowns render upward near the viewport bottom; row height differs between Ingredient and Recipe line types so the form reflows on type-switch; Escape closes the whole modal (data loss) unless a dropdown is open; Add Line button position is only stable relative to modal-top. Lesson: keyboard-first entry, stable layout, and a confirm-on-discard would all beat Angel.

## 4. Concrete recommendations for co-ops (priority-ordered)

### 4.1 Build the payoff screen first (small, high leverage)
A menu-item list view: `name | menu_price | rolled-up cost | FC% | margin`, red over a configurable threshold, with an `(N unpriced)` badge per row. Inputs all exist (`06b1` prices, `06b2` builds, recipe-math). This one screen is ~80% of what Angel actually *sells*.

### 4.2 Live cost rollup in the recipe/build editor
Recompute and display batch cost + cost/oz (and per-portion, using batchYield) on every input edit, traversing `item: true` recipe references recursively. Show `(N unpriced)` inline. Verify the rollup handles: recipe→recipe nesting ≥3 deep, count units via avg_oz_per_each, and cook-down (declared finished weight overriding input sum — add an explicit `finished_weight_oz` or reuse batchYield×container semantics, plus a variance warning when |declared − sum| is large and no cook-down flag is set).

### 4.3 First-class "uncosted line" records (beat Angel's free-text notes)
Where we wrote "PARTIAL COST — Red Cabbage 32 oz not in catalog" into a notes box, co-ops should store a structured row: `{recipe_id, ingredient_name, qty_oz, reason: missing_sku|no_price|estimate, note}`. Then: per-recipe completeness %, a global "missing SKUs ranked by usage" report (that report, generated from this session's notes, is §6.4 below — it took manual effort in Angel; it should be a query in co-ops).

### 4.4 Price provenance + staleness
Every price shown carries `source (invoice #/vendor feed) + as-of date`; stale prices tint the cost figures. This is co-ops' invoice-based model turned into a differentiator.

### 4.5 $/lb sanity rails
Per-category expected $/lb bands (produce $0.5–4, deli meat $2–13, spices $4–40...). On SKU ingest or pack-string edit, out-of-band ⇒ warning chip. Would have caught the $35.95/lb pickles instantly, and also the two conflicting Black Pepper rows already sitting in co-ops' own `inventory-costing.csv` ($1.29/oz vs $1.14/oz — same failure family).

### 4.6 Adopt the good small patterns
Per-line Yield %; unit-label/math decoupling (already have — document the cook-down use); rich picker subtitles (vendor · pack · $/oz · for recipes: yield + cost); Angel's two-mode line type (Ingredient|Recipe) as an explicit enum in the builder UI.

### 4.7 Keep (do not trade away for Angel-isms)
Pack chains; avg_oz_per_each + measure dimensions; code-first seeding; audit trail; the item registry / canonical-item unification; bilingual recipe text. Angel has none of these.

---

## 5. Costing conventions established in Angel (needed to interpret the data, and worth standardizing in co-ops)

- One recipe "unit" = one full batch; Unit Label describes the yield in kitchen terms ("batch (4qt cambro)", "batch (~45 x 4oz meatballs)").
- Weight per Unit = sum of ingredient oz ÷ 16, **except cook-downs** (Caramelized Onions 2.2 lb finished) where it's finished weight and the note says so.
- All slice/each→oz conversions per Juan's measured table (see §3.2). Sub roll = 4 oz each, never costed (missing SKU).
- Proxies used (all recorded in the item's Angel notes): LONDON BROIL ⇒ deli roast beef; iceberg ⇒ romaine; whole peppercorns ⇒ ground pepper; canola ⇒ grapeseed; raw-bacon price ⇒ cooked bacon weight; HOT CHERRY PEPPERS ⇒ pepperoncini; olive oil ⇒ oil/vin blend; Duke's+horseradish ⇒ Horsey Mayo; plain Duke's ⇒ Morrita mayo; ONION YLW JUMBO ⇒ Spanish onions.
- $0.00 placeholder recipes (main ingredient absent from catalog): Turkey Jus, Cranberry Sauce, Toasted Red Chili Flakes. Partial (<50% of mass costed): Coleslaw, Blackforest Breadpudding, Cornbread Mayo, Vegan SDT Aioli, Roasted Mushrooms, Corn Esquite.
- "Chicken Cutlet (APPROXIMATE)" mirrors co-ops' `approximate: true` flag from `03b-recipes-cooks.ts` — recipe TBD, 15 cutlets/batch, ~12.8 oz each, $1.16/cutlet.
- It's a BOI is costed at its most expensive protein option (roast beef) by owner decision, so margin is never overstated.

## 6. The dataset (for parity-testing a co-ops costing engine)

A ready-made regression suite: co-ops' engine, run over the same builds with Angel's catalog prices, should reproduce these numbers (modulo the documented gaps).

### 6.1 Recipes (Angel: batch cost / cost-per-lb)
| Recipe | Batch | $/lb | | Recipe | Batch | $/lb |
|---|---|---|---|---|---|---|
| Garlic Aioli (fixed) | $41.02 | $2.34 | | Meatball Spice Mix | $0.77 | $4.54 |
| Cholula Mayo | $6.75 | $2.60 | | Turkey Jus | $0.00 | — |
| Russian Dressing | $16.58 | $4.28 | | Beef Jus | $4.12 | $0.32 |
| Honey Chili Aioli | $9.97 | $2.23 | | Italian Salsa Verde | $11.95 | $9.96 |
| Caesar Dressing | $4.85 | $2.35 | | Cranberry Sauce | $0.00 | — |
| Mustard Aioli | $6.51 | $2.16 | | Cornbread Mayo | $4.57 | $1.00 |
| Green Goddess | $3.34 | $1.43 | | Vegan SDT Aioli | $0.42 | $0.16 |
| Cannoli Cream | $9.74 | $2.97 | | House MSG | $1.27 | $3.33 |
| Garlic Bread Compound Butter | $5.35 | $2.26 | | House Quickle | $4.56 | $0.52 |
| Egg Salad | $9.85 | $2.36 | | Toasted Red Chili Flakes | $0.00 | — |
| Tuna Salad | $29.70 | $2.50 | | Roasted Mushrooms | $0.50 | $0.25 |
| Chicken Salad | $34.08 | $5.24 | | Corn Esquite | $2.52 | $0.66 |
| Coleslaw | $3.64 | $0.57 | | Strata Base | $1.33 | $0.34 |
| French Onion Dip | $13.39 | $1.27 | | Breakfast Strata | $2.47 | $1.07 |
| Caramelized Onions | $4.79 | $2.18 | | Strata Supreme | $3.17 | $1.33 |
| Marinara | $11.45 | $0.83 | | Blackforest Breadpudding | $1.30 | $0.25 |
| Vodka Sauce | $10.36 | $1.53 | | Pesto | $6.70 | $5.36 |
| Meatballs | $34.79 | $3.08 | | Chicken Cutlet (APPROX) | $17.44 | $1.45 |

### 6.2 Menu items (price / cost / FC% / margin)
| Item | Price | Cost | FC% | Margin | | Item | Price | Cost | FC% | Margin |
|---|---|---|---|---|---|---|---|---|---|---|
| Crunchy Boi | 15.79 | 3.46 | 21.9 | 12.33 | | Turkey Sub | 14.19 | 1.57 | 11.1 | 12.62 |
| The Teamster | 16.29 | 2.79 | 17.1 | 13.50 | | Ham Sub | 13.19 | 0.52 | 3.9 | 12.67 |
| Hot Pants | 15.79 | 2.72 | 17.2 | 13.07 | | Roast Beef Sub | 14.19 | 2.72 | 19.1 | 11.47 |
| The Frex | 18.39 | 4.03 | 21.9 | 14.36 | | Salami Sub | 13.19 | 1.37 | 10.4 | 11.82 |
| Farmers Market After Dark | 12.09 | 1.29 | 10.7 | 10.80 | | Pepperoni Sub | 13.19 | 0.40 | 3.0 | 12.79 |
| Marisa Tomei Eats Free | 15.29 | 3.00 | 19.6 | 12.29 | | Veggie Sub | 9.49 | 1.24 | 13.0 | 8.25 |
| Never Been Cheddar | 15.29 | 3.52 | 23.0 | 11.77 | | Tuna Salad Sub | 10.49 | 0.94 | 8.9 | 9.55 |
| Turkey Caesar Sub | 16.79 | 2.04 | 12.1 | 14.75 | | Egg Salad Sub | 10.49 | 0.88 | 8.4 | 9.61 |
| Sicky Wicky Club | 15.79 | 2.54 | 16.1 | 13.25 | | Chicken Salad Sub | 16.00 | 1.96 | 12.3 | 14.04 |
| Vesuvio II | 19.99 | 4.31 | 21.6 | 15.68 | | Garlic Bread | 12.50 | 0.14 | 1.1 | 12.36 |
| Our French Dip | 18.99 | 3.73 | 19.6 | 15.26 | | Side of Meatballs | 5.50 | 2.41 | **43.9** | 3.09 |
| Regular BLT | 10.00 | 1.03 | 10.3 | 8.97 | | Egg Salad ½ Pint | 4.25 | 1.18 | 27.7 | 3.07 |
| It's a BOI | 15.79 | 4.06 | 25.7 | 11.73 | | Tuna Salad ½ Pint | 4.25 | 1.25 | 29.4 | 3.00 |
| The Chicken Cutlet | 19.50 | 1.61 | 8.3 | 17.89 | | Whole Grain Chicken Salad | 7.50 | 1.96 | 26.2 | 5.54 |
| Chicken Parm | 19.99 | 2.18 | 10.9 | 17.81 | | French Onion Dip (side) | 5.00 | 0.48 | 9.5 | 4.52 |
| | | | | | | MeatBall Parm | 10.00 | 2.77 | 27.7 | 7.23 |
| | | | | | | Roasted Red Peppers | 4.00 | 0.28 | 7.1 | 3.72 |

Caveats baked into every sandwich number: sub roll (~$0.70, ≈+4-5% FC) uncosted; PICKLES CHIPS $35.95/lb bug inflates Crunchy Boi and It's a BOI by ~$1; capicola uncosted on Teamster/Hot Pants/Frex/Marisa Tomei (3 oz ≈ $0.93 at Juan's BH price).

### 6.3 Angel-catalog name map (co-ops item → Angel SKU actually used)
Ham→HAM 35% WATER FC 4X6 TFF ($2.77/lb) · Genoa→DILANDRI GENOA SALAME ($4.39) · Pepperoni→Pepperoni Slicing ($5.09) · Prosciutto→Food Service Prosciutto ($12.95) · Turkey→OVENGOLD TURKEY (~$6.28) · Roast beef→LONDON BROIL ($8.69, proxy) · Provolone→MILD PROVOLONE (~$3.47) · Cheddar→Cheddar White Sharp Print · Fresh mozz→CHEESE MOZZ 1OZ SLCD LOG 32 CT ($3.69) · Shredded mozz→CHEESE MOZZ LMWM SHRED ($2.72) · Bacon→IMP LAYER BACON 12/14 · Chicken breast→CHICKEN BRST RAND B/F B/S HALA ($1.59) · Ever Roast→EVERROAST CHICKEN · Eggs (hard)→EGG HRD CKD PLD DRY PACK 12/12 CT · Mayo→MAYO HD 4/1 GA ($2.28) · Sour cream→SOUR CREAM REAL · Heavy cream→CREAM HVY WHIPPING 40% TFF ($1.68) · Butter→BUTTER SOLID UNSLTD ($2.16) · Parm→CHEESE PARMESAN GRATED TUB ($3.46) · Ricotta→CHEESE RICOTTA IMPASTATA WM · Crushed tomatoes→TOMATO CRUSHED EXTRA HVY PUREE 6/#10 ($0.80) · Tomato paste→Tomato Paste 26% ($1.50) · Fresh tomato→Tomato Round 4x5 ($1.50) · Lettuce→LETTUCE CELLO ICEBERG CA ($0.74) · Arugula→ARUGULA BABY ($4.13) · Basil→BASIL FRSH ($10.34) · Parsley→PARSLEY FRSH FLAT ITAL ($10.86) · Chives→CHIVES FRSH ($22+) · Thyme→THYME FRSH ($35.19) · Cilantro→MISSING · Onions→ONION YLW JUMBO ($0.61) / ONION RED JUMBO ($0.67) · Garlic→GARLIC WHL PLD DOM ($3.29) · Celery→CELERY SPLIT ($3.71) · Cucumber→CUCUMBER EURO SDLS ($3.62) · Sweet peppers→SWEET PEPPERS ($10.25/lb — suspicious, cross-check) · Hot peppers→HOT CHERRY PEPPERS ($8.95) · Banana peppers→BANANA PEPPER RINGS BH ($8.75) · Roasted reds→PEPPERS RED FIRE RSTD ($1.13) · Radish→Radish Fresh Ref ($2.88) · Mushrooms→MISSING · Corn→MISSING · Cabbage→MISSING · Carrot→MISSING · Lemon juice→JUICE LEMON ALL NAT ($2.34) · Olive oil→OIL OLIVE 100% EV ($4.69) · Canola→OIL CANOLA CLR FRY · Vinegars→BALSAMIC ($1.35)/APPLE CIDER only · Panko→BREAD CRUMBS TOASTED PANKO ($1.06) · Flour→King Arthur Special Spring ($0.49) · Salt→SALT KSHR COARSE ($2.26) · Pepper→PEPPER BLK WHL ($8.42) · Oregano→OREGANO LEAVES ($12.80) · Onion powder→ONION PWDR ($5.54) · Garlic powder→MISSING · Beef base→BASE BEEF NO MSG ($9.34) · Ground beef→BEEF GRND BULK 80/20 ($4.56) · Ground pork→PORK GRND 80/20 ($2.24) · Tuna→TUNA CHNK LIGHT CHN 6/66.5 ($2.34) · Horseradish→Horseradish Prepared Ref · Honey→AMBER EXTRA LIGHT · Cholula→Sauce Hot Plastic Jug · Dijon→MUSTARD DIJON · Pickles→PICKLES CHIPS 1/4 (**$35.95/lb — BAD DATA**).

### 6.4 Missing-from-Angel list, ranked by impact (the report §4.3 should generate automatically)
1. **Sub Roll** — every sandwich, ~$0.70 ea (Cardinal per co-ops costing)
2. **Capicola** — 4 signature subs, ~$0.31/oz (BH)
3. Raw eggs — cutlet, meatballs, strata, breadpudding (~$0.20 ea, Baldor)
4. Cabbage (red+green) + carrots — coleslaw is 70% uncosted
5. Whole-grain mustard, worcestershire, white/red-wine/rice vinegar, sugar, milk, vanilla, garlic powder, chili flake, chocolate chips, cherries, celery seed, old bay, turkey base, cranberry sauce, cornbread mix, vegan mayo, sun-dried tomato, oyster mushrooms, corn, cilantro, limes, romaine, Utz chips, grapeseed oil, nutritional yeast, dried chives — each blocks one or two recipes; co-ops' invoice-driven catalog already prices most of them (`inventory-costing.csv`).

## 7. Meta-lesson from the entry process itself

It took two days of careful browser automation (with sub-agents doing the mechanical entry and a verifier checking every batch) to move one restaurant's menu into Angel — because Angel's only interface is a mouse-driven form. Co-ops' entire equivalent dataset already lives in seed scripts and can be re-costed in seconds. Whatever else co-ops takes from Angel, **keep the system programmable**: the costing engine as pure functions over the registry (recipe-math already is this), UIs as thin views on top, and every screen's data reachable by script. That's the structural advantage a broker-run SaaS can't copy — Angel's advantage (frictionless price feeds) is one co-ops can approximate with invoice ingestion + provenance; co-ops' advantage (owning the data model and the code) is one Angel can't approximate at all.
