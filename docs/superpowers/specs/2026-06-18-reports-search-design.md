# Reports Hub Free-Text Search — Phase 1: Quick-Find (Design)

**Date:** 2026-06-18
**Status:** Approved design, pre-plan
**Builds on:** the Reports Hub (`lib/reports-hub.ts` `listReports`, `/reports` list page, `ReportFilterBar`).
**Cycle:** the last deferred Wave-3 follow-up. **Phased** — this is Phase 1 (quick-find); deep authorized-content search is an explicit Phase-2 follow-up.

---

## Goal

Add a search box to the Reports Hub that finds reports by **who/what** — matching the submitter name and report type already shown on each list row. Instant, free (no new queries), and composes with the existing filters.

## Scope (Phase 1)

- A `?q=` text field in the existing `ReportFilterBar` server `<form method="get">` (no client JS — matches the bar).
- The `/reports` page runs `listReports(...)` exactly as today, then **filters the returned, already-authorized `ReportListItem[]`** by `q` in memory. Search is a plain **AND** on top of the existing date / type / signal filters and inherits all their gating + the cross-location IDOR guard for free.
- **Match (case-insensitive substring):** the row's `submitterName` OR its **report-type label** (the localized `reports.type.<type>` string, so Spanish users can type "cierre" and match Closing) OR the raw type key (so "closing"/"pm" match regardless of language).
- **Empty result:** a "no reports match '{q}'" message.
- **No highlighting** — the matched fields (name, type) are already visible on every row.
- `q` is preserved across navigation alongside the other params (hidden/value-bound in the GET form).
- **No migration.** Pure read.

## Security / privacy

Phase 1 matches **only fields already on the authorized list row** (submitter name, type) — never a tier-sensitive field. So there is **no new redaction surface**: search operates on the list `listReports` already returned for this viewer, which is fully gated (cash KH+, PM own-for-employees) and IDOR-bound. "Matching is disclosure" does not bite here because every matched field is already displayed.

## Architecture

- **`lib/reports-search.ts`** (new) — a pure helper:
  ```ts
  /** Case-insensitive substring match for quick-find. `typeLabel` is the
   *  viewer-localized report-type label; `typeKey` is the raw ReportTypeKey. */
  export function matchesReportQuery(
    item: { submitterName: string | null; type: string },
    q: string,
    typeLabel: string,
  ): boolean
  ```
  Normalizes `q` (trim + lowercase); returns true if any of `submitterName`, `typeLabel`, or `item.type` (lowercased) contains it. Empty/whitespace `q` → caller skips filtering (treat as "no search"). Kept as its own file so Phase 2 (deep content) can extend the matchable corpus here.
- **`components/reports-hub/ReportFilterBar.tsx`** — add a labeled text input `name="q"` (defaultValue = current q), placeholder via i18n. Server form; no JS.
- **`app/(authed)/reports/page.tsx`** — read `q` from `searchParams`; build a `typeLabelByType` map once (`serverT(lang, "reports.type.<t>")` for the 6 types); when `q.trim()` is non-empty, `items = items.filter((it) => matchesReportQuery(it, q, typeLabelByType[it.type]))`; pass `q` to `ReportFilterBar`; render the empty-state message when the filtered list is empty AND `q` is present (distinct from the existing no-reports state).
- **i18n** `reports.search.*` EN+ES: placeholder, aria-label, empty-result message (with `{q}` param).

## Verification (no test framework)

- `tsc --noEmit` + `next build`.
- Pure smoke on `matchesReportQuery`: matches submitter name (case-insensitive), matches localized type label, matches raw type key, non-match returns false, empty/whitespace handling.
- Manual (preview): type a name → only that person's reports; type "closing"/"cierre" → only closing; combine with a date/type filter → AND; clear → all return; nonsense → empty-state message.

## Deferred — Phase 2 (deep authorized-content search)

Matching text *inside* reports — completion notes, item labels/stations, PM area-to-improve, cash over/short notes, and non-submitter completer names — each gated to the viewer's tier (the "matching is disclosure" rule: redact the corpus *before* matching). Requires loading per-report authorized text within the window (heavier) + careful tier projection. Its own spec → plan → build cycle.
