# Fact layer, LABOR side (item 2 PR 2c): apply, turn on, set the burden, read

Migration `0338_fact_layer_labor` is FILE ONLY. CC applies it to sim, then to prod on Juan's word, **after 0337**. The app ships **OFF**: the labor pass of the hourly `fact-build` cron runs only when `FACT_LAYER=1` **and** `FACT_LAYER_LABOR=1`. With `FACT_LAYER_LABOR` unset the route reports `labor: { skipped: true, reason: "fact_layer_labor_off" }` and calls no labor RPC.

Nothing reads these facts yet. Managers see no change until a reader ships (the board's two-view display is a follow-up).

## 1. Apply order

1. **Sim**: apply `0338`. Its pre-flight refuses by name when 0337, the 0268 mirror and reconciler, the 0269 links with 0301's per-shop indexes, 0224 / 0233, or 0274 is missing, and when 0338 is already applied.
   - In one transaction it locks `sevenshifts_wages`, copies every row (live and retired) into `fact_wage_observations` as `seed`, installs the two observation triggers, and proves the copy row-for-row before COMMIT. A 7shifts sync running at that moment waits on the lock (the reconciler is per user and short). Seeded rows mean "first observed at cutover".
2. **Prod** (Juan's word): apply `0338`, then stamp the file header (`-- APPLIED TO PROD …`).
3. **Deploy**, then set `FACT_LAYER_LABOR=1` (server env). `FACT_LAYER=1` must already be on.

Rollback: unset `FACT_LAYER_LABOR`. The derived tables can stay. **The observation triggers keep recording** (that is the point: the history cannot be rebuilt later); they only insert into an append-only table no builder locks. Dropping them is a separate migration.

## 2. What a pass does

- The diff (`fact_labor_weeks_stale`) lists every payroll week (Sunday 00:00 ET, both shops) from **2026-07-19** through the week holding yesterday whose fingerprint differs. It changes when a punch or Toast entry in the week changes (a moved punch makes both weeks stale), a link changes, an involved person's wage observation changes, the 7shifts overtime settings change, a shop-day gains ledger evidence or leaves its 36 h settle window, or another day of the week closes.
- One week per transaction, newest first, inside the order pass's deadline (entry + 240 s); a week starts only with a whole 60 s budget left. `fact_stale` / `fact_payload_mismatch` = raced, not a failure.
- Heartbeat: the same `fact-build` row, with a `labor` object (counts, up to 20 failed weeks by fixed code: `fact_week_timeout`, `fact_source_read_failed`, `fact_replace_failed`). Any labor failure makes the row `cron.failure`. Nothing emails.

Day states: `covered` (a finished ledger run whose `time_punches` result has a null `error_code`, started 36 h after the day ended, day inside its 90-day read window) · `pending_settle` · `fallback_unverified` (Toast, when 7shifts is not covered and Toast has hours) · `incomplete`. One source per shop-day; 7shifts and Toast are never added together.

## 3. The burden %

No row = **12% default, always labelled `estimated`** (placeholder until Juan / Pete give the payroll figure). There is no screen in 2c. CC enters the real figure through the one writer, as a MoO / Owner / CGS actor:

```sql
select save_labor_burden('<actor user id>', null, 11.5, '2026-07-19', 'payroll', 'payroll register 2026');
```

`location_id` null = company; a shop row beats it. `valid_from` 2026-07-19 re-prices all history at once (burden is read time, never rebuilt). Refusals: `labor_burden_forbidden`, `labor_burden_invalid` (outside 0–50). Rows are never edited: a correction is a newer row. Every save writes ONE destructive `labor_burden.save` audit row itself, in the same transaction (actor, role, scope, the value in force for that scope before and the new value; the note never enters the audit row) — there is no unaudited way to change the burden.

## 4. Reading (for the reader PR)

- `fact_labor_cost(shop | null, from, to, 'first_known' | 'dc_minimum')` → per (week, shop) components only, with `open_punches` (unclosed punches, counted on every day they could span — 24 h from clock-in, `LABOR_OPEN_PUNCH_SPAN_HOURS`, across the payroll-week boundary too — so a range sums open punch-days: their hours are unknown, so `laborPercents` returns no % and no tone until they close, and overtime reads as a lower bound). Price with `laborWeekViews` + `laborPercents` + `laborTargetsFor` (`lib/facts/labor-cost-shared.ts`); normalise rows with `toLaborCostRow`. Never add the views in SQL.
- `fact_labor_splh(shop, from, to ≤ 31 days, 'placed' | 'promised')` → per quarter labor minutes (all / hourly) and sale cents, labor summed per quarter first. Checks are selected by the CHOSEN clock's date (not the Toast business date). `sales_state` = `covered` only when the order facts of the day, the day before, every business date that landed a check there and — on the `promised` clock — every business date in the bounded lookback `[day − 14, day + 1]` (`LABOR_PROMISED_LOOKBACK_DAYS`) that the SOURCE captured (a `toast_capture_runs` or `toast_order_latest_pointers` row, read independently of any fact build, so a Monday whose order-fact build failed makes Wednesday's promised sales unknown) are covered; stated limit: a check promised more than 14 days after its business date counts only once that date's facts are built; otherwise `sales_cents` / `sale_checks` are NULL (unknown, never 0). Labor minutes are NULL on a day the labor week has not built.
- Access: `laborFactAccess(role)` — GM shop money, MoO / Owner / CGS per person, AGM hours only, everyone else nothing.

## 5. Known limits (stated, not hidden)

- Break minutes are unpaid and removed from the middle of the punch (0268 keeps only the total).
- Toast jobs have no 7shifts role mapping: Toast rows are role 0.
- The salaried estimate (0274) is current-only, not dated: changing it re-prices every past week.
- A punch edited more than 90 days after its day is never re-read by 7shifts.
- A 7shifts wage deleted by mistake looks like a retired current wage and still prices.
- Company-wide overtime across the two LLCs and the midnight (not business-day) week boundary are Juan's rules, pending payroll / legal confirmation.
