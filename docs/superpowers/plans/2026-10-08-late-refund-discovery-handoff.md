# Late refund discovery — implementation handoff

Branch: `feat/late-refund-discovery` in `C:/Users/conta/co-ops-refunds`.
Changes are UNCOMMITTED. No git writes, pushes, merges, migrations applied, or production access.
CC approved the implementation plan on 2026-10-08; final CC diff review remains outstanding.

## Changes and anchors

- `supabase/migrations/0237_toast_modified_capture.sql:6`: per-shop cursor with persisted bootstrap start, fixed retry bounds, exclusive successful watermark, service-only RPCs and deny-all RLS. Begin at line 28; completion CAS at 46; payment comparison/save at 56; minimally re-emitted debounce claim at 98; grants at 121.
- `lib/toast/capture-modified.ts:15`: six-second individual DB deadline; `:27` bounded sweep, payment-normalized batches of twenty, terminal short-page requirement, duplicate GUID rejection, cursor CAS; `:75` twenty-second invocation and independent per-shop shares. Maximum four windows, ten pages/window. Raw provider/customer objects never persist or enter error output.
- `lib/toast/capture-modified-shared.ts:12`: pure fixed-window validation; normalization preserves the original order business date; exact cursor timestamp strings survive the return trip to Postgres. `:39` route budget reserves labor and response time.
- `app/api/cron/toast-sales-today/route.ts:40`: additive discovery after intraday capture; `:62` safe failure/change counts. Existing pinger health continues to describe the primary sales pull; the `modified` response and `modified_failures` audit field expose additive degradation.
- `lib/toast/capture.ts:123`: discovery manifests excluded from the latest debounce diagnostic.
- `lib/sales-reports.ts:95`: optional cursor read precedes financial totals; `:111` schema/error/transport fallback and six-second request abort. Existing role/shop authorization remains before I/O.
- `lib/sales-reports-shared.ts:613`, `components/reports-hub/SalesSummary.tsx:29`, `lib/i18n/en.json:167`, `lib/i18n/es.json:167`: coverage start/through (or initial pending state), localized in the operational timezone, with explicit pre-bootstrap limitation. Keeps “Refunds captured so far.”
- Tests: `tests/toast-capture-modified.test.ts`, `tests/toast-modified-migration.test.ts`, and updates to capture persistence/route-budget and Sales loader/page tests.

## Verification

```text
npm.cmd test -- --reporter=dot
385 files passed; 6023 tests passed, 1 skipped. Exit 0.
Log: late-refund-tests-verified.log (native process exit explicitly propagated)

npm.cmd run typecheck
Exit 1: ONLY six pre-existing Leaflet PNG TS2307 errors (ignored per dispatch).
ZoneMap.tsx:24-26; DeliveryRouteMap.tsx:6-8.
Log: late-refund-typecheck.log

"C:/Program Files/Git/bin/bash.exe" scripts/phase2-discipline-check.sh
PASS. Log: late-refund-discipline.log

git diff --check
PASS.

.\node_modules\.bin\eslint.cmd <all 13 changed TypeScript/TSX files>
PASS, exit 0; no diagnostics. Log: late-refund-lint.log
```

The earlier full-suite run failed the new Spanish date assertion (`7 oct` versus the formatter's `7 de oct`). The assertion was corrected; the final full-suite run above is green. Initial log retained as `late-refund-tests.log`.

Focused tests cover old-order refund normalization, successful completion ordering, retry from page one, unchanged overlap, cursor conflict, twenty-order batches, duplicate/page/window limits, DB/provider cancellation, shop shares, route/labor reserve, kill switch, schema fallback, Sales authorization/read ordering, transport rejection, and midnight-localized dates. SQL-source tests pin the existing claim body and writer composition; they do not prove database execution.

## SQL harness and rollout limits

`scripts/test-toast-modified-capture.sql:1` is a sim-only rollback harness, **not executed here**. It requires 0237 on sim, migration-owner access, the sim sentinel, and a pristine modified cursor for the selected shop. It checks real page/finish composition, late refund visibility at the latest pointer, stable payment ordering, unchanged retry, stale source precedence, preserved unrelated orders, full-day coverage/debounce isolation, limits, grants, bootstrap, retry, lag, overlap, and completion CAS.

CC must run the harness and representative indexed-query/transaction latency checks on sim before rollout. No `psql` or Docker executable was available in this environment. The five-second function `statement_timeout` setting is defense in depth: PostgreSQL does not start a new statement timer merely by entering a function. Client calls abort at six seconds, lock waits at one second; actual DB execution latency remains unmeasured. No production data was read or written.

Migration is additive and optional-schema-safe for the app. Apply 0237 after sim verification, then enable through the existing `TOAST_ORDER_CAPTURE` gate; fixtures remain disabled for discovery. No new secret or feature flag is required. Bootstrap starts only 24 hours before the first invocation, catches up in bounded windows, and does not claim older modifications are complete. A failed window retains both bounds and retries from page one. Partial saved orders can be visible before a window completes; the watermark remains at the last completely swept window. Provider ingestion delays beyond the one-minute overlap remain a polling limitation.

Author verification considered BC-001/025 (authorization and shop binds), BC-006/010 (bounded reads), BC-007/037 (cursor concurrency and atomic publication), BC-008 (timezone fix), BC-013/031/036 (partial discovery versus full-day coverage), BC-023 (grants/RLS), BC-030/032/033 (provider contract, safe errors, watermark evidence), and BC-038/043 (rollout and independent review). This is not a substitute for CC's cross-family final review.

Provider query semantics were checked against [Toast ordersBulk documentation](https://doc.toasttab.com/openapi/orders/operation/ordersBulkGet/): start is inclusive, end exclusive, and modification windows use both parameters with no businessDate filter. Toast offers no payment-only filter here; the database compares normalized payment state before persisting changed orders.

## PR body

Refunds applied today to older Toast orders could fall outside every business-date polling window. Add bounded per-shop modified-date discovery that compares normalized payments, publishes changed orders through the existing immutable capture writers, and advances coverage only after a complete successful window. Discovery manifests cannot establish full-day coverage or suppress the ordinary capture debounce.

The pinger allocates at most twenty seconds after intraday capture while preserving labor/response time. Sales shows localized discovery start/through dates in English and Spanish, retains “Refunds captured so far,” and explicitly warns that pre-bootstrap refunds may be missing. Optional schema/transport failures retain the existing caveat.

Validation: 385 test files passed (6023 tests, one skipped); focused lint, discipline check, and whitespace check passed. Typecheck reports only the six previously known Leaflet PNG TS2307 errors. Migration 0237 and the sim-only rollback harness are included but unapplied/unexecuted; sim correctness and sub-eight-second DB latency are rollout gates. CC final review required before commit.
