# Chunk 7 route contract

All routes live under `/api/admin/catalog`. POST responses are plain objects, never an extra data envelope. Sessions precede jobs. Writes assert Tier E except Toast confirmation (Tier A); preview POSTs and journal GETs require no unlock. No one-shot grant is consumed. Engine gates remain authoritative for role, ownership and scope.

- `jobs/new-item`: normalized NewItemRequest; returns CreatedItem, 201 on creation or 200 on replay. Replay includes translated `message` explaining that the latest changes were not applied. Reset the client request factory only after success; retain it for uncertain outcomes.
- `jobs/new-sandwich` and `/preview`: normalized NewSandwichRequest; returns recipeId/menuItemId (201), or `{preview}`. Parser line failures preserve one-based position and reason.
- `sku/[id]/setup`: `{shopId,step}`; returns SetupResult unchanged. A guide result with lineSaved:null also names catalog.setup.guide_unconfirmed. Unknown outcomes require refresh, never blind retry.
- `sku/[id]/share`, `recipe/[id]/share`, `menu-item/[id]/share`: explicit expectedOwner UUID and previewToken; recipe also requires shareItemIds/shareSkuIds arrays, menu requires shareSkuIds. Each `/preview` accepts an object and returns `{preview}`. Path identity overrides any untrusted body identity.
- `sku/[id]/swap`: normalized SwapRequest with mandatory explicit scope (null permitted only for for_good) plus previewToken; 201 SwapStarted. `/preview` returns `{preview}`. GET requires `?shopId=UUID`, returns `{swaps}`, and delegates to the scoped journal loader.
- `swaps/[swapId]/back-to-normal`: previewToken required, returns back/kept/primary/grouping. `/preview` returns `{preview}`. Actual SQL may retain intervening edits after preview; consume the write result.
- `menu-item/[id]/toast`: POST `{locationId,toastItemGuid,confirmed:true}` returns mapping id. Use the existing Toast choice surface; this route exposes only the confirmed write. Toast is separate from sandwich creation.

Errors retain each engine error class status/code, field where present, and positional line details. Ownership SQL status interpretation remains in shopOwnedErrorFromRpc/RPC_STATUS; routes do not maintain a duplicate table. Raw exception messages are never emitted. Catalog dictionary keys are translated using the fresh session user language.

Chunk 8 owns P3-3: capture a pre-0265 primary-bearing dependency snapshot, apply 0265 in PGlite, assert exact dependencies_changed and successful re-preview. Guided pages, browser layout and creation redirects remain 4b.

## Route verification

The original `tests/catalog-job-routes.test.ts` is preserved from HEAD (5 tests). New HTTP coverage is in `tests/catalog-job-http-routes.test.ts` (99 tests); the tier/grant map has 10 tests. Fifteen POST endpoints have session, role, malformed body, exact tier, and positive delegation coverage. Nine writes assert E (eight) or A (Toast); six previews do not assert a tier. The scoped journal GET is tested separately. Every ownership and swap code is pinned through the HTTP renderer against its exported status map in English and Spanish. Unknown exceptions return 500/generic without raw text.

TDD: six new HTTP tests first failed because the routes were absent; later 113 tests passed. The added invalid_json localization test failed while its dictionary key was pending; the final focused command is `npx.cmd vitest run tests/catalog-job-http-routes.test.ts tests/catalog-job-routes.test.ts tests/step-up-tier-map.test.ts --maxWorkers=3`. Final outcome: 3 files, 114 tests passed, zero failures, exit 0 (99 new HTTP + 5 preserved legacy + 10 tier-map). A pre-final `npx.cmd tsc --noEmit --incremental false` exited 0; parent reruns against the final tree.
