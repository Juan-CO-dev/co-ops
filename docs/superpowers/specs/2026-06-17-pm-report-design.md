# PM Report — Design Spec (Wave 2 module)

**Date:** 2026-06-17
**Status:** design — awaiting Juan's spec review before plan.

## Goal

An **end-of-shift report** a KH+ fills (one per location per day): an auto shift wrap-up + **structured per-employee feedback** + an optional MVP. Employees see their **own** structured feedback (notification + a private "My Feedback" view); the free-text **notes are KH+ eyes only.** Unlike the Mid-Shift Pulse (pure read), this module **captures new data** (a write surface).

## Audience

- **Create / fill / edit:** KH+ — `level >= 4` (`key_holder` = 4). Constant `PM_REPORT_BASE_LEVEL = 4`.
- **View full report** (all evals incl. notes): managers, `level >= 4`, within their location.
- **View own eval** (structured inputs only, **never the note**): each employee, their own rows only.

## Scope

- **Per-location**, today's operational date (operational TZ via the same `operationalNow`/date helper used by Mid-Shift). One PM Report instance per `(location, date)`.
- **Standard edit model** — edit-within-window / reopen, mirroring the other reports (C.46 chained-edit/attribution patterns). No PIN signature (lower-stakes than cash).

## Structure of a PM Report

1. **Shift wrap-up (auto / read)** — per-employee activity from report data (report items completed via `completed_by`, reports submitted) + on-time vs overdue, reusing the activity proxy + `EXPECTED_BY`/`computeOverdue` timeliness model from `lib/midshift.ts`. Most-active surfaced.
2. **MVP (KH+, optional)** — name a standout employee + a free-text reason. Optional (a report can submit without one).
3. **Per-employee evals (KH+)** — for each employee (auto **active-today** list + an **"add employee"** picker over the location's users):
   - `on_time` — boolean (yes/no)
   - `attitude` — enum: **`great` | `good` | `needs_work`**
   - `area_to_improve` — text (optional)
   - `note` — text (optional) — **KH+ EYES ONLY**
4. **Submit** → each evaluated employee gets a notification ("new shift feedback"); their structured eval (no note) appears on their My Feedback view.

## Visibility model (3 tiers)

| Field | KH+ (report + viewing a profile) | Employee — own feedback | Public profile (DEFERRED) |
|---|---|---|---|
| `on_time`, `attitude` | ✓ all | ✓ own | ✓ only if positive |
| `area_to_improve` | ✓ | ✓ own | ✗ |
| `note` | ✓ **KH+ only** | ✗ never | ✗ never |
| MVP win | ✓ | ✓ | ✓ |

- **`note` is KH+ eyes only** — never returned to an employee, never public.
- **Column-level enforcement is app-layer** (RLS is row-level only): RLS lets an employee read their own `pm_employee_evals` rows, but the **My-Feedback loader/API NEVER selects `note`** (the KH+ loader does). Mirrors the documented `shift_overlays.forecast_notes` CGS-only pattern in AGENTS.md.
- **Positivity** (for the future public profile): `on_time = true`, `attitude ∈ {great, good}`, and MVP wins are "positive"; `area_to_improve`, `attitude = needs_work`, `on_time = false`, and notes are NOT public. Computable from the stored columns — no extra storage; the data is built ready for the Profile module to render.

## Data model (two new tables, append-only)

- **`pm_reports`** — the instance: `id`, `location_id`, `report_date`, `status` (`open` | `submitted` | `incomplete_confirmed` | `auto_finalized`), `mvp_user_id` (nullable FK users), `mvp_note` (nullable text), `created_by`, `created_at`, `submitted_at` (nullable), `submitted_by` (nullable), `superseded_at` (nullable). Partial unique index: one live row per `(location_id, report_date)` where `superseded_at IS NULL`.
- **`pm_employee_evals`** — per-employee rows: `id`, `pm_report_id` (FK), `location_id`, `employee_id` (FK users), `on_time` (bool), `attitude` (text CHECK in great|good|needs_work), `area_to_improve` (text null), `note` (text null), `author_id` (FK users), `created_at`, `superseded_at` (nullable, for append-only edits).
- **RLS:**
  - `pm_reports`: read + insert + update(status/supersede) for `current_user_role_level() >= 4 AND location_id = ANY(current_user_locations())`. `_no_user_delete USING(false)`. Split INSERT/UPDATE (no `FOR ALL`). Employees do NOT read `pm_reports`.
  - `pm_employee_evals`: KH+ (`>= 4` + location) read all; **employee** reads `WHERE employee_id = current_user_id()`. Insert/supersede: KH+ only (+ location). `_no_user_delete USING(false)`, `_no_user_update USING(false)` (edits supersede). The `note` column-hiding for employees is APP-LAYER (loaders), not RLS.

## Surfaces

- **Dashboard tile** (KH+, scoped to the active location) — create / fill / submit the PM report. Reports stay tiles (per the nav classification); the tile carries `selectedLocation.id`.
- **"My Feedback" page** (`/my-feedback`, **unified** per-user nav entry — added to `DashboardNav` as a non-scoped chip) — each employee sees structured evals about themselves (no notes), newest first, with date + location + attitude/on-time/area-to-improve + any MVP wins.
- **Notification on submit** (`lib/notifications`) — one per evaluated employee.

## Out of scope (v1)

- **Public profile** (positive highlights visible to all employees) → the Profile module; PM data is built to feed it.
- True scheduled roster (7shifts stub) → active-today proxy + manual "add employee."
- PIN signature on submit (not needed for feedback).

## Reuse

- Activity aggregation + `EXPECTED_BY`/`computeOverdue` from `lib/midshift.ts` (extract/extend for per-user item counts — extend `loadActiveToday` to carry per-user completion counts, or add a sibling loader).
- `lib/notifications` for submit notifications.
- Closing/cash report form + C.46 edit patterns; location auth via `lockLocationContext` on every page/route that takes `?location=` (per the Mid-Shift IDOR lesson).

## Verification

- `tsc` + `next build`; throwaway `tsx` smokes: create a pm_report + evals + submit; the My-Feedback loader returns structured fields but **never `note`**; employee-read RLS returns only own rows; KH+ loader returns notes. Juan preview smoke.
