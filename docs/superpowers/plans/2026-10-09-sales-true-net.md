# Sales true net — implementation and review packet

Branch: feat/sales-true-net. Uncommitted work only; no git writes, push, merge, deployment or production reads/writes.

## Confirmed source contracts

- `lib/toast/capture-shared.ts` normalizes an explicit allowlist, not raw snapshots. It stores check amount/tax/total, named discounts, service charges including gratuity, and payment refunds with refund business dates. `CaptureSelection` stores quantities and void flags, not prices or deferred flags.
- `supabase/migrations/0221_toast_order_capture.sql` persists immutable snapshots through `toast_capture_page`; latest pointers publish completed captures. `0237_toast_modified_capture.sql` enables late-refund discovery without moving the order business date.
- `0232_reports_sales_reads.sql` uses one classifier, latest pointers, 31-day windows and service-role RPCs. Discounts exclude voided selections. Refunds use refund date and the same sale eligibility. Its daily RPC currently omits service charges.
- `lib/sales-reports-shared.ts` sums check totals plus ezCater subtotals before refunds. The summary and export share this DTO. GM+ location gates live in `lib/sales-reports.ts`.
- Toast documents check.amount as after discounts, including non-gratuity charges, excluding tax/tips. AppliedDiscount has no explicit comp type. Payment refunds exclude tips but do not independently separate tax/service-charge refunds; selection/service-charge refundDetails do.

Sources: https://doc.toasttab.com/doc/devguide/apiOrdersNetSalesCalculation.html ; https://doc.toasttab.com/openapi/orders/tag/Data-definitions/schema/Refund/ ; https://doc.toasttab.com/openapi/orders/tag/Data-definitions/schema/AppliedDiscount/ ; https://doc.toasttab.com/openapi/orders/tag/Data-definitions/schema/AppliedServiceCharge/

## Proposed implementation

1. Add a pure accounting projection called during normalization. Compute per-check sales components from the same response: exclude deleted selections and deferred/house-account sales; price voided selections within eligible checks; use non-tax discounts; remove non-gratuity service charges from check.amount exactly once. Keep gratuity charges outside sales. Gross = eligible pre-refund sales + discounts/comps + voids; net = gross - discounts/comps - voids - sales refunds. Whole void checks remain excluded.
2. Preserve named-discount reporting. Do not infer comps from names; default to one discounts-and-comps line plus a voids line pending Juan's clarification.
3. Resolve item/service-charge refundDetails by refund transaction to payment refund business date. Only a fully reconciled refund allocation is exact. Unallocatable/custom refunds remain explicitly unknown, never silently treated as sales refunds or dated to the original sale. Tip refunds remain separate. Multiple payments per transaction must not duplicate allocations.
4. Migration **0239**, authored only: add nullable accounting JSON to checks and nullable sales refund cents to payments; re-emit capture page with only additive insert fields, preserving all locks, membership and retry rules. Re-emit daily RPC to aggregate components from latest eligible checks and refund-dated latest payments. Existing historical snapshots lack accounting; exact net is unavailable until a normal recapture/backfill enriches them. Do not rewrite old snapshots or start a backfill.
5. Extend daily DTO/pure summary with gross, discounts/comps, voids, service charges, sales refunds, exact Toast net and missing-accounting counts. Keep existing check-total and ezCater reported-subtotal fields truthful and separate. Null exact amounts when required components are missing. Add corresponding summary cards/bucket values, en/es labels and export columns/basis notes, retaining existing export columns.
6. No new API requests or capture orchestration changes. Added projection is linear in one existing response. Reads remain 31-day bounded, two windows at once; no whole-history rescan. The modified-order watermark remains visible.

## Files and validation

Capture: `lib/toast/capture-shared.ts`, a new pure accounting module, migration 0239. Read/display: `lib/sales-reports-shared.ts`, summary component, `lib/report-export-shared.ts`, en/es dictionaries. Tests cover each component, modifiers, deferred selections, tax-inclusive discounts, voided/deleted checks and selections, partial/tip/custom/late refunds, multi-payment transaction deduplication, historical unknowns, exports and i18n. Add a rollback-only SQL harness for capture/RPC grants, isolation, old/new snapshots and timing; do not run against production.

Run focused tests, full `npm test`, `npm run typecheck`, and relevant lint/build where the local dependency environment permits. Inspect 360/1440 layout if a browser/server is available. Record commands and failures, not inferred successes. Supply a PR body with stored-data findings, exact-vs-unknown policy, migration/harness instructions and timing gates.

## Risks / review questions

- No historical exactness claim: snapshots cannot provide fields they never captured.
- Refund allocations must reconcile to payment refund including tax and service charges; otherwise exact net remains unknown.
- No comp-name heuristics or second discount subtraction; ezCater subtotal is not claimed to be exact net.
- Need cross-family plan review before code per the charter. CC retains final review. No live schema access is available in the current tool set; sim schema verification and the 8-second statement-timeout harness remain apply gates.

## Review attempt and implementation status

Both review seats were attempted with the installed `multi-seat-review` script. Both returned `SEAT FAILED: URLError` / `WinError 10013` (network socket access forbidden), not an approval. Results are in the adjacent `2026-10-09-sales-true-net-review.glm.md` and `.deepseek.md` files. Implementation is pending CC's plan review or Juan's explicit waiver of the pre-code review gate; requested asynchronously in this session. No application code or migration has been written.

Further integration finding: `0237_toast_modified_capture.sql:79-84` compares incoming payments to stored payments using `jsonb_populate_recordset(null::public.toast_payments, ...)`. The proposed nullable sales-refund column therefore participates automatically in modified-order deduplication. Check-only corrections are not discovered by this payment-only lane; regular full-day recapture remains necessary for those. Test this contract explicitly.

## Stored-data finding anchors

These are repository-contract findings, not observations of production rows. No credentials, live orders, customer data or environment files were read.

| Finding | File:line |
| --- | --- |
| Check pre-tax amount, tax, total, void/deleted flags | `lib/toast/capture-shared.ts:43` |
| Named discounts and selection scope | `lib/toast/capture-shared.ts:44` |
| Service-charge amount, gratuity and taxability already stored | `lib/toast/capture-shared.ts:45` |
| Payment tips, refund amount, tip-refund amount and refund business date | `lib/toast/capture-shared.ts:46` |
| Selection quantity/identity only; no prices or deferred fields | `lib/toast/capture-reconciliation-shared.ts:2-10`, `lib/toast/capture-shared.ts:75` |
| Snapshot persistence and child inserts | `supabase/migrations/0221_toast_order_capture.sql:141-168` |
| Latest eligible check facts | `supabase/migrations/0232_reports_sales_reads.sql:72` |
| Refund-date query, including older-order refunds | `supabase/migrations/0232_reports_sales_reads.sql:138-151` |
| Service charges available to check detail but omitted from daily summary | `supabase/migrations/0232_reports_sales_reads.sql:109`, `:325` |
| Existing estimate notes | `lib/report-export-shared.ts:341-342` |
| Shared summary/export authorization boundary | `lib/sales-reports.ts:44`, `:84` |

## PR body scaffold (not an implemented-change claim)

Problem: Sales currently displays check totals before refunds, not the requested item-sales net. Check amounts already include discounts and non-gratuity charges, so naive subtraction double-counts discounts and includes non-sales money.

Intended result: gross, discounts/comps, voids, refund-dated sales refunds and Toast net shown separately from service charges, tax, tips and ezCater's reported subtotal. New capture fields fill the verified gaps; historical/missing components stay explicitly unavailable. GM+ shop scope and named-discount detail remain intact.

Migration: reserve 0239 only. Author after review; apply to sim only through CC. Require a rollback-only harness proving immutable capture, latest snapshots, refund dates, exclusions, deny-all grants and 31-day reads below eight seconds before production approval. No harness or migration exists yet.

Validation: baseline results below. New component, export, i18n and viewport validation remain pending implementation.

## Baseline validation results

- `npm.cmd test -- --reporter=json --outputFile=tmp-sales-baseline-tests.json`: exit 0; 6,090 passed, 1 skipped, 0 failed (6,091 tests). Full report: `tmp-sales-baseline-tests.json`.
- `npm.cmd run typecheck`: exit 1, six existing TS2307 errors below. No application source changed before this run.
- `git diff --check`: exit 0. Only this plan, two failed review records and the baseline JSON report are untracked. Branch remains `feat/sales-true-net` in `C:/Users/conta/co-ops-truenet`. No git writes performed.
- Initial `npm` commands were blocked by PowerShell's script execution policy; retrying with `npm.cmd` successfully launched both checks.

```text
components/admin/catering/fulfillment/ZoneMap.tsx(24,21): error TS2307: Cannot find module 'leaflet/dist/images/marker-icon.png' or its corresponding type declarations.
components/admin/catering/fulfillment/ZoneMap.tsx(25,23): error TS2307: Cannot find module 'leaflet/dist/images/marker-icon-2x.png' or its corresponding type declarations.
components/admin/catering/fulfillment/ZoneMap.tsx(26,23): error TS2307: Cannot find module 'leaflet/dist/images/marker-shadow.png' or its corresponding type declarations.
components/order/DeliveryRouteMap.tsx(6,21): error TS2307: Cannot find module 'leaflet/dist/images/marker-icon.png' or its corresponding type declarations.
components/order/DeliveryRouteMap.tsx(7,23): error TS2307: Cannot find module 'leaflet/dist/images/marker-icon-2x.png' or its corresponding type declarations.
components/order/DeliveryRouteMap.tsx(8,23): error TS2307: Cannot find module 'leaflet/dist/images/marker-shadow.png' or its corresponding type declarations.
```
