# Reports Hub — Design Spec (Wave 3 module)

**Date:** 2026-06-17
**Status:** design — awaiting Juan's spec review before plan.

## Goal

The read-only **operational library** at `/reports` (replaces the coming-soon stub): browse / filter historical reports across every shipped report type, with **full drill-in** to each report's contents, where **what a viewer sees is redacted by their role level**. It's the third C.42 purpose set — training value, reconciliation/audit, cross-shift continuity — distinct from the dashboard's action tiles (which gate "can I do this today"). The hub gates "what history can I see."

## Scope

- **Per-location**, browse across dates (not limited to today). The `/reports` nav chip is location-scoped — carries the active location; the hub defaults to it and can filter by location the viewer may access.
- **Read-only.** No create/edit/submit here.
- Report types in v1: **Opening, Closing, AM Prep, Mid-day Prep, Cash, PM Report** (the shipped artifacts). Special/Training reports join when those modules ship.
- Audience: all authenticated users, with the visibility matrix below.

## Visibility matrix (THE crux — enforced in the loaders, app-layer)

Levels: employee/trainee ≤ L3, **KH = L4**, **Shift Lead = L5**, AGM+ = L6+.

| Report type | ≤ L3 (employee/trainee) | L4 (KH) | L5+ (SL+) |
|---|---|---|---|
| Opening · Closing · AM Prep · Mid-day | full content, **no notes** | full content, no notes | **+ notes** |
| Cash | **hidden** (not listed) | content, **no** over/short note | + over/short note |
| PM Report | **own evals only** (structured, no notes) | all evals (structured, no notes) | + notes |

- **Notes are uniformly SL+ (L5+)** in the hub: checklist completion `notes`, PM eval `note`, cash `over_short_note`. Below L5 those fields are never selected by the loader.
- **Cash is KH+ (L4+)**: not even listed for ≤ L3.
- **PM evals for ≤ L3**: only rows where `employee_id = viewer` (their own feedback, structured, no notes — same data as `loadMyFeedback`). L4+ see all employees' evals (structured); L5+ + notes.
- **Reconciliation with PM page:** the PM report *page* still shows its KH+ author/managers the notes at L4 (as shipped — that's the authoring surface). The **hub** is the browsing surface and gates note-viewing at L5+. Two surfaces, two rules (Juan-confirmed).
- **Enforcement is app-layer**, exactly like PM's `loadMyFeedback`: the tier-aware loaders decide which columns/notes to SELECT. RLS remains the row-level second layer. The UI never receives redacted content, so it cannot leak it.

## Surfaces

- **`/reports` page** (replaces `app/reports/page.tsx` stub; moves under `(authed)` for the `TranslationProvider` + chrome, per the maintenance-page lesson). A **filter bar** (date range · report type · location-the-viewer-can-access) + a **results list** (one row per report: date · type · location · submitter · status). Each row → a **tier-aware detail read view** of that report's contents.
- The nav chip `/reports` (Reports Hub) already exists in `DashboardNav` (scoped). It will carry the active location.

## Architecture

- **`lib/reports-hub.ts`**:
  - `Viewer = { userId, level }` + a `ReportTypeKey` union (`opening | closing | am_prep | mid_day | cash | pm`).
  - `listReports(service, { viewer, locationId, dateFrom, dateTo, types? }) => ReportListItem[]` — unions the artifacts (checklist_instances for opening/closing/am/mid-day via their template types; cash_reports; pm_reports), applies the **visibility matrix to the LIST** (employees: no cash; PM only own), filters by date/type/location, returns a common `{ type, id, date, locationId, submitterName, status }` shape, newest first.
  - `loadReportDetail(service, { viewer, type, id }) => ReportDetail | null` — dispatches per type, loads contents, and **redacts to the viewer's tier** (omit notes < L5; cash blocked < L4; PM own-only < L4). Returns a discriminated `ReportDetail` the read view renders.
- **`app/(authed)/reports/page.tsx`** — server page: auth, resolve `viewer` (id + level) + location (`lockLocationContext`), read filters from `searchParams`, `listReports`, render the filter bar + list. A row links to `/reports/<type>/<id>` (or `/reports?type=&id=` detail param).
- **`app/(authed)/reports/[type]/[id]/page.tsx`** (or a detail route) — `loadReportDetail` + a tier-aware read view per type.
- **Components** `components/reports-hub/*`: `ReportFilterBar`, `ReportList`, and per-type read views (`OpeningClosingDetail` shared for the 4 checklist types, `CashDetail`, `PmDetail`).
- i18n `reports.*` keys.

## Build phasing (one branch, longer plan)

This is the biggest module. Sensible task order: (1) `lib/reports-hub.ts` `listReports` + visibility + a smoke; (2) the `/reports` list page + filter bar + nav-location wiring; (3) `loadReportDetail` + the checklist-type read view (covers 4 types); (4) cash + PM read views; (5) i18n + final smoke + ship. Free-text search is **deferred** to a fast-follow (v1 = structured filters: date range, type, location).

## Out of scope (v1)

- Free-text search (structured filters only).
- Special / Training report types (not built yet).
- Maintenance "reports" (the maintenance log is its own surface; not a report artifact).
- Export/print.

## Reuse + lessons

- Tier-aware redaction mirrors PM's `loadMyFeedback` (app-layer column selection).
- `lockLocationContext` on the page + any `?location=` (Mid-Shift IDOR lesson).
- Operational-date / formatting helpers from `lib/i18n/format.ts`; report-status/`isSubmitted` from `lib/midshift.ts` where useful.
- The detail read views render already-stored data; no writes anywhere.

## Verification

- `tsc` + `next build`; throwaway `tsx` smokes: `listReports` returns the right set per tier (employee sees no cash + only own PM; KH+ sees cash; etc.); `loadReportDetail` omits notes below L5 (`("note"/"notes" in detail) === false` style assertions per type); cash detail null/blocked below L4. Juan preview smoke across roles.
