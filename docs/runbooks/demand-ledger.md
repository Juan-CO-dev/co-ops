# Demand forecast ledger (item 4 PR 1)

What this is: a nightly record of what each baseline forecast said, the inputs it said it from, and (four days later) what really happened. It is the only way to get point-in-time (E2) evidence for a demand signal. It changes no par, no prep number and no schedule.

Law: `AGENTS.md`, section "Demand signals, PR 1". Migration: `supabase/migrations/0341_demand_signals_replay.sql` (file only until CC applies it).

## State as shipped

- 0341 is authored, not applied.
- `DEMAND_LEDGER` is unset. The nightly does not import or call the ledger pass.
- No outside feed, no cron lease, no email.

## Turning it on (CC, with Juan's word for prod)

1. Apply 0341 to **sim**, then run `npx vitest run tests/demand-signals-0341-harness.test.ts --maxWorkers=1` locally (the offline proof of the same file).
2. On sim, check the six tables exist and service_role holds SELECT only:
   `select table_name, privilege_type from information_schema.role_table_grants where table_name like 'demand_%' and grantee = 'service_role';`
3. Apply 0341 to **prod** on Juan's word. Stamp the file header in the same PR or the next (`-- APPLIED TO PROD <date> ...`), keeping the authoring gate line.
4. Set `DEMAND_LEDGER=1` in Vercel (server env) and redeploy. Nothing else is needed.

Order matters only one way: 0341 before the switch. With the switch on and 0341 missing, the pass finds no writer, reads nothing and writes no heartbeat.

## What a healthy night looks like

After the next nightly (`/api/cron/toast-sales-pull`, 09:00 UTC):

- One audit row `cron.success` with `metadata.job = 'demand-ledger'`, and per shop: `pars {recorded: 7}`, `labor {recorded: 12}`, `prep {recorded: 7}`.
- `select surface, count(*) from demand_forecast_ledger where decision_date = (now() at time zone 'America/New_York')::date group by 1;` → pars 7, labor 12, prep 7 per shop.
- Two target freezes per shop per night (`par_product_day_oz`, `labor_sales_day`) for the date four days back. On the first four nights those dates have no forecast row yet; the freezes are still correct and simply go unused.

`cron.failure` (job `demand-ledger`) names each shop's step by a fixed code:

| Code | Meaning | What to do |
|---|---|---|
| `par_inputs_not_last_night` / `no_par_inputs` | The par run did not run for yesterday at that shop (capture incomplete, or a catch-up for an older date) | Nothing: a forecast is never recorded for a decision it was not made on. That decision date has no pars row. |
| `labor_failed`, `pars_failed`, `prep_failed`, `models_failed` | A read or a writer failed | Check the nightly's log for that shop; the other steps still ran. |
| `deadline` | The nightly had under a minute left | Look at why the nightly ran long. |
| target `failed` | The freeze writer refused | Usually `target_freeze_too_early`: the server date and the database's ET date disagree. |

A missed night cannot be made up later. That is by design: the ledger refuses a decision date that is not today.

## What it stores, and how much

Per shop per night: one manifest, one catalog part, one guard part, one new day part (the other 20 window days are unchanged and stored once), one labor part, one prep part, three forecasts and two targets. A corrected order makes a new day part; the old one stays, which is what lets an earlier night replay to its earlier value.

Size is not measured yet. Before leaving it on in prod for long, measure on sim:
`select kind, count(*), pg_size_pretty(sum(bytes)::bigint) from demand_input_blobs group by 1 order by 3 desc;`
The catalog part (every par'd SKU with its overlay) is the large one; it is re-stored only on a night something in it changed.

There is no delete path. Retention (the plan says 25 months) needs its own reviewed sweep, and that sweep must keep every blob a ledger row, a freeze or a model still names.

## The report for Juan

Read-only. Writes one local Markdown file. Everything in it is retrospective (E1): it cannot turn anything on.

```
npx tsx --conditions=react-server --env-file=.env.local scripts/demand-replay-report.ts \
  --from=2026-09-01 --to=2026-11-10 --out=demand-replay-report.md --surfaces=labor
```

- `--from` / `--to` are decision dates, at most 120 days.
- Start with `--surfaces=labor`: one read per build day. `pars` loads the full engine inputs for every night and takes minutes.
- It works before 0341 is applied (it reads no demand table).

## Replaying a recorded night

`replayVerdict` (`lib/demand-signals/replay.ts`) takes a ledger row and a way to read blobs by hash:

- `reproduced`: the stored inputs give the stored forecast.
- `engine_changed`: the row was recorded by another engine version (`REPLAY_ENGINES`). The recorded forecast stands; to reproduce it, check out the commit that recorded it.
- `diverged` / `unresolved`: the row is E1, not E2. Investigate before using it as evidence.

## Turning it off

Unset `DEMAND_LEDGER` and redeploy. The tables stay; nothing reads them on an operational path. Do not drop them: a gap in the ledger is lost evidence, and the rows already there remain valid.
