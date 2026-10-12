# Reports hub accuracy — Astra plan review

Reviewed the Opus audit plan against the checkout before implementation. No production queries or mutations; persisted shapes verified against writers, migrations and existing fixtures. Production totals quoted in the plan are not independently recounted here.

| Item | Verdict | Evidence and implementation decision |
| --- | --- | --- |
| 1. Auto-closed | AGREE | `report-summary.ts` currently treats auto-finalization as done. Prefer human-finalized candidates, then auto-finalized candidates, then unfinished ones. Add warning copy/state and `autoClosed` summary count; preserve finalized totals. Change the shared hub status label, including list/detail consumers. |
| 2. Under/over | AGREE | Opening writer `save_phase2_item_atomic` (0056 and 0215) writes `phase2.over_under_status` with `under_prep` / `over_prep`; existing `readPhase2Outcome` fixtures confirm it. Mid-day `saveMidDayPhase2Item` / 0064 / 0199 / 0215 writes `overUnder.kind` = `under` / `over` (0061 is the original RPC, before structured deviations). Count these persisted final-check outcomes in both hub and trends, not Phase 1 arithmetic. AM-prep numeric detail remains visible but contributes no deviations. |
| 3. Draft PM feedback | CHANGE | No dedicated exported PM finalized-status constant exists. Use the existing closed three-status vocabulary (`submitted`, `incomplete_confirmed`, `auto_finalized`) for both `pmInLoc` and MVP queries; do not broaden to generic checklist final statuses. |
| 4. Skipped vs not started | CHANGE | Hub currently uses total minus done even for untouched instances. Trends currently exposes completion percent only, not a skipped fold. Add separate skipped/notStarted bucket counts, preserving done/required math exactly. Hub summary/detail chips distinguish instances with no live completions from missing required items on started reports; follow through filter links. |
| 5. Double counting | CHANGE | Actual key is `template_item_id`, not `item_id`. Count distinct instance/item per contributor in wrap-up, roster AND person metrics so the surfaces agree. Two different contributors retain credit for their own work; the same person doing both phases gets one item. Preserve per-row notes, and use the first completion in chronological/id order for task-day attribution. |
| 6. Paging ties | AGREE | Add `id` after the cited completion/evaluation ordering keys. These tables have an `id` primary key. Assert query order in fake-client regressions. |
| 7. Range form | CHANGE | Form is currently a server component and is also used by Sales. Add a client interaction boundary with serializable props. Editing a date selects custom; selecting a preset must omit stale date fields on submission so the server fallback cannot undo that selection. Non-Sales parser honors a valid explicit date pair differing from preset dates, preserving caps and comparison rules. Sales files remain untouched. |
| 8. Detail type | AGREE | Dispatcher selects a loader but both checklist loaders currently accept any template. Validate template `type` + `prep_subtype` after existing location binding in both opening and generic loaders; return null on mismatch. |
| 9a. Cash formatting | CHANGE | Shared `lib/i18n/format.ts:formatCents` is locale-aware and emits `-$1.50` (ASCII minus), rather than the plan's typographic minus. Use that existing contract; do not change the global formatter. Preserve explicit plus signs on positive variance. |
| 9b. Written export | AGREE | Forty 50-row pages currently silently truncate. A remaining cursor on page 40 must throw `ExportError(413, "export_too_large")`; exactly 2,000 with no cursor succeeds. |

## Build plan and checks

Touch the named loaders/components, the shared signal helper, hub filter/summary consumers, en/es dictionaries and focused regression tests. No SQL, env/config, Sales-owned files, pulse or digest files. Required gates: full `npm test`, `npx tsc --noEmit`, ESLint on changed code files. Tests cover persisted outcome shapes, unchanged completion percentages, finalized vs draft feedback, duplicate phase rows, paging order, range precedence, wrong-type detail refusal, cash signs and export cap boundaries.

Risks checked against bug classes BC-001/002/004 (scope/redaction), BC-006/010 (pagination), BC-008 (date attribution), BC-013/026 (different field semantics), BC-016/017/018/051 (consumer and copy coverage), BC-019/030 (writer-grounded fixtures), BC-031/032 (aggregate invariants/read failures), BC-040/042 (cold paths and shared form behavior). No authorization, database write or completion-percentage contract changes. Final cross-family implementation review remains CC's handoff gate; this document is Astra's review of the supplied Opus plan, not an independent review of Astra's implementation.

## Implemented and verified

All nine items implemented. Changed the named report/team/PM/search/maintenance/range/export loaders, shared signal/summary helpers, report landing/operations/trends pages and detail/filter/range components, plus en/es copy. Added five regression files: `reports-hub-accuracy.test.ts`, `reports-team-accuracy.test.ts`, `report-range-form.test.ts`, `report-cash-display.test.ts`, and `report-written-export-cap.test.ts`. Expanded parser tests and updated two existing typed fixtures; corrected an existing `createElement` children-prop lint error in one touched fixture file.

Final gates on `fix/reports-hubfix` in `C:\Users\conta\co-ops-hubfix`:

```text
npm.cmd test -- --pool=threads --maxWorkers=4
  Exit 0. 452 test files passed; 7,011 tests passed, 1 skipped (7,012 total).
  Duration 103.35 seconds. Full suite, no exclusions or changed test timeouts.
npx.cmd tsc --noEmit
  Exit 2 solely for TS2307 missing 'three' in components/pulse/floor/Floor3D.tsx.
  No other errors. This is the environmental exception authorized in the task.
npx.cmd eslint -- <all changed/new .ts and .tsx files>
  0 errors; 11 pre-existing warnings (8 filter-label warnings, 3 unused constants).
git diff --check
  Passed.
```

The default fork-pool run was interrupted after slow execution/failures; the two-worker fork retry reported a worker-termination timeout. The complete two-thread retry also passed (452 files, 7,011 passed / 1 skipped); the four-thread run above confirmed native exit 0 despite an existing Git-ignore permission warning. The migration test implicated in the first attempt passed all 33 tests in isolation. The broader report regression selection passed 89 tests across 11 files, and the final touched reference-render test passed all 12 tests.

Limits: no production recount or preview smoke. A standalone browser smoke attempt could not bundle under the sandbox's module-resolution permissions; range interactions are covered by handler tests and cash output by rendered en/es tests. No SQL, env/config, protected Sales/pulse/digest source changes, commits or pushes. The work is left uncommitted for CC's implementation review.
