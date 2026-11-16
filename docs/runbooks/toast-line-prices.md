# Toast line prices — phase 1 (item 1 PR B)

Plan: `C:\co\audit\item1-toast-r3.md` §1, §3, §4 (Astra r3 cleared phase 1). Owner of every step below: **CC**. Prod steps only on Juan's word.

## What ships

- `TOAST_LINE_PRICES` (Vercel env). **Unset = main, byte for byte.** Pinned against a golden frozen from main `6c317088` (`tests/fixtures/toast-legacy-hashes.json`): every captured output, content_hash and error, on the day path and the modified path.
- `TOAST_LINE_PRICES=1` adds the following, on **new snapshots only**:
  - On each captured selection with an item GUID: `price_v`, `net_cents`, `gross_cents`, `receipt_line_cents`, `tax_cents`, `tax_inclusion`, `selection_type` and `deferred`. `externalPriceAmount` and `openPriceAmount` are never read.
  - On each check, `accounting.line_prices`: heads, uncaptured/mixed heads, `net_cents`, and the `source` / `net` / `gross` / `receipt_line` completeness flags.
  - Selection prices are parsed leniently. A malformed root price makes that check's numbers unknown (null) instead of failing the day's capture. Check, discount, service-charge and refund money stay strict.
- **content_hash is computed over main's field set only** (one helper `toastContentHash`). Since churn fix PR 1, that field set is put in canonical order (`canonicalHashInput`; transition, recovery and acceptance in `docs/runbooks/toast-hash-canonical.md`). An unchanged order keeps its hash, so turning the switch on creates **no** snapshot. Existing snapshots, ezCater links, reports, depletion and the scorecard cannot see the change. Past orders get prices only through phase 2, which is not built here.
- **No migration.** `selection_units` and `accounting` are jsonb, and the 0239 CHECK only needs `version = '1'`. Proven in PGlite with the real 0221/0239 SQL (`tests/toast-line-prices-persistence.test.ts`).
- Nothing reads the new fields yet. `lineRevenue` (`lib/toast/line-prices-shared.ts`) is the pure per-measure coverage helper for phase 3.
- Recovery tool: `scripts/ezcater-shadow-backfill.ts --links-only`.
- Canary: `scripts/toast-line-price-canary.ts` (read-only).

## Turn-on procedure (plan §4)

1. **Merge and deploy PR B with `TOAST_LINE_PRICES` unset.** It is pinned byte-identical, so this is not an upgraded capture. Note the deploy time.
2. **Baseline B0** at time `t0`. Counts only, read-only, SQL below. Toast days from (min ezCater event date − 1) to T−4, where T = the ET calendar date of the reading.
3. **Canary.** With the switch still unset, from a checkout of the deployed commit, with `.env.local` holding the target's Supabase service role and Toast credentials (`TOAST_ORDER_CAPTURE=1`, `TOAST_LINE_PRICES` unset):
   ```
   npx tsx --conditions=react-server --env-file=.env.local scripts/toast-line-price-canary.ts            # T−10 and T−11, every Toast shop
   npx tsx --conditions=react-server --env-file=.env.local scripts/toast-line-price-canary.ts --date 2026-10-20 --date 2026-10-21   # other closed days
   ```
   - `--conditions=react-server` is required (the script's server modules import `server-only`). Without it the canary prints `needs_react_server_condition` and checks nothing. `tests/toast-line-price-runbook-commands.test.ts` runs these exact lines offline.
   - It refuses a day newer than T−4.
   - It reads every history row or refuses by name, exit 1, never PASS: `canary_history_truncated` (a row cap or a short page), `canary_history_uncounted`, `canary_page_cap`, `canary_snapshot_history_missing` (a latest pointer whose snapshot it could not read), `canary_latest_pointer_missing`. Re-run; if it repeats, stop and report to CC.
   - Gate: prints `{"canary":"PASS"}` and exits 0, with every shop-day `representative` (≥ 50 orders) and `absent_same_modified = 0`.
   - `absent_edited` lines are real Toast edits and are fine.
   - `absent_never_captured` lines are orders the capture never stored. They don't fail the gate but are worth a look.
   - `null_modified_review` lists order GUIDs for review.
   - A day with fewer than 50 orders fails as not representative: pick another day.
4. **Turn on** `TOAST_LINE_PRICES=1` (Vercel, production) and redeploy. Note the time. This is the new `t0` for the hard check.
5. **Monitor** at +1 h, after the first nightly, and at +48 h:
   - **Hard check** (must return zero rows; SQL below).
   - **Parity:** re-run B0 (a)–(f) and compare. Toast days ≤ T−4 and event dates ≤ T−12 must be identical, except rows explained by snapshots that the hard check classes as real edits.
6. After 7 days on: run the §3.6 read-only probe (plan) and the capacity measurement below.

Any failure → **Recovery**.

## B0 baseline (read-only)

Replace `:from` / `:to` with the B0 window and `:shop` with each Toast shop id.

```sql
-- (a) links by event date and evidence
select e.event_date, l.evidence, count(*) from public.ezcater_current_toast_links l
join public.ezcater_orders e on e.id = l.order_id
where e.event_date between :from and :to group by 1, 2 order by 1, 2;

-- (b) reconciliation status by event date, status and rule
select event_date, status, rule, count(*) from public.ezcater_reconciliation_status
where event_date between :from and :to group by 1, 2, 3 order by 1, 2, 3;

-- (c) per shop, in chunks of at most 31 days (the function's guard); keep sale, ezcater_linked and their sum
select public.sales_report_daily(:shop, :chunk_from, :chunk_to);

-- (d) orphans per day
select location_id, business_date, count(*), sum(amount_cents) from public.ezcater_toast_orphans
where business_date between :from and :to group by 1, 2 order by 1, 2;

-- (e) reconciled day sales oz of current shadow rows per event date
select event_date, sum(reconciled_day_sales_oz) from public.ezcater_shadow_depletion
where is_current and event_date between :from and :to group by 1 order by 1;

-- (f) snapshot count per (shop, Toast day)
select location_id, business_date, count(*) from public.toast_orders
where business_date between :from and :to group by 1, 2 order by 1, 2;
```

## Hard check: the violation query (read-only, must be zero rows)

`toast_orders` has no creation timestamp. A snapshot's creation time is the start of the first capture run that referenced it. Every writer, the modified-orders sweep included (0237 → `toast_capture_page`), records it in `toast_capture_run_orders`. `:t0` = the switch-on instant.

```sql
with first_seen as (
  select ro.snapshot_id, min(r.started_at) as first_seen
  from public.toast_capture_run_orders ro join public.toast_capture_runs r on r.id = ro.run_id
  group by ro.snapshot_id
), touched as (            -- orders with at least one snapshot first seen after t0
  select distinct o.location_id, o.order_guid
  from public.toast_orders o join first_seen f on f.snapshot_id = o.id
  where f.first_seen > :t0
), chain as (
  select o.id, o.location_id, o.business_date, o.order_guid, o.modified_at, f.first_seen,
         lag(o.id) over w as prev_id, lag(o.modified_at) over w as prev_modified_at
  from public.toast_orders o
  join touched t on t.location_id = o.location_id and t.order_guid = o.order_guid
  join first_seen f on f.snapshot_id = o.id
  window w as (partition by o.location_id, o.order_guid order by f.first_seen, o.id)
)
select location_id, business_date, order_guid, id, prev_id, modified_at, prev_modified_at,
       case when modified_at is null or prev_modified_at is null then 'review_null_modified' else 'VIOLATION' end as kind
from chain
where first_seen > :t0 and prev_id is not null
  and (modified_at is null or prev_modified_at is null or modified_at = prev_modified_at)
order by kind desc, location_id, business_date, order_guid;
```

- Any `VIOLATION` row means a new snapshot with the same non-null `modified_at` as its predecessor: the hash claim is wrong. Go to **Recovery**.
- `review_null_modified` rows are listed for review only.
- The violation pairs give the affected set S = distinct (location_id, business_date).

## Recovery (plan §4.5)

Each step can be repeated safely. A partial run resumes at the first date that didn't report ok.

1. **Unset `TOAST_LINE_PRICES`** and redeploy. No price-only snapshot is created after that. The extra snapshots carry the same amounts, so no money figure is wrong; only links can be detached.
2. **Find the affected range.** R = [min S − 7, max S + 1] in event dates, floored at 2026-09-04.
3. **Rebuild links over all of R:**
   ```
   # name-code and daily-batch links (SQL): reconcile_ezcater_toast(R1, R2)
   npx tsx --conditions=react-server --env-file=.env.local scripts/ezcater-shadow-backfill.ts --links-only --from R1 --to R2              # dry run: prints the order count N
   npx tsx --conditions=react-server --env-file=.env.local scripts/ezcater-shadow-backfill.ts --links-only --from R1 --to R2 --expect N --execute
   ```
   - Same runtime as the canary: `--conditions=react-server`, and `.env.local` holding the target's credentials.
   - `--links-only` runs pass 2, then `reconcile_ezcater_toast`, per event date.
   - It **never** reads capture coverage and **never** records a comparison, so R2 may be tomorrow (today + 1).
   - It prints `{date, ok, …}` per date and stops on a failed, deferred or skipped pass 2 or a reconcile error.
4. **Record comparisons only up to C**, the last date where `loadReconciledSalesWindow` reports no gaps (normally yesterday, after the nightly). Run the normal mode over [R1, min(R2, C)]:
   `npx tsx --conditions=react-server --env-file=.env.local scripts/ezcater-shadow-backfill.ts --from R1 --to C --expect N --execute`. Dates after C get their comparison from the regular nightly once they're covered.
5. **Parity against B0 over R.** Any difference: stop and report to CC.

Before step 4 of the turn-on, CC rehearses recovery steps 1–5 on **sim** with an injected wrong hash.

## Capacity (plan §4.6)

There are no extra snapshots; only new snapshots get bigger. Measure the average size per new snapshot for 7 days before and 7 days after switch-on:

```sql
select avg(pg_column_size(o.selection_units)) as units_bytes, avg(pg_column_size(c.accounting)) as accounting_bytes, count(distinct o.id)
from public.toast_orders o join public.toast_order_checks c on c.snapshot_id = o.id
where o.id in (select ro.snapshot_id from public.toast_capture_run_orders ro join public.toast_capture_runs r on r.id = ro.run_id
               group by ro.snapshot_id having min(r.started_at) between :window_start and :window_end);
```

- Projected yearly growth = (after − before) × trailing-28-day snapshot count × 13.
- Report it next to S0 and L.
- At 0.80 × L or more: unset the switch and ask Juan. Paid storage is spend.

## Not in this PR

- Phase 2: the `toast_snapshot_line_prices` table, the attachment writer and script, and the history windows.
- Phase 3: `order_line` facts, OBPP, the statement importer, menu costing.
- Astra r3's two P2s and one P3 belong to phases 2 and 3.
