# Catalog Phase 4a chunk 5 work log

Base: `f8079557`, `feat/catalog-p4a`, `C:\Users\conta\co-ops-astra-p4`. User explicitly authorized implementation of the approved BUILD Chunk 5 and the lead's chunk-4 fixes. Changes remain uncommitted; no fetch, push, merge, deployment or real database operation.

## Review-fix checkpoint

Completed before engine implementation. Separate patch: `%TEMP%/catalog-p4a-chunk4-review-fixes.patch` (16 paths, +103/-34). Seven touched suites, 54 tests passed; red and green logs `%TEMP%/p4-review-red.log`, `%TEMP%/p4-review-final.log`. Fixes: create-only SKU owner/share-only UI and lib, scoped SKU disclosure, named malformed recipe payload refusal, catering namespace, BUILD/handoff corrections. The old handoff now states 90 paths and zero new diagnostics with six baseline clean-checkout Leaflet errors.

## Implementation plan and confirmed contracts

The approved plan's four tasks are implemented across `new-item{,-shared}.ts`, `new-sandwich{,-shared}.ts`, `share.ts`, existing Toast mapping and common recipe graph modules. Read the real 0264 RPCs, existing writers/resolvers, ownership gates, preview/error/audit patterns and PGlite fixtures before authoring. Guided pages and routes remain later chunks/4b.

- New item: strict pure parser, existing ownership gate, atomic real `create_catalog_sku`; return committed identity before independent setup. Setup delegates to existing writers and records individual successes/refusals, including each order day.
- Sandwich: one normalized request for preview and create; explicit synthetic graph drafts without revealing hidden existing recipes; existing graph/price/cost machinery; atomic recipe/menu creation. Toast choices and confirmed mapping are a separate act, with existing Tier A retained.
- Sharing: all-scope SKU impact reader, actual owned default recipe lines, dependency/producer disclosure, fresh authorization and preview recomputation, then lock-bound SQL validation and existing share writers. Reuse closed update audit actions with explicit share metadata.
- Tests: red before implementation, focused unit and real PGlite engine integration; run both existing SQL harnesses, 0264 suites, full suite with three workers and nonincremental typecheck. No golden changes or skipped failures.

## Consumer-driven SQL adjustments

The draft's guessed new-item RPC parameters/return shape differ from the actual implementation. Use the real camelCase SKU payload, `{levels,note}` pack, optional SQL price payload, and `{id}` result. The new job itself requires its first price and pack. Preserve omission versus explicit global scope.

Two bounded additions to file-only 0264 are necessary for the approved engines: persist/validate `avgOzPerEach` atomically (the original RPC ignored it), and a share snapshot/dispatch wrapper. The latter preserves the existing share RPCs and checks the exact snapshot after graph, target and existing recipe dependency locks; owner/SKU/item arrays alone cannot detect a new sandwich producer or changed line quantities between preview and write. New helper execution ceilings are explicitly revoked; only snapshot and dispatch are service-role entry points. These are deviations from the plan's anticipated "0264 consumers only", with executable coverage; no new migration number or real DB application.

## Release notes retained

Owned-recipe authorization is lib-side by design; service-role SQL binds ownership and graph integrity. Org-wide graph/cost loads remain bounded by shop count with latency unmeasured. Browser 375px and real-session concurrency verification remain lead/Chunk 8 work; PGlite proves serial outcomes, not multiple Postgres sessions. Final cross-family review belongs to CC.

## Final verification

Both SQL harnesses passed with native exit 0. Combined touched/0264 group: 16 files, 134 tests passed; final new-item group: 49 passed; sandwich/graph/Toast group: 54 passed. These overlap the full suite, not additive totals.

First full run found three suites with stale source expectations / LF delimiters; the follow-up 28 tests passed after updating those pins and normalizing the catering source's line endings. The settled-tree full run (`npx.cmd vitest run --pool=threads --no-cache --maxWorkers=3`, default plus JSON reporters) passed: 651 files / 1 skipped, 10,087 tests passed / 3 skipped / zero failures, native exit 0. Nonincremental typecheck passed with no diagnostics, native exit 0; ignored local Next declarations are present, unlike the clean-checkout baseline. `git diff --check` passed. Final handoff records exact logs and release limits.
