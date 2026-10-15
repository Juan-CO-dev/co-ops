# Catalog Phase 4a — Astra build plan

Status: PLAN ONLY, for CC's cross-family review before implementation. No application or database changes are authorized by this document. CC owns the initial-plan review and final gate; production operations, merge and deployment remain with CC/Juan.

Baseline: `feat/catalog-p4a`, worktree `C:\Users\conta\co-ops-astra-p4`, HEAD `7157357ab22914d6304bc4f687e724591249263e`. This is Phase 3a, not production. Phase 3b is being built elsewhere. Its plan describes an integration contract, not files already present here.

## Basis and boundaries

Read the Phase 4a draft, sibling Phase 4b plan, catalog redesign specification, Phase 3a/3b plans, repository rules and relevant source. The bounded read and verification work was split across ownership, readers and swaps; conclusions below replace the draft's assumed anchors. This document is the implementation sequence; the draft remains design detail only where consistent with these corrections. Do not paste its code blocks without checking the target implementation again.

The deliverable is the ownership model plus three job engines: new SKU with initial pack/price, new sandwich with recipe and a separate confirmed Toast mapping, and vendor swap with exact restoration. GM-created SKUs, prep items, prep recipes and sandwiches belong to an authorized shop. Explicit global creation is MoO+. Vendors remain global. Shared things may have shop versions; owned things are edited directly, with their owner bound into the write. Moving between shops requires MoO+.

Shop views include shared and own things only: walk and product rescue, par pass, counts, vendor guide view, recipe graphs and catering pickers. The guide editor stays complete and labels ownership. A shared recipe's shop version may use shared components or that shop's own components; foreign components fail `line_other_shop`. Toast linking keeps Tier A and the Catering Toast tab remains untouched. Temporary swaps never deactivate the original SKU or write pars. Product primaries remain undated.

Migrations: `0264_catalog_shop_owned.sql` and `0265_sku_swaps.sql` apply before merge under the lead's release procedure. `0266` contains only the exact old 16-argument `update_recipe_input_atomic` drop, after the new deployment is READY and old deployments have drained. Verify numbering before authoring; coordinate any collision with CC, including all filename pins. No production action is part of this planning task.

## Verified integration contracts

| Surface | Actual anchor and required adaptation |
| --- | --- |
| Recipe version authorization | `lib/admin/recipe-versions.ts` uses `actor.user.role`, not just a numeric level. Preserve `social_media_mgr` rejection before I/O. Its positional RPC refusal parser must also preserve line position/reason for ownership errors. |
| Recipe input consumers | `lib/prep-consumption.ts` has both single-scope and `loadResolvedRecipeInputsByScope` batch readers. `loadRecipeInputsAcrossScopes` remains inclusive for impact/share validation. |
| Readiness | `lib/admin/readiness-load.ts` has `GraphRows`, `loadGraphBaseRows`, `loadGraphRows`, and a preloaded batch path in `countNotReady`; filtering the single loader alone is insufficient. Reasons are objects such as `{code: 'no_inputs'}`. |
| Additional readiness composition | `lib/sku-data-readiness-load.ts` selects recipe columns separately; `lib/sku-data-readiness.ts` composes graphs in `evaluateWave7Tables`, `graphRecipesFor` and `resolvedInputsFor`. It needs ownership independently of the main graph loader. |
| Graph override semantics | Preserve the explicit `versionLocationId !== undefined` distinction: explicit null chooses default versions. Ownership visibility and version selection are separate. Preview overrides cannot resurrect hidden existing recipes; synthetic draft recipes need an explicit supported path. |
| Phase 3b recipe page | Planned `lib/catalog/recipe-item.ts`, `recipe-item-shared.ts`, and the recipe page are absent here. Its capability object is `can.editShop/editGlobal`; owner, write scope and cost scope must stay separate through preview/apply/history/picker. |
| Phase 3b menu page | Planned server module is `lib/catalog/menu-item-page.ts`; its capability currently describes `editShop`. Add explicit owned editing instead of assuming a generic `canWrite` or a different filename. |
| Prep item registry | `lib/admin/templates.ts:addRegistryItem` always writes `location_id: null`; `loadItemRegistry` reads global only. `lib/admin/items.ts`, registry routes, `AddItemForm`, `ItemsClient` and `ItemRow` need a real ownership path. |
| Guide DTO | `GuideBucketSku.skuId` in `components/admin/vendors/OrderGuidePanel.tsx` is real. Page/GET map SKU id to this field. Save/create reconstruct baseline locally and discard additional metadata; there is no success GET refresh today. |
| Store copies | Existing `tests/products-store-loader.test.ts` explicitly allows store copies at the global default. Preserve that compatibility exception; foreign regular owned members must be excluded at every resolution rung. |
| Product primary HTTP | `POST /api/admin/products/[id]/primary`, body `{locationId, primarySkuId, note?}`, Tier E. There is no guessed PATCH endpoint. |
| Sim session | `Session.login` and `Session.call` exist; `unlockCatalogWindow` does not. Call the step-up POST with `{password, catalogWindow:true}` using injected sim credentials. Results are `{status, code, json, actor}`. |
| Sim lifecycle | Driver initialization requires the F4 lease and server verification. Integrate the suite into `scripts/sim/launch-readiness/run.ts`; `done()` returns a report and success depends on `fails.length === 0`. |
| PGlite | `tests/fixtures/recipe-versions-pglite.ts` reads `recipe-versions-pglite-stub.sql`; it does not contain a literal STUB schema. Extend the existing 0258–0263 chain, including real 0263 overlays. |

## Chunk 1 — Baselines, fixtures and ownership contracts (4 tasks)

1. Pin unchanged shared-only results from Phase 3a, then add owned recipes/menu items/SKUs/items to a two-shop fixture and assert unchanged foreign/default results where ownership is inapplicable. Pin store-copy default compatibility separately from normal owned eligibility.
2. Add `lib/catalog/shop-owned-shared.ts`: pure owner visibility, creation scope, owner-aware authorization, sharing gate and a closed refusal vocabulary. Require role code as well as level. Distinguish omitted scope from explicit null: omitted may infer exactly one authorized membership; several memberships require `location_required`; explicit null from a GM is forbidden, never silently converted to own-shop creation.
3. Extend the existing SQL fixture from real migrations, not guessed table shapes. Reuse 0263 and pack/price tables. Add only missing fields/defaults/constraints needed by the real writers. In particular, preserve product membership's composite FK, `UNIQUE NULLS NOT DISTINCT(product_id, location_id)`, `products_name_lower_uq`, primary metadata and generated IDs.
4. Record the Phase 3b delivery commit before integrating its pages. Re-read its delivered types, previews, history and permissions; adapt to that code. Preserve normalized bilingual menu tokens, captured edit baselines, notice identity, source provenance and ended-source history links. CC reviews any contract deviation before coding that part.

Files: new `tests/shop-owned-shared.test.ts`, `tests/shop-owned-equivalence.test.ts`, `tests/fixtures/shop-owned-pglite.ts`; existing Phase 3 equivalence fixtures/tests, `tests/fixtures/recipe-versions-pglite.ts`, `tests/fixtures/recipe-versions-pglite-stub.sql`, `tests/products-store-loader.test.ts`; new pure module above. Migration execution waits for Chunk 2.

Acceptance: no-owner fixture preserves existing goldens; own/foreign/default matrix is explicit; role-code exclusions and null/omitted distinctions have executable tests. Fixture setup cannot create forbidden foreign-owned lines through a supposedly successful ordinary writer. Test their refusal, or isolate a documented historical-invalid fixture.

## Chunk 2 — Ownership schema and atomic writers (4 tasks)

1. Author 0264: nullable recipe/menu ownership; service-role-only RPCs and deny-all client grants/policies; fixed search paths, explicit revoke from PUBLIC/anon/authenticated, append-only version/history discipline. Existing rows remain shared. Re-emit necessary writers from their actual latest definitions and pin preserved behavior.
2. Enforce ownership under the graph/dependency locks: recipe inputs and outputs, shop versions of shared recipes, prohibition of shop versions/overlays for owned entities, and Toast mappings at the owner's shop. Use deferred validation where recipe/output creation is transactional. Validate referenced owners after locking them; an ownership move must not invalidate active references unnoticed.
3. Implement `save_owned_recipe_version`, `create_shop_recipe`, `create_shop_sandwich`, and `create_catalog_sku`. Owned edits compare expected ownership under lock and return `ownership_changed`. SKU creation serializes vendor/item-number uniqueness and includes first pack and first price atomically. Sandwich creation includes menu item and recipe atomically; Toast mapping is a later confirmed action.
4. Implement sharing RPCs for SKU, recipe and menu item. Validate dependencies and outputs in the same transaction. Produced prep items share with their recipe; direct item promotion returns `share_the_recipe`. Sharing must not bypass graph integrity, concurrent owner edits or existing global uniqueness rules. Retain supported SKU shop moves at MoO+; do not copy the draft's universal never-move assertion into policy.

Files: new `supabase/migrations/0264_catalog_shop_owned.sql`, `tests/shop-owned-migration.test.ts`, `tests/shop-owned-pglite.test.ts`; fixture from Chunk 1. Reference the actual 0262 recipe writers and 0263 menu overlay behavior.

Tests/acceptance: real SQL executes create/edit/share; foreign input/output rejected; own default edits succeed without shop version; client roles cannot execute protected RPCs; invalid initial price/pack rolls back the SKU; duplicate vendor number permits one creation; share vs owned edit has a serializable outcome. Pin each named SQL refusal, including positional `line_other_shop`, `items_changed` and `share_the_recipe`, to its application mapping. No migration is applied here.

## Chunk 3 — All shop readers and consumer visibility (5 tasks)

1. Project recipe ownership once at the common graph/input composition boundary for both single and batch reads. Keep all-scope impact readers inclusive. Preserve explicit-null version selection and filter before resolving overrides. Use owner scope when costing an owned entity from a global administrative list.
2. Update both readiness implementations, including preloaded batch composition and the Wave 7 SKU data-readiness graph. Keep complete-universe relational validation before visibility projection. Filter hidden recipes without manufacturing `no_inputs` errands for them. Retain existing behavior for unrelated template-only items.
3. Apply one eligibility rule throughout product resolution, product rescue, walk, par pass and count-reference lists. Preserve global store-copy eligibility; hide a store copy at other shops. Exclude foreign ordinary owned SKUs at every product fallback rung, including primary/fallback candidates. Update the existing contrary regular-member regression intentionally.
4. Add a wired, validated shop guide read path. Keep editor reads whole; never submit a filtered shop view as the editable guide. Carry owner labels through vendor page, GET and save/create reconciliation. `s.skuId` stays; retain/refresh the ownership map on every baseline replacement, holding busy state until authoritative reconciliation finishes.
5. Filter catering staff and portal pickers at quote/shop scope across à-la-carte items AND menu items, fixed package lines and choice options. Hidden references must not return as a fallback `Item` with zero price. Preserve historic quote display; this change governs available choices. Keep the Catering Toast tab unchanged.

Files: `lib/prep-consumption.ts`, `lib/admin/menu-costing.ts`, `lib/admin/toast-map.ts`, `lib/admin/catalog.ts`, `lib/admin/readiness-load.ts`, `lib/weights.ts`, `lib/sku-data-readiness-load.ts`, `lib/sku-data-readiness.ts`, `lib/counts-read-refs.ts`, `lib/ordering.ts`, `lib/products.ts`, `lib/order-guides.ts`, `lib/order-guides-shared.ts`, `lib/catering/menu.ts`, `lib/portal/menu.ts`; existing vendor page, order-guide GET route and `components/admin/vendors/OrderGuidePanel.tsx`. No additional migration.

Tests: new `tests/shop-owned-scope.test.ts`, `tests/shop-only-visibility.test.ts`; extend `tests/products-store-loader.test.ts`, recipe consumer scope/query-count tests and SKU data-readiness tests. Exercise actual page/GET consumption, not an unused helper. Assert readiness entry existence and inspect `reason.code`; do not use string containment on object arrays or default a missing entry to an empty array.

Acceptance: own shop sees shared+own; foreign shop cannot discover/rescue/count/order hidden objects; global store-copy golden remains; shared-only totals unchanged; both readiness paths agree; all catering picker lanes obey scope; guide editor remains complete after save and stale refresh.

## Chunk 4 — Existing creation and owned-edit surfaces (5 tasks)

1. Thread explicit creation scope through SKU, recipe, full recipe and menu-item libraries/routes. Keep authorization in libraries as well as routes. Bind owner-sensitive SKU and menu-price UPDATEs to the read owner and check affected rows. Menu-price route may admit GM, while the library admits that GM only for the owned item. Keep Tier E there.
2. Complete prep-item creation: registry POST and `addRegistryItem` accept validated ownership; an owned item cannot set `isDefault` or propagate to every shop. Extend registry loading with an explicit shop view while keeping existing global callers' meaning. Provide authorized shop choices to the existing items page/client/form with en/es labels.
3. Complete prep-item definition editing: owner-aware library check plus conditional owner-bound UPDATE and rowcount, before propagation. Registry PATCH and `ItemRow` get a definition-edit capability for owning GM; do not lower all the row's default-management controls. Keep registry Tier B.
4. Integrate owned recipe/menu editing with delivered 3b. Owned default write scope is null, but graph, line eligibility, packs and price reads use the owner. Preserve role-code gates and positional errors. Preserve 3b's MoO-only legacy INPUT mutations (`requireGlobalLineWriter`); header/output/yield/batch permissions remain separately owner-aware. Conditional input/output removal must retain this distinction.
5. Repair existing creation flows needed for usable owned objects: legacy new-recipe picker filters selected shop and resolves its packs; creation routes to the authorized catalog owned page once 3b exists. Existing add-menu-output passes known recipe owner to menu creation instead of inferring from actor membership. Coordinate the corresponding 4b assumptions without implementing guided pages in 4a.

Files: `lib/admin/skus.ts`, `lib/recipes.ts`, `lib/admin/recipe-versions.ts`, `lib/admin/menu-item-shop.ts`, `lib/admin/menu-prices.ts`, `lib/admin/templates.ts`, `lib/admin/items.ts`, `lib/catalog/sku-item.ts`; existing recipe/menu creation routes, menu price route, `app/api/admin/checklist-templates/registry/route.ts`, its `[itemId]` route, `app/admin/items/page.tsx`, items form/client/row, legacy recipe creation page and `RecipeBuilder.tsx`. Phase 3b-dependent files: recipe-item modules/page and `lib/catalog/menu-item-page.ts` plus its page. Translation dictionaries in `lib/i18n`. Migration: uses 0264 only.

Tests: new `tests/shop-owned-permissions.test.ts`, `tests/shop-owned-registry.test.ts`; existing `tests/templates-propagation-guard.test.ts`, `tests/items-line-definition.test.ts`, `tests/step-up-tier-map.test.ts`; delivered 3b preview/apply tests. Test successful writes as well as denied writes; a fake that catches every exception and checks an empty write log proves nothing.

Acceptance: GM creates/edits all four entity kinds at an authorized shop; explicit global GM creation fails; other-shop reads/writes refuse; multi-shop creation requires choice; social media role remains excluded; owner changed between read/write refuses with no mutation. A newly created prep item remains visible in its shop registry and never propagates globally.

## Chunk 5 — New-item, sandwich and sharing engines (4 tasks)

1. Build pure new-item parser and server engine around atomic `create_catalog_sku`. Return committed identity before independent setup steps. Setup uses existing par/order-day/guide/recipe/barcode writers with their own validation and accurately reports each outcome; do not imply one transaction spans them.
2. Build sandwich parser, shop-scoped draft graph preview and atomic creation. Preview and final write use the same normalized request and component rules. Preserve draft-recipe override support without making hidden existing recipes visible. Return the created identities for the later Toast action.
3. Provide shop-scoped Toast link choices and confirmed `manualMap` adapter. Preserve Tier A, existing mapping refusals and explicit ownership validation. Do not combine this external mapping step with the sandwich database transaction or modify the Catering Toast tab.
4. Build share previews and writers. SKU impact uses `loadRecipeInputsAcrossScopes`, not only legacy `recipe_inputs`. Owned recipe impact resolves its actual default live lines. Recompute/validate preview dependencies under write locks; existing preview tokens are stale-state checks, not authorization credentials.

Files (new): `lib/catalog/new-item-shared.ts`, `new-item.ts`, `new-sandwich-shared.ts`, `new-sandwich.ts`, `share.ts`; modify `lib/admin/toast-map.ts`. Tests (new): `tests/new-item.test.ts`, `tests/new-sandwich.test.ts`, `tests/share.test.ts`. Migration: 0264 consumers only.

Acceptance: malformed/foreign input writes nothing; first pack/price failures leave no orphan SKU; sandwich preview matches saved cost; setup partial failures are explicit and retryable through existing contracts; sharing sees shop-version references and cannot publish a recipe with unshared owned dependencies.

## Chunk 6 — Swap journal, preview and exact restoration (5 tasks)

1. Author 0265's service-role-only swap journal and transactional start/end RPCs. Snapshot both recipe dependencies and product state: identities, active/membership state, scoped/default primary presence and relevant values/revisions. Product binding is mandatory even when there are zero affected recipes or only direct-SKU lines. Keep primaries undated.
2. Implement pure line conversion and preview: measured quantities carry; compatible pack labels carry; incompatible labels convert through the OLD pack's known ounces; unweighable labels refuse. Evaluate replacement eligibility at scope. Preview costs direct replacements and product-primary followers through the real resolver and returns the exact normalized request bound by the token.
3. Start under the graph lock; re-enumerate direct and primary-following recipe sets, then recheck every dependency/product snapshot. Use a consistent lock order and NOWAIT/retry refusal where graph-first acquisition meets non-graph product writers. Create grouping/default primary without changing other shops; save all affected versions, primary and journal atomically. Never deactivate old SKU or change pars.
4. Restore exact prior resolved recipe content, not merely the absence of an old shop version. Record both whether a shop version existed and the resolved source version/lines. If the shop originally inherited default and that default changed during the swap, restore the saved content as a fresh own version; retiring to the new default is not exact restoration. If default is unchanged, retiring the temporary override is sufficient.
5. Back-to-normal locks before comparing, restores only still-owned swap effects, and explicitly reports later edits kept. Bind primary changes by revision/identity, not just SKU equality, to detect same-SKU rechoices. Restore previous primary metadata and membership as applicable; recheck all references before undoing a grouping. A later independent user edit must not be erased. Preserve audit/history through new records; scope the exceptional primary-row deletion to a row actually introduced by this swap.

Files: new `supabase/migrations/0265_sku_swaps.sql`, `lib/catalog/swap-shared.ts`, `lib/catalog/swap-vendor.ts`, `tests/sku-swaps-migration.test.ts`, `tests/swap-shared.test.ts`, `tests/swap-vendor.test.ts`, swap PGlite tests/fixture extending the existing chain.

Acceptance: temporary→Back round trip matches pre-swap operational state; default changed during temporary swap still restores original lines; edited-since rows are preserved and named; zero-recipe product races reject stale previews; default-vs-shop and direct-vs-product input matrices pass. A product-primary writer that loses its row may legitimately return its existing `primary_not_found`; tests must prove no lost successful choice rather than require both racing writes to succeed.

## Chunk 7 — Routes, disclosure and 4b handoff (4 tasks)

1. Add job, setup, preview, share, Toast and Back routes with plain-object `jsonOk` bodies and named refusals. Include the recipe share route missing from the draft's inventory. Validate sessions, scope and expected baselines on every route; return positional line data consistently.
2. Pin route-specific tiers/grants using the existing step-up map. Toast stays A; catalog edits/jobs use their reviewed catalog-window contracts; registry remains B. Audit vocabulary is closed: adjudicate each new action into destructive/non-destructive registries and record human mutations accurately. Do not use destructive membership as an authorization rule.
3. Ship refusal translations and required existing-surface labels in en+es now. 4b owns new guided page layouts, but live 4a legacy routes cannot defer their errors or ownership selection to that phase. Update disclosure/location-bind checks and AGENTS durable rules with only implemented behavior.
4. Hand 4b concrete DTOs and capability definitions: owner separate from write/cost scope, shop choices, line refusals, share dependencies, per-setup-step outcomes, swap impact and retained-edit results. Document the verified guide `skuId` and metadata reconciliation, creation redirect and add-menu-output ownership fixes. No guided-page implementation in this chunk.

Files: new routes under `app/api/admin/catalog/jobs/new-item`, `jobs/new-sandwich` (including preview), `sku/[id]/setup`, `sku/[id]/share`, `sku/[id]/swap` (including preview), `menu-item/[id]/toast`, `menu-item/[id]/share`, `recipe/[id]/share`, `swaps/[swapId]/back-to-normal`; `lib/audit-actions.ts`, `lib/destructive-actions.ts`, translation dictionaries, `AGENTS.md`, disclosure documentation as required by the existing doctrine. Tests: `tests/catalog-job-routes.test.ts`, `tests/step-up-tier-map.test.ts`, `tests/location-bind-differential.test.ts`. No new migration.

Acceptance: unauthenticated/forbidden/foreign/stale/invalid-line outcomes have exact status and translated code; success payloads match 4b's consumed contract; new audit actions compile; no client import crosses into a server-only module.

## Chunk 8 — Concurrency proof and release packet (4 tasks)

1. Add rollback-only sim SQL covering 0264/0265 and exact restoration. Verify expected failures by code and persisted postconditions; check the deliberate rollback marker plus before/after identity counts, not just a broad caught exception.
2. Register a catalog suite in the actual F4 runner, with runner contract tests. Use leased fixtures, verified server and actual Session APIs; inject sim credentials without logging them. Cover duplicate creation, restore-vs-primary, share-vs-owned edit, and default-change restoration. Use controlled schedules for each serial ordering plus concurrent stress. Require positive successful mutations and correct final state; two unrelated failures do not pass. Audit timestamps do not prove ordering because auditing is fail-open and post-mutation.
3. Author separate 0266 and its exact-signature tests, plus a release checklist. CC verifies live schema, constraints/grants, existing foreign-owned references and the pre-merge last-30-day cross-shop count gate. Count through `sku_count_lines.count_event_id` joined to events and SKU ownership; use real `qty`/`resolved_oz`/`counted_at` columns. Any matching count row pauses for Juan, even when its quantity is zero. Do not suppress this gate because store-copy exclusion is intended.
4. Assemble review evidence, run relevant suites/typecheck/build, then cross-family review under CC. Release ordering: verify actual 3a/3b deployment baseline; sim apply 0264/65 and scenario/races; CC-controlled production preflight/rollback validation and approved apply before merge; deploy READY and drain older deployments; only then apply 0266. Record actual migration versions and header stamps through CC's release commits. Astra leaves branch/summary and does not merge, deploy or touch production data.

Files: new `scripts/catalog-jobs/sim-scenario.sql`, catalog race suite under the existing sim organization, `scripts/sim/launch-readiness/run.ts`, `scripts/sim/launch-readiness/contracts/runner.spec.ts`, `supabase/migrations/0266_drop_legacy_recipe_input_writer.sql`, its migration test, release checklist alongside this plan or the established runbook destination. No bare standalone race invocation bypassing F4.

Acceptance commands after implementation (not results claimed today): focused `npx.cmd vitest run <chunk tests>` after each chunk; `node scripts/sql-harness-0262.mjs`; relevant new SQL harnesses; registered catalog F4 suite; full `npx.cmd vitest run`; `npx.cmd tsc --noEmit --incremental false`; repository build/check commands after reviewing their current configuration. Classify the reported six pre-existing Leaflet errors against actual baseline output rather than hiding new errors in an allowed count. Sim leases, fixtures and environment identifiers must be verified before executing any DB scenario.

## Corrections to the supplied draft

| # | Change and reason |
| --- | --- |
| 1 | Replace assumed 3a/3b anchors with the integration table; 3b code is not present and must be re-read at its delivered commit. |
| 2 | Retain role-code authorization and positional recipe error parsing; level-only checks lose social-media exclusion and line diagnostics. |
| 3 | Distinguish omitted scope from explicit global null; `requested ?? fallback` silently authorizes the wrong intent. |
| 4 | Add the entire prep-item registry creation/read/definition path; the existing writer always creates global and its reader hides newly scoped rows. |
| 5 | Keep legacy input-only MoO restriction distinct from header/output/yield/batch permissions and bind owner into every owner-authorized mutation. |
| 6 | Use owner scope consistently for packs, graph and prices while retaining null owned-write scope; fix new-recipe pickers, redirect and menu-output scope. |
| 7 | Filter batch input and preloaded readiness paths, not only single loaders; add independently composed Wave 7 data-readiness graphs. |
| 8 | Assert readiness reason objects and entry existence; draft string-array assertions can pass without proving anything. |
| 9 | Preserve explicit-null graph scope and constrain overrides; nullish fallback changes 3a semantics and overrides could revive hidden recipes. |
| 10 | Preserve store-copy default eligibility proven by existing tests, but replace the foreign regular-member expectation and test every product fallback rung. |
| 11 | Wire shop guide reads to a real consumer; keep editor whole. `s.skuId` is correct; owner metadata loss during local baseline replacement is the actual defect. |
| 12 | Filter every catering picker lane, including prep items and choices; prevent hidden package references returning through fallback labels/prices. |
| 13 | Use all-scope inputs for SKU sharing impact; legacy direct inputs omit shop-version consumers. |
| 14 | Extend the file-backed PGlite stub and real 0258–0263 chain; add actual defaults/constraints instead of guessed columns or duplicate overlay definitions. |
| 15 | Replace impossible fixture setup and catch-all fake tests with positive success and exact refusal/postcondition tests. |
| 16 | Bind swap product state even with zero recipes; recipe snapshots alone miss membership/primary races. |
| 17 | Record inherited source lines for exact restoration after default changes; a null replaced-shop-version marker alone cannot restore exactly. |
| 18 | Compare primary identity/revision and preserve previous metadata; value-only comparisons miss same-SKU user rechoices. Lock/recheck ownership before relying on it. |
| 19 | Use the real POST primary route, Session response shape, explicit step-up call and report failure count; integrate races into F4 lease lifecycle. |
| 20 | Replace vacuous race outcomes/audit timestamp ordering with controlled schedules, successful operations and final-state proofs. |
| 21 | Include recipe sharing route and every named refusal, and ship live errors/legacy scope UI translations in 4a instead of deferring all i18n to 4b. |
| 22 | Correct the universal never-move statement to the fixed MoO+ move rule, with integrity validation; no new general move UI is implied. |
| 23 | Retain separate post-READY 0266, but correct the release narrative: this checkout's 3a and concurrent 3b are not assumed production deployments. |

## Risks, dependencies and lead questions

The main implementation risks are incomplete consumer projection, owner/share TOCTOU, product/graph lock ordering, stale preview restoration and concurrent 3b contract drift. The chunks explicitly test each. Shared-only equivalence is necessary but insufficient: owned fixture cases and real PostgreSQL concurrency are separate gates.

Required handoff: CC supplies the reviewed Phase 3b commit and integration order before Chunk 4's page integration. The implementation must also inspect current migration numbering and actual deployment lineage before its release packet. These are unavailable external state, not reasons to reopen fixed product decisions.

No unresolved product-policy questions from the inspected code. Store-copy global eligibility is intentional compatibility in the existing test, not an unanswered question. Production cross-shop count results are deliberately unknown until CC runs the release gate; any nonzero result goes to Juan.

## Verification performed for this plan

- `npx.cmd vitest run tests/recipe-versions-equivalence.test.ts tests/shop-versions-equivalence.test.ts tests/counts-onhand-equivalence.test.ts tests/products-store-loader.test.ts` — PASS, 4 files / 70 tests.
- `node scripts/sql-harness-0262.mjs` — PASS, including 16/17-argument writer compatibility and permission scenarios.
- PowerShell's `npx.ps1` was blocked by execution policy; `npx.cmd` ran successfully. No policy was changed.
- Application code, migrations, production and the supplied draft plans were not changed. Full implementation tests and typecheck are future work, not claimed as passing here.
