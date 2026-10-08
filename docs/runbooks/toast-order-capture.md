# Toast capture and launch cutover — CC operator runbook

Stage A historical behavior: migration 0221 is APPLIED TO PROD (2026-10-07, version 20261007234649; sim first). Activation order: **apply 0221 -> deploy -> set `TOAST_ORDER_CAPTURE=1`** (CC enables it after production schema verification). Capture defaults off. Disable it by removing/clearing the flag; selection ingestion, depletion, pars and the pinger continue unchanged. Fixture mode (`TOAST_FIXTURES=1`) and absent credentials return a neutral skipped result without capture DB writes. Missing schema returns skipped with `capture_schema_missing` in the independent capture failure heartbeat; it never fails the selection pull.

After applying 0221 and the revised 0222 to sim, submit the **entire** `scripts/test-toast-capture.sql` as one Management-API SQL request (BEGIN, DO, ROLLBACK). Every failed assertion raises an exception, even with PL/pgSQL assertions disabled. Success rolls back fixtures; failure aborts the transaction. Alternatively run `psql` against the approved simulation connection with `-v ON_ERROR_STOP=1 -f scripts/test-toast-capture.sql`. The harness needs two existing sim locations, uses synthetic orders, and rolls back its writes. It verifies retry deduplication, publication visibility, source-version ordering, later refunds, location binding and grants. Both reviewed SQL harnesses are preserved; Astra did not execute them in this merge session.
Launch scope approved for 2026-10-13. Astra has not applied schema, accessed production data, changed flags or deployed. CC owns sim execution, parity review and rollout. Migration 0220 belongs to digests; capture uses 0221 and launch uses 0222.

## Stage A: capture alongside the existing pipeline

Reviewed Stage A is `7cad2da` (PR #401, APPROVED). Final 0222 is applied to SIM as **20261008011108**, not production. B/C preserves that reviewed SQL exactly; only its SIM header was corrected. Do not re-apply or revise 0222 for this merge. The original 20261008005718 revert script remains historical and refuses the final signature/version.

Execute each entire SQL harness as one request, or use `psql -v ON_ERROR_STOP=1 -f <file>` against the approved sim target:

- `scripts/test-toast-capture.sql`: synthetic orders through real page/finish RPCs, source ordering, publication, grants, nonzero depletion, invalid replacement rollback and successful zero-row coverage.
- `scripts/test-toast-capture-debounce.sql`: real claim/page/finish calls, running exclusion and five-minute debounce.

Harnesses roll back fixtures and raise on failures. The first requires existing sim locations, an item and a SKU. Neither was executed in this authoring session.

After schema verification, deploy Stage A and set `TOAST_ORDER_CAPTURE=1`. Capture defaults off; fixture mode and absent credentials skip. Stage A retains legacy ingestion, depletion and pars. Pinger captures today/yesterday under a shared 45-second deadline; the database claim skips a running or recently finished attempt. Nightly adds T-1..T-3 after its existing pipeline. Capture errors have separate health evidence and never invalidate legacy ingestion success. Nightly exports `maxDuration=300`.

## History and read-only gate

Use Node 22 with credentials injected by the approved operator environment. Scripts do not read env files or print source payloads. These commands are operator instructions, not authorization for Astra to execute against production.

```powershell
# Read-only retention probe; empty is inconclusive.
node --conditions=react-server --import tsx scripts/backfill-toast-orders.ts probe

# Read-only export for channel-map review.
node --conditions=react-server --import tsx scripts/backfill-toast-orders.ts channel-seed

# Capture history; one process, newest first, skips completed dates.
node --conditions=react-server --import tsx scripts/backfill-toast-orders.ts backfill

# Revisit complete days to refresh correction/absence evidence.
node --conditions=react-server --import tsx scripts/backfill-toast-orders.ts backfill --from 2026-07-23 --through 2026-10-06 --retry-completed

# READ ONLY: overlap parity plus completeness for older captured dates.
node --conditions=react-server --import tsx scripts/reconcile-toast-cutover.ts

# Rebuild only the approved overlap until Supabase Pro.
node --conditions=react-server --import tsx scripts/backfill-toast-depletion.ts --from 2026-07-23 --through 2026-10-06
```

Only 2026-07-23..2026-10-06 has comparable legacy evidence. Earlier completed dates receive completeness checks, not parity claims. The gate feeds legacy and capture rows into the same consumption derivation using current mappings and recipes. Output has counts and quantities, not customer payloads. Buckets: phantom, legacy-missed, note-descendant, edited-after-legacy-pull. **Whole orders missing without evidence and unexplained shared-key mismatches must both be zero**; opposing quantity errors cannot cancel. Config and channel-label diagnostics are reported separately and never fail correctness. Missing capture or read/derivation failures still prevent a valid comparison. Historical depletion is a current-recipe estimate. Rebuild emits one summary audit for the requested window; degraded publications are counted separately from failures and do not fail the command. Until Supabase Pro, CC limits the rebuild to **2026-07-23 through 2026-10-06**.

The missing-pointer metric counts pointers absent from that date's latest completed full-day run. Inspect it after T-1..T-3 recaptures. Default retains those pointers. CC decides whether to set `TOAST_CAPTURE_ABSENCE_REMOVAL=1`; if enabled, rebuild affected materializations and rerun the gate. This flag is separate from reader activation.

## Stages B/C: activate readers and retire the writer

With the flag OFF, nightly (`cron`) capture runs for businessDate once per location **after all legacy selection, depletion and par loops**, with one shared 150-second wall-clock deadline inside the 300-second route. Capture-mode nightly repairs span T-1, T-2 and T-3. Each individual location/date still has a 60-second maximum. Manual admin pulls retain a shared 60-second budget. Stage A added pinger capture after its legacy selection pull. With DEPLETION_SOURCE=capture, Stage C replaces those legacy provider calls with capture triggers. Each run owns its queue; abort propagates into Toast authentication, fetch and response-body reads. Inline requests allow one short 429 retry and refuse Retry-After over 5 seconds. Only the backfill script opts into five retries with up to 60-second waits (30-minute per-date budget).
Deploy B/C after CC's cross-family review, sim RPC gate, read-only production parity, the approved historical rebuild and preview checks. Set `DEPLETION_SOURCE=capture` after the gate passes. While the flag is unset or has any other value, legacy nightly pull/materialization/pars, today's legacy pull and the existing catering scan remain active, with capture alongside them. The flag alone switches to capture writers/readers and restores legacy behavior when unset.

Capture depletion atomically replaces raw direct SKU rows, recipe-path attribution and a success/degraded manifest per location/date, tied to the completed run. Empty days still get success coverage. Readers disclose stale/missing/mixed publication as gaps and retain available partial data, resolving fallback against live production: sales count unless the item or a nested prep on its path has logged production on that ET day. Sales use Toast business dates. Production inputs continue counting. Ancestor/descendant production overlap is diagnostic. Pars retain lane start, trailing windows and shadow-only behavior. Materialization publishes the same sales signals atomically in capture coverage and preserves resolution-flip observations; it leaves legacy signals untouched.

With the flag enabled, nightly order is all T-1..T-3 captures, then materialization, then shadow pars for **businessDate (T-1) only**. Capture phase shares `min(150 seconds, remaining route time - 10 seconds)` across every shop/date within the 300-second route. It skips when that allowance is exhausted. Pars accept current success and degraded materializations; only missing/failed days are gaps. Pinger uses full-day capture, not a modified-time cursor. Existing scheduler URLs/job-watch identities remain with updated semantics.

Pulse sums eligible check `amount_cents` as **net sales (pre-tax)**; no selection-price/modifier summation. Deleted/voided/excess-food orders, gift-card orders and deleted/voided checks are excluded from sales and units. Units come from eligible selections. Missing check amounts produce unavailable data, never false zero.

After finish succeeds, that request classifies in-memory raw orders through dining-option GUID → cached option → reviewed channel map and writes the existing restricted catering ledger/intake path. No new customer table. With the capture flag enabled, catering scan reads capture health and the ledger without Toast calls. Unreviewed labels are per-order diagnostics; interrupted processing and unresolved house-lead reclassification remain health concerns. Reclassification updates stored order facts but preserves linked human work for review. Today/yesterday catering captures must be fresh; completed capture alone does not prove catering completion.

Caches refresh hourly and consume every config page. Unknown/unreviewed labels require review; never infer channels/providers by substring. Payloads may contain customer/staff-entered text: never log them. Source publication retains modified-time ordering; older or failed runs cannot replace newer pointers.

## Rollback and deferred work

Unset `DEPLETION_SOURCE` to restore the legacy writers and readers. If needed, invoke the authenticated nightly `?date=YYYY-MM-DD` for gap days. Capture may continue alongside legacy under `TOAST_ORDER_CAPTURE=1`; its kill switch is independent. Preserve `toast_sales_events` write grants through rollback; launch 0222 does not revoke them.

The reduced launch plan supersedes the earlier two-week shadow/incremental-pinger prerequisite: CC gates activation on sim, parity, historical rebuild and preview evidence above. Incremental capture remains week-one work, not part of this B/C merge.

## Stage A pass 2: debounce, route budget, and SIM provenance

The original 0222 SIM application was 20261008005718. CC reverted that version and applied the final reviewed migration as **20261008011108**. `scripts/sim-revert-0222.sql` is retained exactly from Stage A for provenance, not as an instruction to revert the final SIM schema. It requires the original version/signatures and refuses dependencies or existing `not_catering` data; it never deletes 0221 evidence.

**Do not backfill today or yesterday while the pinger runs.** Pause the pinger first or end the backfill at T-2. The claim RPC serializes by location/date and marks running attempts older than two minutes failed with `capture_stale` before deciding; expired attempts do not impose a fresh debounce delay. A backfill can run for 30 minutes, so sharing its date with this recovery policy is unsafe. Other dates retain the existing 60-minute abandoned-backfill sweep.

`toast_capture_claim(..., p_min_interval interval)` defaults to five minutes and rejects shorter intervals. Today requests five minutes on every pinger tick; yesterday requests one hour. A live attempt blocks both, and a recent finished attempt (including an ordinary failure) enforces the requested interval. The today route keeps `maxDuration=120`; capture gets `min(45 seconds, remaining route time - 10 seconds)` and skips when no time remains. This preserves time for the heartbeat, sibling checks and response, without increasing function duration. Parent cancellation and the timer bound abort-ignoring transports too.

A status-less page RPC transport failure gets exactly one identical replay within the same deadline. SQL/HTTP errors are not replayed. A second transport failure is recorded as `capture_page_transport_failed`; provider/socket payloads are never logged. 0221 makes the replay safe even if the first request committed and only its response was lost.

## Coverage contract for Stages B/C

The replacement RPC requires `p_suspect_check_count`, `p_suspect_qty`, and `p_counted_qty` on every publication, including zero days; no default silently erases these signals. Stage C reads these fields from `toast_depletion_day_coverage` when it stops using legacy `toast_daily_sales_signals`. The reader switches only with `DEPLETION_SOURCE=capture` and accepts current success and degraded coverage, with disclosure. Degraded means a dining-option GUID present that day lacks a cache row or a reviewed channel; config age alone is not degradation. Unmapped/excluded units, poisoned recipes and unresolved prep attribution remain diagnostics. Operational counts, receiving, ordering and the weights board use available partial data and coverage flags; one shop's gap does not fail the weights board.

Capture replaces the legacy global `dining_option` exclusions with the reviewed `sales_channel_map`. In particular, historical global catering labels are classified through the channel map; the flag-off legacy path keeps its existing exclusions. Gift cards are non-food and excluded from sales and depletion. Catering classification is per order: an unreviewed label creates a flagged not-catering row and diagnostic, rather than failing the shop/day or emitting `cron.failure`.

The optional `p_diagnostics` object (default `{}`) carries `unmapped_units`, `excluded_units`, `poisoned_recipes` (IDs only), `mapping_fingerprint`, and `deletion_by_absence_count` from the materializer. Absence counts describe source orders, not SQL cache rows replaced; the materializer must always supply that metric, even when removal is disabled. No contacts or raw provider payloads belong here. `p_status` accepts `success` or `degraded`; degraded requires a nonblank `p_reason`. Each replacement overwrites signals, diagnostics, status and reason together. The RPC adds `attribution_mismatch_sku_count`, comparing summed attribution `sales_oz` with `flattened_oz` per SKU at tolerance 0.000001 oz; a mismatch warns and does not reject the publication. It returns `{aggregate_count, attribution_count, coverage_count}` (coverage_count is one even on an empty day). The migration fails if effective table/RPC grants differ from the intended service-only boundary.

## Free-tier storage estimate (planning model, not measured production growth)

Input: EM 238 + MEP 107 = **345 orders/day**. Unchanged order snapshots are deduplicated, but each capture still appends run/order membership plus indexes. Budget **320 bytes per membership including its indexes**, **4 KB per newly observed order including children/indexes**, and about **0.15 MB/day** for manifests/pages/reconciliation. These are sizing assumptions, not a sampled byte count; revisions, longer selection lists, index page utilization and bloat change actual growth. MB below means decimal MB and covers capture only, excluding the legacy ledger and other app activity.

Assume a 12-hour pinger window, roughly uniform arrivals within it, and one nightly re-pull of each of T-1..T-3. Average today's capture contains half the daily orders. At the route's documented **10-minute tick** (five-minute debounce), memberships/day are `345 * (72/2 + 12 + 3) = 17,595`: about **7.2 MB/day** (EM 4.9, MEP 2.3). If ticks are increased to **every five minutes**, `345 * (144/2 + 12 + 3) = 30,015`: about **11.1 MB/day** (EM 7.6, MEP 3.5). Yesterday's hourly policy saves about **6.6 MB/day** at ten-minute ticks, or **14.6 MB/day** at five-minute ticks, versus recapturing yesterday each tick.

For a 24-hour/five-minute schedule with arrivals spread over that window, `345 * (288/2 + 24 + 3) = 58,995` memberships gives about **20.4 MB/day**. Capturing full days after closing increases the half-day assumption further. Do not read five-minute debounce as a promise of low storage: 77 MB free at the supplied 423/500 MB usage is only roughly **7-11 days** at the 12-hour estimates before other growth. CC should measure per-table `pg_total_relation_size` deltas over a normal day before relying on this forecast. No retention/deletion policy is introduced by this change.
Week 1 / 0223: modifiedDate cursor, durable backlog, lease/fencing, immutable generations, selection schema v2 and snapshot-linked catering projection. Week 2 / 0224, day 7+: revoke legacy grants after CC closes rollback. Full-day API volume, retention and deployment timing remain operational checks. Local unit tests do not claim live/provider or SQL execution.

## Cutover record (2026-10-07)

- 0222 applied to prod (20261008013030); Stage A (#401) + Stages B/C (#403) merged; seed 45 (7 channel labels) on prod; all 25 dining labels reviewed.
- Depletion rebuilt from capture for 2026-07-23..2026-10-06: 152/152 shop-days success, 0 degraded (~13 MB).
- Gate: 150/152 passed. The 2 failures (MEP 2026-08-01, EM 2026-08-06) are test-fixture rows in the legacy ledger (check_guid `check-1`..`check-4`, generic items, written in one instant): the capture is correct and the legacy ledger over-counted those days. Purge them when legacy write grants are retired (0224).
- Intraday capture verified live before the flip (today + yesterday captured at 21:40 ET).
- **Flipped:** Vercel production `DEPLETION_SOURCE=capture` (Juan's word: "switch now"). Rollback = delete the var + redeploy; backfill gap days with the legacy nightly `?date=`.
