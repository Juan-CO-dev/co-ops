# Chunk 5 review fixes: separate change set

Base: `d2f05430`, branch `feat/catalog-p4a`, worktree `C:\Users\conta\co-ops-astra-p4`. Leave this change set uncommitted; 0264 remains file-only. No fetch, push, merge or real-database execution.

## Release packet

owned-entity creation and share authority is app-layer; SQL binds ownership and graph integrity.

New-item creation is replay-safe. The client supplies one UUID `request_id` per form open and reuses it on every submission, including a lost-response retry. The pure client-safe `newItemFormRequest()` factory creates that identity and attaches it to each request. The guided new-item page is a Phase 4b deliverable: initialize the factory once when opening the form (for example `useState(newItemFormRequest)`), retain it through validation failures and retries, and initialize a new one on a fresh form open. Chunk 7 accepts and preserves the required request identity through the strict parser.

0264 adds nullable `vendor_items.request_id` plus `request_owner_location_id` (the immutable creation owner). A partial unique index uses `NULLS NOT DISTINCT` so global creation also deduplicates. Keeping the creation owner separate prevents share-to-global from moving or colliding replay namespaces. The RPC locks that namespace and returns the existing SKU before creating any row, pack or price. Replays return its current owner and do not append another create audit. Existing SQL callers without a key retain their prior behavior; the new-item application parser requires the key. No multi-session concurrency claim: executable SQL tests use PGlite only.

P3-1: `share.test.ts` now checks `catalog_share_recipe_ids` alongside the two entry points, asserting it is NOT executable even by `service_role`.

## Chunk 7 handoff

- Handle the `generic` post-save outcome explicitly in routes and translated responses. An unknown guide-line outcome preserves `lineSaved:null` and `refreshRequired:true`; never rewrite it to `false` or claim rollback. `new-item.test.ts` already executes and pins this outcome.
- Update both languages of `uses_shop_only_item` to point to the **producing recipe**: standalone owned items share with that recipe. Apply this copy correction in Chunk 7, together with route handling. The current share tests pin the refusal and SQL blocks standalone item sharing.

## Verification

TDD: the initial touched run produced 8 expected failures (missing form identity factory, missing parser/RPC identity contract, duplicate creation/replay). After implementation, 3 files / 66 tests passed. Follow-up coverage includes the database unique index for shop/global scope, immutable creation keys, malformed SQL keys, replay after sharing, and distinct IDs creating distinct SKUs. Final focused run: `npx.cmd vitest run tests/new-item.test.ts tests/new-item-pglite.test.ts tests/share.test.ts tests/shop-owned-migration.test.ts tests/shop-owned-pglite.test.ts tests/shop-owned-review-pglite.test.ts tests/shop-owned-recipe-mutations-pglite.test.ts tests/shop-owned-full-route-pglite.test.ts tests/new-sandwich.test.ts tests/shop-owned-sql-equivalence.test.ts --maxWorkers=3` passed: 10 files / 131 tests, zero failures, exit 0. `git diff --check` passed. Full-suite, SQL harness and typecheck totals belong to the final Chunk 6 handoff.

Files: `lib/catalog/new-item-shared.ts`, `lib/catalog/new-item.ts`, `supabase/migrations/0264_catalog_shop_owned.sql`, `tests/new-item.test.ts`, `tests/new-item-pglite.test.ts`, `tests/share.test.ts`, this note.
