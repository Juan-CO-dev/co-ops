# Fact layer, LABOR side (item 2 PR 2c): apply, turn on, set the burden, read

Migration `0338_fact_layer_labor` was APPLIED to sim and to prod on 2026-11-17 (prod `20261117153617`, after 0337). `FACT_LAYER=1` and `FACT_LAYER_LABOR=1` are both ON in prod since 2026-11-17. It shipped OFF; the gate is: the labor pass of the hourly `fact-build` cron runs only when `FACT_LAYER=1` **and** `FACT_LAYER_LABOR=1`. With `FACT_LAYER_LABOR` unset the route reports `labor: { skipped: true, reason: "fact_layer_labor_off" }` and calls no labor RPC.

Nothing reads these facts yet. Managers see no change until a reader ships (the board's two-view display is a follow-up).

## 1. Apply order

1. **Sim**: apply `0338`. Its pre-flight refuses by name when 0337, the 0268 mirror and reconciler, the 0269 links with 0301's per-shop indexes, 0224 / 0233, or 0274 is missing, and when 0338 is already applied.
   - In one transaction it locks `sevenshifts_wages`, copies every row (live and retired) into `fact_wage_observations` as `seed`, installs the two observation triggers, and proves the copy row-for-row before COMMIT. A 7shifts sync running at that moment waits on the lock (the reconciler is per user and short). Seeded rows mean "first observed at cutover".
2. **Prod** (Juan's word): apply `0338`, then stamp the file header (`-- APPLIED TO PROD …`).
3. **Deploy**, then set `FACT_LAYER_LABOR=1` (server env). `FACT_LAYER=1` must already be on.

### 1b. Overtime per employer (0339, Juan 2026-11-17)

Juan, 2026-11-17: "the two shops are SEPARATE companies (separate LLCs), and the payroll week turns over at MIDNIGHT Saturday->Sunday." Overtime is counted **per shop**: minutes past 40 h in a Sunday-Saturday week, per (person, shop). A person working at both shops gets overtime only from hours past 40 within one shop (30 h at A + 20 h at B = no overtime; 45 h at A = 5 h at A). The week boundary was already calendar midnight ET (0338's frame and the builder's per-minute ET calendar date) and is unchanged; the tests now pin it (Saturday 23:59 vs Sunday 00:00, a close across midnight, both DST weeks).

`0339_fact_labor_ot_per_shop` is FILE ONLY. Order:

1. **Sim**: apply `0339`. Its pre-flight refuses by name when 0338 is missing, when the live `fact_replace_labor_week` / `fact_labor_cost` bodies are not 0338's (a later definer), and when 0339 is already applied. It adds `fact_labor_ot_scope()` (`per_shop`), `labor_week_coverage.ot_scope` (existing `labor-v1` weeks = `company`, anything later = `per_shop`, no default afterwards), and re-emits the writer (refuses a payload whose `ot_scope` is not the one in force) and `fact_labor_cost` (the premium's blended rate is per person, week AND shop on a `per_shop` week; company-wide on a `company` week).
2. **Prod** (Juan's word): apply `0339`, stamp its header.
3. **Deploy** the app commit with `LABOR_BUILDER_VERSION = "labor-v2"` right after. Between the apply and the deploy the old app's payload names no scope, so every labor write is refused `fact_payload_mismatch`, which the pass counts as raced (`stale`), not a failure: nothing is written, the old weeks stay as they were. (Deploying FIRST is also safe for the minutes: the new builder writes per-shop overtime against 0338, which ignores the scope key; only the premium blends both shops until 0339 is applied, which then labels those weeks `per_shop`.)
4. The version bump changes every week's fingerprint, so the next passes rebuild every week since 2026-07-19, newest first, inside each pass's deadline (about 18 weeks; a few hourly passes). Watch the `fact-build` heartbeat's `labor` counts. Until a week is rebuilt it reads as it was built (company-wide), and `labor_week_coverage.ot_scope` says so:

```sql
select ot_scope, builder_version, count(*) from labor_week_coverage group by 1, 2;  -- done when only per_shop / labor-v2 remain
```

Changing the scope (a future employer whose shops are one company) is a new migration redefining `fact_labor_ot_scope()` plus `LABOR_OT_SCOPE` and a `LABOR_BUILDER_VERSION` bump in the same PR; never a runtime switch.

Rollback: unset `FACT_LAYER_LABOR`. After 0339, an app rolled back to `labor-v1` writes nothing (its payloads are refused as raced) and every week stays as it was last built; going back to company-wide overtime is a new migration, never an app rollback. The derived tables can stay. **The observation triggers keep recording** (that is the point: the history cannot be rebuilt later); they only insert into an append-only table no builder locks. Dropping them is a separate migration.

### 1c. Salaried cost to the payroll shop (0340, Juan 2026-11-17)

Juan, 2026-11-17: the shops are separate LLC payrolls. **P Street** pays the owner, the director of operations (MoO) and P Street's GM-and-down salaries. **Capitol Hill** pays the catering manager and Capitol Hill's GM-and-down salaries. The CGS is not salaried. 0338/0339 split a salary by the person's 7shifts LINKS (an account linked at both shops was halved); 0340 replaces that with an explicit, dated, audited **payroll shop per 7shifts account** (`labor_payroll_shops`, one writer `save_labor_payroll_shop`, owner / CGS / MoO). Links never enter the allocation. No fallback, no split: an account with a salary and no payroll shop, an assignee with no salary, or an assignment to a shop that is no longer linked makes the week's salaried total **incomplete** (NULL, with the counts), never a partial total. The rule is `allocateSalaried` (`lib/facts/labor-payroll-shared.ts`).

`0340_labor_payroll_shop` was APPLIED to prod 2026-11-18 (20261118064617). Order:

1. **Sim**: apply `0340`. Pre-flight refuses by name without 0339, when a re-emitted body (`fact_labor_week_source`, `fact_labor_week_fingerprint` from 0338; `fact_replace_labor_week`, `fact_labor_cost` from 0339) is not its source (a later definer), when `labor_week_salaried_check` is missing, and when 0340 is already applied.
2. **Prod** (Juan's word): apply `0340`, stamp its header.
3. **Deploy** the app commit with `LABOR_BUILDER_VERSION = "labor-v3"` right after. Between the apply and the deploy the old app's salaried payload carries no gap counts, so every labor write is refused `fact_payload_mismatch` (counted as raced, nothing written). Existing weeks keep their 0339 rows until rebuilt.
4. **Seed** (below), on sim first, then prod.
5. Let the passes run (every week since 2026-07-19 is rebuilt: the version bump and every save restale every week).
6. **Gate**, after the LAST save and a pass:

```sql
select count(*) from fact_labor_weeks_stale(1000, 'labor-v3');   -- must be 0 (the fingerprint holds the version AND every payroll-shop row)
```

then `npx tsx --env-file=.env.local scripts/check-labor-payroll-allocation.ts` (read-only): exit 0 = every built week's stored salaried rows equal a fresh allocation, and no gap anywhere (census or stored). Exit 3 = weeks still stale (wait a pass); 1 = a stored row differs (report it); 4 = gaps remain, each printed by 7shifts account id. `--allow-gaps` only with Juan's OK for named accounts (for example a manager whose salary is not in 7shifts yet).

**The seed procedure (CC, by MCP SQL; no names in code).** Every decision is by the linked CO-OPS person's ROLE and SHOP, per Juan's 2026-11-17 facts. `<P_STREET>` / `<CAPITOL_HILL>` are the two `locations.id` values with a live 7shifts location link (S0). `<ACTOR>` = Juan's CO-OPS user id (the CGS is an allowed actor; the audit row names him).

S0. The payroll destinations (the only shops a salary can go to):
```sql
select l.location_id, loc.name from sevenshifts_location_links l join locations loc on loc.id = l.location_id where l.active;
```

S1. THE CENSUS (Astra r2 P1): every 7shifts account in the mirror with no wage, a non-hourly wage, or a link to a level-6+ person. Nothing here depends on punches or links existing, so an account with no wage, no punch and no link is listed (`NO WAGE`).
```sql
with w as (select v.user_id, string_agg(distinct v.wage_type, ',' order by v.wage_type) kinds
             from fact_wage_current_versions(array(select id from sevenshifts_users)) v group by v.user_id),
     l as (select ul.sevenshifts_user_id, string_agg(u.role || ' ' || u.name || ' @ ' || loc.name, '; ' order by u.name) who
             from sevenshifts_user_links ul join users u on u.id = ul.user_id join locations loc on loc.id = ul.linked_at_location_id
            where ul.active group by 1)
select s.id account, s.employee_id, s.first_name, s.last_name, s.active, coalesce(w.kinds, 'NO WAGE') wage_kinds, coalesce(l.who, '-') linked
  from sevenshifts_users s left join w on w.user_id = s.id left join l on l.sevenshifts_user_id = s.id
 where w.kinds is null or w.kinds <> 'hourly'
    or l.who ~ '^(owner|moo|gm|agm|catering_mgr|prep_mgr|social_media_mgr|cgs) ' or l.who ~ '; (owner|moo|gm|agm|catering_mgr|prep_mgr|social_media_mgr|cgs) '
 order by s.id;
```

S2. The roster side: level-6+ people (not the CGS) with NO linked 7shifts account. Each one is a gap until their account is linked at their shop on `/admin/sevenshifts` (then it appears in S1), or Juan confirms they have no 7shifts account (the stated limit).
```sql
select u.id, u.name, u.role from users u
 where u.active and u.role in ('owner','moo','gm','agm','catering_mgr','prep_mgr','social_media_mgr')
   and not exists (select 1 from sevenshifts_user_links l where l.user_id = u.id and l.active)
 order by u.role, u.name;
```

S3. The estimate per shop (an estimate still wins the cost read; the gaps show beside it):
```sql
select location_id, estimated_salaried_weekly_cents is not null has_estimate from schedule_shop_settings;
```

S4. Decide EVERY S1 row (one save per account; two accounts of one person are two saves):

| The linked person (S1 `linked`) | Save |
|---|---|
| `owner`, `moo` | `shop` = `<P_STREET>` |
| `catering_mgr` | `shop` = `<CAPITOL_HILL>` |
| `gm`, and any other level-6 manager with a salary (`agm`, `prep_mgr`, `social_media_mgr`) | `shop` = the shop they manage (their link's / membership's shop) |
| `cgs` | `excluded`, note "CGS is not salaried (Juan 2026-11-17)" |
| a level-6 manager whose wage is `hourly` | `excluded`, note "hourly (wage in 7shifts)" |
| `NO WAGE` and a salaried manager per Juan | `shop` as above: the week then reads "no salary" (incomplete) until the salary is entered in 7shifts or the shop estimate is set |
| `NO WAGE` and not salaried (former staff, a duplicate or test account, hourly staff with no wage entered) | `excluded`, with a note saying which |
| anything not covered above | ask Juan before saving |

```sql
-- one per account; first save of an account: p_expected_seq NULL (later saves: the account's newest seq)
select save_labor_payroll_shop('<ACTOR>'::uuid, <account>, '<P_STREET>'::uuid, 'shop', date '2026-07-19',
  'Seed: <role> on the P Street payroll (Juan 2026-11-17)', null);
select save_labor_payroll_shop('<ACTOR>'::uuid, <account>, null, 'excluded', date '2026-07-19',
  'Seed: CGS is not salaried (Juan 2026-11-17)', null);
```
A note is required for every seed row (it starts before the current week). A later transfer is a new row with a later Sunday; a correction is a new row on the same Sunday (the newest seq wins). Nothing is updated or deleted.

S5. Re-run S1 and S2: every S1 account has a row, and S2 is empty (or each remaining name is confirmed by Juan). The card ("Payroll shop (salaries)" on `/admin/sevenshifts`, owner / CGS / MoO) shows the same census: its gap badge must read 0.

Rollback: unset `FACT_LAYER_LABOR`. An app rolled back past labor-v3 writes nothing (its payloads are refused as raced); going back to the link split is a new migration, never an app rollback. `labor_payroll_shops` is append-only and stays.

### 1d. The planned pricer for the schedule board (0345, board two labor views PR 1)

`0345_labor_cost_planned` was APPLIED to prod 2026-11-18 (20261118190114). It adds no table and writes no row: `fact_labor_cost`'s body (0340) moves into `fact_labor_cost_planned(…, p_plan jsonb)` and the public `fact_labor_cost(uuid, date, date, text)` keeps its signature and 23 columns and calls it with no plan. With no plan every answer is 0340's, row for row (`tests/fact-labor-0345-migration.test.ts` reads a built week before and after). The business report and every other reader are unchanged by the apply.

Order:

1. **Sim**: apply `0345`. Pre-flight refuses by name without 0340, when the live `fact_labor_cost` body is not 0340's (a later definer), and when 0345 is already applied.
2. **Prod** (Juan's word): apply `0345`, stamp its header. Nothing calls the new function yet.
3. **Deploy** the app. The business report now also asks `fact_labor_week_fingerprint` once per stored payroll week (no new SQL): a week whose source moved since it was built reads `rebuilding` until the next hourly pass.
4. `SCHEDULE_LABOR_VIEWS=1` (server env; needs `FACT_LAYER=1` and `FACT_LAYER_LABOR=1`) only on Juan's word, after the board UI (PR 3). Before the flip: `select count(*) from fact_labor_weeks_stale(1000, 'labor-v3');` is 0 and `scripts/check-labor-payroll-allocation.ts` is clean (section 1c's gate).

With the switch on, a GM / MoO+ board payload carries `laborViews` (an AGM's never does). 0345 not applied = `{ state: "not_installed" }`; the board itself still loads.

Rollback: unset `SCHEDULE_LABOR_VIEWS`. The functions can stay (the public one answers as 0340 did).

## 2. What a pass does

- The diff (`fact_labor_weeks_stale`) lists every payroll week (Sunday 00:00 ET calendar midnight; both shops built together, overtime counted per shop) from **2026-07-19** through the week holding yesterday whose fingerprint differs. It changes when a punch or Toast entry in the week changes (a moved punch makes both weeks stale), a link changes, an involved person's wage observation changes, the 7shifts overtime settings change, a shop-day gains ledger evidence or leaves its 36 h settle window, or another day of the week closes.
- One week per transaction, newest first, inside the order pass's deadline (entry + 240 s); a week starts only with a whole 60 s budget left. `fact_stale` / `fact_payload_mismatch` = raced, not a failure.
- Heartbeat: the same `fact-build` row, with a `labor` object (counts, up to 20 failed weeks by fixed code: `fact_week_timeout`, `fact_source_read_failed`, `fact_replace_failed`). Any labor failure makes the row `cron.failure`. Nothing emails.

Day states: `covered` (a finished ledger run whose `time_punches` result has a null `error_code`, started 36 h after the day ended, day inside its 90-day read window) · `pending_settle` · `fallback_unverified` (Toast, when 7shifts is not covered and Toast has hours) · `incomplete`. One source per shop-day; 7shifts and Toast are never added together. A `pending_settle` day's hours are provisional (fix r3): a range touching one reads `hoursKnown: false` (no % and no tone), whatever a sync inside the window did; a zero is definitive only once the day is `covered`.

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
- A salaried person with NO 7shifts account at all is invisible to every 7shifts-based check (0340). The census names payroll-roster managers (level 6+, not the CGS) with no linked account, and the card lists every salaried account with its payroll shop; a salaried person outside the roster with no account is caught only by the 0274 estimate and by eyeballing that list.
- A payroll-shop save restales EVERY built week (the fingerprint hashes the whole table): saves are rare, and the next passes rebuild.
- Overtime per shop (each shop its own LLC) and the calendar-midnight (not business-day) week boundary are Juan's rules (2026-11-17, replacing the 2026-11-16 company-wide answer), pending payroll / legal confirmation. Only the weekly 40 h is modelled; 7shifts daily / premium thresholds stay an advisory (`ot_settings_disagree`).
