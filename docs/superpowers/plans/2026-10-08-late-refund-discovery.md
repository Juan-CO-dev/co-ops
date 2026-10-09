# Late refund discovery — implementation plan

Branch: feat/late-refund-discovery. Leave uncommitted; no git writes, production reads/writes, push or merge.

## Confirmed contracts

- `lib/toast/capture-intraday.ts`: 45-second shared capture deadline. Pinger route has 120 seconds total, reserves labor time. Ten minutes is the invocation cadence, not the request allowance.
- Toast ordersBulk `startDate` inclusive / `endDate` exclusive returns orders by modification time; there is no payment-only provider filter. Compare normalized payments before persisting. Source: https://doc.toasttab.com/openapi/orders/operation/ordersBulkGet/.
- 0221 `toast_capture_page` stores allowlisted immutable content-hash snapshots and payment children; `toast_capture_finish` publishes per-order pointers by source modification time then run start/id. Neither removes other pointers.
- Completed capture manifests also prove FULL-DAY coverage in counts, depletion, Sales and catering. A discovery must never masquerade as a full-day capture.
- 0222 claim debounces recent failures as well as completed/running runs. Exclude modified discovery runs from that check and from the application's latest debounce diagnostic.
- 0232 refunds join latest pointers and use refund business date, independent of order date. Existing classifier remains unchanged.

## Files and contracts

1. Migration `0237_toast_modified_capture.sql`: per-shop cursor with persisted coverage start, exclusive successful watermark, and fixed pending end. Initialize to the first sweep minus 24 hours (explicit bootstrap limitation). Window at most one hour, two-minute safety lag, one-minute overlap bounded by coverage start. A failed window retains both ends; resume always starts at page one. Cursor compare-and-set on completion prevents concurrent older workers regressing it. Small service-only RPCs, deny-all RLS, no service DELETE grants, pinned search paths, revoked public/anon/authenticated execution.
2. Small modified-order write RPC accepts at most 20 normalized orders. Compare payments against current snapshot by indexed order identity (stable sort by payment GUID). Skip unchanged and older versions; missing order with payments is eligible. For each changed order, call existing page/finish with one order and an atomic manifest transition to new terminal status `modified_completed`. This status explicitly does not prove full-day coverage. A bounded transaction means no intermediate completed manifest is visible. Snapshot and pointer rules remain centralized in 0221. Re-emit 0222 claim with only the discovery exclusion; filter capture.ts debounce diagnostics likewise.
3. `lib/toast/capture-modified.ts` plus pure window/normalization helpers: fixed maximum pages/windows, abortable provider and DB work, safe errors, no raw payload persistence/logs. Per-call DB timeout under eight seconds (SQL statement timeout five seconds, lock timeout one second). Persist allowlisted orders in batches of 20. Only advance after terminal short page and every save succeeds. Duplicate upstream order GUIDs fail the window; retries are idempotent.
4. Integrate as a fail-soft step in the existing pinger after intraday capture, capped at 20 seconds and remaining route budget after labor reserve. Each shop gets an independent bounded share; failure cannot prevent labor or response. Leave full-day capture's existing 45-second behavior intact. Expose modified outcome and safe failure counts.
5. Sales loader/DTO and `SalesSummary.tsx`, en/es: read per-shop successful watermark before reading financial totals, so a concurrent sweep cannot advertise coverage newer than displayed totals. Optional unavailable/missing schema degrades to current caveat. Show coverage START and THROUGH with localized dates/times; keep “Refunds captured so far” and explicit pre-bootstrap limitation.
6. Tests: window boundaries/bootstrap/retry/CAS, late old-order refund, unchanged overlap no duplicate, failure/page cap no watermark, cancellation and route reserve; authorization/fallback/coverage ordering. SQL sim-only rollback harness for actual existing RPC composition, pointer precedence, untouched unrelated orders, full-day coverage/debounce isolation, grants and cursor CAS. Full `npm test`, `npm run typecheck`; focused lint/build as appropriate.

## Risks / rollout

- Bootstrap is not historical completeness. Pre-bootstrap modifications remain limited to existing captured evidence; UI must say so.
- Toast pagination is not a durable checkpoint. Fixed windows, overlap and page-one retries bound risk; provider changes with unbounded ingestion delay cannot be guaranteed by polling.
- Per-call performance must be measured on sim; no local mock can establish production latency. Do not apply migration here. CC runs harness + representative EXPLAIN/latency checks under the eight-second deployment limit.
- Review required before code under charter; CC final cross-family review remains required before any commit.

## Review record and implementation status

CC approved this plan as written on 2026-10-08 and instructed implementation without retrying the unavailable review network. The earlier third-seat `SEAT FAILED` records (WinError 10013) remain beside this plan as history; they are not an outstanding pre-code gate. Implementation is now authored and uncommitted. Migration 0237 and the sim-only rollback harness are authored but NOT applied/executed. CC remains the final cross-family reviewer before commit.

Baseline verification (unchanged application code):

```text
npm.cmd test -- --reporter=dot
382 files passed, 1 failed; 5995 tests passed, 1 skipped, 1 failed.
Failure: tests/vendor-exports-catalog-joins.test.ts:43, 30000 ms timeout.

npm.cmd test -- tests/vendor-exports-catalog-joins.test.ts --reporter=dot
PASS: 1 file, 4 tests (10.15 s total).

npm.cmd run typecheck
FAIL: six TS2307 errors for leaflet/dist/images/*.png imports.
components/admin/catering/fulfillment/ZoneMap.tsx:24-26
components/order/DeliveryRouteMap.tsx:6-8
```

Logs are at repository root: `late-refund-baseline-tests.log`, `late-refund-baseline-retry.log`, `late-refund-baseline-typecheck.log`. Review failure records are beside this plan.

## Implementation handoff

Implementation details, final verification, rollout limits, and the ready-to-use PR body are in `2026-10-08-late-refund-discovery-handoff.md` beside this plan.

The runner uses at most four windows and ten pages per window, batches writes at twenty orders, and caps discovery at twenty seconds with independent shop shares. Each database request has a six-second client deadline; the SQL functions also set five-second statement/one-second lock timeouts. Cursor strings retain PostgreSQL timestamp precision for completion CAS.

Full-day writers/readers retain their existing completed-manifest semantics; discovery publishes `modified_completed` atomically through the existing page/finish writers. The Sales loader reads optional coverage before totals and falls back to the existing caveat on missing schema or transport failure. Date and time use the same operational timezone.
