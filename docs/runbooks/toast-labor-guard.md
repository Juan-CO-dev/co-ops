# Toast labor "only if newer" (the D-R2 guard, migration 0361)

Owner of every step below: **CC**. Prod steps only on Juan's word. The builder ran the sim only.
Plan: `PLAN-toast-labor-newer.md` revision 3, on CC's rulings R1 to R7 and U1 to U7.

## What ships

- **The problem (D-R2).** Two Toast labor pulls for one shop can overlap: the 10-minute cron, the nightly, and the
  digest pre-load. Pull A reads Toast while a shift is open; the person clocks out; pull B reads the closed shift and
  stores it; pull A's write lands last and puts the open shift back. The same happens with an archive followed by a
  stale live row. Main's writer is one unconditional upsert, so the race exists on main today.
- **Migration 0361** adds ONE function and nothing else: `public.toast_time_entries_apply_newer(p_rows jsonb)`. It
  stores a row only when no row is stored for the entry or Toast's own `modifiedDate` (our `source_modified_at`) is
  LATER than the stored one. Everything else is skipped and counted. A skip never fails a pull.
- **`TOAST_LABOR_GUARD`** (Vercel env, server only). **Unset = main's writer, byte for byte** (pinned by
  `tests/toast-labor-guard-off.test.ts` against a golden generated from main `ec585c12`). Only the exact value `1`
  turns the guard on: every non-empty read is then written by one call of the function, never by the upsert.
- **ON fails closed.** An rpc error, a missing function, or an answer that is not the eight counts is
  `toast_labor_write_failed` for that read. There is no fallback to the upsert.
- `DIGEST_LABOR_MONEY` is not touched by this PR and stays OFF. Nothing is emailed.

## The counts

With the guard ON, every pull's heartbeat (`audit_log`, action `cron.success` / `cron.failure`, `metadata.job` =
`toast-labor-pull`, `-digest`, `-backfill` or `-manual`) carries `metadata.guard`:

| Key | Meaning |
|---|---|
| `received` | rows sent to the function (= the sum of the seven below) |
| `inserted` | no row was stored: stored |
| `updated` | Toast's stamp is later than the stored one (or the stored row had none): stored |
| `unchanged` | the same stamp and the same content: nothing stored (the normal replay) |
| `skipped_older` | Toast's stamp is EARLIER than the stored one: nothing stored. This is the D-R2 race being refused, or a stamp that went backwards |
| `skipped_same_stamp` | the same stamp but different content: nothing stored. Toast changed an entry without moving its stamp |
| `skipped_no_stamp` | the incoming row has no stamp and a row is stored: nothing stored |
| `duplicates` | the same entry more than once in one Toast response: reduced to one (the latest stamp) before the comparison |

`metadata.guard_skips_by_location` names the shops (ids) where a row was skipped, with the three `skipped_*` counts.
Shop ids and counts only: no entry, no person.

A skip is a success: the pull's rows stay `ok`, the digest reads, the station reconcile runs. `skipped_older` on an
overlapping pull is the guard working. `skipped_same_stamp` or `skipped_no_stamp` above 0 on a pull that did not
overlap another is evidence about Toast's stamp: tell CC.

## What the guard does NOT do

- It guards only its callers. `link_toast_employee` / `unlink_toast_employee` (0233), the sim seed and any deployment
  still running main's upsert write as they do today.
- A stored stamp is never replaced by an earlier one. If Toast ever stored a wrong, too-late stamp, later versions of
  that entry are `skipped_older` until Toast's stamp passes it. There is no repair path in this PR.
- With the guard ON a replay (the same stamp) stores nothing: a renamed job or a changed chosen name shows on an
  entry at its next Toast version, and `pulled_at` means "last stored", not "last seen". No code reads this table's
  `pulled_at`.
- **An entry archived in Toast more than 48 h ago that our copy still shows as live is not corrected by the re-pull.**
  A business-date read never returns an archived entry, and the modification window reaches back 48 h. Prod has never
  stored an archived row, so a past overwritten archive is unproven. A read that recovers old archives is a follow-up.

## Rollout

1. **Merge the PR.** The switch is unset, so every pull is main's writer and nothing calls the function. The order
   between this step and step 2 does not matter.
2. **0361 to prod**, from the pinned PR head, on Juan's word, with the tool set in the builder's scratch folder
   (`toast-labor-newer/`: `apply-0361-prod.mjs --preflight`, `--dry-run`, then the apply; its README has the exact
   commands and hashes). One new function that nothing calls; `create function` locks no table. Stamp the file header
   `APPLIED TO PROD`.
3. **Turn the guard ON** (`TOAST_LABOR_GUARD=1` in Vercel, production, then redeploy). **Juan's call**, bundled with
   the `DIGEST_LABOR_MONEY` ask. **Only after step 2 is verified:** with the switch ON and the function missing,
   every labor pull fails closed (`toast_labor_write_failed`, labor "not available", no station reconcile from the
   pull, failure heartbeats) until one of the two is corrected.
4. **Drain.** Pulls already running on the previous deployment still hold the unconditional upsert: at most 30 s for
   the 10-minute cron, 45 s for the nightly, 20 s per shop for a digest, 300 s per chunk for a manual backfill. Wait
   15 minutes after the deployment with the switch is promoted and confirm no backfill is running. Until then an old
   pull can still overwrite, as today, and an old unsorted upsert can deadlock with a guarded call (one of the two
   fails `toast_labor_write_failed` and the next pull retries; two unsorted upserts can do the same on main today).
   Then the real-path check, read-only: the next `toast-labor-pull` heartbeats carry `guard` and no
   `toast_labor_write_failed`.
5. **One re-pull with the guard ON (R6):**
   ```powershell
   node --conditions=react-server --import tsx scripts/backfill-toast-labor.ts --from <first day of the prior pay period> --through <today minus 2 days>
   ```
   (the command of `docs/runbooks/toast-order-capture.md`), with credentials injected by the approved operator
   environment and `TOAST_LABOR_PULL=1` and `TOAST_LABOR_GUARD=1` in it. Without `TOAST_LABOR_GUARD=1` the script
   runs main's upsert and prints no `guard`: a chunk line without `guard` means the re-pull was NOT guarded.
   `--through` cannot be later than today minus 2 days (the script's own limit). Which pull re-reads what after that:
   - the 10-minute cron reads **today only** by business date;
   - the nightly reads **today and the two days before** by business date;
   - every pull also reads the 48 h modification window (edits and archives of any business date).
   Shown to CC, per chunk: `rows`, `modified`, `failures` and `guard`. What it does: a row that a past race left on an
   older version is `updated` (Toast's stamp is later than the stored one); everything else is `unchanged`.
   `skipped_same_stamp` or `skipped_older` above 0 on this sequential run are evidence about Toast's stamp, for CC.
   No other historical repair. The residual under "What the guard does NOT do" (an archive older than 48 h) stays.
6. **Flip gate for `DIGEST_LABOR_MONEY`:** steps 1 to 5 done and the re-pull's counts shown to CC. The ask to Juan
   states the residual in one sentence: an entry archived in Toast more than 48 h ago that our copy still shows as
   live is not corrected by the re-pull.

## Rollback

Unset `TOAST_LABOR_GUARD`, **redeploy**, and wait out the drain of step 4 (a deployment that read the switch as ON
keeps calling the function until its pulls finish). Back on main's writer D-R2 is open again, so
`DIGEST_LABOR_MONEY` goes OFF with it: say so when rolling back. The function stays installed and unused; dropping
it is not part of a rollback (`drop function public.toast_time_entries_apply_newer(jsonb);` is in the file header
for completeness, and must never run while a deployment with the switch ON is serving).

## Proofs

- `tests/toast-labor-guard-off.test.ts`: OFF = main (golden; restaurant GUIDs recorded; six non-`1` switch values).
- `scripts/sql-harness-0361.mjs` (PGlite, the real 0224 + 0233 section A + 0361), run in CI by
  `tests/toast-labor-0361-migration.test.ts`.
- `tests/toast-labor-guard.test.ts` (switch ON, unit) and `tests/toast-labor-guard-race.test.ts` (the two-pull race
  through the real pull and the real function, both orders, with the OFF control).
- `scripts/sim/toast-labor-0361-two-sessions.mjs`: real concurrent sessions, **sim only**
  (`--ref=jepgzucrvklhqpthowsc`; it refuses every other project).
