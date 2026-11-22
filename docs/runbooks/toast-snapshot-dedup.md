# Toast duplicate snapshots: the cleanup (churn fix PR 2, migration 0351)

Plan: CHIEF `03-PROJECTS/co-ops/2026-11-15-juan-product-notes/toast-churn-cleanup-plan-r6.md`. PR 1 (`docs/runbooks/toast-hash-canonical.md`) stopped new duplicates. This removes the old ones. Owner of every step: **CC**. Prod steps only on Juan's word. Nothing in the app calls any of this: every function is postgres-only (no EXECUTE for `service_role`).

## What it is

- Before PR 1, the same Toast order content was stored again and again under different hashes. On prod (read 2026-11-19): 504,350 snapshots, about **205,600** of them exact duplicates, all with business dates from 2026-10-01 on.
- **A duplicate** = two snapshots of one (shop, order, business day) whose stored content is equal after ignoring only storage identity (`toast_orders.id`, `content_hash`, the children's `snapshot_id`), array order, and the made-up ordinals of discounts and service charges. It is the same rule the acceptance checks use (`scripts/toast-hash-acceptance.sql`).
- **Not duplicates, never touched:**
  - the 2025-10 to 2026-09 pairs (same `modified_at`, different content: the second capture carries more detail);
  - a payment that went from AUTHORIZED to CAPTURED;
  - a real older version of an order.
- **Never deleted, whatever the content:**
  - the latest snapshot of an order (the pointer target);
  - any snapshot an ezCater link names, current or retired;
  - any snapshot named in a uuid column whose name contains `snapshot` (house catering links and conflicts, the fact tables, and any column a later migration adds);
  - any snapshot id written in jsonb in `audit_log` or a `toast_` / `ezcater_` / `catering_toast_` / `fact_` table;
  - the survivor of an earlier cleanup.
- **What stays of a deleted snapshot:** its row in `toast_snapshot_registry` (id, shop, order, business day, original hash, `modified_at`, when it was deleted, which snapshot holds the same content, which manifest) and **every run membership**, untouched. Capture runs reference the registry, not `toast_orders`.

## Order of operations

1. **Apply 0351** (sim first, then prod). It deletes nothing. It creates the registry, copies every snapshot into it, adds the register trigger, and moves the membership foreign key to the registry.
   - Window: **04:00–08:45 UTC**. No capture, reconcile or fact job runs then.
   - Locks: `toast_orders` write-blocked for the whole file (capture waits); at the very end, a short ACCESS EXCLUSIVE on `toast_capture_run_orders` and `toast_orders` (readers wait for milliseconds). Both lock steps are bounded loops of 100 ms attempts that release what they took on failure, so the cutover never deadlocks with a reader (the old single upgrade did: `scripts/sim/toast-dedup-cutover-lock-check.mjs`, X1). If a step cannot get its locks in 30 s the file refuses `0351: lock_busy (step N, …)` and nothing changes; run it again.
   - The prepared script does a dry run first (everything rolled back) and prints the locks and the time.
2. **Build a manifest**, in the same quiet window as the apply of its batches (see "Why one window"):
   ```sql
   select public.toast_snapshot_dedup_begin(1, '<cutoff>');              -- cutoff <= UTC today - 5
   select public.toast_snapshot_dedup_build_range(1, '<from>', '<to>');  -- repeat until every day up to the cutoff is covered
   select public.toast_snapshot_dedup_finish(1, 2000);                   -- 2000 = snapshots per batch
   ```
   - Each `build_range` call must finish inside the Management API's 2 minutes: about 0.4 ms per snapshot. Use one call per quarter up to 2026-09-30, then ten days per call.
   - `finish` returns the **digest** and the **totals** (snapshots, checks, discounts, service charges, payments, per month). Nothing has been deleted yet.
3. **Juan stamps** the digest and the totals. The apply script takes them as arguments and refuses anything else.
4. **Apply batch by batch**, lowest first:
   ```sql
   select public.toast_snapshot_dedup_apply(1, '<digest>', <batch>, '<that batch''s counts as jsonb>');
   ```
   One transaction and one `toast.snapshot_dedup` audit row per batch. After each batch: `select public.toast_snapshot_dedup_verify(1);` must say `"ok": true`.
5. **After the last batch:** verify again, then the parity checks below, then `VACUUM (ANALYZE)` on the five payload tables (no exclusive lock).

## Why one window

A few writers save a snapshot id with no foreign key (the house catering link, the fact rows). Each takes the id from the latest pointer inside its own transaction. The apply proves no such transaction can be holding a candidate's id:
- each listed order still has the very pointer row the build read, same snapshot and same run (`candidate_order_pointer_moved`);
- no other transaction is older than the manifest's build (`open_transaction_older_than_manifest`).

The apply checks this **before** it scans for references, each scan is a later statement, and no scan is limited to "recent" rows. So a reference committed by a transaction that ended just before the check is seen by the scans, whatever timestamp its row carries.

So if the intraday capture or a backfill runs between `begin` and a batch and touches an old order, that batch refuses. Then: `select public.toast_snapshot_dedup_abandon(1);` and build version 2. Batches already applied stay applied and recorded.

## Refusals (the apply deletes nothing when it refuses)

| Refusal | Meaning | What to do |
|---|---|---|
| `dedup_busy` | Capture holds `toast_orders` for more than 5 s | Run the batch again |
| `digest_mismatch`, `expected_mismatch` | The stamped digest or counts are not this manifest's | Stop. Check what was stamped |
| `batch_out_of_order`, `batch_already_applied`, `batch_not_found` | Batches go lowest first, once | Apply the lowest unapplied batch |
| `manifest_not_built`, `manifest_not_found` | No built manifest with that version | Finish the build |
| `candidate_now_target`, `candidate_now_linked`, `candidate_now_survivor`, `candidate_now_evidence` | Something names a listed snapshot now | Abandon, build the next version |
| `candidate_in_running_run`, `candidate_order_pointer_moved` | A capture touched a listed order after the manifest was built | Wait for the quiet window; abandon, build the next version |
| `open_transaction_older_than_manifest`, `prepared_transaction_open` | A transaction older than the manifest is still open | Find it in `pg_stat_activity`; when it ends, run the batch again |
| `cannot_see_transactions` | The function's owner cannot read `pg_stat_activity` in full | Stop and report |
| `isolation_not_read_committed` | The apply was called inside a REPEATABLE READ or SERIALIZABLE transaction | Call it on its own, as the prepared script does |
| `content_changed`, `content_not_equal` | A listed snapshot or its survivor is not what was listed | Stop and report. This should be impossible |
| `candidate_missing`, `survivor_missing`, `manifest_count_mismatch`, `registry_stamp_mismatch`, `delete_count_mismatch` | The rows are not the manifest's | Stop and report |
| `snapshot_fk_census_changed` | A new table references `toast_orders` or `toast_order_checks` | Stop: the equivalence must learn about that table first |

Build refusals: `cutoff_too_recent`, `manifest_in_progress`, `manifest_version_exists`, `manifest_not_building`, `invalid_range`, `range_past_cutoff`, `range_already_built`, `build_incomplete`, `invalid_batch_size`.

## Verify

`toast_snapshot_dedup_verify(version)` is read-only. Each check has its own `ok`:

| Check | It proves |
|---|---|
| `identity` | Every snapshot has its registry row; a registry row has no payload only if it is stamped deleted; no registry row is gone |
| `memberships` | No run lost a membership (per-run baseline from `begin`; a run still running then may have grown); every completed run still has exactly `runs.orders` memberships, which is what the app's readers require |
| `payload` | Exactly the applied batches are gone, parents and children |
| `survivors` | Each deleted snapshot's survivor exists and still holds the stamped content |
| `targets` | Every pointer target and every link target has its payload |
| `audit` | One audit row per applied batch |

**Parity, before the first batch and after the last** (same query, the results must be identical):
- B0 (a)–(e) from `docs/runbooks/toast-line-prices.md`, over the manifest's dates;
- `select * from public.ezcater_current_toast_links order by 1, 2, 3, 4, 5`;
- `sales_report_daily` for each shop over the manifest's months.

B0 (f) (snapshot count per shop and day) is **expected to drop** by exactly the manifest's count for that day (`toast_snapshot_dedup_days.items`).

## Readers after the cleanup

- The app reads payload only for pointer targets, and counts memberships from `toast_capture_run_orders` alone. Nothing changes for it.
- `scripts/toast-hash-acceptance.sql` and the line-price violation query read a snapshot's identity from the registry and its content from the survivor, so a deleted twin still counts.
- `scripts/toast-line-price-canary.ts` reads stored hashes from the registry, which keeps every original hash.
- A query of your own that joins `toast_capture_run_orders` to `toast_orders` now drops the memberships of deleted snapshots. Join `toast_snapshot_registry` instead.

## Rollback

- **0351, before any batch:** reversible. Drop the trigger, put the 0221 foreign key back on `toast_capture_run_orders`, drop the seven `toast_snapshot_*` tables and the twelve functions.
- **After a batch:** a deleted payload does not come back. Its content is still in its survivor; what is lost on purpose is Toast's array order and the made-up ordinals. The only way back to the exact rows is a backup or point-in-time restore. **CC confirms one exists before the first prod batch.**

## Storage

- `DELETE` does not shrink the files. After `VACUUM`, the space is free **inside** the five payload tables and is reused by new snapshots. The disk figure in the Supabase dashboard does not go down.
- Shrinking the files (`VACUUM FULL`, `pg_repack`) is a separate decision for Juan: it blocks reads or needs spare disk.
- The registry is new storage: one narrow row per snapshot ever created.
- `toast_capture_run_orders` (one row per order per run) is kept whole on purpose.

## Not done here

- Deleting the enrichment pairs ("keep the newer capture"): a separate Juan decision with its own manifest.
- The content-based canary (`canonicalHashFromStored`): not needed for the cleanup, because the canary reads the registry's hashes.
