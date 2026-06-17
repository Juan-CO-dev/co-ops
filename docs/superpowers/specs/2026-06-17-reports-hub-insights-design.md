# Reports Hub — Richer Detail + Derived Filters (Design Spec)

**Date:** 2026-06-17
**Status:** design — awaiting Juan's spec review before plan. Builds on the merged base Reports Hub (PR #61).

## Goal

Make the Reports Hub **interpretive**: every drill-in opens with a computed **highlights** summary (did it reach par, what was under/over, what was skipped, out-of-range temps, cash over/short, the actual prep values), and the list gains **derived "exotic" filters** (e.g. "days under par", "out-of-range temp", "cash short") powered by the same per-report signals. Read-only; reuses the base hub's loaders + tier-redaction.

## Derived signals (computed per report — one `computeReportSignals` layer feeds BOTH the list filters and the detail highlights)

1. **Completion summary** (all types): items done / total / **skipped-or-incomplete** (template items with no live completion, or completions carrying a skip/incomplete reason). The detail lists which were skipped.
2. **Par status** (prep: am_prep, mid_day): per item, compare `prep_data.inputs.total` (the prepped amount / "how much to open with") against `prep_data.snapshot.parValue`. **Under par** = total < par; **over par** = total > par; par-null items excluded. Detail shows counts + the under/over items with the delta.
3. **Prep values** (prep): the actual per-item numbers — **par · on-hand · total** (and back-up/portioned where present) — rendered as a values table. This is the "how much we got to open with" view Juan asked for. (Replaces the base hub's thin `count_value`-only rendering for prep items.)
4. **Out-of-range temps** (opening/closing/prep): completions on fridge temp items (`expects_count`, the maintenance-registry temp items) with `count_value > 41`. Detail flags them; signal = any-out-of-range.
5. **Cash over/short** (cash): `over_short_cents` → over / short / even readout vs projected (base hub already shows the figure; the signal makes it filterable). Respects existing cash KH+ gate.
6. **PM gradient tally** (pm): counts of Great / Good / Needs-work across the evals' dimensions — a detail highlight (not a list filter in v1). Respects existing PM tier rules (employees: own only; notes SL+).

## Detail enrichment

Each drill-in gets a **highlights card** at the top (the computed signals above, grouped), then the existing per-item body — with prep items now showing the **values table** (par/on-hand/total) instead of a bare count. All of this respects the base hub's **tier redaction** (notes still SL+, cash KH+, PM own-for-employees) — the signals are derived from data the viewer is already allowed to see.

## Derived filters (the "exotic" list filters)

The filter bar gains derived toggles, each backed by a per-report signal: **Under par · Over par · Has skipped items · Out-of-range temp · Cash over · Cash short.** Selecting one narrows the list to matching reports. The list rows also show a small **signal badge** (e.g. "⚠ 3 under par", "1 temp flag") so patterns are visible at a glance. (PM gradient is detail-only in v1.)

## Architecture

- **`lib/reports-hub.ts`** (extend):
  - `ReportSignals` type: `{ done: number; total: number; skipped: number; underPar: number; overPar: number; tempFlags: number; cashOverShortCents: number | null }` (+ a per-item detail breakdown for the views).
  - `computeReportSignals(service, { type, id })` — derives the signals for one report by loading its completions (+ prep_data / count_value / template items). For prep, parse `prep_data` (inputs.total vs snapshot.parValue). Reused by detail loaders.
  - `loadReportDetail` attaches `signals` + (prep) the per-item value rows to the returned detail.
  - `listReports` gains optional `signalFilters` (the toggles) — to apply them it computes signals per candidate report (CO volume is small: tens of reports per query window) and filters; it also returns a light `signalSummary` per row for the badges. Performance note in the plan; a derived/materialized column is a future optimization if volume grows.
- **Detail views** (`ChecklistReportDetail`, `CashReportDetail`, `PmReportDetail`): render the highlights card + (checklist-prep) the values table.
- **`ReportFilterBar`**: add the derived toggles (cash toggles only when viewer ≥ L4).
- i18n `reports.signal.*` keys.

## Out of scope (v1)

- Cross-report trend/aggregate views ("under par 4 of last 7 days" as a chart) — the *filter* surfaces these days; a dedicated trend view is a later enhancement.
- Free-text search (still deferred).
- New derived columns / materialized signals (compute-on-read for v1).

## Reuse + lessons

- Tier redaction + the **cross-location IDOR guard** (detail loaders bind `location_id`) from the base hub stay intact — `computeReportSignals` derives only from already-authorized data.
- Prep parsing mirrors `lib/prep.ts` `isPrepData`/`PrepData` typing (don't trust raw JSONB — narrow it).
- Temp threshold reuses the maintenance `FRIDGE_DEFAULT_SAFE_MAX_F` (41) where natural.

## Verification

- `tsc` + `next build`; throwaway `tsx` smokes: `computeReportSignals` on a real prep report returns correct under/over-par counts + total values; on a closing with an out-of-range temp flags it; `listReports` with `signalFilters.underPar` returns only under-par reports. Tier redaction unchanged (re-assert notes SL+). Juan preview smoke.
