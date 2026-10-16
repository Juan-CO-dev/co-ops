# Catalog Phase 4a: chunk 6 review fixes

Scope: approved chunk-6 findings, kept uncommitted before the chunk-7 route work.

- P2-1: repaired all nine Spanish refusal messages. Dictionary writes use explicit UTF-8; non-ASCII in shell-transported Python source uses Unicode escapes. The whole Spanish dictionary rejects question marks between Unicode letters; both complete dictionary files reject U+FFFD. Legitimate inverted-question punctuation remains accepted.
- P3-1: CreatedItem carries replayed (false for ordinary creation, true for replay). catalog.new_item.replayed states that the earlier submit created the item, latest changes were not applied, and the user must open it to edit. Routes/4b must display this notice on replay.
- P3-2: newItemFormRequest is immutable per creation. Keep the same factory for pending/double submits and lost-response retries, including changed fields. After acknowledged success, including replay, replace it by calling newItemFormRequest() before another creation even when the page stays open. The consecutive-create test pins distinct request identities after replacement and stable retries within each factory.
- P3-6: both swap ledger tables deny all seven table privileges to anon/authenticated; service_role UPDATE/DELETE ceilings remain pinned. This is added coverage over correct existing migration SQL.

Chunk-7 copy folded into the same dictionary edit: catalog.swap.ordering_consequence names the new ordering basis and unchanged pars; catalog.setup.guide_unconfirmed names uncertain line saves and refresh-before-retry; uses_shop_only_item points to the producing recipe. Chunk 8 retains P3-3, the pre-0265 snapshot/revision harness scenario.

## Verification

Red command: npx.cmd vitest run tests/new-item.test.ts tests/catalog-item-i18n.test.ts tests/i18n-encoding.test.ts tests/sku-swaps-pglite.test.ts --maxWorkers=3

Result before implementation: 6 failures, 67 passed, 4 files. Failures were the missing replay true/false fields, missing bilingual replay notice (existence/placeholders/text), and corrupted Spanish words. Factory reset and expanded SQL ceilings were newly pinned existing behavior. Initial npx invocation hit PowerShell execution policy; npx.cmd is the working invocation.

Green result: same command after fixes, including the additional chunk-7 semantic-copy test: 4 files / 74 tests passed, 0 failures, exit 0 (60.28 s).

No migration changed or applied; SQL tests use PGlite only. No commit, fetch, push, merge or production access.

Integration follow-up: tests/new-item-pglite.test.ts now asserts replayed:false for original creations and replayed:true with the same identity for retries, including the shared scope and a since-shared owner. Existing SKU/pack/price counts and no-duplicate-audit checks remain intact. Focused vitest: 1 file / 17 tests passed (8.11 s). The surrounding shell command later returned exit 1 from an unrelated rg wildcard path error; vitest itself reported all 17 passed.

Route integration follow-up (coordinated with routes agent): added 15 bilingual catalog.error refusal keys for order-guide setup, barcode teaching, Toast open-item linking and invalid JSON. REQUIRED list pins each key. Red i18n run: 2 failures / 5 passed (missing keys). Green i18n plus whole-file encoding: 2 files / 10 tests passed, exit 0. Existing pack validation keys were verified present under catalog.error; rhythm and Toast-specific keys reuse their existing namespaces through the HTTP helper.
