# Catalog Phase 4a — Chunk 1 handoff

Approved basis: `2026-10-15-catalog-phase4a-BUILD.md` at `9ba65d7f` (Aggie round 3). Implementation is limited to Chunk 1. Branch `feat/catalog-p4a`, clone `C:\Users\conta\co-ops-astra-p4`. Changes remain uncommitted for CC's review. No new migration, external database access, route change or page integration.

## Baseline and fixtures

Before implementation, `npx.cmd vitest run --pool=threads --no-cache tests/recipe-versions-equivalence.test.ts tests/shop-versions-equivalence.test.ts tests/counts-onhand-equivalence.test.ts tests/products-store-loader.test.ts` passed: **4 files, 70 tests**. Existing golden files are unchanged.

`shop-owned-equivalence.test.ts` reuses the Phase 3a costing/depletion/menu-board and line-reader goldens. Its two-shop fixture adds disjoint owned SKU → prep recipe/item → sandwich recipe/menu chains, with no foreign-owned edges. Shared depletion stays unchanged. All-scope impact readers remain inclusive. Tests labelled `CHUNK 3` are ordinary failing tests, deliberately neither skipped nor marked expected-failure: the operational reader implementation is later work. The regular foreign-product-member regression now specifies exclusion; global store-copy compatibility has a separate passing assertion.

The legacy fake fixture omits `items.location_id`; its `.is(null)` behavior differs from real SQL. Preserve that historical projection for the existing golden rather than rewrite the golden. New owned items have explicit owners. This is why these goldens do **not** replace the approved real-schema equivalence gate.

`migratedCatalogDb()` runs the committed 0258–0263 files in memory. `migratedShopOwnedDb()` seeds a two-shop shared baseline; it does not invent 0264 columns or apply 0264. The base stub retains real product membership constraints, primary scope uniqueness (including null), metadata and generated IDs. Constraint tests assert named errors and persisted postconditions. Pack/price and menu-overlay tables come from the existing migration chain, not duplicate stubs.

Chunk 2 must apply its real 0264 **only in the authorized in-memory harness**, add owner creation/refusal tests under enabled triggers, and keep invalid foreign-edge scenarios out of ordinary successful writers. Chunk 3 must capture shared resolver outputs before 0264, apply the actual file with triggers enabled, read persisted SQL rows through an adapter into production composition, and compare costing/depletion/ordering/count outputs byte-for-byte. That gate cannot be run in Chunk 1 because 0264 does not exist.

## Pure library contracts delivered

`lib/catalog/shop-owned-shared.ts` is client-safe and performs no I/O.

| Contract | Meaning and caller obligation |
| --- | --- |
| `ShopOwnedActor` | Requires role code, level and memberships. Use the current authenticated role; social-media roles are excluded. |
| `ownerVisible(owner, scope)` | Shared in every scope; owned only at its shop. This is operational visibility, not the authorization rule for an administrative all-shop list. Missing owner is pre-migration compatibility; new loaders must select the column. |
| `creationScope(actor, requested?)` | Explicit null requests global and requires MoO+. Omission infers exactly one distinct membership; zero/multiple memberships return `location_required`, including MoO. Invalid UUID selection returns `invalid_payload`. The library caller must still verify an active shop. |
| `newThingScopeGate` / `ownerWriteCheck` | GM+ own shop, MoO+ any shop/global. Shared default edits remain MoO+. A successful gate does not bind the later mutation: compare the read owner atomically, null-safely. |
| `ownedAwareRecipeGate` | Preserves shared shop-version permissions; a GM's null-scope request returns `ownerCheck: true`, requiring the post-read owner check before any write. |
| `ownedRecipeScopeRefusal` | Owned recipes edit directly at null write scope. Own-shop version request → 409 `shop_owned_edit_here`; foreign scope → 404 `not_found`. |
| `shareGate` | Role-aware MoO+ gate. It does not validate dependencies or authorize arbitrary moves. Existing MoO+ SKU moves remain supported under the approved integrity rules. |
| `linesOwnedElsewhere` | One-based positions for foreign SKU/item components. Ownership maps must cover the complete universe; existence and output-owner equality require separate validation. |
| `SHOP_OWNED_ERROR_CODES` / `ShopOwnedErrorCode` | Closed unprefixed application vocabulary and exhaustive status mapping. Includes `items_changed`, `share_the_recipe`, `output_other_shop`. Swap codes belong to a separate later namespace. |
| `shopOwnedErrorFromRpc` | Parses exact `shop_owned:<code>` or `shop_owned:line_other_shop:<positive position>` once; preserves position/reason. Unknown or malformed messages remain unclassified errors. Server code may enrich line names. |

## Route / SQL / 4b integration obligations

These are approved downstream contracts, **not routes or RPCs implemented by this chunk**:

- Keep owner, direct-write scope (`null` for owned entities) and cost/read scope (owner shop) distinct in DTOs and capabilities. The owner-aware gate never alone authorizes a database write.
- Chunk 2 owns atomic `create_catalog_sku`, `create_shop_recipe`, `create_shop_sandwich`, owned version saves and sharing. Inline prep output is exclusive with existing output ID; its definition and recipe commit or roll back together. Preserve HTTP recipe `{id}` and add committed output-item identities. Do not reassign shared prep items.
- Preserve exact status/code and positional line details in library → route → client handling. Chunk 7 pins actual SQL refusals against the closed list and en/es messages; add new codes explicitly as the real migration is authored. No generic translation fallback counts as coverage.
- Treat `ownership_changed`, `items_changed` and `skus_changed` as 409 conflicts. Retain existing recipe/menu snapshot comparisons: adding ownership columns can stale open previews; refuse and require a fresh review, never auto-retry with a replacement baseline.
- Recipe/menu catalog page editing, post-create navigation, both catalog/legacy reopen UI journeys, and delivered 3b capability/picker/history integration belong to 4b. Re-read the actual 3b delivery commit and `requireGlobalLineWriter`; absent page modules are not a 4a gate.
- Legacy scoped server loaders, scope navigation and keyed draft reset, inline output payloads, owner-bound writers, add-menu-output ownership and their route/library/SQL tests remain 4a obligations. The scope selector must reauthorize and reload; `router.refresh()` alone does not reset drafts.
- Preserve guide `skuId` and ownership metadata through save/create reconciliation; do not submit a filtered shop guide as the full editor state.
- SKU vendor-number serialization will cover cooperating job RPCs only, not legacy/edit/import writers. No claim of database-wide uniqueness. Sharing and output dependencies need atomic integrity checks; temporary swaps never deactivate originals or write pars.
- CC owns final cross-family review and release. No new database deployment is authorized by this handoff.

## Chunk 1 verification

TDD: the pure-rule test initially failed because its module did not exist; after implementation **38 tests passed**. The SQL fixture tests likewise began red on their missing fixture module. Final focused command:

```powershell
npx.cmd vitest run --pool=threads --no-cache tests/shop-owned-shared.test.ts tests/shop-owned-equivalence.test.ts tests/products-store-loader.test.ts tests/shop-owned-fixture.test.ts tests/recipe-versions-equivalence.test.ts tests/shop-versions-equivalence.test.ts tests/counts-onhand-equivalence.test.ts tests/recipe-provenance-writer.test.ts tests/recipe-loader-schema-check.test.ts
```

```text
Test Files  2 failed | 7 passed (9)
Tests       8 failed | 128 passed (136)
```

All eight failures are labelled `CHUNK 3`: graph visibility (3 scopes), single/batch line visibility (3 scopes), and foreign/default ordinary owned product members (2). Actual wrong outputs are owned entities/lines still present and `regular-sku` resolving where null is required. These tests intentionally stay red under the approved chunk boundary; there are no other focused failures. All original shared goldens, store-copy compatibility, pure gates and SQL constraint tests pass.

`npx.cmd tsc --noEmit` completed with exit 0 and no diagnostics. `git diff --check` passed. The unrestricted full-suite command and a retry with `--maxWorkers=2` were both started, then stopped without final counts after heavy load/slow progress. Neither attempt is a full-suite pass. No build, external DB test, new migration, 0264 equivalence proof or cross-family code review was run; those remain downstream/lead gates.

Implementation deviations: only supporting fixture/test and handoff files were added beyond the named file list. The approved real-schema 0264 comparison remains deferred exactly as planned. The regular-member expectation was switched to its intended red contract in Chunk 1 so the upcoming eligibility change is test-first. No golden regeneration, production change, commit, push or merge.
