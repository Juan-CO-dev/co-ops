# Chunk 5 Swap vendor implementation notes

Part B only. New files: `components/catalog/jobs/SwapVendorJob.tsx`, `lib/catalog/swap-job-shared.ts`, `app/admin/catalog/sku/[id]/swap/page.tsx`, `tests/catalog-swap-job.test.ts`, `tests/catalog-swap-job-ui.test.ts`, `tests/catalog-swap-job-client.test.ts`. No pre-existing assertions were changed by this subtask. Parent owns shared en/es dictionaries, tier-map, shop-context inventory, return-context integration and the final RESULT.

The page reauthorizes through `loadSwapVendorJobView`, reads the canonical location parameter, validates the requested replacement against eligible returned options, and keys the client by SKU, authorized scope and replacement. Global scope offers permanent swaps only. The client sends the server-normalized preview request unchanged plus previewToken, blocks refused lines, prevents duplicate pending calls, invalidates previews on edit/navigation/unmount, checks identity after step-up, and requires a fresh preview after a refusal. A lost/malformed write response shows an uncertain result and directs the operator to reopen the item; it never automatically writes again. Success stays visible without a refresh. Preview renders changed/refused lines, conversion quantities, primary followers, untouched shops, product grouping, every sandwich cost before/after and the ordering/par disclosure.

## New assertions (all additive)

- Pure review: exact normalized confirmation payload/token and saved identity; preview cleared after write; delayed preview rejected after invalidation/newer read; canceled unlock has zero writes; scope invalidation during unlock has zero writes; stale refusal clears preview and blocks another confirmation until a new preview; refused lines cannot write; malformed success and transport loss are uncertain.
- EN/ES render (each locale): every consequence is visible (recipe, refused recipe, primary follower, untouched shop, quantities, cost before/after, grouping); no untranslated keys; wrap-safe consequence container; global mode excludes temporary and includes permanent; add-item URL preserves global scope and original SKU; all button/input/select controls have 44px minimum; single-column layout; shop mode offers temporary/permanent and no unauthorized global option; an owned source offers its owner scope only, never another shop or global, in both languages.
- Actual client handlers: normalized preview followed by one Tier E write despite duplicate click; exact posted request/token; edit removes confirmation; delayed preview after scope navigation cannot restore confirmation; stale step-up forgets authorization and clears preview without retry; canceled password keeps review and sends no write.

## Verification

Failing first: each of `tests/catalog-swap-job.test.ts` and `tests/catalog-swap-job-ui.test.ts` failed before implementation with its missing new module, exit 1 (19:20:07 and 19:22:21). Interaction tests add coverage of the implemented handlers.

`npx.cmd vitest run tests/catalog-swap-job.test.ts tests/catalog-swap-job-ui.test.ts tests/catalog-swap-job-client.test.ts --pool=threads --no-cache --maxWorkers=3 --testTimeout=60000`: PASS, 3 files / 15 tests initially (19:34:41); final PASS 3 files / 17 tests, exit 0 (19:38:38), after the owned-scope review fix.

Initial ESLint invocation ran before the pending new page write completed and refused the missing path. Rerun over all six files returned exit 0 with one new accessibility label warning. Explicit translated aria-labels were then added; final ESLint over all six files PASS, exit 0, zero errors and zero warnings (app page glob `app/admin/catalog/sku/**/swap/page.tsx`).

Read back the new source files after writing. `git diff --check`: exit 0 (line-ending conversion warnings only). The Next 16 local page.md guide was read before page authoring. Bracket-path apply_patch stalled; stopped that pending cell and wrote/read the same page using a literal absolute filesystem path. No migration/equivalence files, commits, push, merge, DB or env access.

Open evidence: no real-browser 375px viewport walk in this subtask; render tests prove class/control contracts, not measured browser geometry. Parent owns full-suite/typegen/tsc and final cross-family review handoff. Worktree `C:\Users\conta\co-ops-cat-p4b`, branch `feat/catalog-phase4b-job-pages`; changes remain uncommitted.

Parent review found that actor-authorized scope options included scopes in which an owned source is invisible. Added EN/ES render assertions first: 2 failed / 6 passed (19:37:46), then filtered only the UI choices using jobs.owner.ownerLocationId. Shared source options stay unchanged. Final three focused suites: 17 passed. Final six-file ESLint: exit 0, no output, zero errors/warnings. Existing render/client fixture metadata gained the required shared owner object; no old assertion changed.
