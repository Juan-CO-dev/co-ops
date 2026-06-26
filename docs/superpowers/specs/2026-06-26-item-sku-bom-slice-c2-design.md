# Item↔SKU BOM — Slice C2 Design

**Date:** 2026-06-26
**Phase:** Item/Inventory Spine — vendor mini-arc, Slice C2 (of C: C1 SKU catalog ✅ / C2 BOM / C3 converts-into + cost-yield). Depends on C1 (#98, squash `8bb2f0e`).
**Status:** approved (design), pending spec review

---

## Goal
On a portioned ITEM, capture **what it's made from** — its component SKUs and/or
sub-items, each with a quantity consumed per ONE of the item's par-units, in a
common recipe measure (oz/lb/count…). This activates the empty `item_components`
table and is the visual "a vendor's cases convert into the line" link Juan asked
for. The yield/cost math + unit conversions + the reverse per-SKU view are **C3**.

## Juan's framing (the model)
- "I want to know how many oz of each thing we have (this is how we measure
  recipes)… know how many items for the line from each SKU… a case of lettuce
  converts to how many 1/3 pans for the line, so we know exactly how much we
  have available for the line at any one time."
- Capture = **consumption per one item-par-unit, in a common measure**. The
  system later (C3) computes both readouts: oz-on-hand and "case → N par-units."
- Components can be **SKUs AND sub-items** (composite items): e.g.
  `Italian Sub ← Bread (item) + Marinara (item) + Provolone (SKU)`.

## Ground truth
- `item_components` EXISTS (migration 0079), EMPTY. Columns: `id`, `item_id`
  (NOT NULL — parent), `component_sku_id` (nullable → a SKU), `component_item_id`
  (nullable → a sub-item), `quantity` (NOT NULL numeric), `unit` (nullable text),
  `display_order` (NOT NULL int), `created_at`/`created_by`. → **NO migration**
  expected for C2 (verify RLS is deny-all/service-role at build).
- All 45 items are `kind='manual'`; `item_components` empty → BOM built from zero.
- `measure_units` registry (oz/lb/fl oz/gallon/count/gram/kg/mL/liter) shipped in
  C1 (migration 0096) — reused for the BOM line unit.
- Items live behind the 3-tab admin (Global tab edit panel = item definition home,
  where item questions/opening-verify already live).

## Decisions (Juan-approved)
- **Conversion model:** per-item-unit consumption (a line = how much of the
  component goes into ONE parent par-unit). System derives "SKU → N par-units" in C3.
- **Component types:** SKU **xor** sub-item per line (composites supported).
- **Unit:** a `measure_units` dropdown (RegistrySelect, reused from C1; MoO+ can
  add-new). Quantity = positive number.
- **Where:** a tap-to-expand "Made from" panel inside the item's Global-tab edit
  panel (mirrors the item-questions panel).
- **Authority:** **GM+ (≥7)** add/remove components (consistent with SKU
  management); **AGM+ (≥6)** read-only view.

## Architecture (C2)

### Lib `lib/admin/item-components.ts` (new)
- `ComponentView { id; itemId; componentSkuId: string|null; componentItemId: string|null; componentLabel: string; componentKind: "sku"|"item"; componentDetail: string|null; quantity: number; unit: string|null; displayOrder: number }`.
  - `componentLabel` = the SKU name or the sub-item name (hydrated).
  - `componentDetail` = for SKU, the C1 pack string (`formatSkuPack`-equivalent server-side, or the raw fields surfaced for the client to format); for item, null.
- `loadItemComponents(actor, itemId)` — ≥6. Hydrate SKU + item names (two-step batch, per the PostgREST RLS lesson). `quantity` numeric→number (`toNum`).
- `addItemComponent(actor, { itemId, componentSkuId?, componentItemId?, quantity, unit })` — GM+.
  - Validate: exactly one of componentSkuId / componentItemId present (else `invalid_component`).
  - Parent item exists+active (`item_not_found`); component SKU active (`invalid_sku`) or component item active (`invalid_component_item`).
  - Positive quantity (`invalid_quantity`); unit optional (normalize empty→null).
  - **Cycle guard** (sub-items only): walk the prospective component item's own component tree; if `itemId` appears (or `componentItemId === itemId`), throw `would_create_cycle`. Bounded by active items; visited-set to stop infinite loops on any pre-existing bad data.
  - Append at `max(display_order)+1`. Audit `item_component.add` (metadata: kind, component id, quantity, unit).
- `removeItemComponent(actor, { id })` — GM+. **Hard DELETE** of the join row (item_components is a composition edge, like the vendor_categories set-membership rows — not the append-only config pattern; the audit row carries the forensic before-state). Audit `item_component.remove`.
- `AdminItemComponentError` typed error → routes map to `jsonError`.
- Reuse the C1 measure registry loader/add for the unit dropdown (no new registry).

### Routes
- `app/api/admin/items/[itemId]/components/route.ts`: `POST` add (GM+, Tier B — creates a relationship, like SKU/contact creates). Body `{ componentSkuId?, componentItemId?, quantity, unit? }`.
- `app/api/admin/items/[itemId]/components/[componentId]/route.ts`: `DELETE` remove (GM+, Tier A).
- Both self-gate `requireSession → level floor → assertStepUp`. (Floor ≥6 on the route; lib enforces ≥7 on writes.)

### Destructive actions
Add `item_component.add` + `item_component.remove` to `lib/destructive-actions.ts`.

### UI
- New `components/admin/.../MadeFromPanel.tsx` (client): rendered in the item's
  Global-tab edit panel. Lists components ("`5 oz Crushed Tomatoes` · Case of 6 × 32 oz"
  for SKUs; "`4 oz Marinara` (item)" for sub-items) with a Remove (GM+, Tier A,
  confirm). A tap-to-expand **Add** form (GM+): a type toggle (SKU / Sub-item) →
  the matching picker (a `<select>` of active SKUs, or active items excluding the
  parent), quantity input, measure RegistrySelect. Tier B on add.
- The Global-tab edit panel passes the active SKU list + active item list (already
  loaded for the tab, or load alongside) + measureUnits + actorLevel.
- EN+ES i18n (`admin.items.made_from.*`). Reuse `formatSkuPack` for the SKU detail.

## Testing
tsc + build + throwaway smoke (deleted): add a SKU component + an item component
to an item; reject two-component-on-one-line, non-positive qty, inactive sku/item,
and a self/transitive cycle; load hydrates names + numeric qty; remove. Clean up.
Operator-flow READS are untouched (item_components feeds nothing operator-facing
yet — C3 consumes it).

## Out of scope (→ C3)
- Yield/cost numbers, unit conversions (lb↔oz, count↔oz), the per-SKU reverse
  "converts-into" view, `vendor_price_history` (SKU cost), and whether
  `items.kind` flips to `composite` (kind semantics deferred to the aggregate/yield work).

## Open decisions (spec review)
- **D1 — component picker at scale.** A plain `<select>` of items/SKUs is fine at
  today's counts (~45 items). If SKUs balloon, a typeahead is the follow-up.
  *Recommend plain select for C2.*
- **D2 — cycle guard depth.** Full transitive walk (recommended) vs direct-self-only.
  *Recommend full transitive (cheap at this scale, prevents a real footgun).*
