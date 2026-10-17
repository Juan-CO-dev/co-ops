# Chunk 8 work plan

Execute the supplied Aggie corrections, then BUILD r2 verification. Baseline is
92f183c9 on feat/catalog-phase4b-job-pages; main comparison is local origin/main
0ae19e22. No commit, migration, equivalence-pin edit, push, merge or database access.

References checked: RecipeItemClient, OwnedSandwichClient, menu-item-page, the
menu route, sibling MenuItemClient baseline handling, recipe builder scope,
existing UI/owned-menu tests and BUILD r2. Findings match source. The supplied
cross-family review specifies these corrections; no new feature scope is added.

1. Add failing behavioral cases for scoped output navigation, centred owned
   controls, owned settings refusals and own-save baseline continuity. Pin the
   existing owned page client/key branch; that coverage should already pass.
2. Correct the two clients and menu preview gate. Preserve foreign-scope hiding,
   failed-save drafts, immutable external-edit baselines and existing write gates.
3. Keep the owner-ordering test and document that the combined caller is dormant.
4. Run focused/inventory/read-boundary/shop-context/tier-map/equivalence suites,
   typegen then tsc, repository lint against main, build and the full suite.
   Record exact failures, including tsx startup failures separately.
5. Assemble chunk history, drift dispositions, assertion/file ledger and exact
   bilingual SIM and authenticated 375px keyboard steps in chunk8-RESULT.

Risks: asynchronous refresh must not misclassify an own save as external drift;
refusals must occur before snapshot/cost reads without exposing foreign owners.
Live SIM and browser walks remain CC-owned, as explicitly directed.

## Final chunk 7 P3 correction round (0caa224b)

Implement the supplied cross-family review corrections: exact en/es guide labels;
server-derived catalog role capability on CatalogClient/MenuCostingClient with
SKU-list fallback; exact no-query GM creation assertions and mutation probes;
vendor-page-only label lookup degradation with a bilingual quiet note.
No read/write authorization contract changes, migrations or equivalence-pin edits.
Tests first for navigation, guide copy and vendor page failure; keep successful
label behavior and strict loader/API failure behavior. Run focused and named
regression suites, typegen/tsc, repository ESLint delta and full suite. Main risk:
losing the server capability along a client prop chain or masking guide failures
beyond the optional label lookup. Leave changes uncommitted for CC review.
