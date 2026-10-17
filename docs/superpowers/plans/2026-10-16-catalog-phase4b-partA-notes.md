# Catalog 4b Part A implementation notes

Scope: Aggie's six chunk 2 fixes, under the supplied reviewed BUILD and explicit fix instructions. Read the actual Toast component, loader, shipped Toast pool/manual-map rules, builder scope resolver, job loaders and affected tests before edits. No migration or equivalence-pin changes.

## Changes

- `components/catalog/ToastLinkSection.tsx`: double-quoted Tier A request; asynchronous mount read with cancellation; explicit translated select/checkbox labels; refused or uncertain saves require a successful refresh before Confirm can be enabled.
- `tests/step-up-tier-map.test.ts`: recognizes matching single, double and backtick literal delimiters; adds Toast's Tier A map entry.
- `lib/catalog/toast-link.ts`: candidate/stale rows do not claim another entity's GUID. Mirrors `lib/admin/toast-map.ts` `runAutoMatch` confirmed-only `takenGuids` and entity-specific `rejectedPairs`; preserves `manualMap`'s open-item refusal. Confirmed links remain unavailable and are displayed separately.
- `lib/admin/recipe-builder-data.ts`, `lib/catalog/jobs.ts`: delegate job scope to `loadRecipeBuilderScope` with `{ minimumLevel: 7, defaultToShop: true }`. Default callers retain their existing floor and omission behavior. Shop reads paginate so delegation preserves the job loader's truncation defense.
- `docs/superpowers/plans/2026-10-16-catalog-phase4b-chunk2-RESULT.md`: strips hard-break trailing spaces.

## Assertion inventory

No pre-existing assertion was removed or weakened.

- Tier map adds `components/catalog/ToastLinkSection.tsx: ["A"]`.
- New quote cases assert extracted `["A"]` for all three delimiter styles and a nonempty unregistered map.
- New Toast loader cases assert foreign candidate/stale/rejected GUIDs remain choices; stale open-item GUIDs remain unavailable.
- New real-handler interaction case asserts Confirm disabled after refusal, still disabled during refresh, and enabled only after successful refresh plus new confirmation.
- New shared-scope case asserts an omitted multi-membership request uses the remembered shop and the jobs' level-7 parameter refuses an AGM.
- Jobs fixture uses the real shared scope loader while mocking only the catalog loader. Existing pagination, query-count, authorization and projection assertions remain unchanged.
- Test-only hook/query types replace explicit `any`/`Function`; no assertion changes from that lint cleanup.

## Failing-first evidence

- Initial three-file run: **5 failed, 29 passed**. Failures: single/backtick extraction, foreign candidate/stale claims, confirmation after refusal.
- Shared-scope test on old helper: **1 failed, 18 passed**, `location_required` instead of remembered shop.
- Actual repository pin probe after widening extraction: temporarily retained `requestStepUp('A')` and omitted Toast's map entry. **1 failed, 12 passed**, the repo-wide client map assertion names the missing Toast entry. Restored double quotes and map immediately afterward.
- Historical whitespace check `git diff --check 4db4efd0..HEAD`: **fails**, exactly the two reviewed chunk2 hard breaks. With the requested changes uncommitted, immutable historical commits remain unchanged. `git diff --check 4db4efd0`: **passes**, checking the entire cumulative base-to-working-tree diff, not merely the working-tree patch.

## Verification

`npx.cmd vitest run tests/catalog-toast-link.test.ts tests/catalog-toast-link-interaction.test.ts tests/step-up-tier-map.test.ts tests/catalog-jobs-views.test.ts tests/catalog-toast-link-ui.test.ts tests/catalog-jobs-builder.test.ts tests/recipe-builder-page-scope.test.ts --pool=threads --maxWorkers=3`: **7 files, 69 tests passed** after final test-type lint cleanup. Scoped eslint for the eight changed Part A TS/TSX files: **0 errors, 0 warnings**.

Scoped eslint and the overall 4db4efd0 lint delta are recorded in the chunk4 RESULT. The new test files' pre-existing explicit-any/Function lint errors were also removed. PowerShell blocks `npx.ps1`, so commands use `npx.cmd`.

Worktree: `C:\Users\conta\co-ops-cat-p4b`; branch: `feat/catalog-phase4b-job-pages`. Changes uncommitted; no push or merge.

## Full-components lint follow-up

The exact 4db4efd0 snapshot (including app routes so Next's link rule runs) measured 22 errors / 277 warnings. The cumulative branch initially measured 23 errors / 293 warnings after the Toast fix: NewItemJob added one effect error and 16 warnings. Root fixed its synchronous effect error; the remaining Part A lint repair adds translated aria-labels from the existing visible labels (25 wrapped controls plus the weekday checkbox) and completes SetupPanel's effect dependencies without changing its refresh-version guard. No new translation keys or assertion changes.

`npx.cmd eslint components/catalog/jobs/NewItemJob.tsx`: PASS, no diagnostics. `npx.cmd vitest run tests/catalog-jobs-ui.test.ts --pool=threads --maxWorkers=3`: **11 passed**. Final full-components totals are in the chunk4 RESULT and `.tmp/catalog-chunk4/lint-notes.md`.
