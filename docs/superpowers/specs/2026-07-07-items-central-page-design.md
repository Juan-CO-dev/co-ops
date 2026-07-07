# Items Central Page + Recipe Delete — Design

**Date:** 2026-07-07
**Status:** approved by Juan (post-#109 smoke asks, brainstormed 2026-07-05→07)
**Prior state:** soft-gate shipped (PR #109, `43eb5a5`); migrations through 0105.

## The model (Juan, load-bearing)

**SKUs are the source of truth → recipes consume SKUs and create items → items are used in checklists and reports.** The admin IA should read like this pipeline. Items are a first-class central entity ("its own global situation just like the SKU has") — not a facet of the checklist-templates admin.

## Part A — `/admin/items` central page

### What moves (item-scoped, lifted from GlobalRegistryTab)

Recon fact: `GlobalRegistryTab` receives NO subtype/template context; the registry query (`lib/admin/templates.ts:2018-2025`) is already global (`items` where `location_id IS NULL AND active`). This is a relocation, not a rebuild. Moves to `/admin/items`:

1. **Add-item form** (`AddGlobalItem`) — GM+ (≥7), Tier B. Keeps its existing `POST /api/admin/checklist-templates/registry` route (which also propagates default lines to locations — behavior unchanged).
2. **Item rows grouped by section** with readiness `StatusBadge` (gaps-only) — AGM+ view.
3. **The full MoO+ (≥8) edit panel**: definition (name/ES, recommended par + `UnitSelect`, section, special instruction/ES, required, min role, tracking type, batch yield, oz-per-par-unit), sold-directly section, Default toggle, Opening-verify toggle, ItemQuestionsEditor. All existing routes reused verbatim — **zero route churn, zero migration**.
4. **Per-item producing-recipe link** (NEW, the pipeline made navigable): when `recipe_outputs` maps the item to an active recipe, the row links to `/admin/recipes/[thatId]`; otherwise the red "no recipe" badge is the nudge. Replaces the current bare `/admin/recipes` hub link.

Judgment call (approved): `section`/`required`/`minRoleLevel`/default/opening-verify are prep-flavored but stored ON the item — they move with the item editor. One home per item.

### What stays in checklist-templates admin (prep-report structure)

- **Sections panel** (rename/add/reorder/disable/input-type) + **section-questions panel** — these shape prep reports, which is what that admin is for.
- The Global tab becomes a slim "Sections" tab (sections + section questions + a pointer link to `/admin/items`). `ChecklistTabs` default-tab logic reworked (default = sections tab for ≥8, else first location).
- Per-location tabs (enable/disable + pars) unchanged.

### New pieces

- `app/admin/items/page.tsx` — server page, gate ≥6 (mirror skus page pattern), loads: registry items (extract/reuse the registry query), sections (for grouping + dropdown), units, itemQuestions, producing-recipe map (`recipe_outputs` where active recipe), `loadGraphReadiness` for badges (try/catch failure posture).
- `components/admin/items/ItemsClient.tsx` (+ relocated row/form components under `components/admin/items/`) — moved code, minimally adapted.
- `UnitSelect` extracted to a shared location (`components/admin/UnitSelect.tsx`) — consumed by both admin areas; its API route stays put.
- Hub card `{ id: "items", i18nKey: "admin.section.items", href: "/admin/items", minLevel: 6 }` + EN/ES keys. The soft-gate hub items-count pill re-points from the checklist-templates card to the items card.
- **Hub card order reordered to the pipeline:** users, vendors, skus, recipes, **items**, checklist-templates, categories, pars, locations, audit.

### Cleanup (recon-surfaced, free)

- `loadChecklistAdminView` drops the dead BOM/cost payload (`itemComponents`, `skuOptions`, `measureUnits` for costs, `itemCosts`) — computed on every load, consumed by nothing since MadeFromEditor was orphaned by the recipe stage. (MadeFromEditor file itself stays — kept-for-rollback convention.) It also drops `registry`/`itemQuestions`/readiness from the checklist page once the Global tab slims (keep `sections` + `sectionQuestions`).

## Part B — recipe delete (deactivate)

Backend exists end-to-end (`deactivateRecipe` lib/recipes.ts:204, `DELETE /api/admin/recipes/[id]` Tier B, audit `recipe.deactivate`). Ships:

- **Floor raised GM+→MoO+ (7→8)** in `deactivateRecipe` + the route's level check (Juan's call). Step-up stays Tier B.
- **UI**: "Delete" button on the recipe detail page (visible ≥8), ask→confirm pattern mirroring `SkuCatalogClient`'s `confirmDeactivateId`, calls the existing DELETE route, then routes back to `/admin/recipes`.
- Consequence (automatic, already shipped): deactivating a recipe flips its items to red "no recipe" via the soft-gate's inactive-edge rule.
- i18n: `recipes.delete.*` keys EN/ES (button, confirm, cancel).

## Authority summary (unchanged except recipe delete)

| Action | Floor |
|---|---|
| View /admin/items | AGM+ 6 |
| Add item | GM+ 7 (Tier B) |
| Edit item definition / toggles / questions | MoO+ 8 (Tier B) |
| Sold-directly (flag GM+ / menuPrice MoO+) | per `setItemSoldDirectly` (unchanged) |
| Recipe delete (deactivate) | **MoO+ 8** (Tier B) — raised from 7 |

## Failure posture / testing

- Readiness load failures render the items page without badges (established posture).
- Gates: typecheck + build + existing readiness rules script. No new migration → no parity concerns; operator surfaces untouched.
- Juan smokes preview: items page CRUD parity with the old Global tab (edit an item, add an item, toggle default/opening-verify, add a question), sections tab still works, recipe delete round-trip, hub order + items pill.

## Non-goals

- No route renames/moves (API paths keep their `checklist-templates/registry` homes).
- No migration, no RLS change.
- No per-location anything on /admin/items (pars/enable stay in checklist admin).
- No MadeFromEditor revival or deletion.
