# Toast order capture — CC operator runbook

Migration 0221 is authored, not applied. Apply and test on sim first; CC/Juan own production application. Activation order: **apply 0221 -> deploy -> set `TOAST_ORDER_CAPTURE=1`** (CC enables it after production schema verification). Capture defaults off. Disable it by removing/clearing the flag; selection ingestion, depletion, pars and the pinger continue unchanged. Fixture mode (`TOAST_FIXTURES=1`) and absent credentials return a neutral skipped result without capture DB writes. Missing schema returns skipped with `capture_schema_missing` in the independent capture failure heartbeat; it never fails the selection pull.

After applying 0221 to sim, submit the **entire** `scripts/test-toast-capture.sql` as one Management-API SQL request (BEGIN, DO, ROLLBACK). Every failed assertion raises an exception, even with PL/pgSQL assertions disabled. Success rolls back fixtures; failure aborts the transaction. Alternatively run `psql` against the approved simulation connection with `-v ON_ERROR_STOP=1 -f scripts/test-toast-capture.sql`. The harness needs two existing sim locations, uses synthetic orders, and rolls back its writes. It verifies retry deduplication, publication visibility, source-version ordering, later refunds, location binding and grants. This harness remains unexecuted in this fix pass; CC runs it on sim.

Use Node 22 with environment variables already loaded by the approved operator environment. The operator script requires `TOAST_ORDER_CAPTURE=1`, live credentials, and fixture mode off; disabled/fixture probes are not evidence of retention. The script never reads `.env.local` or prints credentials or source payloads. Do not run these commands from an environment pointing to production until CC has approved the target. This authoring session does not execute live commands.

```powershell
# Read-only retention probe at 2025-10-01 for each active Toast-configured location.
node --conditions=react-server --import tsx scripts/backfill-toast-orders.ts probe

# Read-only export of distinct existing dining labels for CC/Juan's mapping review.
node --conditions=react-server --import tsx scripts/backfill-toast-orders.ts channel-seed

# Probes first, then captures yesterday ET back through 12 calendar months earlier (inclusive).
# Newest first; skips completed dates.
node --conditions=react-server --import tsx scripts/backfill-toast-orders.ts backfill

# Explicit window; --from / --through accept YYYY-MM-DD (at most 366 days apart).
node --conditions=react-server --import tsx scripts/backfill-toast-orders.ts backfill --from 2026-07-23 --through 2026-10-06

# Explicitly revisit completed dates (e.g. to refresh late refunds/corrections).
node --conditions=react-server --import tsx scripts/backfill-toast-orders.ts backfill --retry-completed
```

Run one process. A probe returning orders proves access for that shop/date only. Empty data is inconclusive about retention; it does not prove twelve months of coverage. A denied/malformed probe stops the script before backfill writes. A backfill failure exits nonzero at its first failed day; rerun the same command after resolving it. Ctrl+C finishes the active location/day then stops. Hard termination leaves `running` rows whose pages are invisible to `toast_orders_latest`; resume starts a new attempt at page one. Each subsequent capture sweeps that location's runs still running after 60 minutes to failed (`capture_stale`). Do not manually flip their status to completed.

The manifest carries location/date, page/order counts, start/finish, running/completed/failed status and safe error code. A completed date with zero orders records an empty response, not proof the shop was open or historical API retention is complete. Query manifests per shop before claiming coverage. Current capture does not discover late refunds on old orders automatically; a re-pull of the original business date captures the refund's separate business date. Modified-time/payment discovery and financial reconciliation precede Sales UI launch.

Config GUID/name caches refresh hourly within the process and after restarts; cache errors degrade to missing optional names and do not fail order capture. Open-discount names may be staff-typed: names are retained accounting text, not guaranteed configured vocabulary or PII-free text. Do not log payloads or expose names outside authorized reports. Cache refreshes consume every `Toast-Next-Page-Token`. Channel labels belong to `sales_channel_map`; unknown/unreviewed labels must render `Unknown`. All 18 supplied production labels were reviewed by CC + Juan on 2026-10-07 and are effective in the 0221 seed. Plain Delivery is third_party / null (unknown provider) / delivery; an order's `third_party_provider_name` from `thirdPartyProviderInfo` overrides the label provider when present. DeliverThat is catering / DeliverThat / delivery. App Pickup and App Delivery use provider CO app (the own white-label app, not Toast). Ezcater and EZ Cater both map to catering / ezCater; Catering and Catering- Pick Up map to catering / house. Additional labels imported from the ledger remain Unknown/unreviewed. Never infer a provider from a substring.

Nightly (`cron`) capture runs once per location **after all selection, depletion and par loops**, with one shared 60-second wall-clock deadline. Manual admin pulls also capture; pinger, on-visit and closing triggers stay events-only. Each run owns its queue; abort propagates into Toast authentication, fetch and response-body reads. Inline requests allow one short 429 retry and refuse Retry-After over 5 seconds. Only the backfill script opts into five retries with up to 60-second waits (30-minute per-date budget).

`cron.success` for `toast-sales-pull` and catch-up depends only on selection ingestion. Capture writes a separate `toast-order-capture` heartbeat, including sanitized per-location reasons even before a manifest exists. Job-watch monitors capture on its daily missed-success cadence only when enabled and not in fixture mode; this is not an immediate email for every bad order. Manual attempts use `toast-order-capture-manual` so a one-shop repair cannot mask a missing all-shop nightly run. Deadline failures initiate fail-open audit without extending the deadline; if it cannot persist before request teardown, missed-success monitoring still detects the absent capture success.

`toast_orders_latest` joins a location/order pointer maintained atomically in `toast_capture_finish`. Only completed runs publish. Newer source modified time wins, then run start/id; older or failed captures cannot overwrite the current pointer. Payments preserve payment/refund statuses, nested void date and independent refund date; deleted checks remain captured.

Official contracts checked during implementation: [ordersBulk](https://doc.toasttab.com/openapi/orders/operation/ordersBulkGet/), [config pagination](https://doc.toasttab.com/openapi/configuration/operation/diningOptionsGet/), [discount reason](https://doc.toasttab.com/openapi/orders/tag/Data-definitions/schema/AppliedDiscountReason/), and [payment refunds](https://doc.toasttab.com/openapi/orders/tag/Data-definitions/schema/Refund/).


## Shadow reconciliation and replacement of the legacy pull

After each completed nightly location/date capture, compare the exact normalized snapshots committed by that run with paginated `toast_sales_events` for the same location/business date. The legacy version key is `(check_guid, selection_guid)`; a check-wide maximum would drop unchanged siblings. Capture stores allowlisted `selection_units` with item GUID/name, quantity, selection/check/parent identities and inherited void/deletion flags. Count top-level selections and all nested item modifiers, with no depletion/catering exclusions. Exclude voided lines independently on each side. The old ledger has no deletion flag: use captured deleted-order/check/selection markers to exclude known deletions on both sides. An absent item without a deletion marker remains a mismatch. This is quantity parity, not an independent audit of legacy deletion handling or financial totals.

Refund/payment business dates and amounts never enter this comparison: a later refund must not subtract physical units from the original order's day. The append-only `toast_capture_reconciliations` row binds location/date/run, records match/mismatch/skipped, totals, and up to 50 differing item GUIDs/names/quantities. Item comparisons determine status even when total units agree. No legacy observations means skipped (including an empty day), never a clean match. A legacy read error stores skipped with null totals; a persistence error cannot claim a stored result. The nightly capture heartbeat includes a safe reconciliation status/error and withholds `cron.success` on mismatch or skipped, so the existing job-watch missed-success alert applies. Selection ingestion, depletion and pars remain successful. Manual/backfill captures do not contribute nightly clean-match evidence. All work remains within the shared capture deadline; missing result rows after deadline/storage failure are gaps, not matches.

Cutover, owned by CC/Juan:
1. Launch shadow capture and collect about **two weeks of clean nightly matches at every shop**. Investigate mismatches, skipped days and missing result rows; these do not count toward clean coverage. Check the latest nightly attempt per shop/day so a retry cannot hide an unresolved gap.
2. Switch depletion, pars, pulse and the catering scan to readers of the new capture tables; replace the intraday pinger with an incremental `modifiedDate` pull into capture (including discovery of later changes/refunds). Review the selection reader schema and prove consumer parity before switching. No readers switch in this PR.
3. Retire the old selection pull after those consumers and incremental capture are verified. The old pull is being replaced in stages, not maintained as a permanent second source.
