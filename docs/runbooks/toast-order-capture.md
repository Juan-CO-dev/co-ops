# Toast order capture — CC operator runbook

Migration 0221 is authored, not applied. Apply and test on sim first; CC/Juan own production application. The app must deploy after the migration: capture is active in the existing Toast pull, and a missing schema produces a failed capture heartbeat.

After applying 0221 to sim, run `psql` against the approved simulation connection with `-v ON_ERROR_STOP=1 -f scripts/test-toast-capture.sql`. The harness needs two existing sim locations, uses synthetic orders, and rolls back its writes. It verifies retry deduplication, publication visibility, source-version ordering, later refunds, location binding and grants. No local PostgreSQL executable was available in the authoring environment, so this harness is supplied but unexecuted.

Use Node 22 with environment variables already loaded by the approved operator environment. `TOAST_FIXTURES=1` and missing Toast credentials are refused. The script never reads `.env.local` or prints credentials or source payloads. Do not run these commands from an environment pointing to production until CC has approved the target. This authoring session does not execute live commands.

```powershell
# Read-only retention probe at 2025-10-01 for each active Toast-configured location.
node --conditions=react-server --import tsx scripts/backfill-toast-orders.ts probe

# Read-only export of distinct existing dining labels for CC/Juan's mapping review.
node --conditions=react-server --import tsx scripts/backfill-toast-orders.ts channel-seed

# Probes first, then captures 2026-07-22 down through 2025-07-23; skips completed days.
node --conditions=react-server --import tsx scripts/backfill-toast-orders.ts backfill

# Explicitly revisit completed dates (e.g. to refresh late refunds/corrections).
node --conditions=react-server --import tsx scripts/backfill-toast-orders.ts backfill --retry-completed
```

Run one process. A probe returning orders proves access for that shop/date only. Empty data is inconclusive about retention; it does not prove twelve months of coverage. A denied/malformed probe stops the script before backfill writes. A backfill failure exits nonzero at its first failed day; rerun the same command after resolving it. Ctrl+C finishes the active location/day then stops. Hard termination leaves `running` rows whose pages are invisible to `toast_orders_latest`; resume starts a new attempt at page one. Do not manually flip their status to completed.

The manifest carries location/date, page/order counts, start/finish, running/completed/failed status and safe error code. A completed date with zero orders records an empty response, not proof the shop was open or historical API retention is complete. Query manifests per shop before claiming coverage. Current capture does not discover late refunds on old orders automatically; a re-pull of the original business date captures the refund's separate business date. Modified-time/payment discovery and financial reconciliation precede Sales UI launch.

Config GUID/name caches refresh hourly within the process and after restarts. They consume every `Toast-Next-Page-Token`. Channel labels belong to `sales_channel_map`; unknown/unreviewed labels must render `Unknown`. Seed review must cover the actual production label export (approximately 29 per dispatch); this checkout cannot verify that list. Never infer providers from arbitrary label substrings. Stamp `reviewed_at` only after CC/Juan review.

Operational failures withhold healthy Toast cron/pinger heartbeats. The existing job watcher alerts on its established missed-success cadence; this is not an immediate email for every bad order. Successful selection ingestion still feeds depletion even if order capture fails. A legacy selection-ingest failure before capture also delays capture until a retry.

Official contracts checked during implementation: [ordersBulk](https://doc.toasttab.com/openapi/orders/operation/ordersBulkGet/), [config pagination](https://doc.toasttab.com/openapi/configuration/operation/diningOptionsGet/), [discount reason](https://doc.toasttab.com/openapi/orders/tag/Data-definitions/schema/AppliedDiscountReason/), and [payment refunds](https://doc.toasttab.com/openapi/orders/tag/Data-definitions/schema/Refund/).
