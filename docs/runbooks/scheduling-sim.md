# Runbook: Smart Scheduling Phase 2 on the sim, then go-live

Owner: CC (the sim and prod applies), Juan (every prod act), the MoO (turning a shop on).
Builder status: **nothing here was run by the builder.** Every step that writes to a database is CC's.
Branch: `feat/scheduling-phase2`. Migrations: **0274_schedule_settings → 0275_schedule_weeks** (files only until CC applies them).

Everything ships **OFF**: no `schedule_shop_settings` row = scheduling off for that shop; the Wednesday cron is inert until a
shop is switched on (it skips BEFORE its lease: `{skipped: "not_ready" | "no_enabled_shops"}`); wage estimates start blank
(money reads "—"); nothing sends an email, an SMS or a notification.

## 0. Prerequisites (check, do not assume)

- **Phase 1 is on the target first.** 0275 re-emits 0268's `claim_cron_route` and refuses unless 0268's body is there;
  0274 needs 0270 (`people_position_at_shop`, `station_positions_id_location`) and 0272 (the PostgREST write lockdown).
  Apply order on any database: **0267 → 0268 → 0269 → 0270 → 0271 → 0272 → 0274 → 0275**. Each file's PRE-FLIGHT block
  refuses by name when a dependency is missing.
- `.env.sim` on the machine running the scripts (the sim URL `https://jepgzucrvklhqpthowsc.supabase.co` and its service
  key). The scripts refuse anything else, and refuse the production ref (`bgcvurheqzylyfehqgzh`) by name.

## 1. Apply on the sim (CC, MCP)

1. Run 0274's PRE-FLIGHT queries (its header). Expect: every dependency present, `has_table_privilege(... INSERT)` = f,
   the new tables NULL.
2. Apply `supabase/migrations/0274_schedule_settings.sql`. Run its VERIFY queries: `relrowsecurity` t ×7; the
   `schedule_*` tables grant service_role SELECT only; the `%schedule%` routines are executable by service_role (and
   postgres) only.
3. Run 0275's PRE-FLIGHT queries: 0274 present; `claim_cron_route` is 0268's body (`sevenshifts-sync` in it,
   `schedule-draft` not yet); `schedule_weeks` NULL.
4. Apply `supabase/migrations/0275_schedule_weeks.sql`. VERIFY: `relrowsecurity` t ×14; service_role SELECT only;
   `select public.claim_cron_route('schedule-draft')` → t (then f within 330 s).
5. Local PGlite harnesses (no database): `node scripts/sql-harness-0274.mjs` (145 checks) and
   `node scripts/sql-harness-0275.mjs` (124 checks) print PASS.

## 2. Seed the sim (CC)

```
npx tsx --env-file=.env.sim scripts/sim/seed-scheduling.ts            # DRY RUN: prints what it would write
npx tsx --env-file=.env.sim scripts/sim/seed-scheduling.ts --apply    # writes
```

Check after the dry run: for each sim shop, "15 crew, 479 time entries" (8 full weeks of the patterns), the `+ user`, `+ link`
lines, and the `save_schedule_shop_settings` line. It stops early, by name, if the sim GM persona is missing (run
`scripts/sim/seed-staff.ts` first) or no active moo / owner / cgs user exists (the switch needs MoO+).

Check after `--apply` (SQL on the sim):
- `select count(*) from users where email like 'sched-%@sim.invalid'` → 30;
- `select count(*) from toast_employee_links where employee_guid like 'sim-sched-%' and active` → 30, `source = 'manual'`;
- `select count(*) from toast_time_entries where time_entry_guid like 'sim-sched-%' and user_id is not null` → every row
  (the 0233 trigger filled `user_id`);
- `select location_id, enabled, estimated_hourly_cents, estimated_salaried_weekly_cents, agm_access from schedule_shop_settings`
  → both shops `true, 1840, 120000, 'read'` (SIM values; prod: hourly $18.40 default, salaried blank).

Demand: the seed synthesizes no Toast order captures. A shop with no sales history builds the **Normal crew** with
"No sales history — built on the Normal crew. Set the day type if it is wrong." (`schedule.note.no_history`). That is the expected sim state.
Re-running the seed is safe (existing users, links and entries are kept).

## 3. The browser sim walk (CC), at 375 px, once in English and once in Spanish

Chrome device mode, 375 × 812, touch. Sign in as the sim GM (`marcus@sim.co-ops`). Record each step's result in the PR.

| # | Do | Expect |
|---|---|---|
| 1 | Open `/schedule?loc=<shop id>`. | The board, "Week of …"; no sideways page scroll (only the timeline scrolls). |
| 2 | Build next week (Generate). | A week; banners: "Assumed from Toast punches · until availability syncs"; the 1-week / 2-week hires flagged; "No sales history — built on the Normal crew"; starting-point skills shown as bands. |
| 3 | **Drag** (touch): a bar's body, its start edge, its end edge, a segment divider. | Each snaps to 15 min and saves. Drag into an overlap → snaps back with "That overlaps another shift for the same person." (en / es). |
| 4 | **Keyboard**: Tab to a bar; use −15 / +15 and ← / →. | Focus stays on the control; the screen-reader label reads the new time. |
| 5 | **Cancelled step-up**: in the horizon builder, choose a range including the edited week, check "Rebuild this week anyway", Apply, then **cancel** the password. | Nothing changes; the preview stays. Then Apply + the password → the week is rebuilt and "What changed" shows. |
| 5b | The main **Regenerate** on the edited week (chunk F review P2-3). | "You edited this week — rebuilding replaces your edits" → **Keep my edits** posts nothing; **Rebuild this week anyway** → password → rebuilt. Cancel the password → nothing. |
| 6 | **Stale response**: open the same week in two tabs; edit in tab A; then edit in tab B. | Tab B shows "Someone else changed this week — your view is updated", reloads the head, its edit is NOT applied, and the board stays editable. |
| 7 | **Approve** (password). | "Ready for 7shifts — sending comes in a later update". No send control. |
| 8 | `/schedule/settings`: change a structure value, Save → cancel the password. | The draft stays (the 15-minute window not opened). Save + password → saved; "Settings changed — regenerate?" on the board. Collapse a section with a draft and reopen it: the draft is still there. |
| 9 | The cron by hand (below). | `precheck: {"go":true,...}` then one `built` per enabled shop (or `skipped` with a reason). |
| 10 | The two-session `head_moved` check (below). | `PASS`. |
| 11 | `/admin/people-reconcile?loc=<each shop>`. | Every seeded person with Toast ✓, 7shifts "not connected" (until 7shifts is connected); the days read "Against the CO-OPS proposal (not published)" with "No published 7shifts schedule for … — connect 7shifts."; no name matching anywhere. |
| 12 | Money as an AGM (`priya@sim.co-ops`). | The board shows hours, heads and the labor card's heads; no "$" anywhere; "No budget set for this week." without the Set one link. |
| 13 | The budget control as the GM. | "No budget set for this week. Set one" jumps to Hours budget; save a week budget → the strip shows hours vs budget. |

Step 9 (writes on the sim — a generated revision per enabled shop; pick a Wednesday at or after 6 AM ET):

```
npx tsx --conditions=react-server --env-file=.env.sim scripts/sim/run-schedule-draft.ts --now=2026-10-28T10:15:00Z
```

Step 10 (writes one edited revision; needs a built week with a future shift):

```
npx tsx --conditions=react-server --env-file=.env.sim scripts/sim/schedule-lock-check.ts --loc=<shop id> --week=<Monday>
```

Exit 0 = one edit landed, the other was refused `head_moved`, and a late edit on the old head is refused too.

## 4. Prod (CC, on Juan's word)

1. **Rollback dry-run on prod**: in one transaction that ends in `ROLLBACK` (the files' own `begin; … commit;` removed),
   apply 0274 then 0275, run both VERIFY blocks inside it, roll back, then confirm `to_regclass('public.schedule_weeks')`
   and `to_regclass('public.schedule_shop_settings')` are NULL and `claim_cron_route` is still 0268's body.
2. **Apply** 0274 then 0275 (each PRE-FLIGHT first, VERIFY after). Stamp each header `-- APPLIED TO PROD <date>
   (schema_migrations version <v>, name '<name>')` in the same PR or the next one.
3. PR, CI green, merge (Juan clicks).
4. Nothing turns on by itself: no shop has a settings row, so the board says "Scheduling is off for this shop" and the
   Wednesday cron returns `{skipped: "no_enabled_shops"}` with no lease claimed and no heartbeat.

**If something has to come back out:** switching the shop OFF is the operational rollback (the board goes "off", the cron
skips). A schema rollback drops the 0274 / 0275 tables and functions and re-emits 0268's `cron_route_leases_job_check`
and `claim_cron_route` (0275 section 8); no other table was altered.

## 5. Turning a shop on (the MoO, per shop)

1. Review the **schedule structure** with the shop's GM on `/schedule/settings?loc=<shop>` (seeded from the station
   columns; save it: Tier E).
2. Set the **wage estimates** (hourly, salaried weekly) on the MoO's shop card (Tier E). Until then money reads "—".
3. Switch **Scheduling** ON for the shop (same card, Tier E). From then on: the board builds, the Wednesday cron drafts
   that shop's next week at or after 6 AM ET, and `/admin/people-reconcile` compares its people.
4. Optional, per shop: AGM access `read` → `edit` (default read).
