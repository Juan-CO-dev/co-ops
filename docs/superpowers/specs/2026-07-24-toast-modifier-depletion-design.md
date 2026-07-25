# Toast Modifier Depletion — Part 1 (design)

**Date:** 2026-07-24 · **Approved:** Juan live ("i dont want v1 to ignore removal… if someone removes an item from their sub, we do not count that as being consumed") — build on auto, HOLD at CI-green PR; migration 0152 staged.
**Evidence (live CH data):** BYO parents (Turkey/Veggie/Ham/Roast Beef Sub…) carry plain-topping modifiers (109/93/48/35 lines) and ZERO removals — modifiers ARE the build. Signature parents (Crunchy Boi 91 lines, 64 removals) carry ZERO plain toppings — recipe holds the full build; modifiers are DELTAS. `modifierOptionReferences` = dict keyed by referenceId, values `{guid, name, price, isDefault, …}` (363 at CH; live-verified 2026-07-24 — fixture mirrors it).

## Model

Per-modifier **disposition** on the crosswalk row (`toast_menu_map`, modifier lane):
- **deplete** — plain toppings + `Add/Extra/More X`: consumption += portion × qty.
- **remove** — `No X`: consumption −= amount × qty, where amount = **parent-aware** (the parent line's menu_item consumer-recipe input for that item, via the existing graph + `itemRefParUnits` weight-honest conversion) with **fallback** to the row's derived portion when the parent/input can't resolve. Per-item daily totals **clamp at ≥ 0** after aggregation; SKU flatten runs on the clamped item totals.
- **ignore** — instructions that match no item stay in the unmapped advisory (unchanged).

**Portion source (the 32×-trap guard):** a modifier application must never deplete a PAR UNIT. Default portion per application is **derived from the signature consumer builds** (median qty in the modal unit across all consumer-recipe inputs referencing that item — e.g. Provolone 2 each, Hot Peppers 0.25 oz), stored on the map row (`portion_qty`,`portion_unit`), converted at read time by the same `itemRefParUnits` math (registry oz_per_par → input-mass fallback). No derivable portion → row confirms but depletion skips it into a "portion needed" advisory.

## Changes

1. **Migration 0152 (STAGED):** `toast_menu_map` + `is_modifier boolean not null default false`, `disposition text not null default 'deplete' check (disposition in ('deplete','remove','ignore'))`, `portion_qty numeric`, `portion_unit text`.
2. **`flattenToastModifierOptions(json)`** in `lib/toast/menus-shared.ts` (pure): walks `modifierOptionReferences` → ToastItem[] (price → cents; guid/name required, poison on malformed entry; dedupe first-wins).
3. **`lib/toast/modifiers-shared.ts`** (pure, client-safe): `classifyModifier(name)` → `{disposition, matchName}` (`/^no\s+/i` → remove + stripped name; `/^(add|extra|more)\s+/i` → deplete + stripped; else deplete + verbatim); `derivePortion(graph, itemId)` → `{qty, unit} | null` (modal unit, median qty over consumer-build inputs); `modifierParUnits(graph, itemId, portion)` (wraps the now-EXPORTED `itemRefParUnits`); `removalAmount(graph, parentMenuItemId, itemId)` → parent recipe's input converted, `| null`.
4. **`runAutoMatch`:** second lane — modifier options matched (via `matchName`) against ALL active global items (not just sold_directly) + menu_items; candidates insert with `is_modifier`, auto `disposition`, derived portion. Item lane unchanged. `loadToastMapState`/row views carry the new fields.
5. **`salesConsumption`:** counted lines split base (parent null — unchanged math) vs modifier (parent ≠ null — resolve map row → disposition math above, signed par-units per item); merge with base item-units; clamp ≥0 per item; SKU flatten AFTER clamp; new advisories `portionNeeded[]` + `ignoredModifiers` count; removals surface as `removedUnits` per item (visible truth, not silent).
6. **ToastTab:** modifier rows badge (disposition + portion) in queue + confirmed lists; i18n en+es.
7. **Part 2 (OUT, named):** SKU-ref removals (mayo-as-SKU class), admin portion/disposition editor, negative-clamp analytics.

## Done criteria
122+ tests green (classifier, modifier flatten, portion derivation, signed clamp math, parent-aware removal via graph fixtures); fixture updated from the live shape; build green; 0152 staged only. HOLD at CI-green PR. Post-merge sweep re-matches + auto-confirms exact modifiers and re-reads consumption.
