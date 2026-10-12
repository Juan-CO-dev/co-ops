# Reports hub (non-Sales) — accuracy fixes (Juan 2026-10-11 audit)

An Opus auditor recounted every non-Sales Reports hub surface from prod raw tables. Cash math, date ranges, scoping,
paging and trends buckets are correct. Fix these. Do not touch `lib/sales-reports*.ts`, `components/reports-hub/Sales*`,
`app/(authed)/reports/sales/**`, `lib/pulse/**`, `lib/report-digests*` (parallel builds own them).

## 1. "Last close: Done" for closings the system auto-finalized with nothing done (P1)

`lib/report-summary.ts:~7-9` `reportIsFinalized` + `composeLastClose`. Capitol Hill 10-10 closing is
`auto_finalized` with 0/61 items and the hub tile says "Closing · Done". 33/41 closings since June are auto_finalized.
- Add `LastCloseState` `"auto_closed"` → copy "Auto-closed — not confirmed" (en) / "Cerrado automáticamente — sin
  confirmar" (es), warning tone (same as the digest's "Late: finalized by the system, no one confirmed").
- `composeLastClose`: prefer a human-finalized instance; an `auto_finalized` one yields `auto_closed`, never `done`.
- Anywhere else that shows auto_finalized as done/finalized to users in the hub list (status chip), show the same
  "Auto-closed" label. `composeReportSummary.finalized` keeps counting it (it is finalized) — add `autoClosed` count.
- Tests.

## 2. Under/Over par ignores openings and counts AM-prep night counts (P1)

`lib/reports-hub.ts:~1430-1460`, `lib/reports-trends.ts:~329-339` read only `prep_data.inputs/snapshot`; openings
store `phase1`/`phase2`, so openings add 0; AM prep "under par" is the evening stock count (expected — it drives
next-morning prep). P Street 09-12..10-11: shows Under 71 (66 AM prep) / Over 33; openings' phase2 had 9 under / 28 over.
- Under/Over par = opening `phase2.over_under_status` (under_prep / over_prep) + mid-day `overUnder`. AM prep no
  longer contributes. Verify the exact JSON keys against real rows in code paths/tests (fixtures) — read the opening
  phase-2 writer to confirm the field names.
- Update the trends copy (`en.json:~3031` + es) to "opening (final check) and mid-day".
- Tests with an opening phase2 fixture and an AM prep fixture (AM prep → 0).

## 3. Team person pages count draft PM evaluations / MVP (P2)

`lib/team-metrics.ts:~532-560` (`pmInLoc`, `mvp`) have no status filter; Capitol Hill 2026-08-10 PM report is `open`
with 4 evals + MVP, visible via /my-performance. Filter to `status in ('submitted','incomplete_confirmed','auto_finalized')`
(use whatever the PM finalized-status constant is in the codebase). Tests.

## 4. "Skipped" mixes never-started reports with items skipped (P3)

`computeChecklistSignalsFromData` + trends completion fold. Count `skipped` only within instances that have ≥1
completion; add `notStarted` (instances with zero completions) to the signal summary and show it as its own chip
"Not started" (en/es) where skipped is shown. Completion % unchanged. Tests.

## 5. Opening items counted twice (P3)

`lib/pm-report.ts:~98-108` (items completed) and `team-metrics.ts:~204-217` (tasks) count completion rows; each opening
item has Phase 1 + Phase 2 rows. Count distinct (instance_id, item_id). Tests.

## 6. Paging sort ties (P3, latent)

Add a unique tiebreaker `.order("id")` after `completed_at` (`team-metrics.ts:~211`), `instance_id`
(`reports-search.ts:~170`, `maintenance.ts:~511`), `pm_report_id` (`team-metrics.ts:~261`) — whatever unique column
the table has. Tests where a fake client asserts ordering args if that pattern exists.

## 7. Range form drops typed dates while a preset is selected (P3)

`components/reports-hub/ReportRangeControls.tsx:~22-27` + `lib/report-range.ts:~23-29`: when From/To are edited, the
preset select switches to "custom" (client) AND the server treats explicit valid from/to as custom when they differ
from the preset's dates. Tests for the parser.

## 8. Detail page doesn't check report type vs URL (P3)

`lib/reports-hub.ts:~1224-1229`: if the template/report type ≠ the URL `[type]`, return not-found. Test.

## 9. Minor

- `CashReportDetail.tsx:~26-29`: negative amount formatting must use the shared cents formatter ("−$1.50"). Test.
- `lib/report-export.ts:~244` written-reports export silently stops at 2,000 rows → refuse with the same 413
  `export_too_large` behavior Sales uses. Test.

## Gates
`npm test`, `npx tsc --noEmit` (local `three` missing-module error is environmental), lint. No SQL migrations expected;
if one is truly needed, author it as AUTHORED NOT YET APPLIED and do not apply.
