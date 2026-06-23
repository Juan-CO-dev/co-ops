# 3-Tab Checklist Admin — Global Registry + Per-Location Inheritance (Spine 2B′)

**Date:** 2026-06-23
**Arc:** Item/Inventory Spine — admin surface for the par layer. Builds on 2B (PR #84, branch `claude/par-layer`): global items + `item_par_levels` + day-aware resolver are already in. Absorbs the planned 2C (add-from-registry).
**Trigger:** Juan's smoke of #84 — the per-template panel hides the global/local distinction, so editing a name on "one location" silently changes others. Fix = make the distinction explicit in the navigation.
**Migration:** small — `items.is_default` boolean (default-template membership). No other schema change.

---

## Goal

Replace the per-location template panel with a **3-tab** view per checklist, so the global/local split is explicit:

- **Global tab** — the registry + the default template. Edit a definition or default here → it flows to every location.
- **Per-location tabs** (Capitol Hill / P Street) — that location's checklist. Each item shows the global default; the location overrides *only its own* par and decides *only its own* enable/disable. Nothing here can affect another location.

## Capability ladder (locked — each role inherits everything below)

| Capability | Min role |
|---|---|
| Enable/disable a registry item for **own location**; set its **par override** (per-day) | **AGM+ (≥6)** |
| **Add a new item** to the global registry | **GM+ (≥7)** |
| Set **global defaults** (default-template membership); edit **global definition** (name / name_es / recommended par / section) | **MoO+ (≥8)** |

Higher roles can also do everything lower roles can (GM+/MoO+ can do per-location work; MoO+ can add to the registry).

## Inheritance model (locked): default flag + propagate

- An `items.is_default = true` item is part of the **default template**. The item's `section` (a PrepSection) places it in the prep checklists.
- **Marking an item default (MoO+)** propagates an **enabled** AM-prep line (+ its Opening Phase-2 mirror, via the existing `createOpeningMirror`) to **every location** that has no active line for it. Reuses the per-location-line + mirror propagation we already have.
- **A location (AGM+)** can **disable** any item for itself (deactivate its line) and **enable** any registry item onto itself (à la carte — create a line linking the existing global item). Per-location decisions never touch other locations.
- **Un-marking default (MoO+ sets is_default=false):** stops *future* auto-propagation; does **not** yank existing location lines (append-only; locations keep what they run). Surface this clearly in the UI so it's not mistaken for "remove everywhere."

### Open call (flag for review) — default scope
**Decision:** default-template membership + auto-propagation applies to **AM-prep** (the standardized daily set; Opening mirror follows automatically). **Mid-day stays à la carte** (on-demand — items enabled per location from the registry, no auto-default), matching how mid-day actually operates. If you want a mid-day default set too, we add `is_default` scoping per checklist-type (a `default_template_items` table) instead of the single boolean — bigger, deferred unless you want it.

## Data model

- **`items.is_default boolean NOT NULL default false`** (migration 0081). The default-template marker. MoO+ toggles it.
- Backfill: set `is_default = true` for every existing global item (they're all currently part of the default set — keeps today's behavior). Location-owned (un-promoted) items stay `false`.
- Everything else (global items, `item_par_levels`, the resolver) is unchanged from 2B.

## Information architecture

Entry `/admin/checklist-templates` → pick a checklist (AM Prep / Mid-day / …) → a tabbed page:

```
[ Global ] [ Capitol Hill ] [ P Street ]
```

### Global tab (registry + default template)
- Lists the **registry items** for this checklist context (grouped by section): name + recommended par + section + **default toggle**.
- **Add new item** → registry (GM+). **Edit definition** (name EN/ES, recommended par/unit, section) → the global item (MoO+). **Default toggle** (MoO+) → propagates / stops propagating.
- A clear "edits here apply to every location" banner.

### Per-location tab (one per location)
- Lists the items **as this location runs them**: enabled items with their **par override** grid (all-days + per-day, `par_mode`), AGM+.
- **Enable** a registry item not yet on this location (à la carte picker — absorbs 2C) / **Disable** an item for this location — AGM+.
- Item **name is read-only** here, with an "edit in Global" pointer. The only writes are par + enable/disable — all location-local.
- A small "inherits the global default; your changes affect only <location>" note.

## Routes (capability-gated; reuse 2B lib where possible)

Per-location (AGM+): `…/items/[itemId]/par` (exists), enable/disable = the existing add/remove line paths re-gated to AGM+ (enable links an existing global item; disable = `removePrepItem`).
Registry (GM+): add-to-registry (a global-item create, no location line yet) — new.
Global definition + default (MoO+): `…/items/[itemId]/definition` (exists, MoO+), new `…/items/[itemId]/default` toggle (MoO+) → sets `is_default` + propagates.
Promote-to-global stays MoO+ (already built).

Each route self-gates `requireSession → level → assertStepUp(tier) → IDOR`, per the established pattern. Per-location writes IDOR-bind to the actor's location; global/default writes are company-wide (MoO+).

## What changes from #84's current UI
- The single `PrepItemEditPanel` (which mixes global name + par + structure) is **split across the tabs**: name/recommendation/default → Global tab; par + enable/disable → location tabs. The confusing "edit name here, affects there" disappears because name editing only exists on the explicitly-global tab.
- `addPrepItem` registry-backing (built in 2B) stays; "enable from registry" is the new à-la-carte path (links an existing item rather than creating one).
- No change to the resolver, `item_par_levels`, loaders, or submit snapshots (the 2B engine).

## Verification
- `tsc` + `next build` clean; migration 0081 applied + captured.
- Parity check still 0 (engine unchanged).
- Operator smoke (preview): Global tab rename → both locations; mark an item default → it appears enabled at both; disable at one location → off there only, still on the other; enable a non-default registry item at one location → appears there only; par override per location/day still works; AGM sees only their location tab's par + enable/disable; GM also adds registry items; MoO sets defaults + definitions.

## Sequencing
On the `claude/par-layer` branch (PR #84), as additional commits — the 3-tab IA replaces the panel UX before merge, so the confusing surface never ships. The 2B engine commits stay as-is.

## Open decisions for review
1. **Default scope** = AM-prep only (mid-day à la carte). [recommended above]
2. **Un-mark default** = stop future propagation, keep existing location lines. [recommended above]
3. **Mid-day defaults** — deferred unless wanted (would need per-checklist-type default scoping).
