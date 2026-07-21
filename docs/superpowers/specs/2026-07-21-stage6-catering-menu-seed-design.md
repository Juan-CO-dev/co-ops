# Stage 6 — Catering Menu Seed (design)

**Status:** approved 2026-07-21 (Juan). Part of THE OPERATIONAL SEED (see
`docs/superpowers/specs/2026-07-21-operational-seed-decisions.md`). This is the
highest-leverage seed stage: it populates `menu_items` (empty today) + the catering
offering, which lights up the dormant catering moat (W1a pricing, W4a/W4b/W4c
demand+surplus) and the customer order funnel ⑤.

## Goal

Mirror CO's live Toast menu into CO-OPS as sellable, costed, depleting artifacts, and
seed the catering packages — so catering pricing/quotes and cost-to-make/depletion
run on real data.

## Grounding (live schema, verified 2026-07-21)

- **`menu_items`** — `id, name, name_es, menu_price, toast_ref, section, active,
  catering_available, catering_only, catering_portionable`. **0 rows** (greenfield).
- **`items`** already carries the sell columns: `sold_directly, menu_price,
  sell_portion, sell_portion_unit, catering_available, catering_only`. 45 active prep
  items exist, 41 wired to production recipes (Stage 3). 0 currently `sold_directly`.
- **Composition graph (canonical):** `recipe_inputs → recipe → recipe_outputs`.
  `recipe.recipe_type ∈ {production→output_item_id, consumer→output_menu_item_id}`.
  Stage 3 seeded 41 `production` recipes; **0 `consumer`** recipes exist yet.
- **`catering_packages`** — `id, location_id, slug, label_en/es, description_en/es,
  pricing_mode, price_cents, min_headcount, lead_time_hours, active, display_order`.
  Plus `catering_package_items` and `catering_package_slot_options`. **0 rows.**
- **`catering_rate_rules`** — W1a per-location pricing config. **NOT seeded here** —
  Juan authors it in the W1a rate-authoring UI (pricing policy = business decision).

## Data sources

1. **Regular menu** — `https://order.toasttab.com/online/compliments-only-capitol-hill-526-8th-street-southeast`
   → item names, sections, **regular** `menu_price`. Same menu for both locations.
2. **Catering menu** — `https://www.toasttab.com/catering/compliments-only-capitol-hill-526-8th-street-southeast`
   → catering à-la-carte prices + **package** definitions (platters, lunch boxes, footers).
3. **Sandwich build sheet** — `docs/seed/source/sandwich-build-sheet.csv` — the 11
   signature-sub builds (ingredient items + qty).
4. **Recipe .docx** — `docs/seed/recipes/ALL-RECIPES.md` — for the 3 deferred sub-items.

**Scrape method:** Toast blocks WebFetch (403) but renders in a real browser
(Playwright MCP). Extract exact names + prices from the **accessibility snapshot**
(`browser_snapshot`), not vision on a full-page thumbnail. Both pages confirmed loadable.

## The modeling rule (where each Toast menu line lands)

Aligned with W1a's "subs = `menu_items` (portionable ¼/½/whole), extras = `items` (whole)":

| Toast menu line | Lands as | Build |
|---|---|---|
| **Subs** — 11 signature + ~9 Build-Your-Own | `menu_items`, `catering_portionable=true`, `catering_available=true` | **consumer recipe** (`output_menu_item_id`) |
| **Prepped-item sides/extras** — Tuna/Egg/Chicken Salad, French Onion Dip, Antipasto/Pasta Salad, Side of Meatballs, Roasted/Stuffed Peppers, Quart of Pickle Spears | the existing **`items`** → `sold_directly=true` + `menu_price` + `sell_portion`(+unit) + `catering_available=true` | already have a production recipe |
| **Resale** — Utz chips, DB/Coke/Topo/Saratoga/teas/Natalie's/water, cookies, cannoli, gear | `menu_items`, priced, **no build**; `catering_available` for drinks/sweets, off for gear | none |
| **Catering packages** — Sandwich Platters (8/12/48-pc), Light/Full Lunch, Three/Six Footer | `catering_packages` (+ `slot_options` where pick-N) | n/a |

Rationale: subs are composed + portionable (the catering-pricing basis); prepped sides
are the items themselves sold whole (no duplicate row); resale is a flat priced menu
line; platters are packages.

## Sub-parts (gated seed scripts, like Stage 3 — each dry-run → prod → gate)

### 6a — Birth the deferred sub-items (prereq for signature-sub builds)
The build sheet consumes 3 items that don't exist yet. Seed them as `production`
recipes via the shared engine (`scripts/seed/lib-recipe-seed.ts`), birthing the item
if absent, then wire:
- **Meatballs** (Vesuvio) — recipe `Meatballs` + `Meatball Spice Mix` (recursive
  sub-item). New item "Meatballs", section Cooks/Misc.
- **Green Goddess** (Farmers Market) — recipe `Green Goddess`. New item "Green Goddess",
  section Sauces.
- **Caesar Dressing** (Turkey Caesar) — recipe `Cesear Dressing`. New item "Caesar
  Dressing", section Sauces.
Engine change: allow a recipe def to **create its output item** when missing (today
it skips-and-reports). Add an `createItemIfMissing` opt or a small pre-step that
inserts the item (name, section, tracking_type='portioned', batch_yield=1, is_default).

### 6b — Subs → menu_items + consumer-recipe builds
- Scrape both Toast pages → sub list with regular `menu_price` + `section`.
- Insert each sub into `menu_items` (`catering_available`, `catering_portionable=true`,
  `toast_ref` if available; `name_es` later).
- Extend the recipe engine to support **consumer output** (`output_menu_item_id`) — a
  `seedMenuRecipes` sibling or an `outputMenuItemId` field on the def. Wire:
  - **11 signature subs** — full builds from `sandwich-build-sheet.csv`. Inputs are
    mostly prepped **items** (`component_item_id`) + a few raw SKUs; auto-placeholder
    unresolved SKUs (per Stage-3 pattern).
  - **~9 Build-Your-Own subs** (Turkey/Ham/Roast Beef/Salami/Pepperoni/Veggie/Tuna
    Salad/Egg Salad/Chicken Salad) — simple builds: the meat/salad item + standard
    fixings (Shredduce, Onion, Oil/Vin, Oregano) + the roll SKU.
- **Build-sheet ingredient resolution** (item-first for prepped, SKU for raw):
  sauces/deli/veg/cook names → their wired **items**; `Shredduce`→Iceberg item;
  `Oil/Vin`→Vin item; `Shredded Cheese`→Shredded Mozzarella item; `Utz Ripples`→Utz
  chips SKU; `Arugula`→Arugula SKU; `Bacon`→BH Bacon SKU; seasonings (Oregano, Black
  Pepper, Salt, Lemon Oil, Parmesan, Balsamic)→raw SKUs. Report/placeholder misses.

### 6c — Prepped-item sides + resale menu_items
- **Sides that are prep items** → `UPDATE items SET sold_directly=true, menu_price=<toast>,
  sell_portion=<size>, sell_portion_unit=<unit>, catering_available=true` for Tuna/Egg/
  Chicken Salad, French Onion Dip, Antipasto Pasta, Meatballs, Roasted/Stuffed Peppers,
  etc. (audit `item.update`). NO new menu_item row for these.
- **Resale** → insert `menu_items` (name, section, `menu_price`, catering flags) for
  chips, drinks (reuse BH/other beverage SKUs conceptually; the menu_item is the sellable
  line), sweets, gear. No recipe. Drinks/sweets `catering_available=true`; gear off.

### 6d — Catering packages
- Scrape the catering page's platters/boxes/footers → `catering_packages`
  (`slug, label_en, price_cents, min_headcount, lead_time_hours, pricing_mode, location_id`).
  Packages are **per-location** (seed for both Capitol Hill + P Street, same prices).
- Where a package is "pick N of a group" (e.g. platter of assorted subs), seed
  `catering_package_slot_options` (W1b) referencing the sub `menu_items`; fixed contents
  → `catering_package_items`.

## Deferred / not in scope
- `catering_rate_rules` — Juan authors in the W1a UI.
- Spanish names (`name_es`) — follow-up (i18n pass).
- `toast_ref` / true Toast POS mapping — the Toast integration phase.
- P Street price divergence — assume same as Capitol Hill (Juan confirmed).

## Idempotency, audit, verification
- All scripts idempotent (upsert by name; menu_items by (name); packages by (slug,
  location)). `pathToFileURL` main-guard; `SEED_DRY=1` dry-run; per-script report of
  created/updated/misses/placeholders.
- Audit: `menu_item` lifecycle (add to `lib/destructive-actions.ts` if absent, else use
  a sensible action), `recipe.create` for consumer recipes, `item.update` for
  sold-directly flips, `catering_package.create`.
- Verify per script: counts on prod; every signature sub has a consumer recipe with ≥1
  input; catering-flagged subs have a `menu_price` (or reported null); packages have
  price_cents + min_headcount.
- Human smoke: after 6b/6d, Juan spot-checks a sub's cost-to-make + a catering quote
  deriving a price (once he sets a rate rule).

## Risks
- **Toast scrape brittleness** — snapshot structure may shift; capture raw scraped
  data to a `docs/seed/source/toast-menu-*.md` artifact per run for reproducibility.
- **Consumer-recipe engine extension** — the current engine only writes production
  outputs; the menu-output path is new (small, but the first `consumer` recipes in prod).
- **Side vs menu_item ambiguity** — a few lines could be modeled either way; the rule
  above is the tie-breaker (is it an existing prep item? → item.sold_directly; else →
  menu_item).
