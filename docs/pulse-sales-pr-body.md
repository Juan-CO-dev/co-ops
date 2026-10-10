Title: Keep Pulse sales available when the trailing baseline times out

Mid-shift Sales currently runs the full accounting report for today and its trailing baseline. A cold report can exceed the database deadline; a baseline failure also hides today's sales. Add two Pulse-only, service-role read RPCs and route every request through the injected deadline client. An uncached source load now makes seven RPCs instead of eleven requests; a shared-cache hit makes none. The trailing baseline has a separate three-second abort and promise race, with explicit English/Spanish unavailable text while today's totals remain visible.

0242 preserves classified check totals, counted discounts, dated refund counts/amounts (including old sales and missing refund amounts), completed-capture coverage, and the existing hourly weekday aggregation. It omits the all-history undated-refund accounting scan. The existing Reports > Sales loaders and SQL are unchanged. No table or index is added. The migration header records expected cold costs and index paths; actual cold performance is not yet measured.

Validation:

- `npm.cmd test`: 431 files passed; 6,713 tests passed, one skipped. New real-wiring tests cover seven requests and exact windows, cache reuse, scope before I/O, baseline error/timeout isolation, cancellation, unchanged rounding/full heatmap, and empty coverage. The existing DB-call fake was updated to the new RPC shape.
- `npm.cmd run typecheck`: six pre-existing TS2307 errors for Leaflet PNG imports in `components/admin/catering/fulfillment/ZoneMap.tsx:24` and `components/order/DeliveryRouteMap.tsx:6`; no new TypeScript errors.
- `git diff --check`: passed.
- `scripts/test-pulse-sales.sql`: rollback-only sim parity/grant/window harness, including both new RPC outputs and `sales_report_daily` for one shop/day. Authored but **not executed** here (`psql` unavailable).
- `docs/pulse-sales-validation.md`: sim execution and read-only EXPLAIN/timing instructions. Cold database timing and SQL execution remain CC verification gates.

Rollout: apply and validate 0242 on sim before production approval and before the app change deploys. Five bounded one-day breakdown reads remain a cost. Baseline failures are cached only for the existing source TTL. CC reviewed the plan and is the cross-family code reviewer; unavailable network review seats were waived for this task. Work remains uncommitted on `fix/pulse-sales-timeout`; no push, merge, migration application, or production access occurred.
