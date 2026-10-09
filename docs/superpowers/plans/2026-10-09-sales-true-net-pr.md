# PR title

Show captured Toast item-sales net with reconciled refund allocations

# PR body

## Sol P1 follow-up (2026-10-09)

Fixed BC-008/BC-034 in migration 0239's daily reader. Undated eligible refunds now survive
the latest-snapshot, shop-scoped classifier. The RPC emits uncertainty-only rows for report
days on/after the original sale, including when that sale predates the requested window.
These rows carry NULL sales refunds and a missing-allocation count, with zero dated refund
money/count/tips. No refund amount is assigned to a guessed date. Existing summary folding
makes daily, weekly and window net unavailable. Missing counters sum daily unresolved
allocations; an undated payment can therefore contribute on multiple possible days.
Ordinary legacy payments without refund evidence and new proven-zero payments do not
poison future windows. Corrected latest snapshots remove the uncertainty.

Changed in this follow-up: `supabase/migrations/0239_sales_true_net.sql`,
`tests/sales-true-net-accounting.test.ts`, `tests/sales-true-net-migration.test.ts`,
`scripts/test-sales-true-net.sql`, and this handoff. Capture projection/writer and UI code
were not changed in this follow-up. Uncertainty is grouped into at most 31 start dates
before expansion to at most 31 report days; the enlarged undated-refund predicate still
requires representative-volume SQL timing before apply.

Verification (agent-self-check; implementation awaits CC's independent review):

```text
npm.cmd test -- tests/sales-true-net-accounting.test.ts tests/sales-true-net-migration.test.ts
RED before the SQL fix: 1 failed, 34 passed (new undated-refund SQL contract assertion).
GREEN after the fix: 35 passed; four normalization cases added before the full run.

npm.cmd test -- --reporter=json --outputFile=tmp-sales-true-net-review-fix-tests.json
PASS: 6,134 passed, 1 skipped, 0 failed (6,135 tests).

npm.cmd run typecheck
FAIL: same six baseline TS2307 Leaflet PNG declaration errors, reproduced below.

npm.cmd exec -- eslint tests/sales-true-net-accounting.test.ts tests/sales-true-net-migration.test.ts
PASS.

git diff --check
PASS.
```

The SQL harness now covers missing-date $5 refunds, missing amount/date, legacy refund
status evidence, negative controls, earlier-than-sale dates, later report windows, shop
isolation, and a corrected latest snapshot. It was authored but NOT executed: no local
PostgreSQL command or authorized sim connection was available. The unit suite checks the
SQL contract and summary propagation separately; it does not execute PostgreSQL. Sim
behavior and the representative-volume eight-second timing gate remain unverified.

All changes remain uncommitted on `feat/sales-true-net` at `C:/Users/conta/co-ops-truenet`.
The validation below records the preceding implementation round.

Sales previously exposed check totals before refunds plus ezCater's reported subtotal. This adds separate Toast gross, discounts/comps, item voids, service charges, sales refunds and item-sales net to the summary, date buckets and exports. Existing columns, named-discount reporting, GM+ shop scope and the modified-order watermark remain. Both English and Spanish explain the separate bases and unavailable amounts.

The capture normalizer now projects accounting from the existing order response, without extra requests or orchestration changes. For a check with $13 before tax/tips, including $3 non-gratuity charges and $2 item discounts, gross item sales are $12 and pre-refund item sales are $10. A reconciled $5 item refund plus $0.50 tax reduces item-sales net by $5 on the refund business date; tip refunds stay outside sales. Whole void/deleted checks and other existing sale exclusions remain excluded.

## Stored-data findings and accounting contract

- Repository contracts, not production-row observations: old snapshots contain check money, named discounts, service charges and payment refunds, but omit the selection accounting needed for exact item-sales net. No credentials, customer data, production schema or live orders were read.
- Check amount already includes discounts and non-gratuity service charges. The approved item-sales basis removes **all** non-gratuity charges once; it differs from Toast's generic net-sales basis, which retains most service charges. Tax, tips, deferred/gift-card selections and house-account balance sales are excluded.
- Parent selection prices include quantities and modifiers. Excluded subtrees and voids are priced once. Discounts use `nonTaxDiscountAmount`; no fallback treats tax-inclusive discounts as item discounts, and comp names are never inferred. Deferred-subtree discount allocations use pre-discount minus net price. Parent/check price reconciliation must succeed for exact gross.
- Parent refund details include nested modifiers. Allocations reconcile item, non-sales and non-gratuity-service-charge refund amounts plus tax against the entire payment refund transaction. Missing details, unknown tax, mixed eligible/excluded refunded subtrees, inconsistent dates and custom/unreconciled amounts remain null.
- Split-payment transactions have one deterministic carrier (minimum payment GUID) for the sales-refund amount and zero on their other payments. This is a transaction aggregate, **not** per-tender attribution. Reordering payments cannot multiply or move the allocation. The existing refund business date is retained.
- Historical missing accounting stays null until normal recapture. Missing components poison the corresponding exact aggregate; incomplete day coverage suppresses exact money. Dated refunds with absent payment amounts are counted as unknown, rather than dropped. Late-refund coverage limits still apply; this does not claim complete historical refund discovery.
- ezCater remains its reported subtotal, separate from Toast exact net. Legacy check-total and before-refund columns retain their original numeric basis.

Verified against the official [net-sales guide](https://doc.toasttab.com/doc/devguide/apiOrdersNetSalesCalculation.html), [Selection schema](https://doc.toasttab.com/openapi/orders/tag/Data-definitions/schema/Selection/), [AppliedDiscount schema](https://doc.toasttab.com/openapi/orders/tag/Data-definitions/schema/AppliedDiscount/), [Refund schema](https://doc.toasttab.com/openapi/orders/tag/Data-definitions/schema/Refund/) and [RefundDetails schema](https://doc.toasttab.com/openapi/orders/tag/Data-definitions/schema/RefundDetails/).

## Migration and apply gates

Migration `0239_sales_true_net.sql` is **authored only, not applied**. It adds nullable check accounting JSON and nullable payment sales-refund cents, then re-emits the 0221 capture writer with only additive insert fields and the bounded daily RPC with accounting aggregates. Existing snapshot immutability, retry checks, locks, run membership, pointer publication, service-role-only grants and the 31-day reader guard are retained. No history rewrite, backfill, index or production action is included.

Apply the migration before deploying the new normalizer. The old writer ignores new JSON fields, but the new normalizer includes them in its content hash; deploying code first could create snapshots that a later identical recapture cannot enrich.

CC's sim procedure, before any production consideration:

1. Verify actual sim schema/columns and migration lineage against 0221, 0232 and 0237; reserve 0239 as this file. Apply to sim only through the existing CC process.
2. Run `scripts/test-sales-true-net.sql` as the migration owner with stop-on-error enabled. It has a sim guard, transaction rollback and an eight-second statement timeout. It proves old/new immutable snapshots, publication, shop isolation, exclusions including an actual ezCater link, unknowns, refund dates and grants.
3. The harness explicitly executes the **0237 payment-dedup contract**: omitted new column equals explicit null; null-to-value payment enrichment captures a new snapshot; retry and payment reordering are no-ops; check-only corrections remain invisible until full-day recapture. The function is not replaced: its dynamic `toast_payments` rowtype comparison picks up the new column.
4. Run representative-volume 31-day Sales reads on sim with an eight-second timeout, inspect `EXPLAIN (ANALYZE, BUFFERS)` for the bounded facts/check join and refund-date/latest-pointer join, and record timings for both shops. The harness's synthetic-volume timing is not a production performance claim. SQL functions need inner-query plans as well as outer RPC timing.
5. Complete CC's code review and preview role/browser smoke. No SQL harness or migration was executed in this authoring session; no deployment or backfill was started.

## Validation

```text
npm.cmd test -- --reporter=json --outputFile=tmp-sales-true-net-tests.json
PASS: 6,128 passed, 1 skipped, 0 failed (6,129 tests).

npm.cmd test -- tests/sales-reports-r1.test.ts tests/sales-true-net-accounting.test.ts tests/sales-true-net-display.test.ts tests/sales-true-net-migration.test.ts
PASS: 53 tests.

npm.cmd exec -- eslint lib/toast/sales-accounting-shared.ts lib/toast/capture-shared.ts lib/sales-reports-shared.ts lib/report-export-shared.ts components/reports-hub/SalesSummary.tsx tests/sales-true-net-accounting.test.ts tests/sales-true-net-display.test.ts tests/sales-true-net-migration.test.ts
PASS.

npm.cmd run typecheck
FAIL on both runs, only the six pre-existing TS2307 Leaflet PNG declaration errors recorded in the approved plan baseline.

npm.cmd run build
FAIL: next/font could not fetch DM Sans from fonts.googleapis.com (network unavailable).

git diff --check
PASS.
```

Typecheck output (unchanged from baseline):

```text
components/admin/catering/fulfillment/ZoneMap.tsx(24,21): error TS2307: Cannot find module 'leaflet/dist/images/marker-icon.png' or its corresponding type declarations.
components/admin/catering/fulfillment/ZoneMap.tsx(25,23): error TS2307: Cannot find module 'leaflet/dist/images/marker-icon-2x.png' or its corresponding type declarations.
components/admin/catering/fulfillment/ZoneMap.tsx(26,23): error TS2307: Cannot find module 'leaflet/dist/images/marker-shadow.png' or its corresponding type declarations.
components/order/DeliveryRouteMap.tsx(6,21): error TS2307: Cannot find module 'leaflet/dist/images/marker-icon.png' or its corresponding type declarations.
components/order/DeliveryRouteMap.tsx(7,23): error TS2307: Cannot find module 'leaflet/dist/images/marker-icon-2x.png' or its corresponding type declarations.
components/order/DeliveryRouteMap.tsx(8,23): error TS2307: Cannot find module 'leaflet/dist/images/marker-shadow.png' or its corresponding type declarations.
```

The initial full run found three outdated assertions in `sales-reports-r1.test.ts` forbidding every net column and requiring the old refund wording. They now protect the retained legacy basis while permitting only the new accounted summary net and its basis note. The final full run above is green. An initial lint invocation used `.tsx` for the new `.ts` display test and refused that missing path; the corrected command above passed.

Static Chromium smoke of the summary at 360/1440 pixels in en/es found no document overflow, with wide bucket scrolling contained. This used compiled global CSS, synthetic DTOs and open-disclosure mocks with network aborted; it does not replace an authenticated preview smoke or app-layout font verification.

Author self-check against the bug-class catalog: BC-001/004/025 (unchanged scope gates and isolation tests), BC-008 (refund business dates), BC-010 (bounded reads), BC-013/026/031 (money bases and aggregate dedup), BC-018 (en/es), BC-023 (immutable rows and grants), BC-030/032/034/040 (published API contracts and unknown/cold paths), BC-038 (migration-first deployment), BC-042 (regression suite) and BC-043 (verification provenance). Plan reviewer: CC, explicitly approved. Implementation cross-family review remains CC's; unavailable network seats were not retried or represented as approvals.

## File anchors

- `lib/toast/sales-accounting-shared.ts:24`: check accounting; `:70`: reconciled transaction refunds.
- `lib/toast/capture-shared.ts:60`: projection on the existing normalization path.
- `supabase/migrations/0239_sales_true_net.sql:18`: nullable storage; `:22`: capture writer; `:56`: daily reader.
- `lib/sales-reports-shared.ts:207`: DTO; `:307`: exact-net calculation and unknown propagation.
- `components/reports-hub/SalesSummary.tsx:50`: warnings/cards; `lib/report-export-shared.ts:147`: appended export columns; `lib/i18n/en.json:171`, `lib/i18n/es.json:171`: labels.
- `tests/sales-true-net-accounting.test.ts:18`, `tests/sales-true-net-display.test.ts:31`, `tests/sales-true-net-migration.test.ts:19`, `scripts/test-sales-true-net.sql:58`: component, display and SQL contracts.

Branch: `feat/sales-true-net`. Dedicated clone: `C:/Users/conta/co-ops-truenet`. All changes uncommitted; no push or merge. Pre-existing plan, failed review records and baseline JSON were preserved. Test JSON is a local verification artifact, not proposed application source.
