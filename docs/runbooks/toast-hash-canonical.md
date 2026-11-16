# Toast canonical content_hash: transition, recovery and acceptance (churn fix PR 1)

Plan: `C:\co\audit\toast-churn-plan-r2.md` §1, §2.3, §2.4. Review: `C:\co\audit\toast-churn-astra-r2.md` (P1 and P2 #4 are fixed here). Owner of every step: **CC**. Prod steps only on Juan's word. All SQL below is read-only. The four checks are in `scripts/toast-hash-acceptance.sql`, run against the real migration SQL by `tests/toast-hash-acceptance-sql.test.ts`.

## What ships

- `toastContentHash` (`lib/toast/content-hash.ts`) hashes `canonicalHashInput` (`lib/toast/capture-shared.ts`). It is still the only hashing site, used by the day capture and the modified sweep.
- The canonical input:
  - has the same field set as `legacyHashInput`;
  - rebuilds every object with an explicit key list;
  - sorts selections, checks, discounts, service charges and payments on copies, with ordinal-free comparators;
  - keeps duplicates;
  - renumbers discount and service-charge ordinals 0..k-1 per check after sorting.
- **The same Toast content in another array order is one hash, so one snapshot.** A real change in any hashed field is still a new hash.
- **An order already in canonical order keeps its legacy hash.** Every other order gets **one** new snapshot the first time its business day is recaptured after deploy: the transition. Real Toast GUIDs are random, so most orders with two or more selections are in this group.
- **Stored rows do not change.** Snapshots keep their original array order and ordinals, and no snapshot is rewritten or deleted. Deleting the duplicates is PR 2 (`C:\co\audit\toast-churn-cleanup-plan-r3.md`).
- No migration, no env flag, nothing visible to staff or customers.
- Not in this PR: plan r2 §2.1 `canonicalHashFromStored` and the canary change. The canary's next scheduled use (§2.4, deploy + 5 days) only reads days captured entirely after deploy, whose stored hashes are canonical. The line-price turn-on waits for the cleanup anyway.

## Why the transition needs a recovery

- A new snapshot moves the latest pointer.
- An ezCater link survives a pointer move only through paths that may not run:
  - the preserved-code branch of `reconcile_ezcater_toast` needs the old linked snapshot to still be the latest;
  - Toast-note codes are re-found only by pass 2;
  - intraday reconciliation is skipped once the tick's deadline aborts;
  - `doPull` never reconciles.
- So the transition can detach links until recovery runs.

## The P1 fix: recovery must not leave the comparisons cleared

- `--links-only` runs pass 2 (`lib/ezcater/reconcile.ts:14`, `materializeEzcaterLinks`).
- Pass 2's publish retires **every** current shadow row of the order it republishes (`0229_ezcater_toast_reconcile.sql:205`). It then inserts the new rows **without** `reconciled_day_sales_oz` (`:237`).
- Only `record_ezcater_reconciled_comparison` (`:257`) writes that column, and only the normal mode calls it.
- So every links-only run clears the comparison the nightly recorded for those dates, and running links-only again does not bring it back.

**Rule:**
- Every links-only run is followed, in the same sitting, by the normal mode over its covered dates.
- Uncovered dates are listed as **deferred**: the regular nightly records them once capture covers them.
- For covered dates the procedure always ends with the normal mode, never with links-only.

## Before deploy

1. **L0: link identities.** Save the result to `C:\co\audit\toast-hash-L0-<date>.csv`.
   ```sql
   select l.order_id, l.location_id, l.order_guid, l.check_guid, l.selection_guid, l.evidence, l.business_date
   from public.ezcater_current_toast_links l
   order by 1, 2, 3, 4, 5, 6;
   ```
2. **B0 (a)–(f)** from `docs/runbooks/toast-line-prices.md` ("B0 baseline").
   - Window: Toast days from (min ezCater event date − 1) to today + 1.
   - B0 (e) must be read **after** the last nightly before deploy. It is the comparison the recovery has to restore.
3. Deploy in a low-catering hour and note the instant `D`.

## After deploy: recovery

- R = [min recaptured business_date − 7, max recaptured business_date + 1], floored at 2026-09-04.
- The recaptured dates are today and yesterday on the intraday path, the nightly's dates, and any date a manual pull or backfill touched.
- C = the last event date with no capture gaps, as `loadReconciledSalesWindow` reports. Normally that is yesterday after the nightly.
- `.env.local` holds the target's credentials, as for the canary.

Run the whole sitting at each of these points:
- after the first intraday tick has completed both dates for both shops;
- again after the first nightly;
- again after any manual pull or backfill of an older date while the transition is in progress.

```
# 1. Links back first, over all of R (R2 may be tomorrow):
npx tsx --conditions=react-server --env-file=.env.local scripts/ezcater-shadow-backfill.ts --links-only --from R1 --to R2               # dry run: prints N
npx tsx --conditions=react-server --env-file=.env.local scripts/ezcater-shadow-backfill.ts --links-only --from R1 --to R2 --expect N --execute
# 2. In the same sitting, restore the comparisons that step 1 cleared, over the covered part [R1, min(R2, C)]:
npx tsx --conditions=react-server --env-file=.env.local scripts/ezcater-shadow-backfill.ts --from R1 --to C                              # dry run: prints M
npx tsx --conditions=react-server --env-file=.env.local scripts/ezcater-shadow-backfill.ts --from R1 --to C --expect M --execute
```

- Step 1 prints `{date, ok}` per date and stops on a failed, deferred or skipped pass 2, or on a reconcile error. Re-run from the first date that did not report ok.
- Step 2 rebuilds the links again and records the comparison per date. It stops (`shadow_backfill_incomplete`) on a date with a capture gap. That means C was set too late: lower C and re-run.
- **Deferred list:** the dates in (C, R2]. Write them down. Their `reconciled_day_sales_oz` stays null until the next nightly covers them; check them again after that nightly with the `comparisons` query.

### Pass condition (each sitting)

1. **Links.**
   - Every L0 identity is in `ezcater_current_toast_links` again (same query as L0; diff the two files).
   - The exceptions are identities whose ezCater order changed (canceled, or a new ezCater snapshot). List each one by name.
2. **Comparisons.** Run `scripts/toast-hash-acceptance.sql` `@query comparisons` with `:r1`, `:c`, `:r2`.
   - Every `covered` date must have `missing = 0`, with `reconciled_day_sales_oz` equal to B0 (e) for that date.
   - Only a real ezCater or Toast change explains a difference; list it.
   - `deferred` dates may show `missing > 0`.
3. **Parity.** B0 (a)–(d) are identical, except for the changes listed in 1. B0 (f) is the exception: it is expected to change by exactly the `inserts` result (next section).
4. Q1 = 0: no current link row whose pointer differs.

Anything else: stop and report to CC.

## Acceptance: churn must stay gone (P2 #4)

W = [D + 1 h, D + 49 h). Run all three queries from `scripts/toast-hash-acceptance.sql` with `:w_from` / `:w_to`. After that, run them again **every day for 7 days** over the trailing 48 h.

- **`@query churn` (Metric A): must return zero rows.**
  - Memberships in W are partitioned by (shop, order, `modified_at`) across **every** version seen in W, not only the first.
  - One version must name exactly one snapshot.
  - This catches churn after the first canonical version. Example: A → B1 → B2 → B1 with B1 and B2 sharing a `modified_at` and both already stored is a `CHURN` row, even though nothing was inserted in W.
  - `modified_at` null is its own partition and its own kind (`CHURN_NULL_MODIFIED`). It is never merged into a dated version.
- **`@query inserts` (Metric B):**
  - Classes each snapshot first seen in W as `transition`, `churn`, `edit` or `new_order`. **`churn` must be 0.**
  - `transition` is the one allowed step per (order, version). It appears only while old days are still being recaptured for the first time.
  - **Expected B0 (f) delta** per (shop, business day) = `transition + edit + new_order`, measured since the B0 reading. Use this instead of "B0 (f) unchanged".
- **`@query coverage`:** the window counts only if it is not empty.
  - Both shops are present.
  - Both today and yesterday were captured.
  - At least 200 orders in total were captured in 3 or more runs.
  - Report the count. A thin window does not pass; extend it.

**Pre-existing gap, filed separately:** `doPull` and aborted intraday ticks don't reconcile. After this PR that only matters for real edits, as it does today.

## Rehearsal on sim (before prod)

1. Seed a legacy snapshot with a linked ezCater order and a recorded comparison.
2. Deploy the branch to the sim target.
3. Recapture the order's day. Assert:
   - exactly one new snapshot;
   - the pointer and every new membership name it.
4. Run the recovery sitting. Assert:
   - the link is back for each evidence type: a selection-name code, a Toast-note code (pass 2), a daily-batch ring, and a non-ezCater dining-option ring linked by code;
   - the comparison is restored for covered dates;
   - the deferred list is right.
5. Recapture three more times. Assert that nothing new is inserted and that `churn` returns zero rows.
6. Run one case with an aborted intraday deadline: the next tick or the recovery restores the link.

PGlite already proves the SQL halves offline:
- `tests/toast-canonical-hash-persistence.test.ts`: the real 0239 page writer and the 0221 finish;
- `tests/toast-hash-acceptance-sql.test.ts`: the acceptance queries and the clear/restore of the comparison.

## Rollback

- Reverting the PR brings back permutation hashes, and churn resumes.
- That can detach links again: run the same recovery sitting and the L0 check.
- No data is rewritten in either direction.
