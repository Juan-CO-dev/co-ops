# Items Master Catalog + recipe-builder catering flags — design (2026-07-26)

**Status: APPROVED (Juan, 2026-07-26, remote session). Scope = pieces 1+2 of a
3-piece decomposition; piece 3 (checklists/reports pull from the master list,
one editing hub) is a SEPARATE future design.**

## Problem (Juan, verbatim gist)
"We have a SKUs page, a recipes page, but not a page to see all items and
where they route to… the way we got it not being able to be viewed only in a
checklist template is lowkey wild." Editing belongs where items are born (the
recipe builder); list surfaces should eventually pull from the master list.

## Piece 1 — the Catalog (evolve /admin/items)
`/admin/items` becomes THE catalog with two top-level views:
- **Catalog (default, NEW):** every items-universe entity — prep + sold-as-is
  ITEMS, MENU_ITEMS (subs/resale), CATERING_PACKAGES — with lens chips
  [All · Prep · Sold as-is · Menu items · Packages · Seasonal · Issues],
  one search box, rows grouped by section, each row expanding to a routing
  DOSSIER + a seasonal toggle.
- **Prep registry (classic):** the EXISTING ItemsClient untouched (zero
  regression) behind a view switcher.

Dossier edges (server-assembled once per page load — batch loaders only, the
loadRecipeGraph law; NO per-row queries):
- items: producing recipe(s) → link /admin/recipes/[id]; leaf SKUs (via
  perUnitSkuOzForItemFromGraph keys, names from vendor_items); used-in
  menu_items + parent items (graph inputs scan); packages containing it (slot
  options + fixed lines); checklists counting it (checklist_template_items
  .item_id, active, joined to active checklist_templates → name); Toast
  confirmed-GUID count; item_sizes count; flags (active/seasonal/sold_directly/
  catering pair/serves) + readiness badge (loadGraphReadiness).
- menu_items: consumer build recipe → link; first-level component items
  (firstLevelItemConsumption keys); packages referencing it; Toast GUID count;
  flags (catering trio + serves + seasonal + section).
- packages: line composition (existing loader shape); Toast GUID count
  (package_id); serves/pricing/location; seasonal.
- Every edge renders as a Link to the owning editor (recipes, catering menu,
  packages, SKUs, checklist-templates). The catalog only WRITES seasonal.

Issues lens (pure classifier, client-safe shared module, vitest-pinned):
- `no_recipe` — item with no active producing recipe / menu_item with no build
- `no_sku_path` — item readiness != ready (passed in)
- `not_sold` — item: !sold_directly && no sizes && not used by any menu_item/
  package; menu_item: !active is excluded anyway → skip
- `toast_unmapped` — active sellable entity (sold_directly item, menu_item, or
  package) with 0 confirmed Toast GUIDs

## Seasonal (migration 0156, STAGED — apply on merge)
`seasonal boolean not null default false` on items, menu_items,
catering_packages. A LABEL + LENS, not a hider — availability stays governed
by active/catering flags. Toggled from the dossier (and packages editor later
if wanted). Writes ride the existing surfaces:
- items + menu_items: `setCateringFlags` gains `seasonal` (kind-aware,
  audited, same route /api/admin/catering/menu/[id], Tier-A step-up).
- packages: `serves`-style fields concern on /api/admin/catering/packages/[id]
  (UpdatePackageChanges.seasonal, boolean).

## Piece 2 — recipe-builder flags
The recipe builder (components/admin/recipes/RecipeBuilder.tsx) shows, for
each MENU_ITEM output, a compact catering-flags row: Available / Catering-only
/ Portions / Serves / Seasonal — reading current values (loader extension) and
writing through the EXISTING /api/admin/catering/menu/[id] PATCH (step-up
modal reuse). Set at birth; no second trip to the catering menu manager.

## Non-goals (deferred)
- Piece 3: master-list-backed checklists/count/prep/report editing hub (own
  design; checklist_template_items.item_id already exists as the seam).
- Per-entity dossier PAGES (inline expand suffices; add later if it outgrows).
- Any storefront/portal behavior change from `seasonal` (label only, v1).

## Verification
Vitest: issue classifier (all 4 codes + happy path). Build green. Smoke on
preview: catalog renders all lenses, dossier links resolve, seasonal toggles
with step-up, recipe builder shows + writes flags.
