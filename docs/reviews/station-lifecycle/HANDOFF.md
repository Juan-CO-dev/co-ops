# Station lifecycle — build handoff

Plan: add migration 0230 for derived section closure, append-only releases/breaks and advisory times; retain 0228 RPC contracts; connect the board and KH timing controls; run today's labor on the ten-minute pinger; verify unit/type gates and provide a rollback sim harness. CC pre-approved implementation and owns cross-family review and sim verification.

Worktree: `C:/Users/conta/co-ops-stlife`, branch `feat/station-lifecycle`. Tested base HEAD: `9e1b519e610f8344c9e4ebf64c56528906e217cd`. During this build `origin/main` advanced one commit to `3e2b37eb` (#418, ezCater / 0229). No rebase/reset was performed under the no-git-writes instruction; CC must integrate that newer base. All changes are uncommitted. No git writes, push, merge, deployment, environment-file reads, or production operations performed. Migration 0229 remains reserved for ezCater.

## Behavior and implementation anchors

| File:line | Change |
| --- | --- |
| `supabase/migrations/0230_station_lifecycle.sql:8` | Schema preflight before installation; nullable advisory time columns; coherent system-actor CHECKs; deny-all break and departure ledgers. |
| `supabase/migrations/0230_station_lifecycle.sql:88` | `station_closures`: latest non-dropped closing instance for the shop/day, active section items, live non-revoked/non-superseded completions. No duplicated closed-state table. Completion maximum supplies closure time. |
| `supabase/migrations/0230_station_lifecycle.sql:147` | Reconciliation: only current ET day, shared day locks, explicit Toast user links, deleted/future/open-entry guards, timestamp-bounded releases, active task delegation retirement, append-only evidence. A departure ends an existing break. |
| `supabase/migrations/0230_station_lifecycle.sql:188` | Self/KH break writer; shared capacity lock; no task changes; no restore. Completion triggers immediately release closed sections; historical corrections do not mutate old station staffing. |
| `supabase/migrations/0230_station_lifecycle.sql:238` | Existing task and station RPC argument/default contracts preserved; all 0228 body lines retained in order, with lifecycle guards added. Service-role-only execute grants self-check at migration end. |
| `lib/assignments.ts:153` | Break writer: live target validation, location binding, idempotent audit. |
| `lib/assignments.ts:174` | KH advisory timing writer; same-shop position binding, sort > 1 trim guard, explicit zero-row refusal. GM configuration gate preserved. |
| `lib/assignments.ts:389` | Board closure, break, departure and release evidence loading; nullable system actors never enter user lookup as the string `null`. |
| `lib/assignments-lifecycle-shared.ts:4` | Vacancy projection; later cover/movement clears stale vacancy evidence. |
| `lib/assignment-taken.ts:14` | Lifecycle filters historical task-taking before deduplication, so re-clock-in restores nothing but later new work can appear. |
| `lib/assignment-sections.ts:5` | Closed positions excluded from staffing progress. |
| `lib/assignments-shared.ts:44` | Board lifecycle contracts; release actor nullable. |
| `components/assignments/ShiftBoardClient.tsx:51` | Full/compact read-only status, closed/cover/left-open labels and hints; closed slots unavailable. |
| `components/assignments/ShiftBoardClient.tsx:216` | Self/KH break/back controls. Assigned human changes retain existing override dialogue; break is a separate availability operation. |
| `components/assignments/StationsAdmin.tsx:40` | Optional time inputs with 44px controls; Spanish read-only station/position/duty labels and closure time. |
| `app/api/assignments/route.ts:23`, `app/api/admin/stations/route.ts:17` | Typed break and timing API branches. Existing GM operations keep their step-up gate. |
| `app/(authed)/stations/page.tsx:23`, `app/admin/stations/page.tsx:47` | KH hints accessible through `/stations` despite outer `/admin` level-6 gate; admin reuses timing controls. No expansion of general admin access. |
| `lib/toast/labor.ts:88` | Every successful TODAY pull can reconcile after corrections, across pinger/nightly/manual/digest callers. Historical and partial pulls cannot release. |
| `app/api/cron/toast-sales-today/route.ts:33`, `lib/jobs-registry.ts:41` | Reserve up to 30 seconds for labor; share the route deadline; 06–22 ET ten-minute heartbeat monitoring, with nightly backstop. |
| `lib/audit-actions.ts:46`, `lib/destructive-actions.ts:51` | System observations non-destructive; human break/timing changes registered destructive. SQL audit remains fail-open. |
| `lib/i18n/en.json:5230`, `lib/i18n/es.json:5230`, `lib/i18n/format.ts:60` | Matching lifecycle strings and timezone-independent localized wall-clock hints. |

## Verification

- `npm.cmd test`: 357 files passed; 5,732 tests passed, one skipped. First run exposed a stale location-writer test inventory; updated it to cover break, position and timing writes, then reran the full suite.
- `npm.cmd run typecheck`: exit 1, exclusively six permitted Leaflet PNG TS2307 errors in `ZoneMap.tsx:24–26` and `DeliveryRouteMap.tsx:6–8`; no other diagnostics.
- `bash scripts/phase2-discipline-check.sh`: PASS.
- `git diff --check`: PASS (line-ending notices only).
- `tests/station-lifecycle-migration.test.ts`: preserved 0228 RPC signatures/body line order; 3 passed after the final SQL change.
- `tests/station-lifecycle-writers.test.ts`, `station-lifecycle-projection.test.ts`, `station-lifecycle-ui.test.ts`, and `assignment-board-loader.test.ts`: guards, system vacancy projections, no restoration, covers, bilingual hints, and board integration.
- `tests/toast-labor-r2.test.ts`, `toast-capture-route-budget.test.ts`: full-pull ordering, partial/historical refusal, today defaults, fail-soft heartbeat and reserved deadline.
- Fixture capture: 1 passed; four actual-component previews with actual compiled CSS, all zero horizontal overflow. See [fixture previews](FIXTURE-PREVIEWS.md). These are explicitly **not sim screenshots**.
- `scripts/test-station-lifecycle.sql`: authored/read back, **NOT EXECUTED**. No local PostgreSQL/psql/PGlite or sim connection is available. No claim of SQL runtime or concurrency verification.
- `next build`: not run; CC's normal PR/preview CI remains required.

## CC sim checks and rollout

1. Apply **0230** to sim and run `psql -v ON_ERROR_STOP=1 -f scripts/test-station-lifecycle.sql` using the owner connection. Harness requires the sim sentinel and rolls back all fixtures. Check the existing 0228 harness too.
2. Run two-session races: final closing check versus claim; revoke versus claim; break versus cover; task assign versus Toast reconciliation. One shop/day lock is shared. Confirm no double occupancy, no repeated releases and no assignment restoration.
3. Exercise actual 360px EN/ES sessions at employee, KH, manager and read-only levels. Close/uncheck a section; self/KH break without cover; manager self-cover; return to a filled/empty spot; clock out with station/task; re-clock-in; reject cross-shop/above-level writes. Capture sim screenshots.
4. Apply migration before deploying the board code (new columns/RPCs are required). Enable `TOAST_LABOR_PULL=1` for labor and `STATION_LIFECYCLE=1` for reconciliation only after migration and identity links are verified. No flags were set here.
5. **Identity prerequisite:** the current Toast pull does not populate `toast_time_entries.user_id`. CC must establish/verify explicit employee-to-user links for imported entries, including new entries. No name inference or mapping UI was added. Unlinked entries intentionally release nobody. This is a rollout dependency, not verified production wiring.
6. **No seed values:** Juan/managers enter Crunchy Boi ~2 PM, 3rd Party ~4 PM, and Expo/Walk-ins second-position trims. Hints never close positions automatically.

## Review focus / assumptions

QA REVIEW — station lifecycle, uncommitted `feat/station-lifecycle` against tested HEAD `9e1b519e`. Check correctness and completeness; report P1/P2/P3 with file:line and a concrete failure scenario, or no findings. CC owns cross-family review; same-family implementation checks here are not that approval.

- The current task model defines an open delegation as `report_assignments.active=true`; it has no common completed-task state. Clock-out retires that delegation, not the underlying report. Historical implicit “taken” attribution is suppressed using the departure boundary without editing report history.
- A break is an availability action, so self/KH break does not need an assignment override reason. Direct human assignment/reassignment/retraction still uses 0228's rule.
- No automatic staffing trim; advisory times cannot remove people. Station shifts preserve `station_business_date` across midnight; tasks and the requested Toast pull use the ET calendar day.
- Inspect BC-004 authority; BC-007 serialization; BC-008 day boundaries; BC-009 live/deleted predicates; BC-022/025 location binds; BC-023 privileges; BC-040 explicit refusal. Regression CHECK and future-Toast-entry cases are in the SQL harness, but still need execution.
- SQL review fixed NULL CHECK acceptance and a future-open-entry suppression bug. The harness asserts both. Closure SQL is VOLATILE so the AFTER trigger sees the final completion and post-lock state.

## Result

Implementation and local unit/type verification are ready for CC review. SQL sim execution, real interaction screenshots, explicit Toast identity linking and normal CI remain outstanding. Branch/worktree: `feat/station-lifecycle` at `C:/Users/conta/co-ops-stlife`; changes uncommitted.
