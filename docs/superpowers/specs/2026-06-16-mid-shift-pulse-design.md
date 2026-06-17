# Mid-Shift Pulse — Design Spec (Wave 2 module)

**Date:** 2026-06-16
**Status:** design — awaiting Juan's spec review before plan.

## Goal

A **read-only operational pulse** for KH+ managers to glance at mid-service and instantly see *whether the day is on track and what needs action now.* It aggregates already-captured data from the shipped report modules and **writes nothing** — it's a read surface, not a new workflow (per the AGENTS.md "read surfaces over new workflows" principle).

## Scope

- **Audience:** KH+ — `level >= 4` (`key_holder` = 4 per `lib/roles.ts`). Constant `MIDSHIFT_BASE_LEVEL = 4`. (Juan: "KH+, they usually are closing the store.")
- **Per-location**, scoped to **today's operational date** (America/New_York, via the same `nyDateString(new Date())` helper the cash/maintenance pages use).
- **Entry point:** a **nav-bar link** in `DashboardNav` (no dashboard tile). Route `/mid-shift` under the `(authed)` group.
- **Read-only**; refresh-to-update (no realtime), consistent with the rest of the app.

## Sections (top → bottom)

1. **Attention banner** — the payoff, surfaced first, in priority order: overdue reports → out-of-range fridge temps (>41°F today) → under-par AM-prep items → open maintenance notes (today). If none: a calm "All clear."
2. **Report statuses** — Opening · AM Prep · Mid-day Prep(s) · Cash · Closing. Each row: status (done / in-progress / not-started), who + when if done, and an **overdue** flag per the model below.
3. **Fridge temps** — latest reading per fridge from the maintenance registry, >41°F flagged; links into `/maintenance`.
4. **Active today** — staff who've completed/submitted any report today (proxy for "on shift"), with what they touched. Labeled honestly as "active today," not "scheduled." Upgrades to a true roster when 7shifts is integrated.
5. **Sales & forecast** — greyed **"connect Toast"** placeholder. Toast POS is a disabled stub (`toast_daily_data` empty, route returns 501); live sales/velocity/forecast wait for that integration.

## Overdue model (`EXPECTED_BY` logic)

Two kinds of overdue, both evaluated against `now` in the operational TZ:

**Clock-based:**
- **Opening** — overdue if `now > 10:30` and not done. (Store opens 10:30a.)
- **Mid-day Prep** — due window **14:00–15:30**; overdue if `now > 15:30` and no mid-day prep instance is done. (Before 14:00 it reads "not due yet.")
- **Closing** — overdue if `now > 21:00` and not done. (Store closes 20:00; 1-hour wrap grace.)

**Closing-dependent** (Juan: "AM prep and cash deposits should be expected whenever the closing checklist is done"):
- **AM Prep** — overdue only if **closing is done/finalized AND am-prep is not submitted**.
- **Cash Deposit** — overdue only if **closing is done/finalized AND cash is not submitted**.
- Before closing is done, AM Prep + Cash show neutral status (not overdue), regardless of clock.

Times are identical at MEP + EM in v1 (universal store hours); trivially made per-location later (the `EXPECTED_BY` map can key by location).

## Architecture (composes shipped code; no new tables)

- **`lib/midshift.ts`** — `loadMidShiftPulse(service, { locationId, today, now }) => MidShiftPulse`. Composes the existing dashboard-state loaders (opening / am-prep / mid-day / cash / closing) + `loadMaintenanceOverview` (lib/maintenance.ts) + one "active today" activity query. Houses the `EXPECTED_BY` config + `computeOverdue` helpers + the attention-item derivation. Returns a single typed `MidShiftPulse` object. **No new tables, no writes.**
- **`app/(authed)/mid-shift/page.tsx`** — server component. KH+ gate (`auth.level >= MIDSHIFT_BASE_LEVEL`, soft-deny below). Resolves location from `?location=` if present, else the actor's first location (friendlier for a nav link than the cash/maintenance redirect-to-dashboard). `today` via `nyDateString`, `now` via `new Date()`. Renders the sections; read-only (no client component / form).
- **`components/midshift/*`** — `AttentionBanner`, `ReportStatusList`, `FridgeStrip`, `ActiveToday`, `SalesPlaceholder` (server components, `serverT`).
- **`DashboardNav`** — add a `nav.mid_shift` chip → `/mid-shift` (resolve location via the page's default-to-first-location, so the static nav href needs no location param).
- **i18n** — `midshift.*` keys (EN + ES, identical sets).

## Data sources (all existing)

- **Report statuses:** the dashboard-state loaders already used by `app/(authed)/dashboard/page.tsx` — `loadAmPrepDashboardState`, `loadMidDayPrepDashboardState`, `loadCashDashboardState`, opening + closing state. Reuse them; do not re-query raw.
- **Fridge temps:** `loadMaintenanceOverview` (lib/maintenance.ts).
- **Active today:** distinct users with activity today across `checklist_completions` (`completed_by`, via instance date = today) + submissions/confirmations (`confirmed_by`) + `cash_reports` (signed-by), joined to `users` for names. Each user annotated with which report(s) they touched.

## Out of scope (v1)

- Live sales / velocity / forecast (Toast integration deferred).
- True scheduled roster (7shifts integration deferred).
- Admin UI for editing due-times (hardcoded `EXPECTED_BY` in v1).
- Realtime updates (refresh-to-update).

## Verification

- `tsc --noEmit` + `next build` clean.
- A throwaway `tsx` smoke for `loadMidShiftPulse` against live MEP data: returns report statuses, fridge temps, computed overdue flags for a fixed `now`, and active-today list — self-cleaning.
- Juan smoke on the preview URL.
