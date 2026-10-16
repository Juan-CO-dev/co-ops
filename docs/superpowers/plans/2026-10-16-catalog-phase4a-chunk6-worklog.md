# Chunk 6 implementation worklog

Authorized against approved BUILD.md Chunk 6 and lead dispatch on clean feat/catalog-p4a at d2f05430. Changes remain uncommitted; migrations are file-only and exercised only in PGlite.

Plan: first separate chunk-5 review fixes (new-item replay key, helper privilege pin, release/handoff notes). Then 0265 journal and transactional writers; pure swap parsing/conversion; shared product-resolver proposal and graph plumbing; server preview/start/Back engine; refusal translations and tests. Contracts: mandatory product snapshot even with no recipes, before and after primary identity/revision, both default and scoped primary presence, exact saved recipe contents, retained-edit outcomes. Tests: TDD focused tests, SQL harnesses 0262/0263, 0264 group, full suite maxWorkers=3, tsc without incremental.

Risks: existing non-graph product writers require NOWAIT when graph-first writers acquire their rows; real multi-session concurrency belongs to chunk 8. New guided form pages remain 4b; chunk 7 owns route bindings.

Root red/green: swap-shared missing module and proposal resolver assertion failed before implementation; 12 tests passed afterward. Proposed foreign membership stays ineligible through the existing resolver, and the preview changes no persisted membership.


Integration checks (author-side, not independent review): BC-001/004 role and scope checks run before IO; BC-006/010 new list reads page; BC-007/037 primary revision and locked before-state comparison; BC-018/051 every SQL swap refusal is pinned to the closed translated list; BC-023/056 journal table and RPC ceilings; BC-030 actual migrations and production resolver tested through PGlite transport; BC-031 zero-recipe snapshots and primary follower composition; BC-038 migrations remain file-only; BC-061 snapshot completeness covers replacement pack/price and eligibility evidence. CC's cross-family review remains a later gate.

Two implementation details are explicit additions to the approved contracts: immutable sku_swaps start rows plus sku_swap_ends outcome rows (no mutable active flag), and an explicit draftProduct proposal in the existing product loader for new-group eligibility. The draft cannot shadow a persisted product. The resolver refuses a replacement that would fall back to another member (including pending-review/store eligibility). No second resolver is introduced.

Integration repairs covered pack/price evidence without recipes, overlapping swaps, existing-product member detachment, unchanged primary followers, same-SKU primary revisions, and SQL NULL handling when another shop creates a primary during the swap. Such later primary choices retain grouping rather than failing Back or losing the choice.


Final verification: both SQL harnesses passed; focused 0264/new-item group passed 131 tests; final full suite `npx.cmd vitest run --pool=threads --no-cache --maxWorkers=3` passed 655 files / 10,139 tests (1 file / 3 tests skipped), zero failures, native exit 0. Final `npx.cmd tsc --noEmit --incremental false` exit 0, no diagnostics. The final duplicate-product-name regression first failed raw23505, then passed named product_name_taken with unchanged persisted state. Full suite was repeated after that fix. `git diff --check` passed. See the chunk-6 handoff for exact DTOs and remaining release gates.
