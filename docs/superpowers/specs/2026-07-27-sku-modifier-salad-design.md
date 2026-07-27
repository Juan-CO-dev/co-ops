# SKU-target Toast modifiers + salad conversion — Part 2 (design)

**Date:** 2026-07-27 · **Status:** APPROVED (Juan 2026-07-26, in-session) · **Named as Part 2 of** `docs/superpowers/specs/2026-07-24-toast-modifier-depletion-design.md` (Part 1 line 23: "Part 2 (OUT, named): SKU-ref removals (mayo-as-SKU class)…").

Build discipline: STAGED migration only (prod apply deferred to Juan's go), commit per step, no push, no live-DB touch.

## The problem (the salad mechanism)

A salad at the register is **not a menu item** — it's any regular sub or Build-Your-Own **plus a single modifier**: *"No bread- serve it on a bed of greens."* Toast never punches a "Salad" product; the sub is punched normally and the salad-ness rides entirely on that one modifier.

Depletion-wise that modifier means exactly one thing: **REMOVE one Sub Roll.** The Sub Roll is a **SKU** (a vendor `vendor_items` row, `sku_class='raw'`) — it has no prep `item`. The greens that replace it are **already punched as their own separately-added modifiers** (Arugula / spring mix), so the greens deplete themselves through the existing modifier lane — nothing new needed there. The only gap is the bread removal, and the modifier lane built in Part 1 can only target `item`s and (since the platter spec) `menu_item`s — **it cannot target a SKU.**

## One capability solves four things

Adding a **SKU target** to the modifier lane is not a one-off for salads. The same capability unlocks the whole class of raw-SKU modifiers that have no prep item:

1. **Salad conversion** — "No bread" removes one **Sub Roll** SKU. (The headline.)
2. **Arugula** — a raw SKU sometimes added as a modifier; no prep item exists for it.
3. **Pepperoncini** — raw SKU, added modifier, no prep item.
4. **Dijon** — raw SKU (mustard), added modifier, no prep item — the "mayo-as-SKU class" Part 1 named.

Four modifiers, one schema move + one depletion lane. That is the whole justification: rather than birthing throwaway prep items for raw condiments, the crosswalk targets the SKU directly.

## Model

The modifier lane gains a fourth target kind alongside `item` / `menu_item` / (assortment behavior): **`sku`**. A SKU-target modifier row:

- `is_modifier` is **REQUIRED true** — a SKU can never be a *base* Toast line (we don't sell a raw Sub Roll or a scoop of Dijon as a product). SKU base mapping is explicitly OUT of scope.
- Carries a disposition classified from the Toast name exactly like item modifiers: `No X` → **remove**, `Add/Extra/More X` / plain → **deplete**. (`ignore` still possible if a human overrides.)
- Default portion for a SKU target is **qty 1, unit `each`** (Sub Roll = 1 each; a raw condiment scoop = 1 each). A human can later curate the portion via unmap + re-map (Part-2-follow admin editor is deferred, same as Part 1).

### Portion → oz conversion (the depletion currency)

SKU depletion is tracked in **oz** (SKUs already flatten to oz everywhere — `skuConsumed` is oz). A modifier application converts its portion to oz:

- `unit === 'oz'` → **qty oz** directly.
- `unit === 'each'` (or null) → **qty × `vendor_items.avg_oz_per_each`** for that SKU.
- No `avg_oz_per_each` on the SKU (null) → **unresolvable** → the application surfaces to the existing `modifierStats.portionNeeded` advisory (never guessed, never silently dropped — same doctrine as item portions).
- Any other unit → unresolvable → `portionNeeded`.

**deplete** adds `portionOz × qty`; **remove** subtracts `portionOz × qty`. After the existing item-flatten populates the SKU oz map, the signed SKU adjustments apply, then **each SKU total clamps at ≥ 0** (parity with the item/menu_item clamp — a day can't consume negative bread).

The removed SKU oz is tracked for display parity (`removedOz` on the SKU readout row), so the salad Sub-Roll removals are visible truth, not a silent subtraction.

## Changes

1. **Migration 0158 (STAGED):** `toast_menu_map + sku_id uuid references vendor_items(id)`; drop `toast_map_entity_xor` and re-add as the 4-FK form:
   `(num_nonnulls(menu_item_id, item_id, package_id, sku_id) = 1) OR (is_modifier AND disposition in ('assortment_full','assortment_classics') AND num_nonnulls(...same 4...) = 0)`.
   Dispositions unchanged (the `sku` target reuses deplete/remove/ignore).
2. **`lib/admin/toast-map.ts`:** `DbMapRow`/`ToastMapRow` + `skuId`; selects thread `sku_id` (mirroring the 0155 `package_id` arc); `manualMap` `entityKind` gains `"sku"` (validate `vendor_items` active; `is_modifier` REQUIRED true; portion default qty 1 unit `each`; disposition from `classifyModifier`); `listMappableEntities` gains active `vendor_items` where `sku_class='raw'` (kind `"sku"`, `locationId: null`); `loadToastMapState` `nameByEntity` covers SKUs.
3. **`lib/catering/toast-sales.ts` `salesConsumption`:** `modifierByGuid` gains `targetKind "sku"`; a signed `skuAdjust Map<string,number>` accumulates deplete(+)/remove(−) `portionOz × qty`; the target SKUs' `avg_oz_per_each` + names batch-load in the existing names phase (no per-row queries); after the item flatten into the SKU oz map, apply `skuAdjust` then clamp each SKU ≥ 0; `removedOz` tracked per SKU for display. The `#180` split-flatten invariant lanes stay untouched.
4. **`app/api/admin/toast-map/manual/route.ts`:** `entityKind` whitelist `+= "sku"` (UUID `entityId` required; `isModifier` must be true for `sku` → 400 otherwise).
5. **SalesTab picker:** modifier rows also offer SKU entries, labeled with a translated `(raw)` tag; payload sends `entityKind "sku"`.
6. **i18n en+es** for every new visible string/aria (tú-form ES).
7. **Tests:** the pure portion→oz helper (`skuPortionOz`) extracted into `modifiers-shared.ts` gets vitest coverage: deplete/remove sign at the call site, each→oz conversion, null per-each → null.

## Out of scope (named)

- SKU **base** lines (a raw SKU sold as a product) — SKUs only target modifiers.
- The disposition/portion **admin editor** (still deferred from Part 1; correction path = unmap + re-map).
- Non-oz / non-each units on SKU targets (surface to `portionNeeded`).

## Done criteria

`npm test` and `npm run build` both green; migration 0158 STAGED only (no MCP apply); no push/PR. Post-merge/live: Juan maps the "No bread" guid → Sub Roll (remove), Arugula/Pepperoncini/Dijon guids → their raw SKUs (deplete), and salad conversion depletes bread correctly.
