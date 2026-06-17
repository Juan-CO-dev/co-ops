# Maintenance Log — Design Spec

**Date:** 2026-06-16
**Module:** Wave 2, Module #2 — Maintenance Log (`/maintenance`)
**Status:** Design approved by Juan (brainstorm 2026-06-16); pending spec review → implementation plan.

---

## 1. Purpose

A **read/aggregate surface** that strings together the fridge-temperature readings already captured at **opening (AM)** and **closing (PM)** into one per-fridge timeline — intraday swing + day-to-day trend, with out-of-range flagging — so a manager can see how each fridge is performing and catch a failing unit early. **No new temperature capture** — the data already exists.

Plus two smaller pieces:
- A tiny on-demand **Maintenance Note** log (file a note about any equipment, anytime).
- A one-time **equipment-naming standardization** so the same equipment reads consistently across all reports (Juan: "make the names consistent across all reports").

This is the "read surfaces over new workflows" principle (AGENTS.md Build #3): the operational rhythm already produces the data; this surfaces it.

## 2. The existing data (what we unify)

Verified in the live schema:
- **Opening** report captures 8 fridge temps — items like `"Station fridge holding temp (≤41°F)"` (`expects_count=true`; the completion's `count_value` = the temp). The **≤41°F threshold is in the label**.
- **Closing** report captures the same 8 fridges — items like `"Walk Ins station fridge temp log"` (`expects_count=true`).
- `checklist_completions.count_value` (numeric) = the temperature reading; `checklist_completions.notes` (text) = any note left.
- The **same physical fridge has a different template item + label in opening vs closing**, and per location (MEP + EM each have their own templates) — so a registry is required to map them together.
- Mid-day prep does **not** capture fridge temps today (out of scope; the registry leaves a slot if added later).

**The 8 fridges** (canonical names — used everywhere after standardization): Walk-In, 3-Door, Sauce, Deli Display, Crunchy Boi, FOH Drinks, Back-Line Drinks, 3rd-Party.

## 3. Equipment registry — the unifying key

New table **`maintenance_equipment`** (seeded, per location):

```
maintenance_equipment
  id                    uuid pk
  location_id           uuid not null → locations(id)
  name                  text not null         -- canonical (e.g. "Walk-In Fridge")
  kind                  text not null check (kind in ('fridge','equipment'))
  opening_temp_item_id  uuid → checklist_template_items(id)   -- nullable
  closing_temp_item_id  uuid → checklist_template_items(id)   -- nullable
  safe_max_f            integer               -- 41 for fridges; null for non-temp equipment
  sort_order            integer not null default 0
  active                boolean not null default true
  created_at            timestamptz not null default now()
```

- **Seed (per location):** the 8 fridges, each linked to its **opening** + **closing** temp `template_item_id` (the seed script resolves these by matching station/label against the live templates — verify the mapping per location before inserting), `safe_max_f = 41`. Plus non-temp equipment rows (Oven, Fryer, Walk-Ins, etc.) for maintenance notes (no temp links).
- **RLS:** SELECT for any authenticated user at the location (anyone views); no end-user INSERT/UPDATE/DELETE (service-role seeds; future edits via Admin UI / C.44).
- Captured as a migration + a seed script (mapping is data, so the seed resolves ids at run time — do NOT hardcode item ids in the migration).

## 4. Equipment-naming standardization (Juan's catch)

A one-time, **label-only** pass aligning the equipment item labels across the opening + closing templates so each fridge reads with its canonical name (§2 list) consistently. Because it's label-only and preserves `template_item_id`, historical completions + FK chains are unaffected (the in-place-additive rule, AGENTS.md Build #3 PR 3 — vs Path A; this qualifies as in-place). EN + ES translations updated in lockstep (`translations.es.label`). Captured as a migration. The registry's `name` is the source of truth; the item labels match it.

> Scope guard: this pass touches **equipment/fridge item labels only** — not par values, stations, or non-equipment items. Don't restructure the templates.

## 5. Maintenance Note (the one new capture)

New table **`maintenance_notes`** (append-only):

```
maintenance_notes
  id            uuid pk
  location_id   uuid not null → locations(id)
  equipment_id  uuid → maintenance_equipment(id)   -- nullable (when "Other")
  other_label   text                               -- set only when equipment_id is null
  note          text not null
  created_by    uuid not null → users(id)
  created_at    timestamptz not null default now()
```

- **Capture:** a dashboard entry → form: pick equipment (registry dropdown + "Other" free-text) + a note → `POST /api/maintenance/note`. No status lifecycle (per Juan — it's a logged entry, not an issue tracker).
- **RLS:** SELECT + INSERT for any authenticated shift staff at the location; no UPDATE/DELETE (append-only).
- Surfaces in the read view under its equipment.

## 6. `/maintenance` read view (replaces the stub)

Server Component loader (service-role per C.24) aggregates per equipment:

- **Fridges:** pull `count_value` + `completed_at` from the live completions of the fridge's `opening_temp_item_id` **and** `closing_temp_item_id` (across instances/dates) → a single per-fridge timeline:
  - **Today:** the AM (opening) + PM (closing) reading.
  - **Trend:** last N days (default 14), each AM/PM reading.
  - **Out-of-range:** any reading `> safe_max_f` flagged (color + icon).
  - Latest reading + a simple status (OK / out-of-range / no reading today).
  - Completion `notes` surfaced inline.
- **Per equipment (all kinds):** the `maintenance_notes` for it + the checklist `notes` left on its items, merged into one time-ordered stream.
- **Filters:** equipment · date range · "out-of-range only."

Money/temps are read-only here; no writes except the maintenance note.

## 7. Dashboard access (nav)

Per Juan's idea, add a small **dashboard nav entry** for Maintenance (a labeled link/section, distinct from the report tiles), where future surfaces (Reports Hub, etc.) will also live. Minimal for now: a "Maintenance" entry → `/maintenance`. Visible to **anyone** authenticated. (The fuller nav-hub component is a future enhancement; this is the seed of it.)

## 8. Roles

View `/maintenance` + add a maintenance note: **any authenticated shift staff at the location** (level ≥ 3). Juan: "anyone." (Owner/CGS all-locations override applies as elsewhere.)

## 9. Out of scope (YAGNI)

- **No new temperature capture** — uses the existing opening + closing readings.
- **No issue status lifecycle** (open/resolved) — notes are logged entries.
- **No standalone temp-check report** — explicitly rejected; we unify existing data.
- **No equipment-editing UI** — registry is seeded; edits land with the Admin UI (C.44).
- **Mid-day temps** — not captured today. If added later, the registry gains a `mid_day_temp_item_id` column + the timeline picks up a third daily reading (additive change, not built now).
- **Photos / attachments on notes** — not now.

## 10. Testing

- `tsc --noEmit` + `next build` gates.
- Throwaway `tsx` smoke (isolated test date; self-cleaning): seed/confirm an equipment row, write opening + closing temp completions (one in-range, one > 41°F), assert the loader groups them by fridge into a timeline + flags the out-of-range one; write a maintenance note, assert it surfaces under its equipment.
- Preview manual test by Juan.

## 11. File structure (informs the plan)

- `supabase/migrations/NNNN_maintenance_tables.sql` — `maintenance_equipment` + `maintenance_notes` + RLS.
- `supabase/migrations/NNNN_standardize_equipment_labels.sql` — label-only consistency pass (EN + ES).
- `scripts/seed-maintenance-equipment.ts` — resolves opening/closing temp item ids per location + inserts the registry (fridges + non-temp equipment).
- `lib/maintenance.ts` — types (`Equipment`, `FridgeTimeline`, `TempReading`, `MaintenanceNote`), loaders (`loadMaintenanceView`, `loadEquipment`), `addMaintenanceNote` (append-only + audit).
- `app/api/maintenance/note/route.ts` — POST a maintenance note (gate ≥3, location).
- `app/(authed)/maintenance/page.tsx` — server loader + read view; `maintenance-client.tsx` — filters + the "add note" form (uses `ActionButton`).
- `components/maintenance/FridgeTimeline.tsx` — per-fridge temp timeline + out-of-range.
- `app/(authed)/dashboard/page.tsx` — add the Maintenance nav entry.
- `lib/i18n/{en,es}.json` — `maintenance.*` keys + the standardized equipment labels.

> Dependency: uses `ActionButton`/`ActionLink` (already on main from the button-uniformity PR). Branch off current `main`.
