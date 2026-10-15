# Catalog Phase 4a — Chunk 2 handoff

Approved basis: `2026-10-15-catalog-phase4a-BUILD.md`, Chunk 2, plus Aggie r1 on `99e84a26` and CC's 2026-10-15 fix rulings. Branch `feat/catalog-p4a`; clone `C:\Users\conta\co-ops-astra-p4`; starting HEAD `a62f6061` (chunks 1+2 and chunk-1 fixes committed). This review-fix change set is **uncommitted**. No fetch, rebase, push, merge, deployment or real-database access occurred. The actual 0264 file was executed only in in-memory PGlite. Chunk 3 has not started.

## Delivered

- `supabase/migrations/0264_catalog_shop_owned.sql`: nullable recipe/menu owners; graph-first locking; deferred owner integrity for recipe inputs/outputs, live shop versions, menu overlays, Toast targets/effects/open-item aliases, and later owner moves; private owner-at-insert variant of the actual 0262 full writer; atomic SKU/prep/sandwich creation, owned edit/restore and exact-list sharing. All public RPCs are service-role-only; internal helpers have no service-role EXECUTE. No new tables; existing history grants/RLS remain intact.
- `lib/recipes-shared.ts`, `lib/recipes.ts`, `app/api/admin/recipes/full/route.ts`, `components/admin/recipes/RecipeBuilder.tsx`: exclusive inline prep-output DTO and payload; explicit scope authorization; committed output identities returned alongside the existing HTTP `id`; positional ownership refusals preserved. Inline controls and server-page scope navigation are later-chunk work. Omitted scope retains the existing shared creation path until Chunk 4.
- `tests/shop-owned-migration.test.ts`, `tests/shop-owned-pglite.test.ts`, `tests/recipe-inline-output.test.ts`: actual SQL creation/edit/restore/share/refusal/rollback/privilege proofs, source-preservation and refusal-vocabulary pins, plus library/HTTP contract tests.
- `tests/fixtures/shop-owned-pglite.ts`, `tests/fixtures/recipe-versions-pglite-stub.sql`: actual 0264 application with an explicit pre-migration opt-out; production-backed registry/Toast shapes and recipe-type CHECK. Name-only graph seeds use the same `production` recipe-type default as production (0103).
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
| `share_shop_sku`, `share_shop_item` | `(p_id, p_expected_owner, p_actor)`. Direct produced-item promotion refuses `share_the_recipe`. Ownership is set at creation; supported ownership changes go through the share RPCs, returning the owner to null. Direct null-to-shop and shop-to-other-shop changes are refused for items/SKUs as well as recipes/menu items. |

The private `shop_owned_create_recipe_full` preserves the complete actual 0262 function body except its owner column/value insertion, pinned by a source comparison. Producer uniqueness, global/per-shop cycles, batch-output limits and journal behavior remain in that writer. Owned edit/restore delegates to the existing snapshot/version-CAS writer. Every literal `shop_owned:*` refusal is pinned to `SHOP_OWNED_ERROR_CODES`, including positional `line_other_shop`; no new unregistered codes were introduced. Existing nested `recipe_version:*` and pack/price namespaces retain their existing meanings and must be handled by downstream callers too.

The legacy exception is **read compatibility only**. Existing shared recipe citations remain readable; NEW or changed citation rows cannot use owned items/SKUs or output owned items/menu items. A shared global version cannot introduce owned inputs either. Direct recipe promotion to shared checks all live dependencies and outputs at commit; the share RPC releases the approved dependencies atomically first. A metadata-only name edit does not revalidate the old graph. A recipe edit that journals new version lines does create new citations, so copying a legacy owned ingredient into that new version is refused. Owned recipes and shared **shop versions** enforce their shop boundary. Chunk 3's projection rule is unchanged.

0264 changes whole-row dependency snapshots. Real before/after migration tests prove old recipe/menu previews refuse `dependencies_changed` without writes; a new preview succeeds. Do not replace a submitted baseline automatically.

## Original chunk-2 verification (historical, before r1 fixes)

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

## Aggie r1 review fix packet (2026-10-15)

Review: **CHANGES REQUESTED**, `99e84a26`, one P1, five P2, eight P3. CC's supplied rulings resolve the policy questions; this change set implements only that packet. The review's dirty-tree caveat is historical: this pass started with a clean tree at `a62f6061`, with chunk-1 fixes committed. No reviewer result is presented as approval of this new diff; CC still owns cross-family review and release.

Implementation plan followed: narrow 0264's statement locks and deferred row checks; enforce immutable initial ownership and new-citation validation while preserving existing reads; map remaining reachable database refusals at the existing library/route error boundaries; complete bilingual refusal keys; add actual-migration PGlite probes and route/i18n pins; run both SQL harnesses, all shop-owned tests, the two additional Chunk-3 store-loader reds, and TypeScript. Risks: deferred final-state checks must preserve atomic sharing, automatic journals create new citations, and one-connection PGlite cannot prove two-session contention.

| Finding | Full finding and resolution |
| --- | --- |
| **P1-1 — done** | Unconditional triggers took the global graph lock on every write across 12 tables, including receiving's weight fold, and could turn that operational refinement into `dependencies_busy`/500. Both lock and integrity triggers now name only ownership/citation columns. Entity INSERT/DELETE remain; citing-table INSERT remains. `active` is retained where it changes effective citation membership (recipes, versions, overlays, Toast); prices, names, weights, quantities and provenance are excluded from these ownership triggers. Integrity returns immediately if those named columns are unchanged; an entity's unchanged owner does not scan recipe dependents. The exact receiving UPDATE is exercised with zero advisory locks and an instrumented integrity function proving zero calls. Existing 0262 journaling is untouched. |
| **P2-1 — done** | The owner guard covered only recipes/menu items. Added items and vendor_items: null-to-shop and shop-to-other-shop updates refuse `owner_is_set_at_creation`, including unreferenced SKUs. Ownership is set at creation; supported subsequent ownership changes are RPC-only sharing to null, with dependency checks. The old test ratifying a direct SKU move now asserts refusal. |
| **P2-2 — done** | The legacy exception previously admitted NEW global item/SKU inputs, item outputs, and direct recipe promotion with owned dependencies. New/changed citation rows now refuse `uses_shop_only_item`, `uses_other_shop_sku`, or `global_recipe_makes_shop_item`; items and menu items both count as owned outputs. Global version lines have the same ceiling. Direct recipe promotion checks all live inputs/outputs; coordinated share RPCs still succeed on their final state. Existing rows remain readable until their citations are touched; a quantity edit can create NEW journal lines and therefore refuse. Chunk 3 projections are unchanged. |
| **P2-3 — done** | “Existing rows remain shared” was false for pre-existing item/SKU ownership. Corrected the migration header and handoff: it applies only to recipes/menu items. CC's supplied production evidence is recorded below; no mass backfill or validation was introduced. |
| **P2-4 — tracked, no 0264 change** | The review questioned item/SKU client RLS and grants. CC confirmed item deny-write policies and an existing vendor_items client-write hole. Per lead ruling, the separate security track owns that hole; 0264 does not alter these grants/policies. New RPC/internal EXECUTE ceilings remain tested. Release must carry this dependency, not claim that 0264 repairs the existing vendor_items exposure. |
| **P2-5 — done** | Ownership refusals could escape as 500 from template, SKU, and Toast writes. `lib/catalog/write-errors-shared.ts` parses the closed ownership vocabulary, maps `recipe_version:dependencies_busy` to 409, and returns each caller's existing typed domain error. Template content/promotion/default/registry writes, SKU creation/update, and Toast insert/active-update paths use it. A shared mapper test explicitly lists the routes and pins their error catches. Unknown/malformed tokens remain server failures. Recipe full creation preserves its positional `ShopOwnedError` payload. |
| **P3-1 — done** | Most catalog refusal translations were absent and recipe UI looked only in `recipes.error.*`. Every current `SHOP_OWNED_ERROR_CODES` entry (31) now has `catalog.error.<code>` in en/es; recipe resolution uses that namespace for ownership codes. The parity test iterates the actual vocabulary and checks both dictionaries and the resolver. |
| **P3-2 — deferred by ruling** | The route already returns `{line:{position,reason}}`, but RecipeBuilder consumes only `result.code`. Rendering the positional diagnostic remains Chunk 4/7; no line UI was started here. |
| **P3-3 — done** | A nonexistent component could leak a raw 23503 FK failure as 500. The catalog write mapper returns named 400 `invalid_component`; the full-recipe HTTP test proves the response without exposing constraint details. |
| **P3-4 — done** | SQL allowed null-scope inline `new_item` even though the library refused it. `create_shop_recipe` now refuses `location_required` before inserting that item; rollback is tested. |
| **P3-5 — done** | An owned item could be `is_default`. The deferred integrity guard rejects owned/default final state with `invalid_payload` on INSERT or relevant UPDATE. No retroactive production data scan is added. |
| **P3-6 — done** | Owned edit used `FOR UPDATE` on recipes contrary to Phase-3 lock law. It now uses `FOR NO KEY UPDATE`; recipe sharing's target lock is aligned as well. Graph-first ordering remains. |
| **P3-7 — done** | The stub wrongly described the recipe type default as fixture-only. Corrected both its comment and this handoff: migration 0103 gives production the same `production` default. The CHECK and three harness payload corrections remain valid. |
| **P3-8 — done** | The previous 16-argument legacy probe failed CAS (`line_changed`) before ownership. The new test passes the actual persisted expected fields to that exact overload, repoints an owned recipe to a foreign SKU, and asserts `line_other_shop:1` plus unchanged state. The overload remains present; no 0266 work was started. |

### Production evidence supplied by CC (read-only, 2026-10-15)

- `items`: RLS enabled; `no_user` INSERT/UPDATE/DELETE policies; no SELECT policy. This packet does not supply an item grant enumeration, so none is claimed here.
- `vendor_items`: RLS read floor L3+, INSERT/UPDATE floor L6+ for `authenticated`; anon and authenticated hold full table grants. This is a pre-existing security-track issue, explicitly excluded from 0264 by the lead.
- **86** items have non-null `location_id`; **all 86 are inactive**; **none is cited by a recipe input or output**. **0** vendor_items have non-null `location_id`.
- These are supplied release facts, not queries run by Astra. They do not claim a separately measured shop-version-line cross-shop count. CC's final release evidence still owns that count and real-session contention checks.

### Other review observations retained

The review confirmed nullable recipe/menu owners and existing item/SKU owner columns, scoped foreign-edge refusals, actual migration execution, rollback, source-body fidelity to 0262, service-only RPCs and internal privilege revokes, stale-preview CAS preservation, scope gates before I/O, explicit null versus omitted scope, and committed inline output IDs. Those protections remain. Explicit global null still uses the legacy writer and derives output identities from the request; no stronger provenance is claimed for that path.

The three old harness payload changes are schema corrections (`prep` to `production`, `menu` to `consumer`), not masked failures. The fixture's real CHECK remains enabled. Deferred checks continue to judge atomic sharing's final state. The 16-argument overload remains until the separately gated 0266 deployment/drain step.

Concurrency observations remain bounded: graph lock then target then NOWAIT dependency locking is retained; two-session `dependencies_busy` behavior is a later CC gate, not proved by PGlite. Line validation still precedes output validation when both are invalid (deterministic `line_other_shop` precedence). Vendor-number serialization covers cooperating job RPCs only; legacy SKU create/edit/import writers do not take its number lock, and cross-path uniqueness remains 4b work. Narrowed triggers remove the receiving serialization/failure surface; they do not make claims about unrelated legacy locks or live database performance.

P2-5's final reachability sweep also found legacy recipe create/edit/input/output/removal and recipe-version/menu-setting writers with plain-Error fallbacks. They now use the same mapper, with their existing route-domain classes and positional metadata preserved. This is refusal mapping only: no owner authorization, reader, navigation, or later-chunk behavior was added.

## Review-fix verification (final, 2026-10-15)

```powershell
node scripts/sql-harness-0262.mjs
node scripts/sql-harness-0263.mjs
$shopTests = @(Get-ChildItem tests/shop-owned-*.test.ts | ForEach-Object { $_.FullName })
npx.cmd vitest run --pool=threads --no-cache --maxWorkers=2 @shopTests tests/recipe-inline-output.test.ts tests/products-store-loader.test.ts tests/admin-sku-write-contracts.test.ts tests/templates-propagation-guard.test.ts tests/recipe-versions-permissions.test.ts tests/menu-item-shop-permissions.test.ts tests/recipe-input-write-atomic.test.ts tests/recipe-input-remove-locked.test.ts
npx.cmd tsc --noEmit
git diff --check
```

```text
0262 SQL harness: PASS, exit 0
0263 SQL harness: PASS, exit 0
Vitest: Test Files 2 failed | 14 passed (16)
        Tests      8 failed | 297 passed (305)
        Duration   25.73s; exit 1 (the eight intentional CHUNK 3 reds only)
TypeScript: exit 0, no diagnostics
git diff --check: exit 0
```

Intentional **CHUNK 3** failures, unchanged and not skipped:

1. `tests/shop-owned-equivalence.test.ts`: graph excludes foreign-owned outputs at global, shop A, shop B (3).
2. Same file: single/batch line readers exclude foreign recipes at those scopes (3).
3. `tests/products-store-loader.test.ts`: exclude foreign regular members with retired supplier (1); store-copy global exception must not admit ordinary owned members (1).

No other final-run failures. This run includes every shop-owned test, the 0264 source pins, actual 0264 PGlite regression probes, bilingual parity, mapper route coverage, and adjacent changed-writer tests. Log: `%TEMP%/catalog-p4a-chunk2-r1-final.log`. The full repository suite was not rerun; the earlier full-suite output above is historical. Single-connection PGlite does not prove independent-session contention, and the separate security-track issue remains open.

Files changed by this review-fix set (UTF-8, LF; all uncommitted):

```text
supabase/migrations/0264_catalog_shop_owned.sql
lib/catalog/write-errors-shared.ts
lib/admin/templates.ts
lib/admin/skus.ts
lib/admin/toast-map.ts
lib/admin/recipe-versions.ts
lib/admin/menu-item-shop.ts
lib/recipes.ts
components/admin/recipes/shared.ts
lib/i18n/en.json
lib/i18n/es.json
tests/fixtures/recipe-versions-pglite-stub.sql
tests/shop-owned-migration.test.ts
tests/shop-owned-pglite.test.ts
tests/shop-owned-review-pglite.test.ts
tests/shop-owned-write-errors.test.ts
tests/shop-owned-i18n.test.ts
tests/recipe-inline-output.test.ts
docs/superpowers/plans/2026-10-15-catalog-phase4a-chunk2-handoff.md
```

Branch/worktree: `feat/catalog-p4a`, `C:\Users\conta\co-ops-astra-p4`, HEAD remains `a62f6061`. Nothing staged, committed, fetched, pushed, merged, deployed, or applied to a real database.
