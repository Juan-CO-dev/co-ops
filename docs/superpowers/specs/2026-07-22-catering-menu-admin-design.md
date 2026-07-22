# Admin catering-menu manager (sub-project C) — design

**Date:** 2026-07-22
**Status:** approved (design); ready for implementation plan
**Predecessors:** the identity-arc catering-menu flag editor (`/admin/catering/menu`, items-only), W1a rate rules, W1b package builder, the operational seed, sub-project A (`item_sizes`, PR #159), sub-project B (package configurator, PR #160).

## Goal

Give managers a complete admin surface to control the customer catering menu: enable/disable which **items AND subs** appear (currently only items are manageable), toggle a sub's catering **portions**, and fully manage the per-item catering **sizes** (add/edit/deactivate). Third of the 3-part catering-menu fix (A = side sizes, B = packages, C = admin).

## Grounded findings (shape the scope)

- An admin catering-menu editor **already exists**: `/admin/catering/menu` (GM+ level 7, Tier-A step-up, i18n, grouped-by-section). It toggles `catering_available`/`catering_only` — but **only on `items`** (`lib/admin/catering/menu.ts` `loadAdminMenuItems`/`setCateringFlags`; `PATCH /api/admin/catering/menu/[id]`; `MenuClient`).
- The **catering_available pre-config already matches the Toast catering page**: 66/68 active `menu_items` are catering-available (all subs + sides + drinks + sweets + bundles), the only 2 off are **Gear** (T-shirt, sticker — correctly excluded), and the 6 sold-directly `item` sides are on. **No reconcile needed.**
- The gaps C fills: the 66 `menu_items` (the actual à-la-carte subs/resale) aren't manageable, and there's **no `item_sizes` editor**.
- **Packages** already have the **W1b builder** (`/admin/catering/packages`) — C does not rebuild package editing; it adds a link for discoverability.

## Scope

**In (sub-project C):**
- Extend the editor to manage **`menu_items`** (available + only toggles, + a **portions** toggle for subs = `catering_portionable`).
- A full-CRUD **`item_sizes` editor** on `items`: add (label + price + serves), edit (label/price/serves), deactivate (append-only).
- A link from this page to the W1b package builder.

**Out (deferred / not C):**
- Package editing (W1b builder already covers it).
- `catering_available` reconcile (already matches Toast).
- The "6 oz" size relabel — **Juan will do it himself in the new editor** once it ships (dogfood; validates the edit path). Tuna/Egg "½ pint" + Antipasto "pint" become "6 oz" via the UI.
- Meatballs "2 meatballs" / Chicken-Salad-has-no-32oz details — flagged, no change (Chicken Salad has no large size on the Toast catering page; it can get one via the editor if wanted).
- Sizes on `menu_items`/subs — subs use portions (`catering_portionable`), not sizes; only `items` have `item_sizes`.

## Data model

**No new tables, no migration.** Existing columns: `items.catering_available/catering_only`, `menu_items.catering_available/catering_only/catering_portionable`, `item_sizes` (from 0143: `item_id, label, price_cents, serves, display_order, active, created/updated_by/at`, `unique(item_id, label)`, deny-all RLS / service-role only).

## Server layer

### `lib/admin/catering/menu.ts` (extend)
- `AdminMenuEntry` (widen `AdminMenuItem`): add `kind: "item" | "menu_item"`, `cateringPortionable: boolean | null` (null for items), and (items only) `sizes: AdminSize[]`.
- `loadAdminCateringMenu(actor)`: load active `items` (with their `item_sizes`, active first / display_order) **and** active `menu_items` (with `catering_portionable`); return both, each tagged `kind`, section-grouped-ready. (Keep `loadAdminMenuItems` or replace its callers.)
- `setCateringFlags(actor, kind, id, changes)`: `changes = { cateringAvailable?, cateringOnly?, cateringPortionable? }`. Dispatch to `items` or `menu_items`. Enforce `only ⇒ available` and `!available ⇒ !only` (mirrors the current items logic + the DB CHECK). `cateringPortionable` applies to `menu_items` only (ignored for items). Audit `catering.kb.menu.set_flags` with `kind` in metadata.

### `lib/admin/catering/item-sizes.ts` (new)
Service-role, GM+ (`MENU_ADMIN_MIN = 7`), audit, mirrors `lib/admin/catering/packages.ts` conventions (typed `AdminCateringMenuError`-style errors, normalize helpers, append-only).
- `interface AdminSize { id; label; priceCents; serves: number | null; displayOrder; active }`.
- `addItemSize(actor, itemId, { label, priceCents, serves })`: validate (label non-empty, priceCents int ≥ 0, serves null-or-positive-number). Verify the item exists + is a global (`location_id is null`) active item. `unique(item_id,label)`: query first — an **active** dup label → 409 `size_exists`; an **inactive** dup → reactivate + overwrite price/serves. Else insert with `display_order = max+1`, `active=true`, `created_by`. Audit `catering.kb.item_size.create`.
- `updateItemSize(actor, sizeId, { label?, priceCents?, serves? })`: normalize the provided fields; a label change must not collide with another active size of the same item (409). Update + `updated_by/at`. Audit `catering.kb.item_size.update`.
- `deactivateItemSize(actor, sizeId)`: `active=false` (never DELETE — append-only; a customer's `catering_quote_item_options`/draft may reference it, and `resolveLines` drops an unknown/retired size gracefully). Audit `catering.kb.item_size.deactivate`.

## Routes (Tier-A step-up, GM+; mirror the existing PATCH route)

- **`PATCH /api/admin/catering/menu/[id]`** (extend): body gains `kind: "item" | "menu_item"` (required) + optional `cateringPortionable: boolean`. Validates types; dispatches `setCateringFlags(ctx, kind, id, changes)`. `assertStepUp(ctx, "A")` as today.
- **`POST /api/admin/catering/menu/[id]/sizes`** (new): `[id]` = itemId; body `{ label, priceCents, serves }` → `addItemSize`.
- **`PATCH /api/admin/catering/item-sizes/[sizeId]`** (new): body `{ label?, priceCents?, serves? }` → `updateItemSize`. (Top-level `item-sizes` route avoids a `menu/[id]` vs `menu/sizes` dynamic-segment collision.)
- **`DELETE /api/admin/catering/item-sizes/[sizeId]`** (new): `deactivateItemSize`.
All: `requireSession` → `level >= MENU_ADMIN_MIN` → `assertStepUp(ctx,"A")` → typed-error mapping to `jsonError`.

## UI — `components/admin/catering/menu/MenuClient.tsx` (extend)

- **Two grouped lists.** Items list (existing look) — each item row keeps the available/only toggles **and** gains an expandable **Sizes** editor (an inline panel: existing sizes with label/price/serves + edit + deactivate, and an "add size" row). Menu-items list (new) — grouped by section, each sub/resale row with **available + only** toggles, and subs additionally a **portions** (`catering_portionable`) toggle.
- Writes use the existing **Tier-A step-up retry** pattern (`PasswordModal`; on `step_up_required`/`step_up_stale`, open the modal and retry the pending action). Optimistic local state update on `ok` (as today).
- A small link/card to `/admin/catering/packages` ("Edit packages →").
- Full i18n (`admin.catering.menu.*` extended: `menu_items` heading, `portionable` label, size-editor labels + errors `size_exists`/`invalid_size`).

## Auth / correctness
- GM+ (level 7) everywhere (mirrors `MENU_ADMIN_MIN`); Tier-A step-up on every write.
- `only ⇒ available` enforced server-side for both kinds.
- Deactivate-not-delete for sizes (a live draft/quote may reference a size; `resolveLines` already tolerates a missing size → drops it).
- UPDATE/writes check `count`/error and return typed errors (silent-0-rows discipline).

## Testing
- **Fable read-only + write smoke (prod-safe):** `loadAdminCateringMenu` returns both items (Tuna with its 2 sizes) and menu_items (a sub with `catering_portionable`); an `addItemSize`/`updateItemSize`/`deactivateItemSize` round-trip on a throwaway label then cleans up (or a read-only assertion of the load shape + a dry check). Assert `only ⇒ available` invariant via `setCateringFlags`.
- `tsc --noEmit` + `next build` green; CI `build` gate.
- Manual smoke (preview, Juan): toggle a sub off/on; toggle a sub's portions; add/edit/deactivate a Tuna size; relabel "½ pint" → "6 oz"; confirm `/order` reflects the change.

## File structure
- **Modify** `lib/admin/catering/menu.ts` — kind-aware load + `setCateringFlags` + portionable (CC).
- **Create** `lib/admin/catering/item-sizes.ts` — size CRUD (CC).
- **Modify** `app/api/admin/catering/menu/[id]/route.ts` — `kind` + `portionable` (CC).
- **Create** `app/api/admin/catering/menu/[id]/sizes/route.ts` — POST add size (CC).
- **Create** `app/api/admin/catering/item-sizes/[sizeId]/route.ts` — PATCH/DELETE size (CC).
- **Modify** `app/admin/catering/menu/page.tsx` — load both kinds (CC).
- **Modify** `components/admin/catering/menu/MenuClient.tsx` — menu_items list + inline size editor + packages link (Sonnet).
- **Modify** `lib/i18n/en.json` + `es.json` — new keys (Sonnet, with the client).

## Model tiering
CC authors the admin libs + routes (sensitive write layer) + owns git + sole review; Sonnet builds the extended `MenuClient` + i18n. Fable smoke. One PR through the CI gate; Juan merges.
