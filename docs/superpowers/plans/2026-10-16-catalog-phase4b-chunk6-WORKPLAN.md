# Catalog 4b chunk 6 workplan

Baseline: `27874144`, `feat/catalog-phase4b-job-pages`. Implementation follows the reviewed BUILD r2 chunk 6 and Aggie's supplied Part A corrections. Leave all work uncommitted.

Part A: replace the two weak assertions with production-path checks, probe the tier check, put explicit owner validation ahead of remembered-shop defaulting, correct chunk 4 evidence and document the keyed Toast teardown invariant.

Part B: expose owned capabilities and immutable owner identity on recipe/menu views; keep owner-shop read/cost/picker scope distinct from null version write scope. Bind owner identity through preview/apply and the existing owner-aware writer. Reuse RecipeBuilder for owned recipe inputs/output/yield and Share, and preserve its legacy ownership controls. Redirect successful creation to the scoped catalog identity. Keep shared 3b paths and all four equivalence files intact.

References checked: BUILD r2; recipe/menu page loaders and preview/apply routes; recipe-item-shared and recipe-preview-shared DTOs; shop-owned-shared gates; recipe-versions writers; legacy detail page; Next installed server/client, route-handler and page guides. No contract mismatch requires a new design ruling. The existing writer accepts owned edits only at null scope, while graph/picker reads need the owner shop; explicit owner binding is needed to prevent a Share racing a save.

Files: Part A's three tests, scope loader, Toast section and chunk 4 RESULT. Part B's recipe/menu loaders and DTOs, recipe version writer, corresponding pages/clients, legacy RecipeBuilder navigation, focused server/route/UI tests, any required bilingual keys and shop-context registration. No migration.

Tests first: owning GM, foreign manager/SMM, shared-default restriction, owner change between preview/save, owner-shop costs/pickers, empty output inventory and reopen journeys. Run focused tests, inventory/read-boundary/shop-context/tier-map and untouched equivalence suites; Next typegen then tsc; changed-file lint against baseline; full suite with requested flags. Verify 375 px en/es layout and document its evidence limits. Every changed assertion and Part A/B file is listed in RESULT.
