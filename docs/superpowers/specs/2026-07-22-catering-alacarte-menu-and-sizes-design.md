# Catering Menu — Sub-project A: à-la-carte menu + side sizes (design)

**Status:** approved 2026-07-22 (Juan). First of three sub-projects fixing the catering menu
(A = à-la-carte + side sizes; **B** = package configurator; **C** = admin catering-menu control).
Follow-on to ⑤ (order-funnel carry-through) and Stage 6 of the operational seed.

## Why

After Stage 6, the `/order` catering portal surfaces the *regular* single-serve items. The
catering menu's **large-portion sides** (e.g. "Large Tuna Salad 32oz $18" vs the regular "Tuna
Salad ½-pint $4.25") and its **catering-only bundles/new salads** (House Greek Salad, Case of
Chips, Dozen Waters…) are missing. This sub-project adds an explicit-price **size model** for side
items and seeds the catering-only items, so the à-la-carte catering menu is complete.
**Packages are out of scope here** (sub-project B); **admin editing/enable-disable** is C.

## Grounding (verified 2026-07-21)

- **`lib/portal/menu.ts loadPublicCateringMenu(locationId)`** is ALREADY flag-driven: loads
  `items` (`catering_available=true`, `portionable:false` → whole) ∪ `menu_items`
  (`catering_available=true`, `portionable: catering_portionable`), prices each via
  `buildCateringMenuItem(row, rules)` (`lib/catering/menu.ts`) using the location's rate rules.
  Returns `CateringMenuItem[]` `{ kind, id, name, nameEs, section, cateringOnly, portionable,
  regularPriceCents, rateBps, unitPriceCents, portionPricesCents }`.
- **Cart line model** (`lib/portal/draft.ts`): `DraftLineInput { itemId?, menuItemId?, packageId?,
  portion?, quantity }`. `resolveLines(locationId, lines)` resolves each ref against the server
  menu (D20 price authority): `itemId` → whole at the item's price; `menuItemId + portion` → sub
  at the portion price; throws on an unknown/neither ref. `catering_quote_items` has `item_id`,
  `menu_item_id`, `package_id`, `portion` (text), `unit_price_cents`, `line_total_cents`,
  `description`. `setDraftLines` replaces lines + recomputes/snapshots the charge stack.
- **Rate model** (`lib/catering/pricing-derivation.ts`): catering price = base × portion-fraction
  × `rate_bps/10000`; `resolveRateBps` defaults to 10000 (baseline seeded 100% both shops).
- **Build page** (`app/order/build/page.tsx`): renders `draft.menu`; subs get a ¼/½/whole
  `PortionSelector`; items are quantity-only. **Storefront** (`app/order/page.tsx`, ⑤) renders the
  same menu + a selection tray whose Add carries `{menuItemId|itemId, quantity}` to `/order/start`
  → `preselect` → `createDraftFromIntake`.

## Design

### 1. Schema — migration `0143_item_sizes`
```sql
create table public.item_sizes (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id),
  label text not null,                 -- e.g. "½ pint", "32 oz", "Quart"
  price_cents integer not null check (price_cents >= 0),  -- base catering price for this size
  serves numeric,                      -- optional coverage weight (e.g. 32oz ≈ 4)
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (item_id, label)
);
alter table public.item_sizes enable row level security;
-- Config table: deny-all to end-users; service-role (lib) is the authority (mirrors item_components).
create policy item_sizes_no_user_select on public.item_sizes for select using (false);
create policy item_sizes_no_user_write  on public.item_sizes for all using (false) with check (false);

alter table public.catering_quote_items
  add column size_id uuid references public.item_sizes(id);  -- the chosen size on a sized-item line
```
`price_cents` is the size's **base** price (Toast catering price); the rate rule multiplies it
(100% now = the stored price), exactly like a sub's whole price.

### 2. `CateringMenuItem` gains `sizes`
Add to the type (`lib/catering/menu.ts`): `sizes?: Array<{ id: string; label: string;
unitPriceCents: number; serves: number | null }> | null` (present iff the item has active
`item_sizes`; null for subs + un-sized items). `buildCateringMenuItem` derives each size's
`unitPriceCents = round(price_cents × rateBps / 10000)`; the item's top-level `unitPriceCents`
becomes the **smallest** size's price (the "from …" figure).

### 3. Loader — `loadPublicCateringMenu` joins sizes
After loading `items`, batch-load `item_sizes` for those item ids (`active=true`, ordered by
`display_order`); attach `sizes` to each built item. Items with sizes are still `portionable:false`
(portionable is the sub ¼/½/whole flag) but now carry `sizes`. No change to the subs path.

### 4. Cart / pricing — thread `sizeId`
- `DraftLineInput` gains `sizeId?: string | null`.
- `resolveLines`: when a line has `itemId + sizeId`, look up the item's active `item_sizes` (must
  belong to that item), price `= round(size.price_cents × rate / 10000)`, `description =
  "${item.name} (${size.label})"`, persist `size_id`. `itemId` without `sizeId` stays whole
  (menu_price) as today; `menuItemId + portion` unchanged.
- `catering_quote_items.size_id` persisted; `loadDraft` selects `size_id` and returns it on
  `DraftItem` so the build page re-selects the chosen size.
- ⑤ `preselect` entry gains `sizeId?`; `parsePreselect` validates it (UUID or absent).

### 5. Build page — size picker
A sided item (has `sizes`) renders a **SizeSelector** (mirrors `PortionSelector`: chips per size,
each showing its price; default = first/smallest). The cart line carries `sizeId`; the customize
modal shows sizes; coverage counts `size.serves` (fallback 1). Subs unchanged (still `PortionSelector`).

### 6. Storefront — "from" price + default-size Add
Per ⑤'s "no portion UI on the storefront" principle, the size is chosen on the **build page**.
The storefront shows a sided item as `from ${smallest size price}`; **Add** carries the item's
**default (first) `sizeId`** in the preselect; the build page lets the customer change size. So a
sized item's storefront Add produces a valid, priced line at the default size.

### 7. Seed — `scripts/seed/08-catering-sizes.ts` (idempotent, gated on prod)
- **Sizes** (into `item_sizes`) for the salad/dip items — each gets its regular + 32oz catering size:
  | Item | Sizes (label · base price) |
  |---|---|
  | Tuna Salad | ½ pint · $4.25 · serves 1 · | 32 oz · $18.00 · serves 4 |
  | Egg Salad | ½ pint · $4.25 · serves 1 · | 32 oz · $16.00 · serves 4 |
  | Antipasto Pasta | pint · $6.00 · serves 1 · | 32 oz · $16.00 · serves 4 |
  | Onion Dip | 6 oz · $5.00 · serves 1 · | 32 oz · $20.00 · serves 4 |
- **Catering-only bundle / new-salad `menu_items`** (section "Catering Sides" / "Catering Drinks",
  `catering_available=true`, `catering_only=true`, `catering_portionable=false`):
  House Greek Salad $12 · Caesar Salad $12 · Quart of Pickle Spears (12) $9 · Case of Mini Chips
  (24) $20 · Case of Assorted Chips (24) $52 · Dozen Waters $12 · 24 Mixed Sodas $48.
- Idempotent (sizes by `(item_id,label)`; menu_items by name). `SEED_DRY=1` dry-run; `SEED_DRY`
  gate; audit rows (`item_size.create`, `menu_item.create`). Run stage-by-stage on prod.

### 8. Deferred (not in A)
- **Packages** (platters/lunch-boxes/footers) — surfaced + orderable in **B** (slot-picker + cart
  `packageId` pricing). Not shown in A.
- **Cost/depletion** of sizes/bundles (a size → recipe consuming the base item ×N) — advisory,
  later.
- **Admin** size-editor + `catering_available` enable/disable toggle — **C**.

## Security / integrity
- Prices stay server-authoritative: `resolveLines` re-resolves `sizeId` against `item_sizes`
  (belongs-to-item + active check) and derives the price — the client only sends refs (D20).
- `item_sizes` is a deny-all config table (service-role only); seeded + edited (C) via the lib.
- A `sizeId` referencing another item, an inactive size, or a non-existent size → `resolveLines`
  drops/throws (best-effort in `createDraftFromIntake`, so a stale storefront ref can't fail order
  creation — same guard ⑤ added).

## Testing
- Migration applied to prod (CC) + repo file. `tsc` + `next build` green.
- Seed: dry-run → prod → SQL read-back (sizes present, bundles present, catering menu count up).
- Manual smoke (preview): `/order` shows the 32oz sides ("from $…") + the bundles; build page's
  size picker changes the price; a sized line persists with the right server price + subtotal.
- A hand-crafted preselect with a bogus/foreign `sizeId` leaves that line out, order still succeeds.

## Files
- **Create:** `supabase/migrations/0143_item_sizes.sql`, `scripts/seed/08-catering-sizes.ts`,
  `components/portal/…SizeSelector` (or inline in the build page).
- **Modify:** `lib/catering/menu.ts` (`CateringMenuItem.sizes` + `buildCateringMenuItem`),
  `lib/portal/menu.ts` (join `item_sizes`), `lib/portal/draft.ts` (`DraftLineInput.sizeId` +
  `resolveLines` + `loadDraft` `size_id`), `app/api/portal/magic-link/request/route.ts`
  (`parsePreselect` sizeId), `app/order/build/page.tsx` (SizeSelector + cart sizeId),
  `app/order/page.tsx` + `components/portal/StorefrontOrderTray.tsx` ("from" price + default-size Add).

## Confirm-before-authoring (at plan/build time)
Re-read `lib/catering/menu.ts buildCateringMenuItem` (exact args + how it returns portionPrices) to
mirror for `sizes`; confirm `resolveLines` + `catering_quote_items` current columns; confirm the
next migration number is 0143; re-read the ⑤ `StorefrontOrderTray`/`preselect` shape to extend it.
