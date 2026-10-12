# Sales accuracy plan review — Astra, 2026-10-11

Cross-model review of CC's plan against the checked-out code, before implementation. No database was queried or changed; production timing/data claims remain the supplied audit evidence.

| Item | Verdict | Verified contract and implementation decision |
| --- | --- | --- |
| 1. Heatmap | AGREE | `SalesHeatmap` renders 24 integer headers; both Sales and Pulse reuse it. Add locale-aware short hours/ranges, check-based padded trimming, accessible labels, and en/es copy. Preserve unknown-hour rows and cents. |
| 2. Timeout/concurrency | AGREE | `lib/sales-reports.ts:call` currently maps all RPC failures to unavailable except missing functions. Retry returned statement-timeout errors once after 250 ms; retain other mappings and payload-free logs. Stop `mapBounded` scheduling after a rejection; already-running calls may finish. |
| 3. Names | CHANGE | The three RPC definitions remain in 0232; later accounting migrations change other functions and must remain untouched. `users` has `name`, not `first_name`: extract only its first whitespace-delimited token through an active, shop-bound employee link. Keep per-GUID rows and exact filters/totals, adding `server_online` only for unresolved rows whose checks all use explicit online/app/third_party/delivery channels. AND this evidence across windows; unknown channels are not online evidence. Resolve drill-chip names from authorized loaded rows rather than trusting a URL display name. Add checks `server_ref`. Author a rollback-only equivalence harness, do not execute SQL. |
| 4. Today capture | AGREE | Add a scope-checked optional capture loader; only capture I/O errors become null. Pass the timestamp to the three missing captions. Preserve authorization refusals. Existing summary capture behavior stays unchanged. |
| 5. Export | CHANGE | 0232 `sales_report_check_page` actually refuses limits above 101, not 1000. Raise SQL request cap to 1000 and use 999 data rows plus one lookahead: requesting 1001 would violate the requested bound, while omitting lookahead silently loses subsequent pages. Raise export cap to 25000, preserve 413 refusal, set route maxDuration=120, and rename the pre-tax amount field. |
| 6. Labels | CHANGE | Gift card is an excluded channel display label, not a new sale-check filter channel; add its label without widening `SALES_CHANNELS`. Replace item/modifier max-name selection with most-recent-business-date selection, descending name for ties. Newest-first disjoint windows already support the cross-window label rule; correct the explanatory comment. |

Implementation scope: Sales loaders/shared types, export row/column mapping and route duration, heatmap/i18n helpers and captions, migration 0248, equivalence harness, and regression tests. No money formulas, authorization floors, writes, config, env, or dependency changes.

Verification: full `npm test`, `npx tsc --noEmit`, ESLint on changed TS/TSX files; targeted loader/export/UI/migration tests during implementation. Risks: migration must be applied by CC after sim verification before larger export requests or fallback names work; deployment duration remains platform-dependent. SQL equivalence execution is intentionally deferred by the task's no-SQL instruction.

Bug-class checks emphasized: BC-001/002 (shop binding and first-name-only output), BC-006/010 (pagination caps), BC-008 (hour labels preserve operational bucketing), BC-013 (pre-tax amount semantics), BC-040 (explicit unavailable/refusal behavior). Final CC review remains required before merge; this task leaves all work uncommitted.

Source corrections: the missing non-summary Sales caption is in the `panel` branch near line 82 (not the plan's approximate 365). Name fallback uses `substring(users.name from '\S+')`, which also handles leading tabs/newlines. The item merge keeps the newest window's null label rather than reviving an obsolete name from an older window. CSV retains machine-readable `check_amount_pre_tax`; PDF uses the translated “Check amount (pre-tax)” header via an optional display label.

## Final verification

- `npm.cmd test`: initial run found three task-related assertion/test-fixture failures (fixed) and four unrelated repository-scan timeouts under default concurrency.
- `npm.cmd test -- --maxWorkers=2`: full suite, **450 files passed; 7019 tests passed, 1 skipped (7020)**. Vitest duration 809.52 seconds. PowerShell wrapper returned 1 after emitting a native stderr warning about inaccessible `C:\Users\conta/.config/git/ignore`; Vitest reported no failures. No test configuration was changed.
- `npx.cmd tsc --noEmit`: final run has only 15 TS2307 diagnostics for missing `three` in `components/pulse/floor/Floor3D.tsx` (the explicitly allowed environmental exception). No other diagnostics.
- `npx.cmd eslint` over all changed/new TS/TSX files: exit 0, no diagnostics. Final heatmap/test edit re-linted successfully; focused heatmap suite 6/6 passed.
- `git diff --check`: passed. SQL contract tests are included in the full suite. SQL migration/harness were not executed; no production equivalence result is claimed.

Everything remains uncommitted on `fix/reports-accuracy` in `C:\Users\conta\co-ops-reportsfix`. No env/config/dependency modifications, commits, pushes, merges, or SQL applications.
