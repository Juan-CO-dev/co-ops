# Catalog Phase 4a release packet

> Custody (corrected by CC 2026-10-16, Aggie chunk-8 P2-1): these changes are COMMITTED in 8355d7d3 on feat/catalog-p4a; the frozen revision's full suite is 10,423 passed (the 10,421 figure was the pre-credential-isolation tree).

Branch: `feat/catalog-p4a`. Worktree: `C:\Users\conta\co-ops-astra-p4`. Chunk-8 baseline: `35748f42e974a3f7fc81dc1687e5bc1e929bd6ef`. All chunk-8 changes are committed in 8355d7d3. CC owns review, SIM execution and release; Juan owns production approval. This packet does not establish any database application or deployment.

## Release sequence and evidence custody

1. CC reviews the final working diff and independently runs the local checks recorded in the chunk-8 handoff. The author's family does not supply the sole review. Freeze the reviewed revision before SIM/deployment work.
2. Verify the actual deployed baseline and live migration lineage, including 0258–0263; do not infer deployment from this branch. Read the delivered Phase 3b commit if it is deployed; its pages remain a 4b integration obligation.
3. Run the read-only `scripts/catalog-release-preflight.sql` against the intended database and archive the results privately. Confirm actual columns, constraints, grants, ownership/reference integrity, migration-number availability and legacy function overloads. Investigate every unexpected finding rather than treating query execution as approval.
4. The last-30-day cross-shop count gate reports BOTH all matching rows and rows with `qty > 0 OR resolved_oz > 0`. Any nonzero-quantity match pauses release for Juan. Disclose zero-only matches without independently pausing. Include store-copy rows; intended visibility exclusion does not waive this gate.
5. CC applies reviewed 0264/0265 to SIM, records actual schema_migrations versions, and stamps the authored migration headers in a release commit. Run the catalog F4 suite, rollback scenario and Management API concurrency checks. Each API request owns a connection/transaction; the holder writes then sleeps inside its transaction and the racer starts about two seconds later. Require exact outcomes, positive controls, final rows and observed lock evidence. A mock or PGlite pass is not a multi-session PostgreSQL pass.
6. Preserve reports for each controlled serial ordering and stress run. A refusal unrelated to the intended race fails the proof. For NOWAIT dependencies, prove the exact busy refusal while the dependency is held and a successful save once released; do not require a blocking wait for this case.
7. CC performs approved production preflight/rollback validation and applies 0264/0265 before merge under the lead's release procedure. Record lineage and header stamps; do not silently reapply an already applied migration. Outstanding affected previews must return HTTP 409 `dependencies_changed` and require re-preview/confirmation. Never strip new snapshot fields or auto-retry a stale write.
8. After review and approved merge/deployment, verify READY and drain all older deployments. Only then may CC apply `0266_drop_recipe_input_16arg.sql`, dropping exactly the old 16-argument overload. Verify the owner-bound replacement remains and record the actual application stamp/version. 0266 must not ride in the pre-deployment 0264/0265 apply batch.

## Chunk-7 review disposition

- P2-1: Spanish values must have equal `?` and `¿` counts; retain U+FFFD rejection and explicit before-space/before-period regressions.
- P2-2: resolved by CC's committed AGENTS.md in `35748f42`.
- P3-1: unexpected HTTP/setup failures produce one safe server diagnostic; client responses remain generic. Setup refusal ledgers carry a translation `messageKey` with the code.
- P3-2: same-origin validation is first on all nine chunk-7 writes. **Family-wide policy for older `/api/admin/catalog` writes is a 4b item.** Read-only preview routes are outside this nine-write ruling.
- P3-3: Back library authority is pinned independently of mocked HTTP gates: below level 7/social-media rejected, foreign swap hidden as `swap_not_found`.
- P3-4: UUID dependency arrays are capped with a named 400 at the HTTP boundary.
- P3-5: sandwich creation has no request-id replay response. A lost-response retry of the same normalized name returns 409 `name_taken`; it does not return the earlier identities. The 4b page must refresh/reconcile the existing owned sandwich before offering another creation, and must not silently change the name to retry. New-item retains its distinct request-id/replayed contract.
- P3-6: retain preview recomputation on swap start. The preview reads snapshots at its boundaries to detect mixed state; start reauthorizes and recomputes before passing server-derived evidence to locked SQL. Review-estimated round trips are approximately 25–30 per preview, with preview-plus-start repeating the work; this is not a measured load benchmark. Full `productSnapshot` and `recipeSnapshots` remain in the preview payload even though callers submit only normalized request plus token. No rate ceiling is introduced here. Measure production-shaped load and consider a minimal public DTO in 4b without weakening freshness, scope or SQL comparison.
- P3-7: the historical handoff now names committed state and the independently reproduced 25-file/600-test selection; the unsupported 602-test count is withdrawn.

## Remaining product/integration contracts

- Retain request IDs across pending/double-submit/lost-response retries, including edits; replace the new-item factory only after acknowledged success, including replay. Latest edits are not applied on replay.
- Setup steps are independent writes. A generic post-save failure is unconfirmed and requires refresh before retry; do not claim rollback. Per-day outcomes must remain visible.
- Owned identity, null default write scope, and owner-shop cost/picker scope are distinct. Consume server authority and preserve ownership through full-guide save/reload.
- Vendor/item-number serialization covers cooperating `create_catalog_sku` jobs, not legacy create/edit/import writers; there is no new database-wide uniqueness promise.
- Back preserves later recipe/primary/grouping edits and reports retained outcomes. A same-SKU primary rechoice is a new revision and survives Back.
- Phase 4b still owns guided pages, redirects, both legacy/catalog reopen journeys, delivered-3b integration, and 375 px browser acceptance. Library/HTTP/SQL proof does not establish those UI outcomes.

## Execution record

The catalog runner uses the explicit `catalog-isolated` additive fixture under F4's exclusive lease, verified production server and persona checks. The existing full-reset manifest is frozen at 150 tables and predates catalog history tables; its service-role DELETE approach cannot reset their append-only histories. This suite therefore creates unique synthetic records, waits for every request to settle, and retires its own records. It does not claim a cold-empty restore or broaden the reset system. CC must start from a clean SIM lease state with provisioned personas and the required reviewed migrations; a dirty marker still refuses execution.

Local results are recorded in `2026-10-16-catalog-phase4a-chunk8-handoff.md` after verification. Real SIM concurrency, F4 runtime, production preflight, migration application, deployment READY/drain and post-deployment 0266 remain **pending CC execution**. No pass is inferred from authored scripts.
