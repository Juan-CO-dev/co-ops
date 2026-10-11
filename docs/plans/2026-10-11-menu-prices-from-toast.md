# Menu costing — selling prices from Toast (in-store menu)

Juan 2026-10-11: items on Admin → Menu costing show Cost but Price / Food cost / Margin "—". Cause: Price is
`menu_items.menu_price`, typed in at setup; 19 active items (added 10-08: 8 add-ons, 7 salads, Cheesy Boi,
2 modifier builds, Large French Onion Dip 16oz) never got one, and nothing reads Toast's prices. Juan's rulings:
**"Auto from Toast in-store"** (blank prices fill from Toast's in-store menu and stay in sync; a typed price that
differs from Toast is flagged; an editable Price field covers what Toast lacks) and **salads = the sub's price**.

## Facts (prod, 10-11)

- `toast_menu_cache` (one row per restaurant guid; payload = Toast `/menus/v2/menus`, 70–125 KB, fetched 10-01).
  Both shops have a menu named **"Compliments Only"** = the in-store menu (setup prices match it: Crunchy Boi
  15.79, Farmers Market After Dark 12.09). Other menus (GrubHub +~5%, "Get What You Get" $12, Staff, Staffer
  Combo, Owner / Otter, Catering…) are NOT the in-store price.
- `toast_menu_map` links Toast guids → `menu_item_id` per location (`is_modifier` true for modifier options,
  `active`). Its `toast_price_cents` is unreliable (first-wins across menus; null for modifiers) — do NOT use it.
- Modifier options live in `payload.modifierOptionReferences` (dict → {guid, name, price, pricingStrategy});
  add-ons are mapped there: Add Bacon 2, Add Ham 1, Add Turkey 5, fresh mozz 2, Add Pepperoni 1,
  Add Proscuitto 3.5, Add Roast Beef 4, Add Salami 1, Double Meat 5, Cheesy Boi (filling) 0.
- `lib/toast/menus-shared.ts` `flattenToastMenus` dedupes guids FIRST-WINS across ALL menus, so it cannot answer
  "price on the in-store menu". Add a new pure walker instead of changing it (other callers depend on it).

## Rules

1. **Toast in-store price** of a menu item = for each active `toast_menu_map` row of that menu item:
   - item rows: the item's `price` where it appears inside the menu named exactly `"Compliments Only"`
     (walk nested `menuGroups`; same guid may appear more than once → collect all);
   - modifier rows: `modifierOptionReferences[*]` with that guid → `price`.
   Collect across both shops. Price ≤ 0 or missing is ignored. One distinct value → that price.
   Several distinct values → use the LOWEST and mark `toastPriceVaries: { min, max }`.
   Constant `TOAST_IN_STORE_MENU = "Compliments Only"` in one place, with a comment saying why.
2. **Effective price** (what Food cost / Margin use) = first of:
   a. `menu_items.menu_price` when set and > 0 (typed — wins);
   b. Toast in-store price (rule 1);
   c. `price_same_as_id` → that menu item's effective price via (a)/(b) only (one hop, no chains);
   d. none → "—" as today.
   `priceSource: "typed" | "toast" | "same_as" | null`.
3. **Flag**: when (a) is used AND a Toast in-store price exists AND they differ by ≥ 1 cent → badge
   "Toast: $X" (amber, not red). No flag for (b)/(c).
4. **Zero-price modifiers** (e.g. Cheesy Boi filling = 0 in Toast): no effective price; show the line
   "Included in the sub's price" instead of "—" for items whose section is "Modifier builds" and have no price.
   Never divide by zero.
5. The page reads the CACHED payloads from `toast_menu_cache` only (no Toast API call at page load). Show a
   muted "Toast prices as of {fetched_at date}" note. If the cache read/parse fails, log a fixed code, fall back
   to typed prices only, and show a muted notice; the page must never 500 because of Toast.

## Data — migration `0245_menu_price_same_as.sql`

`alter table public.menu_items add column price_same_as_id uuid null references public.menu_items(id)`
with `check (price_same_as_id is null or price_same_as_id <> id)`. Match existing grants on `menu_items`.
Header in repo style (AUTHORED, NOT YET APPLIED — GATE CC: sim first, then prod).

Seed `docs/seed/seed-49-salad-prices.sql` (seed-48 style: temp table, guard DO block that aborts unless every
pair exists, is active, and the salad's `price_same_as_id` is null or already the target; idempotent; audit_log
`menu_item.update` with actor_context `seed_49`), linking by NAME:
Crunchy Boi Salad→Crunchy Boi · Farmers Market After Dark Salad→Farmers Market After Dark ·
It's a BOI Salad→It's a BOI · Marisa Tomei Eats Free Salad→Marisa Tomei Eats Free ·
Sicky Wicky Club Salad→Sicky Wicky Club · The Frex Salad→The Frex · The Teamster Salad→The Teamster.
(Exact-name match, `active = true`; abort on 0 or >1 match.)

## Editable price

- Menu costing Details drawer: a "Selling price" money input + Save, and "Use Toast price" (clears the typed
  price) when a Toast price exists. Level ≥ 8 only (owner/MOO/CGS); lower levels see read-only text.
- `PATCH /api/admin/menu-items/[id]/price` body `{ menuPrice: number | null }` (dollars, 0 < x ≤ 1000, 2 dp;
  null clears). Level ≥ 8, step-up tier per the repo's step-up map conventions for admin catalog edits (add it
  to the map + its test), audit `menu_item.update` with before/after menu_price. Mirror an existing admin
  menu-items/catalog route for session, CSRF and error shape.

## Code

- New pure module `lib/toast/in-store-prices-shared.ts`: `inStorePricesByGuid(payload)` → Map<guid, cents[]>
  for items on the in-store menu + modifier options; `resolveMenuPrice(...)` implementing rules 1–4.
  Exhaustive unit tests incl. nested groups, same guid on two menus with different prices (only in-store
  counts), modifier lookup, varies-by-shop, zero price, typed-vs-Toast flag, same_as one hop.
- `lib/admin/menu-costing.ts` `loadMenuCostingBoard`: load map rows + cache rows in the existing Promise.all;
  pass `effectivePrice` into composeMenuCostRows (keep `menuPrice` semantics for food cost = effective price).
  Rows carry `priceSource`, `toastPriceCents`, `toastPriceVaries`, `priceFlag`.
- `components/admin/menu-costing/MenuCostingClient.tsx`: small "from Toast" / "same as {sub}" caption under the
  price, the amber "Toast: $X" badge, the drawer editor. Totals/groups keep working (an item that now has a
  price moves groups correctly). i18n en + es for every string.
- Export (ExportLinks on the page) — if the menu-costing export reads menu_price directly, make it use the
  effective price too (grep the export route).

## Tests

Unit (pure resolver), loader (cache failure fallback, no Toast API call), route (auth, level, validation, audit,
null clears), UI (captions, badge, editor hidden < level 8). Keep the suite green.
