# Smart Scheduling — Phase 2 (Scheduler + Board) Build Plan

## The hours budget · the planning horizon · the generator · the validator · the labor-target card · the board · Toast as interim people source + the three-way reconciliation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **No app code is written until Astra APPROVES this plan** (CC's GO, 2026-10-16: `05-BRIDGE/from-cc/GO-coops-scheduling-p2-plan-2026-10-16.md`). After approval, each chunk is reviewed by Astra and gated by CC.

**r0 (2026-10-16), CO Claude.** Written on `feat/scheduling-phase2` off `origin/main` @ **f1d51311**: Phase 1 shipped as #488 (squash dcf5f363), 0268–0271 on prod, 0272 on main. The spec is the amended `docs/superpowers/specs/2026-10-15-smart-scheduling-design.md` at f1d51311.

**Goal.** CO-OPS proposes each shop's week and the manager tunes it on a phone-first board. Every number and every reason is in view, and nothing leaves CO-OPS: the push to 7shifts is Phase 3. Concretely:
1. **An hours budget per week**, or per month split into weeks, plus a weekly suggestion with reasons (§5.2).
2. **A planning horizon:** next week, the next N weeks, the rest of the month, or a whole month. Partial weeks are handled, an edited week is never overwritten silently, and every rebuild shows "What changed" per week (§5.8).
3. **A deterministic, pure generator** (§6.1–6.2, §5.3–5.7). It builds:
   - shift shapes from demand and per-shop open / trim / close settings;
   - multi-position segments;
   - skill-weighted hours with guardrails, and team strength;
   - shifts that respect leader open/close settings and the MoO/Owner presence toggles;
   - salaried cover inside the floor limit;
   - the closing crew plus the Closing Manager role, and a manager on duty;
   - Juan's §5.7 rules: 4 h minimum, one person per position, priority pairs, preferred cover positions.
4. **The Wednesday draft and Regenerate**, each with "What changed" (§6.1).
5. **The pure validator `checkScheduleRules`.** It runs on every generated, regenerated and edited schedule, and in the tests. **A generated schedule that fails it is a bug** (§6.5).
6. **The labor-target card:** optimal heads and hours per day and per window at ≤ 28% (a per-shop setting), with the math shown (§6.6).
7. **The board, per Juan's approved mockup v17** (§7):
   - the money strip;
   - day tabs, with past days locked;
   - the demand curve with labor % per hour;
   - coverage colours;
   - 15-minute drag snaps;
   - the reason panel;
   - en/es throughout.
8. **Toast as the interim people source, and the THREE-WAY reconciliation view** (§8.0): CO-OPS user ↔ Toast link ↔ 7shifts link.

Every string ships in en + es (operational tú). Every surface is phone-first (375 px, 44 px controls, `items-center`) and follows the disclosure doctrine. **No email, SMS or in-app notification is sent by anything in this phase.**

**Explicitly OUT of Phase 2** (spec §9.3, the GO):
- the push to 7shifts ("Send to 7shifts as draft") and the forecast interval overrides;
- two-way availability sync and the CO-OPS availability picker;
- "Out…" call-outs and call-out fill;
- the staffing recommendations (promote / hire, with the math);
- the 7shifts station-mapping screen (it serves the push).

The board shows none of these controls. The validator still carries the call-out exception (rule d) as an inert branch, so Phase 3 adds a caller, not a rule.

**Architecture.**
- **Pure first.** Every decision lives in `lib/scheduling/*-shared.ts` (zero I/O):
  - time grid;
  - structure and validation;
  - demand;
  - need grid;
  - people input;
  - generator;
  - validator;
  - board maths;
  - labor target;
  - budget;
  - horizon and diff;
  - edit operations.

  One batch loader (`loadSchedulingInputs`) gathers every fact. One lib (`lib/scheduling/schedules.ts`) writes through definer RPCs. The UI renders view-models computed by the same pure functions the server uses.
- **No second forecasting engine.** Demand is the pulse "normal day": the shipped trailing same-weekday per-hour average from RPC `pulse_sales_baseline` (0242). Catering is NAMED, never summed, as in Dynamic Pars' event-layer law. See "Where demand comes from".
- **Revisions, not mutations.** A week is a head pointer over append-only revisions. Each revision is a full snapshot of shifts: generate, regenerate, edit and approve each write one. "What changed" is a pure diff of two snapshots. "Never silently overwrite an edited week" is enforced in SQL by the revision writer, not only in the UI.
- **Deny-all DB, permissions in the lib.** Every new table has RLS on, no user policies, and a 0257 service-role ceiling. The stateful tables are SELECT-only and written by SECURITY DEFINER RPCs (the accepted Phase 1 posture). Shop bind and role rules live in `lib/scheduling/access-shared.ts` and run before any I/O. The SQL writers re-check actor, shop and subject.
- **Dormant by default.** A per-shop switch `schedule_shop_settings.enabled` (default off) gates the board, the cron and every writer. No row means off.

**Tech stack:** Next.js 16.2.4 App Router (page `params`/`searchParams` are Promises), React 19.2.4, TypeScript strict + `noUncheckedIndexedAccess`, Tailwind v4 tokens, Supabase (service role), vitest 4 (node env; UI tests render with `react-dom/server`), PGlite harnesses.

**Mockup (visual + behaviour reference):** `C:/co/share/schedule-board/schedule-board.html` (v17), `schedule-invariants.test.cjs` and `co-ops-globals.css`. Verified 2026-10-16 with `node schedule-invariants.test.cjs`:
- sample week, 3 regenerate combos, priority flipped, 2 call-outs: **0 problems** each;
- negative controls: (c+d) 4 detected, (g) 1, (h) 26, (i) 1.

A read-only export of the sample week (`vm` run of the page script) yields 78 shifts and 82 segments, of which 2 shifts are multi-segment and 7 carry `closingManager`, with `checkInvariants` = 0. Task 3 pins that export as a fixture.

**Working copy:**

```bash
git -C C:/co/co-ops-sched-p2 log -1 --oneline        # f1d51311 or later on origin/main
ls supabase/migrations | tail -2                      # 0271_pm_reports_v2.sql, 0272_postgrest_write_lockdown.sql
```

**Standing rules for every task:**
- Read `AGENTS.md` first (the law-book), and re-read every file a task names before editing it (confirm-before-authoring).
- TDD: the failing test first, then the code, then green. Pure modules (`*-shared.ts`) come before loaders, and loaders before UI.
- **From Task 8 to the end, the schedule goldens stay green and every generated output is validator-clean:** `npx vitest run tests/schedule-golden.test.ts tests/schedule-generator-property.test.ts`.
- **The Phase 1 people equivalence pin stays green throughout** (`tests/people-layer-equivalence.test.ts`). Phase 2 only READS the people layer.
- Migrations are AUTHORED only. Each gets a PGlite harness `scripts/sql-harness-02NN.mjs` and a CI pin `tests/<name>-migration.test.ts`. CC owns the sim apply; Juan owns the prod word.
- Every new string ships en + es, including ARIA labels. Every control is ≥ 44 px with `items-center`. Token roles only. Disclosure state is `useState` only. Reasons are i18n keys + params (`NarrativeLine`, `lib/people-narrative.ts:4`), never prose built in English.
- Never key logic on location codes (`EM` = P Street, `MEP` = Capitol Hill, crossed), on position NAMES, or on person names. Use ids. Names are display only.
- No `enqueueNotification`, no `lib/email`, no `JOBS_REGISTRY` entry (pinned in Task 28).
- Commit per step (`wip(sched-p2): …`) with the trailers CC gives the builder.

---

## Ground truth this plan is built on (verified 2026-10-16 against `origin/main` @ f1d51311)

| Fact | Where | What the plan does with it |
|---|---|---|
| Latest migration on main is **0272** (`postgrest_write_lockdown`). **0273** is on `origin/feat/landing-p1` (`0273_landing_order_click_counts.sql`). Catalog 4a holds 0264–0266 (`origin/feat/catalog-p4a` carries 0264 and 0265; 0266 is reserved). | `git ls-tree origin/main supabase/migrations`, `git ls-tree origin/feat/landing-p1 …`, `origin/feat/catalog-p4a` | Phase 2 uses **0274** and **0275**. Task 13 re-checks before writing. |
| **Nothing in the repo forecasts future sales.** The reusable piece is the pulse "normal day": RPC `pulse_sales_baseline(p_location_id, p_from, p_to)` (0242:78, window ≤ 28 days, service_role only). It returns `{ hours: sales_report_breakdown(…,'hour_weekday'), captured_days }`. Cells are `{dow ISO 1=Mon, hour ET opened hour, cents = Toast check totals pre-tax after discounts}`. Pure helpers live in `lib/pulse/baseline-shared.ts`: `hourCurve` :14, `baselineCumulative` :31 (the per-hour average `round(cell/weeks)`, then made cumulative), `dowOf` :67, `sameWeekdayCoverage` :73. The caller `cachedBaseline` (`lib/pulse/sales.ts:46`) is not exported, and `loadPulseSales` needs a `PulseCtx` + level 7. | 0242, `lib/pulse/*` | **The demand source** (see "Where demand comes from"). Task 4 extracts `baselineHourly` (the non-cumulative first half of `baselineCumulative`), and `baselineCumulative` is rewritten over it, byte-identical (pinned). Task 16 exports `loadSalesBaseline` from `lib/pulse/sales.ts` (the existing RPC call + deadline + cache, no gate) for server use behind the scheduling gate. |
| Daily actual sales per shop come from RPC `sales_report_daily` (0247:17), folded by the pure `summarizeSales(raws, from, to, "day")` (`lib/sales-reports-shared.ts:363`). Buckets carry `toastChecksCents`, `coveredDays`, `ezcaterCents`. The internal caller is `dailyTotals` (`lib/sales-reports.ts:104`). | 0232/0239/0247 | Used ONLY by the budget suggestion's reference week (actual sales of the week the current budget covered). It is not a forecast. |
| Catering on the books: `loadCateringNight` (`lib/report-digests-v2.ts:103`) reads `catering_pipeline` (confirmed/out/completed) with value = the latest accepted `catering_quotes.total_cents`, else `estimated_revenue_cents`, for D and D+1 only. `time_window` is free text. `ezcater_orders` has `event_timestamp`/`handoff_time` (0223). `loadCateringPrepDemand` (`lib/catering/prep-demand.ts:286`) gives prep item quantities. | report-digests-v2, catering | Task 16 extracts the pipeline query + value rule into `lib/catering/booked-events.ts` `loadBookedCateringEvents(service, {locationId, from, to})`, and `loadCateringNight` calls it (same rows, pinned by its existing tests). **Catering is named, never summed into sales** (the historical baseline already includes Toast-rung catering checks, so adding it would double-count). It drives the structure's catering prep rule and the budget reason. |
| `lib/operational-day.ts`: `etWallMinutesInstant(day, minutes)` :90 (DST policy: a skipped hour rolls forward, a repeated hour takes its first occurrence), `etWallClockToUtcIso` :113, `operationalDayUtcRange` :136 (23/24/25 h), `etYmdMinusDays` :51, `etCalendarDate` :25. ISO week Monday: `weekStart(day)` (`lib/toast/labor-shared.ts:180`). Two DOW conventions coexist: ISO 1=Mon (`dowOf`) and JS 0=Sun (`etDayFromDate`, `lib/et-day-shared.ts:33`). | operational-day, labor-shared, et-day-shared | **Schedule time = ET wall-clock quarter-hours on a business date** (`q` ∈ 0..96). The shop day (7:00–21:00) never touches the 1–3 AM DST hours, so wall time is exact. Instants are derived only at the edges, through `etWallMinutesInstant` (Phase 3 sends instants). The scheduler uses ISO DOW only, through `dowOf`. |
| People: `loadSkillMatrix(service, {actor, locationId, now?})` (`lib/people/skills.ts:123`) is the Phase 1 contract. It is gated by `canViewPeople` and returns `SkillMatrix {locationId, asOf, tunablesVersion, positions, people:[{userId, role, skills: SkillResult[]}]}` (`skill-matrix-shared.ts:50`). `SkillResult.value` is what the scheduler weighs; `confidence`, `perKind.closeOnTime`, `startingPoint`. Members come from `user_locations` (active) × `users` (active). | `lib/people/*` | The generator reads skills ONLY through it. Task 16 splits it into the gated wrapper (unchanged signature) and an internal `computeSkillMatrixForShop(service, locationId, now)` called by both the wrapper and the scheduling loader. The scheduling loader runs only after `canViewSchedule` / the cron's system context. The equivalence pin stays green. |
| Toast people: `toast_employee_links` (0233:66) is per shop. It has one active link per (shop, employee_guid) and per (shop, user), is append-only, and is written by `link_toast_employee` / `unlink_toast_employee` (Tier B route). Auto-links happen only on an exact full-name match (`planLinks`, `employee-links-shared.ts:101`). Loaders: `loadLinks(service, locationId)` :83 (active + inactive), `loadLinkReview` :111. | 0233, `lib/toast/employee-links*` | The reconciliation view reads them. No new link writer is added; it deep-links `/admin/toast-employees`. |
| Toast punches: `toast_time_entries` (0224:19): `location_id, time_entry_guid, business_date, employee_guid, employee_first_name, user_id (0233 trigger fills it from the link), job_guid, job_name, in_at, out_at, hours, overtime_hours, auto_clocked_out, deleted`. **No wages, no breaks column** (breaks only reduce `hours`). There is **no loader of entries per linked user over a range**; readers are `loadPresenceFacts` (`lib/whos-here.ts:28`, one day) and `lastClockIns` (`lib/admin/dormancy.ts:10`). `WEEK_OVERTIME_HOURS = 40`, `DAY_OVERTIME_HOURS = 10` (`labor-shared.ts:155`). | 0224, `lib/toast/*` | Task 16 adds `loadPunchHistory(service, {locationId, from, to})` (paged, `deleted = false`). The pure `punchPatterns` (Task 5) turns it into **assumed availability** and usual hours. The default overtime threshold is 40 (7shifts labor settings override it once synced). |
| 7shifts: `sevenshifts_user_links` (0269:90) are **company-wide** (one live link per CO-OPS user). `sevenshifts_location_links` is per shop. Mirrors (0268): `sevenshifts_users`, `_shifts`, `_time_punches`, `_wages` (`wage_type hourly/weekly_salary/annual_salary`, `wage_cents`), `_labor_settings`. **No reader of shifts/punches/wages exists** outside `loadLinkScreen` (`lib/sevenshifts/links.ts:227`). Sync is dormant until Juan's token. | 0268/0269 | The reconciliation view adds read-only loaders. Wages feed money ONLY as shop totals for a GM (`canSeeShopLaborTotals`, `access-shared.ts:117`). Individual rates are never rendered (MoO included: no per-person $ on any Phase 2 surface, J9). |
| Stations: `stations.usually_closes_at time` (0230:32), `stations.trims jsonb` `[{at:"HH:MM", to_count}]` (0238:30; `validStationTrims`, `lib/station-schedule-shared.ts:6`; a time before 12:00 counts as the next day). `station_positions` (0219:9): `id, station_id, location_id, name, name_es, sort, active`, + `usually_trims_at time` (0230:33, only when `sort > 1`). **No station OPEN time is stored anywhere.** `station_positions.sort` is NOT priority (seed 42 puts the spec's secondaries at sort 1; Phase 1 ground truth). | 0217/0219/0230/0238 | **Open / trim / close and head counts per POSITION live in the schedule structure (a per-shop setting, §5.7).** When a shop first opens the structure editor, its defaults are SEEDED from the station columns (close ← `usually_closes_at`, trim ← `usually_trims_at` / the first `trims` entry) and shown as "from the station's closing settings"; after that the structure is the scheduler's single source. A later difference between a station column and the structure is shown as an advisory on the structure screen ("The station now closes at 3:30 PM; the schedule still says 4:00 PM"), never applied silently (J4). |
| Closing checklist timing: `loadPeopleFacts` family `closingLines` (`lib/people/facts.ts:371-398`) already loads `closingInstances {id, date, template_id, shift_start_at, triggered_at}` (not dropped), `closingItems`, and live `closingCompletions {…, completed_at}`. The canonical day instance is the latest per day (`stationClosures`, `skill-matrix-shared.ts:70`). **No duration helper exists.** | facts, skill-matrix-shared | **Measured closing duration** = the pure `closingDuration` (Task 4) over that family (a new consumer of people facts goes through `loadPeopleFacts`, Phase 1 law). |
| Roles (`lib/roles.ts:46`): cgs 10, owner 9, moo 8, gm 7, agm / catering_mgr / prep_mgr / social_media_mgr 6, shift_lead 5, key_holder / trainer 4, employee 3, **trainee 2**, hired_not_yet_worked 1, prospect 0. `canActOn` :78 (strictly greater). No `ROLE_LEVEL` export (use `getRoleLevel`). | roles | Leaders (§5.3) = key_holder, shift_lead, agm, gm, moo, owner (not cgs). Managers (MoD-eligible, §5.7) = shift_lead+. Salaried = gm, agm (§6.2). Floor pool default = levels 2–9 minus `catering_mgr`, `prep_mgr`, `social_media_mgr`, `cgs` (a structure setting, `roster.excludedRoles`). MoO/Owner are presence-only (never auto-scheduled). |
| Step-up: `assertStepUp(ctx, "A"|"B"|"E")` (`lib/admin/step-up.ts:39`). B = 120 s fresh password, always prompted. E = the fixed 15-minute edit window. `tests/step-up-tier-map.test.ts` is a pinned map that every new route joins. | step-up | Tiers per act in "Permissions". |
| Settings writer pattern: `save_people_shop_settings` (0270:274) takes a per-shop `pg_advisory_xact_lock` BEFORE its read, re-checks the actor in SQL, and returns {before, after}. The lib audits. Tunables: jsonb + `valid_skill_tunables` (SQL) ≡ `validSkillTunables` (TS) over ONE shared case file. | 0270 | The schedule structure copies this exactly (Task 13). |
| Cron lease: `claim_cron_route(p_job)` + `cron_route_leases_job_check` (0243, last re-emitted by 0268:492 with `'sevenshifts-sync'`). `vercel.json` has 8 crons. | 0268, vercel.json | 0275 re-emits both with `'schedule-draft'` added (line-subsequence pin against 0268's body). One more cron; CC checks the budget (O3). |
| Sim staff: `scripts/sim/seed-staff.ts` seeds 9 personas over two sim shops (`assertSimTarget`, `lib/sim-isolation-shared.ts`; `SIM_PROJECT_REF = jepgzucrvklhqpthowsc`). | scripts/sim | Task 26 adds `scripts/sim/seed-scheduling.ts` (same guard) for a realistic crew + Toast links + punches. |
| Shop context: `SHOP_PARAMS_BY_PATH` (`lib/shop-context-shared.ts:79`) declares every `?loc=` page. | shop-context | `/schedule` and `/admin/people-reconcile` are declared (`["loc"]`). |

---

## Where demand comes from (settled: no second forecasting engine)

**The forecast for business date D, built "as of" date A (the build day), is the trailing same-weekday per-hour average of Toast check totals over the 28 days before A.** It is exactly the pulse's "normal day", which managers already see on the mid-shift pulse. It comes from three existing functions plus one extracted helper:

1. **`pulse_sales_baseline(p_location_id, A−28, A−1)`** (0242) — called through the newly exported `loadSalesBaseline(service, {locationId, asOf: A})` in `lib/pulse/sales.ts`. That is the body of today's `baseline` + `cachedBaseline` (the 6 s deadline, the 6 h cache) moved behind an export; `loadPulseSales` calls it unchanged. It makes one RPC per shop per build.
2. **`dowOf(D)`** and **`sameWeekdayCoverage`**-equivalent counting over `captured_days` → `weeks(D)` = the number of captured days with the same ISO weekday in the window (0–4). This is the honest denominator, the pulse rule.
3. **`baselineHourly(heat, dow, weeks): number[] | null`** — NEW in `lib/pulse/baseline-shared.ts`. It is the first line of `baselineCumulative`, `hourCurve(cells).map(c => Math.round(c / weeks))`, and `baselineCumulative` becomes `cumulate(baselineHourly(...))`. A test pins `baselineCumulative`'s output byte-identical on the existing pulse fixtures.

The pure `forecastDay(baseline, D, asOf)` (Task 4) returns:
- `{hourlyCents[24], dayCents, weeks, basis: "trailing_same_weekday", weeksAhead, confidence}`;
- `dayCents = Σ hourlyCents`;
- `confidence`:
  - `"normal"` when `weeks ≥ 3` and D is in the next ISO week;
  - `"thin"` when `weeks ∈ {1, 2}`;
  - `"none"` when `weeks = 0`;
  - `"further_out"` for weeks after next. The same curve is used, and the board shows "Forecast is the 4-week average; it gets weaker further out" (§5.8).

**What it does NOT do (stated on the board, en + es):**
- no trend, holiday, event or weather adjustment (spec §11 "Demand anticipation hub" is a later phase);
- catering is not added to sales (the baseline already contains Toast-rung catering checks);
- the hour is the check's OPENED hour.

**With no sales history** (`confidence: "none"`, e.g. a new shop or the sim without captures), the day type falls back to the structure's per-date override, else `Normal`. Every reason line says "No sales history — built on the Normal crew; set the day type if it is wrong". The labor-target card and labor % render "—" with that errand, never a 0.

**Catering**, named and not summed: `loadBookedCateringEvents` (extracted from `loadCateringNight`) plus ezCater orders' `event_timestamp` give `{date, name, headcount, valueCents, eventTime | null}`. They feed:
- (a) the structure's **catering prep rule**: extra Prep/Dishwasher heads in a prep window before the event, applied when headcount ≥ the rule's threshold; an unparseable `time_window` uses the rule's default window and the reason says so;
- (b) the budget suggestion's reason line ("2 catering orders on the books Thu (≈ 80 people) → +4 h prep").

---

## Data reality on the sim, before 7shifts (settled)

| Input | Source in Phase 2 | Flag shown |
|---|---|---|
| **Who** | Active members of the shop (`user_locations.active` × `users.active`), i.e. the same members `loadSkillMatrix` reads, minus `structure.roster.excludedRoles` (default `cgs`, `social_media_mgr`, `catering_mgr`, `prep_mgr`) and levels < 2. MoO / Owner appear only through presence toggles or "Add to schedule". | A member with no Toast link: "Not linked to Toast — no punch history". |
| **Skills** | `computeSkillMatrixForShop` (Phase 1 matrix: learned + manager adjustment + rating prior). On the sim with no station history, every skill is the prior (0.5 or the manager's rating) with `startingPoint: true`. | Reason lines cite "starting point" skills ("Skill is a starting point — not enough worked data yet"). |
| **Availability** | **ASSUMED within the person's usual Toast punch pattern** until Phase 3: `punchPatterns` over the last 8 weeks of linked `toast_time_entries` (Task 5). A weekday counts as available when worked on ≥ 25% of the weeks the shop had punches that weekday. The window is [p10 clock-in − 30 min, p90 clock-out + 30 min] snapped to 15 min. **No history** (unlinked or new) = assumed available during all shop hours. | **Every** availability on the board carries "Assumed from Toast punches · until availability syncs (Phase 3)". Generated shifts outside the assumed window are never made; manual edits there get the warning `outside_assumed_availability`. |
| **Days off / flex day** | None until Phase 3 (they are availability). The untouchable-day and flex-day rules are implemented in the pure modules and the validator, fed `[]`. | Strip: "Flex days: available once availability syncs". |
| **Work type, leader setting, cover preferences, soft hours** | CO-OPS-local person settings (0274 `schedule_person_settings`), written by the GM. These are scheduling settings, NOT availability, and are never synced. Defaults when no row: work type by role (shift_lead+ → Management; else FOH), leader setting by role (§5.3 defaults), cover preferences `[]` (so any cover is last-resort until set; the reason says so), soft range = the trailing 4-week mean of Toast hours ± 4 h (else 0–40). | "Default from role — set it in Staff settings". |
| **Wages** | 7shifts hourly wage via the user link when synced; else the shop's **average wage estimate** (`schedule_shop_settings.estimated_hourly_cents`, MoO sets it). Salaried weekly cost: 7shifts salary wages when synced, else `estimated_salaried_weekly_cents`. | "$ estimated at the shop average $X/h" until real wages exist. With neither, money reads "—" and the errand is "Set the shop's wage estimate". |
| **Demand** | The pulse baseline (above). The sim has no captures, so demand is `confidence: "none"` and builds run on the day-type override / Normal crew. Task 26's seed can optionally write synthetic captures; it is not required for a run. | As above. |

The sim seed (Task 26) creates, per sim shop: 14 hourly people (trainee → key_holder) + 1 SL beside the personas, manual Toast links, and 8 weeks of synthetic punches with fixed patterns. The Wednesday draft and every board flow therefore run on the sim with no 7shifts token.

---

## Permissions (all in `lib/scheduling/access-shared.ts`, pure, before any I/O)

Actor = Phase 1's `PeopleActor` (`peopleActorFromAuth`, role from the session). "Own shop" = the actor's `user_locations`; level 8+ = any active shop.

| Act | Rule | Step-up |
|---|---|---|
| View the board, the labor-target card, the reconciliation view | GM (7) own shop; MoO (8)+ any shop. **AGM**: read-only board at own shop, hours/coverage/reasons only — the money strip's $ and %, the labor-target $ lines and labor % per hour are hidden ("GM and up see labor cost"), because labor % × forecast = $ and `canSeeShopLaborTotals` is GM+ (J1; O1 asks Juan whether AGMs edit). | none |
| `social_media_mgr`, `catering_mgr`, `prep_mgr`, everyone below 6 | **Refused by ROLE** (`schedule_role_refused` for SMM, `schedule_forbidden` otherwise). The hub card is not shown. | — |
| Generate a week with no revision yet; edit (drag, add, remove, segment divider); set a budget; accept/keep the suggestion; presence toggles; day-type override; person settings | GM own shop; MoO+ any | none (an operational surface; every write audited) |
| **Regenerate** a range where NO week has manager edits | GM own; MoO+ | none |
| **Regenerate a range that includes an edited week** (overwrites edits) | GM own; MoO+; the person confirmed each edited week by id after seeing its "What changed" | **Tier B** |
| **Approve the week** ("Ready for 7shifts": the revision Phase 3 will send) | GM own; MoO+; refused `rules_failing` while any error-class problem exists | **Tier B** |
| Schedule structure (shop day, day types, crews, position hours/heads/priority/allowed roles, leadership, limits, labor target, catering rule) | GM own shop; MoO+ any | **Tier E** |
| Shop switch `enabled`, wage estimates | MoO+ only | **Tier E** |
| Skill tunables screen (Phase 1 backlog) | MoO+ (Phase 1 route `POST /api/people/settings`, `action: "tunables"`) | Tier E (existing) |
| Staff see their own shifts | **Not in Phase 2** (J2): 7shifts stays the employee-facing schedule (spec §1 non-goals). | — |
| The Wednesday cron | System context: no actor, `actor_context: "cron"`. It only creates a week that has no revision, for shops with `enabled`. | — |

Every refusal is a named code with its own en + es key, `schedule.error.<code>`. The list is closed and compiler-enforced as `ScheduleErrorCode`:

`schedule_forbidden`, `schedule_role_refused`, `shop_not_enabled`, `shop_not_allowed`, `week_not_found`, `past_week`, `day_locked`, `head_moved`, `edited_week_unconfirmed`, `preview_stale`, `rules_failing`, `generator_invalid_output`, `structure_invalid` (+ `key`), `structure_moved`, `budget_invalid`, `person_not_at_shop`, `position_not_at_shop`, `position_retired`, `horizon_invalid`, `horizon_too_long`, `edit_off_grid`, `edit_overlap`, `edit_segments_malformed`, `edit_below_segment_min`, `pin_invalid`, `inputs_unavailable`, `wage_estimate_invalid`.

Step-up refusals reuse the shipped `step_up_required` / `step_up_stale`.

---

## Migrations (authored only; each with a PGlite harness + CI pin)

| # | File | Tables / functions | Kind | service_role ceiling |
|---|---|---|---|---|
| 0274 | `0274_schedule_settings.sql` | `schedule_shop_settings` (location PK; `enabled` default false; `estimated_hourly_cents`, `estimated_salaried_weekly_cents` nullable, CHECK 0 < x ≤ 100000 / 10000000) | config, writer RPC | SELECT |
| | | `schedule_structures` (one version per row: `id, location_id, structure jsonb CHECK valid_schedule_structure(structure), based_on_id, created_by, created_at`; LIVE = newest per shop; append-only) | versioned config | SELECT |
| | | `schedule_person_settings` (append-only; latest per (shop, user) wins: `work_type 'boh'/'foh'/'management'`, `also_allowed text[]`, `leader_setting 'opens'/'closes'/'mix'` null = role default, `cover_positions uuid[]` ordered, `soft_min_h`, `soft_max_h`, `full_time bool`, `full_time_min_h`; composite proof of the shop's positions in the writer) | append-only | SELECT |
| | | `schedule_budgets` (append-only: `location_id, week_start date CHECK isodow = 1, hours numeric(6,2) CHECK 0..2000 and hours*4 integral, source 'manager'/'month_split'/'accepted_suggestion', month date null, suggestion_digest text null`) | append-only | SELECT |
| | | `schedule_day_types` (append-only per-date override: `business_date, day_type 'auto'/'slow'/'normal'/'busy'`) | append-only | SELECT |
| | | `schedule_pins` (presence + Add-to-schedule blocks: `business_date, user_id, start_q, end_q smallint CHECK 0 ≤ start_q < end_q ≤ 96, positions uuid[], kind 'presence'/'added', active`; retire = new row `active=false` referencing `retires_id`) | append-only | SELECT |
| | | `valid_schedule_structure(jsonb)` (immutable, pinned search_path), `save_schedule_shop_settings`, `save_schedule_structure(p_actor, p_location, p_expected uuid, p_structure)`, `record_schedule_person_settings`, `record_schedule_budget(s)` (one call can write a month split atomically), `record_schedule_day_type`, `record_schedule_pin`, helper `schedule_actor_level(actor, location)` (GM own / 8+ any; mirrors `toast_link_actor_level`) | SECURITY DEFINER, service_role only | — |
| 0275 | `0275_schedule_weeks.sql` | `schedule_weeks` (`id, location_id, week_start` UNIQUE (location, week_start); `head_revision_id`, `approved_revision_id`, `created_at`) | head pointers, writer RPC | SELECT |
| | | `schedule_revisions` (append-only: `id, week_id, location_id, kind 'generated'/'regenerated'/'edited'/'approved', based_on_revision_id, structure_version_id → schedule_structures, inputs_digest text, generator_version text, horizon_run_id uuid null, problems jsonb (validator summary: counts per code + first 50), created_by uuid null (null = cron), actor_context text, created_at`) | append-only | SELECT |
| | | `schedule_revision_shifts` (`revision_id, location_id, user_id, business_date, start_q, end_q, segments jsonb CHECK valid_schedule_segments(segments, start_q, end_q), closing_manager bool, flex bool, pinned bool, reasons jsonb`; UNIQUE (revision_id, user_id, business_date, start_q); composite FK (revision_id, location_id)) | append-only (immutable) | SELECT |
| | | `commit_schedule_revision(p_actor, p_location, p_week_start, p_expected_head, p_kind, p_structure_version, p_shifts jsonb, p_meta jsonb)`, `approve_schedule_week(p_actor, p_location, p_week_start, p_expected_head)`, `valid_schedule_segments(jsonb, int, int)` | SECURITY DEFINER / immutable | — |
| | | re-emit `claim_cron_route(text)` + `cron_route_leases_job_check` with `'schedule-draft'` | function | EXECUTE service_role only |

**Order:** 0272 (on main) → 0273 (landing branch, independent) → **0274 → 0275**. 0275's preflight asserts that 0274 is present and that `claim_cron_route` is 0268's body (contains `'sevenshifts-sync'` and not yet `'schedule-draft'`).

**The two writers that matter, sketched** (Task 14 makes them exact):

```sql
-- commit_schedule_revision: ONE transaction per week.
--  0. schedule_actor_level(p_actor, p_location) >= 7 (or p_actor is null AND p_kind='generated' AND p_meta->>'actor_context'='cron')
--  1. perform pg_advisory_xact_lock(hashtextextended('schedule-week/'||p_location||'/'||p_week_start, 0));
--  2. insert into schedule_weeks … on conflict do nothing; select … for update;
--  3. head_moved      : head_revision_id is distinct from p_expected_head
--  4. shop_not_enabled: not coalesce((select enabled from schedule_shop_settings where location_id=p_location), false)
--  5. past_week       : p_week_start + 6 < (now() at time zone 'America/New_York')::date
--  6. day_locked      : any business_date < ET today whose shift set differs from the head's (compared as canonical jsonb)
--  7. edited_week_unconfirmed:
--       p_kind = 'regenerated' and exists (select 1 from schedule_revisions r where r.week_id = w.id and r.kind = 'edited'
--         and r.created_at > (select max(created_at) from schedule_revisions g where g.week_id = w.id and g.kind in ('generated','regenerated')))
--       and coalesce((p_meta->>'confirmed_overwrite')::boolean, false) is not true
--  8. every user_id is an active member of p_location; every segment position is an ACTIVE position of p_location on an active station
--     (people_position_at_shop from 0270) — position_not_at_shop / position_retired / person_not_at_shop
--  9. insert revision + shifts; update schedule_weeks.head_revision_id; return {revision_id, week_id, kind}
```

The lib runs `checkScheduleRules` BEFORE calling it. A generated/regenerated revision with an error-class problem is never sent (`generator_invalid_output`, audited `schedule.generator_invalid`, 500). An edit revision is sent with its problems recorded (spec §6.5: shown on the board with the rule it breaks). Only the structural edit failures (overlap, malformed segments, off grid, locked day) are refused.

**Ceilings:** the 0257 pattern on every table. RLS on, no policies; `revoke all … from public, anon, authenticated, service_role`; `grant select … to service_role`; then a `do $$` guard that raises if any PostgREST role holds anything, or if service_role holds INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER. Functions: revoke from public/anon/authenticated, EXECUTE to service_role, and an `information_schema.routine_privileges` guard. Sequences are revoked.

---

## The validator ↔ mockup invariants map (`checkScheduleRules`, Task 3)

`checkScheduleRules(schedule: WeekSchedule, ctx: RuleContext): RuleProblem[]`. It is pure, total, and deterministic in its output order. `RuleContext` = the structure in force per day, people (role, work type, leader setting, cover list, salaried, assumed availability), positions, today, and the declared gaps. Each `RuleProblem = { code, severity: "error" | "gap" | "warning", day, userId?, positionId?, q?, params }` renders through `schedule.rule.<code>` (en + es).

| Mockup v17 check | Rule code(s) | Severity | Notes |
|---|---|---|---|
| (a) no person has two overlapping blocks | `person_overlap` | error | per 15-min slot, across shifts and segments |
| (b) no position over its head count at any 15-min slot | `position_over_headcount` | error | limit = `heads.before` before trim, `heads.after` after (the mockup's `headCount`) |
| (c) every shift ≥ minimum (or the flex exception) | `shift_below_minimum` | error | flex exception only on the person's flex day within `flexUses` per 2 weeks (inert until Phase 3 gives flex days) |
| (d) no manager on Prep/Dishwasher unless call-out last resort; allowed roles per position | `role_not_allowed`, `manager_on_boh` | error | the call-out exception branch exists (`coverFor` + `call_out_last_resort` reason) and Phase 2 never emits it (Phase 3) |
| (e) segments inside each position's open–trim–close window | `segment_outside_window` | error | |
| (f) Closing Manager carried by an allowed role (and only by a closer) | `closing_manager_role` | error | |
| (g) leader open/close setting respected; the Closing Manager's setting allows closing | `leader_setting` | error | opens = start before service start; closes = end ≥ service close (the mockup's `shiftPreferenceWarning`) |
| (h) secondary filled ⇒ primary filled at that slot | `secondary_without_primary` | error | priority pairs come from the structure's `priority` (3 default pairs, data, by position id) |
| (i) no manager outside preferred cover positions unless marked last-resort | `cover_outside_preferences` | error | the segment's reason must carry `last_resort: true` |
| — (mockup "segments do not span shift" / "gap or overlap") | `segments_malformed` | error | |
| — (mockup "unknown person") | `unknown_person`, `not_member` | error | |
| spec §6.5: manager on duty every hour when required | `mod_missing` | **gap** | allowed only when declared AND proven (below) |
| spec §6.5: salaried minimums met | `salaried_minimum` | error | per GM/AGM day on the clock, `limits.gmMinimumH` / `agmMinimumH` |
| mockup harness: a Closing Manager exists each open day | `closing_manager_missing` | **gap** | declared + proven |
| spec §5.7 floor cap | `manager_floor_exceeded` | error | station segments of salaried managers per week ≤ `limits.managerFloorH` (32) |
| spec §5.5 work type | `work_type_not_allowed` | error | |
| spec §5.1 untouchable day | `untouchable_day` | error | inert until Phase 3 |
| coverage below need | `coverage_gap` | **gap** | declared + proven |
| overtime, budget, soft range, availability, checklist | `overtime`, `over_budget`, `soft_range`, `outside_assumed_availability`, `checklist_past_max`, `flex_used` | warning | shown, never blocking |

**Gap discipline (closes the "a gap is a loophole" hole).** The generator returns `gaps: DeclaredGap[]` (`{code, day, positionId?, fromQ, toQ, cause: "no_eligible_person" | "floor_limit" | "budget"}`). A gap-class problem passes ONLY when a declared gap covers it AND `proveGap(gap, schedule, ctx)` confirms the cause: no member who is eligible (role, work type, availability, not already on, no new overtime, leader setting) is free for a ≥ minimum-length block that touches the gap. The property test asserts **zero error-class problems and zero undeclared or unproven gap-class problems** on every generated output. A manager edit can create gap-class problems; they render as gaps.

**Parity with the mockup (Task 3).** `scripts/schedule-mockup-export.cjs` runs the v17 page script in `vm` (the harness's own technique; read-only) and writes `tests/fixtures/schedule/mockup-v17-week.json` (78 shifts). `tests/fixtures/schedule/mockup-v17-map.ts` maps its ids to fixture position/person ids. The structure is the mockup's `defaultStructure`, translated key by key. `tests/schedule-rules-mockup-parity.test.ts` then asserts:
- (1) the sample week has **0 error-class problems** under `checkScheduleRules`;
- (2) the five negative controls from `schedule-invariants.test.cjs` (short Pete shift; Dani opens-only closing; secondary without primary; Alex unmarked cover) produce `shift_below_minimum` + `manager_on_boh`, `leader_setting`, `secondary_without_primary` and `cover_outside_preferences`, with the same counts as the mockup reports (4 / 1 / 26 / 1 for the mockup's own codes).

The export is checked in. The mockup itself is never imported by the app.

---

## The generator (pure; `lib/scheduling/generator/*`)

`buildWeek(input: GeneratorInput): GeneratorOutput`, where:
- `GeneratorInput` = `{ locationId, weekStart, days: BuildDay[], structure, people: SchedPerson[], skills: SkillLookup, pins: Pin[], budgetHours: number | null, lockedShifts: Shift[], today }`, with every array canonical (sorted by id);
- `GeneratorOutput` = `{ shifts: Shift[], gaps: DeclaredGap[], reasons: ReasonIndex, stats }`.

The phases mirror the mockup's `buildDay` / `templatesFor` / `enforcePriority`. Everything is driven by structure data, by id:

1. **Locked and pinned first.** Past days (`< today`) are copied from the head unchanged. Pins (presence, added) become fixed blocks at $0 for MoO/Owner (§5.4), and segments run on their stated positions or MoD.
2. **Salaried on the clock.** Each GM/AGM not off gets a MoD block of `max(minimumShiftH, roleMinimumH)`, anchored per their leader setting (opens → prep start; closes → ending at scheduled out). Reason: `salaried_minimum`.
3. **The need grid** (`need-shared.ts`). Per position × 15-min slot it holds the required heads:
   - from position hours and heads before/after trim (Walk-ins / Online: open → close, never trims; 3rd Party trims ~4 PM; Crunchy Boi closes 2 PM; all of these are settings);
   - from the day type's crew row (BOH counts, `prepUntil`, waves `setup/service/rush` with counts and times, the closing crew);
   - from the catering prep rule;
   - and the closing window = service close → `scheduledOut` = clamp(serviceClose + closingMinutes, outEarliest, outLatest).
4. **Slot templates** in the mockup's order: the closing crew is reserved first (primary before secondary; the first line closer is flagged `closingLead`), then BOH, then line waves picking the most-deficient line position, then the head-count fill.
5. **Assignment** per template (the core), slot by slot over contiguous deficits:
   - candidates = eligible members (allowed role, work type / also-allowed, not used today, available in the assumed window, leader setting allows, `closingLead` needs a closing role whose setting is not opens-only);
   - **ordering = skill-weighted with guardrails:**
     - (i) the busiest/hardest windows (the top-quartile demand slots and the close) rank by skill desc;
     - (ii) other windows rank by "most under soft-min first", then skill;
     - (iii) a candidate whose week would exceed `overtimeH` is skipped (overtime only as a last resort, as a `warning` with cost);
     - (iv) full-timers below their minimum are pulled forward;
     - (v) **pairing:** when the best candidate is "newer" (`startingPoint` or `value < bands.building`), the window must already hold someone ≥ `bands.strong` at a line position; otherwise the strong candidate goes first and the newer one is placed beside them in the next fill (reason `paired_with_strong`);
     - ties go to the lower `userId`;
   - the minimum length is enforced by extending the block to `minimumShiftH` inside the position's window, or into the next needed position (a multi-position segment: "Crunchy Boi until 2:00 → Walk-ins"); a block that cannot reach the minimum is not placed;
   - the budget: non-essential blocks stop when hourly hours reach `budgetHours` (the closing crew is essential). The remainder becomes a declared `budget` gap.
6. **Manager cover**, when no hourly candidate fits: a salaried manager on MoD covering the window, within `managerFloorH` for the week, ordered by their preferred cover list, then skill; outside the list only as last resort (`last_resort: true`, reason says so). Never on Prep/Dishwasher (rule d).
7. **Priority enforcement** (the mockup's `enforcePriority`): wherever a secondary is filled without its primary, the secondary segment is re-labelled to the primary when the person is allowed there and the primary is open.
8. **Closing Manager:** among the closers whose shift spans service close → scheduledOut on a line position, the highest `closeOnTime` mean (`perKind.closeOnTime`; else role rank, then `userId`) in an allowed closing role whose setting allows closing.
9. **MoD lane:** at every slot of the shop day the highest-ranked shift_lead+ on the clock is MoD. When `modRequired` and a slot has none, the generator places an eligible SL+ hourly block before declaring `mod_missing`.
10. **Merge** adjacent blocks per person and canonicalise. Then **`checkScheduleRules` runs inside `buildWeek`**, and an error-class problem THROWS `generator_invalid_output` (with the problems), so a bug can never be emitted.

**Reasons** (`reasons-shared.ts`) are per shift and per segment, as i18n keys + params, citing the rule followed:
- "Busy Thursday → 2 Walk-ins at close (Closing crew rule)";
- "Strongest on Crunchy Boi 0.92 · lunch rush";
- "Paired with Maya (strong) — Eli is newer";
- "Covers Expeditor 11–2 from Manager on duty — preferred cover #1";
- "Last resort: outside preferred cover positions".

The panel also lists "who else could cover" (eligible members on shift, with skills).

**Determinism.** No `Date`, no `Math.random`, no `Map` iteration over unsorted keys, no locale compare (ids compare with `<`). Same input ⇒ byte-identical output, and any permutation of input arrays ⇒ the same output (property-tested). `GENERATOR_VERSION` is a constant bumped whenever a golden changes, and it is stored on the revision.

**Team strength** (`strength-shared.ts`) is the minute-weighted mean skill of who is on the clock for what, per day and per window. Windows come from the structure: BOH open, setup, lunch rush, afternoon, close + checklist. Words: strong ≥ 0.8, watch ≥ 0.65, thin below (thresholds in the structure). Example: "Close: thin — both closers newer".

---

## Budget, labor target, horizon (pure; settled math)

**Hours budget (§5.2).** A week's budget is the newest `schedule_budgets` row for (shop, week). A month entry writes one row per ISO week touching the month (`source: 'month_split'`), split by **forecast share** of that week's in-month days. A partial week takes the in-month share, and the reason shows the split. **The suggestion** (`budget-shared.ts`, `suggestBudget`):
- `ref` = the current budget, else the hours on the previous week's head revision;
- `refSales` = the ACTUAL sales of the week that budget covered (`summarizeSales` buckets; only covered days; their count shown);
- `fcSales` = Σ forecast of the target week;
- `Δ = fcSales/refSales − 1`;
- suggested = round to 0.5 h of `ref × (1 + Δ)` + catering prep hours (from the catering rule) + structure-change hours (need-grid hours under the live structure − under the structure of the ref week's revision);
- reasons: "Next week looks 12% busier (forecast $31.2k vs $27.9k last week)" · "2 catering orders Thu (≈80 people) → +4 h prep" · "Closing checklist now measured 50 min (was 45) → +2.5 h";
- **deadband:** no suggestion when |suggested − ref| < 2 h (a structure setting);
- Accept writes `accepted_suggestion` with the suggestion digest; Keep writes nothing and hides it for that digest (`useState` + a `schedule.budget_kept` audit row so the next visit stays quiet);
- `fcSales` with `confidence: "none"` ⇒ no suggestion; the errand is shown.

**Labor-target card (§6.6)**, `laborTarget(day, window, …)`, with every line of math rendered:
- `maxLabor$ = forecastSales × target%`, minus the salaried cost when `basis = 'total'` (the setting; default `'hourly'`, 28%);
- `maxHours = maxLabor$ ÷ blendedWage` (blendedWage = hours-weighted mean of the wages on the current draft; else the shop estimate);
- `optimalHeads(window)` = `maxHours` spread over the window's share of the demand curve, ÷ the window length → `[floorHeads, ceil(spread)]`, where `floorHeads` = the minimum crew of the positions open in that window (need grid);
- if spread < floor, the card says "Minimum crew needs more than the target allows" (amber);
- the card shows the draft against it ("Lunch: 5 on, optimal 4–5 · Close: 3 on, optimal 3"), amber when over target or under minimum crew;
- hidden $ for AGM (permissions).

**Labor % per hour** (the strip under the demand curve) = the hour's hourly-labor $ ÷ that hour's forecast $, toned good ≤ target, watch ≤ target + 10, high above (the mockup's 30/40 generalised to the setting). "—" when forecast is 0 or unknown.

**Horizon (§5.8)**, `planHorizon({mode, n?, month?}, today)`:
- modes `next_week` · `next_weeks` (n ∈ 2..6) · `rest_of_month` (tomorrow → month end) · `month` (current or next calendar month);
- **output:** the ISO weeks touched, each with `buildDays` (in range AND ≥ tomorrow) and `keptDays` (the rest of the week: copied from the head, or empty);
- the cap is 6 weeks (`horizon_too_long`);
- a week ≥ 2 ahead carries `confidence: "further_out"`;
- **apply flow:** `previewHorizon` builds every week and diffs it against its head (`diffWeeks`). It returns per week `{weekStart, edited: boolean, whatChanged, problems, budgetUsed}` and a token binding the whole preview (inputs digest + structure version + every head id). `applyHorizon` recomputes and refuses `preview_stale` on any difference, requires `confirmedEditedWeeks ⊇ the edited weeks` (else `edited_week_unconfirmed`) and Tier B when that set is non-empty, then commits week by week. Each week is its own transaction; a failure mid-range reports which weeks landed (named partial result, never a generic error).

**"What changed"** (`diff-shared.ts`, `diffWeeks(before, after)`) gives per day:
- people added/removed;
- shifts moved (Δstart/Δend);
- segments relabelled;
- the Closing Manager changed ("Wed: Iris → Nora");
- MoD gaps opened/closed;
- coverage-gap hours ±;
- hourly hours ±; $ ± (GM+);
- problems ±.

It renders as one summary line per week plus a default-collapsed per-day list (disclosure doctrine). "Settings changed — regenerate?" shows whenever the live structure version ≠ the head revision's.

---

## File Structure

**New — pure (`lib/scheduling/`)**
- `time-shared.ts` — quarter grid (`Q_PER_DAY = 96`), `qToWall`, `wallToQ` (refuses off-grid), `formatQ` via `lib/i18n/format.ts`, `weekDays(weekStart)`, `etToday`-free (today is a parameter).
- `structure-shared.ts` — `ScheduleStructure` types, `SCHEDULE_STRUCTURE_DEFAULTS`, `structureFromStations(stations, positions)`, `validScheduleStructure(s): {ok} | {ok:false, key}`, `dayType(...)`, `crewFor(...)`, `scheduledOut(...)`.
- `access-shared.ts` — every permission row above.
- `errors-shared.ts` — `ScheduleErrorCode`, `ScheduleError`.
- `rules-shared.ts` — `checkScheduleRules`, `proveGap`, `RuleProblem`, `RULE_CODES` (severity table).
- `demand-shared.ts` — `forecastDay`, `forecastWeek`, `dayTypeFor`, `withCatering` (names events onto days).
- `closing-duration-shared.ts` — `closingDuration(facts, serviceCloseByDay)`.
- `need-shared.ts` — `needGrid(day, structure, catering)`, `positionWindow`, `headLimit`.
- `people-input-shared.ts` — `punchPatterns`, `assumedAvailability`, `toSchedPeople(members, settings, patterns, skills, wages)`, `SkillLookup`.
- `generator/templates-shared.ts`, `generator/assign-shared.ts`, `generator/build-shared.ts` (`buildWeek`, `GENERATOR_VERSION`).
- `reasons-shared.ts`, `strength-shared.ts`, `board-shared.ts` (coverage cells, MoD lane, money strip, labor % per hour, view-model), `labor-target-shared.ts`, `budget-shared.ts`, `horizon-shared.ts`, `diff-shared.ts`, `edit-shared.ts` (move / start / end / divider / add / remove, 15-min snaps, refusal codes), `reconcile-shared.ts`.
- `lib/pulse/baseline-shared.ts` — + `baselineHourly` (extraction, pinned).

**New — I/O**
- `lib/scheduling/inputs.ts` — `loadSchedulingInputs(service, {locationId, weekStarts, asOf})`: the ONE batch loader (see Task 16).
- `lib/scheduling/settings.ts` — structure, person settings, shop settings, budgets, day types, pins (writers over the 0274 RPCs, audited).
- `lib/scheduling/schedules.ts` — `loadBoard`, `generateWeek`, `previewHorizon`, `applyHorizon`, `saveEdit`, `approveWeek`, `runWednesdayDraft`.
- `lib/scheduling/reconcile.ts` — `loadReconciliation`.
- `lib/catering/booked-events.ts` — `loadBookedCateringEvents` (extracted).
- `lib/toast/punch-history.ts` — `loadPunchHistory`.
- `app/(authed)/schedule/page.tsx`, `app/(authed)/schedule/settings/page.tsx`, `app/admin/people-reconcile/page.tsx`.
- `app/api/schedule/route.ts` (POST acts), `app/api/schedule/settings/route.ts`, `app/api/cron/schedule-draft/route.ts`.
- `components/schedule/*`: `ScheduleBoard.tsx`, `MoneyStrip.tsx`, `BudgetSuggestion.tsx`, `DayTabs.tsx`, `DayTimeline.tsx` (demand curve SVG + labor % row + coverage grid + MoD lane + strength chips), `PersonRow.tsx` (segmented bars, drag), `ReasonPanel.tsx`, `LaborTargetCard.tsx`, `RulesBadge.tsx`, `HorizonBuilder.tsx`, `WhatChanged.tsx`, `StructureEditor.tsx`, `StaffSettings.tsx`, `PresenceAndAdd.tsx`; `components/people/SkillTunablesEditor.tsx`, `components/people/PrepPositionCard.tsx` (Phase 1 backlog); `components/admin/people-reconcile/ReconcileList.tsx`.

**New — scripts, tests, fixtures**
- `scripts/schedule-mockup-export.cjs`, `scripts/sim/seed-scheduling.ts`, `scripts/sql-harness-0274.mjs`, `scripts/sql-harness-0275.mjs`.
- `tests/fixtures/schedule/` (`mockup-v17-week.json`, `mockup-v17-map.ts`, `structure-cases.json` (shared SQL/TS), `fixtures.ts` (the seeded fixtures), `golden-*.json`).
- Tests: `schedule-time`, `schedule-structure`, `schedule-access`, `schedule-rules`, `schedule-rules-mockup-parity`, `pulse-baseline-hourly-pin`, `schedule-demand`, `schedule-need`, `schedule-closing-duration`, `schedule-people-input`, `schedule-generator`, `schedule-golden`, `schedule-generator-property`, `schedule-board-math`, `schedule-labor-target`, `schedule-budget`, `schedule-horizon`, `schedule-diff`, `schedule-edit`, `schedule-settings-migration`, `schedule-weeks-migration`, `schedule-inputs`, `schedule-loader-schema-check`, `schedules-lib`, `schedule-routes`, `schedule-cron`, `schedule-board-ui`, `schedule-settings-ui`, `schedule-reconcile`, `schedule-i18n`, `schedule-no-notify`, `schedule-sim-seed-guard`.

**Modified**
- `lib/pulse/sales.ts` (export `loadSalesBaseline`), `lib/report-digests-v2.ts` (`loadCateringNight` over `loadBookedCateringEvents`), `lib/people/skills.ts` (split out `computeSkillMatrixForShop`), `lib/shop-context-shared.ts`, `lib/nav-links.ts` / `lib/reports-hub.ts` (cards), `lib/audit-actions.ts`, `lib/destructive-actions.ts`, `lib/i18n/en.json`, `lib/i18n/es.json`, `vercel.json`, `tests/step-up-tier-map.test.ts`, `AGENTS.md`, `docs/guides/manager-guide.md`.

---

# Chunk A — Pure foundations (Tasks 1–4) · Opus 5.5

Each task stands alone, and Chunk A has no I/O. After Chunk A, the rules, the demand maths and the need grid exist with tests, and the mockup parity is pinned.

## Task 1: Time grid + the schedule structure, with SQL/TS twin validation cases

**Files:** create `lib/scheduling/time-shared.ts`, `lib/scheduling/structure-shared.ts`, `lib/scheduling/errors-shared.ts`, `tests/fixtures/schedule/structure-cases.json`, `tests/schedule-time.test.ts`, `tests/schedule-structure.test.ts`.

The structure (the mockup's `defaultStructure`, keyed by position id; every value a setting):

```ts
export interface ScheduleStructure {
  version: 1;
  shopDay: { prepStartQ: number; prepDishArrivalQ: number; serviceStartQ: number; serviceCloseQ: number; outEarliestQ: number; outLatestQ: number };
  dayTypes: { slowBelowCents: number; busyAboveCents: number; weekendIsoDows: number[] /* default [6,7] */ };
  crews: Record<"slow" | "normal" | "busy" | "weekend", {
    prepHeads: number; prepUntilQ: number; prepDishHeads: number;
    waves: { setup: { heads: number; atQ: number }; service: { heads: number }; rush: { heads: number; atQ: number } };
    close: { registerHeads: number; walkHeads: number; prepDishHeads: number };
  }>;
  positions: Record<string /* station_positions.id */, { role: PositionRole; openQ: number; trimQ: number; closeQ: number; headsBefore: number; headsAfter: number; allowedRoles: RoleCode[] }>;
  // PositionRole maps the spec's named functions onto THIS shop's position ids, so code never matches names:
  // "prep" | "prep_dish" | "register" | "expo" | "walk" | "walk_online" | "line_other"
  priority: Array<{ pair: [string, string]; primary: string }>;   // default: prep_dish>prep, register>expo, walk_online>walk
  leadership: { modRequired: boolean; closingRoles: RoleCode[]; leaderDefaults: Record<RoleCode, "opens" | "closes" | "mix"> };
  limits: { minimumShiftQ: number; flexMinimumQ: number; flexUsesPer2w: number; flexMaxQ: number; overtimeH: number;
            managerFloorH: number /* 32 */; gmMinimumH: number; agmMinimumH: number; closingMinutesOverride: number | null; segmentMinQ: number /* 2 */ };
  catering: { minHeadcount: number; extraPrepDishHeads: number; defaultStartQ: number; defaultEndQ: number; leadMinutes: number };
  labor: { targetPct: number /* 28 */; basis: "hourly" | "total"; strong: number; watch: number; budgetDeadbandH: number };
  roster: { excludedRoles: RoleCode[] };
}
```

- [ ] **Step 1 (tests first):**
  - `wallToQ("10:30") = 42`; `wallToQ("10:20")` refuses `edit_off_grid`; `qToWall(96) = "24:00"`;
  - `weekDays("2026-10-19")` → Mon..Sun;
  - a DST week (2026-10-26 → 2026-11-01) has 7 days, and `etWallMinutesInstant` round-trips each day's 7:00 and 21:00;
  - defaults validate;
  - **the shared case file** (valid and invalid, one row each): open ≤ trim ≤ close per position; heads ∈ 0..8 integers; `slowBelow < busyAbove`; quarter-integral times; out window within 0..96 and `outEarliest ≤ outLatest`; `flexMinimum ≤ minimumShift` and `≤ flexMax`; `max(minimumShift, gmMin, agmMin) ≤ outLatest − prepStart` (the mockup's guard); `targetPct ∈ (0, 100]`; `managerFloorH ∈ [0, 80]`; each priority pair is two DIFFERENT position keys present in `positions` and the primary is one of them; a role code is a real `RoleCode`; no unknown keys; numbers are JSON numbers (never strings). `validScheduleStructure` names the first failing key.
  - `structureFromStations`: a station `usually_closes_at 14:00` → that station's positions close 56; `usually_trims_at 16:00` → trim 64; missing → the defaults; a pre-noon trim time is next-day (station-schedule rule) and is REFUSED as a schedule time (`structure_invalid`, key named).
- [ ] **Step 2:** implement. `crewFor(dayType)`; `scheduledOut(structure, closingMinutes)` = clamp(serviceClose + ceil15(closingMinutes), outEarliest, outLatest), plus `checklistFits`.
- [ ] **Step 3:** green. Commit.

**Acceptance:** every bound in the case file is enforced; no `Date.now`; no position names in code.

## Task 2: Permissions, pure (`lib/scheduling/access-shared.ts`)

**Files:** create `lib/scheduling/access-shared.ts`, `tests/schedule-access.test.ts`.

- [ ] **Step 1 (tests):** table-driven over every role × {own shop, other shop, none} × act:
  - `canViewSchedule`, `canSeeScheduleMoney` (= `canSeeShopLaborTotals`), `canEditSchedule`, `canEditStructure`, `canManageShopSwitch`, `canViewReconciliation`;
  - `stepUpFor(act, {editedWeeks})` → `null | "B" | "E"`;
  - same level 6, same shop: AGM → view (money hidden); SMM → `schedule_role_refused`; catering_mgr / prep_mgr → `schedule_forbidden`;
  - GM at another shop → `shop_not_allowed`; MoO any shop; cgs any.
- [ ] **Step 2:** implement, reusing `PeopleActor`, `OPERATIONAL_LEVEL6_ROLES` and `canSeeShopLaborTotals` (import, never copy).
- [ ] **Step 3:** green. Commit.

## Task 3: The validator `checkScheduleRules` + mockup parity

**Files:** create `lib/scheduling/rules-shared.ts`, `scripts/schedule-mockup-export.cjs`, `tests/fixtures/schedule/mockup-v17-week.json`, `tests/fixtures/schedule/mockup-v17-map.ts`, `tests/schedule-rules.test.ts`, `tests/schedule-rules-mockup-parity.test.ts`.

```ts
export interface Segment { positionId: string | "mod"; startQ: number; endQ: number; lastResort?: boolean; coverFor?: string; reasonKey?: string }
export interface Shift { userId: string; date: string; startQ: number; endQ: number; segments: Segment[]; closingManager: boolean; flex: boolean; pinned: boolean }
export interface WeekSchedule { locationId: string; weekStart: string; shifts: Shift[]; gaps: DeclaredGap[] }
export function checkScheduleRules(s: WeekSchedule, ctx: RuleContext): RuleProblem[];
export function proveGap(g: DeclaredGap, s: WeekSchedule, ctx: RuleContext): boolean;
```

- [ ] **Step 1 (tests):**
  - one positive and one negative case for EVERY code in the map;
  - the per-day structure (a locked past day is checked under the structure of the revision that last changed it — `ctx.structureByDay`);
  - a declared gap with an eligible free person → `undeclared_or_unproven_gap`;
  - output order is deterministic (sorted by day, code, user, q);
  - a 500-shift week checks in < 50 ms (complexity guard).
- [ ] **Step 2: the export.** `node scripts/schedule-mockup-export.cjs C:/co/share/schedule-board/schedule-board.html > tests/fixtures/schedule/mockup-v17-week.json`. It uses the vm technique of the mockup's own harness, refuses if the boot marker moved, and writes shifts + `defaultStructure` + people (role, leader setting, cover preferences). It is run once; the JSON is committed, and its header names the source file's SHA-256.
- [ ] **Step 3: the parity test** (the map section above). The five negative controls are rebuilt from the JSON exactly as `schedule-invariants.test.cjs` builds them.
- [ ] **Step 4:** green. Commit.

**Acceptance:** the mockup's sample week is error-clean; each mockup check a–i maps to a code with a failing control.

## Task 4: Demand, closing duration and the need grid (pure) + the `baselineHourly` extraction

**Files:** modify `lib/pulse/baseline-shared.ts`; create `lib/scheduling/demand-shared.ts`, `lib/scheduling/closing-duration-shared.ts`, `lib/scheduling/need-shared.ts`, `tests/pulse-baseline-hourly-pin.test.ts`, `tests/schedule-demand.test.ts`, `tests/schedule-closing-duration.test.ts`, `tests/schedule-need.test.ts`.

- [ ] **Step 1 (pin first, before touching the pulse):**
  - freeze `baselineCumulative` outputs over a fixture grid (2 weekdays × weeks 0..4 × sparse/full cells, plus an hour −1 cell) into the test's inline snapshot;
  - then extract `baselineHourly` and rewrite `baselineCumulative` over it;
  - the snapshot is unchanged.
- [ ] **Step 2 (demand tests):**
  - `forecastDay` with weeks 4/2/0: dayCents = Σ hourly; `confidence` normal / thin / none;
  - weeks ahead ≥ 2 → `further_out`;
  - an hour −1 cell is ignored and counted in `unknownCents`;
  - `dayTypeFor`: weekend flag first, then the per-date override, then the thresholds, and `none` → override else `normal`;
  - catering events attach to their date and never change `dayCents`.
- [ ] **Step 3 (closing duration):** `closingDuration(days, serviceCloseQByDay, {window: 28, minSamples: 8, quantile: 0.75})`:
  - per finalized day: (last live completion − service close) in minutes, floored at 0;
  - result `{minutes: ceil15(p75) | null, samples, basis}`;
  - < 8 samples → null (the structure override or 45 applies, and the screen says which);
  - a day with no completions is skipped; a superseded/revoked completion is ignored (the facts arrive already live-filtered; a test proves the function does not re-include them);
  - the latest instance per day only (`stationClosures`' rule).
- [ ] **Step 4 (need grid):**
  - with the mockup structure: Walk-ins / Online is needed open → close (no trim), 3rd Party ends at its trim, Crunchy Boi at 2 PM;
  - Register & Delivery 2 → 1 at the 4 PM trim when headsBefore 2 (§5.7 example);
  - BOH slow = 1 Prep/Dishwasher only, weekend = both until `prepUntil` then Prep/Dishwasher only;
  - the closing crew counts by day type;
  - the catering rule adds Prep/Dishwasher heads in [event − lead, event) or its default window;
  - a position with `role: line_other` and no crew rule follows its heads only.
- [ ] **Step 5:** green. Commit.

**Acceptance:** the pulse is byte-identical; no new RPC; the need grid is per position id; every number traces to a structure key (reason params name it).

---

# Chunk B — THE GENERATOR CORE (Tasks 5–8) · **Fable 5.1 recommended** (the truly hardest part)

Why Fable here and only here: this chunk is a constrained assignment search that must be simultaneously deterministic, permutation-invariant, validator-clean by construction, and readable through reasons. Every later chunk is plumbing over its output. The rest of the plan is Opus 5.5.

## Task 5: People input, pure (`people-input-shared.ts`)

**Files:** create `lib/scheduling/people-input-shared.ts`, `tests/schedule-people-input.test.ts`.

- [ ] **Step 1 (tests):**
  - `punchPatterns(entries, {asOf, weeks: 8})`:
    - per user × ISO weekday: `{weeksWorked, weeksObserved, share, p10InQ, p90OutQ, meanWeeklyHours}`;
    - entries with `deleted` or no `user_id` are skipped; an open entry (no `out_at`) counts its day but not its out time;
    - DST-week entries convert by ET wall clock;
    - `weeksObserved` counts only weeks in which the SHOP had any punch that weekday (a closed holiday is not "didn't work").
  - `assumedAvailability`: `share ≥ 0.25` → available window [p10 − 2q, p90 + 2q] clamped to the shop day; no history → `{source: "no_history", window: shop day}`; every output carries `source: "toast_pattern" | "no_history"` (the UI flag).
  - `toSchedPeople`:
    - excluded roles and levels < 2 are dropped;
    - MoO/Owner are flagged `presenceOnly`;
    - the role defaults for work type and leader setting apply; person settings override;
    - cover preferences outside the shop's active positions are dropped and reported (`cover_position_retired`);
    - salaried = gm|agm;
    - wage = the 7shifts hourly wage when supplied, else the estimate, else null (`wageSource`);
    - the output is canonical (sorted by userId).
  - `SkillLookup.get(userId, positionId)` = `value` (0 when the work type forbids it, as in the mockup's `skill`); `closeScore(userId)` = the max `perKind.closeOnTime.mean` across positions, else null.
- [ ] **Step 2:** implement. **Step 3:** green. Commit.

## Task 6: Templates and the closing / BOH / wave reservations (`generator/templates-shared.ts`)

**Files:** create `lib/scheduling/generator/templates-shared.ts`, `tests/schedule-generator.test.ts` (first block).

- [ ] **Step 1 (tests):**
  - for each mockup scenario (sample, busy days, slow days, station trim, walk priority flipped), `templatesFor(day)` produces the closing crew first (primary before secondary, one `closingLead`), then BOH, then waves on the most-deficient line position, then head-count fill;
  - counts equal the need grid;
  - no template outside its position's window;
  - catering-day extra Prep/Dishwasher;
  - salaried MoD blocks honour leader settings and the role minimum and are skipped when they cannot fit.
- [ ] **Step 2:** implement. **Step 3:** green. Commit.

## Task 7: Assignment, cover, priority, Closing Manager, MoD, reasons (`assign-shared.ts`, `build-shared.ts`, `reasons-shared.ts`, `strength-shared.ts`)

**Files:** create those four modules; extend `tests/schedule-generator.test.ts`.

- [ ] **Step 1 (tests), one per rule in "The generator" §5–§10:**
  - the strongest goes to the rush (two candidates 0.9 / 0.6, rush window → 0.9);
  - outside the rush, the person furthest under soft-min wins;
  - an overtime candidate is skipped while another fits, and is used only when none fits (warning + cost);
  - full-timer minimum;
  - **pairing:** a newer person is placed only beside a strong one at a line position;
  - the 4 h minimum via extension into the next needed position (multi-segment "Crunchy Boi → Walk-ins" at 2:00, the reason citing the close);
  - one person per position;
  - the budget stop: non-essential blocks stop and a `budget` gap is declared, while the closing crew still lands;
  - manager cover: within `managerFloorH` and in preference order; outside the list → `lastResort`; never Prep/Dishwasher;
  - priority enforcement relabels secondary → primary;
  - Closing Manager = the best `closeScore` among eligible closers (Key Holder default "closes"), never an opens-only leader (the v17 Dani bug, pinned);
  - MoD every slot, adding an SL+ block when required;
  - presence pins are $0 and count toward coverage;
  - locked days are untouched;
  - reasons: every shift and segment has ≥ 1 reason key; a last-resort segment's reason says so; "who else could cover" is listed.
- [ ] **Step 2:** implement. `buildWeek` ends with `checkScheduleRules` and throws `generator_invalid_output` on any error-class problem or unproven gap.
- [ ] **Step 3:** team strength per window (tests: weighted by minutes; MoD minutes excluded; thresholds from the structure). Green. Commit.

## Task 8: The golden + property discipline

**Files:** create `tests/fixtures/schedule/fixtures.ts`, `tests/fixtures/schedule/golden-*.json`, `tests/schedule-golden.test.ts`, `tests/schedule-generator-property.test.ts`.

- [ ] **Step 1: the fixtures** (seeded, ids only, no names in logic):
  - **(F1) `mockup-v17`:** the 18 people, skills, roles, leader settings and cover preferences of v17, the CH position set, and the mockup's revenue as a flat baseline;
  - **(F2–F5)** busy / slow / trim / priority-flipped variants;
  - **(F6) `sparse-sim`:** 9 people, no sales (`confidence: none`), no punches;
  - **(F7) `dst-fall`:** week of 2026-10-26 (Nov 1 = DST end);
  - **(F8) `partial-month`:** `rest_of_month` from 2026-10-27;
  - **(F9) `edited-head`:** a week with manager edits plus a locked Monday.
- [ ] **Step 2: the golden.** `buildWeek` for each fixture → `{shifts, gaps, reasons}` JSON; `UPDATE_SCHEDULE_GOLDEN=1` writes it. Header: "Regenerate ONLY with a written reason in the PR, and bump GENERATOR_VERSION." Each golden is asserted **validator-clean**: zero error-class problems, every gap proven.
- [ ] **Step 3: the property test** (no new dependency; mulberry32, fixed seeds, 300 cases per run + an edge grid):
  - random structures from the VALID case space (trims, head counts 0–3, waves, priority flips, roster sizes 3–25, skills 0–1, leader settings, cover lists, budgets null / tight / loose);
  - assertions:
    - (1) never throws for a valid input;
    - (2) zero error-class problems;
    - (3) every gap-class problem declared and proven;
    - (4) determinism (two runs byte-identical);
    - (5) **permutation invariance** (people and positions arrays shuffled → identical output);
    - (6) locked days byte-identical to the input head;
    - (7) total hourly hours ≤ budget + essential hours.
- [ ] **Step 4:** green. Commit: `test(sched-p2): freeze the generator goldens (validator-clean)`.

**Acceptance (Chunk B):** the goldens and the property test are green, and the mockup scenarios produce the mockup's Closing Manager behaviour (a Key Holder, never an opens-only SL). After Task 8 the goldens are part of every later task's green.

---

# Chunk C — Derived reads: board maths, labor target, budget, horizon, edits (Tasks 9–12) · Opus 5.5

## Task 9: Board maths (`board-shared.ts`)

**Files:** create `lib/scheduling/board-shared.ts`, `tests/schedule-board-math.test.ts`.

- [ ] **Step 1 (tests):**
  - `coverageCells(day)` per position × hour: `{scheduled, needed, tone: "gap" | "over" | "good" | "closed", alternates: [{userId, skill}]}` (red / amber / green / grey; "over" is any 15-min slot over head count);
  - `modLane(day)` per hour: the names, or `gap`;
  - `closingRoleCells`;
  - `moneyStrip(week)`:
    - hourly hours vs budget;
    - hourly $ and % of forecast;
    - salaried fixed $;
    - TOTAL %;
    - OT risk (count of people over `overtimeH`);
    - flex used (0 until Phase 3, flagged);
    - manager floor hours, and hourly hours saved by salaried cover (the mockup's `floorHours`: station segments of salaried managers where no hourly person covers that position);
    - all $ fields are `null` for an actor without `canSeeScheduleMoney`, and the view-model omits them (never sent to the client);
  - `laborPctByHour(day)` (tones from `labor.targetPct`);
  - `demandCurve(day)` (24 → the shop's hours, cents);
  - `dayTabs(week, today)`: `locked` for days < today; hourly % per day.
- [ ] **Step 2:** implement. **Step 3:** green. Commit.

## Task 10: The labor-target card (`labor-target-shared.ts`)

**Files:** create `lib/scheduling/labor-target-shared.ts`, `tests/schedule-labor-target.test.ts`.

- [ ] **Step 1 (tests):** worked examples rendered as math lines (i18n keys + numeric params):
  - $4,300 × 28% = $1,204 → ÷ $20.50 = 58.7 h;
  - `basis: total` subtracts the day's share of the salaried weekly cost;
  - window spread by the demand share with the minimum-crew floor;
  - "Lunch: 5 on, optimal 4–5";
  - amber when over target or under the floor;
  - forecast unknown → `{state: "no_forecast"}` with the errand;
  - no wage → `{state: "no_wage"}`.
- [ ] **Step 2:** implement. **Step 3:** green. Commit.

## Task 11: The budget and its suggestion (`budget-shared.ts`)

**Files:** create `lib/scheduling/budget-shared.ts`, `tests/schedule-budget.test.ts`.

- [ ] **Step 1 (tests):**
  - `budgetForWeek(rows, week)`: the newest row wins; a month split → per-week rows by forecast share, partial weeks prorated, Σ = the month total (rounding remainder to the last week, quarter-hour integral);
  - `suggestBudget`: every reason line from "Budget, labor target, horizon"; the deadband; no suggestion with `confidence: none` or no reference week; the digest is stable (same inputs → same digest);
  - Keep hides by digest.
- [ ] **Step 2:** implement. **Step 3:** green. Commit.

## Task 12: Horizon, "What changed", edit operations

**Files:** create `lib/scheduling/horizon-shared.ts`, `lib/scheduling/diff-shared.ts`, `lib/scheduling/edit-shared.ts`, `tests/schedule-horizon.test.ts`, `tests/schedule-diff.test.ts`, `tests/schedule-edit.test.ts`.

- [ ] **Step 1 (tests):**
  - **horizon:**
    - `next_week` from Wed 2026-10-21 → week of 10-26;
    - `rest_of_month` from 10-27 → weeks 10-26 (build 28–31, keep 26–27 and Nov 1) — the "tomorrow" boundary;
    - `month` 2026-11 → 6 ISO weeks touched, with partial first/last;
    - n = 7 → `horizon_too_long`; a past month → `horizon_invalid`;
    - week 2+ `further_out`.
  - **diff:** each change kind in "What changed"; identical → empty; deterministic ordering; $ lines omitted without money permission.
  - **edits** (the mockup's `adjust` / `canSet` / `scaleSegments`), all on 15-min snaps:
    - `move`, `start`, `end` (segments scale proportionally with each ≥ `segmentMinQ`), `divider:i`, `addShift`, `removeShift`, `setSegmentPosition`;
    - refusals `edit_off_grid`, `edit_overlap`, `edit_segments_malformed`, `edit_below_segment_min`, `day_locked`;
    - an edit that creates rule problems is ALLOWED and returns the new problems (spec §6.5), unlike the mockup, which silently rejects; this departure is J6.
- [ ] **Step 2:** implement. **Step 3:** green. Commit.

---

# Chunk D — Migrations (Tasks 13–15) · Opus 5.5

## Task 13: Migration 0274 — settings, structure versions, person settings, budgets, day types, pins

**Files:** create `supabase/migrations/0274_schedule_settings.sql`, `scripts/sql-harness-0274.mjs`, `tests/schedule-settings-migration.test.ts`.

```sql
create table public.schedule_structures (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  structure jsonb not null constraint schedule_structures_valid check (public.valid_schedule_structure(structure)),
  based_on_id uuid references public.schedule_structures(id),
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default clock_timestamp(),
  unique (id, location_id)
);
create index schedule_structures_live on public.schedule_structures (location_id, created_at desc);

-- save_schedule_structure(p_actor, p_location, p_expected, p_structure):
--   advisory lock 'schedule-structure/'||location FIRST; schedule_actor_level >= 7 (GM own / 8+);
--   structure_moved when the newest id is distinct from p_expected; every positions key is an active position of
--   p_location (people_position_at_shop); insert; return {before_id, after_id}.
```

- [ ] **Step 0:** `ls supabase/migrations | tail -3` and `git ls-tree origin/feat/landing-p1 supabase/migrations | tail -2`. If 0274 is taken, stop and ask CC.
- [ ] **Step 1:** the preflight: 0270 present (`people_position_at_shop`, `station_positions_id_location`), 0272 present.
- [ ] **Step 2:** the tables per the migrations table; `valid_schedule_structure` in plpgsql, pinned `search_path`, immutable. `schedule_actor_level` mirrors `toast_link_actor_level`'s rule.
- [ ] **Step 3:** the writers, each locking per shop (and per user for person settings) BEFORE reading, re-checking actor, subject membership and positions in SQL, and returning before/after for the audit.
- [ ] **Step 4: the harness** (`PASS 0274:`):
  - the SHARED `structure-cases.json` (every valid accepted, every invalid refused, the same verdict as the TS validator);
  - `structure_moved`;
  - a foreign-shop position refused;
  - GM at another shop refused; MoO allowed;
  - UPDATE/DELETE refused for service_role on every table;
  - the ceilings guard; a month split writes N rows atomically.
- [ ] **Step 5:** the pin (file present, header gate line, harness green in CI). Commit.

## Task 14: Migration 0275 — weeks, revisions, shifts, the writers, the cron lease

**Files:** create `supabase/migrations/0275_schedule_weeks.sql`, `scripts/sql-harness-0275.mjs`, `tests/schedule-weeks-migration.test.ts`.

- [ ] **Step 1:** the preflight (0274; `claim_cron_route` is 0268's body).
- [ ] **Step 2:** the tables + `valid_schedule_segments(jsonb, start_q, end_q)`: segments contiguous, span the shift, each ≥ 1 q, position = uuid or `"mod"`.
- [ ] **Step 3:** `commit_schedule_revision` per the sketch, and `approve_schedule_week` (head = expected; the head revision's `problems.errors = 0` else `rules_failing`; sets `approved_revision_id`; writes a revision row of kind `approved` pointing at the head (no shift copy)).
- [ ] **Step 4:** the `claim_cron_route` + CHECK re-emit with `'schedule-draft'` (line-subsequence pin against 0268).
- [ ] **Step 5: the harness** (`PASS 0275:`):
  - `head_moved`; `past_week`; `day_locked` (a changed past day refused, an identical one passes);
  - **`edited_week_unconfirmed`** (generated → edited → regenerated without confirm refused, with confirm OK; generated → regenerated with no edit OK);
  - `person_not_at_shop`; `position_not_at_shop`; `position_retired`; `shop_not_enabled`;
  - the cron path (null actor) only for `generated` with no head;
  - `rules_failing`;
  - append-only (UPDATE of revisions and shifts refused);
  - the ceilings;
  - concurrency: two commits with the same expected head serialise and the loser gets `head_moved` (single-session simulation through the advisory lock; the two-session proof is sim-only in Task 26).
- [ ] **Step 6:** the pin. Commit.

## Task 15: The audit vocabulary + i18n scaffolding for every code

**Files:** modify `lib/audit-actions.ts`, `lib/destructive-actions.ts`, `lib/i18n/en.json`, `lib/i18n/es.json`; create `tests/schedule-i18n.test.ts`.

- [ ] **Step 1:** register the actions:
  - **destructive** (a human act changing shared config or the record): `schedule.structure_update`, `schedule.shop_settings_update`, `schedule.person_settings_update`, `schedule.budget_set`, `schedule.regenerate_overwrite`, `schedule.week_approve`, `schedule.pin_set`, `schedule.day_type_set`;
  - **non-destructive:** `schedule.generate`, `schedule.regenerate`, `schedule.edit`, `schedule.budget_kept`, `schedule.draft_auto` (system), `schedule.generator_invalid`.
- [ ] **Step 2:** the test asserts every `ScheduleErrorCode`, every `RULE_CODES` entry, every reason key the generator can emit (enumerated from `reasons-shared.ts`'s closed union) and every board label has en + es, and that es uses tú forms (a denylist of `usted`/`su ` patterns on these keys).
- [ ] **Step 3:** green. Commit.

---

# Chunk E — Loaders, writers, routes, the Wednesday cron (Tasks 16–19) · Opus 5.5

## Task 16: `loadSchedulingInputs` — the ONE batch loader

**Files:** create `lib/scheduling/inputs.ts`, `lib/toast/punch-history.ts`, `lib/catering/booked-events.ts`; modify `lib/pulse/sales.ts`, `lib/report-digests-v2.ts`, `lib/people/skills.ts`; create `tests/schedule-inputs.test.ts`, `tests/schedule-loader-schema-check.test.ts`.

It loads, for one shop and a set of weeks, with every query paged/chunked:
- members (`loadMembers`' query);
- `computeSkillMatrixForShop`;
- the live structure + its id (else `structureFromStations` defaults, `source: "defaults"`);
- person settings (latest per user);
- budgets, day types, pins (active);
- the heads of the weeks + their shifts (+ the structure ids per revision for locked days);
- `loadSalesBaseline(asOf)` (one RPC);
- the reference week's daily actuals (`sales_report_daily`, one call, for the budget);
- `loadBookedCateringEvents`;
- `loadPunchHistory` (8 weeks, linked rows only);
- the closing facts via `loadPeopleFacts(…, families ["closingLines"])`;
- `sevenshifts_labor_settings` (overtime threshold) and hourly wages per linked user, only when 7shifts is `ready`. Wages are reduced in the LOADER to `{wageCentsByUser}` for the pure cost maths and are never placed in a client view-model (rates are summed server-side into totals).

- [ ] **Step 1 (tests):**
  - the recording-client schema check executes every query against the real column lists (0224, 0233, 0242 RPC args, 0268, 0270, 0274, 0275);
  - `loadSkillMatrix`'s wrapper output is byte-identical before/after the split (the equivalence pin + a direct snapshot);
  - `loadCateringNight` returns identical rows over the extracted loader (its existing tests + one parity test);
  - `loadPulseSales` is unchanged with the extracted `loadSalesBaseline` (a fake-RPC test);
  - the loader refuses (`inputs_unavailable`, 503) when 0274/0275 are absent (`42P01`), and the board renders the "not installed" line;
  - no wage field is present on the returned board view-model (a key scan).
- [ ] **Step 2:** implement. **Step 3:** green, with the equivalence pin green. Commit.

## Task 17: The schedules lib — generate, preview/apply horizon, edit, approve, settings

**Files:** create `lib/scheduling/schedules.ts`, `lib/scheduling/settings.ts`, `tests/schedules-lib.test.ts`.

- [ ] **Step 1 (tests, fake db + fake RPCs):**
  - every act runs `access-shared` BEFORE any I/O (a spy proves zero queries on refusal);
  - `generateWeek` → `buildWeek` → validator-clean → `commit_schedule_revision(kind generated, expected null)`;
  - `previewHorizon` returns per-week What changed + the token; `applyHorizon`:
    - `preview_stale` on any input drift (structure version, head id, inputs digest);
    - edited weeks need `confirmedEditedWeeks` and Tier B (`stepUpFor`);
    - a mid-range failure returns `{landed: [...], failed: {week, code}}`;
  - `saveEdit` applies an `edit-shared` op on the head and records the problems; a structural refusal maps to its code;
  - `approveWeek` refuses `rules_failing`, Tier B;
  - settings writers: Tier E for structure/shop, none for budgets/pins/day types/person settings; every write audited with before/after; the SMM refusal by role;
  - every refusal maps to a `ScheduleErrorCode` with an HTTP status (403/404/409/422/503).
- [ ] **Step 2:** implement. **Step 3:** green. Commit.

## Task 18: Routes + the step-up tier map + shop context

**Files:** create `app/api/schedule/route.ts`, `app/api/schedule/settings/route.ts`; modify `tests/step-up-tier-map.test.ts`, `lib/shop-context-shared.ts`; create `tests/schedule-routes.test.ts`.

- [ ] **Step 1 (tests):**
  - POST `{action: generate|preview|apply|edit|approve|budget|keep_budget|day_type|pin|person}` and `{action: structure|shop}`;
  - session required (401), same-origin check, JSON body shape (400 `bad_request`);
  - the tier per action pinned in the map (apply-with-edited → B; approve → B; structure/shop → E);
  - the route posts IDENTITIES, not values, for approve/apply (week + expected head + preview token), re-derived server-side;
  - `/schedule` and `/admin/people-reconcile` are declared in `SHOP_PARAMS_BY_PATH`.
- [ ] **Step 2:** implement. **Step 3:** green. Commit.

## Task 19: The Wednesday draft cron

**Files:** create `app/api/cron/schedule-draft/route.ts`; modify `vercel.json` (`{ "path": "/api/cron/schedule-draft", "schedule": "15 10,11 * * 3" }`); create `tests/schedule-cron.test.ts`.

- [ ] **Step 1 (tests):**
  - cron auth; lease `'schedule-draft'`;
  - the route acts only when ET is Wednesday and the ET hour ≥ 6 (both UTC slots arrive; one acts in EDT and in EST, the other finds the week built: idempotent through `head_moved`/"already exists" → `skipped`);
  - per enabled shop it builds NEXT week only when the week has no revision;
  - per-shop try/catch; one `schedule.draft_auto` audit per shop + `cron.success`/`cron.failure` heartbeat with `job: 'schedule-draft'`;
  - **not** in `JOBS_REGISTRY`;
  - nothing runs when no shop is enabled;
  - a generator throw is audited `schedule.generator_invalid` and the shop is skipped (never committed).
- [ ] **Step 2:** implement. **Step 3:** green. Commit.

---

# Chunk F — The board (Tasks 20–24) · Opus 5.5

All components render server-computed view-models from the pure modules. Client state is `useState` only. Every control is ≥ 44 px with `items-center`. Layout is phone-first at 375 px: the page never scrolls horizontally; **the timeline grid is the one horizontally scrollable region** (a canvas, like the mockup's 1024 px axis), with the person/position label column sticky, and a "Fit hours" toggle that zooms the axis to the shop day. Colours use the mockup's `co-ops-globals.css` station tokens, mapped onto the app's token roles (no new raw colours without BOTH `:root` and `@theme` entries).

## Task 20: Page shell, week picker, day tabs, money strip, budget suggestion

**Files:** create `app/(authed)/schedule/page.tsx`, `components/schedule/ScheduleBoard.tsx`, `MoneyStrip.tsx`, `BudgetSuggestion.tsx`, `DayTabs.tsx`; create `tests/schedule-board-ui.test.ts` (first block); add a nav/hub entry.

- [ ] **Step 1 (SSR tests):**
  - not enabled → "Scheduling is off for this shop" (+ MoO: "Turn it on in schedule settings");
  - not installed → the 503 line;
  - AGM → no $ anywhere in the HTML (key scan for `$` and the money keys);
  - past day tabs are `aria-disabled` with "Done";
  - the strip's 7 metrics with labels (hours vs budget, hourly $ / %, salaried, TOTAL %, OT risk, flex used, manager floor h + hourly h saved);
  - the suggestion shows its reasons and Accept / Keep;
  - "Settings changed — regenerate?" when the structure moved;
  - the confidence note for week 2+;
  - the "assumed availability" flag line;
  - en + es parity of every rendered key.
- [ ] **Step 2:** implement. **Step 3:** green. Commit.

## Task 21: The day timeline — demand curve, labor % per hour, coverage, MoD lane, strength, labor-target card

**Files:** create `components/schedule/DayTimeline.tsx`, `LaborTargetCard.tsx`, `RulesBadge.tsx`; extend the UI test.

- [ ] **Step 1 (tests):**
  - the demand SVG has an `aria-label` with the basis ("4-week same-day average");
  - the labor % row is toned from the setting;
  - coverage cells red / amber / green / grey with their text labels (colour is never the only signal);
  - the MoD lane flags gaps;
  - the Closing Manager row;
  - strength chips per window;
  - the labor-target card shows each math line and turns amber;
  - the rules badge: "Schedule rules: all checks pass" or "N problems", opening a list of named problems (rule key + params, en/es).
- [ ] **Step 2:** implement. **Step 3:** green. Commit.

## Task 22: Person rows, drag in 15-min snaps, the reason panel

**Files:** create `components/schedule/PersonRow.tsx`, `ReasonPanel.tsx`, `components/schedule/use-drag-snap.ts`; extend the UI test.

- [ ] **Step 1 (tests):**
  - multi-segment bars with dividers;
  - pointer drag converts pixels → quarter steps through the pure `edit-shared` op;
  - **keyboard/a11y twin:** each bar, edge and divider has "−15 min / +15 min" buttons (44 px), so nothing requires dragging;
  - locked days render no handles;
  - a refused edit shows its named message and snaps back;
  - an accepted edit posts `{action: edit, op, expectedHead}` and re-renders the problems;
  - the reason panel for a shift and for a segment: why this person / shape / segment / budget; the skill profile; who else could cover; "assumed availability" and "starting point" flags;
  - no wage or per-person $ in the panel.
- [ ] **Step 2:** implement. **Step 3:** green. Commit.

## Task 23: Horizon builder, Regenerate with "What changed", Approve

**Files:** create `components/schedule/HorizonBuilder.tsx`, `WhatChanged.tsx`; extend the UI test.

- [ ] **Step 1 (tests):**
  - the horizon choices (next week · next N weeks · rest of month · a month);
  - the preview lists per-week What changed (summary + collapsed per-day list);
  - edited weeks show "You edited this week — rebuilding replaces your edits" with a per-week checkbox (44 px label);
  - Apply asks for the password (Tier B) only when an edited week is checked;
  - unchecked edited weeks are skipped and say so;
  - `preview_stale` → "Something changed — preview again";
  - a partial result names the landed weeks;
  - Approve (Tier B) is disabled with the reason while rules fail;
  - "Ready for 7shifts — sending comes in a later update" (no send control).
- [ ] **Step 2:** implement. **Step 3:** green. Commit.

## Task 24: Settings — schedule structure, staff settings, leader shifts, presence / Add to schedule, shop switch, wage estimates, + the Phase 1 backlog screens

**Files:** create `app/(authed)/schedule/settings/page.tsx`, `components/schedule/StructureEditor.tsx`, `StaffSettings.tsx`, `PresenceAndAdd.tsx`, `components/people/SkillTunablesEditor.tsx`, `components/people/PrepPositionCard.tsx`; create `tests/schedule-settings-ui.test.ts`.

- [ ] **Step 1 (tests):**
  - **the structure editor** (the mockup's sections):
    - shop day, day types (thresholds + weekend), crews per day type (a table that wraps at 375 px as stacked cards), positions (open/trim/close/heads/allowed roles/priority toggle per pair), leadership, managers (min h/day, floor h/week = 32 sample), limits (min shift 4 h, OT, flex rules (Phase 3 note), closing checklist "measured ~N min from M closes · override"), catering rule, labor target % + basis;
    - Tier E prompt; a canceled prompt keeps the draft;
    - the TS validator names the key before posting;
    - the station-column advisory;
    - after save: "Settings changed — regenerate?";
  - **staff settings:** work type + also allowed, leader setting (Opens only / Closes only / Mix), preferred cover positions (ordered with ↑ ↓ × buttons, 44 px), soft range, full-timer;
  - **presence toggles** ("Cristian in today") and **Add to schedule** (person, block, positions they can flex across), both writing pins;
  - **MoO only:** shop switch + wage estimates (Tier E);
  - **Phase 1 backlog:** the MoO skill-tunables editor on `POST /api/people/settings` `action: "tunables"` (the same validator, Tier E), and the prep evidence position card (`action: "shop"`);
  - every string en/es; SMM refused.
- [ ] **Step 2:** implement. **Step 3:** green. Commit.

---

# Chunk G — Reconciliation, the sim, the law, verification (Tasks 25–28) · Opus 5.5

## Task 25: The THREE-WAY reconciliation view (§8.0)

**Files:** create `lib/scheduling/reconcile-shared.ts`, `lib/scheduling/reconcile.ts`, `app/admin/people-reconcile/page.tsx`, `components/admin/people-reconcile/ReconcileList.tsx`, `tests/schedule-reconcile.test.ts`.

The pure `reconcile(members, toastLinks, sevenLinks, sevenUsersAtShop, toastPunches14d, headShiftsPast14d, sevenPunches14d, sevenStatus)`:
- **each person row** carries three ticks (CO-OPS · Toast · 7shifts). The CO-OPS user is the anchor; nothing links by name. The 7shifts tick reads "not connected" while the status is not `ready`;
- **flags, each a named reason key:**
  - `toast_clockin_no_user`: an `employee_guid` with punches and no active link at this shop (first name only, from `employee_first_name`);
  - `seven_user_unlinked`: a 7shifts user assigned at the linked location with no link;
  - `member_no_toast`, `member_no_seven`;
  - `shift_no_punch`: a past head-revision shift with no Toast/7shifts punch overlapping it;
  - `punch_no_shift`;
  - `sources_disagree`: 7shifts punch hours vs Toast hours differ by > 15 min for the same person-day; **Toast stays the backup source of actual hours**, the row says so;
- rows sort flags first, then name.

- [ ] **Step 1 (tests):** each flag, plus "nothing links by name" (two people with the same first name stay separate).
- [ ] **Step 2:** the loader (paged; the gate before I/O: GM own / MoO+; SMM refused). Actions deep-link to `/admin/toast-employees?loc=` and `/admin/sevenshifts?loc=`; no new writer.
- [ ] **Step 3:** the page per the disclosure doctrine (summary rows + drawers, counts on collapsed headers, en/es, 375 px).
- [ ] Green. Commit.

## Task 26: The sim seed + the sim walk (CC runs it)

**Files:** create `scripts/sim/seed-scheduling.ts`, `tests/schedule-sim-seed-guard.test.ts`, `docs/runbooks/scheduling-sim.md`.

- [ ] **Step 1:** the script (a `pathToFileURL` guard; `assertSimTarget`; refuses the prod ref by name; dry run by default, `--apply` to write). Per sim shop it seeds:
  - 15 crew users + `user_locations`;
  - manual `toast_employee_links` (through the `link_toast_employee` RPC, source `manual`, actor = the sim GM);
  - 8 weeks of `toast_time_entries` from fixed patterns (some closers, some openers, one with no history, one BOH-only);
  - `schedule_shop_settings.enabled = true` + wage estimates through the 0274 writer;
  - optionally `--captures` synthetic capture rows if the 0221 shape allows; otherwise demand stays `none` (documented).
- [ ] **Step 2:** the guard test (pure argument/URL parsing; prod refused; no client built on refusal).
- [ ] **Step 3: the runbook** for CC:
  - apply 0274 → 0275 on the sim;
  - run the seed;
  - open `/schedule?loc=` at 375 px in en and es;
  - build next week, edit, regenerate with confirm, approve;
  - run the cron route by hand on a Wednesday clock (`?now=` is NOT accepted in prod code; the runbook uses the test's injected clock through the script `scripts/sim/run-schedule-draft.ts`);
  - the two-session `head_moved` check (`scripts/sim/schedule-lock-check.mjs`, sim-only guard as Phase 1's).
- [ ] Commit.

## Task 27: The law (AGENTS.md) + the manager guide (en + es)

**Files:** modify `AGENTS.md` (a new "Scheduling Phase 2" section under Phase 1's), `docs/guides/manager-guide.md`; extend `tests/manager-guide-scheduling.test.ts`.

The law captures, at least:
- the validator is non-negotiable, and gap discipline holds (declared + proven);
- generator purity, determinism and permutation invariance; the goldens and `GENERATOR_VERSION`;
- demand = the pulse baseline only (no second engine); catering named, never summed;
- revisions are append-only, edited weeks are never overwritten without per-week confirm + Tier B (enforced in SQL), and past days are locked in SQL;
- schedule time = ET wall-clock quarters;
- wages never leave the server as rates;
- availability is assumed from Toast punches until Phase 3 (flagged);
- the per-shop switch is off by default; the cron is not in `JOBS_REGISTRY`; no notifications;
- the structure is the single source of position hours once saved (station columns are advisory seeds).

The guide covers the board, the horizon, budgets, the labor card and reconciliation, with every step marked "(not shown)" until screenshots exist.

- [ ] Green. Commit.

## Task 28: Final verification

- [ ] `npx vitest run` (the full suite, after any other builder's run on that machine has finished); `node scripts/sql-harness-0274.mjs` and `0275.mjs` print PASS; `npx tsc --noEmit`; `npm run build`.
- [ ] `scripts/check-ui-tokens.ts` is clean for `components/schedule/**`, `components/admin/people-reconcile/**` and `components/people/*` (new).
- [ ] **Grep proofs, each with zero hits in new code:**
  - `rg "\"EM\"|\"MEP\"" lib/scheduling components/schedule app/(authed)/schedule app/admin/people-reconcile`;
  - `rg "enqueueNotification|lib/email|JOBS_REGISTRY" lib/scheduling app/api/schedule app/api/cron/schedule-draft`;
  - `rg "Math.random|Date.now\(|new Date\(" lib/scheduling --glob "*-shared.ts"`;
  - `rg "toLocale" lib/scheduling components/schedule`;
  - position-name literals in logic: `rg "Walk-ins|Expeditor|Prep/Dishwasher|Register" lib/scheduling --glob "!**/*.test.*"` (only fixture data may contain names);
  - `rg "sevenshifts.*(post|put|patch|delete)" -i lib/scheduling` (there is no 7shifts write).
- [ ] The goldens: `git log --follow tests/fixtures/schedule/golden-*.json` shows Task 8's commit plus only commits whose message gives a written reason.
- [ ] `tests/schedule-no-notify.test.ts` scans `lib/scheduling/**`.
- [ ] Hand CC the apply order: **0274 → 0275** (sim, then prod on Juan's word). Then the switch per shop (MoO, Tier E) AFTER the structure is reviewed with the GM and the wage estimates are set.

---

## Chunk map

| Chunk | Tasks | Delivers | Model | Independently testable by |
|---|---|---|---|---|
| A | 1–4 | time grid, structure + twin cases, permissions, **`checkScheduleRules` + mockup parity**, demand / closing duration / need grid, `baselineHourly` | Opus 5.5 | vitest only |
| **B** | **5–8** | **people input (assumed availability), templates, assignment/cover/priority/Closing Manager/MoD/reasons/strength, goldens + property test** | **Fable 5.1** | vitest only (goldens, property) |
| C | 9–12 | board maths, labor-target card, budget + suggestion, horizon + What changed + edit ops | Opus 5.5 | vitest only |
| D | 13–15 | 0274, 0275 (+ harnesses, ceilings, the overwrite guard in SQL), audit vocabulary + i18n coverage | Opus 5.5 | PGlite; key parity |
| E | 16–19 | the one loader (+ 3 extractions, equivalence intact), the lib, routes + tier map, the Wednesday cron | Opus 5.5 | fake db; schema check; route tests |
| F | 20–24 | the board (strip, tabs, timeline, drag, reasons, horizon, approve), settings + Phase 1 backlog screens | Opus 5.5 | SSR UI tests |
| G | 25–28 | three-way reconciliation, sim seed + runbook, the law + guide, verification | Opus 5.5 | pure + SSR; sim (CC) |

Chunks A and C can run in parallel with B once Task 3's types are merged. D can start after A. E needs B, C and D. F needs E. G needs E (Task 25 needs only 0275).

---

## Judgment calls (made in this plan; each reversible in one place)

1. **J1 — AGM sees a read-only board with no labor $ or %.** GM own shop and MoO+ build/edit (the GO). The money is hidden because `canSeeShopLaborTotals` is GM+ and labor % × forecast reveals $. O1 asks Juan whether AGMs edit.
2. **J2 — No staff view of shifts in Phase 2.** 7shifts stays the employee-facing schedule (spec §1). "Approve" marks the revision Phase 3 will send.
3. **J3 — Demand = the pulse's trailing same-weekday hourly average (28 days)**, the one shipped baseline. No trend/holiday adjustments, and catering is named, never summed (it avoids double-counting Toast-rung catering already in the baseline). Weeks ahead reuse the same curve with a confidence note.
4. **J4 — Position open/trim/close live in the schedule structure**, seeded once from the station columns. Later station edits show as an advisory, never applied silently: the scheduler needs open times and per-position head counts the station columns do not hold, and two silent sources would disagree.
5. **J5 — Schedule time is ET wall-clock quarter-hours per business date.** The shop day never crosses the DST hour; instants are derived only at the edges.
6. **J6 — A manager edit that breaks a rule is SAVED and shown with the rule** (spec §6.5). The mockup's silent rejection is not adopted. Only structural failures (overlap, malformed segments, off grid, locked day) are refused.
7. **J7 — Gap-class problems** (coverage, MoD, Closing Manager) are allowed in a generated schedule only when declared AND proven unfillable. The rule "a generated schedule that fails is a bug" therefore holds without forcing the generator to invent people.
8. **J8 — Closing checklist duration** = the p75 of (last live completion − service close) over the last 28 finalized closes, ≥ 8 samples, ceil to 15 min; else the manager override, else 45. p75 rather than the median, so closers' shifts cover a normal-bad night.
9. **J9 — No per-person $ on any Phase 2 surface, MoO included.** Rates are summed server-side; MoO+ already has the rates rule for a future wage screen (Phase 1 R5).
10. **J10 — Wages before 7shifts are a shop estimate set by MoO** (`estimated_hourly_cents`, `estimated_salaried_weekly_cents`), labelled "estimated" everywhere.
11. **J11 — Revisions are full snapshots** (≈ 100 shifts/week), so "What changed" is a pure diff and an edit is one revision. They are append-only and immutable.
12. **J12 — The overwrite guard is in SQL** (`edited_week_unconfirmed`), and Tier B is required to confirm. The cron can only create a week with no revision.
13. **J13 — The cron runs twice on Wednesdays (10:15 and 11:15 UTC)** and acts once at ≥ 6 AM ET, DST-proof and idempotent.
14. **J14 — Day types use the forecast thresholds, then a per-DATE override row** (not a structure edit), so a one-off busy Friday does not change the rules.
15. **J15 — Availability is assumed from 8 weeks of Toast punches** (share ≥ 25%, the p10–p90 window ± 30 min). With no history, a person is assumed available for the whole shop day, flagged.
16. **J16 — The roster excludes** `cgs`, `social_media_mgr`, `catering_mgr`, `prep_mgr` and levels < 2 by default (a structure setting). MoO/Owner are presence-only.
17. **J17 — Cover preferences default to empty**, so any manager cover is "last resort" until the GM sets them. The mockup's sample preferences are sample data.
18. **J18 — Approve takes Tier B and refuses while error-class problems exist.**
19. **J19 — Pairing "newer"** = `startingPoint` or skill below the `building` band; "strong" = at or above the `strong` band (Phase 1 tunables). There are no new constants.
20. **J20 — A 6-week horizon cap**, which still covers "a whole month" (≤ 6 ISO weeks).
21. **J21 — The Phase 1 backlog screens** (skill tunables editor, prep evidence position) ship here on their existing routes.

---

## Open questions for Juan (separate; none blocks Chunks A–C)

1. **O1 — AGMs:** should an AGM build and edit schedules at their own shop (with labor $ visible), or stay read-only as planned (J1)?
2. **O2 — Wage estimate:** what average hourly wage and weekly salaried cost should each shop start with until 7shifts wages sync? Or should money stay blank until then?
3. **O3 — The cron budget (CC):** one more Vercel cron, `/api/cron/schedule-draft`, Wednesdays 10:15 and 11:15 UTC.
4. **O4 — The labor target basis:** 28% of forecast for HOURLY labor only (planned default), or for TOTAL labor including salaried managers?
5. **O5 — Floor-time limit:** confirm 32 h/week per salaried manager as the starting setting, and the GM/AGM 8 h/day minimum.
6. **O6 — Who appears on the schedule:** are prep managers or catering managers ever on the floor schedule? They are excluded by default (J16), and it is a setting.
7. **O7 — Approve:** is "Ready for 7shifts" the right word for the approved week until Phase 3 sends it, or should Phase 2 have no approve step at all?

---

## Phase 3 backlog (deferred out of Phase 2 by ruling)

- The push to 7shifts as DRAFT shifts, reconciled by stable ids; the forecast interval overrides; the station-mapping screen (spec §8, §10).
- Two-way availability sync and the CO-OPS picker: untouchable day, flex day, personal timing. These replace "assumed from Toast punches", and the inert validator branches go live.
- "Out…" call-outs with reasons and fill (the validator's call-out branch for rule d).
- Staffing recommendations (promote-first, with the math).
- A staff "My shifts" view, if Juan wants one beside 7shifts.
- The demand anticipation hub (spec §11): any trend/holiday/event signal must prove itself on past data before it changes the baseline.

---

## Self-review against the spec and the GO

| Requirement (GO item / spec) | Where |
|---|---|
| 1. Hours budget per week / month split + weekly suggestion with reasons (§5.2) | Budget section; Tasks 11, 13 (`schedule_budgets`, month split), 20 |
| 2. Horizon: next week / N weeks / rest of month / month; partial weeks; never silently overwrite an edited week; What changed per week (§5.8) | Horizon section; Tasks 12, 14 (SQL guard), 17, 23; J12, J20 |
| 3. Generator: shapes from demand + trims; multi-position segments; skill-weighted with guardrails; team strength; leader settings; MoO/Owner presence; salaried cover within the floor limit; closing crew + Closing Manager; MoD; 4 h min, one per position, priority pairs, preferred cover | Generator section; Tasks 5–8 (Fable) |
| CORRECTED trims: Walk-ins/Online all day, 3rd Party ~4 PM; every open/trim/close a per-shop setting | Structure (Task 1), need grid (Task 4), J4 |
| 4. Wednesday draft + Regenerate with What changed | Tasks 19, 17, 23 |
| 5. Pure `checkScheduleRules` on every generated / regenerated / edited schedule and in tests; a failing generated schedule is a bug | Validator map; Task 3; `buildWeek` throws (Task 7); goldens + property (Task 8); edits record problems (Tasks 12, 17); J6, J7 |
| 6. Labor-target card ≤ 28% per shop, math shown | Task 10, 21; O4 |
| 7. Board per mockup v17: phone-first 2D, money strip, day tabs past-locked, demand curve + labor % per hour, coverage colours, 15-min drag, reason panel, en/es | Tasks 9, 20–24 |
| 8. Toast interim people + three-way reconciliation | Data reality; Tasks 5, 16, 25 |
| Demand source settled, exact functions, no second engine | "Where demand comes from"; Tasks 4, 16; J3 |
| Manager floor-time limit setting (sample 32 h) | `limits.managerFloorH`; rule `manager_floor_exceeded`; O5 |
| Closing-checklist duration measured from completion timestamps | Task 4 (`closingDuration`), Task 16 (`loadPeopleFacts` closingLines); J8 |
| Migrations from 0274 (0272 main, 0273 landing, 0264–0266 catalog 4a), verified | Ground truth row 1; Task 13 Step 0 |
| Data reality on the sim before 7shifts; availability assumed from punches, flagged | Data reality section; Tasks 5, 26; J15 |
| Golden discipline; generator pure modules first | Task 8; Architecture |
| Chunks of 3–5 tasks, TDD, pure first; Fable only for the generator core | Chunk map |
| Permissions in the lib; GM own / MoO+ all; SMM refused; step-up for publish/regenerate overwrite; every refusal named en/es | Permissions; Tasks 2, 15, 17, 18 |
| Out of scope listed (push, two-way availability, Out call-outs, staffing recs) | Header "Explicitly OUT"; Phase 3 backlog |
| No email / notifications | Standing rules; Task 19 (not in `JOBS_REGISTRY`); Task 28 grep + no-notify pin |
| Files-only migrations; ceilings; deny-all RLS; SELECT-only + definer writers | Migrations section; Tasks 13–14 |
| 44 px / 375 px; disclosure doctrine | Chunk F preamble; Tasks 20–25 |
| Phase 1 backlog honoured | Task 24 (tunables + prep position screens); work types / soft hours / leader settings (Task 24); Closing Manager role (Task 7); 7shifts mapping and writes → Phase 3 |
| Phase 1 equivalence pin untouched | Standing rules; Task 16 (`computeSkillMatrixForShop` split, pinned) |
