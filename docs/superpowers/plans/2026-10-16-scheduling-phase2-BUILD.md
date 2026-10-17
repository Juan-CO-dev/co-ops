# Smart Scheduling — Phase 2 (Scheduler + Board) Build Plan

## The hours budget · the planning horizon · the generator · the validator · the labor-target card · the board · Toast as interim people source + the three-way reconciliation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **No app code is written until Astra APPROVES this plan** (CC's GO, 2026-10-16: `05-BRIDGE/from-cc/GO-coops-scheduling-p2-plan-2026-10-16.md`). After approval, each chunk is reviewed by Astra and gated by CC.

**r0 (2026-10-16), CO Claude.** Written on `feat/scheduling-phase2` off `origin/main` @ **f1d51311**: Phase 1 shipped as #488 (squash dcf5f363), 0268–0271 on prod, 0272 on main. The spec is the amended `docs/superpowers/specs/2026-10-15-smart-scheduling-design.md` at f1d51311. r0 was commit db4a1c02.

**r2 (2026-10-16) answers Astra's round 1** (CHANGES REQUESTED: 3 P1, 9 P2, 1 P3). CC accepted every finding and ruled on each (`05-BRIDGE/from-cc/GO-coops-scheduling-p2-plan-r2-2026-10-16.md`). The main changes:
- **Gaps carry cause-specific certificates.** The generator runs a bounded, deterministic repair pass before it declares any gap.
- **Unknown skill is not inexperience.** A starting-point person gets their own band, and pairing is a soft preference.
- **Past days follow a historical-preservation contract.** They keep their original validation context as inherited problems, and SQL accepts unchanged history.
- **The demand curve shapes the shifts deterministically**, and the generator's gaps persist in full.
- **Discriminated demand.** Scheduling distinguishes demand that loaded, demand that is unavailable, and a shop with no sales history.
- **Budget contributions are date-scoped**, and suggestions use a reference period that can actually be compared.
- **The closing-duration override wins over the measured value, and only finalized closes are measured.**
- **Availability is judged per person**, with a fallback for short history.
- **Reconciliation compares against the published 7shifts schedule.**
- **A manager's day override comes first**, before the weekend rule.
- **The harnesses and the browser walk have explicit contracts.**
- **The validator's parity test checks each violation where it should appear.** I re-read `checkInvariants` directly in `C:/co/share/schedule-board/schedule-board.html` for this (see "The validator ↔ mockup invariants map").
- **Juan's open questions are now settings** with CC's defaults; see "Resolved".

The finding-by-finding map is **"Changes from r1"** at the end.

**r3 (2026-10-16) answers Astra's round 2** (CHANGES REQUESTED: 7 of 13 resolved; 1 P1 + 5 P2 open). CC's rulings: `05-BRIDGE/from-cc/GO-coops-scheduling-p2-plan-r3-2026-10-16.md`. What changed:
- **Certificates and search (P1).** A `capacity` certificate (a per-window counting bound) is added. Search exhaustion becomes an honest `unresolved_search` gap: amber, never a proof, and Approve refuses while it exists. Valid input never throws.
- **The curve transform (P2).** The floor and the capacity are now distinct values: the floor comes from a new per-position setting, `lineMinHeads`; the capacity from the existing head limits. Hour → quarter is a step function, and a flat curve reproduces the configured waves exactly. The shifted-peak fixture is worked numerically in the plan.
- **Inheritance integrity (P2).** The complete shift set, gap set and day record of every inherited day, past or future, must match the head.
- **Validation context (P2).** Each revision stores a JSON snapshot of the inputs it was validated with. Original validation replays against that snapshot; a separate advisory reports the current inputs.
- **Budgets (P2).** Precedence is per date.
- **Suggestions (P2).** Matched weekdays estimate a ratio only, applied to a complete 7-day base.

The finding-by-finding map is **"Changes from r2"** near the end.

**r4 (2026-10-16) answers Astra's round 3** (CHANGES REQUESTED, narrow: 1 P1 + 3 P2 + 1 P3). Her independent recompute of the A/B/flat arithmetic passed. CC's rulings: `05-BRIDGE/from-cc/GO-coops-scheduling-p2-plan-r4-2026-10-16.md`. What changed:
- **Every `unresolved_search` gap blocks Approve**, including inherited ones.
- **The snapshot persists the complete derived quarter-hour need grid**, and replay makes no live reads.
- **Suggestions:** unmatched dates keep their reference hours exactly, the ratio and negative deltas touch only matched dates, and matched dates are clamped at their minimum crew hours.
- **Zero demand has a finite, exact rule:** an all-zero forecast gives the minimum crew; a zero weighted sum gives an even split.
- **Stale examples reconciled:** `GapCause` lists all its causes, the 13:30 requirement is gone, and `rushShiftMaxQ` is display-only.

The map is **"Changes from r3"** at the very end.


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
- **Revisions, not mutations.** A week is a head pointer over append-only revisions. Each revision is a full snapshot of shifts, days (with their validation context) and declared gaps: generate, regenerate and edit each write one. Approval (r2) is a separate append-only fact naming a snapshot, so the snapshot contract has no exception. "What changed" is a pure diff of two snapshots. "Never silently overwrite an edited week" is enforced in SQL by the revision writer, not only in the UI.
- **Deny-all DB, permissions in the lib.** Every new table has RLS on, no user policies, and a 0257 service-role ceiling. The stateful tables are SELECT-only and written by SECURITY DEFINER RPCs (the accepted Phase 1 posture). Shop bind and role rules live in `lib/scheduling/access-shared.ts` and run before any I/O. The SQL writers re-check actor, shop and subject.
- **Dormant by default.** A per-shop switch `schedule_shop_settings.enabled` (default off) gates the board, the cron and every writer. No row means off.
- **Original validation vs current inputs (r3, P2-4).** Each revision stores a compact JSON snapshot of the RuleContext inputs it actually used (`schedule_revision_contexts`): roster, work types, leader settings, cover lists, assumed availability, positions, per-date budgets, closing minutes, the demand kind, and (r4) the complete derived quarter-hour need grid with the day type, its override source and the catering-derived need. A digest alone is never enough. **Original validation** replays every day against the snapshot of that day's origin revision, so a saved revision validates identically forever. A separate **current-inputs advisory** (`contextAdvisory(snapshot, live)`) lists what changed since. Examples: "Tess is no longer a member", "Ana's Thursday availability changed", "the budget for Oct 28 changed 62 → 58 h", "a newly qualified person could now fill the eligibility gap Thu 2–6 PM — regenerate?". The advisory never alters the original verdict.
- **History is preserved, never re-judged (r2, P1-3).** A day before today is carried forward byte-identical along with the validation context it was saved under. Its problems are "inherited". Current eligibility (an active person, a live position) applies only to new or changed future assignments, in the lib AND in SQL.

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

**r2 (P2-6): scheduling gets a discriminated demand result, and the pulse is unchanged.**
- The pulse's `baseline` wrapper turns an RPC error and its deadline into `null`. That behaviour stays as it is for the pulse.
- Scheduling does NOT reuse the null-returning wrapper. Task 16 splits `lib/pulse/sales.ts` into:
  - `fetchSalesBaseline(client, args, signal) → { kind: "ok"; raw } | { kind: "unavailable"; cause: "timeout" | "rpc_missing" | "rpc_error" }`;
  - the pulse's existing `baseline`, now a thin wrapper that maps every non-ok result to `null` exactly as today. A pinned test proves the pulse paths are unchanged.
- The scheduling loader `loadSchedulingDemand` returns `DemandResult = { kind: "ok"; days } | { kind: "unavailable"; cause } | { kind: "no_history" }`:
  - `no_history` = the RPC succeeded and `captured_days` holds no day of the needed weekdays; it KEEPS its dated days (each `no_history`) and their booked catering (Astra chunk A P2-7), so the catering prep rule still fires on a shop with no sales history;
  - `ok` with `weeks ≥ 1` for the weekday;
  - `unavailable` = the timeout, a missing RPC (`PGRST202` / `42883`) or any RPC error.
  - The successful-empty and failed cases are never conflated, and each is tested separately (timeout, missing RPC, successful empty history).
- **`unavailable` never builds:**
  - no generate, regenerate or horizon apply runs (the refusal `demand_unavailable`, 503, "Sales data didn't load — try again; nothing was changed");
  - the cron skips that shop for this run (audited), leaving any existing draft untouched;
  - it never falls back to the Normal crew and never replaces an existing draft.
- **`no_history`** (a new shop, or the sim without captures):
  - the day type falls back to the manager's per-date override, else the weekend classification, else `Normal` (the P2-12 order, Task 4);
  - every reason line says "No sales history — built on the Normal crew; set the day type if it is wrong";
  - the labor-target card and labor % render "—" with that errand, never a 0.

**The curve shapes the shifts (r2, P2-4).** The demand curve is not only a ranking input. `shapeFromCurve(curve, crew, structure)` in `need-shared.ts` turns it into the day's line arrival times and the line coverage counts per slot, inside the structural limits. See "The generator", step 3a.

**Catering**, named and not summed: `loadBookedCateringEvents` (extracted from `loadCateringNight`) plus ezCater orders' `event_timestamp` give `{date, name, headcount, valueCents, eventTime | null}`. They feed:
- (a) the structure's **catering prep rule**: extra Prep/Dishwasher heads in a prep window before the event, applied when headcount ≥ the rule's threshold; an unparseable `time_window` uses the rule's default window and the reason says so;
- (b) the budget suggestion's reason line ("2 catering orders on the books Thu (≈ 80 people) → +4 h prep").

---

## Data reality on the sim, before 7shifts (settled)

| Input | Source in Phase 2 | Flag shown |
|---|---|---|
| **Who** | Active members of the shop (`user_locations.active` × `users.active`), i.e. the same members `loadSkillMatrix` reads, minus `structure.roster.excludedRoles` (default `cgs`, `social_media_mgr`, `catering_mgr`, `prep_mgr`) and levels < 2. **r2 (O6 default): a person whose role is excluded can be added per person** (`schedule_person_settings.roster_include = true`), never `cgs` or `social_media_mgr`. MoO / Owner appear only through presence toggles or "Add to schedule". | A member with no Toast link: "Not linked to Toast — no punch history". |
| **Skills** | `computeSkillMatrixForShop` (Phase 1 matrix: learned + manager adjustment + rating prior). On the sim with no station history, every skill is the prior (0.5 or the manager's rating) with `startingPoint: true`. **r2 (P1-2): a starting-point skill is its own band, `unproven`, and never counts as "newer"** (see the generator's pairing rule). | Reason lines cite "starting point" skills ("Skill is a starting point — not enough worked data yet"). |
| **Availability** | **ASSUMED within the person's usual Toast punch pattern** until Phase 3: `punchPatterns` over the last 8 weeks of linked `toast_time_entries` (Task 5). **r2 (P2-10): the denominator is PERSON-SPECIFIC.** `weeksObserved` counts only the weeks since the person's first punch at this shop (or since `user_locations.created_at` when it is later) in which the shop had punches that weekday. A weekday counts as available when `weeksObserved ≥ 3` and it was worked in ≥ 25% of those weeks; the window is [p10 clock-in − 30 min, p90 clock-out + 30 min] snapped to 15 min. **Insufficient history** (`weeksObserved < 3` for the weekday, including unlinked people and new hires at 0, 1 or 2 weeks) = assumed available within the shop's normal hours (prep start → scheduled out), flagged. A new hire is therefore never LESS available after their first punch than before it. | **Every** availability on the board carries "Assumed from Toast punches · until availability syncs (Phase 3)". Generated shifts outside the assumed window are never made; manual edits there get the warning `outside_assumed_availability`. |
| **Days off / flex day** | None until Phase 3 (they are availability). The untouchable-day and flex-day rules are implemented in the pure modules and the validator, fed `[]`. | Strip: "Flex days: available once availability syncs". |
| **Work type, leader setting, cover preferences, soft hours** | CO-OPS-local person settings (0274 `schedule_person_settings`), written by the GM. These are scheduling settings, NOT availability, and are never synced. Defaults when no row: work type by role (shift_lead+ → Management; else FOH), leader setting by role (§5.3 defaults), cover preferences `[]` (so any cover is last-resort until set; the reason says so), soft range = the trailing 4-week mean of Toast hours ± 4 h (else 0–40). | "Default from role — set it in Staff settings". |
| **Wages** | 7shifts hourly wage via the user link when synced; else the shop's **average wage estimate** (`schedule_shop_settings.estimated_hourly_cents`, MoO sets it). Salaried weekly cost: 7shifts salary wages when synced, else `estimated_salaried_weekly_cents`. **r2 (O2 default): both estimates start NULL**, so money is blank until the MoO sets them. | "$ estimated at the shop average $X/h" until real wages exist. With neither, money reads "—" and the errand is "Set the shop's wage estimate" (MoO). |
| **Demand** | The pulse baseline (above). The sim has no captures, so demand is `no_history` (a successful RPC with no captured days, never confused with `unavailable`) and builds run on the day-type override / Normal crew. Task 26's seed can optionally write synthetic captures; it is not required for a run. | As above. |

The sim seed (Task 26) creates, per sim shop: 14 hourly people (trainee → key_holder) + 1 SL beside the personas, manual Toast links, and 8 weeks of synthetic punches with fixed patterns. The Wednesday draft and every board flow therefore run on the sim with no 7shifts token.

---

## Permissions (all in `lib/scheduling/access-shared.ts`, pure, before any I/O)

Actor = Phase 1's `PeopleActor` (`peopleActorFromAuth`, role from the session). "Own shop" = the actor's `user_locations`; level 8+ = any active shop.

| Act | Rule | Step-up |
|---|---|---|
| View the board, the labor-target card, the reconciliation view | GM (7) own shop; MoO (8)+ any shop. **AGM**: read-only board at own shop, hours/coverage/reasons only — the money strip's $ and %, the labor-target $ lines and labor % per hour are hidden ("GM and up see labor cost"), because labor % × forecast = $ and `canSeeShopLaborTotals` is GM+ (J1). **r2:** this is the setting `schedule_shop_settings.agm_access` = `'read'` (default; Resolved R1) \| `'edit'` (an AGM at their own shop builds and edits, money still hidden). | none |
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

`schedule_forbidden`, `schedule_role_refused`, `shop_not_enabled`, `shop_not_allowed`, `week_not_found`, `past_week`, `day_locked`, `head_moved`, `edited_week_unconfirmed`, `preview_stale`, `rules_failing`, `generator_invalid_output`, `structure_invalid` (+ `key`), `structure_moved`, `budget_invalid`, `person_not_at_shop`, `position_not_at_shop`, `position_retired`, `horizon_invalid`, `horizon_too_long`, `edit_off_grid`, `edit_overlap`, `edit_segments_malformed`, `edit_below_segment_min`, `pin_invalid`, `inputs_unavailable`, `wage_estimate_invalid`, and (r2) `demand_unavailable`, `history_changed`, `suggestion_unavailable`, and (r3) `unresolved_gaps` (Approve refused while an `unresolved_search` gap exists).

Step-up refusals reuse the shipped `step_up_required` / `step_up_stale`.

**Where Tier B lives (r2).** Tier B is verified ONLY at the app boundary (`assertStepUp(ctx, "B")` in the route, before the lib runs). SQL never sees a password or its age. The SQL writer checks only that the caller passed `confirmed_overwrite = true` for the edited weeks it names. SQL therefore guarantees "no edited week is overwritten without an explicit confirmation". It does not guarantee password freshness, and the plan never claims it does.

---

## Migrations (authored only; each with a PGlite harness + CI pin)

| # | File | Tables / functions | Kind | service_role ceiling |
|---|---|---|---|---|
| 0274 | `0274_schedule_settings.sql` | `schedule_shop_settings` (location PK; `enabled` default false; `estimated_hourly_cents`, `estimated_salaried_weekly_cents` nullable (default NULL = money blank, R2), CHECK 0 < x ≤ 100000 / 10000000; r2: `agm_access text not null default 'read' CHECK in ('read','edit')`) | config, writer RPC | SELECT |
| | | `schedule_structures` (one version per row: `id, location_id, structure jsonb CHECK valid_schedule_structure(structure), based_on_id, created_by, created_at`; LIVE = newest per shop; append-only) | versioned config | SELECT |
| | | `schedule_person_settings` (append-only; latest per (shop, user) wins: `work_type 'boh'/'foh'/'management'`, `also_allowed text[]`, `leader_setting 'opens'/'closes'/'mix'` null = role default, `cover_positions uuid[]` ordered, `soft_min_h`, `soft_max_h`, `full_time bool`, `full_time_min_h`, r2: `roster_include bool null` (true adds an excluded role such as prep/catering manager, R6; the writer refuses it for `cgs` / `social_media_mgr`); composite proof of the shop's positions in the writer) | append-only | SELECT |
| | | **r2 (P2-7), r3 per-DATE:** `schedule_budget_entries` (append-only; one row per manager ENTRY: `id, location_id, scope 'week'/'month', week_start date null CHECK isodow = 1, month date null CHECK day = 1, hours numeric(7,2) CHECK 0..8000 and hours*4 integral, source 'manager'/'accepted_suggestion', suggestion_digest text null, apportioned_by 'forecast'/'even'/'explicit', created_by, created_at`) + **`schedule_budget_days`** (r3; append-only, written in the same transaction as their entry: `entry_id, location_id, business_date, hours numeric(6,2) ≥ 0`; one row per date the entry covers; PK (entry_id, business_date)). **The budget for a date = the day row of the NEWEST entry covering it**, whatever its scope; the writer proves the day rows cover exactly the entry's dates (a week's 7 days / a month's days) and sum to `hours`. | append-only | SELECT |
| | | `schedule_day_types` (append-only per-date override: `business_date, day_type 'auto'/'slow'/'normal'/'busy'`) | append-only | SELECT |
| | | `schedule_pins` (presence + Add-to-schedule blocks: `business_date, user_id, start_q, end_q smallint CHECK 0 ≤ start_q < end_q ≤ 96, positions uuid[], kind 'presence'/'added', active`; retire = new row `active=false` referencing `retires_id`) | append-only | SELECT |
| | | `valid_schedule_structure(jsonb)` (immutable, pinned search_path), `save_schedule_shop_settings`, `save_schedule_structure(p_actor, p_location, p_expected uuid, p_structure)`, `record_schedule_person_settings`, `record_schedule_budget_entry(p_actor, p_location, p_scope, p_week_start, p_month, p_hours, p_days jsonb, p_source, p_digest, p_apportioned_by)` (r3: the entry and its per-date rows in ONE transaction; it re-checks that the rows cover exactly the entry's dates and sum to `p_hours`), `record_schedule_day_type`, `record_schedule_pin`, helper `schedule_actor_level(actor, location)` (GM own / 8+ any; mirrors `toast_link_actor_level`; r2: reads `agm_access` so an AGM gets 7-equivalent EDIT rights at their own shop only when the setting is `'edit'`) | SECURITY DEFINER, service_role only | — |
| 0275 | `0275_schedule_weeks.sql` | `schedule_weeks` (`id, location_id, week_start` UNIQUE (location, week_start); `head_revision_id`, `approved_revision_id`, `created_at`) | head pointers, writer RPC | SELECT |
| | | `schedule_revisions` (append-only: `id, week_id, location_id, kind 'generated'/'regenerated'/'edited', based_on_revision_id, structure_version_id → schedule_structures, inputs_digest text, generator_version text, horizon_run_id uuid null, problems_summary jsonb (DISPLAY ONLY: counts per code + first 50), created_by uuid null (null = cron), actor_context text, created_at`). **r2: every revision is a complete snapshot, with no exception.** There is no `approved` kind: approval is a separate fact (below). | append-only | SELECT |
| | | `schedule_revision_shifts` (`revision_id, location_id, user_id, business_date, start_q, end_q, segments jsonb CHECK valid_schedule_segments(segments, start_q, end_q), closing_manager bool, flex bool, pinned bool, reasons jsonb`; UNIQUE (revision_id, user_id, business_date, start_q); composite FK (revision_id, location_id)) | append-only (immutable) | SELECT |
| | | **r2 (P1-3):** `schedule_revision_days` (`revision_id, location_id, business_date, origin_revision_id` = the revision in which this day's content was last CHANGED, `structure_version_id` = the context it was validated under at its origin, `inherited bool` (true when the day was copied unchanged from the head), `problems jsonb` = the COMPLETE problem list for that day under its origin context (not truncated); UNIQUE (revision_id, business_date)). | append-only (immutable) | SELECT |
| | | **r2 (P2-5):** `schedule_revision_gaps` (`revision_id, location_id, business_date, code 'coverage_gap'/'mod_missing'/'closing_manager_missing', position_id uuid null, from_q, to_q, cause 'budget'/'floor_limit'/'eligibility'/'availability'/'capacity'/'structure'/'unresolved_search' (r3), certificate jsonb` (the cause-specific evidence, see "Gap certificates"), `origin_revision_id`; UNIQUE (revision_id, business_date, code, coalesce(position_id, nil uuid), from_q)). These are the complete `DeclaredGap[]`, independent of the 50-row display summary. | append-only (immutable) | SELECT |
| | | **r3 (P2-4):** `schedule_revision_contexts` (`revision_id` PK, `location_id`, `context jsonb` CHECK object and ≤ 262144 bytes, `context_digest text`): the compact JSON snapshot of the RuleContext inputs ACTUALLY USED when that revision's changed days were validated — roster (userId, role, active member, work type, also-allowed, leader setting, cover positions, salaried, presenceOnly, roster_include), assumed availability per person × date (window + source), positions (id, active, station active, role, window, head limits, allowed roles), the per-date budgets with their composition, the closing minutes used, and the demand kind + day totals. **r4 (P2): the COMPLETE derived quarter-hour need grid per changed date** — `need[positionId][q]` for every position, plus `lineTotal_q`, `minHeads(q)`, `maxHeads(q)`, and the provenance of each need (wave/shape, closing crew, BOH crew, catering) — together with the inputs that produced it: the hourly forecast `d_h` used, the day type AND its source (manager override / weekend / forecast thresholds), the override row id, the catering events used (id, headcount, event time or default window), and the shape note (normal / zero_demand / zero_profile). A day's ORIGINAL validation replays against the context of its `origin_revision_id` **using only the snapshot: no live read of demand, overrides, catering, structure or people**. The digest is kept for quick comparison, never as a substitute. | append-only (immutable) | SELECT |
| | | **r2:** `schedule_week_approvals` (append-only: `week_id, location_id, revision_id` (the approved snapshot), `approved_by, approved_at`). `schedule_weeks.approved_revision_id` is the newest approval. Approval copies nothing because it is not a revision: it NAMES an existing full snapshot. | append-only | SELECT |
| | | `commit_schedule_revision(p_actor, p_location, p_week_start, p_expected_head, p_kind, p_structure_version, p_shifts jsonb, p_days jsonb, p_gaps jsonb, p_context jsonb, p_meta jsonb)`, `approve_schedule_week(p_actor, p_location, p_week_start, p_expected_head)`, `valid_schedule_segments(jsonb, int, int)`, `valid_gap_certificate(text, jsonb)` | SECURITY DEFINER / immutable | — |
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
--  6. day_locked      : any business_date < ET today whose shift set, day row or gap set differs from the head's (canonical jsonb)
--                       -> an unchanged past day is ACCEPTED whatever happened since (person deactivated, position retired)
--  7. edited_week_unconfirmed:
--       p_kind = 'regenerated' and exists (select 1 from schedule_revisions r where r.week_id = w.id and r.kind = 'edited'
--         and r.created_at > (select max(created_at) from schedule_revisions g where g.week_id = w.id and g.kind in ('generated','regenerated')))
--       and coalesce((p_meta->>'confirmed_overwrite')::boolean, false) is not true
--     (SQL sees only that boolean; the Tier B password check happened at the app boundary.)
--  8. r2 (P1-3) CURRENT ELIGIBILITY APPLIES ONLY TO NEW OR CHANGED FUTURE ASSIGNMENTS:
--       for every shift in p_shifts whose (user_id, business_date, start_q, end_q, segments) is NOT identical to a head shift,
--       and whose business_date >= ET today:
--         the user is an active member of p_location (person_not_at_shop);
--         every segment position is an ACTIVE position of p_location on an active station
--         (people_position_at_shop from 0270) (position_not_at_shop / position_retired).
--       An IDENTICAL carried shift (past or future) is not re-judged. A future shift of a since-deactivated person is
--       accepted only when unchanged, and the lib flags it as an inherited problem (`not_member`, inherited).
--  9. r3 (P2-3) INHERITANCE INTEGRITY, for PAST and FUTURE inherited days alike: for every day marked inherited,
--       (a) the day row equals the head's day row (origin_revision_id, structure_version_id, problems),
--       (b) the COMPLETE canonical shift set of that date equals the head's (user, start_q, end_q, segments, flags, reasons), and
--       (c) the COMPLETE canonical gap set of that date equals the head's (code, position, from_q, to_q, cause, certificate, origin);
--       any difference -> history_changed. A day marked NOT inherited must have origin_revision_id = the new revision
--       (it is re-judged: step 8 applies to its shifts). Past days are additionally bound by step 6.
--     every gap row's certificate is shape-checked (valid_gap_certificate(cause, certificate)); p_context is a JSON object.
-- 10. insert revision + shifts + days + gaps + context; update schedule_weeks.head_revision_id; return {revision_id, week_id, kind}
--
-- approve_schedule_week: lock as above; head = p_expected_head (head_moved); no day of the head has an error-class
--   problem that is NOT inherited (rules_failing); r4 (P1): NO gap row of the head, inherited OR not, has cause
--   'unresolved_search' (unresolved_gaps). The inherited-error exemption NEVER covers unresolved gaps;
--   insert schedule_week_approvals; set approved_revision_id. No revision row.
```

The lib runs `checkScheduleRules` BEFORE calling it. **r2:** problems are split into NEW (on days generated or changed in this revision) and INHERITED (carried with their original context). A generated/regenerated revision with a NEW error-class problem is never sent (`generator_invalid_output`, audited `schedule.generator_invalid`, 500). Inherited problems are carried, shown with an "earlier problem" label, and never block a build. An edit revision is sent with its problems recorded (spec §6.5: shown on the board with the rule it breaks). Only the structural edit failures (overlap, malformed segments, off grid, locked day) are refused.

**Ceilings:** the 0257 pattern on every table. RLS on, no policies; `revoke all … from public, anon, authenticated, service_role`; `grant select … to service_role`; then a `do $$` guard that raises if any PostgREST role holds anything, or if service_role holds INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER. Functions: revoke from public/anon/authenticated, EXECUTE to service_role, and an `information_schema.routine_privileges` guard. Sequences are revoked.

---

## The validator ↔ mockup invariants map (`checkScheduleRules`, Task 3)

`checkScheduleRules(schedule: WeekSchedule, ctx: RuleContext): RuleProblem[]`. It is pure, total, and deterministic in its output order. `RuleContext` = the structure in force per day, people (role, work type, leader setting, cover list, salaried, assumed availability), positions, today, and the declared gaps with their certificates. Each `RuleProblem = { code, severity: "error" | "gap" | "warning", day, userId?, positionId?, q?, params, inherited: boolean }` renders through `schedule.rule.<code>` (en + es).

**r2: verified against the source.** On 2026-10-16 I re-read `checkInvariants` (page script, lines 241–274 of the extracted `<script>`) in `C:/co/share/schedule-board/schedule-board.html`, plus its harness `schedule-invariants.test.cjs`. The checks below quote what each one actually tests:
- **(a) person overlap:** `personSlots` keyed `day:person:q` → "overlaps … at <time>".
- **(b) position over head count:** `occupancy` keyed `day:position:q` against `q/4 < trim ? before : after` → "N people, limit L".
- **(c) shift below minimum:** `s.end − s.start < minimumSlots(s)` (the flex minimum applies only on the person's flex day while `flexUses > 0`).
- **(d) role and Prep/Dishwasher:** `allowedRoles[pos]` must include the role, and "manager on Prep/Dishwasher without call-out last resort" is a SEPARATE message. Both are exempt only when `coverFor` AND the reason contains "call-out last resort".
- **(e) position window:** the segment must sit inside **[open, close]** — the mockup checks OPEN–CLOSE, not trim. Trim only changes the head-count limit in (b). r0 said "open–trim–close"; r2 corrects it.
- **(f) Closing Manager role:** `closingManager` on a role not in `leadership.closingRoles` → "Closing Manager role not permitted".
- **(g) leader settings:** `shiftPreferenceWarning` (opens = start < service start; closes = end ≥ service close) → "leader setting … violated". The Closing Manager flag on a person whose role cannot close, or whose setting is "Opens only", → "Closing Manager setting does not allow closing".
- **(h) priority pairs:** for each `priorityPairs` station and each slot from prep start to scheduled out, a secondary occupied while its primary is not → "secondary filled without … primary".
- **(i) manager cover:** a manager on a position whose index in `coverPreferences` is −1, with no "last-resort" in the reason.
- **Two structural checks:** "segments do not span shift" and "segment gap or overlap".
- **Unknown person.**
- **Past days** (`s.day < today`) are checked under `defaultStructure`, the structure they were built with. r2's historical contract (P1-3) generalises exactly this.

I also confirmed the defaults the mockup ships:
- `priorityPairs = {prep: [prepDish, prep], expo: [register, expo], walk: [hybrid, walk]}`, with `positionPriority = {prep: 'prepDish', expo: 'register', walk: 'hybrid'}`;
- `defaultCoverPreferences = {alex: [prep, expo, register], jules: [expo, register], dani: [register, expo], cristian: [expo], pete: [prep]}`. These are sample data (J17);
- the Walk-ins / Online position (`hybrid`) runs open 10:30 → close 21:00 with `before = after = 1`, so it is covered all day.

| Mockup v17 check | Rule code(s) | Severity | Notes |
|---|---|---|---|
| (a) no person has two overlapping blocks | `person_overlap` | error | per 15-min slot, across shifts and segments |
| (b) no position over its head count at any 15-min slot | `position_over_headcount` | error | limit = `headsBefore` before trim, `headsAfter` after |
| (c) every shift ≥ minimum (or the flex exception) | `shift_below_minimum` | error | flex exception inert until Phase 3 |
| (d) allowed roles; no manager on Prep/Dishwasher unless call-out last resort | `role_not_allowed`, `manager_on_boh` | error | two codes, as in the mockup; the call-out exemption branch exists and Phase 2 never emits it |
| (e) segments inside each position's **open–close** window | `segment_outside_window` | error | r2 correction (trim belongs to (b)) |
| (f) Closing Manager carried by an allowed role | `closing_manager_role` | error | |
| (g) leader open/close setting; the Closing Manager's setting allows closing | `leader_setting`, `closing_manager_setting` | error | |
| (h) secondary filled ⇒ primary filled at that slot | `secondary_without_primary` | error | |
| (i) no manager outside preferred cover unless marked last-resort | `cover_outside_preferences` | error | `lastResort: true` on the segment |
| structural | `segments_malformed`, `unknown_person`, `not_member` | error | |
| spec §6.5: manager on duty every hour when required | `mod_missing` | gap | certificate required |
| spec §6.5: salaried minimums | `salaried_minimum` | error | |
| mockup harness: a Closing Manager each open day | `closing_manager_missing` | gap | certificate required; satisfied only by an ELIGIBLE flagged shift that is on the clock over the closing window (Astra chunk A P1) |
| the Closing Manager flag on a shift that does not cover service close → everyone out | `closing_manager_not_closing` | error | Astra chunk A P1 (a KH 10:30–14:30 flagged CM fails) |
| spec §5.7 floor cap | `manager_floor_exceeded` | error (warning on a manager-edited week, CC addendum A) | `limits.managerFloorH` (32, a setting); BASE station time (flex aside) |
| Juan 2026-10-16 decision 4: the salaried week target / the flex | `salaried_base_over_target`, `salaried_over_flex` | warning (CC addendum A: the 40 h is a target); hard for the generator | `limits.salariedTargetWeekH` (40), `limits.salariedFlexH` (10); a flex-only day is a cover (no GM / AGM daily minimum), chunk H2 |
| spec §5.5 work type | `work_type_not_allowed` | error | |
| spec §5.1 untouchable day | `untouchable_day` | error | inert until Phase 3 |
| coverage below need | `coverage_gap` | gap | certificate required |
| overtime, budget, soft range, availability, checklist, flex, pairing | `overtime`, `over_budget`, `soft_range`, `outside_assumed_availability`, `checklist_past_max`, `flex_used`, `pairing_unmet` | warning | shown, never blocking |

**Gap certificates (r2 P1-1, r3 P1).** The generator returns `gaps: DeclaredGap[]`, each `{code, day, positionId?, fromQ, toQ, cause, certificate}`. A gap-class problem passes ONLY when a declared gap covers it AND `checkCertificate(gap, schedule, ctx)` verifies the certificate for its cause. `ctx` is the revision's own validation-context snapshot (r3, P2-4 below), never the live inputs.

| cause | certificate (persisted) | what `checkCertificate` verifies | proven? |
|---|---|---|---|
| `budget_limited` (CC chunk D DESIGN RULING, 2026-10-16; was `budget`) | `{budgetedDates, budgetHours, usedHours, essentialHours, remainingHours, fillHours, witness}` | **No minimality claim.** It certifies only what it can verify: the remaining hourly budget on the budgeted dates, `remainingHours` R = `budgetHours` − (`usedHours` − `essentialHours`), is below `fillHours` W, the cost of the cheapest legal fill the DETERMINISTIC search `cheapestFill` FOUND, whose steps (`relabel` / `extend` / `new_block`) are the `witness`. The verifier re-runs the same search and requires the identical witness and W > R (and W > 0: a zero-hourly-cost fill is never a budget gap). The search covers: zero-hourly-cost fills (a salaried MoD relabel, a salaried manager staying longer); a spare segment on an over-covered position; an extension of an existing shift (incl. a PAIRED extension of the primary for a priority secondary — Astra chunk D P1: two staffed shifts each extended to noon = 2 h); a reassignment within REPAIR_LIMITS (depth 1, ≤ 8 donors) with its refill; a new block with a legal placement witness. If W ≤ R it is NOT a budget gap: the generator takes that fill. **Essential coverage is budget-exempt and never excused by budget (Astra chunk A P1).** The board shows "Over budget: needs at least ~W h (best fill found)" in amber. **Approve does not refuse `budget_limited`** (leaving it is a manager's choice); it still refuses `unresolved_search` and any gap whose certificate does not verify. | yes |
| `floor_limit` | `{managerIds, floorHoursUsed, limitH}` | Every eligible free candidate is a salaried manager at or over `managerFloorH` for the week once this window is added, and no eligible hourly person is free. **"Free" for an hourly person (Astra chunk A P1)** = no shift that day, OR a shift that day that EXTENDS over the window (`shiftExtendsOver`: no overlap with the window, the merged span inside the shop day, their availability and leader setting, room under the head limit on the gap's position over any bridging quarters). A window inside their shift is not an extension; the repair search owns that case. | yes |
| `eligibility` | `{positionId, eligibleCount: 0}` | NO member at all may work the position at that time (role, work type, roster), whatever the allocation. **Eligibility is judged at EVERY quarter of the window** (Astra chunk B P1-2): a key holder who may be MoD from the "KH may be MoD after" time is eligible for any window reaching past it, so an impossibility before the boundary never certifies the time after it; the generator splits MoD holes at that boundary. | yes |
| `availability` | `{eligibleIds, unavailableIds}` | Every eligible member is outside their assumed availability, or off that day, at every quarter at which they COUNT (Astra chunk B P1-2). | yes |
| **`capacity`** (r3) | `{fromQ, toQ, positionIds: S, requiredHeads, peopleIds: N, people: n, shortBy}` | **A counting bound, per window.** For every quarter `q` in [fromQ, toQ), `requiredHeads(S, q) = Σ_{p ∈ S} need(p, q)` exceeds `n = |N(S, q)|`, where `N(S, q)` = the members eligible for at least one position in S AND available at q (on shift elsewhere or not; every such person is counted once). Then at least `shortBy = requiredHeads − n` heads of S must be uncovered at q **in every possible allocation** (one person fills one position at a time, rules a/b). It certifies when the uncovered heads of S at each q are ≤ `shortBy` (the excess, if any, needs another cause). The numbers are shown: "11:30–2:00: 5 heads needed on Walk-ins / Online, Walk-ins, Register & Delivery; 4 people can work them → short 1". The generator searches S over the positions needing heads at q (all subsets up to size 4, then the whole set), in canonical order, keeping the S with the largest `shortBy` (a Hall-type bound). | yes |
| `structure` | `{rule, detail}` | The configuration itself makes the need impossible: a priority secondary needed while the primary's window is closed; the MoD required with no SL+ member at the shop; a Closing Manager required with no member able to close. It is verified by `structureInfeasible(structure, day, gap)`, pure. **A position window shorter than the minimum shift is NOT a proof** (Astra chunk A P2-4): the minimum applies to the whole shift, and the window is filled as a segment of a multi-position shift. **CC chunk C ruling 2 — rule `max_shift`:** the daily maximum ALONE leaves part of a need run uncoverable, proved by a counting bound recomputed exactly (`capOnlyBound`): the need run is longer than one shift (runQ > maxShiftQ); each member who counts at some quarter (eligible AND available, or already standing there) contributes at most min(maxShiftQ, their counting quarters); at every quarter the need ≤ the people who count there (else it is not the cap's); shortQ = requiredQ − coverableQ ≥ 1; and the head-quarters actually uncovered over the run are ≤ shortQ. An overlong window alone is never proof (Astra). Sound because the validator's daily maximum is per person per DATE. The generator first extends an adjacent shift up to the cap toward a deficit nothing else proves (`extendToCap`, reason `extended_to_cap`), so the remainder is exactly the cap's. | yes |
| **`unresolved_search`** (r3) | `{searched: {steps, donorsTried, chainDepth}, limits: {REPAIR_MAX_STEPS, maxDonors, maxChainDepth}, candidateIds}` | **NOT a proof.** It is an honest statement that "no fill was found within the search limit; a manager may find one". It verifies only that the search really hit a limit (`steps = REPAIR_MAX_STEPS`, or every candidate chain up to `maxChainDepth` with `maxDonors` donors per link was tried) and that no PROVEN cause certifies the deficit. | **no** |

- **`unresolved_search` is shown AMBER on the board** ("No fill found within the search limit — you may find one: try {candidates}").
- It is counted in "What changed" and listed in the rules badge as a gap needing a person.
- **Approve refuses while one exists** (`unresolved_gaps`, en + es). This holds in the lib and in SQL. **r4 (P1):** `approve_schedule_week` counts ALL of the head's gap rows with `cause = 'unresolved_search'`, inherited or not. The inherited-error exemption (which lets an earlier rule break on a kept day pass Approve) never applies to an unresolved gap: someone must fill it, or a rebuild must prove it.
- It is never an error, and it never throws.

**"No feasible insertion into THIS allocation" ≠ "unfillable".** Before declaring any gap other than `eligibility`, `structure` or `capacity`, the generator runs the bounded repair search (generator step 9a). `checkCertificate` for `availability` / `floor_limit` re-checks against the FINAL allocation. A gap whose only blocker is a person who could be moved cannot certify as availability or floor limit: when search did not find the move, it is `unresolved_search`, not a false proof.

**The non-throwing contract (r3, resolves the Task 7 / Task 8 contradiction).** `buildWeek` NEVER throws for a valid input.
- Every deficit ends as a fill, a proven gap, or `unresolved_search`.
- `buildWeek` throws ONLY on a programmer error: an invariant violation, i.e. the final `checkScheduleRules` finds a NEW error-class problem or a gap whose certificate does not verify (including an `unresolved_search` claim when the limits were not hit).
- Such a throw is a bug (`generator_invalid_output`, audited); the property test proves it never happens on the valid input space.

**Parity with the mockup (Task 3, r2: per-violation, not aggregate counts).** `scripts/schedule-mockup-export.cjs` runs the v17 page script in `vm` (the harness's own technique; read-only; verified 2026-10-16: 78 shifts, 82 segments, 7 Closing Manager flags, `checkInvariants` = 0). It writes `tests/fixtures/schedule/mockup-v17-week.json`. `tests/schedule-rules-mockup-parity.test.ts` asserts:
1. **The clean fixture:** the sample week has 0 error-class problems.
2. **Each intended violation is detected at its expected person / position / time.** Every negative control from `schedule-invariants.test.cjs`, rebuilt from the JSON:
   - **the short Pete shift** (Owner, prepDish, Wed 5:30–6:00 PM, q 70–72; re-run 2026-10-16, the mockup prints exactly "shift under 4 h minimum", "Owner is not allowed on Prep/Dishwasher", "manager on Prep/Dishwasher without call-out last resort" and "manager covers Prep/Dishwasher outside preferred positions without last-resort reason"): `shift_below_minimum`, `role_not_allowed`, `manager_on_boh` and `cover_outside_preferences`, each at (pete, Wed, prepDish, q 70), matched one-to-one;
   - **(g) Dani** ("Opens only" SL, shift extended to scheduled out on MoD): `leader_setting` at (dani, that day);
   - **(h)** the week with the primary Walk-ins / Online removed wherever a secondary Walk-ins slot overlaps: `secondary_without_primary` at EVERY (day, walk, q) the mockup lists. We compare the SET of (day, q) to the mockup's own `checkInvariants` output on the same list, which is run in `vm` at export time and stored in the fixture. Exact counts are kept only here, because both validators deliberately report per slot;
   - **(i) Alex** on Walk-ins with an unmarked reason: `cover_outside_preferences` at (alex, walk).
3. **Deterministic diagnostics:** the same input gives the same ordered problem list, byte-identical, twice.

The export is checked in. The mockup itself is never imported by the app.

---

## The generator (pure; `lib/scheduling/generator/*`)

`buildWeek(input: GeneratorInput): GeneratorOutput`, where:
- `GeneratorInput` = `{ locationId, weekStart, days: BuildDay[], structure, people: SchedPerson[], skills: SkillLookup, pins: Pin[], budgetByDate: Record<string, number> /* r3: per-date budgets; a missing date = no budget */, head: HeadSnapshot | null, today }`, with every array canonical (sorted by id);
- `GeneratorOutput` = `{ shifts: Shift[], days: DayRecord[], gaps: DeclaredGap[], reasons: ReasonIndex, notes: BoardNote[], stats }`.

The phases mirror the mockup's `buildDay` / `templatesFor` / `enforcePriority`. Everything is driven by structure data, by id:

1. **The historical-preservation contract (r2, P1-3).** Past days (`< today`), and future days outside the build range (horizon `keptDays`), are copied from the head UNCHANGED: shifts, the day record (`origin_revision_id`, `structure_version_id`, `problems`) and that day's gaps. They are marked `inherited`. They are never re-validated under the current structure or current eligibility; their problems remain the ones recorded at their origin, labelled inherited. Cross-day rules that touch a built day — the weekly overtime and floor-hour totals — COUNT inherited hours but attribute a problem only to the built days. A person who was deactivated, or a position that was retired after an inherited day, therefore never fails a later build.
2. **Pinned first.** Pins (presence, added) become fixed blocks at $0 for MoO/Owner (§5.4), and segments run on their stated positions or MoD.
3. **Salaried on the clock.** Each GM/AGM not off gets a MoD block of `max(minimumShiftH, roleMinimumH)`, anchored per their leader setting (opens → prep start; closes → ending at scheduled out). Reason: `salaried_minimum`.

   **3a. The curve → shape transform (r2 P2-4, rewritten r3), `shapeFromCurve`, pure and deterministic.**

   **Inputs (all from existing settings, plus one new one):**
   - the day's hourly forecast `d_h` (cents, from `DemandResult.ok`);
   - **the wave profile `W_q`** (CC's W ruling 2026-10-16, Astra chunk A P2-6; `waveSlots` / `waveProfile(structure, dayType)`): the line head count per quarter that the configured setup / service / rush waves and the closing crew produce, placed as the mockup's `templatesFor` places them — the closing crew reserved first (register heads, the walk pair's primary, then the other walk position; from max(trim, service start) to the close), then each wave head on the MOST DEFICIENT open line position at the wave time (head limit minus heads already placed; ties in canonical line order), ending at that position's TRIM — and **EXCLUDING the mockup's head-count fill** ("every station head-count is a rule"), which was a display convenience, not a staffing rule. W runs over the service period (before service close) and is clamped into [`minHeads(q)`, `maxHeads(q)`]: zero waves target the floor, and waves beyond the positions' capacity (the v17 defaults ask 8 heads of 6 single-head positions) are capped. With `T = Σ_q W_q × 0.25` the day's **target line hours**;
   - **`minHeads(q)`** (the FLOOR) = Σ over line positions open at q of `crews[dayType].lineMinHeads[positionId]`. **This is a NEW setting** (r3), because no existing field holds a per-position minimum crew: `headsBefore`/`headsAfter` are LIMITS (rule b). The default, from v17's "one person per position, primary first", is 1 on each primary line position (Walk-ins / Online, Register & Delivery, Crunchy Boi, 3rd Party) and 0 on the secondaries (Walk-ins, Expeditor);
   - **`maxHeads(q)`** (the CAPACITY) = Σ over line positions open at q of their head limit (`headsBefore` before trim, `headsAfter` after) — the existing rule (b) values.
   - The structure validator requires `minHeads(q) ≤ W_q ≤ maxHeads(q)` for every quarter of the service period of every day type (Task 1). Without it the flat rule below could not hold. Since W is clamped into those bounds, the rule fails exactly when the floor exceeds the capacity (a `lineMinHeads` floor on a position trimmed to 0 heads), and that structure is refused with the key named (`crews.<type>.waveProfile@HH:MM`).

   **The rule:**
   1. **Hourly → quarter is a STEP.** Each quarter q inherits its hour's demand `d_{h(q)}` (all four quarters of hour h take the same value). There is no interpolation, so a peak lands on an hour boundary (12:00, 13:00), never at 13:30. r2's "13:30 peak" fixture is corrected to whole-hour peaks.
   2. **Demand-weighted profile:** `c_q = W_q × d_{h(q)} / d̄`, where `d̄` = the mean of `d_h` over the hours the line is open that day. With `no_history`, `d_h` is flat.
      - **r4 — zero mean demand.** When `DemandResult` is `ok` but every `d_h` in the open hours is 0 (`d̄ = 0`), no division runs: `heads_q = minHeads(q)` (the structural floor from `lineMinHeads`, i.e. the minimum crew). The board notes, en + es: "No sales forecast for this day: minimum crew" / "No hay pronóstico de ventas para este día: equipo mínimo" (shape note `zero_demand`).
      - **r4 — zero weighted-profile sum.** When `d̄ > 0` but `Σ_q c_q = 0` (demand falls only where the wave profile is 0), no division by Σc runs: the target quarter-heads `T / 0.25` are spread EVENLY over the open line quarters, `heads_q = clamp(round_half_up((T / 0.25) / N_open), minHeads(q), maxHeads(q))` (shape note `zero_profile`).
      - Both are finite for every valid input, never throw, and are pinned by exact fixtures (below).
   3. **Heads per quarter:** `heads_q = clamp(round_half_up(c_q / Σ_q c_q × T / 0.25), minHeads(q), maxHeads(q))`. The share is `c_q / Σc`, and `T / 0.25` converts target line hours into quarter-heads.
   4. **The flat-curve rule (stated, and tested exactly):** when `d_h` is constant, `c_q = W_q`, so `heads_q = round(W_q / ΣW × ΣW) = W_q`, which is within [min, max] by validation. **A flat curve reproduces the configured setup / service / rush waves exactly**, in counts and in arrival times, and so reproduces r1's grid.
   5. **Arrivals:** a wave arrives at every quarter where `heads_q` rises. Line heads leave where it falls: secondary positions first (§5.7), never below `minHeads`. The need grid holds `lineTotal_q = heads_q` plus each line position's [min, max]. The template step (5) still chooses WHICH line position takes each extra head (the mockup's most-deficient-position rule with priority), so the flat case is byte-identical to r1.
   6. Rounding ties: `round_half_up`. The clamp can drop or add heads relative to `T`; the reason shows the difference ("Lunch capped at 4 on the line — the position limits").

   **The shifted-peak fixture, worked (r3; F10 is frozen only with these numbers):**
   - **Setup:** line window 11:00–15:00 (16 quarters). Line positions: Walk-ins / Online (primary, min 1, max 1), Walk-ins (secondary, 0/1), Register & Delivery (primary, 1/1), Expeditor (secondary, 0/1). So `minHeads = 2` and `maxHeads = 4` at every quarter.
   - **Wave profile per hour** (each value × 4 quarters): 11:00 → 2, 12:00 → 3, 13:00 → 3, 14:00 → 2. ΣW = 4 × (2 + 3 + 3 + 2) = 40 quarter-heads, so T = 10 h.
   - **Day A:** hourly forecast 11 / 12 / 13 / 14 = $200 / $400 / $200 / $200 (total $1,000). **Day B:** $200 / $200 / $400 / $200 (total $1,000). d̄ = $250.
   - **Day A:** `d/d̄` = 0.8 / 1.6 / 0.8 / 0.8 → `c` per hour = 1.6 / 4.8 / 2.4 / 1.6 → Σc = 4 × 10.4 = 41.6 → `c × 40 / 41.6` = 1.538 / 4.615 / 2.308 / 1.538 → round = 2 / 5 / 2 / 2 → clamp [2, 4] = **2 / 4 / 2 / 2**.
   - **Day B:** `d/d̄` = 0.8 / 0.8 / 1.6 / 0.8 → `c` = 1.6 / 2.4 / 4.8 / 1.6 → Σc = 41.6 → 1.538 / 2.308 / 4.615 / 1.538 → round 2 / 2 / 5 / 2 → clamp = **2 / 2 / 4 / 2**.
   - **Flat:** `c = W` → **2 / 3 / 3 / 2** (the configured waves).
   - **Result:** A's rush (+2 heads) arrives at **12:00** and leaves at 13:00; B's arrives at **13:00** and leaves at 14:00. The two days have equal totals and different shapes. Line hours: A = 10, B = 10, flat = 10.

   **The zero-demand fixtures, worked (r4; F14 and F15 are frozen only with these numbers):**
   - **(F14) all-zero forecast:** the same setup as above (minHeads 2, maxHeads 4, W = 2/3/3/2), with demand `ok` and $0 / $0 / $0 / $0 → `d̄ = 0` → heads = **2 / 2 / 2 / 2** = minHeads. Line hours = 8 (< T = 10; the reason shows it), note `zero_demand`.
   - **(F15) zero weighted-profile sum:** line window 11:00–15:00 with ONLY secondary positions open (Walk-ins 0/1, Expeditor 0/1 → minHeads 0, maxHeads 2). The wave profile is W = 0 / 2 / 2 / 0 per hour (ΣW = 16 quarter-heads, T = 4 h). Demand is $400 / $0 / $0 / $400 → d̄ = $200 > 0 → c = 0 / 0 / 0 / 0 → Σc = 0 → even split: (T / 0.25) / N_open = 16 / 16 = 1 → clamp [0, 2] = **1 / 1 / 1 / 1**. Line hours = 4 (= T), note `zero_profile`.

   Every shaped number becomes a reason param ("Rush at 12:00 — the busiest hour ($400 forecast)"). The need grid (Task 4) consumes the shaped totals.
4. **The need grid** (`need-shared.ts`). Per position × 15-min slot it holds the required heads:
   - from position hours and heads before/after trim (Walk-ins / Online open → close, never trims; 3rd Party trims ~4 PM; Crunchy Boi closes 2 PM; all settings);
   - from the day type's crew row (BOH counts, `prepUntil`), the SHAPED line counts from 3a, the closing crew, and the catering prep rule;
   - and the closing window = service close → `scheduledOut` = clamp(serviceClose + closingMinutes, outEarliest, outLatest).
5. **Slot templates** in the mockup's order: the closing crew is reserved first (primary before secondary; the first line closer is flagged `closingLead`), then BOH, then the shaped line arrivals on the most-deficient line position. There is NO head-count fill (the W ruling): the need grid is the whole need.
6. **Assignment** per template, slot by slot over contiguous deficits:
   - candidates = eligible members (allowed role, work type / also-allowed, not used today, available in the assumed window, leader setting allows, `closingLead` needs a closing role whose setting is not opens-only);
   - **ordering = skill-weighted with guardrails:**
     - (i) the busiest windows (the top-quartile demand slots and the close) rank by skill desc. An `unproven` (starting-point) skill ranks at its prior value; it is neither promoted nor demoted for being unknown;
     - (ii) other windows rank by "most under soft-min first", then skill;
     - (iii) a candidate whose week would exceed `overtimeH` is skipped (overtime only as a last resort, a `warning` with cost);
     - (iv) full-timers below their minimum are pulled forward;
     - ties go to the lower `userId`;
   - **pairing (r2, P1-2, a SOFT preference only).** "Newer" = REAL evidence of inexperience: NOT `startingPoint`, `confidence ≥ 0.3`, and `value < bands.building`. "Strong" = `value ≥ bands.strong` with `confidence ≥ 0.3`. When a newer candidate is chosen for a line window, the generator PREFERS (a ranking tie-break, never a filter) to place them where a strong person is on a line position. When no strong person exists or fits, the newer person is still placed and the board shows `pairing_unmet` ("Eli is newer and no strong partner is on 2–6 PM"). Starting-point people are a separate band, `unproven`: never treated as newer, never blocking anything, shown as "Skill unknown yet". A roster where nobody has evidence builds exactly as a roster of equal skills (tested);
   - the minimum length is enforced by extending the block to `minimumShiftH` inside the position's window, or into the next needed position (a multi-position segment: "Crunchy Boi until 2:00 → Walk-ins"); a block that cannot reach the minimum is not placed;
   - the budget (r3, per date): non-essential blocks stop when the hourly hours on the week's BUDGETED dates reach the sum of those dates' budgets (the closing crew is essential; unbudgeted dates are unconstrained and flagged). The remainder becomes a `budget` gap with its certificate (its dates and the hours it would need).
7. **Manager cover**, when no hourly candidate fits: a salaried manager on MoD covering the window, within `managerFloorH` for the week, ordered by their preferred cover list, then skill; outside the list only as last resort (`lastResort: true`, reason says so). Never on Prep/Dishwasher (rule d).
8. **Priority enforcement** (the mockup's `enforcePriority`): wherever a secondary is filled without its primary, the secondary segment is re-labelled to the primary when the person is allowed there and the primary is open.

   **9a. The bounded repair search (r2 P1-1, widened r3), deterministic, before any non-proven gap is declared.** For each remaining deficit (day, position, slot run), in canonical order (day, closing first, then BOH, then line, then slot):
   - **(0) Proven first:** if `structure`, `eligibility` or `capacity` certifies the deficit (the counting bound needs no search), declare it at once.
   - **(1) Direct insertion:** any eligible free person for a ≥ minimum block that touches the deficit (re-checked after the earlier fills).
   - **(2) Reassignment CHAINS (an ejection chain, r3).** Move person P1 from their block B1 to the deficit, refill B1 with P2 from B2, refill B2 with P3, and so on, up to `REPAIR_MAX_CHAIN = 3` links. The chain ends when the last vacated block is filled by a free eligible person, or needs no one (trimmed). Each link tries donors in canonical order (lowest skill loss, then `userId`), up to `REPAIR_MAX_DONORS = 8` per link. r2's limit of 3 donors is gone; F0i proves that a 4th donor is reached.
   - **(3) Segment swap:** re-label one segment between two people already on shift when both are allowed and the swap closes the deficit.
   - **(4) Acceptance:** a move is accepted only when total uncovered slots strictly decrease, no rule-class problem appears, and essential coverage (closing crew, MoD) is never reduced.
   - **(5) The global cap:** `REPAIR_MAX_STEPS = 200` candidate moves (accepted or rejected) per week. All three limits are constants in `repair-shared.ts`, stored in each `unresolved_search` certificate.
   - **(6) Declaring what is left.** Each still-open deficit is declared with the FIRST proven cause that certifies, in this fixed order: `structure`, `eligibility`, `capacity`, `availability`, `floor_limit`, `budget`. When none certifies, it is declared **`unresolved_search`** (amber, blocks Approve), with the search counters and the untried-candidate list. **Exhausting the search is never a throw and never a proof.**
9. **Closing Manager:** among the closers whose shift spans service close → scheduledOut on a line position, the highest `closeOnTime` mean (`perKind.closeOnTime`; else role rank, then `userId`) in an allowed closing role whose setting allows closing.
10. **MoD lane:** at every slot of the shop day the highest-ranked shift_lead+ on the clock is MoD. When `modRequired` and a slot has none, the generator places an eligible SL+ hourly block (through 9a's insertion) before declaring `mod_missing` with a certificate.
11. **Merge** adjacent blocks per person and canonicalise. Then **`checkScheduleRules` runs inside `buildWeek`**, as an INVARIANT check: valid input always yields fills, proven gaps or `unresolved_search` gaps (r3), so a NEW error-class problem or a certificate that fails to verify can only be a programmer error. Only that throws (`generator_invalid_output`, a bug). Inherited problems never throw.

**Reasons** (`reasons-shared.ts`) are per shift and per segment, as i18n keys + params, citing the rule followed:
- "Busy Thursday → 2 Walk-ins at close (Closing crew rule)";
- "Rush wave at 11:45 — busiest hour starts then";
- "Strongest on Crunchy Boi 0.92 · lunch rush";
- "Beside Maya (strong) — Eli is newer";
- "Covers Expeditor 11–2 from Manager on duty — preferred cover #1";
- "Last resort: outside preferred cover positions";
- "Moved Tess to Walk-ins / Online to cover the close; Sam took her 3rd Party block" (a repair).

The panel also lists "who else could cover" (eligible members on shift, with skills).

**Determinism.** No `Date`, no `Math.random`, no `Map` iteration over unsorted keys, no locale compare (ids compare with `<`). Same input ⇒ byte-identical output, and any permutation of input arrays ⇒ the same output (property-tested). `GENERATOR_VERSION` is a constant bumped whenever a golden changes, and it is stored on the revision.

**Team strength** (`strength-shared.ts`) is the minute-weighted mean skill of who is on the clock for what, per day and per window. Windows come from the structure: BOH open, setup, lunch rush, afternoon, close + checklist. Words: strong ≥ 0.8, watch ≥ 0.65, thin below (thresholds in the structure). Example: "Close: thin — both closers newer". **r2:** minutes of `unproven` people are reported separately ("2 of 5 on the close are unproven") and are never averaged in as 0. Strength is computed over the evidence-backed minutes; when every minute is unproven, it reads "Strength unknown — no worked data yet".

---

## Budget, labor target, horizon (pure; settled math)

**Hours budget (§5.2; r2 P2-7, precedence made per DATE in r3).** A manager enters a WEEK budget or a MONTH budget (`schedule_budget_entries`). Accepting a suggestion writes a week entry carrying its own per-date amounts.

**Every entry is apportioned to DATES when it is written** (`schedule_budget_days`, one row per date the entry covers; hours to 0.01, largest-remainder rounding so the days sum exactly to the entry):
- **Week entry:** its 7 dates by forecast sales share (`DemandResult.ok`, the as-of forecast at write time); an even split when demand is `no_history`.
- **Month entry:** the month's dates by forecast share; an even split when there is no forecast.
- **Accepted suggestion:** the explicit per-date amounts the suggestion computed (below).
- The apportionment is stored, so a later forecast never re-splits history.

**Precedence is per DATE:** the budget for date D = the day row of the NEWEST entry covering D, whatever its scope. `budgetForDates(dayRows, dates)` returns `{byDate, total, unbudgetedDates, composition}`. A week's budget = Σ of its dates' budgets. A date no entry covers is "no budget" (shown as such, never 0).

**Worked cases (fixtures F11–F13, also in the 0274 harness):**
- **(F11) week → month.** A week entry of 70 h for Oct 26–Nov 1, then an October month entry → Oct 26–31 take October's day rows, and **Nov 1 KEEPS the week entry's Nov 1 row** (r2 lost it).
- **(F12) month → week → adjacent month.** October, then a week entry for Oct 26–Nov 1 (it wins all 7 dates), then November → Nov 1 takes November's row; Oct 26–31 keep the week entry's rows.
- **(F13) partially budgeted week.** Only October is entered → the week of Oct 26 has a budget for Oct 26–31 and "no budget" for Nov 1.

**How the generator uses it (r3):** the budget stop applies to the BUDGETED dates: non-essential hourly hours on those dates ≤ the sum of their budgets, kept / inherited days included. Unbudgeted dates are not constrained, and the board flags them ("No budget for Nov 1 — set one"). The `budget` certificate names its dates.

**The suggestion (r2 P2-8, matched weekdays fixed in r3)** (`budget-shared.ts`, `suggestBudget`). It is computed against an EXPLICIT completed reference:
- **The reference week** = the most recent ISO week that has fully ended before `asOf` and whose head revision covers all 7 days (a COMPLETE hours base: `refHoursByWeekday[1..7]`, the hourly hours scheduled per weekday). Its budget (if any) is shown for context only.
- **The ratio.** `ρ = fcSales(M, target) / refSales(M, reference)`, where M = the weekdays captured in the reference (all 7 when fully captured; otherwise the matched captured weekdays, and the reason says "demand compared on Mon–Thu only").
  - Refused (`suggestion_unavailable`, with its errand) when `refSales(M) ≤ 0`, M is empty, demand is not `ok`, or the reference has no complete hours base.
- **The suggestion is per date over the COMPLETE 7-day base, and (r4) ρ touches only MATCHED dates:**
  - **matched date** d (its weekday is in M): `suggested(d) = max(refHoursByWeekday[dow(d)] × ρ + cateringDelta(d) + structureDelta(d), minCrewHours(d))`, where `minCrewHours(d)` = the hours of the structural minimum crew that day (BOH floor + `lineMinHeads` + closing crew + salaried-excluded). When the clamp binds, the reason says so: "Mon held at its minimum crew, 34 h";
  - **unmatched date:** `suggested(d) = refHoursByWeekday[dow(d)] + max(0, cateringDelta(d)) + max(0, structureDelta(d))`. Its reference hours are kept EXACTLY; the ratio is never applied, and negative deltas are never applied (only additions, such as booked catering);
  - every date is rounded to 0.25 h, and the week total is Σ over all 7 dates. When the reference was fully captured, every date is matched.
- **Reference-relative deltas, per date:**
  - catering = the target date's catering-rule hours − the catering-rule hours that were on the same weekday of the reference (from that revision's reasons);
  - structure = the need-grid hours under the live structure − under the reference revision's `structure_version_id`, both over the target forecast.
- **Reasons:** "Demand on Mon–Thu looks 12% higher than the week of Oct 12 → applied to the matched dates Mon–Thu only (Fri–Sun keep their reference 120 h exactly; the ratio never touches an unmatched date)" · "2 catering orders Thu (≈80 people), none that Thursday → +4 h prep" · "Closing checklist now 50 min (was 45) → +2.5 h".
- **Deadband:** no suggestion when |suggested total − the target week's current budget total| < 2 h (a structure setting).
- **Accept** writes a `week` entry with `source: accepted_suggestion`, the digest, and the per-date amounts. **Keep** writes a `schedule.budget_kept` audit row so that digest stays quiet.
- **Test (r3):** unchanged demand (ρ = 1) with partial capture (Mon–Thu captured; reference hours Mon–Thu 160 h, Fri–Sun 120 h) → the suggestion is 280 h, NOT 160 h. Accepting it leaves Fri–Sun with 120 h of budget (the unmatched days' hours are kept).
- **Fixture (r4, F16) — ρ = 0.8 through acceptance:**
  - **Setup:** reference 40 h on each day (Mon–Thu matched 160 h, Fri–Sun unmatched 120 h); target matched sales = 0.8 × the reference matched sales → ρ = 0.8; zero deltas; Monday's minimum crew is 34 h, Tue–Thu minimums ≤ 28 h (so the negative-delta variant is not clamped there), Fri–Sun minimums ≤ 40 h.
  - **Suggestion:** Mon max(32, 34) = **34** (clamped, note) · Tue/Wed/Thu **32** each · Fri/Sat/Sun **40** each (exactly the reference) → **250 h** (r3's formula would have given 96 h for Fri–Sun).
  - **Accept:** the persisted `schedule_budget_days` rows are 34 / 32 / 32 / 32 / 40 / 40 / 40, `apportioned_by = 'explicit'`, summing to the entry's 250 h; `budgetForDates` returns them.
  - **Negative-delta variant:** a structure change of −4 h on every day → Mon stays 34 (clamp: max(40 × 0.8 − 4, 34)), Tue–Thu max(40 × 0.8 − 4, min ≤ 28) = 28, Fri–Sun stay 40 (the negative delta is not applied to unmatched dates) → **34 / 28 / 28 / 28 / 40 / 40 / 40 = 238 h**.

**Labor-target card (§6.6)**, `laborTarget(day, window, …)`, with every line of math rendered:
- `maxLabor$ = forecastSales × target%`, minus the salaried cost when `basis = 'total'` — **r2: the basis is a setting, default `'total'`** (Resolved R4), 28%;
- `maxHours = maxLabor$ ÷ blendedWage` (blendedWage = hours-weighted mean of the wages on the current draft; else the shop estimate);
- `optimalHeads(window)` = `maxHours` spread over the window's share of the demand curve, ÷ the window length → `[floorHeads, ceil(spread)]`, where `floorHeads` = the minimum crew of the positions open in that window (need grid);
- if spread < floor, the card says "Minimum crew needs more than the target allows" (amber);
- the card shows the draft against it ("Lunch: 5 on, optimal 4–5 · Close: 3 on, optimal 3"), amber when over target or under minimum crew;
- hidden $ for AGM (permissions); "—" with the errand when demand is not `ok` or money is blank (R2).

**Labor % per hour** (the strip under the demand curve) = the hour's hourly-labor $ ÷ that hour's forecast $, toned good ≤ target, watch ≤ target + 10, high above (the mockup's 30/40 generalised to the setting). "—" when forecast is 0 or unknown.

**Horizon (§5.8)**, `planHorizon({mode, n?, month?}, today)`:
- modes `next_week` · `next_weeks` (n ∈ 2..6) · `rest_of_month` (tomorrow → month end) · `month` (current or next calendar month);
- **output:** the ISO weeks touched, each with `buildDays` (in range AND ≥ tomorrow) and `keptDays` (the rest of the week: inherited from the head, or empty);
- the cap is 6 weeks (`horizon_too_long`);
- a week ≥ 2 ahead carries `confidence: "further_out"`;
- **apply flow:** `previewHorizon` builds every week and diffs it against its head (`diffWeeks`). It returns per week `{weekStart, edited: boolean, whatChanged, problems (new vs inherited), gaps, budgetUsed}` and a token binding the whole preview (inputs digest + structure version + every head id + the demand result kind). `applyHorizon` recomputes and refuses `preview_stale` on any difference. **An edited week is rebuilt only when the person confirmed that week** (Tier B at the route when any is confirmed); an unconfirmed edited week is SKIPPED, never overwritten, and the result names it. It then commits week by week. Each week is its own transaction; a failure mid-range reports which weeks landed (named partial result, never a generic error). With demand `unavailable`, preview and apply both refuse `demand_unavailable` and nothing is built.

**"What changed"** (`diff-shared.ts`, `diffWeeks(before, after)`) gives per day:
- people added/removed;
- shifts moved (Δstart/Δend);
- segments relabelled;
- the Closing Manager changed ("Wed: Iris → Nora");
- MoD gaps opened/closed;
- coverage-gap hours ± (by certificate cause);
- hourly hours ±; $ ± (GM+);
- problems ± (new vs inherited).

It renders as one summary line per week plus a default-collapsed per-day list (disclosure doctrine). "Settings changed — regenerate?" shows whenever the live structure version ≠ the head revision's.

---

## File Structure

**New — pure (`lib/scheduling/`)**
- `time-shared.ts` — quarter grid (`Q_PER_DAY = 96`), `qToWall`, `wallToQ` (refuses off-grid), `formatQ` via `lib/i18n/format.ts`, `weekDays(weekStart)`, `etToday`-free (today is a parameter).
- `structure-shared.ts` — `ScheduleStructure` types, `SCHEDULE_STRUCTURE_DEFAULTS`, `structureFromStations(stations, positions)`, `validScheduleStructure(s): {ok} | {ok:false, key}`, `dayType(...)`, `crewFor(...)`, `scheduledOut(...)`.
- `access-shared.ts` — every permission row above.
- `errors-shared.ts` — `ScheduleErrorCode`, `ScheduleError`.
- `rules-shared.ts` — `checkScheduleRules`, `checkCertificate`, `structureInfeasible`, `capacityBound` (r3), `RuleProblem`, `RULE_CODES` (severity table); `context-shared.ts` (r3) — `toContextSnapshot(inputs)`, `ruleContextFromSnapshot`, `contextAdvisory(snapshot, live)`.
- `demand-shared.ts` — `forecastDay`, `forecastWeek`, `dayTypeFor`, `withCatering` (names events onto days).
- `closing-duration-shared.ts` — `closingDuration(facts, serviceCloseByDay)`.
- `need-shared.ts` — `needGrid(day, structure, catering)`, `positionWindow`, `headLimit`.
- `people-input-shared.ts` — `punchPatterns`, `assumedAvailability`, `toSchedPeople(members, settings, patterns, skills, wages)`, `SkillLookup`.
- `generator/templates-shared.ts`, `generator/assign-shared.ts`, `generator/repair-shared.ts` (r2: the bounded repair pass, `REPAIR_MAX_STEPS`), `generator/build-shared.ts` (`buildWeek`, `GENERATOR_VERSION`).
- `rpc-args-shared.ts` (r2: the exact named RPC arguments, shared by the lib and the PGlite harnesses); `components/schedule/use-drag-snap-shared.ts` (r2: pure `dragToOp` / `keyToOp`).
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
    lineMinHeads: Record<string /* line position id */, number>;   // r3 P2-2: the FLOOR per position (default 1 on primaries, 0 on secondaries)
  }>;
  positions: Record<string /* station_positions.id */, { role: PositionRole; openQ: number; trimQ: number; closeQ: number; headsBefore: number; headsAfter: number; allowedRoles: RoleCode[] }>;
  // PositionRole maps the spec's named functions onto THIS shop's position ids, so code never matches names:
  // "prep" | "prep_dish" | "register" | "expo" | "walk" | "walk_online" | "line_other"
  priority: Array<{ pair: [string, string]; primary: string }>;   // default: prep_dish>prep, register>expo, walk_online>walk
  leadership: { modRequired: boolean; closingRoles: RoleCode[]; leaderDefaults: Record<RoleCode, "opens" | "closes" | "mix">;
                keyHolderModAfterQ: number | null /* CC 2026-10-16 (R8): "KH may be manager on duty after <time>"; null = OFF (default). ON: a key holder on the clock from that quarter counts as MoD, in the validator and the generator */ };
  limits: { minimumShiftQ: number; flexMinimumQ: number; flexUsesPer2w: number; flexMaxQ: number; overtimeH: number;
            managerFloorH: number /* 32, setting (R5) */; gmMinimumH: number /* 8 */; agmMinimumH: number /* 8 */;
            closingMinutesOverride: number | null /* r2: WINS over the measured value when set */; segmentMinQ: number /* 2 */;
            rushShiftMaxQ: number /* r4: DISPLAY ONLY — a shaped rush more than this from its configured time is flagged in the reason; it never alters heads */ };
  catering: { minHeadcount: number; extraPrepDishHeads: number; defaultStartQ: number; defaultEndQ: number; leadMinutes: number };
  labor: { targetPct: number /* 28 */; basis: "hourly" | "total" /* r2 default "total" (R4) */; strong: number; watch: number; budgetDeadbandH: number };
  roster: { excludedRoles: RoleCode[] /* default cgs, social_media_mgr, catering_mgr, prep_mgr; per-person roster_include (R6) */ };
}
```

- [ ] **Step 1 (tests first):**
  - `wallToQ("10:30") = 42`; `wallToQ("10:20")` refuses `edit_off_grid`; `qToWall(96) = "24:00"`;
  - `weekDays("2026-10-19")` → Mon..Sun;
  - a DST week (2026-10-26 → 2026-11-01) has 7 days, and `etWallMinutesInstant` round-trips each day's 7:00 and 21:00;
  - defaults validate, and `labor.basis` defaults to `"total"`;
  - **the shared case file** (valid and invalid, one row each): open ≤ trim ≤ close per position; heads ∈ 0..8 integers; `slowBelow < busyAbove`; quarter-integral times; out window within 0..96 and `outEarliest ≤ outLatest`; `flexMinimum ≤ minimumShift` and `≤ flexMax`; `max(minimumShift, gmMin, agmMin) ≤ outLatest − prepStart` (the mockup's guard); `targetPct ∈ (0, 100]`; `managerFloorH ∈ [0, 80]`; `rushShiftMaxQ ∈ 0..16` (display only, r4); **r3:** `lineMinHeads[p] ≤ the position's head limits`, and for every day type the configured wave profile `W_q` lies within [`minHeads(q)`, `maxHeads(q)`] at every quarter (the precondition of the flat-curve rule; the refusal names the day type and time); each priority pair is two DIFFERENT position keys present in `positions` and the primary is one of them; a role code is a real `RoleCode`; no unknown keys; numbers are JSON numbers (never strings). `validScheduleStructure` names the first failing key.
  - **Infeasible but VALID structures stay valid** (r2): e.g. a priority secondary open while its primary's window is closed. The validator accepts them because the GENERATOR answers them with a `structure` gap certificate (Task 7). The case file marks them `valid: true, infeasible: true` so Task 8 can use them. A position window shorter than the minimum shift is valid AND feasible (Astra chunk A P2-4): the minimum applies to the whole shift.
  - `structureFromStations`: a station `usually_closes_at 14:00` → that station's positions close 56; `usually_trims_at 16:00` → trim 64; missing → the defaults; a pre-noon trim time is next-day (station-schedule rule) and is REFUSED as a schedule time (`structure_invalid`, key named).
- [ ] **Step 2:** implement. `crewFor(dayType)`; `scheduledOut(structure, closingMinutes)` = clamp(serviceClose + ceil15(closingMinutes), outEarliest, outLatest), plus `checklistFits`.
- [ ] **Step 3:** green. Commit.

**Acceptance:** every bound in the case file is enforced; no `Date.now`; no position names in code.

## Task 2: Permissions, pure (`lib/scheduling/access-shared.ts`)

**Files:** create `lib/scheduling/access-shared.ts`, `tests/schedule-access.test.ts`.

- [ ] **Step 1 (tests):** table-driven over every role × {own shop, other shop, none} × act:
  - `canViewSchedule`, `canSeeScheduleMoney` (= `canSeeShopLaborTotals`), `canEditSchedule(actor, locationId, shopSettings)`, `canEditStructure`, `canManageShopSwitch`, `canViewReconciliation`;
  - `stepUpFor(act, {confirmedEditedWeeks})` → `null | "B" | "E"`;
  - same level 6, same shop: AGM → view (money hidden); with `agm_access = 'edit'` the AGM may edit their own shop (money still hidden), and never another shop; SMM → `schedule_role_refused`; catering_mgr / prep_mgr → `schedule_forbidden`;
  - GM at another shop → `shop_not_allowed`; MoO any shop; cgs any.
- [ ] **Step 2:** implement, reusing `PeopleActor`, `OPERATIONAL_LEVEL6_ROLES` and `canSeeShopLaborTotals` (import, never copy).
- [ ] **Step 3:** green. Commit.

## Task 3: The validator `checkScheduleRules` + mockup parity

**Files:** create `lib/scheduling/rules-shared.ts`, `scripts/schedule-mockup-export.cjs`, `tests/fixtures/schedule/mockup-v17-week.json`, `tests/fixtures/schedule/mockup-v17-map.ts`, `tests/schedule-rules.test.ts`, `tests/schedule-rules-mockup-parity.test.ts`.

```ts
export interface Segment { positionId: string | "mod"; startQ: number; endQ: number; lastResort?: boolean; coverFor?: string; reasonKey?: string }
export interface Shift { userId: string; date: string; startQ: number; endQ: number; segments: Segment[]; closingManager: boolean; flex: boolean; pinned: boolean }
export type GapCause = "budget" | "floor_limit" | "eligibility" | "availability" | "capacity" | "structure" | "unresolved_search";
export interface DeclaredGap { code: "coverage_gap" | "mod_missing" | "closing_manager_missing"; date: string; positionId: string | null;
  fromQ: number; toQ: number; cause: GapCause; certificate: GapCertificate /* discriminated by cause */ }
export interface DayRecord { date: string; originRevisionId: string | null; structureVersionId: string; inherited: boolean; problems: RuleProblem[] }
export interface WeekSchedule { locationId: string; weekStart: string; shifts: Shift[]; gaps: DeclaredGap[]; days: DayRecord[] }
export function checkScheduleRules(s: WeekSchedule, ctx: RuleContext): RuleProblem[];
export function checkCertificate(g: DeclaredGap, s: WeekSchedule, ctx: RuleContext): boolean;
export function structureInfeasible(structure: ScheduleStructure, date: string, g: DeclaredGap): boolean;
```

- [ ] **Step 1 (tests):**
  - one positive and one negative case for EVERY code in the map;
  - **certificates, per cause:**
    - a `budget` gap with free qualified people CERTIFIES when the hours arithmetic holds, and fails when the budget actually had room;
    - `floor_limit` certifies only when every free eligible candidate is a salaried manager at the cap;
    - `eligibility` fails when even one member could work the position;
    - `availability` fails when an eligible member is available and free;
    - `structure` certifies the case-file infeasible rows;
    - **`capacity` (r3):** two positions both needing 1 head over 11:00–2:00, ONE eligible and available person, an ample budget, valid windows → a `capacity` certificate with `requiredHeads 2, people 1, shortBy 1` certifies when exactly one head is uncovered per quarter, and fails when two are (the excess is not proven); the Hall-type search finds the binding subset S in a 3-position case where no single position is short;
    - **`unresolved_search` (r3):** verifies only that the search counters hit a limit AND that no proven cause certifies; it is severity `gap` with `proven: false`; Approve refuses (`unresolved_gaps`) while ANY exists, inherited or not (r4);
    - an uncovered deficit with no declared gap → `undeclared_gap`; a gap with a failing certificate → `uncertified_gap`;
  - **original vs current (r3 P2-4, r4):** validation reads `ctx` built from the stored context snapshot, including the stored need grid (coverage and certificates read `need(p, q)` from the snapshot, never recompute it); the same revision validated after the live roster, availability and budget change gives the identical problem list, and `contextAdvisory` lists exactly the three changes;
  - **historical days (P1-3):**
    - a day with `inherited: true` is NOT re-judged: its `problems` are returned as-is with `inherited: true`, even when the person is no longer in `ctx.people` or the position is retired;
    - weekly totals count inherited hours;
    - a problem on a built day caused only by inherited hours (e.g. weekly overtime) is attributed to the built day, as a warning;
  - output order is deterministic (sorted by day, code, user, q);
  - a 500-shift week checks in < 50 ms (complexity guard).
- [ ] **Step 2: the export.** `node scripts/schedule-mockup-export.cjs C:/co/share/schedule-board/schedule-board.html > tests/fixtures/schedule/mockup-v17-week.json`. It uses the vm technique of the mockup's own harness, refuses if the boot marker moved, and writes shifts + `defaultStructure` + people (role, leader setting, cover preferences). **r2:** it ALSO writes, for each negative control, the mockup's own `checkInvariants` messages on that list, so the parity test compares subjects (person / position / time), not totals. It is run once; the JSON is committed, and its header names the source file's SHA-256.
- [ ] **Step 3: the parity test** (the map section above): the clean fixture, each intended violation at its expected person / position / time, and deterministic diagnostics. Aggregate counts are compared ONLY for (h), where both validators report per slot.
- [ ] **Step 4:** green. Commit.

**Acceptance:** the mockup's sample week is error-clean; each mockup check a–i is detected at its subject.

## Task 4: Demand, closing duration, the day type, the curve → shape transform and the need grid (pure) + the `baselineHourly` extraction

**Files:** modify `lib/pulse/baseline-shared.ts`; create `lib/scheduling/demand-shared.ts`, `lib/scheduling/closing-duration-shared.ts`, `lib/scheduling/need-shared.ts`, `tests/pulse-baseline-hourly-pin.test.ts`, `tests/schedule-demand.test.ts`, `tests/schedule-closing-duration.test.ts`, `tests/schedule-need.test.ts`.

- [ ] **Step 1 (pin first, before touching the pulse):**
  - freeze `baselineCumulative` outputs over a fixture grid (2 weekdays × weeks 0..4 × sparse/full cells, a weekday with NO cells (null is preserved), and an hour −1 cell) into the test's inline snapshot;
  - then extract `baselineHourly` and rewrite `baselineCumulative` over it;
  - the snapshot is unchanged (null for missing weekday cells, the captured-weekday denominator and per-hour rounding all preserved).
- [ ] **Step 2 (demand tests):**
  - `forecastDay` over a `DemandResult` (`ok | unavailable | no_history`), with weeks 4/2/0: dayCents = Σ hourly; `confidence` normal / thin;
  - weeks = 0 for that weekday → that day is `no_history`;
  - weeks ahead ≥ 2 → `further_out`;
  - an hour −1 cell is ignored and counted in `unknownCents`;
  - `unavailable` propagates and `forecastWeek` returns `unavailable` (never a flat curve);
  - catering events attach to their date and never change `dayCents`.
- [ ] **Step 3 (day type, r2 P2-12):** `dayTypeFor(date, {override, structure, forecast})` in this order:
  1. a non-`auto` manager override for that date;
  2. the weekend classification;
  3. the forecast thresholds (`no_history` → `normal`).

  **Pinned both directions:**
  - a Saturday overridden to `slow` is slow, and one overridden to `busy` is busy (the override beats the weekend);
  - a Wednesday overridden `auto` with a forecast above `busyAbove` is busy;
  - a Saturday with `auto` is `weekend` whatever the forecast says.
- [ ] **Step 4 (closing duration, r2 P2-9):** `resolveClosingMinutes({override, measured, fallback: 45})` → the **override WINS** when set (the screen still shows the measurement beside it). Else the measured p75 when there are ≥ 8 samples, else 45. The screen names which applied. `closingDuration(days, serviceCloseQByDay, {window: 28, minSamples: 8, quantile: 0.75})`:
  - only FINALIZED closes count: `status in (confirmed, incomplete_confirmed)` with an `is_final_confirmation` submission, or `auto_finalized`, i.e. the 0233 durable-finalize rule;
  - per finalized day: (the finalize instant — `confirmed_at`, else the last live completion for `auto_finalized` — − service close) in minutes, floored at 0;
  - result `{minutes: ceil15(p75) | null, samples, basis}`;
  - **tested:** an UNFINISHED instance with completions is excluded; the same instance once finalized is included; the latest instance per day only (`stationClosures`' rule).
- [ ] **Step 5 (curve → shape, r2 P2-4, rewritten r3):** `shapeFromCurve` per "The generator", step 3a (the step function hour → quarter, the demand-weighted wave profile, distinct `minHeads` from `lineMinHeads` and `maxHeads` from the head limits). **The worked fixture's numbers are asserted exactly:** Day A 2/4/2/2, Day B 2/2/4/2, flat 2/3/3/2, rush arrival 12:00 vs 13:00, 10 line hours each.
  - **Two days with equal totals and different peak hours** (peak hour 12:00 vs peak hour 13:00; hourly input, so peaks land on hour boundaries) get different rush arrival times AND different hourly line counts.
  - A flat curve reproduces the configured waves exactly.
  - Every shaped count stays within [floor, limit] for each hour.
  - Rounding ties: `round_half_up` per quarter (each quarter's `c_q / Σc × T / 0.25` rounds independently, .5 → up), as in step 3a rule 6.
  - A shaped rush more than `rushShiftMaxQ` from its configured time is FLAGGED in the reason (display only); the heads are never changed by it.
  - **Zero demand (r4):** the all-zero fixture gives exactly 2/2/2/2 with the note; the zero-profile fixture gives exactly 1/1/1/1; neither throws; every output is finite.
  - Determinism.
- [ ] **Step 6 (need grid):**
  - with the mockup structure: Walk-ins / Online is needed open → close (no trim), 3rd Party ends at its trim, Crunchy Boi at 2 PM;
  - Register & Delivery 2 → 1 at the 4 PM trim when headsBefore 2 (§5.7 example);
  - BOH slow = 1 Prep/Dishwasher only, weekend = both until `prepUntil` then Prep/Dishwasher only;
  - the closing crew counts by day type;
  - the line counts come from the shape;
  - the catering rule adds Prep/Dishwasher heads in [event − lead, event) or its default window;
  - a position with `role: line_other` and no crew rule follows its heads only.
- [ ] **Step 7:** green. Commit.

**Acceptance:** the pulse is byte-identical; no new RPC; the need grid is per position id; every number traces to a structure key or a curve value (reason params name it).

---

# Chunk B — THE GENERATOR CORE (Tasks 5–8) · **Fable 5.1 recommended** (the truly hardest part)

Why Fable here and only here: this chunk is a constrained assignment search with a bounded repair pass. It must be simultaneously deterministic, permutation-invariant, certificate-exact, history-preserving, and readable through reasons. Every later chunk is plumbing over its output. The rest of the plan is Opus 5.5.

## Task 5: People input, pure (`people-input-shared.ts`)

**Files:** create `lib/scheduling/people-input-shared.ts`, `tests/schedule-people-input.test.ts`.

- [ ] **Step 1 (tests):**
  - `punchPatterns(entries, {asOf, weeks: 8, firstSeen})`:
    - per user × ISO weekday: `{weeksWorked, weeksObserved, share, p10InQ, p90OutQ, meanWeeklyHours}`;
    - entries with `deleted` or no `user_id` are skipped; an open entry (no `out_at`) counts its day but not its out time;
    - DST-week entries convert by ET wall clock;
    - **r2 (P2-10): `weeksObserved` is person-specific:** only weeks on or after the person's first punch at the shop (or their `user_locations.created_at`, whichever is later), and only weeks in which the SHOP had any punch that weekday (a closed holiday is not "didn't work").
  - `assumedAvailability`:
    - `weeksObserved ≥ 3` and `share ≥ 0.25` → the window [p10 − 2q, p90 + 2q] clamped to the shop day;
    - `weeksObserved ≥ 3` and `share < 0.25` → not available that weekday (`source: "toast_pattern"`);
    - **`weeksObserved < 3` → `{source: "insufficient_history", window: shop normal hours}`**;
    - every output carries `source: "toast_pattern" | "insufficient_history"` (the UI flag).
    - **The new-hire transition, tested:** a hire with 0, 1 and 2 weeks of punches is available within the shop's normal hours on every weekday at each step. At 3 weeks the pattern takes over. The available set never shrinks between 0 and 2 weeks.
  - `toSchedPeople`:
    - excluded roles and levels < 2 are dropped, unless `roster_include` is set (never for cgs / SMM);
    - MoO/Owner are flagged `presenceOnly`;
    - the role defaults for work type and leader setting apply; person settings override;
    - cover preferences outside the shop's active positions are dropped and reported (`cover_position_retired`);
    - salaried = gm|agm;
    - wage = the 7shifts hourly wage when supplied, else the estimate, else null (`wageSource`);
    - the output is canonical (sorted by userId).
  - `SkillLookup.get(userId, positionId)` = `{value, band}`, where `band ∈ "unproven" | "building" | "solid" | "strong"`. **r2 (P1-2): `unproven` ⇔ `startingPoint`.** `isNewer` = NOT unproven, `confidence ≥ 0.3` and `value < bands.building`. `isStrong` = `value ≥ bands.strong` and `confidence ≥ 0.3`. `value` is 0 when the work type forbids the position, as in the mockup's `skill`. `closeScore(userId)` = the max `perKind.closeOnTime.mean` across positions, else null.
- [ ] **Step 2:** implement. **Step 3:** green. Commit.

## Task 6: Templates, the shaped waves and the closing / BOH reservations (`generator/templates-shared.ts`)

**Files:** create `lib/scheduling/generator/templates-shared.ts`, `tests/schedule-generator.test.ts` (first block).

- [ ] **Step 1 (tests):**
  - for each mockup scenario (sample, busy days, slow days, station trim, walk priority flipped), `templatesFor(day)` produces the closing crew first (primary before secondary, one `closingLead`), then BOH, then the SHAPED line arrivals (Task 4 Step 5) on the most-deficient line position — and no head-count fill (the W ruling);
  - counts equal the need grid;
  - no template outside its position's window;
  - catering-day extra Prep/Dishwasher;
  - salaried MoD blocks honour leader settings and the role minimum and are skipped when they cannot fit;
  - kept / past days produce NO templates (they are inherited).
- [ ] **Step 2:** implement. **Step 3:** green. Commit.

## Task 7: Assignment, repair, cover, priority, Closing Manager, MoD, certificates, reasons (`assign-shared.ts`, `repair-shared.ts`, `build-shared.ts`, `reasons-shared.ts`, `strength-shared.ts`)

**Files:** create those five modules; extend `tests/schedule-generator.test.ts`.

- [ ] **Step 1 (tests), one per rule in "The generator" steps 1–11:**
  - the strongest goes to the rush (two candidates 0.9 / 0.6, rush window → 0.9);
  - outside the rush, the person furthest under soft-min wins;
  - an overtime candidate is skipped while another fits, and is used only when none fits (warning + cost);
  - full-timer minimum;
  - **pairing (r2, P1-2):**
    - (a) a newer-with-evidence person is placed BESIDE a strong person when one fits (the tie-break);
    - (b) with no strong person available, the newer person is STILL placed and `pairing_unmet` is a board note;
    - (c) **an entire roster with no evidence** (every skill `startingPoint`, value 0.5) builds a complete week with ZERO error-class problems and ZERO gaps beyond what the structure, eligibility and availability certify;
    - (d) an unproven person is never labelled newer;
  - the 4 h minimum via extension into the next needed position (multi-segment "Crunchy Boi → Walk-ins" at 2:00, the reason citing the close);
  - one person per position;
  - **budget (r2, P1-1):** budgets of 0 h, a tight budget (essential + 6 h) and a loose one. At 0 and tight, non-essential blocks stop, the closing crew still lands, and every uncovered deficit is a `budget` gap whose certificate states `hoursNeeded` and certifies even though qualified people are free;
  - **repair (r2, P1-1):**
    - (a) the "only qualified person used elsewhere" case: Tess (the only Walk-ins / Online closer) was placed on 3rd Party at lunch; Sam can take 3rd Party; the repair moves Tess to the close and Sam to 3rd Party, and NO gap is declared;
    - (b) **the 4th-donor case (r3):** the first three donors in canonical order each fail (overtime, leader setting, availability), the 4th succeeds → no gap (r2's 3-donor limit would have failed here);
    - (c) **a longer chain (r3):** a 3-link ejection chain (Tess → close, Sam → Tess's 3rd Party block, Leo → Sam's Expeditor block) is found → no gap; a fixture needing 4 links is declared `unresolved_search` with `chainDepth 3`, never a proof and never a throw;
    - (c2) the cap `REPAIR_MAX_STEPS` is honoured on a pathological fixture; what remains is proven gaps or `unresolved_search`; **the build never throws on valid input**;
    - (d) the repair never reduces closing crew or MoD coverage;
  - **certificates:** every cause produced at least once by a fixture (`structure`, `eligibility`, `capacity`, `availability`, `floor_limit`, `budget`, and `unresolved_search`), each verified by `checkCertificate`; the cause order is fixed; **insufficient capacity (r3)** is certified `capacity` without any search;
  - manager cover: within `managerFloorH` and in preference order; outside the list → `lastResort`; never Prep/Dishwasher;
  - priority enforcement relabels secondary → primary;
  - Closing Manager = the best `closeScore` among eligible closers (Key Holder default "closes"), never an opens-only leader (the v17 Dani bug, pinned);
  - MoD every slot, adding an SL+ block when required;
  - presence pins are $0 and count toward coverage;
  - **history (r2, P1-3):**
    - (a) a past Monday saved with a rule break by a manager is carried byte-identical into Tuesday's regenerate with its problem `inherited`, and the build does NOT throw;
    - (b) a past day of a person deactivated since is carried unchanged;
    - (c) a past day on a position retired since is carried unchanged;
    - (d) the deactivated person gets NO new future shift;
  - reasons: every shift and segment has ≥ 1 reason key; a last-resort segment's reason says so; a repair's reason names both people; "who else could cover" is listed.
- [ ] **Step 2:** implement. `buildWeek` ends with `checkScheduleRules` as an INVARIANT check: it throws `generator_invalid_output` ONLY on a programmer error (a NEW error-class problem or a certificate that does not verify). Valid input never throws (r3).
- [ ] **Step 3:** team strength per window. Tests: weighted by minutes; MoD minutes excluded; thresholds from the structure; unproven minutes reported separately and never averaged as 0; an all-unproven window reads "unknown". Green. Commit.

## Task 8: The golden + property discipline (infeasible and tight cases FIRST)

**Files:** create `tests/fixtures/schedule/fixtures.ts`, `tests/fixtures/schedule/golden-*.json`, `tests/schedule-golden.test.ts`, `tests/schedule-generator-property.test.ts`.

- [ ] **Step 1: the fixtures** (seeded, ids only, no names in logic). **r2: the constrained fixtures are written and green BEFORE any golden is frozen.**
  - **(F0a) `infeasible-structure`:** a priority secondary whose primary's window is closed, and MoD required with no SL+ member → each certified `structure`. (A position window shorter than the minimum shift is NOT infeasible — Astra chunk A P2-4: the minimum applies to the whole shift, so the short window is filled as a segment of a multi-position shift; F0a asserts that fill.)
  - **(F0b) `tight-budget`:** budgets of 0 h and essential + 6 h → `budget_limited` certificates (R < W, with the witness). **Stated (Astra chunk D):** in F0b-essential+6, total hourly hours rose from 48.5 (chunk C) to 54 (HEAD) because the essential closing shifts are longer (the 10.5 h maximum) and budget-exempt; the non-essential hours stay within the 22 h budget (20.25 h), and the uncovered hours fell 8 → 3. The board's `essential_past_budget` note names it ("essential hours past budget: X h").
  - **(F0c) `no-eligible`:** a position whose allowed roles match no member → `eligibility`.
  - **(F0d) `floor-capped`:** salaried managers at 32 h → `floor_limit`.
  - **(F0e) `repair-needed`:** the Tess/Sam case → no gap.
  - **(F0f) `all-unproven`:** every skill `startingPoint` → clean.
  - **(F0h) `insufficient-capacity` (r3):** two simultaneous required positions, one eligible + available person, ample budget → `capacity`, numbers shown.
  - **(F0i) `fourth-donor` (r3):** the deficit is fixed only by the 4th donor → no gap.
  - **(F0j) `long-chain` (r3):** a 3-link reassignment chain fixes it → no gap; the 4-link variant → `unresolved_search`.
  - **(F0g) `history`:** a locked Monday with a manager-made violation, a deactivated person and a retired position → inherited, no throw.
  - **(F1) `mockup-v17`:** the 18 people, skills, roles, leader settings and cover preferences of v17, the CH position set, and the mockup's revenue with its sample hourly shape.
  - **(F2–F5)** busy / slow / trim / priority-flipped variants.
  - **(F6) `sparse-sim`:** 9 people, demand `no_history`, no punches.
  - **(F7) `dst-fall`:** week of 2026-10-26 (Nov 1 = DST end).
  - **(F8) `partial-month`:** `rest_of_month` from 2026-10-27.
  - **(F9) `edited-head`:** a week with manager edits plus a locked Monday.
  - **(F10) `shifted-peaks` (r3, worked numerically in step 3a BEFORE freezing):** Day A peak hour 12:00, Day B peak hour 13:00 (hourly input; r2's 13:30 corrected), equal totals → line heads 2/4/2/2 vs 2/2/4/2; plus the flat day 2/3/3/2.
  - **(F14) `zero-demand` and (F15) `zero-profile` (r4, worked in step 3a):** 2/2/2/2 with the `zero_demand` note, and 1/1/1/1 with `zero_profile`; neither throws.
  - **(F16) `suggestion-rho-0.8` (r4, worked in the budget section):** 34/32/32/32/40/40/40 = 250 h through acceptance and the persisted day rows (used by Tasks 11 and 17).
  - **(F17) `inherited-unresolved` (r4):** an `unresolved_search` gap on Sunday Nov 1, then a rest-of-month rebuild → the gap is inherited unchanged, and Approve is refused `unresolved_gaps`.
  - **(F11) `budget-week-then-month`, (F12) `budget-month-week-adjacent`, (F13) `budget-partial-week` (r3):** the per-date precedence cases from "Budget, labor target, horizon", run through the generator (the budget stop applies to budgeted dates only; Nov 1 keeps its week-entry budget in F11; F13's Nov 1 is unconstrained and flagged).
- [ ] **Step 2: the golden.** `buildWeek` for each fixture → `{shifts, days, gaps, reasons}` JSON; `UPDATE_SCHEDULE_GOLDEN=1` writes it. Header: "Regenerate ONLY with a written reason in the PR, and bump GENERATOR_VERSION." Each golden is asserted **validator-clean**: zero NEW error-class problems, and every gap certified.
- [ ] **Step 3: the property test** (no new dependency; mulberry32, fixed seeds, 300 cases per run + an edge grid):
  - random structures from the VALID case space, INCLUDING the infeasible-valid rows (trims, head counts 0–3, waves, priority flips, roster sizes 0–25, skills 0–1 with random `startingPoint`, leader settings, cover lists, budgets null / 0 / tight / loose, random retired positions and deactivated people in an inherited head);
  - assertions:
    - (1) never throws for a valid input;
    - (2) zero NEW error-class problems;
    - (3) every gap-class problem declared AND certified (proven causes verify; `unresolved_search` only where a search limit was really hit);
    - (4) determinism (two runs byte-identical);
    - (5) **permutation invariance** (people and positions arrays shuffled → identical output);
    - (6) inherited days byte-identical to the input head, with their problems unchanged;
    - (7) hourly hours on budgeted dates ≤ their budgets + essential hours;
    - (8) repair steps ≤ `REPAIR_MAX_STEPS`.
- [ ] **Step 4:** green. Commit: `test(sched-p2): freeze the generator goldens (validator-clean)`.

**Acceptance (Chunk B):** the goldens and the property test are green; the constrained fixtures pass before freezing; the mockup scenarios produce the mockup's Closing Manager behaviour (a Key Holder, never an opens-only SL). After Task 8 the goldens are part of every later task's green.

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
  - **r3 (per-DATE precedence):**
    - `apportion(entry, dates, forecastShareByDate)` → day rows to 0.01 h by forecast share (even when `no_history`), largest-remainder, summing exactly to the entry; an accepted suggestion keeps its explicit per-date amounts;
    - `budgetForDates(dayRows, dates)`: the newest entry covering each date wins for that date;
    - **F11 week → month:** Nov 1 keeps the week entry's row while Oct 26–31 take October's;
    - **F12 month → week → adjacent month:** October, then the week (wins all 7), then November (wins Nov 1 only);
    - **F13 partial week:** Nov 1 "no budget" (never 0);
    - October then November and November then October give the same week (both orders);
    - the composition lines are emitted for the reason.
  - **`suggestBudget` (r2, P2-8):**
    - the reference week is the latest fully ended ISO week whose head revision covers all 7 days (the complete hours base); full capture uses all 7 days for the ratio;
    - else matched weekdays estimate the RATIO only; the suggestion still covers the COMPLETE 7-day hours base, but (r4) the ratio is applied to the MATCHED dates only — unmatched dates keep their reference hours exactly (+ positive deltas only), never × ρ; "demand compared on Mon–Thu only";
    - **r3 test:** unchanged demand (ρ = 1), Mon–Thu captured, reference hours 160 (Mon–Thu) + 120 (Fri–Sun) → suggested 280 h, never 160; accepting writes per-date amounts and Fri–Sun keep 120 h;
    - **r4 test (F16):** ρ = 0.8 → 34 / 32 / 32 / 32 / 40 / 40 / 40 = 250 h with the Monday clamp note; acceptance persists exactly those day rows (through the fake RPC, and in the 0274 harness as a written entry); the negative-delta variant leaves Fri–Sun at 40 and Mon at 34;
    - refused `suggestion_unavailable` when refSales ≤ 0, demand is not `ok`, or the reference has no hours;
    - the catering delta is target minus reference (a fixture whose reference week already had the same catering gives +0 h);
    - the structure delta is computed under both structure versions over the target forecast;
    - the deadband;
    - the digest is stable (same inputs → same digest);
    - a future target week is never its own reference.
  - Keep hides by digest.
- [ ] **Step 2:** implement. **Step 3:** green. Commit.

## Task 12: Horizon, "What changed", edit operations

**Files:** create `lib/scheduling/horizon-shared.ts`, `lib/scheduling/diff-shared.ts`, `lib/scheduling/edit-shared.ts`, `tests/schedule-horizon.test.ts`, `tests/schedule-diff.test.ts`, `tests/schedule-edit.test.ts`.

- [ ] **Step 1 (tests):**
  - **horizon:**
    - `next_week` from Wed 2026-10-21 → week of 10-26;
    - `rest_of_month` from 10-27 → week 10-26 (build 28–31; keep 26–27 and Nov 1, inherited) — the "tomorrow" boundary;
    - `month` 2026-11 → 6 ISO weeks touched, with partial first/last;
    - n = 7 → `horizon_too_long`; a past month → `horizon_invalid`;
    - week 2+ `further_out`;
    - unconfirmed edited weeks are listed as skipped.
  - **diff:**
    - each change kind in "What changed";
    - identical → empty;
    - deterministic ordering;
    - $ lines omitted without money permission;
    - new vs inherited problems separated;
    - gaps by cause.
  - **edits** (the mockup's `adjust` / `canSet` / `scaleSegments`), all on 15-min snaps:
    - `move`, `start`, `end` (segments scale proportionally with each ≥ `segmentMinQ`), `divider:i`, `addShift`, `removeShift`, `setSegmentPosition`;
    - refusals `edit_off_grid`, `edit_overlap`, `edit_segments_malformed`, `edit_below_segment_min`, `day_locked`;
    - an edit that creates rule problems is ALLOWED and returns the new problems (spec §6.5), unlike the mockup, which silently rejects; this departure is J6;
    - an edit never touches an inherited past day;
    - an edit to a future day re-validates that day under the CURRENT context and resets its `originRevisionId` to the new revision.
- [ ] **Step 2:** implement. **Step 3:** green. Commit.

---

# Chunk D — Migrations (Tasks 13–15) · Opus 5.5

**Harness execution contract (r2, P3-13), for both harnesses:**
- They load `tests/fixtures/scheduling-pglite-stub.sql` FIRST. It already models the Supabase roles and default privileges: `alter default privileges … grant all … to anon, authenticated, service_role` on tables, functions and sequences. The migration therefore has to REVOKE what Supabase would really grant.
- They then call every writer **`set role service_role`, with the exact named arguments the app's lib sends** (`select public.commit_schedule_revision(p_actor => …, p_location => …, …)`). The argument objects are imported from ONE shared module, `lib/scheduling/rpc-args-shared.ts`, that the lib itself uses to build its RPC calls, so a renamed argument breaks the harness.
- They assert:
  - (a) direct `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` on every new table as `service_role` is denied (`42501`), and `SELECT` is allowed;
  - (b) `EXECUTE` of every new function as `anon`, `authenticated` and through `PUBLIC` is denied, checked by calling it under each role and by reading `information_schema.routine_privileges`;
  - (c) no PostgREST role holds any table privilege.

## Task 13: Migration 0274 — settings, structure versions, person settings, budget entries + per-date day rows, day types, pins

**Files:** create `supabase/migrations/0274_schedule_settings.sql`, `scripts/sql-harness-0274.mjs`, `tests/schedule-settings-migration.test.ts`, `lib/scheduling/rpc-args-shared.ts`.

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

create table public.schedule_budget_entries (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  scope text not null check (scope in ('week','month')),
  week_start date check (week_start is null or extract(isodow from week_start) = 1),
  month date check (month is null or extract(day from month) = 1),
  hours numeric(7,2) not null check (hours between 0 and 8000 and hours * 4 = trunc(hours * 4)),
  source text not null check (source in ('manager','accepted_suggestion')),
  suggestion_digest text, created_by uuid not null references public.users(id),
  created_at timestamptz not null default clock_timestamp(),
  check ((scope = 'week') = (week_start is not null) and (scope = 'month') = (month is not null)),
  unique (id, location_id)
);
create table public.schedule_budget_days (           -- r3: per-DATE apportionment; the newest entry covering a date wins
  entry_id uuid not null, location_id uuid not null,
  business_date date not null,
  hours numeric(6,2) not null check (hours >= 0),
  foreign key (entry_id, location_id) references public.schedule_budget_entries (id, location_id),
  primary key (entry_id, business_date)
);
create index schedule_budget_days_by_date on public.schedule_budget_days (location_id, business_date);
-- entries gain: apportioned_by text not null check (apportioned_by in ('forecast','even','explicit'))
```

- [ ] **Step 0:** `ls supabase/migrations | tail -3` and `git ls-tree origin/feat/landing-p1 supabase/migrations | tail -2`. If 0274 is taken, stop and ask CC.
- [ ] **Step 1:** the preflight: 0270 present (`people_position_at_shop`, `station_positions_id_location`), 0272 present.
- [ ] **Step 2:** the tables per the migrations table; `valid_schedule_structure` in plpgsql, pinned `search_path`, immutable. `schedule_actor_level` mirrors `toast_link_actor_level`'s rule and adds `agm_access`.
- [ ] **Step 3:** the writers. Each locks per shop (and per user for person settings) BEFORE reading, re-checks actor, subject membership and positions in SQL, and returns before/after for the audit. `record_schedule_budget_entry` proves its day rows cover exactly the entry's dates (a week entry = its 7 dates; a month entry = every date of the month) and sum to `hours` (r3). `record_schedule_person_settings` refuses `roster_include` for `cgs` / `social_media_mgr`.
- [ ] **Step 4: the harness** (`PASS 0274:`), under the execution contract:
  - the SHARED `structure-cases.json` (every valid accepted, every invalid refused, the same verdict as the TS validator, infeasible-valid rows accepted);
  - `structure_moved`;
  - a foreign-shop position refused;
  - GM at another shop refused; MoO allowed; AGM refused unless `agm_access = 'edit'` at their own shop;
  - **budget per-date precedence in SQL terms (r3):** F11, F12 and F13 replayed as entry writes; a query of the newest day row per date returns the expected owner entry for every date; day rows not covering exactly the entry's dates, or not summing to `hours`, are refused;
  - the DML / EXECUTE denials;
  - the ceilings guard.
- [ ] **Step 5:** the pin (file present, header gate line, harness green in CI). Commit.

## Task 14: Migration 0275 — weeks, revisions, shifts, days, gaps, approvals, the writers, the cron lease

**Files:** create `supabase/migrations/0275_schedule_weeks.sql`, `scripts/sql-harness-0275.mjs`, `tests/schedule-weeks-migration.test.ts`.

- [ ] **Step 1:** the preflight (0274; `claim_cron_route` is 0268's body).
- [ ] **Step 2:** the tables + `valid_schedule_segments(jsonb, start_q, end_q)` (segments contiguous, span the shift, each ≥ 1 q, position = uuid or `"mod"`) + `valid_gap_certificate(cause, jsonb)` (the per-cause key set, numbers non-negative).
- [ ] **Step 3:** `commit_schedule_revision` per the sketch; it accepts unchanged history and applies current eligibility only to new or changed future shifts. Then `approve_schedule_week`, which INSERTS into `schedule_week_approvals` and sets `approved_revision_id`, writes NO revision and copies no shift, and refuses `rules_failing` only on non-inherited error problems, and `unresolved_gaps` on ANY `unresolved_search` gap, inherited or not (r4).
- [ ] **Step 4:** the `claim_cron_route` + CHECK re-emit with `'schedule-draft'` (line-subsequence pin against 0268).
- [ ] **Step 5: the harness** (`PASS 0275:`), under the execution contract:
  - `head_moved`; `past_week`; `day_locked` (a changed past day refused, an identical one passes); `history_changed` (an inherited day row altered);
  - **`edited_week_unconfirmed`:** generated → edited → regenerated without the confirm flag is refused, with it OK; generated → regenerated with no edit is OK. The harness names this a CONFIRMATION check, not a password check;
  - **history end to end (P1-3):**
    - (a) commit a week where a past Monday shift belongs to user U on position P;
    - (b) deactivate U and retire P;
    - (c) commit a new revision that carries Monday unchanged → ACCEPTED;
    - (d) the same revision with a NEW future shift for U → `person_not_at_shop`; one on P → `position_retired`;
    - (e) an unchanged FUTURE shift of U → accepted (flagged inherited by the lib);
  - **gaps round-trip (P2-5):** `p_gaps` rows persist with certificates; a malformed certificate is refused; causes `capacity` and `unresolved_search` accepted; `approve_schedule_week` refuses `unresolved_gaps` while ANY `unresolved_search` gap exists; **r4 (P1) case:** commit a week whose Sunday Nov 1 carries an `unresolved_search` gap → commit a partial rebuild (`rest_of_month`: Oct 28–31 rebuilt, Sunday inherited with its gap unchanged) → `approve_schedule_week` refuses `unresolved_gaps`;
  - **inheritance integrity (r3, P2-3):** with a FUTURE inherited day (a kept day of a horizon rebuild) and a past one, a payload that keeps each day record but (a) moves a future inherited shift to another active position of the shop, (b) changes a future inherited gap's `to_q`, (c) drops a past inherited gap → each refused `history_changed`; the unchanged payload is accepted;
  - **context (r3, P2-4):** `p_context` persisted, one row per revision; a non-object refused;
  - `person_not_at_shop`; `position_not_at_shop`; `position_retired`; `shop_not_enabled`;
  - the cron path (null actor) only for `generated` with no head;
  - `rules_failing` (an inherited error does not block approval);
  - approve writes no revision row;
  - append-only (UPDATE of revisions, shifts, days, gaps and approvals refused);
  - the DML / EXECUTE denials; the ceilings;
  - concurrency: two commits with the same expected head serialise and the loser gets `head_moved` (single-session simulation through the advisory lock; the two-session proof is sim-only in Task 26).
- [ ] **Step 6:** the pin. Commit.

## Task 15: The audit vocabulary + i18n scaffolding for every code

**Files:** modify `lib/audit-actions.ts`, `lib/destructive-actions.ts`, `lib/i18n/en.json`, `lib/i18n/es.json`; create `tests/schedule-i18n.test.ts`.

- [ ] **Step 1:** register the actions:
  - **destructive** (a human act changing shared config or the record): `schedule.structure_update`, `schedule.shop_settings_update`, `schedule.person_settings_update`, `schedule.budget_set`, `schedule.regenerate_overwrite`, `schedule.week_approve`, `schedule.pin_set`, `schedule.day_type_set`;
  - **non-destructive:** `schedule.generate`, `schedule.regenerate`, `schedule.edit`, `schedule.budget_kept`, `schedule.draft_auto` (system), `schedule.draft_skipped` (system, e.g. `demand_unavailable`), `schedule.generator_invalid`.
- [ ] **Step 2:** the test asserts that every `ScheduleErrorCode`, every `RULE_CODES` entry, every gap cause and certificate line, every reason key the generator can emit (enumerated from `reasons-shared.ts`'s closed union) and every board label has en + es, and that es uses tú forms (a denylist of `usted`/`su ` patterns on these keys).
- [ ] **Step 3:** green. Commit.

---

# Chunk E — Loaders, writers, routes, the Wednesday cron (Tasks 16–19) · Opus 5.5

## Task 16: `loadSchedulingInputs` — the ONE batch loader

**Files:** create `lib/scheduling/inputs.ts`, `lib/toast/punch-history.ts`, `lib/catering/booked-events.ts`; modify `lib/pulse/sales.ts`, `lib/report-digests-v2.ts`, `lib/people/skills.ts`, `lib/people/facts.ts`, `lib/people/facts-shared.ts`; create `tests/schedule-inputs.test.ts`, `tests/schedule-loader-schema-check.test.ts`.

It loads, for one shop and a set of weeks, with every query paged/chunked:
- members (`loadMembers`' query) and their `user_locations.created_at` (the availability floor);
- `computeSkillMatrixForShop`;
- the live structure + its id (else `structureFromStations` defaults, `source: "defaults"`);
- person settings (latest per user);
- budget entries + their per-date day rows (r3), day types, pins (active);
- the heads of the weeks + their shifts, day records and gaps;
- **demand (r2, P2-6):** `fetchSalesBaseline` (one RPC) → `DemandResult` (`ok | unavailable | no_history`);
- the reference period's daily actuals (`sales_report_daily`, one call) and the reference revision (its hours, structure version and catering reasons), for the budget;
- `loadBookedCateringEvents`;
- `loadPunchHistory` (8 weeks, linked rows only) and each person's first punch at the shop;
- **the closing facts (r2, P2-9)** via `loadPeopleFacts(…, families ["closingLines", "closingFinalization"])`. `closingFinalization` is a NEW opt-in family that loads `checklist_instances.status, confirmed_at` and the `checklist_submissions.is_final_confirmation` rows for the closing instances. `closingLines` is UNCHANGED, so every legacy consumer and the people equivalence golden are byte-identical; the new family is loaded only when asked;
- `sevenshifts_labor_settings` (overtime threshold) and hourly wages per linked user, only when 7shifts is `ready`. Wages are reduced in the LOADER to `{wageCentsByUser}` for the pure cost maths and are never placed in a client view-model (rates are summed server-side into totals).

- [ ] **Step 1 (tests):**
  - the recording-client schema check executes every query against the real column lists (0224, 0233, 0242 RPC args, 0268, 0270, 0274, 0275, and the checklist base tables for `closingFinalization`);
  - `loadSkillMatrix`'s wrapper output is byte-identical before/after the split (the equivalence pin + a direct snapshot);
  - **the people equivalence golden is unchanged** with `closingFinalization` added; the `closingLines` rows are identical with and without it;
  - `loadCateringNight` returns identical rows over the extracted loader (its existing tests + one parity test);
  - **demand (r2):** `loadPulseSales` is unchanged with the split `fetchSalesBaseline` (a fake-RPC test: timeout → null, missing RPC → null, as today). The scheduling side is tested three separate ways: timeout → `unavailable/timeout`, missing RPC → `unavailable/rpc_missing`, successful empty history → `no_history`;
  - the loader refuses (`inputs_unavailable`, 503) when 0274/0275 are absent (`42P01`), and the board renders the "not installed" line;
  - no wage field is present on the returned board view-model (a key scan).
- [ ] **Step 2:** implement. **Step 3:** green, with the equivalence pin green. Commit.

## Task 17: The schedules lib — generate, preview/apply horizon, edit, approve, settings

**Files:** create `lib/scheduling/schedules.ts`, `lib/scheduling/settings.ts`, `tests/schedules-lib.test.ts`.

- [ ] **Step 1 (tests, fake db + fake RPCs):**
  - every act runs `access-shared` BEFORE any I/O (a spy proves zero queries on refusal);
  - `generateWeek` → `buildWeek` → validator-clean (no new error, all gaps certified) → `commit_schedule_revision(kind generated, expected null, p_days, p_gaps)`;
  - **round-trip parity (r2 P2-5, extended r3 P2-4):** generate → commit (fake RPC capturing the payload into an in-memory store) → reload through the loader → `checkScheduleRules` over the reloaded `{shifts, days, gaps}` with the STORED context gives EXACTLY the problems computed before commit. The display summary is truncated at 50 while the reload is complete (a fixture with 120 problems). **Between commit and reload the test changes membership (a person deactivated; a qualified person added to an `eligibility` gap's position), availability (a person's Thursday window) and the budget (a newer week entry)**: original validation is still identical, every certificate still verifies against the stored context, and the current-inputs advisory lists exactly those changes;
  - **replay without live reads (r4, P2):** the replay runs with a loader stub that THROWS on any read of demand, day types, catering, structure or people, so it can only use the snapshot. Cases:
    - **(a)** F10's equal-total shifted curves: Day A and Day B are committed, then the live forecast is swapped (A's curve given to B and B's to A) → the replayed coverage per position × quarter and the `capacity` / `budget` certificates are byte-identical to the originals;
    - **(b)** a manager day-type override is added (Wed → busy) after commit → identical replay, and the advisory names the override;
    - **(c)** a catering event is added and another cancelled after commit → identical replay (the catering-derived Prep/Dishwasher need is the snapshot's), and the advisory names both;
  - **demand (r2):** with `unavailable`, generate / preview / apply refuse `demand_unavailable`, nothing is committed, and an existing head is untouched;
  - `previewHorizon` returns per-week What changed + the token; `applyHorizon`:
    - `preview_stale` on any input drift (structure version, head id, inputs digest, demand kind);
    - edited weeks are rebuilt only if confirmed (route Tier B); unconfirmed edited weeks are skipped and named;
    - a mid-range failure returns `{landed: [...], skipped: [...], failed: {week, code}}`;
  - **history (r2, P1-3) end to end:** a Monday edit with a rule break → Tuesday regenerate succeeds, Monday's problem shown as inherited; a deactivated person's past shift → regenerate succeeds;
  - `saveEdit` applies an `edit-shared` op on the head and records the problems; a structural refusal maps to its code;
  - `approveWeek` refuses `rules_failing` on new errors only, writes an approval (no revision), and the route takes Tier B;
  - **r4 (P1):** generate a week with an `unresolved_search` gap on Sunday → partial rebuild (rest of month; Sunday inherited with the gap) → `approveWeek` refuses `unresolved_gaps` before any RPC (lib), and the fake RPC mirrors the SQL refusal;
  - settings writers: Tier E for structure/shop, none for budgets/pins/day types/person settings; every write audited with before/after; the SMM refusal by role;
  - every refusal maps to a `ScheduleErrorCode` with an HTTP status (403/404/409/422/503).
- [ ] **Step 2:** implement. **Step 3:** green. Commit.

## Task 18: Routes + the step-up tier map + shop context

**Files:** create `app/api/schedule/route.ts`, `app/api/schedule/settings/route.ts`; modify `tests/step-up-tier-map.test.ts`, `lib/shop-context-shared.ts`; create `tests/schedule-routes.test.ts`.

- [ ] **Step 1 (tests):**
  - POST `{action: generate|preview|apply|edit|approve|budget|keep_budget|day_type|pin|person}` and `{action: structure|shop}`;
  - session required (401), same-origin check, JSON body shape (400 `bad_request`);
  - the tier per action pinned in the map: apply with ≥ 1 confirmed edited week → B; approve → B; structure/shop → E. **Tier B is asserted in the route before the lib runs**; the lib then passes `confirmed_overwrite` to SQL;
  - the route posts IDENTITIES, not values, for approve/apply (week + expected head + preview token), re-derived server-side;
  - `/schedule` and `/admin/people-reconcile` are declared in `SHOP_PARAMS_BY_PATH`.
- [ ] **Step 2:** implement. **Step 3:** green. Commit.

## Task 19: The Wednesday draft cron

**Files:** create `app/api/cron/schedule-draft/route.ts`; modify `vercel.json` (`{ "path": "/api/cron/schedule-draft", "schedule": "15 10,11 * * 3" }`, approved by CC, R3); create `tests/schedule-cron.test.ts`.

- [ ] **Step 1 (tests):**
  - cron auth; lease `'schedule-draft'`;
  - the route acts only when ET is Wednesday and the ET hour ≥ 6 (both UTC slots arrive; one acts in EDT and in EST, the other finds the week built: idempotent through `head_moved`/"already exists" → `skipped`);
  - per enabled shop it builds NEXT week only when the week has no revision;
  - **demand `unavailable` → that shop is skipped, audited `schedule.draft_skipped` with the cause, and nothing is written (r2, P2-6)**; demand `no_history` → builds on the override/weekend/Normal order, flagged;
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
  - **r2:**
    - demand `unavailable` → a banner "Sales data didn't load — nothing was rebuilt; try again", with Generate/Regenerate disabled and the existing draft shown unchanged;
    - `no_history` → the Normal-crew note;
    - money blank until the MoO sets the estimates ("—" + the MoO errand);
    - the budget composition line ("Oct: 52 h + Nov: 18 h");
    - inherited problems carry an "earlier problem" label, apart from new ones;
    - **r3:** `unresolved_search` gaps in AMBER with "No fill found within the search limit — you may find one" and the candidate list; the current-inputs advisory ("Since this was built: …") apart from the original verdict;
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
  - pointer drag converts pixels → quarter steps through the pure `edit-shared` op. **r2 (P3-13):** SSR cannot fire pointer or keyboard events, so this is tested as the PURE `dragToOp(pxDelta, pxPerQ, handle)` and `keyToOp(key, handle)` functions in `use-drag-snap-shared.ts`. The real interaction (pointer drag, keyboard adjustment, cancelled step-up, stale-response recovery) is covered by the browser sim walk in Task 26;
  - **stale response:** a response whose `expectedHead` no longer matches is discarded, the board reloads the head and shows "Someone else changed this week — your view is updated" (`head_moved`); tested at the reducer level;
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
  - a cancelled password prompt keeps the preview and applies nothing;
  - inherited problems on kept days are labelled and do not disable Approve;
  - per-week gaps by cause, with the certificate line ("Budget is spent — needs +3.5 h");
  - `preview_stale` → "Something changed — preview again";
  - a partial result names the landed weeks;
  - Approve (Tier B) is disabled with the reason while rules fail or an `unresolved_search` gap remains (r3);
  - "Ready for 7shifts — sending comes in a later update" (no send control).
- [ ] **Step 2:** implement. **Step 3:** green. Commit.

## Task 24: Settings — schedule structure, staff settings, leader shifts, presence / Add to schedule, shop switch, wage estimates, + the Phase 1 backlog screens

**Files:** create `app/(authed)/schedule/settings/page.tsx`, `components/schedule/StructureEditor.tsx`, `StaffSettings.tsx`, `PresenceAndAdd.tsx`, `components/people/SkillTunablesEditor.tsx`, `components/people/PrepPositionCard.tsx`; create `tests/schedule-settings-ui.test.ts`.

- [ ] **Step 1 (tests):**
  - **the structure editor** (the mockup's sections):
    - shop day, day types (thresholds + weekend), crews per day type (a table that wraps at 375 px as stacked cards), positions (open/trim/close/heads/allowed roles/priority toggle per pair), leadership, managers (min h/day, floor h/week = 32 sample), limits (min shift 4 h, OT, flex rules (Phase 3 note), closing checklist "measured ~N min from M finalized closes · override (wins when set)"), catering rule, labor target % + basis (default Total labor, R4);
    - Tier E prompt; a canceled prompt keeps the draft;
    - the TS validator names the key before posting;
    - the station-column advisory;
    - after save: "Settings changed — regenerate?";
  - **staff settings:** work type + also allowed, leader setting (Opens only / Closes only / Mix), preferred cover positions (ordered with ↑ ↓ × buttons, 44 px), soft range, full-timer, and (r2, R6) "Include on the schedule" for a person whose role is excluded by default (prep / catering manager; never offered for CGS or social media);
  - **presence toggles** ("Cristian in today") and **Add to schedule** (person, block, positions they can flex across), both writing pins;
  - **MoO only:** shop switch, wage estimates (blank by default, R2) and the AGM access setting (read-only default / edit, R1) (Tier E);
  - **Phase 1 backlog:** the MoO skill-tunables editor on `POST /api/people/settings` `action: "tunables"` (the same validator, Tier E), and the prep evidence position card (`action: "shop"`);
  - every string en/es; SMM refused.
- [ ] **Step 2:** implement. **Step 3:** green. Commit.

---

# Chunk G — Reconciliation, the sim, the law, verification (Tasks 25–28) · Opus 5.5

## Task 25: The THREE-WAY reconciliation view (§8.0)

**Files:** create `lib/scheduling/reconcile-shared.ts`, `lib/scheduling/reconcile.ts`, `app/admin/people-reconcile/page.tsx`, `components/admin/people-reconcile/ReconcileList.tsx`, `tests/schedule-reconcile.test.ts`.

The pure `reconcile({members, toastLinks, sevenLinks, sevenUsersAtShop, toastPunches14d, sevenPunches14d, publishedSevenShifts14d, coopsProposalShifts14d, sevenStatus})`:
- **each person row** carries three ticks (CO-OPS · Toast · 7shifts). The CO-OPS user is the anchor; nothing links by name. The 7shifts tick reads "not connected" while the status is not `ready`.
- **Identity flags, each a named reason key:**
  - `toast_clockin_no_user`: an `employee_guid` with punches and no active link at this shop (first name only, from `employee_first_name`);
  - `seven_user_unlinked`: a 7shifts user assigned at the linked location with no link;
  - `member_no_toast`, `member_no_seven`.
- **Attendance flags (r2, P2-11): the schedule being compared is the one employees actually follow.**
  - **When published mirrored 7shifts shifts exist** for the person-day (`sevenshifts_shifts` with `draft = false`, `deleted = false`, joined through the user link), the comparison is **"against the published 7shifts schedule"**: `shift_no_punch` (a published shift with no Toast or 7shifts punch overlapping it) and `punch_no_shift` (a punch with no published shift overlapping it). A person who followed the published schedule therefore never gets `punch_no_shift`, whatever the CO-OPS proposal said (tested).
  - **When no published shift data exists** (7shifts not connected, the person not linked, or no shifts mirrored for that day), the row is labelled **"against the CO-OPS proposal (not published)"**. Its discrepancies are informational (`proposal_differs`, never `punch_no_shift`/`shift_no_punch`), and the row shows the missing schedule evidence ("No published 7shifts schedule for Oct 14 — connect 7shifts or link this person").
  - `sources_disagree`: 7shifts punch hours vs Toast hours differ by > 15 min for the same person-day. **Toast stays the backup source of actual hours**, and the row says so.
- Rows sort flags first, then name.

- [ ] **Step 1 (tests):**
  - each flag;
  - "nothing links by name" (two people with the same first name stay separate);
  - **a follower of the published schedule** whose CO-OPS proposal differed gets no `punch_no_shift` and no `shift_no_punch`;
  - an unused CO-OPS proposal with no published data gives `proposal_differs`, labelled "not published";
  - a 7shifts draft (`draft = true`) is never treated as published;
  - the missing-evidence line appears when neither a published schedule nor a link exists.
- [ ] **Step 2:** the loader (paged; the gate before I/O: GM own / MoO+; SMM refused). It reads `sevenshifts_shifts` only when the status is `ready`. Actions deep-link to `/admin/toast-employees?loc=` and `/admin/sevenshifts?loc=`; no new writer.
- [ ] **Step 3:** the page per the disclosure doctrine (summary rows + drawers, counts on collapsed headers, en/es, 375 px).
- [ ] Green. Commit.

## Task 26: The sim seed + the browser sim walk (CC runs it)

**Files:** create `scripts/sim/seed-scheduling.ts`, `tests/schedule-sim-seed-guard.test.ts`, `docs/runbooks/scheduling-sim.md`.

- [ ] **Step 1:** the script (a `pathToFileURL` guard; `assertSimTarget`; refuses the prod ref by name; dry run by default, `--apply` to write). Per sim shop it seeds:
  - 15 crew users + `user_locations`;
  - manual `toast_employee_links` (through the `link_toast_employee` RPC, source `manual`, actor = the sim GM);
  - 8 weeks of `toast_time_entries` from fixed patterns: some closers, some openers, one BOH-only, one with no history, and **one new hire with 1 week and one with 2 weeks** (the P2-10 transition);
  - `schedule_shop_settings.enabled = true` through the 0274 writer, plus wage estimates on the SIM only (prod starts blank, R2);
  - optionally `--captures` synthetic capture rows if the 0221 shape allows; otherwise demand stays `no_history` (documented).
- [ ] **Step 2:** the guard test (pure argument/URL parsing; prod refused; no client built on refusal).
- [ ] **Step 3: the runbook for CC — the browser sim walk (r2, P3-13)**, at **375 px, once in English and once in Spanish**, recording each step's result in the PR:
  1. apply 0274 → 0275 on the sim; run the seed;
  2. open `/schedule?loc=`; build next week; check the flags (assumed availability, unproven skills, Normal crew with no sales history);
  3. **drag:** a bar's body, its start edge, its end edge and a segment divider, each by touch-drag (Chrome device mode, 375 px), each snapping to 15 min, and a drag into an overlap snaps back with its named message;
  4. **keyboard adjustment:** Tab to a bar, use the −15 / +15 buttons and the arrow keys; focus stays on the control; the screen reader label reads the new time;
  5. **cancelled step-up:** Regenerate a range including the edited week, check it, cancel the password prompt → nothing changes, and the preview is still there; then confirm with the password → the week is rebuilt and "What changed" is shown;
  6. **stale response:** open the same week in two tabs, edit in tab A, then edit in tab B → tab B shows the `head_moved` message and reloads the head, and its edit is not applied silently;
  7. Approve (password), and see "Ready for 7shifts";
  8. the structure editor with the Tier E window; a cancelled prompt keeps the draft;
  9. run the cron route by hand on a Wednesday clock through `scripts/sim/run-schedule-draft.ts`, which injects the test clock (`?now=` is NOT accepted in prod code);
  10. the two-session `head_moved` check (`scripts/sim/schedule-lock-check.mjs`, sim-only guard as Phase 1's);
  11. `/admin/people-reconcile` for both shops.
- [ ] Commit.

## Task 27: The law (AGENTS.md) + the manager guide (en + es)

**Files:** modify `AGENTS.md` (a new "Scheduling Phase 2" section under Phase 1's), `docs/guides/manager-guide.md`; extend `tests/manager-guide-scheduling.test.ts`.

The law captures, at least:
- the validator is non-negotiable;
- gaps carry causes: the proven certificates (`budget_limited`, `floor_limit`, `eligibility`, `availability`, `capacity`, `structure`) and the honest `unresolved_search` (amber, never a proof, blocks Approve whether inherited or not); the bounded repair search runs before any non-proven gap; valid input never throws;
- generator purity, determinism and permutation invariance; the goldens and `GENERATOR_VERSION`;
- **unknown skill is not inexperience:** `unproven` is its own band, and pairing is a soft preference;
- **the historical-preservation contract:** inherited days (past and future) keep their complete shift set, gap set, day record, original context and problems (`history_changed` otherwise); each revision stores its RuleContext snapshot for original validation, with a separate current-inputs advisory; current eligibility judges only new or changed future assignments, in the lib and in SQL;
- the complete `DeclaredGap[]` persists apart from the display summary;
- demand = the pulse baseline only (no second engine), as a discriminated result where `unavailable` never builds; catering named, never summed;
- budgets are apportioned to dates; the newest entry covering a date wins for that date (r3); a week sums its dates;
- the closing override wins; only finalized closes are measured;
- availability is assumed from Toast punches with a person-specific denominator and an insufficient-history fallback, until Phase 3 (flagged);
- reconciliation compares against the PUBLISHED 7shifts schedule;
- revisions are append-only full snapshots, and approval is a separate fact;
- an edited week is never rebuilt without a per-week confirmation (enforced in SQL), and the password (Tier B) is checked at the route, not in SQL;
- past days are locked in SQL;
- schedule time = ET wall-clock quarters;
- wages never leave the server as rates;
- the per-shop switch is off by default; the cron is not in `JOBS_REGISTRY`; no notifications;
- the structure is the single source of position hours once saved (station columns are advisory seeds);
- Juan's settings defaults (Resolved R1–R7).

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
| **B** | **5–8** | **people input (person-specific assumed availability, the unproven band), shaped templates, assignment + bounded repair + gap certificates / cover / priority / Closing Manager / MoD / reasons / strength, the historical contract, constrained fixtures then goldens + property test** | **Fable 5.1** | vitest only (goldens, property) |
| C | 9–12 | board maths, labor-target card, budget + suggestion, horizon + What changed + edit ops | Opus 5.5 | vitest only |
| D | 13–15 | 0274, 0275 (+ harnesses, ceilings, the overwrite guard in SQL), audit vocabulary + i18n coverage | Opus 5.5 | PGlite; key parity |
| E | 16–19 | the one loader (+ 3 extractions, equivalence intact), the lib, routes + tier map, the Wednesday cron | Opus 5.5 | fake db; schema check; route tests |
| F | 20–24 | the board (strip, tabs, timeline, drag, reasons, horizon, approve), settings + Phase 1 backlog screens | Opus 5.5 | SSR UI tests |
| G | 25–28 | three-way reconciliation, sim seed + runbook, the law + guide, verification | Opus 5.5 | pure + SSR; sim (CC) |

Chunks A and C can run in parallel with B once Task 3's types are merged. D can start after A. E needs B, C and D. F needs E. G needs E (Task 25 needs only 0275).

---

## Judgment calls (made in this plan; each reversible in one place)

1. **J1 — AGMs see a read-only board with no labor $ or %.** GM at their own shop and MoO+ build and edit. Money is hidden because `canSeeShopLaborTotals` is GM+, and labor % × forecast reveals the $. **r2:** this is now the setting `agm_access` (default `read`; Resolved R1).
2. **J2 — No staff view of shifts in Phase 2.** 7shifts stays the employee-facing schedule (spec §1). "Approve" marks the snapshot Phase 3 will send.
3. **J3 — Demand is the pulse's trailing same-weekday hourly average over 28 days**, the one shipped baseline. There are no trend or holiday adjustments. Catering is named, never summed, which avoids double-counting the Toast-rung catering already in the baseline. Later weeks reuse the same curve with a confidence note. **r2:** scheduling receives a discriminated result, and `unavailable` never builds (P2-6). The curve shapes the shifts deterministically (P2-4).
4. **J4 — Position open/trim/close times live in the schedule structure**, seeded once from the station columns. Later station edits show as an advisory and are never applied silently.
5. **J5 — Schedule time is ET wall-clock quarter-hours per business date.**
6. **J6 (r2 P1-3, r3 P2-3 + P2-4) — A manager edit that breaks a rule is saved and shown with that rule (spec §6.5), under the historical-preservation contract.**
   - r3: inheritance binds the complete canonical shift set, gap set and day record of every inherited day, past AND future (`history_changed`).
   - r3: each revision stores the RuleContext snapshot it was validated with. Original validation replays against that snapshot; a separate current-inputs advisory shows what changed since.

   The contract itself:
   - inherited and locked days carry their ORIGINAL validation context and problems, marked inherited, and are never re-judged as new generator output;
   - current eligibility applies only to new or changed future assignments, in the lib and in SQL;
   - SQL accepts unchanged history after a person is deactivated or a position retired;
   - only structural edit failures (overlap, malformed segments, off grid, a locked day) are refused.
7. **J7 (r2 P1-1, r3 P1) — Every gap carries a cause. Proven causes have a verified certificate:** `budget_limited` (R < the cheapest legal fill FOUND, W, with its witness — never a minimality claim; CC chunk D design ruling), `floor_limit`, `eligibility`, `availability`, **`capacity`** (a per-window counting bound: required heads > eligible + available people, numbers shown), and `structure`. **Search exhaustion is NOT a proof:** it is declared `unresolved_search` (amber; Approve refuses while ANY exists, inherited or not, r4). Before a non-proven gap is declared, the deterministic repair search runs with ejection chains of up to 3 links, 8 donors per link, and 200 moves per week. **Valid input never throws;** only an invariant violation (programmer error) throws.
8. **J8 (r2, P2-9) — Closing checklist duration:**
   - the manager override WINS when set;
   - otherwise the p75 of (finalize instant − service close) over the last 28 FINALIZED closes, with at least 8 samples, rounded up to 15 min;
   - otherwise 45 min.
   - Unfinished instances never count.
9. **J9 — No per-person $ on any Phase 2 surface, MoO included.**
10. **J10 — Before 7shifts, wages are a shop estimate the MoO sets.** **r2:** it is blank by default, so money stays blank until it is set (R2).
11. **J11 — Revisions are full snapshots with no exception.** Approval is a separate append-only fact that names a snapshot (r2).
12. **J12 — The overwrite guard is a confirmation check in SQL** (`edited_week_unconfirmed`). The password (Tier B) is checked at the route, never in SQL. The cron can only create a week that has no revision.
13. **J13 — The cron runs twice on Wednesdays (10:15 and 11:15 UTC) and acts once, at or after 6 AM ET.** It skips a shop whose demand is `unavailable`.
14. **J14 (r2, P2-12) — Day-type order:**
    1. the manager's non-auto per-date override;
    2. the weekend classification;
    3. the forecast thresholds.
15. **J15 (r2, P2-10) — Availability is assumed from Toast punches with a PERSON-SPECIFIC denominator:**
    - only weeks since the person's first punch or membership count;
    - with at least 3 observed weeks for a weekday, the pattern applies (share ≥ 25%, the p10–p90 window ± 30 min);
    - with fewer than 3, the person is assumed available within the shop's normal hours (flagged);
    - a new hire never becomes less available after their first punch.
16. **J16 — The roster excludes `cgs`, `social_media_mgr`, `catering_mgr`, `prep_mgr` and levels below 2 by default.** **r2:** prep and catering managers can be added per person (`roster_include`, R6). MoO and Owner appear through presence only.
17. **J17 — Cover preferences default to empty.** The mockup's `defaultCoverPreferences` (verified directly, r2) are sample data.
18. **J18 — Approve takes Tier B and refuses while NEW error-class problems exist.** Inherited error-class problems do not block it. **The exemption explicitly EXCLUDES `unresolved_search`:** every `unresolved_search` gap, inherited or not, refuses Approve (`unresolved_gaps`, r4).
19. **J19 (r2, P1-2, OVERTURNED) — Unknown skill is not inexperience.**
    - `unproven` (starting point) is its own band.
    - "Newer" needs real evidence: not starting point, confidence ≥ 0.3, and value below `building`.
    - "Strong" needs value ≥ `strong` and confidence ≥ 0.3.
    - Pairing is a SOFT preference: when no strong partner fits, the newer person is still placed and the board shows `pairing_unmet`.
    - A roster with no evidence builds clean.
20. **J20 — A 6-week horizon cap**, which still covers "a whole month" (Astra: reasonable).
21. **J21 — The Phase 1 backlog screens ship here** on their existing routes: the skill tunables editor and the prep evidence position.
22. **J22 (r2 P2-7, r3 per DATE) — Every budget entry is apportioned to its dates when written:**
    - week and month entries by forecast share (even when there is no forecast);
    - accepted suggestions with their explicit per-date amounts.

    The newest entry covering a DATE wins for that date. A week sums its dates. A date with no entry has no budget (never 0), and the generator's budget stop applies only to budgeted dates.
23. **J23 (r2 P2-8, r3) — The budget suggestion uses an explicit completed reference with a COMPLETE 7-day hours base.**
    - Matched weekdays (or all 7 when fully captured) estimate only the demand RATIO, which applies ONLY to matched dates (r4).
    - Unmatched dates keep their reference hours EXACTLY and take only positive deltas (r4).
    - Matched dates clamp at their minimum crew hours, with a note (r4).
    - A zero or unavailable denominator is refused.
    - Catering and structure deltas are measured per date, relative to the reference.
24. **J24 (r2, P2-11) — Reconciliation judges attendance only against the PUBLISHED 7shifts schedule.** Without it, the comparison is labelled "against the CO-OPS proposal (not published)" and the missing evidence is shown.

---

## Resolved (CC defaults, 2026-10-16; Juan may override in the morning — every one is a SETTING, so nothing blocks)

| # | Question | Default | Setting / where |
|---|---|---|---|
| R1 (O1) | Do AGMs build and edit? | **Read-only** (no money) | `schedule_shop_settings.agm_access` = `'read'` \| `'edit'` (MoO, Tier E); Tasks 2, 13, 24 |
| R2 (O2) | Starting wage estimates | **Blank**: money reads "—" until the MoO sets them | `estimated_hourly_cents` / `estimated_salaried_weekly_cents` NULL; Tasks 13, 20, 24 |
| R3 (O3) | One more Vercel cron | **Approved** by CC | `vercel.json`; Task 19 |
| R4 (O4) | Labor target basis | **TOTAL labor** (hourly + salaried), 28% | `structure.labor.basis` default `'total'`, `targetPct` 28; Tasks 1, 10 |
| R5 (O5) | Floor limit and daily minimum | **32 h/week** floor per salaried manager; **8 h/day** GM and AGM minimum | `limits.managerFloorH`, `gmMinimumH`, `agmMinimumH`; Task 1 |
| R6 (O6) | Prep / catering managers on the floor schedule | **Excluded by default, addable per person** | `roster.excludedRoles` + `schedule_person_settings.roster_include`; Tasks 5, 13, 24 |
| R7 (O7) | Keep Approve? | **Keep** ("Ready for 7shifts", Tier B) | Tasks 14, 17, 23 |
| R8 (CC 2026-10-16, from chunk A's v17 finding: 7 evening windows with no SL+ on duty) | May a Key Holder be the manager on duty in the evening? | **OFF**: an hour with no SL+ is a validator finding, shown as a gap with its certificate; the rule is not relaxed | `structure.leadership.keyHolderModAfterQ` (null = off; a quarter = ON from that time), honoured by `modCountsAt` in the validator and the generator; Tasks 1, 7, 24 |
| R9 (CC chunk B ruling 3 + Astra chunk B, 2026-10-16) | A daily maximum shift length? | **10.5 h** (CC chunk C ruling 2, pending Juan; was 10 h, below the v17 line day of 10.25 h), a HARD rule in the validator (`shift_over_maximum`, error; refusal `shift_over_maximum` en + es), assignment, extension and repair; never below the 4 h minimum or the GM / AGM minimums; inherited history is never re-judged | `structure.limits.maxShiftH` (jsonb, no column; the shared case file carries its rows); a run longer than the cap is split across people; Tasks 1, 3, 7, 12, 24 |

No question is left open for Juan. Each default above is one setting he can flip.

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
| 1. Hours budget per week / month split + weekly suggestion with reasons (§5.2) | Budget section; Tasks 11, 13 (`schedule_budget_entries` + date-scoped contributions), 20 |
| 2. Horizon: next week / N weeks / rest of month / month; partial weeks; never silently overwrite an edited week; What changed per week (§5.8) | Horizon section; Tasks 12, 14 (SQL guard), 17, 23; J12, J20 |
| 3. Generator: shapes from demand + trims; multi-position segments; skill-weighted with guardrails; team strength; leader settings; MoO/Owner presence; salaried cover within the floor limit; closing crew + Closing Manager; MoD; 4 h min, one per position, priority pairs, preferred cover | Generator section; Tasks 5–8 (Fable) |
| CORRECTED trims: Walk-ins/Online all day, 3rd Party ~4 PM; every open/trim/close a per-shop setting | Structure (Task 1), need grid (Task 4), J4 |
| 4. Wednesday draft + Regenerate with What changed | Tasks 19, 17, 23 |
| 5. Pure `checkScheduleRules` on every generated / regenerated / edited schedule and in tests; a failing generated schedule is a bug | Validator map; Task 3; `buildWeek` throws (Task 7); goldens + property (Task 8); edits record problems (Tasks 12, 17); J6, J7 |
| 6. Labor-target card ≤ 28% per shop, math shown | Task 10, 21; R4 (basis default total) |
| 7. Board per mockup v17: phone-first 2D, money strip, day tabs past-locked, demand curve + labor % per hour, coverage colours, 15-min drag, reason panel, en/es | Tasks 9, 20–24 |
| 8. Toast interim people + three-way reconciliation | Data reality; Tasks 5, 16, 25 |
| Demand source settled, exact functions, no second engine | "Where demand comes from"; Tasks 4, 16; J3 |
| Manager floor-time limit setting (sample 32 h) | `limits.managerFloorH`; rule `manager_floor_exceeded`; R5 |
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
| r2: gap certificates, the repair pass, the historical contract, gap persistence, discriminated demand | Validator map; Generator steps 1, 3a, 9a; Migrations (0275 days / gaps / approvals); Tasks 3, 7, 8, 14, 17 |

---

## Changes from r1 (Astra round 1: CHANGES REQUESTED, 3 P1 / 9 P2 / 1 P3; CC accepted every finding)

| # | Finding | Fix (as ruled) | Where | Test |
|---|---|---|---|---|
| P1-1 (J7) | A budget gap cannot satisfy "no one free"; greedy allocation can mis-declare a gap | Cause-specific CERTIFICATES (`budget` with `hoursNeeded`, `floor_limit`, `eligibility`, `availability`, `structure`), verified by `checkCertificate` / `structureInfeasible`. A deterministic, capped REPAIR pass (direct insertion → one-step reassignment → segment swap; `REPAIR_MAX_STEPS` 200, 3 donors) runs before any gap is declared. Fixed cause order. | Validator map ("Gap certificates"); Generator step 9a; 0275 `schedule_revision_gaps` + `valid_gap_certificate`; J7 | Task 3 per-cause certificate tests; Task 7 budget (0 / tight / loose), repair (Tess/Sam), cap; Task 8 fixtures F0a–F0e written and green BEFORE any golden is frozen; property (3), (8) |
| P1-2 (J19 overturned) | Mandatory strong pairing blocks a cold-start roster | `unproven` is its own band. "Newer" needs real evidence (not starting point, confidence ≥ 0.3, value < building). Pairing is a soft tie-break; `pairing_unmet` is a board note. Strength never averages unproven minutes as 0. | Data reality; Generator step 6; Task 5 `SkillLookup`; J19 | Task 7 pairing (a)–(d), incl. **the whole roster with no evidence builds clean**; Task 8 F0f |
| P1-3 (J6) | Regenerate re-judges preserved history; SQL rejects unchanged history after deactivation/retirement | The historical-preservation contract. Inherited / locked days carry their ORIGINAL context and problems (`schedule_revision_days`: origin revision, structure version, inherited flag, full problems). Current eligibility applies only to NEW or CHANGED future assignments in the lib and in SQL (commit step 8). SQL accepts unchanged history; `history_changed` refuses a tampered inherited day. | Architecture; Generator step 1; Migrations 0275; Task 3; Task 12 edits; J6 | Task 3 inherited tests; Task 7 history (a)–(d); Task 14 harness end to end (deactivate U, retire P, carry Monday → accepted; new shift → refused); Task 17 lib end to end; Task 8 F0g |
| P2-4 | Shapes come from fixed waves, not the curve | `shapeFromCurve`: a deterministic curve → line arrivals and coverage counts, inside the structural floors and limits (rounding ties `round_half_up` per quarter (r4 P3; r2 said "to the earlier hour"), the r2 rush clamp, superseded in r3 and made display-only in r4, secondary first on taper) | "Where demand comes from"; Generator step 3a; Task 4 Step 5; Task 6 | Task 4: **equal-total days with peak hours at 12:00 and 13:00 get different shapes** (r4 P3: the superseded 13:30 peak is gone; hour → quarter is a step); flat curve = configured waves; Task 8 F10 |
| P2-5 | Declared gaps lost at persistence | The complete `DeclaredGap[]` + certificates persist in `schedule_revision_gaps`; full per-day problems in `schedule_revision_days`; `problems_summary` (50) is display-only | Migrations 0275; Task 14; Task 17 | Task 17 **generate → commit → reload → validate parity** (incl. a 120-problem fixture); Task 14 gap round-trip |
| P2-6 | The pulse wrapper turns failures into "no history" | `fetchSalesBaseline` returns `ok \| unavailable(timeout/rpc_missing/rpc_error)`; the pulse wrapper maps to `null` exactly as today. Scheduling's `DemandResult = ok \| unavailable \| no_history`. `unavailable` never builds, never uses the Normal crew, never replaces a draft; the cron skips the shop. | "Where demand comes from"; Tasks 4, 16, 17, 19, 20 | Task 16 timeout / missing RPC / successful empty, separately, plus the pulse-unchanged test; Task 17 refusal leaves the head untouched; Task 19 skip |
| P2-7 | Month-edge allocations replace whole-week budgets | `schedule_budget_entries` + date-scoped `schedule_budget_contributions`, composed per ISO week by `budgetForWeek`; the writer proves the contributions tile the entry | Budget section; Migrations 0274; Tasks 11, 13 | Task 11 and the 0274 harness: **adjacent months sharing a week, both entry orders** give the same composed budget |
| P2-8 | The suggestion has no comparable completed reference | An explicit reference week (fully ended, head revision, 7 captured days), else matched weekdays. `suggestion_unavailable` on a zero or unavailable denominator. Catering and structure deltas are reference-relative. | Budget section; Task 11 | Task 11: no future self-reference, matched weekdays, zero denominator refused, catering already in the reference gives +0 |
| P2-9 (J8) | Unfinished closes counted; the override did not override | The override WINS. Only FINALIZED closes are measured, via a new opt-in `closingFinalization` people-facts family (`closingLines` and the legacy goldens unchanged). | Task 4 Step 4; Task 16; J8 | Task 4 **unfinished vs finalized**; Task 16 equivalence golden unchanged |
| P2-10 (J15) | New hires became less available after their first punch | A person-specific observation denominator (weeks since first punch / membership); fewer than 3 observed weeks → assumed available within the shop's normal hours, flagged | Data reality; Task 5; J15 | Task 5 **new hire at 0, 1, 2 weeks** (never shrinks), then the pattern at 3; Task 26 seeds the 1- and 2-week hires |
| P2-11 | Reconciliation compared punches with unsent proposals | Attendance is judged against the PUBLISHED mirrored 7shifts shifts (`draft = false`); otherwise it is labelled "against the CO-OPS proposal (not published)" with the missing evidence shown, and only `proposal_differs` | Task 25; J24 | Task 25: **a follower of the published schedule never gets `punch_no_shift`**; drafts are never "published"; the missing-evidence line |
| P2-12 | The weekend overrode the manager's day override | Order: the non-auto override → weekend → forecast thresholds | Task 4 Step 3; J14 | Task 4, pinned both directions (Saturday slow/busy by override; `auto` Saturday is weekend; `auto` Wednesday by forecast) |
| P3-13 | Harness and interaction contracts | The harnesses load the stub with Supabase default grants (service_role ALL), call writers as `service_role` with the app's exact named args (`rpc-args-shared.ts`), and assert DML denied plus PUBLIC/anon/authenticated EXECUTE denied. The browser sim walk covers drag, keyboard adjustment, cancelled step-up and stale-response recovery at 375 px in en and es. | Chunk D "Harness execution contract"; Tasks 13, 14, 22, 26 | Harness assertions (a)–(c); the Task 26 walk steps 3–6 recorded in the PR; Task 22 pure `dragToOp` / `keyToOp` + the stale-response reducer |
| Parity | Aggregate counts were too strict / too weak | Each intended violation is detected at its expected person / position / time; the clean fixture and deterministic diagnostics are kept; exact counts only for (h), where both report per slot | Validator map; Task 3 | `schedule-rules-mockup-parity` (subjects from the mockup's own messages stored at export) |
| Tier B | SQL was described as password-fresh | Tier B is asserted at the route. SQL checks only the `confirmed_overwrite` flag (a confirmation check). Approval is a separate fact, so there is no no-shift-copy exception to the snapshot contract. | Permissions ("Where Tier B lives"); Migrations sketch; Tasks 14, 18; J11, J12 | Task 18 tier map; Task 14 names it a confirmation check; approve writes no revision row |
| v17 | Astra could not see the mockup | I re-read `checkInvariants` (a–i, the two structural checks, unknown person, past days under `defaultStructure`), `priorityPairs`, `positionPriority` and `defaultCoverPreferences` directly in `C:/co/share/schedule-board/schedule-board.html`, and re-ran the Pete negative control (its 4 exact messages). Correction: (e) is OPEN–CLOSE in the mockup; trim belongs to (b). | Validator map ("verified against the source") | Task 3 parity |
| O1–O7 | Juan's open questions | Each is a SETTING with CC's default (AGM read-only; money blank; cron approved; TOTAL labor basis; 32 h / 8 h; prep/catering managers excluded but addable; keep Approve) | "Resolved" R1–R7 | Tasks 1, 2, 5, 13, 24 |

---

## Changes from r2 (Astra round 2: CHANGES REQUESTED, 7 of 13 resolved; 1 P1 + 5 P2 open; CC accepted every finding)

| # | Finding | Fix (as ruled) | Where | Test |
|---|---|---|---|---|
| R2-1 (P1) | Ordinary capacity shortages had no certificate; search exhaustion could only throw; Task 7 vs Task 8 contradicted each other | **`capacity` certificate:** for a window and a subset S of positions, `Σ need(S, q) > |N(S, q)|` (the members eligible for S and available at q) proves at least `shortBy` uncovered heads in every allocation; the numbers are shown. **Search exhaustion → `unresolved_search`:** declared, never a proof, amber on the board, Approve refuses (`unresolved_gaps`, lib + SQL). The repair search is widened (ejection chains ≤ 3 links, ≤ 8 donors per link, 200 moves). **Valid input never throws;** only an invariant violation (a programmer error) throws, and that is a bug. | Validator map (certificate table, non-throwing contract); Generator step 9a and step 11; 0275 cause list + approve; Tasks 3, 7, 8, 14, 17, 20, 23; J7 | Task 3 capacity / unresolved tests; Task 7 4th-donor, 3-link chain, 4-link → `unresolved_search`, cap without a throw; Task 8 **F0h insufficient capacity, F0i fourth donor, F0j long chain**; property (1) never throws, (3) |
| R2-2 (P2) | The clamp used the same values as floor and ceiling; the flat curve did not give the waves; there was no hour → quarter rule | `minHeads` = Σ of the NEW setting `crews[type].lineMinHeads` (the floor); `maxHeads` = Σ of the existing head limits (the capacity). `heads_q = clamp(round(c_q/Σc × T/0.25), minHeads, maxHeads)` with `c_q = W_q × d_h/d̄`. **Hour → quarter is a step.** **A flat curve reproduces the configured waves exactly** (c = W), and the validator requires W within [min, max]. The shifted-peak fixture is worked numerically (A 2/4/2/2, B 2/2/4/2, flat 2/3/3/2); r2's 13:30 peak is corrected to whole hours. | Generator step 3a; Task 1 (`lineMinHeads`, W-within-bounds rule); Task 4 Step 5; Task 8 F10 | Task 4 exact numbers; flat = waves; Task 8 F10 frozen only with the worked numbers |
| R2-3 (P2) | Future inherited content was not bound in SQL | Commit step 9: for EVERY inherited day (past and future), the day record AND the complete canonical shift set AND gap set must equal the head's → `history_changed` | Migrations sketch step 9; Task 14 | Task 14 harness: a kept future day with (a) a shift moved to another active position, (b) a gap's `to_q` changed, (c) a past gap dropped → each `history_changed`; unchanged → accepted |
| R2-4 (P2) | A digest could not reproduce validation after the inputs changed | `schedule_revision_contexts`: a compact JSON snapshot of the RuleContext inputs used (roster, work types, leader settings, cover lists, availability, positions, per-date budgets, closing minutes, demand kind). Original validation replays against the origin revision's snapshot; `contextAdvisory` reports the current-input changes separately. | Architecture; 0275 table + `p_context`; `context-shared.ts`; Tasks 3, 14, 17, 20 | Task 17 round-trip **with membership, availability and budget changed between commit and reload**: identical original validation, certificates still verify, the advisory lists exactly those changes; Task 3 the same at unit level |
| R2-5 (P2) | A month entry could wipe an explicitly budgeted date in a shared week | Every entry is apportioned to DATES when written (forecast share, even when there is no forecast, explicit for accepted suggestions) into `schedule_budget_days`. **The newest entry covering a date wins for that date.** A week sums its dates; unbudgeted dates are flagged, not 0, and are not constrained by the budget stop. | Budget section; 0274 tables + writer; generator budget stop; Tasks 11, 13; J22 | **F11 week → month** (Nov 1 keeps its week row), **F12 month → week → adjacent month**, **F13 partially budgeted week**, in Task 11, the 0274 harness and through the generator (Task 8) |
| R2-6 (P2) | Matched-weekday suggestions shrank the week to the matched days | Matched weekdays estimate the demand RATIO only. `suggested(d) = refHoursByWeekday × ρ + per-date deltas` over the COMPLETE 7-day base (the reference revision covers all 7 days); unmatched days are never shrunk or removed; acceptance stores per-date amounts | Budget section (suggestion); Task 11; J23 | Task 11: ρ = 1, Mon–Thu captured, 160 + 120 h → suggests 280 h (not 160); accepting keeps Fri–Sun's 120 h |

---

## Changes from r3 (Astra round 3: CHANGES REQUESTED, narrow — 1 P1 + 3 P2 + 1 P3; her A/B/flat recompute passed; CC accepted every finding)

| # | Finding | Fix (as ruled) | Where | Test |
|---|---|---|---|---|
| R3-1 (P1) | An inherited `unresolved_search` gap bypassed Approve | EVERY `unresolved_search` gap blocks Approve, inherited or not, in the lib AND SQL. The inherited-error exemption never covers unresolved gaps. | Certificate notes; approve sketch; Tasks 3, 14, 17, 23; J7 | Lib (Task 17) and SQL harness (Task 14): generate with a Sunday `unresolved_search` → rest-of-month rebuild (Sunday inherited) → Approve refused `unresolved_gaps`; fixture F17 |
| R3-2 (P2) | The snapshot held day totals, not the quarter-hour need | `schedule_revision_contexts` persists the COMPLETE derived need grid per changed date (need per position × quarter, line total, min/max, provenance), plus the hourly forecast used, the day type with its source (override / weekend / forecast), the catering events used and the shape note. Replay reads ONLY the snapshot. | Architecture; 0275 contexts row; Task 3; Task 17 | Task 17 replay with a loader that throws on any live read: (a) F10's A/B curves swapped live → identical coverage + certificates; (b) a day override added; (c) catering added/cancelled → identical, advisory names each |
| R3-3 (P2) | ρ < 1 shrank unmatched days | ρ and negative deltas apply ONLY to matched dates. Unmatched dates keep their reference hours EXACTLY (+ positive deltas only). Matched dates clamp at their minimum crew hours, with a note. | Budget section (suggestion); Task 11; J23 | F16: ρ = 0.8 → 34/32/32/32/40/40/40 = 250 h (Monday clamped) through acceptance and the persisted `schedule_budget_days` rows; the negative-delta variant |
| R3-4 (P2) | The curve transform was undefined for zero demand | All-zero forecast (`d̄ = 0`) → heads = `minHeads` (the `lineMinHeads` floor) + the en/es note "No sales forecast for this day: minimum crew". Zero weighted sum → an even split of `T/0.25` over the open quarters, clamped. Both are finite and never throw. | Generator step 3a (rule 2); Task 4 Step 5; Task 8 | F14 = 2/2/2/2 (8 line h); F15 = 1/1/1/1 (4 line h) |
| R3-5 (P3) | Stale executable examples | `GapCause` includes `capacity` and `unresolved_search`; Task 4's 13:30 peak → peak hours 12:00 vs 13:00; `rushShiftMaxQ` is DISPLAY ONLY everywhere (it flags a moved rush in the reason and never alters heads) | Task 3 types; Task 4 Step 5; Task 1 structure + case file; r1 table note | Task 1 case file; Task 4 |

## Changes from chunk D review (Astra: 1 P1 + 2 P2 + 2 P3; CC's design ruling on budget gaps, 2026-10-16)

| # | Finding | Change | Where |
|---|---|---|---|
| D-1 (P1) + DESIGN RULING | Budget certificates overstated the cheapest fill (a paired extension cost 2 h, the certificate said 8 h) | The cause is now `budget_limited`: R < W, the cheapest legal fill FOUND by the deterministic search (paired extensions, reassignment within REPAIR_LIMITS, new blocks, zero-cost fills), with the witness; W ≤ R is not a budget gap and the generator takes that fill; Approve never refuses it | rules-shared `cheapestFill` / verify / proveGap; shapes-shared + 0275 `valid_gap_certificate`; generator `applyFill`; en/es |
| D-2 (P2) | SQL admitted NULL certificates | `valid_gap_certificate` is TOTAL (every branch coalesced to false); the CHECK and the writer require IS TRUE; null / wrong-type cases in the shared case file (both twins) | 0275; certificate-cases.json |
| D-3 (P2) | Inherited reasons were not bound | Shift reasons are part of a day's canonical content; a carried shift keeps its ORIGINAL reasons (the head's stored index), "inherited" is the day row's flag | 0275 `schedule_day_canon`; generator `HeadSnapshot.reasons` |
| D-4 (P3) | 2026-02-30 raised 22008 | every date cast in the commit writer refuses `invalid_payload` | 0275 |
| D-5 (P3) | Prototype membership in the TS twin | `isRoleCode` and the structure validator use own-property checks; constructor / toString / hasOwnProperty cases added to the shared structure case file | lib/roles.ts; structure-shared; structure-cases.json |
| Floor cap | MoD time vs the floor limit | KEPT the spec's station-only definition: MoD-only time never counts; a salaried extension counts only the STATION time it covers; the money strip shows MoD time separately (`managerModHours`) | rules-shared floorHours; generator extendToCap; board-shared |


## Changes from chunk E review (Astra: 2 P1 + 2 P2 + 1 P3, CC's rulings, 2026-10-16)

| # | Finding | Change | Where |
|---|---|---|---|
| E-1 (P1) | An impossible combined witness certified `budget_limited` (Ben moved to Walk-ins, Maya given Register AND Walk-ins / Online over the same hours, W = 8) | The search yields CANDIDATES (nested refills / paired fills offer up to 4 alternatives each); each is applied to a COPY (`applyFillSteps`) and judged by `fillIsLegal`: no new error-class problem on that date (overlap, daily maximum, role, window, leader setting, priority), no new outside-availability, no salaried manager past the floor limit, the target gains a head over the whole window, and the day's uncovered head-quarters strictly fall. `cheapestFill` returns the cheapest LEGAL candidate; none legal → never `budget_limited` (it ends `unresolved_search` unless another cause proves it). The verifier re-finds the plan AND validates the applied witness. GENERATOR_VERSION p2.5. | rules-shared `fillCandidates` / `applyFillSteps` / `fillIsLegal` / `cheapestFill` / verify; goldens |
| E-2 (P1) | The cron claimed the lease (0275's job name) and read 0274 before checking readiness | Order: secret → `draftPrecheck` (0274 and 0275 present, else `{skipped: "not_ready"}`; no enabled shop → `{skipped: "no_enabled_shops"}`; then the Wednesday-morning check) → only then the lease. A missing relation is a clean 200 skip: no lease claim, no `cron.failure`, no heartbeat. | lib/scheduling/draft.ts; the cron route |
| E-3 (P2) | The budget suggestion compared the live structure with itself when the reference week used an older one | `referenceStructureOf`: the structure stored with the reference revision's own context (else the saved version by id), never the live one; unknown → the delta is not applied and the suggestion says so (`schedule.budget.reference_structure_unavailable`, en / es) | budget-shared; settings.ts |
| E-4 (P2) | `assigned_at` was cut to its UTC date | `memberSinceDate`: the operational (America/New_York) date, the clock the punch dates use; a Sunday-night ET assignment stays Sunday | inputs-shared; inputs.ts |
| E-5 (P3) | `op: {}` / `op: []` reached the lib (500) | `isEditOp`: the exact discriminated union (kind's keys only, integer quarters, an exact `ShiftRef`); the route answers 400 `bad_request`, the lib refuses `invalid_payload` before any read | edit-shared; the route; schedules.ts |

---

## Chunk G as built (2026-10-16)

Tasks 25–28, plus CC's chunk G board fixes and Astra's chunk F review (5 P2). The builder ran no script against any database.

### Go-live sequence (CC / Juan; nothing here was run by the builder)

1. CC: integration (merge main into the branch); the full suite, `tsc`, `next build`; `node scripts/sql-harness-0274.mjs` and `0275.mjs` (PASS 145 / 124).
2. CC, sim: Phase 1 (0268 → 0271) and 0272 must already be there; apply **0274 → 0275** with each header's PRE-FLIGHT and VERIFY; seed with `scripts/sim/seed-scheduling.ts` (dry run, then `--apply`); the checks after each step are in `docs/runbooks/scheduling-sim.md` §1–2.
3. CC: the browser sim walk at 375 px, in English and in Spanish (runbook §3: drag, keyboard, cancelled step-up, the main Regenerate confirmation, stale response, Approve, settings, the cron by hand, the two-session `head_moved` check, the reconciliation, the AGM money check, the budget control). Record each step in the PR.
4. CC: the prod rollback dry-run (0274 + 0275 inside one transaction that ends ROLLBACK; VERIFY inside; nothing left after); then prod apply 0274 → 0275 **on Juan's word**; stamp each header `APPLIED TO PROD`.
5. PR, CI green, merge (Juan clicks). Everything stays OFF: no shop is enabled, so the board reads "Scheduling is off for this shop." and the Wednesday cron answers `{skipped: "no_enabled_shops"}` with no lease and no heartbeat.
6. Per shop, the MoO (Tier E, `/schedule/settings`): review the structure with the GM → set the wage estimates → switch scheduling ON (runbook §5).

### Build self-review (spec point → where built → the test that proves it)

| Spec point | Where built | Proof |
|---|---|---|
| §5.2 hours budget per week / month, per date, with the suggestion | `budget-shared.ts`, `settings.ts` `setBudget`, `BudgetSetter.tsx`, `BudgetSuggestion.tsx` | `schedule-budget` (F11–F16, none_set), `schedule-board-ui` (Set one, exact body), 0274 harness |
| §5.8 horizon, never silently overwrite an edited week | `horizon-shared.ts`, `schedules.ts`, `HorizonBuilder.tsx`, `runRegenerate` | `schedule-horizon`, `schedule-board-ui` (P2-3 both paths), 0275 harness `edited_week_unconfirmed` |
| §6 generator: shapes, segments, skills, strength, leaders, presence, salaried cover, closing / MoD, 4 h min, priority, cover | `lib/scheduling/generator/*` | 27 goldens (p2.8), `schedule-generator`, property test |
| §6.5 the validator on every schedule; edits saved with their rule | `rules-shared.ts` `checkScheduleRules` | `schedule-rules`, mockup parity, `schedule-edit` |
| Gap causes and certificates; budget_limited; unresolved_search blocks Approve | `rules-shared.ts`, 0275 `valid_gap_certificate` | `schedule-rules`, certificate-cases (both twins), F17 |
| §6.6 labor target ≤ 28%, the math shown, no contradiction | `labor-target-shared.ts`, `LaborTargetCard.tsx` | `schedule-labor-target`, `schedule-board-ui` (one note, amber rule) |
| §7 the board at 375 px, en / es, drag in 15-min snaps, reasons | `components/schedule/*`, `board-view-shared.ts` | `schedule-board-ui`, `schedule-board-load`, screens |
| §8.0 Toast interim + the three-way reconciliation, against PUBLISHED shifts | `reconcile-shared.ts`, `reconcile.ts`, `/admin/people-reconcile` | `schedule-reconcile` (follower, drafts, not-published), `-load`, `-ui`, `-schema-check` |
| Permissions in the lib; SMM by role; AGM no money | `access-shared.ts`; AGM window trim | `schedule-access`, `schedule-agm-no-money` (allowlist) |
| Step-up B / E, the session arm | routes, `lib/session.ts` | `schedule-step-up-path`, `schedule-settings-tier-e-session`, `step-up-tier-map` |
| No email / notifications; the cron inert before its lease | `draft.ts`, the cron route | `schedule-no-notify`, `schedule-cron` |
| Files-only migrations, deny-all RLS, definer writers | 0274, 0275 | `sql-harness-0274/0275`, the two loader schema checks |
| The sim seed and walk | `scripts/sim/*scheduling*`, runbook | `schedule-sim-seed-guard` |
| The law and the guide | AGENTS.md "Scheduling Phase 2", `docs/guides/manager-guide.md` | `manager-guide-scheduling` |

### Chunk H2 (2026-10-16): the salaried flex block, the 40 h as a target, CC's answers, Astra's chunk H review

- **Salaried flex may cover a gap** (`salariedFlexBlocks` in `rules-shared.ts`, `coverWithFlexBlock` in the generator, the last fill before gaps are declared): a new block ≥ 4 h, or an extension of the manager's day, over otherwise-uncovered quarters only, inside the flex left, the daily maximum, availability, leader setting, the cover list or the MoD lane; the GM / AGM 8 h minimum does not apply to a flex-only day; reason `salaried_flex_cover`. `floor_limit` requires that no flex block reaches the gap; flex time does not make a manager busy for it.
- **The 40 h is a target** (addendum A): `salaried_base_over_target` / `salaried_over_flex` are warnings, hard only for the generator; `manager_floor_exceeded` warns on a manager-edited week; the strip names an over-target week ("{name}: 48 h, 8 h over the 40 h target").
- **CC's answers** (addendum B): the GM drops the lowest-demand day(s) by forecast at 40 h (tie → later; leadership coverage first); the prep manager is never generated; a pinned catering manager is the manager on duty only outside booked catering windows.
- **Astra's chunk H review:** relabels keep flex; the catering cover respects the pin allowlist; pins are placed (reserved) before any generated block; StructureEditor controls for the target and the flex; the no-notify closure discovers imports through the TypeScript AST.
- `GENERATOR_VERSION` p2.7; golden deltas by cause in the H2 handback.

### Chunk H3 (2026-10-16): `floor_limit` certifies only what it can verify (Astra H2 P1)

- **FILL and PROOF are separate.** `salariedFlexBlocks` (greedy labels, best window) stays the generator's preferred fill; the proof is the target-directed reach `flexBlockReaching` (`rules-shared.ts`): for one deficit, every salaried manager with flex left tries (a) a new block ON THAT POSITION over every legal window overlapping the deficit (≥ 4 h, ≤ flex left / daily max / week room, inside the position window, head limit, availability, leader setting) when they have no shift that day, else (b) an extension of their day onto that position; each through the real `flexBlockIsLegal` on the schedule as it stands. The generator runs the same reach after the preferred fill (`coverWithTargetFlexBlock`) and takes what it finds.
- **The certificate binds the flex state** (`targetWeekH`, `salariedFlexH`, `flexHoursUsed` per searched manager; TS / SQL twins in parity); the verifier re-runs the reach. Her competing-station fixture: with the GM free neither station is `floor_limit`; once Register is taken the other station is proven (the counting bound first in her exact fixture, `floor_limit` with a second busy eligible person); the stale 0-flex certificate fails at 10 h; a flex-exhausted week is a legitimate `floor_limit`; forged states are refused.
- `GENERATOR_VERSION` p2.8: 24 header-only goldens, 3 bodies (F0d, F7, F13: the `floor_limit` certificates' new fields only; every shift byte-identical).

### Phase 3 list (unchanged from "Phase 3 backlog", plus what Phase 2 shows as coming)

- The push to 7shifts as DRAFT shifts (the board's "Ready for 7shifts — sending comes in a later update"), reconciled by stable ids; forecast interval overrides; the station-mapping screen.
- Two-way availability sync and the CO-OPS picker (replaces "Assumed from Toast punches").
- "Out" call-outs with reasons and fill (§6.3).
- Staffing recommendations (§6.4).
- A staff "My shifts" view, if Juan wants one.
- The demand anticipation hub (§11).
- Guide screenshots for the six Phase 2 sections (every step "(not shown)").
