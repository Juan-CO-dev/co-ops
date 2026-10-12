# Pulse / digest accuracy — plan review

Reviewer: Astra (GPT), reviewing the supplied Opus audit/plan against this checkout before coding.
Branch: `fix/reports-pulsefix`. No production data was accessed; cited audit amounts are not independently reverified.

| Item | Verdict | Code evidence and implementation decision |
| --- | --- | --- |
| 1. Capture-aligned pace | CHANGE | `sections.ts` uses request-clock hour; `baseline-shared.ts` includes that entire hour. `0242_pulse_sales_reads.sql` returns only `hours` plus `captured_days`. Its upstream `0232` fact reader exposes **order** `o.opened_at`, not a check-open timestamp. Use the explicitly permitted hourly fallback: prorate only the cutoff hour by elapsed minutes, using `today.capturedAt` (latest completed run's `finished_at`), never request-clock minutes. Keep historical full-hour curve points; replace the comparison point with the partial-hour baseline and today's headline cents. Hide the comparison and chart for missing/invalid/future or >20-minute-old captures. No migration required; approximation remains a stated limitation. |
| 2. Digest ezCater exclusion | CHANGE | `loadSales` calls `loadCapturedToastDay` and `summarizeSalesDay`; both headline and details currently count linked checks. `sales_report_class` in 0232 excludes linked checks after void/excess/gift-card classification. The fact/class helpers deliberately have **no service-role EXECUTE grant**; the public aggregate reads do not supply the digest's order/check/selection void counts. Preserve that contract rather than replacing correct detail numbers: read `ezcater_current_toast_links`, scoped by location + business date and paged, mark checks by `(toast_snapshot_id, check_guid)`, and exclude them in both shared reducers. This reuses the canonical link view, not a second linking heuristic. Split orders retain their unlinked checks. D and D−7 take the same path. |
| 3. Open labor | AGREE | `labor-shared.ts` excludes open shifts from `totalHours` but `splhPartial` tests only unknown closed hours. Include today's open-entry count in that gate; preserve hours and overtime semantics. |
| 4. Missing amounts | AGREE | `SalesData` omits `totals.amountMissing`; `SalesSection` only checks capture-day coverage. Carry the count and show the existing translated partial banner when positive. Also withhold pace when its numerator is incomplete. |
| 5. Across-midnight presence | AGREE | The cited query is specifically the **unlinked** clock-in reader at `sections.ts:646`, currently filtered to today and capped at 20. Include yesterday and today, retaining `out_at IS NULL`, shop/deleted/unlinked filters, earliest-entry deduplication and first names only; raise cap to 50. Linked presence already reads station day + calendar day through `whos-here.ts`; leave that independent contract unchanged. |
| 6. Labels | CHANGE | Add the requested Pulse sublabel and register-sales digest label in both languages. `loadCateringNight` values **all** pipeline sources by accepted quote total, else estimated revenue. Label it as pipeline totals with an ezCater fees/tax qualifier; do not relabel all pipeline revenue as ezCater or change its arithmetic. |
| Gates / boundaries | AGREE | Full `npm test`, `npx tsc --noEmit`, changed-file ESLint. No edits to Sales report-owned paths, environment/config, delivery mode, node_modules, or databases. No commits or pushes. |

## Implementation plan

- Touch Pulse baseline helper, section DTO/loader/component, both locale files, captured-check reducer and digest loader/reducer, labor reducer, and focused existing/new tests.
- Contracts: additive `amountMissing` and stale-age DTO fields, optional check-level ezCater marker, capture-aligned pace point. No auth, grant, schema or delivery changes.
- Tests: minute cutoff and hour boundary; 20-minute threshold/stale/missing capture; partial money banner; linked/split check headline and detail exclusion including prior week and loader scope; open labor; previous-day open unlinked clock-ins and 50-entry cap.
- Risks: hourly proration assumes uniform sales within the cutoff hour; completed capture finish time is the plan's proxy for capture cutoff. The unlinked reader remains capped at 50 raw entries. No live parity or browser smoke is claimed.
- Bug-class checks: BC-036 (missing-amount signal reaches its renderer), BC-040 (unknown/stale sources refuse a pace), BC-041 (boundary/split-check fixtures), BC-042 (preserve correct money/void counts), BC-043 (this is the supplied plan's cross-family review, not independent review of my subsequent implementation).

CC's independent implementation review remains a handoff gate; this task ends with uncommitted local work.

## Verification results

```text
npm.cmd test -- --no-cache --maxWorkers 4
448 test files passed; 6996 tests passed, 1 skipped (6997 total); exit 0.

npx.cmd tsc --noEmit --incremental false
Only TS2307 for the missing 'three' module in components/pulse/floor/Floor3D.tsx
(15 references); no other errors. Environmental exception specified by the task.

npx.cmd eslint <all changed .ts/.tsx files> tests/report-digests-sales-loading.test.ts
Exit 0; no warnings or errors.

git diff --check
Exit 0.
```

The first full run encountered three old digest/labor expectations and one unrelated 30-second
migration-test timeout. Expectations were corrected; the migration test passed unchanged on rerun,
then the final full run passed. An initial in-memory config-loader attempt failed before collecting
tests (`__dirname`); the successful runs used the existing default loader with caching disabled.
PowerShell blocks `npm.ps1`, so commands use `npm.cmd` / `npx.cmd`. No config changes were needed.

Regression coverage lives in `pulse-baseline`, `pulse-sales`, `pulse-sales-freshness`, `pulse-sections`,
`report-digests-v2`, `report-digests-v2-compose`, `toast-labor`, `toast-labor-r2`, and the new
`report-digests-sales-loading.test.ts`. The latter verifies both digest days, split checks, snapshot
identity, scoped/paged links, failed-link refusal, and absent capture behavior with fake reads.

All source/test changes remain uncommitted in `C:\Users\conta\co-ops-pulsefix` on
`fix/reports-pulsefix`. No SQL was authored/applied, no env/config or delivery setting changed,
and no protected Sales-report paths were edited. Live parity and browser smoke were not run.
