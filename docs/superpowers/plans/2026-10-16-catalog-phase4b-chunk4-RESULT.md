# Catalog Phase 4b chunk 4 RESULT

Branch: `feat/catalog-phase4b-job-pages`
Worktree: `C:\Users\conta\co-ops-cat-p4b`
Starting and retained HEAD: `ce3e2e938295308fe169c837ee0a6b733c76c207`
All changes are UNCOMMITTED. No push, merge, deployment, production access or migration. The four equivalence files and their expected values are untouched.

## Delivered

Part A preceded Part B. Toast now requests double-quoted Tier A and is registered in the quote-agnostic tier pin. Candidate and stale mappings do not claim another entity's GUID: this follows `runAutoMatch`'s confirmed-only `takenGuids` and entity-specific `rejectedPairs` in `lib/admin/toast-map.ts:222-229`; `open_item` remains excluded under the shipped manual-map refusal. A refused/uncertain Toast save disables Confirm until a successful refresh and a new explicit confirmation. The jobs delegate to `loadRecipeBuilderScope` with a level-7 parameter and remembered-shop omission behavior; legacy builder defaults remain intact. RESULT whitespace, effect lint and accessible labels are repaired. The requested baseline lint comparison also required cleaning chunk 3's NewItem effect, labels and effect dependencies.

Part B adds the sandwich job and read-only reconciliation. The menu query includes authenticated creator equality, active exact trimmed name and exact owner (`IS NULL` for global). The server accepts age 0 through 600000 ms inclusive and verifies one producing output and an active same-owner recipe. Different/NULL/unknown creators, wrong name/owner, ambiguous/inaccessible relationships and invalid/future/older timestamps do not reconcile. Successful nonmatches retain `name_taken`; read failures remain unconfirmed. The response exposes only `{matched:true,menuItemId}`. `attemptKey` is optional on create and is **correlation only, never replay**; no SQL signature or persistence changed.

The client freezes submitted fields and key, locks before password prompting, clears cost/confirmation immediately on draft edits, and rejects stale cost results through the real request guard. It renders every cost status, with complete-cost-only margin/food-cost percentage. It reuses RecipeLineEditor and its searchable ingredient picker, shows a reviewed summary before Tier E creation, and exposes the catalog link and separate Toast step after acknowledged creation or reconciliation. Unmatched recovery uses the frozen submitted name in `/admin/items?view=catalog&q=`. Catalog search consumes decoded q, tracks q navigation and preserves subsequent typing across unrelated renders. Exact ruled recovery/matched copy ships in English and Spanish.

## Part A files

- `components/catalog/ToastLinkSection.tsx`
- `components/catalog/jobs/NewItemJob.tsx` (baseline lint/accessibility follow-up)
- `lib/catalog/toast-link.ts`
- `lib/admin/recipe-builder-data.ts`
- `lib/catalog/jobs.ts`
- `tests/catalog-toast-link.test.ts`
- `tests/catalog-toast-link-interaction.test.ts`
- `tests/catalog-jobs-views.test.ts`
- `docs/superpowers/plans/2026-10-16-catalog-phase4b-chunk2-RESULT.md`
- `docs/superpowers/plans/2026-10-16-catalog-phase4b-partA-notes.md`
- Shared with Part B: `tests/step-up-tier-map.test.ts` (Toast A and sandwich E entries).

## Part B files

- `app/admin/catalog/new/sandwich/page.tsx`
- `app/api/admin/catalog/jobs/new-sandwich/reconcile/route.ts`
- `components/catalog/jobs/NewSandwichJob.tsx`
- `components/admin/catalog/CatalogClient.tsx`
- `lib/catalog/new-sandwich.ts`
- `lib/catalog/new-sandwich-shared.ts`
- `lib/catalog/sandwich-job-shared.ts`
- `lib/shop-context-shared.ts`
- `lib/i18n/en.json`, `lib/i18n/es.json`
- `AGENTS.md` (planned correlation contract marked implemented)
- `tests/new-sandwich-reconcile.test.ts`
- `tests/new-sandwich-reconcile-http.test.ts`
- `tests/new-sandwich-job-state.test.ts`
- `tests/new-sandwich-job-ui.test.ts`
- `tests/catalog-search-prefill.test.ts`
- `tests/catalog-item-i18n.test.ts`
- `tests/catalog-jobs-i18n.test.ts`
- `tests/catalog-write-origin.test.ts`
- `tests/catalog-read-boundary.test.ts`
- `tests/helpers/catalog-read-boundary.ts`
- `tests/shop-context.test.ts`
- Shared tier file listed above.
- Handoff: this file and `2026-10-16-catalog-phase4b-chunk4-WORKPLAN.md`.

## Every changed assertion

Existing expectation changes are limited to:

1. Origin inventory: route files **39 -> 40**, read-only files **11 -> 12**, exported handlers **41 -> 42**. Mutations remain **28**. Reconcile joins the explicit read-only inventory and receives its existing session/no-origin/no-step-up/read-boundary checks.
2. Client tier map: Toast `['A']` and NewSandwichJob `['E']` are newly expected. Literal extraction recognizes single, double and template literal delimiters; no call-site expectation was removed.
3. i18n REQUIRED inventory adds every `catalog.jobs.sandwich.*` key. Existing language/placeholder/refusal expectations are retained.
4. Shop-context PAGE_ROUTES adds the sandwich page; source audit recognizes `loadNewSandwichJobView` as well as `loadNewItemJobView`. Canonical param expectation is `['location']`.
5. Reader import allowlist adds only `reconcileNewSandwich`; new assertions accept that reader and reject `createNewSandwich` aliased to its name.

All other assertions below are additions; none of the pre-existing assertions or equivalence expectations was removed or relaxed:

- Part A tier tests: all three quote styles extract A; the former unregistered-map assertion was vacuous and is replaced by the chunk 6 follow-up. An actual temporary single-quoted call with its map entry removed failed the repository-wide pin.
- Part A loader tests: foreign candidate/stale/rejected GUIDs remain selectable; stale open-item GUIDs do not. Multi-membership omission resolves remembered shop; jobs' minimum-level parameter refuses AGM.
- Part A interaction test: refusal keeps Confirm disabled, including during refresh; successful refresh plus renewed confirmation enables it. Existing hook/query fixtures gained types and the jobs fixture invokes the real scope helper; assertions stayed unchanged.
- Reconcile helper: exact minimal identity and no writes across repeated reads; other/NULL creator and unknown actor; stale/future/invalid time; exact case/whitespace name mismatch; inactive/foreign-owner menu; inclusive zero/ten-minute age; inactive/foreign-owner recipe; authorization and UUID validation before reads; explicit MoO global scope; DB failure distinct from conflict; literal creator/name/global-owner query predicates; trimmed-input/exact persisted-name behavior (replacing the tautological normalization loop in the chunk 6 follow-up); optional attempt-key compatibility, validation and pass-through. Real PGlite create -> reconciliation -> duplicate RPC `name_taken` -> same reconciled ID proves the collision relationship against the shipped SQL.
- Reconcile HTTP: minimal response/reader arguments, no step-up, level 5/6 and SMM refusals, missing session, malformed JSON/null/array, name_taken409, generic500 without DB detail leakage. Two new assertions initially used `error`; they were corrected to `code` after reading the existing contract (`error` is translated prose). Status/leakage assertions remained.
- Attempt/cost state: pending clears value immediately; old success/refusal cannot replace newer state; current refusal clears cost; submitted name/payload/key remain frozen across retry; deliberate reset invalidates the old attempt; recovery URL encodes submitted name and selects catalog; named refusal differs from transport/JSON/5xx uncertainty.
- Real form handlers: reviewed checkbox and E gate; duplicate pending click sends one create; lost response, name_taken and missing identity reconcile without a second automatic create; matched copy/open link; unmatched frozen recovery link; failed reread stays uncertain; stale step-up forgets unlock; named line refusal preserves draft; cancellation writes nothing; departed scope ignores late creation; editing immediately clears cost and confirmation.
- Catalog search: decoded q populates input and filters actual result elements; absent q is empty; local typing survives unrelated location navigation; changed/removed q updates input/results; Spanish names match.
- Exact i18n assertions pin both ruled sentences in both languages.

## Failing-first evidence

- Part A initial run: **5 failed / 29 passed** (quote extraction, candidate/stale claims, refresh gate). Scope addition on the old helper: **1 failed / 18 passed**. Actual single-quote/missing-map repository probe: **1 failed / 12 passed**, then restored. Final Part A run: **7 files / 69 passed**.
- Reconcile/parser before implementation: **19 failed**. Route/reader allowlist before implementation: **2 files failed**, missing route plus forbidden new reader. Final server group: **5 files / 219 passed**.
- New controller/form tests first failed on missing modules. The first `.tsx` test invocation found no tests because this repository includes `tests/**/*.test.ts`; the test was renamed and the missing-module failure rerun before implementation.
- Catalog prefill before implementation: **2 failed / 1 passed**; afterward **3 passed**.
- Lint/whitespace failures were measured before their fixes. NewItem's inherited effect error and added label/dependency warnings were repaired to meet the requested whole-components baseline.

## Verification

Commands use `npx.cmd` because PowerShell blocks `npx.ps1` before it starts.

```text
npx.cmd vitest run <focused suites below> --pool=threads --no-cache --maxWorkers=3 --testTimeout=60000
26 files / 759 tests PASS

npx.cmd next typegen
PASS: Types generated successfully

npx.cmd tsc --noEmit --incremental false
PASS, exit 0 (final tree; scratch TS excluded by .snapshot suffix)

npx.cmd eslint <every changed/new TS/TSX file> --format json
4 errors / 0 warnings: all four pre-existing CatalogClient errors

npx.cmd eslint components --format json
4db4efd0 baseline: 22 errors / 277 warnings
Final working tree: 22 errors / 277 warnings
Delta: ZERO errors, ZERO warnings

npx.cmd vitest run --pool=threads --no-cache --maxWorkers=3 --testTimeout=60000 --reporter=default --reporter=json --outputFile=.tmp/catalog-chunk4/full-suite-final.json
Reviewed final result: 729 passed / 0 failed / 1 skipped files (730)
12251 passed / 0 failed / 3 skipped tests (12254)
Two host-flaky tsx cases are noted separately below.
```

Focused suites (all under `tests/`, `.test.ts`): catalog-write-origin, catalog-read-boundary, catalog-job-http-routes, catalog-jobs-views, catalog-jobs-builder, catalog-jobs-shared, catalog-jobs-i18n, catalog-jobs-ui, catalog-toast-link, catalog-toast-link-interaction, catalog-toast-link-http, catalog-toast-link-ui, new-sandwich, new-sandwich-reconcile, new-sandwich-reconcile-http, new-sandwich-job-state, new-sandwich-job-ui, catalog-search-prefill, shop-context, step-up-tier-map, shop-owned-equivalence, recipe-versions-equivalence, shop-versions-equivalence, counts-onhand-equivalence, catalog-item-i18n, recipe-builder-page-scope.

Changed-file lint's unchanged CatalogClient errors: two `react-hooks/immutability` (recursive callbacks) and two `react-hooks/refs`; identical errors exist at 4db4efd0. All other changed/new TS/TSX files are lint-clean. The original baseline was measured from an isolated archive with the same installed ESLint/config and app directory, not inferred from review prose.

### Host-flaky tsx ENOMEM subprocess cases (separate from catalog)

Corrected per Aggie's chunk 4 review: **729 passed / 0 failed / 1 skipped files**; **12251 passed / 0 failed / 3 skipped tests**. The earlier report incorrectly presented the two host-flaky cases as residual failures:

- `tests/people-chunkE-review.test.ts:130`: BOH dry-run subprocess.
- `tests/pm-criteria.test.ts:140`: criteria seed dry-run subprocess.

These cases can fail while tsx initializes its temporary-directory module, before the target script starts: `ERR_SYSTEM_ERROR`, `uv_os_get_passwd`, `ENOMEM (-4057)`. They are host-flaky, not failed tests in the corrected final totals. No test or product code was changed to hide them.

### 375 px and whitespace

- Headless Chromium, **375x812**, real initial NewSandwichJob markup with TranslationProvider and compiled app Tailwind CSS, en/es and a long shop name. Network requests aborted. Both document/body widths **375**; all seven measured non-checkbox controls **44 px** high. Screenshots were inspected and refreshed after correcting the initial ingredient heading. This is initial-layout proof, not hydrated authenticated end-to-end coverage.
- `git diff --check 4db4efd0` **PASS**: entire baseline-to-final working-tree change.
- `git diff --check 4db4efd0..HEAD` **FAIL**: the two historical hard breaks in chunk2 RESULT lines 3-4. They are removed in the working tree. An immutable commit range cannot include uncommitted corrections; making that range pass requires CC to commit the supplied fixes. This report does not substitute a clean working-tree-only check for a commit-range check.
- `git diff --name-only -- tests/shop-owned-equivalence.test.ts tests/recipe-versions-equivalence.test.ts tests/shop-versions-equivalence.test.ts tests/counts-onhand-equivalence.test.ts supabase/migrations` is empty.

## Evidence and remaining limits

Raw logs, JSON reports, en/es screenshots and reversible lint-baseline snapshots are under `.tmp/catalog-chunk4/` and are **not for staging**. Snapshot TS files have `.snapshot` suffixes and do not enter compilation. Automatic approval review rejected recursive scratch deletion as `blocked by policy`; retaining renamed snapshots was the safe alternative. The source patch and this handoff are ready for CC's review, with no external approval/merge claim.

Reconciliation remains a same-account/name/time heuristic: shared logins can match one another inside ten minutes. It is not durable replay and does not claim current edited fields were saved. Browser proof is limited to the isolated initial layout. Historical commit-range whitespace and the two host-flaky tsx cases remain explicitly visible above.
