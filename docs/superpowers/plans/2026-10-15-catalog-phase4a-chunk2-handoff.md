# Catalog Phase 4a — Chunk 2 handoff

Approved basis: `2026-10-15-catalog-phase4a-BUILD.md`, Chunk 2, following Chunk 1 at `5a302b9d`. Branch `feat/catalog-p4a`; clone `C:\Users\conta\co-ops-astra-p4`. All Chunk 2 changes are **uncommitted**. No fetch, rebase, push, merge, deployment or real-database access occurred. The actual 0264 file was executed only in in-memory PGlite.

## Delivered

- `supabase/migrations/0264_catalog_shop_owned.sql`: nullable recipe/menu owners; graph-first locking; deferred owner integrity for recipe inputs/outputs, live shop versions, menu overlays, Toast targets/effects/open-item aliases, and later owner moves; private owner-at-insert variant of the actual 0262 full writer; atomic SKU/prep/sandwich creation, owned edit/restore and exact-list sharing. All public RPCs are service-role-only; internal helpers have no service-role EXECUTE. No new tables; existing history grants/RLS remain intact.
- `lib/recipes-shared.ts`, `lib/recipes.ts`, `app/api/admin/recipes/full/route.ts`, `components/admin/recipes/RecipeBuilder.tsx`: exclusive inline prep-output DTO and payload; explicit scope authorization; committed output identities returned alongside the existing HTTP `id`; positional ownership refusals preserved. Inline controls and server-page scope navigation are later-chunk work. Omitted scope retains the existing shared creation path until Chunk 4.
- `tests/shop-owned-migration.test.ts`, `tests/shop-owned-pglite.test.ts`, `tests/recipe-inline-output.test.ts`: actual SQL creation/edit/restore/share/refusal/rollback/privilege proofs, source-preservation and refusal-vocabulary pins, plus library/HTTP contract tests.
- `tests/fixtures/shop-owned-pglite.ts`, `tests/fixtures/recipe-versions-pglite-stub.sql`: actual 0264 application with an explicit pre-migration opt-out; production-backed registry/Toast shapes and recipe-type CHECK. Existing name-only graph seeds retain a documented fixture-only production-type default; production itself has no default.
- `scripts/sql-harness-0262.mjs`: three existing fixture payloads corrected from invalid `prep`/`menu` types to real `production`/`consumer`. The new CHECK exposed these during the full suite; no production writer was changed for this correction.
- This handoff.

## SQL contracts for following chunks

All signatures below take SQL UUIDs; all JSON recipe fields use the existing snake_case wire shape. App libraries must enforce role/location authority before invoking these service-role RPCs.

| RPC | Arguments and result |
| --- | --- |
| `create_shop_recipe` | `(p_header jsonb, p_inputs jsonb, p_outputs jsonb, p_created_by uuid, p_location_id uuid)` → `{id, output_item_ids}`. Each output has exactly one existing item ID, existing menu ID, or `new_item`. Inline definition: `name`, `name_es`, `section`, `recommended_par`, `recommended_par_unit`, optional `special_instructions`, `special_instructions_es`, `required`, `min_role_level`. Owner is supplied by the authorized scope; new item is non-default and never propagated. Invalid lines/output roll everything back. |
| `save_owned_recipe_version` | `(p_recipe_id, p_expected_owner, p_lines jsonb, p_expected_active_id, p_actor, p_expected_snapshot jsonb, p_restored_from uuid default null, p_note text default null)` → existing 0262 save result. Owner compared under graph/row lock. Null write scope; owner shop is a separate read/cost scope. Restore uses null lines plus the reviewed source identity and actual dependency snapshot; normal six-argument edits remain valid. |
| `create_shop_sandwich` | `(p_menu jsonb, p_header jsonb, p_inputs jsonb, p_actor, p_location_id)` → recipe `{id, output_item_ids}` plus `menu_item_id`. Menu fields: `name`, `name_es`, `section`, `menu_price`, `catering_available`. Forces consumer recipe, yield 1, non-batch. Owned menu cannot be catering. Toast mapping is separate. |
| `create_catalog_sku` | `(p_sku jsonb, p_pack jsonb, p_price jsonb, p_actor, p_location_id)` → `{id}`. SKU fields are camelCase: `name`, optional `vendorId`, `itemNumber`, `skuClass`, `priceBasis`, `notes`. Pack is null or `{levels: <existing pack DTO>, note?}`. Price is null or `{unitPrice, effectiveDate}`. Initial pack and price use existing default-lane writers atomically. |
| `share_shop_recipe` | `(p_id, p_expected_owner, p_actor, p_expected_items uuid[] default '{}', p_expected_skus uuid[] default '{}')`. Requires exact owned output-item and directly pinned owned input-SKU sets; stale lists refuse `items_changed`/`skus_changed`. Shares those sets together. An owned input prep item must be shared through its producer first. Menu-producing recipes refuse `share_the_sandwich`. |
| `share_shop_menu_item` | `(p_id, p_expected_owner, p_actor, p_expected_skus uuid[] default '{}')`. Shares menu and all producing recipes, including inactive recipes, plus the exact named owned SKU dependencies. An inactive producer can then reactivate without resurrecting a mismatched output owner. |
| `share_shop_sku`, `share_shop_item` | `(p_id, p_expected_owner, p_actor)`. Direct produced-item promotion refuses `share_the_recipe`. SKU shop moves remain possible when they do not invalidate active references; MoO authorization belongs to Chunk 4. |

The private `shop_owned_create_recipe_full` preserves the complete actual 0262 function body except its owner column/value insertion, pinned by a source comparison. Producer uniqueness, global/per-shop cycles, batch-output limits and journal behavior remain in that writer. Owned edit/restore delegates to the existing snapshot/version-CAS writer. Every literal `shop_owned:*` refusal is pinned to `SHOP_OWNED_ERROR_CODES`, including positional `line_other_shop`; no new unregistered codes were introduced. Existing nested `recipe_version:*` and pack/price namespaces retain their existing meanings and must be handled by downstream callers too.

Shared defaults retain the design's legacy exception for shop template ingredients/outputs. Owned recipes and shared **shop versions** enforce their shop boundary. New `create_shop_recipe` outputs require exact owner equality, and a shared recipe cannot output an owned menu item. Fixture writers do not manufacture successful foreign edges; invalid states are exercised as refused transactions.

0264 changes whole-row dependency snapshots. Real before/after migration tests prove old recipe/menu previews refuse `dependencies_changed` without writes; a new preview succeeds. Do not replace a submitted baseline automatically.

## Verification

Final focused command (two workers bound local memory):

```powershell
npx.cmd vitest run --pool=threads --no-cache --maxWorkers=2 tests/shop-owned-shared.test.ts tests/shop-owned-migration.test.ts tests/shop-owned-pglite.test.ts tests/shop-owned-fixture.test.ts tests/shop-owned-equivalence.test.ts tests/products-store-loader.test.ts tests/recipe-inline-output.test.ts tests/recipes-batch-mode.test.ts tests/recipes-production-wiring.test.ts tests/audit-flags-cleanup.test.ts tests/recipe-versions-equivalence.test.ts tests/shop-versions-equivalence.test.ts tests/counts-onhand-equivalence.test.ts tests/recipe-provenance-writer.test.ts tests/recipe-loader-schema-check.test.ts tests/recipe-versions-migration.test.ts
```

```text
Test Files  2 failed | 14 passed (16)
Tests       8 failed | 282 passed (290)
Duration    27.50s
```

Only intentionally-red **CHUNK 3** tests fail:

1. `shop-owned-equivalence.test.ts`: graph visibility at global, shop A, shop B (3).
2. Same file: single/batch input-reader visibility at those three scopes (3).
3. `products-store-loader.test.ts`: exclude foreign regular members with retired supplier (1), and keep the global store-copy exception from admitting ordinary owned members (1).

Actual failure: foreign owned recipes/lines remain visible, and foreign ordinary members still resolve where null is expected. These eight expectations and all original shared goldens are unchanged.

The full suite was also completed, before the final harness/restore refinements:

```powershell
npx.cmd vitest run --pool=threads --no-cache --maxWorkers=2
```

```text
Test Files  4 failed | 600 passed | 1 skipped (605)
Tests       10 failed | 9145 passed | 3 skipped (9158)
Duration    327.64s
```

That run's additional failures were:

- `recipe-versions-migration.test.ts`: the 0262 harness used nonexistent recipe types. All three payloads are corrected; the final focused run above executes and passes the complete 40-test file, including its real SQL harness.
- `training-media-local.test.ts`: unrelated existing synthetic file caused `EEXIST` at `writeFileSync(..., {flag: 'wx'})`: `vendor/co-scenes/photos/test-local-7192385c3c0605de55bb9476ce1d90748190ecb32a8eed7f5207b30cf6a1fe89.mp4`. Neither that file nor the test was modified. This full-suite failure remains unresolved; it is not a chunk-2 SQL failure or an intentionally-red CHUNK 3 test.

`npx.cmd tsc --noEmit`: final exit **0**, no diagnostics. `git diff --check`: passed. Logs are in `%TEMP%/catalog-p4a-chunk2-final.log` and `%TEMP%/catalog-p4a-chunk2-full.log`. A full suite was not repeated after the final changes; their touched tests were rerun as shown above.

## Boundaries, deviations and remaining gates

- 0264 stays **authored, not applied**. The exact old 16-argument signature remains present, runtime-pinned. Following the approved plan, its DROP belongs exclusively to `0266_drop_recipe_input_16arg.sql`, after deployment READY and old deployments/requests drain; neither 0265 nor 0266 is authored in this chunk.
- Supporting application payload files were included because Chunk 2 explicitly couples inline output creation to types/library/route/builder. The three harness fixture corrections and source-shaped CHECK were necessary to verify the actual recipe-type contract. Toast effect/alias coverage closes the same owner boundary as direct Toast mappings. No reader sweep, swaps, later creation UI, broad writer authorization sweep or page integration was implemented.
- PGlite overlaps are serialized on one connection. Tests prove normalized cooperating SKU-call results, rollback and both share/edit serial orders. They do **not** establish independent-session lock contention; the real PostgreSQL race/release harness remains CC's later gate. No real database was used for that purpose.
- Vendor-number collision serialization remains limited to cooperating job RPCs. Legacy/edit/import writers have no matching number-uniqueness protocol or database-wide unique constraint.
- Chunk 3 still owes real-schema shared-only resolver equivalence before/after actual 0264, all operational reader isolation and scoped picker loading. Chunk 4 still owes full creation-scope routing/legacy editing UI, owner-bound remaining writers and library/route authorization tests. Later chunks own en/es surface integration and release documentation.
- Cross-family review and release approval remain with CC. No Aggie Chunk 1 findings were pre-empted. All changes are left uncommitted in `C:\Users\conta\co-ops-astra-p4` on `feat/catalog-p4a`.
