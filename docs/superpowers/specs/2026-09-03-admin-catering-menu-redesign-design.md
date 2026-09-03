# Admin Catering Menu — Redesign (Option 3) — Design

**Date:** 2026-09-03 · **Status:** APPROVED DESIGN (Juan: "yes" on the six-section design, option 3). Brainstormed in-session during the first-live portal smoke; every ruling below is Juan's.

## Problem

`/admin/catering/menu` already does every job a manager needs — turn items on and off for catering, mark catering-only, set portions, set how many people a unit feeds, manage catering sizes — and the Toast tab handles the crosswalk. Juan's diagnosis after using it live: **the functions are right; the labeling and grouping are wrong.** The Menu tab renders two long lists (the item registry, then the sub menu) each grouped by Toast's raw section names, so "Sides" appears up to three times ("Sides" items, "Sides" subs, "Catering Sides"), nothing on a row says whether it is a Toast menu item or a catering-only item, and the toggles are one-word labels ("Catering", "Only", "Portions") that do not say what they change. A manager cannot tell exactly what they are changing.

The customer-facing order builder was reorganized the same day (PRs #322/#323/#324): packages first, then one Drinks / Sides / Desserts section each, then à la carte, with catering sizes on top inside each section. The admin screen should read the same way.

## Rulings (Juan, 2026-09-03)

1. **All three jobs stay on this screen:** decide what customers can order · set how a catering item sells (sizes, prices, feeds, portions) · check it matches Toast. No job moves to another page.
2. **One list, in customer order.** Admin groups items exactly as the builder shows them. The grouping rule is shared code, never a second implementation.
3. **Every row says what it is** before a toggle is touched: its source, whether it is catering-only, and the Toast section it came from.
4. **Plain-English controls.** A label must say what changes when it is flipped.
5. **Customer preview.** A switch shows the list as a customer sees it, from the same data through the same grouping.
6. **No schema change.** Toast section names are not edited; the admin reorganizes presentation only.

## Design

### §1 Page structure

`/admin/catering/menu` keeps its header and its two tabs (**Menu** · **Toast**). The Toast tab is untouched. The Menu tab becomes, top to bottom:

1. **Legend card** (§4).
2. **Toolbar**: filter chips + search + the "Preview as customer" switch (§3, §5).
3. **Packages card**: one row, "Packages are built on their own page", count of active packages, link to `/admin/catering/packages`. Rendered first because packages render first for customers.
4. **Sections** in customer order: Drinks · Sides · Desserts · then à la carte headings (Subs, Build Your Own, Gear, and any other main-course heading, in their existing order) · "More" for rows with no section.

Grouping uses `sectionLabel`, `orderSections`, `orderWithinSection` and `catForSection` from `lib/portal/menu-order-shared.ts` — the builder's own rules. Inside a section, catering-only rows sit on top, singles under, exactly as the builder orders them. Each section is a `CollapsibleSection` (Disclosure Doctrine W4) whose header reads **"Sides · 9 on the menu of 14"** (i18n: `admin.catering.menu.section_summary` = "{on} on the menu of {total}"). Sections with ≤ 6 rows default open, larger ones collapsed (existing rule).

### §2 The row

Each row shows, left to right on desktop and stacked on phones (phone is the spec; tablets first-class — recomposition doctrine):

- **Name** (Spanish name under it when present).
- **Badges**: `Toast item` (kind `menu_item`) or `Catering item` (kind `item`); `Catering only` when the flag is set; `Seasonal` when set. Small grey text under the badges: **"Toast: Catering Sides"** — the raw section the row came from, so the merge is never a mystery.
- **Controls** (§3).
- **Sizes disclosure** (items only): "Sizes (2) ▸" opens the existing size editor unchanged (label · price · feeds).

A row whose `cateringAvailable` is false renders dimmed with the badge **"Hidden from customers"** so the eye can separate on-menu from off-menu without reading toggles.

### §3 Controls and labels

| Today | New label | Hover hint (title) |
|---|---|---|
| Catering | **On catering menu** | Customers can order this for catering. Off hides it from the order builder. |
| Only | **Catering only** | Sold only through catering, not on the store menu. Turning this on also turns on "On catering menu" (server rule, unchanged). |
| Portions (subs) | **Sold by portion** | Customers may order a quarter, half, or whole. |
| serves | **Feeds ___ people** | People covered by one unit. A 24-bag case feeds 24. Blank = 1. |
| Sizes | **Sizes** | Catering sizes with their own price and feeds count (pint, 32 oz, case). |

Toggle behavior, step-up gating, the `apiWrite` retry pattern and the server routes do not change. Only the words and the arrangement change.

**Filter chips** (single select): All · On menu · Hidden · Toast items · Catering items. **Search** matches name and Spanish name, case-insensitive, and keeps the section grouping (empty sections disappear). Chips and search are pure client state.

### §4 Legend card

One short card above the toolbar, collapsible, open by default until dismissed (dismissal remembered in `localStorage`, key `co.admin.menu.legend.v1`):

> **Toast items** come from the store menu and are named in Toast. **Catering items** exist only here — tubs, cases, waters — and get their sizes and prices here. Rows appear to customers under the same headings you see below, in the same order.

Spanish copy ships alongside (en + es, house rule).

### §5 Preview as customer

A switch in the toolbar. On: the same grouped, filtered data renders read-only in builder order, showing only rows customers can order, each with its price (or "from" price for sized rows), its feeds count, and the catering-only tag; controls, badges for source, and hidden rows are not shown. Off: the editor. The preview is the editor's rows passed through one presentational component — no second data load, nothing to keep in sync. It does not replace the real builder (no cart, no pricing rules); it answers "what does a customer see under this heading?"

### §6 Components and files

`MenuClient.tsx` (319 lines) splits into small pieces with one job each:

- `components/admin/catering/menu/MenuLegend.tsx` — the legend card + dismissal.
- `components/admin/catering/menu/MenuToolbar.tsx` — chips, search, preview switch.
- `components/admin/catering/menu/MenuSectionList.tsx` — groups rows via the shared grouping helpers, renders `CollapsibleSection`s with the summary header.
- `components/admin/catering/menu/MenuRow.tsx` — badges, source line, controls, sizes disclosure (moves the existing `Toggle`, `ServesBox` and size editor here unchanged).
- `components/admin/catering/menu/MenuPreview.tsx` — the read-only customer rendering.
- `components/admin/catering/menu/MenuClient.tsx` — state + `apiWrite` only (the step-up retry pattern stays exactly as is).
- `lib/admin/catering/menu-view-shared.ts` — **pure**: `groupAdminRows(items)` (section label → ordered rows, using `menu-order-shared`), `filterAdminRows(items, { chip, query })`, `sectionSummary(rows)` (on-menu count / total), `rowBadges(item)`. Unit-tested.
- i18n: new keys under `admin.catering.menu.*` in `en.json` and `es.json` (labels, hints, chips, legend, preview, summary).

No API, lib/admin loader, or database change. `AdminMenuItem` already carries everything the design needs (`kind`, `section`, `cateringAvailable`, `cateringOnly`, `cateringPortionable`, `serves`, `seasonal`, `sizes`, `nameEs`).

### §7 Error handling

Unchanged: every write goes through `apiWrite`, which maps known error codes to i18n messages and handles the Tier-A step-up challenge with a retry. The legend's `localStorage` read/write is wrapped in try/catch and the card renders open when storage is unavailable. Filters and preview never write.

### §8 Testing

- `tests/admin-menu-view.test.ts`: grouping matches the builder (`Catering Drinks` and `Drinks` land in one "Drinks" section; catering-only rows first; section order Drinks → Sides → Desserts → mains); filter chips (each chip's predicate, search on name and Spanish name, empty sections dropped); `sectionSummary` counts; `rowBadges` for the four combinations of kind × cateringOnly, plus hidden and seasonal.
- Existing route/lib tests untouched (no server change).
- Screenshot pass on the running app at phone and laptop widths before the PR (UI-arc lesson: build-green is not renders-right).

### §9 Out of scope

Toast tab, packages page, pricing page, zones and capacity pages, any change to Toast section names in the database, the customer builder itself.
