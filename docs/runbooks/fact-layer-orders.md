# Fact layer, ORDER side (item 2 PRs 2a + 2b): apply, turn on, backfill, measure

Migration `0337_fact_layer_orders` is FILE ONLY. CC applies it to sim, then to prod on Juan's word. The app ships **OFF**: with `FACT_LAYER` unset, the hourly `fact-build` cron returns `{ skipped: true, reason: "fact_layer_off" }` before claiming a lease, reading or writing anything.

## 1. Apply order

1. **Sim**:
   - apply `0337`. Its pre-flight refuses by name when a parent is missing (0221 / 0229 / 0232 / 0239), when the cron union is not exactly 0300's six jobs, or when 0337 is already applied;
   - run the two-session proof: `SUPABASE_ACCESS_TOKEN=… node scripts/sim/fact-0337-lock-check-management.mjs --ref=jepgzucrvklhqpthowsc`. It must print `PASS`.
2. **Prod** (Juan's word): apply `0337`, then stamp the file header (`-- APPLIED TO PROD …`).
3. **Deploy the app.** Do this AFTER 0337 is applied, because 0337 is what adds `fact-build` to `claim_cron_route`. Until `FACT_LAYER=1` is set, the route claims nothing either way.

Rollback: unset `FACT_LAYER`. The tables are derived and nothing reads them yet, so they can stay. Dropping them is a separate migration.

## 2. Turn on

- Set `FACT_LAYER=1` (Vercel, server env).
- Optionally set `FACT_CAPTURE_FLOOR=YYYY-MM-DD`. When unset, the floor is the ET today minus 35 days.
- Each pass runs hourly at :40. It:
  1. runs the diff (days in [floor, today), every day already built whatever its age, and older order days whose current snapshot carries a refund dated on or after the floor or undated refund evidence);
  2. builds one day per transaction;
  3. starts a day only while a whole day budget (45 s) is left before entry + 240 s, and aborts any read or replace still running at that budget or at entry + 240 s.

  The lease is 330 s and `maxDuration` is 300 s. A raced day (`fact_stale` / `fact_payload_mismatch`) is not a failure; the next pass finds it again. Every pass that ran writes one heartbeat row (`job: fact-build`): `cron.success`, or `cron.failure` (`error: fact_days_failed`) when any day failed or timed out, with the counts and up to 20 failed days by fixed code (`fact_day_timeout`, `fact_source_read_failed`, `fact_source_snapshot_missing`, `fact_replace_failed`). A pass that fails as a whole writes `cron.failure` (`error: fact_build_failed`). Nothing emails.

## 3. Backfill

No enqueue is needed: lowering the floor is the backfill.

1. Dry run: `npx tsx --env-file=.env.local scripts/fact-backfill-report.ts --floor=2025-10-01`. It prints the stale-day count by shop and month (read-only), paged to completion (`complete: true`). It never prints a partial count: a failed read is `fact_stale_read_failed` and 5,000 or more stale days is `fact_stale_list_capped` (use a later floor); both exit 2.
2. Set `FACT_CAPTURE_FLOOR` to that floor. Each pass drains up to 500 days within its budget.
3. Re-run the report with `--expect=0` until it exits 0.
4. Parity: `npx tsx --env-file=.env.local scripts/fact-parity-probe.ts --from=<floor> --to=<yesterday>`.
   - It compares `sales_report_daily`'s classes and refunds with the facts over 31-day windows, including `sales_refund_missing` and undated refunds from before the window.
   - It exits 3 while any day in the range is stale, and exits 1 on any difference.

## 4. Storage measurement (gate, plan r3 §2 item 7; budget `B_inc` is CC's)

Measure on sim with at least 28 prod-shaped days, including peak Fridays and a catering day, after **two full rebuilds**.

To force a full rebuild **on sim only**, run this as the owner (service_role cannot write facts):

```sql
update public.fact_day_coverage set source_fingerprint = repeat('0', 32);
```

Every day is then stale, and the next passes rebuild them. Do it twice.

```sql
select c.relname, pg_total_relation_size(c.oid) as total_bytes, s.n_live_tup, s.n_dead_tup
from pg_class c join pg_stat_user_tables s on s.relid = c.oid
where c.relname in ('fact_order_snapshot','fact_order_check','fact_order_line','fact_refund','fact_day_coverage')
order by 1;
```

Report the following:

- **S0:** the sum of `total_bytes`, which includes the indexes.
- **Growth:** S0 ÷ days measured × 395 (13 months).
- **Churn headroom:** dead tuples × average row width × 1.3.
- **The diff's cost:** `explain (analyze, buffers) select * from fact_order_days_stale(<today − 395>, 500, 'orders-v1');` with 13 months of data. The pass has to fit inside its budget.

If the plan shows a sequential scan of `toast_order_latest_pointers` dominating, an index on `(business_date)` is the candidate. It counts against `B_inc`.

## 5. What the facts are not (yet)

- **Labor (2c)** is deferred pending Juan's answers.
- **Rollups (2e)** come with their consumers.
- **Line prices** come only from the snapshots' inline fields until item-1 phase 2. Phase 2 re-emits the fingerprint and bumps `FACT_BUILDER_VERSION`, which rebuilds every day.
