# Reports Hub — Trend Charts (Design)

**Date:** 2026-06-17
**Status:** Approved design, pre-plan
**Builds on:** the merged Reports Hub (`lib/reports-hub.ts`, `/reports` list + detail, `computeReportSignals`, derived filters).
**Cycle:** Wave 3 follow-up #1 of 2 (this = trend charts; free-text search = separate later cycle).

---

## Goal

Turn the per-report operational signals the hub already computes into **time-series trends** so KH+ (and, where appropriate, all staff) can see *how the operation is moving* — not just inspect one report at a time. Answer "are we hitting par day-over-day?", "are fridges creeping warm?", "is the drawer drifting?", "are tasks getting done?" at a glance, across day / week / month, with period-over-period comparison.

## Scope

**In this cycle:**
- A shared aggregation loader (`lib/reports-trends.ts`).
- A dedicated trends **page** at `/reports/trends` — layout **A (stacked cards)**, each chart wrapped in a plain-language explainer + a "how to read this" tidbit.
- A **dashboard widget** — layout **B (2×2 small-multiples grid)**, a compact consumer of the same loader.
- Hand-rolled SVG chart components (no chart-library dependency).

**Deferred (explicitly, not forgotten):**
- **Report-detail tabbed view (layout C)** — an accompanying trend view inside report drill-in. Fast-follow right after this cycle.
- **Free-text search** — its own next cycle.
- **People / employee metrics** (who's doing the most/least, on-time-completion, PM trends) — its own next cycle. The Day/Week/Month + period-over-period machinery built here is the engine that cycle will reuse.
- **Individual punctuality** ("coming in on time") — blocked on Toast clock-in + 7shifts schedule, the same constraint that kept PM's dimension "arrived ready to work" rather than "on time." Not designed here.
- **All-locations roll-up** — trends are per-location (matching the hub's `?location=` model). A 7+ cross-location roll-up is a later option.

## Signal families & chart-type mapping

Four families. Chart type is chosen per family by which communicates the data best (line where slope/drift is the story; bars where values are discrete counts often near zero, or where literal period-vs-period is the point):

| Family | Source | Day view | Week / Month + comparison | "Lower/higher is better" |
|---|---|---|---|---|
| **Par** (under-par & over-par item counts) | prep-bearing checklist completions (`isPrepData`) on opening/closing/am_prep/mid_day | **Line** — under + over as two series | **Grouped bars** (period vs previous) | under-par lower = better |
| **Temps** (fridge readings >41°F) | completions on a location's temp-item ids (`loadLocationTempItemIds`), `count_value > FRIDGE_DEFAULT_SAFE_MAX_F` | **Bars** (a line between zeros misleads) | **Bars** | lower = better |
| **Cash** over/short 🔒KH+ | `cash_reports.over_short_cents` (not superseded) | **Line** with a zero baseline | **Line** | nearer $0 = better |
| **Completion** | required checklist items done ÷ required, across in-scope instances | **Line** (trend toward/away from 100%) | **Line** | higher % = better |

PM reports are **not** a trend family this cycle (people-metrics next cycle).

Each family's chart-type choice is a constant in the component layer (easy to flip a row later).

## Time model

- **Granularity:** Day / Week / Month toggle. Each sets bucket size and a sensible default window:
  - Day → last **30 days** (also offer 7 / 90 in the same switcher).
  - Week → last **12 weeks**.
  - Month → last **6 months**.
- **Single-day view:** tapping a data point (or bar) links to the existing hub list filtered to that operational date — reuse, no new surface.
- **Comparison ("vs previous"):** toggle that overlays/compares the **immediately-preceding equal-length, equal-bucketing window**. Headline delta per card = `current total − previous total`, rendered with a direction arrow colored by whether the move is good or bad for that family.

## Aggregation semantics (exact)

Operational date is the bucketing key (`checklist_instances.date`, `cash_reports.report_date`).

- **Daily bucket value:**
  - Par: **sum** of under-par (and, separately, over-par) item counts across that date's in-scope prep-bearing completions.
  - Temps: **sum** of temp-flag completions that date.
  - Cash: that date's `over_short_cents` (one active cash report per date; if multiple, the non-superseded one).
  - Completion: `done ÷ required` across that date's in-scope checklist instances → percentage.
- **Week / Month bucket:** **sum** the counts (par, temps); **net sum** the cash over/short; **average** the completion %.
- **Missing days are a gap, not a zero.** A date with no in-scope report renders as a hollow/absent point — "no report" is distinct from "reported, nothing flagged." (Mirrors the codebase's NULL-sentinel honesty; do not fabricate a 0.)

## Security & redaction

Tier-match the existing hub — no new visibility invariants:
- The trends **page is visible to hub-authorized users** (par/temps/completion are aggregate operational signals, same audience that already sees the individual operational reports).
- The **cash series is KH+ only** (`REPORTS_HUB_CASH_LEVEL = 4`). For viewers below L4 the cash family is omitted from the loader output entirely (not just hidden client-side).
- **IDOR — two halves:** the page validates the `?location=` param via `lockLocationContext` (can the viewer access this location), **and** every bulk query in the loader filters `location_id = <authorized>` (does this data belong to it). Both are required.
- Per-location only this cycle.

## Architecture

**`lib/reports-trends.ts` (new):**

```ts
export type TrendGranularity = "day" | "week" | "month";
export type TrendFamily = "par" | "temps" | "cash" | "completion";

export interface TrendBucket {
  key: string;          // bucket label, e.g. "2026-06-14" | "2026-W24" | "2026-06"
  hasData: boolean;     // false → render as gap, not zero
  underPar: number;
  overPar: number;
  tempFlags: number;
  cashOverShortCents: number | null; // null when no cash report / family redacted
  completionPct: number | null;      // 0..100; null when no required items that bucket
}

export interface TrendSeries {
  granularity: TrendGranularity;
  current: TrendBucket[];
  previous: TrendBucket[] | null;   // null when compare is off
  // headline totals + deltas per family, current vs previous
  totals: Record<TrendFamily, { current: number | null; previous: number | null; delta: number | null }>;
  cashVisible: boolean;             // false for viewers < L4 (cash family omitted)
}

export async function loadTrendSeries(
  service: SupabaseClient,
  args: {
    viewer: { userId: string; level: number };
    locationId: string;            // already authorized via lockLocationContext upstream
    granularity: TrendGranularity;
    window: { from: string; to: string };  // inclusive YYYY-MM-DD
    compare: boolean;
  },
): Promise<TrendSeries>;
```

Implementation notes (load-bearing):
- **Bulk-load once, aggregate in memory.** Load all in-scope `checklist_instances` (+ their templates, completions, template-item required flags) and `cash_reports` for the *full* span (current window ∪ previous window when comparing) in a small number of `.in(...)`-scoped queries — **never** a per-date loop calling `computeReportSignals` (that is the N+1 / `.limit()`-scan silent-at-scale trap). Reuse the *derivation* logic from `computeReportSignals` (mid_day `total` is a prepped **delta** → `have = onHand + total`; am_prep `total` is **final** → `have = total ?? onHand`; temp flag only on registry temp-item ids with `count_value > 41`), factored so both the per-report loader and this batched loader share it.
- `prep_data` is always narrowed via `isPrepData`, never trusted raw.
- Bucket by operational date; week = ISO week, month = `YYYY-MM`.

**Components (`components/trends/`, hand-rolled SVG, brand tokens):**
- `LineChart.tsx` — one or two series, optional faded "previous" series, zero baseline option (cash), gap handling.
- `BarChart.tsx` — single or grouped bars, gap handling.
- `TrendCard.tsx` — chart + headline number + delta arrow + explainer + "how to read this" callout.
- `TrendControls.tsx` — granularity toggle + compare toggle (location comes from page context).

**Page (`app/(authed)/reports/trends/page.tsx`):** layout A; reads session + location via the same pattern as `/reports`; calls `loadTrendSeries`; renders one `TrendCard` per visible family. A "Trends" link is added to `/reports`.

**Dashboard widget:** layout B (2×2 grid) consuming `loadTrendSeries` with a compact default (e.g., Day / last 30 / compare on); links to the full page.

## i18n

All chart titles, axis/legend labels, family names, delta phrasing, and every "how to read this" tidbit get keys in `lib/i18n/en.json` + `lib/i18n/es.json` in the same PR (C.37 translate-from-day-one). Spanish is operational/tú-form. New namespace: `reports.trends.*`. Time/date labels use the canonical `lib/i18n/format.ts` helpers (`language`-aware, never browser locale).

## Verification (no test framework)

`tsc --noEmit` + `next build` (separate gates) + throwaway self-deleting `tsx` smokes against **live rows**:
- Bucketing math: daily sums, week/month aggregation, completion averaging vs hand-computed expected from real instances.
- Comparison deltas: `current − previous` correct; compare-off returns `previous: null`.
- **Cash gate:** `loadTrendSeries` for an L3 viewer returns `cashVisible: false` and no cash data; L4+ sees it.
- **IDOR:** a `locationId` the viewer can name but data from another store never leaks — cross-location rows excluded.
- Missing-day → `hasData: false` (gap), not a 0 point.

## Deferred / open (tracked)

- Report-detail tabbed trend view (layout C) — fast-follow.
- Free-text search — next cycle.
- People/employee metrics + punctuality (Toast-gated) — next cycle.
- All-locations roll-up for 7+ — later.
