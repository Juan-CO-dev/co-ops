# Toast Platter Depletion — design (2026-07-25)

**Status: APPROVED (Juan, 2026-07-25, remote session) — built same day, PR pending his merge word.**

## Problem

Toast platter checks were the last mapped-out class of real sales: parent line
"8/16/32/48 pc platter" (sometimes named "Our Favorites" per channel) + an
assortment modifier pick — "Our Favorites" (the platter product line → the
shop's mix) or "The Classics" (the popular-subs assortment). CO models platters
as `catering_packages`, which the crosswalk could not target, so platter sales
depleted nothing. Juan: "we don't want to exclude them, we want anything we
sell as part of the system."

## Decisions (Juan's calls, verbatim where quoted)

1. **Platters stay packages.** No rename needed; the crosswalk gains a package
   target instead ("we can switch package to platter or whatever… I named it
   packages not thinking about the name platter").
2. **The Classics list (locked):** Crunchy Boi, "It's a BOI" (pick-another-
   protein variant of Crunchy Boi), The Teamster, Hot Pants, Never Been
   Cheddar, Farmers Market ± Fresh Mozz (ONE menu_item — "Farmers Market After
   Dark"; the mozz is a modifier), Marisa Tomei Eats Free.
3. **Pool management = the W1b packages editor.** "We should be able to enable
   and disable those subs and any catering enabled a la carte subs from the
   'Our favorites platters'" — enable/disable is the existing slot-option
   active flag; the Classics subset is a NEW `classic` boolean on options.

## Architecture

### Schema (migration 0155, staged)
- `catering_package_slot_options.classic boolean not null default false`.
- `toast_menu_map.package_id uuid references catering_packages` — the XOR
  becomes exactly-one-of-3, with one carve-out: assortment MODIFIER rows carry
  NO entity FK (they map a guid to a pool behavior).
- `disposition` check extends: `assortment_full` | `assortment_classics`.

### Depletion model (derive-on-read, `salesConsumption`)
- Platter parent guid → package (manual map; per-location or global package).
- **Whole subs come from the choice slot's `quantity`** (the KB's own
  semantics — platter-slot reconcile seeded 8 pc → 4, halves doctrine), NOT
  from `serves`. Scaled × sale qty.
- **Assortment = even mix**: the pick (a modifier child of the platter
  selection, resolved per-selection so two platters on one check differ)
  selects the pool — full enabled options vs classic subset. Classic subset
  empty → fall back to full pool (degrade to Our-Favorites, never to zero).
  No pick punched → full pool. Empty pool → `packageIssues` advisory.
- Fixed spine-linked package lines deplete directly (line qty × sale qty);
  freeform lines surface as a `packageIssues` advisory.
- **Signed menu_item lane**: menu-item whole-sub units accumulate SIGNED
  (bases + platter spreads + menu_item-target modifiers), clamp ≥ 0, then
  flatten exactly like sold subs (direct SKUs + first-level item par-units —
  PR #180 invariant preserved).
- **menu_item-target modifiers** (named-sub picks): portion = whole subs per
  application, default 0.5 (`MENU_ITEM_MODIFIER_PORTION_WHOLE_SUBS`, one
  platter piece = half a sub). Deplete adds, remove subtracts (Juan: removals
  count).

### Crosswalk & admin
- Auto modifier lane universe now items + menu_items (menu_item candidates
  carry the 0.5 whole-sub portion).
- `manualMap` targets: item | menu_item | package | assortment_full |
  assortment_classics. Package targets validate location ownership.
- Map-to picker (SalesTab): base rows offer packages (this location + global);
  modifier rows offer items, menu_items, and the two assortment behaviors.
- Packages editor: ★ classic toggle per option chip + `serves` field
  (PATCH fields concern, `invalid_serves`, mirrors the menu-item validation —
  fold-in from the 0154 headcount fix; Footers still need Juan's numbers).

### Seed (staged, run after 0155)
`scripts/seed/12-platter-classics.ts` — ensures the 7 Classics exist as active
options on every "N pc platter" choice slot and flags them classic.
Idempotent; never unflags.

## Out of scope
- Lunch-box / footer Toast mapping (same machinery works when Juan maps the
  guids; footer serves numbers pending).
- Toast-side quantified per-sub picks (if platter checks ever carry named-sub
  quantities, the menu_item modifier lane already absorbs them at 0.5/piece).
- W4a quote-side package demand (already shipped — this is the SALES side).

## Verification
- Vitest: `tests/toast-platter.test.ts` (pool selection, fallback, even mix,
  doctrine constant) + full existing suite.
- Post-merge live re-verify (fixture-fiction rule): map one platter guid +
  assortment guids at CH, re-run the 2026-07-23 benchmark date, confirm
  platter demand appears at sub grain.
