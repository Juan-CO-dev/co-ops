# Reports Hub Free-Text Search — Phase 2: Deep Authorized-Content (Design)

**Date:** 2026-06-18
**Status:** Approved design, pre-plan
**Builds on:** Phase 1 quick-find (PR #72 — `lib/reports-search.ts` `matchesReportQuery`, `/reports` `?q=` filtering the authorized `listReports` output by submitter name + type).
**Cycle:** the deferred deep half of free-text search.

---

## Goal

Extend `/reports` search to match text **inside** reports — item labels/stations, completer names, completion notes, cash over/short notes, PM feedback — so managers and staff can find "the shift where a note mentioned the slicer." Every matched field is **redacted to the viewer's tier before matching** (matching is disclosure), and results show a **snippet** of where the match landed, linking to the existing rich detail.

## The privacy invariant (the crux)

**Search only ever matches text the viewer is already authorized to read.** The corpus is built per-viewer by applying the *same* gates as the detail loaders, **before** matching — never match then redact. Because the corpus is already authorized, showing a match **snippet** is safe (it's text the viewer could open in the detail anyway).

## Searchable corpus + per-field gates (mirror the detail loaders exactly)

For each report in the current authorized list (`listReports` already gated cash KH+, PM own-for-employees, IDOR-bound), build a searchable blob from:

| Field | Gate |
|---|---|
| report-type label + submitter name | all (Phase-1 carryover) |
| **item labels, stations** | all viewers who can see the report |
| **completer names** (per-item `completed_by` name) | all viewers who can see the report |
| **completion notes** | **L5+** (`REPORTS_HUB_NOTES_LEVEL`) |
| **cash over/short note** | **L5+** (cash reports are KH+/L4 base-visible) |
| **PM area-to-improve** | managers (L4+) across all evals; employees only their **own** eval |
| **PM note / MVP note** | manager-only (L4+; note further L5+) |

(Fridge temps are covered implicitly — they're item labels/values inside opening/closing reports.)

## Mechanism

- **`buildSearchCorpus(service, { viewer, locationId, dateFrom, dateTo, items })`** (new, in `lib/reports-search.ts`) → `Map<reportKey, SearchCorpusEntry>` where `reportKey = \`${type}:${id}\`` and `SearchCorpusEntry = { fields: { label: string; text: string; fieldKey: string }[] }` (each authorized text chunk tagged by its field for snippet labeling).
  - Bulk-loads only the in-window reports' text: checklist `checklist_completions` (label/station via `checklist_template_items`, completer names via `users`, notes if L5+) for the checklist/opening report instance ids; `cash_reports.over_short_note` (L5+) for cash; `pm_employee_evals` (area_to_improve always for own / L4+ all; note/mvp per tier) for PM. Applies the gates above as it builds each entry. Paginated via the existing `selectAllRows` helper.
  - In-memory only. **No migration.**
- **Match:** a `searchReport(entry, q, baseFields)` returns `{ matched: boolean; snippet?: { fieldKey: string; text: string } }`. Match = case-insensitive substring over the base (name/type) + every corpus field's text. When a **deep** field matches, build a snippet: the field's label key + a context window (~60 chars centered on the match, ellipsized). When only name/type match, `matched: true` with no snippet (Phase-1 behavior — plain row link).
- The page: run `listReports(...)` as today → if `q` present, `buildSearchCorpus(...)` for those items → keep items whose `searchReport` matches → attach the snippet → render.

## Composition

ANDs with the existing date / type / signal filters (those run in `listReports`; search filters the result). Subsumes Phase-1 name/type match (now part of the corpus). `q` preserved in the GET form as today.

## Result UX

- Matching rows render as today (link to the rich `/reports/<type>/<id>` detail).
- When a deep snippet exists, a small line under the row: `<field label>: "…<context>…"` (e.g. `Note: "…speed on the slicer…"`). The snippet text is authorized; no new disclosure.
- Empty result → existing `reports.search.empty` ("No reports match '{q}'").
- New i18n: `reports.search.snippet_field.*` labels (note / item / station / completer / cash_note / area_to_improve) + a snippet wrapper if needed.

## Security

- Corpus built with the exact detail-loader gates → no field a viewer can't see is ever in the matchable text, so no match/snippet can leak it.
- Operates on `listReports`' already-gated, IDOR-bound list; `buildSearchCorpus` binds every query to `locationId` + the in-window report ids derived from that authorized list (no independent fetch path).
- PM employees: corpus includes only their *own* eval text (mirror the `.eq("employee_id", viewer.userId)` gate).

## Performance

Bounded by the hub date window (default 14 days). Bulk loads (paginated) over the in-window report ids — same data the detail loaders read, but once in bulk rather than per-open. CO scale is small. A soft note: very large custom windows (e.g. 90 days) load proportionally more text; acceptable now, revisit (or cap the search window) only if it bites. Corpus is built **only when `q` is non-empty** — zero cost on the default unfiltered list.

## Verification (no test framework)

- `tsc` + `next build`.
- Pure smoke: `searchReport` matches a deep field + returns a correctly-windowed snippet; name/type-only match returns no snippet; non-match false.
- Live smoke: `buildSearchCorpus` for an **L5+** viewer includes a known completion note; for an **L3** viewer the SAME note is absent from the corpus (gate holds → a query for that note's text returns no match for L3); cash note only in L5+ corpus; PM area-to-improve scoped own-vs-all by tier; cross-location IDOR (corpus only covers the authorized location's in-window reports).

## Deferred (tracked)

- **Maintenance-notes as a first-class hub report type** (so the standalone `/maintenance` log joins the hub + becomes searchable) — a data-modeling decision, its own cycle.
- **Unified cross-surface search** (beyond hub reports).
- **Postgres full-text** (tsvector/migration) — only if in-memory volume ever bites.
