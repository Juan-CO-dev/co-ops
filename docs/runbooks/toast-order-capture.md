# Toast capture and launch cutover — CC operator runbook

Launch scope approved for 2026-10-13. Astra has not applied schema, accessed production data, changed flags or deployed. CC owns sim execution, parity review and rollout. Migration 0220 belongs to digests; capture uses 0221 and launch uses 0222.

## Stage A: capture alongside the existing pipeline

Use the saved `stage-a.patch` and exact file list in `.claude/astra-dispatches/toast-cutover/stage-a.md`, based on reviewed plan HEAD `aedbd93` (based on main `0f48836`). The final worktree also contains B/C; use the patch to ship A separately. Apply the **whole final additive 0222 migration once**, including dormant depletion tables, so later stages do not alter an applied migration.

Apply 0221 and 0222 to sim first. Execute each entire SQL harness as one request, or use `psql -v ON_ERROR_STOP=1 -f <file>` against the approved sim target:

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

# Rebuild completed closed days; replace bounds with actual captured history.
node --conditions=react-server --import tsx scripts/backfill-toast-depletion.ts 2025-10-06 2026-10-06
```

Only 2026-07-23..2026-10-06 has comparable legacy evidence. Earlier completed dates receive completeness checks, not parity claims. The gate feeds legacy and capture rows into the same consumption derivation using current mappings and recipes. Output has counts and quantities, not customer payloads. Buckets: phantom, legacy-missed, note-descendant, edited-after-legacy-pull. **Whole orders missing without evidence and unexplained shared-key mismatches must both be zero**; opposing quantity errors cannot cancel. Missing coverage, stale config or derivation failures fail the script. Historical depletion is a current-recipe estimate.

The missing-pointer metric counts pointers absent from that date's latest completed full-day run. Inspect it after T-1..T-3 recaptures. Default retains those pointers. CC decides whether to set `TOAST_CAPTURE_ABSENCE_REMOVAL=1`; if enabled, rebuild affected materializations and rerun the gate. This flag is separate from reader activation.

## Stages B/C: activate readers and retire the writer

Deploy B/C after CC's cross-family review, sim RPC gate, read-only production parity, complete historical rebuild and preview checks. Set `DEPLETION_SOURCE=capture` after the gate passes; default remains legacy. Final C removes the legacy Orders API writer, so leaving the default indefinitely leaves legacy-backed readers stale. That intermediate state is not a completed rollout.

Capture depletion atomically replaces raw direct SKU rows, recipe-path attribution and a success manifest per location/date, tied to the completed run. Empty days still get success coverage. Readers reject stale/missing/mixed publication and resolve fallback against live production: sales count unless the item or a nested prep on its path has logged production on that ET day. Sales use Toast business dates. Production inputs continue counting. Ancestor/descendant production overlap is diagnostic. Pars retain lane start, trailing windows and shadow-only behavior. Materialization also maintains existing sales signals and resolution-flip observations.

Final nightly order is all T-1..T-3 captures, then materialization, then shadow pars. Capture phase has one 180-second deadline within the 300-second route. Pars require exact completed capture and successful materialization after reader activation. Pinger uses full-day capture, not a modified-time cursor. Existing scheduler URLs/job-watch identities remain with updated semantics.

Pulse sums eligible check `amount_cents` as **net sales (pre-tax)**; no selection-price/modifier summation. Deleted/voided/excess-food orders and deleted/voided checks are excluded. Units come from eligible selections. Missing check amounts produce unavailable data, never false zero.

After finish succeeds, that request classifies in-memory raw orders through dining-option GUID → cached option → reviewed channel map and writes the existing restricted catering ledger/intake path. No new customer table. Catering scan reads capture health and the ledger; it makes no Toast calls. Stale/missing config, interrupted processing and unresolved house-lead reclassification surface as degraded. Reclassification updates stored order facts but preserves linked human work for review. Today/yesterday catering captures must be fresh; completed capture alone does not prove catering completion.

Caches refresh hourly and consume every config page. Unknown/unreviewed labels require review; never infer channels/providers by substring. Payloads may contain customer/staff-entered text: never log them. Source publication retains modified-time ordering; older or failed runs cannot replace newer pointers.

## Rollback and deferred work

Set `TOAST_ORDER_CAPTURE=0`, perform Vercel instant rollback to the known-good legacy deployment, then invoke that deployment's authenticated nightly `?date=YYYY-MM-DD` for each gap day. The kill switch alone does not restore the deleted writer. Preserve `toast_sales_events` write grants through rollback; launch 0222 does not revoke them.

Week 1 / 0223: modifiedDate cursor, durable backlog, lease/fencing, immutable generations, selection schema v2 and snapshot-linked catering projection. Week 2 / 0224, day 7+: revoke legacy grants after CC closes rollback. Full-day API volume, retention and deployment timing remain operational checks. Local unit tests do not claim live/provider or SQL execution.
