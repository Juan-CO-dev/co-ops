# Chunk 7 permission and mapping evidence

- Exported the existing ownership `RPC_STATUS`; no second status table. Exhaustive ownership tests use it for the pure mapper and existing recipe/menu error transports. Swap tests use the existing `SWAP_RPC_STATUS`.
- Existing `catalogWriteError` already bridges ownership errors into `MenuShopError`, including positional line payloads. An initial apparent missing bridge was disproved by tests and source inspection; no redundant production mapper was added.
- Closed-list tests cover every ownership/swap refusal, one-based positions, malformed positions and foreign namespaces. Migration tests pin exact mapped statuses for literal refusals, `output_other_shop`, the dynamic `line_other_shop:%` SQL form, and the existing `product_changed` SQL assertion.
- Location-bind scanner now includes new-item, new-sandwich, sharing and swap engines; detects generic wrapped RPC calls and shared apply delegation. Sandwich creation delegates through the common `prepare` creationScope check. Writer enumeration assertions prevent scanner misses from silently passing.

## Verification

Initial mapper run: 93 failures because RPC_STATUS was not exported. Export-only change made the existing menu transport tests pass (39/39). Initial expanded differential scanner: 275 passed, one failed because the scanner looked for return apply rather than await apply; corrected the scanner to match the actual writer delegation.

```text
npx.cmd vitest run tests/swap-permissions.test.ts tests/menu-item-shop-permissions.test.ts tests/recipe-versions-permissions.test.ts tests/location-bind-differential.test.ts tests/shop-owned-migration.test.ts tests/sku-swaps-migration.test.ts --maxWorkers=3
6 files passed; 279 tests passed; zero failures.
```

All changes uncommitted in C:/Users/conta/co-ops-astra-p4, feat/catalog-p4a. No database or network calls. Full-suite/typecheck evidence belongs to the parent chunk-7 handoff; SQL concurrency and pre-0265 snapshot invalidation remain chunk 8.
