# Verify → Go-Live Soft-Gate — Design (derivation-spine sub-project #2)

**Date:** 2026-07-05
**Status:** approved by Juan (brainstorm 2026-07-05)
**Parent:** `2026-07-01-derivation-spine-skeleton.md` §5 (soft gating) + §8 sub-project 2
**Prior state:** Recipe stage complete (PRs #107 + #108, prod `d6f2d8f`, migrations through 0105). Toast mapping deferred a few days — this slice is deliberately Toast-independent.

## Purpose

Make data-completeness **visible and actionable** across the derivation graph (SKU → recipe → item) without blocking anything. Gates are status + prompts, never walls: build in any order, backfill freely, and the system nudges toward "ready." This is the trust-the-team posture from the skeleton, shipped as a read-only layer.

## Core decisions (from brainstorm)

1. **Purely computed status.** No new columns, no "mark verified" button, no migration. Readiness derives 100% from existing data and flips itself the moment a gap closes (e.g. a SKU's first delivery is recorded). An explicit human go-live step can be layered on later if computed proves too loose.
2. **Two-level badge (propagation).** Each entity distinguishes:
   - **`incomplete`** (red) — its OWN fields are missing → fix it here.
   - **`upstream_gaps`** (amber) — its own fields are fine but something it consumes isn't ready → fix it upstream.
   - **`ready`** — no badge at all (gaps-only badging; a quiet page = everything live).
3. **Vocabulary: "Ready" / "Not ready" — never "verify."** `items.opening_verify` already owns the word "verify" for the opening-station physical check; overloading it would blur two features.
4. **All four surfaces in v1:** SKU catalog + vendor SKU cards, recipes list + builder, items Global registry tab, admin-hub count pills.

## Readiness rules (the contract)

### SKU (graph root — own signals only)

`ready` ⇔ ALL of:
- **Pack complete:** `units_per_pack > 0` AND `each_size > 0` AND `each_measure` set → reason `missing_pack`
- **Priced:** a current row in `vendor_price_history` → reason `missing_price`
- **Proven by receiving:** ≥ 1 line in `vendor_delivery_items` → reason `no_delivery`

Inactive SKUs (`active = false`) show only the existing "Inactive" pill — no readiness badge; they're out of play and shouldn't count in rollups.

### Recipe

- **Own (`incomplete`):** missing inputs OR missing outputs OR `batch_yield` unset/≤0. (Extends the shipped `recipes.badge.incomplete`, which today checks only inputs/outputs.)
- **Upstream (`upstream_gaps`):** any input SKU is not ready, OR any sub-item input's own chain isn't ready (transitive through the sub-item's producing recipe; cycle-guarded via the existing recipe-graph loaders in `lib/recipes.ts`). Reason copy like "uses 2 not-ready SKUs."
- Own-incomplete takes display precedence over upstream (red wins; reasons list can carry both).
- Inactive recipes: no badge, excluded from rollups.

### Item

- **Own (`incomplete`):**
  - no production recipe outputs it (`recipe_outputs.output_item_id`) → "no recipe — cost/traceability incomplete" (skeleton's own nudge copy), OR
  - `oz_per_par_unit` unset, OR
  - `sold_directly = true` without `sell_portion` + `sell_portion_unit` + `menu_price`.
- **Upstream (`upstream_gaps`):** its producing recipe is `incomplete` or `upstream_gaps`.
- Inactive/non-default handling mirrors the Global tab's existing display rules; inactive items excluded from rollups.

### Vendors — explicitly OUT of scope (v1)

Vendor-entity readiness (has contact / ordering detail / schedule) is a clean follow-on. SKU badges DO render on the vendor-detail SKU cards, which covers the practical need.

## Architecture — two thin layers, no migration

### `lib/readiness.ts` (client-safe, PURE — single source of truth)

Rule functions take plain signals, return `{ status: 'ready' | 'incomplete' | 'upstream_gaps', reasons: ReasonCode[] }`:

- `skuReadiness({ packComplete, hasPrice, deliveryCount })`
- `recipeOwnReadiness({ hasInputs, hasOutputs, batchYield })`
- `composeRecipeReadiness(own, inputStatuses[])`
- `itemReadiness({ hasProducingRecipe, ozPerParUnit, soldDirectly, sellPortionComplete }, producingRecipeStatus)`

No I/O. Unit-testable. Reason codes are a closed `KNOWN_REASONS` set (see i18n).

### `lib/admin/readiness-load.ts` (server composition)

Composes EXISTING loaders into per-page maps — no new schema:

- `loadSkuReadinessMap(actor)` — `loadSkus` (`lib/admin/skus.ts`) + `loadCurrentSkuPrices` (`lib/admin/cost.ts`) + **new lightweight `loadSkuDeliveryCounts`** (`SELECT sku_id, count(*) … GROUP BY` — do NOT hydrate full ledgers just for a count).
- `loadRecipeReadinessMap(actor)` — `loadRecipes` (**one-line select extension: add `batch_yield`** to the list query in `lib/recipes.ts`) + `recipe_inputs` + SKU statuses + graph walk for sub-items (cycle-guarded).
- `loadItemReadinessMap(actor)` — items view + `recipe_outputs` lookup + recipe statuses.
- `countNotReady(actor, level)` — hub rollups (SKUs / recipes / items not ready), computed only for sections the viewer's level can see.

PostgREST numeric columns arrive as STRINGS — coerce with the established `num`/`Number` helpers.

## Surfaces

1. **SKU catalog (`SkuCatalogClient`) + vendor SKU cards (`VendorSkusCard`):** badge + short reasons line per row ("Not ready — missing: price, delivery"). Most signals are already in page props; delivery count is the only added fetch.
2. **Recipes list (`RecipesClient`):** the existing "Incomplete" badge upgrades to the three-state model via `StatusBadge`. **Builder (`RecipeBuilder`):** a small "What's missing" line at the top when not ready (live mode only; draft mode already guides required fields).
3. **Items Global registry tab (`GlobalRegistryTab`):** badge inline next to the existing "Default" outline badge; full reasons inside the item's expanded edit panel.
4. **Admin hub (`app/admin/page.tsx`):** count pills on the SKU-catalog, Recipes, and Templates cards ("3 not ready"), parallel server fetches, rendered only when count > 0, respecting each card's `minLevel` from `lib/admin/sections.ts`.

**New shared component:** `components/admin/StatusBadge.tsx` — extracted from the inline-span pattern. Red = the shipped incomplete-chip classes (`bg-co-cta/15 text-co-cta`); amber = same shape, amber tint; no "ready" variant (gaps-only). First shared badge extraction in the admin — future badges should migrate to it opportunistically, not in this slice.

**Operator surfaces (AM/Opening/Mid-day, receiving) are untouched.** `lib/prep-consumption.ts` is untouched → no parity gate required this slice.

## Authority / security

Read-only feature. All loads run through existing service-role loaders behind the pages' existing gates (AGM+ view / GM+ manage — unchanged). No new routes, no step-up, no RLS changes. Hub counts must not leak: only fetch/render for cards the viewer can already open.

## i18n

EN + ES for all badge copy + reason strings. Reason codes render via interpolated keys (`readiness.reason.${code}`) — **reconcile the `KNOWN_REASONS` set against both JSON files** (interpolated keys are grep-invisible; audit the set, not grep — the #107/#108 lesson).

## Failure posture

If a readiness fetch fails, pages render **without badges** (log, degrade silently). Nudges must never take down a working admin page.

## Testing

- Unit tests on the pure rule functions in `lib/readiness.ts` (the contract).
- Throwaway smoke script cross-checking hub counts against direct SQL on prod data.
- Juan smokes the preview URL (badge presence/copy on all four surfaces).
- No parity gate (engine untouched).

## Non-goals (v1)

- Vendor-entity readiness badges.
- Any stored status / explicit go-live action.
- One-tap fix actions from the badge (nudges link nowhere yet; the reasons text tells you where to go).
- Retrofitting existing inline badges (Inactive/Default/location) onto `StatusBadge`.
- Operator-surface changes of any kind.
