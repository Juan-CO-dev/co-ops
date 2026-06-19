# Maintenance as a Reports Hub Report Type — Design

**Date:** 2026-06-18
**Status:** Approved design, pre-plan
**Builds on:** the Maintenance Log module (#57 — `lib/maintenance.ts`: `maintenance_equipment` registry, `maintenance_notes`, `loadMaintenanceOverview`, `loadEquipmentDetail`, `computeFridgeStatus`, `MAINTENANCE_BASE_LEVEL = 3`) and the Reports Hub (#61/#62/#72/#73 — `lib/reports-hub.ts` list+detail, `lib/reports-search.ts` corpus, `lib/report-signals.ts`).
**Cycle:** Juan's own flag during the search cycle — "don't maintenance logs go to reports hub also?" Make the maintenance log a first-class, browsable, drill-in-able, searchable report type in the hub.

---

## Goal

Surface the maintenance log as a first-class **report type** in the Reports Hub: it appears in the type filter, browses as report rows, opens a drill-in detail, and is covered by the existing free-text search — alongside opening/closing/am-prep/mid-day/cash/pm. Maintenance is **derived** (fridge temps captured at opening/closing + ad-hoc equipment notes), not a submitted artifact, so the work is mostly composition over data that already exists. **No migration, no new table.**

## The model (Juan-locked)

- **Type:** add `"maintenance"` to `ReportTypeKey`. A **synthesized/virtual** type the hub composes — there is no `maintenance_reports` table.
- **List row = per (location, date) digest.** One `ReportListItem` per date in range that has ≥1 fridge reading or note ("every date with equipment data").
- **Drill-in = per-equipment snapshot for that day** ("1 in the hub, 2 for the actual report"): each piece of equipment with its reading(s) that date + status + that day's notes.
- **Redaction: all maintenance content at L3+** (temps AND notes), matching the standalone module — low-sensitivity operational data.

## List row contract

For each qualifying date, synthesize a `ReportListItem`:

- `type: "maintenance"`
- `id: "maintenance:{locationId}:{date}"` — **synthesized identity** (no real PK; this reconciles maintenance with the hub's artifact-PK row model). The `{locationId}` segment is a built-in cross-check the detail loader re-verifies against the authorized location.
- `date` — operational date (YYYY-MM-DD)
- `locationId`
- `submitterName: null` — rendered as "—" / an "Equipment log" label (derived, no author)
- `status` — derived: `"N flags"` when any fridge is out-of-range that day, else `"OK"` (i18n keys, not literals)
- `signalSummary`: `{ underPar: 0, overPar: 0, skipped: 0, tempFlags: <out-of-range fridge count that day>, cashOverShortCents: null }`
- **Visible at L3+** (all staff). No `level` gate beyond the hub's baseline.

**Which dates qualify:** any date in `[dateFrom, dateTo]` at the location with at least one fridge temp reading OR a `maintenance_notes` row.

## Drill-in detail contract

New `ReportDetail` member, `kind: "maintenance"`:

```ts
export interface MaintenanceReportDetail {
  kind: "maintenance";
  type: "maintenance";
  date: string;
  locationId: string;
  equipment: Array<{
    equipmentId: string;
    label: string;
    safeMaxF: number | null;
    status: FridgeStatus;              // "ok" | "out_of_range" | "no_reading_today"
    readings: TempReading[];          // that date's readings (opening + closing), chronological
    notes: MaintenanceNote[];         // maintenance_notes + checklist temp-item notes for that equip+date
  }>;
  flagCount: number;                   // out-of-range equipment count (matches list tempFlags)
}
```

Reuses the existing `FridgeStatus`, `TempReading`, `MaintenanceNote`, `computeFridgeStatus` from `lib/maintenance.ts` — it's a **date-scoped** version of `loadMaintenanceOverview` (which is "today"-scoped) joined with per-equipment notes (like `loadEquipmentDetail`, but for one date, all equipment).

## New lib functions (in `lib/maintenance.ts`; composed by `reports-hub.ts`)

1. `listMaintenanceReportDates(service, locationId, dateFrom, dateTo): Promise<Array<{ date: string; tempFlags: number }>>`
   - Loads the location's equipment + all fridge temp readings and `maintenance_notes` in the window, groups by operational date, and for each date with data computes the out-of-range count via `computeFridgeStatus`. Returns newest-first.
   - Uses `selectAllRows` (lib/supabase-paginate.ts) for the readings/notes scans so a wide window can't truncate at 1000.

2. `loadMaintenanceReportDetail(service, locationId, date): Promise<MaintenanceReportDetail>`
   - For the given date: load equipment, that date's readings per equipment, `computeFridgeStatus`, and notes (maintenance_notes for that equip + date, plus checklist temp-item notes for that date — the same merge `loadEquipmentDetail` does, date-scoped).

These live in `lib/maintenance.ts` (it owns equipment/temp logic); `reports-hub.ts` calls them so the hub stays a thin composer.

## Hub wiring

- **`ReportTypeKey`** gains `"maintenance"`.
- **List loader** (`listReports` / the per-type composition in `reports-hub.ts`): add a maintenance section, gated `want("maintenance")`, that calls `listMaintenanceReportDates` and synthesizes the rows above. No `level` gate (L3+ baseline). Signal-filter interaction: maintenance rows participate in the `tempFlag` filter; when a non-applicable signal filter (`underPar`/`overPar`/`skipped`/`cashOver`/`cashShort`) is active, maintenance rows are excluded (they can't satisfy it) — consistent with how each type only matches its own signals.
- **`loadReportDetail`**: add `if (args.type === "maintenance")` → parse `date` from `args.instanceId` (the synthesized id), verify the embedded `{locationId}` equals `args.locationId`, then return `loadMaintenanceReportDetail`. The `ReportDetail` union gains `MaintenanceReportDetail`.
- **Detail page** (`app/(authed)/reports/[type]/[id]/page.tsx`): render `kind === "maintenance"` via a new `MaintenanceReportDetailView` component — a per-equipment list (label, status chip, the day's readings, notes), echoing the maintenance module's overview styling. The per-fridge **all-time** timeline stays in the maintenance module; the hub detail is the **single-day** snapshot.
- **Type filter UI** (`app/(authed)/reports/page.tsx` + its client): add a "Maintenance" chip, shown to all viewers (L3+). New i18n label `reports.type.maintenance` (EN+ES).

## Search

Extend `lib/reports-search.ts`:
- `SearchCorpusField.fieldKey` union gains `"equipment"` and `"maintenance_note"`.
- `buildSearchCorpus`: add a maintenance branch — for maintenance items in `args.items`, pull each date's equipment labels + statuses (as `"equipment"` fields) and notes (as `"maintenance_note"` fields), keyed `maintenance:{locationId}:{date}` (the same synthesized id). **No redaction branch needed** — all maintenance content is L3+, which every hub viewer clears; the corpus is location-bound (reads filtered by `args.locationId`), satisfying the bind-the-record half of the IDOR rule.
- Snippets link to the maintenance detail like any other result (the existing `searchReport` is type-agnostic on `base.type`).

## Security / privacy

- **Detail keyed by `location + date`** → authorized via the hub's existing `lockLocationContext` (gate the param). All maintenance reads filter by `locationId` (bind the record). Plus the synthesized id embeds `locationId`, which the detail loader re-checks against the authorized location — defense in depth.
- **L3+ for everything** — no notes-redaction tier (Juan's call; equipment data is operational and already L3+-visible in the module). This is intentionally *more open* than the hub's PM/completion notes (L5+); the spec records the divergence so it isn't "fixed" later by mistake.
- No write path — read/compose only. No new RLS, no audit (read surface).

## Non-redundancy (deliberate)

Opening and closing rows already surface `tempFlags` in their `signalSummary`. The maintenance row is **not** a third copy of that count — it's the **equipment-centric cross-report lens**: one row that unifies a day's readings across both opening and closing into a per-fridge view with statuses and notes. That's the value-add over the per-report flag badges.

## Verification (no test framework)

`tsc --noEmit` + `next build` + throwaway `tsx` live smokes (self-deleting):

1. **List:** `listMaintenanceReportDates` returns one entry per date-with-data in a window for a real location, `tempFlags` matching a hand count of out-of-range fridges on a known date.
2. **Detail:** `loadMaintenanceReportDetail` for a known (location, date) returns each equipment with its readings + `computeFridgeStatus` status + notes; `flagCount` equals the list's `tempFlags` for that date.
3. **Hub integration:** `listReports` with `types: ["maintenance"]` returns synthesized rows; `loadReportDetail({ type: "maintenance", instanceId: "maintenance:{loc}:{date}", locationId })` returns the `kind: "maintenance"` detail; a mismatched embedded locationId is rejected.
4. **Search:** `buildSearchCorpus` includes maintenance equipment labels + notes for maintenance items; a query matching a known note/equipment surfaces the maintenance row with a snippet.
5. **Signal filter:** with `signalFilters.tempFlag` on, maintenance rows with flags are included; with `underPar` on, maintenance rows are excluded.
6. **No regression:** the other six report types' list + detail + search behavior is unchanged.

## Deferred (tracked)

- Materialized maintenance signal column (the hub's general "compute-on-read now, materialize when volume grows" note applies).
- Oven/Fryer and non-fridge equipment richer status (currently fridges drive `computeFridgeStatus`; others show readings/notes without an over/under status). Fine for v1.
- Unified cross-surface search (#2 next cycle) — this cycle keeps maintenance inside the hub's existing search; the unified pass is separate.
