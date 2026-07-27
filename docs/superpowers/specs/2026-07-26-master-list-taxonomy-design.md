# The Master List — item taxonomy + list unification + one editing hub (piece 3)

**Status: APPROVED (Juan, 2026-07-26, remote session). Build = its own arc
(plan → build → CI-green PR → hold). Follows the Items Master Catalog
(#186/0156, pieces 1+2).**

## Problem (Juan, verbatim gists)
"Check lists, count lists, prep lists, outright reports need to be edited from
one tab… whatever should pull from the items master list." And the taxonomy:
"raw items (SKUs, straight from vendors), prepped items (portioned ready to
use on the line), on hand items (prepped but not portioned), sold-as-is items,
menu items, retail items (anything we did not make ourselves), packaging,
cleaning, misc — that is closer to the reality." The catalog's first smoke
found checklist-question items minting themselves into the registry ("Cook
Bacon?") — the exact wart this design makes impossible.

## Decisions (locked in session)
1. **Item-shaped lines link; task-shaped lines stay free text.** Counts, prep,
   supply/cleaning stock lines MUST reference a master-list item or SKU; pure
   actions ("wipe the slicer") remain text. No equipment/zone registry.
2. **Type is a property of the item — one label each.** Juan's definitions:
   bundled/portioned = prepped; sliced-not-bundled = on_hand; unsliced = raw
   (SKU). Same for pans: portioned-into-pans = prepped. No dual stock states.
3. **The hub = evolve `/admin/checklist-templates` into "Lists & Reports".**

## Design

### 1. Taxonomy (migration 0157)
- `vendor_items.sku_class text not null default 'raw'`
  check in ('raw','packaging','cleaning','misc'). Backfill:
  `inventory_only=true` → 'packaging' (Juan curates the smallwares → 'misc'
  and chemical SKUs → 'cleaning' in the SKU editor); else 'raw'.
- `items.item_type text not null default 'prepped'`
  check in ('prepped','on_hand','sold_as_is'). Backfill:
  `sold_directly=true` → 'sold_as_is'; else 'prepped'. Juan flips
  intermediates to 'on_hand' as he tracks them.
- menu_items made-vs-**retail** is DERIVED (has an active consumer build →
  made; else retail). No column.
- Surfacing: Items Catalog lenses/badges speak the nine words (replacing the
  generic kind labels); `item_type` editable from the catalog dossier (≥7,
  Tier-A, audited) and shown in the SKU editor for `sku_class`.

### 2. The item-line law (authoring-side only)
- In the hub's line editor, an item-shaped line is created ONLY via a
  master-list picker (items + SKUs, filterable by type lens). Free-text item
  minting from templates is removed. Task lines remain free text.
- Existing unlinked item-shaped lines (e.g. `expects_count` with null
  item_id/vendor_item_id) are NOT force-migrated: the hub surfaces a
  **"needs link" queue** (Toast-queue pattern) — Juan taps each to its item.
  Linking sets item_id/vendor_item_id on the existing template_item row:
  in-place ADDITIVE per the template-evolution law (id + label preserved).
- Checklist RUNTIME (staff submission flows, completions, snapshots) is
  UNTOUCHED in this arc.

### 3. The hub — Lists & Reports
`/admin/checklist-templates` becomes the single authoring surface:
- All template types (opening / closing / am_prep / mid_day_prep /
  deep_cleaning) + written-report definitions, one navigation.
- Per-list editor renders TWO lanes: item lines (picker-backed, showing the
  linked item's type badge + par context where relevant) and task lines
  (free text). Prep templates keep their existing item/par/section machinery
  (lib/admin/templates.ts) — carried over, not rebuilt.
- The "needs link" queue lives at the hub root with a count badge.
- Catalog dossier "checklists" edges deep-link into the hub.

### Non-goals
- Dual stock states per item; equipment/zone registry; runtime checklist
  changes; forced relink migration; per-tenant taxonomy variation (the type
  SETS are product invariants — labels render via i18n).

## Build shape (own arc)
Migration 0157 (staged) → taxonomy surfacing (catalog + SKU editor) →
hub evolution → needs-link queue → tests (pure: type derivation, queue
classifier) → adversarial review → PR → HOLD for Juan.

## Verification
Vitest on the pure derivations; build green; post-merge smoke: hub shows all
list types, picker-only item lines, queue counts match a SQL audit of
unlinked expects_count lines; catalog lenses show the nine types.
