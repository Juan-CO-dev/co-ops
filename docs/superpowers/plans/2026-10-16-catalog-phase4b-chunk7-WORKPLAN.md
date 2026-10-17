# Catalog 4b chunk 7 workplan

Baseline: db8f2667, feat/catalog-phase4b-job-pages. Follow CC's supplied Part A rulings and reviewed BUILD r2 chunk 7, in that order. Leave changes uncommitted.

Part A: failing-first success interactions for all three Share response shapes; accept the SKU route's shared flag. Pin the barcode-specific error and bilingual copy. Add optional bilingual swap product-name fields using the existing request contract, preserving the original-name default and invalidating preview after edits. Correct the chunk 5 assertion inventory.

Part B: failing-first scoped job entry and role-gate tests; hub, costing, legacy recipe/SKU entry links and exact-item repair destinations. Preserve existing ownership selectors and recipe Share. Add batched order-guide ownership labels for placed and unplaced SKUs without filtering save payloads. Document each job's separate saves, uncertainty, replay/reconciliation, Toast, Share and retained Back edits in English and Spanish; update doctrine only for verified behavior.

References: BUILD r2 and chunk 5/6 records, Share routes/component and interaction harness, swap parser/engine/client, jobs error registry and translations; inspect each Part B consumer before changes. The swap engine already accepts both product names and defaults to the original SKU: no engine/SQL changes needed. Installed Next server/client, route and page guides govern page wiring.

Contracts/risks: authorized shop versus owned write scope; exact route response acknowledgement; preview invalidation; complete guide saves; no duplicate owner flow. No migration or equivalence-pin changes. CC retains cross-family review and merge authority.

Verification: failing-first focused runs; inventory/read-boundary/shop-context/tier-map and all four equivalence suites; next typegen then tsc; changed-file eslint delta <= 0; full suite with threads/no-cache/3 workers/60000 timeout. Record every changed assertion, A/B files, known tsx ENOMEM separately, and distinguish static phone-layout evidence from measured 375px browser evidence.
