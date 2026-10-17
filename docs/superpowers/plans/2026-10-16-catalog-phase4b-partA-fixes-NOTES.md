# Part A workplan and evidence

Implement CC review rulings in NewItemJob, bilingual dictionaries, reset guard, loader/UI/reset/shop-context tests and BUILD flow wording. Extract the actual post-create panel for render coverage; add a compact draft summary above Create. Preserve tier counts and independent setup writes. Null/false marker bodies will fail closed as malformed evidence, without falsely claiming catalog quarantine. Test new failures before implementation; probe an injected per-row loader read. Existing chunk-4 code already fixes the two lint errors; verify rather than redo. No migration or equivalence edits. Risks: reload after uncertain create can duplicate (chunk 7 deferral).

## Part A changes

- `components/catalog/jobs/NewItemJob.tsx`: compact seven-field pre-Create summary; production `NewItemCreated` extracted for actual post-create render tests; created status; global Open item uses global; barcode minLength 6 and early save guard.
- `lib/i18n/en.json`, `lib/i18n/es.json`: summary, created, arrives (three matching keys each).
- `scripts/sim/launch-readiness/reset.ts`: null/false/non-object marker bodies remain fail-closed with generic unreadable-evidence refusal, instead of falsely claiming catalog status. Only status catalog-cleanup-failed triggers catalog-specific clearance. This preserves evidence whose malformed body cannot safely authorize reset. Ordinary reset markers and no marker pass this guard; target/lease/prerequisite gates still apply.
- `tests/catalog-jobs-ui.test.ts`, `tests/catalog-jobs-views.test.ts`, `tests/catalog-cleanup-dirty.test.ts`, `tests/shop-context.test.ts`: assertions below.
- `2026-10-16-catalog-phase4b-BUILD.md`: actual single-form field order clarified; all fields still pre-create.
- Both lint errors requested in P3-5 were already repaired in baseline 34500311 (vendor refresh is render-time; helper uses moduleName). No claim of new repairs to either.

## Every changed assertion

No prior assertion was removed or weakened. All added:

1. Loader executes with 1 then 12 recipes and corresponding versions; projected length matches; all shared first overrides have basedOnVersionId; writes remain empty; exact query counts equal [13,13].
2. Reset no-marker and ordinary reset-failed-marker positive controls reach invalid-target validation and marker failure recording, with no DB query. This proves the quarantine guard permits the reset path; it does not claim a full fixture restore in a unit test.
3. Reset null/false cases require generic unreadable-marker message, unchanged bytes, no side effects.
4. en/es pre-create SSR requires translated summary, seven dt fields, summary before Create.
5. en/es real post-create component SSR requires translated CREATED message, global item URL, exactly five setup sections, all five translated headings, 44px buttons/selects/non-checkbox inputs, seven 44px checkbox labels, barcode minLength=6, one-column classes.
6. Shop loader inventory recognizes an aliased NewItem loader, a normal Sandwich loader, and rejects an unrelated import. Audit regex now accepts aliasing and multiple named imports.

## Tests and differential evidence

- Initial `npx` failed before running tests because PowerShell disallows npx.ps1; subsequent commands use npx.cmd.
- Red: `npx.cmd vitest run tests/catalog-jobs-ui.test.ts tests/catalog-cleanup-dirty.test.ts tests/catalog-jobs-views.test.ts --pool=threads --maxWorkers=3 --no-cache`: 6 failed / 54 passed. Failures: missing summary and post-create component (en/es), null/false incorrectly claiming catalog quarantine.
- Green: same command plus `tests/shop-context.test.ts`: 4 files / 205 tests passed. This preceded formatting-only Unicode correction and the parent-owned final barcode TypeScript adjustment; final complete-tree gates belong to parent RESULT.
- Per-row mutation: temporarily inserted a recipe_versions read per recipe into actual loadNewItemJobView; focused test `-t "keeps recipe/version reads constant"` exited 1. Original jobs.ts bytes restored in finally and byte equality confirmed. The Python subprocess output decoder failed on Unicode, so detailed assertion output was unavailable; exit and restore are observed, not fabricated diagnostics.
- Alias differential: temporarily reinstated original restrictive regex; `tests/shop-context.test.ts -t "audits aliased"` exited 1. Bytes restored in finally and equality confirmed. Same subprocess decoder limitation applies.
- Preliminary implementation rerun hit a local Python cp1252 dictionary decoding error; corrected to UTF-8 before the successful 205-test run. Inserted Spanish accents and UI separators then corrected using ASCII-safe escapes.

## Open risks and ownership

Reload after an uncertain item creation loses the client-only request id and can duplicate the item; durable uniqueness/reconciliation beyond cooperating jobs remains BUILD chunk 7 deferral. DOM/SSR checks pin one-column classes and target sizes, not measured browser geometry.

Parent owns subsequent Part B edits to NewItemJob, bilingual dictionaries, and shop-context test; these are shared Part A/B files. No equivalence file, migration, production data, environment file, commit, push, or merge touched. Branch feat/catalog-phase4b-job-pages; clone C:/Users/conta/co-ops-cat-p4b; changes uncommitted.

## Final diff inventory clarification

Read-only audit against HEAD confirms all Part A test assertions are additions: four assertion statements in loader views; six in reset controls (each parameterized twice); four summary and ten post-create assertion statements parameterized en/es (the heading assertion also loops over five steps); three alias-audit assertions. The existing shop-page inventory now calls the alias-safe regex, widening its audited page set rather than removing an assertion. The UI test additionally gained three Part B swap-return assertions, owned by the parent and excluded from the Part A count.

Part A-only files: `scripts/sim/launch-readiness/reset.ts`, `tests/catalog-cleanup-dirty.test.ts`, `tests/catalog-jobs-views.test.ts`, `docs/superpowers/plans/2026-10-16-catalog-phase4b-BUILD.md`, this NOTES file. Shared Part A/B files: `components/catalog/jobs/NewItemJob.tsx`, `lib/i18n/en.json`, `lib/i18n/es.json`, `tests/catalog-jobs-ui.test.ts`, `tests/shop-context.test.ts`.

Verified directly with `git show 34500311:components/catalog/jobs/NewItemJob.tsx`: render-time `if (vendorUnknown && readVersion !== readAtVendorFailure) setVendorUnknown(false)` already exists. Verified `git show 34500311:tests/helpers/catalog-read-boundary.ts`: declaration and uses already read `moduleName`. Neither baseline lint repair is new work in Part A; the helper has no Part A diff.

Part A lint: `npx.cmd eslint components/catalog/jobs/NewItemJob.tsx tests/catalog-jobs-ui.test.ts tests/catalog-jobs-views.test.ts tests/catalog-cleanup-dirty.test.ts tests/shop-context.test.ts scripts/sim/launch-readiness/reset.ts tests/helpers/catalog-read-boundary.ts` exited 0 with zero diagnostics in both runs. The final one-line barcode event adds `uncertain: false`; combined-tree TypeScript verification is recorded by the parent.
