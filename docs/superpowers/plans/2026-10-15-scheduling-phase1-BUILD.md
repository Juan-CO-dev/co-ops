# Smart Scheduling — Phase 1 (Foundation) Build Plan

## The 7shifts read sync · the unified people layer · PM reports v2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **No app code is written until Astra APPROVES this plan** (CC's GO, 2026-10-15). After approval, each chunk is reviewed by Astra and gated by CC.

**Revision r0 (2026-10-15).** First draft by CO Claude (planner seat) for Astra's cross-provider review.

**Goal:** Build the foundation that Phase 2's scheduler will stand on, and make it useful from day one:
1. **A 7shifts read sync.** It polls with a company access token and stores raw facts as upsert-by-7shifts-id mirrors, plus an append-only sync ledger. It respects 10 req/s and 600 req/min, follows cursors, and matches a person across systems ONLY through a link a manager confirms. Without the token it stays dormant and shows a clear "Not connected" state.
2. **One people layer.** My Performance, team scoring, the public profile and the new skills all read ONE fact loader and ONE set of pure rules. Skills are learned per **station position** from attributed facts and show their evidence. A manager can adjust a skill per position (recorded, audited, shown), and a new hire starts from the manager's rating. **An equivalence pin freezes today's numbers first**, and they stay byte-identical until a new input is switched on.
3. **PM reports v2.** Each manager on shift fills in their own copy, and nobody sees another manager's copy until the closing manager submits. Each person is evaluated per station position they actually worked (from station events), with criteria per position plus free text. After submit, the copies sit side by side with names on them, scores are averaged per person × position × criterion weighted by observation time, write-ins are surfaced, and recurring themes are pulled forward. The results feed the people layer.

Every string ships in en + es (tú). Every surface is phone-first (375 px, 44 px controls) and follows the disclosure doctrine. **No email, SMS or in-app notification is sent by anything in this phase** (house rule before launch).

**Architecture:**
- **Read surfaces over new workflows.** Skills are computed at READ time from facts that are already captured (station events, checklist completions, prep batches, PM evaluations), through one batch loader and pure rules. No nightly materialization, no second store of "the score". The only new human inputs are a manager adjustment, a manager rating for new hires, the PM v2 copies, and the 7shifts links.
- **7shifts is a mirror, never a source of identity.** Raw rows are keyed by the 7shifts id (`bigint`), upserted, and never deleted (7shifts' own `deleted` flag is kept). A 7shifts user means nothing in CO-OPS until a manager links it to a CO-OPS user. The link is joined at READ time, so an unlink takes the attribution away at once, with no backfill to undo.
- **One loader, pure rules, wrappers keep their names.** `lib/team-metrics.ts` keeps its exports (`loadTeamOperatingHealth`, `loadPersonDetail`, `loadMyPerformance`, `loadPersonReportLocations`, `TEAM_VIEW_LEVEL`) so pages and `report-export` do not move. Their bodies become: access check (`lib/people/access-shared.ts`), then `loadPeopleFacts` (`lib/people/facts.ts`), then pure computation (`lib/people/performance-shared.ts`). `lib/profiles.ts` goes the same way. **The legacy numbers are a function of the legacy inputs only.** New inputs (PM v2 grades, skills) enter through `PeopleInputs`, which is per shop and OFF by default.
- **PM v2 reuses the day row.** `pm_reports` stays the one row per (shop, day) and gains `format ('v1'|'v2')`, set when the row is created. On a v2 day each manager has a `pm_report_copies` row. Grades and notes are append-only with supersede, written by SECURITY DEFINER RPCs that lock the copy and the day row, which closes v1's acknowledged non-atomic eval-write window. Submit is one RPC: a guarded open → submitted flip that seals every copy. The finalization and MVP scoring of v1 therefore keeps working unchanged on v2 days.
- **Permissions live in the lib, and the database is deny-all.** Every new table has RLS on with no user policies, a service-role privilege CEILING (0257 pattern) and pinned definer functions. Location bind and role rules are pure functions in `lib/people/access-shared.ts`, called before any I/O.

**Tech Stack:** Next.js 16.2.4 App Router (page `params`/`searchParams` are Promises), React 19.2.4, TypeScript strict + `noUncheckedIndexedAccess`, Tailwind v4 tokens, Supabase (service role), vitest 4 (node env; UI tests render with `react-dom/server`), PGlite (`@electric-sql/pglite`) for migration harnesses.

**Spec:** `docs/superpowers/specs/2026-10-15-smart-scheduling-design.md` — §2 (7shifts API), §4.1–4.3 (people layer, PM v2), §5.7 (tunable structure; Phase 1 only stores the facts it will need), §8 (the 7shifts loop, read half), §9 Phase 1, §10 (open items).

**Mockup:** `C:\co\CO-CHIEF\05-BRIDGE\from-cc\2026-10-15-schedule-board-mockup.html` (CC put it on the bridge as a local file, title "Schedule Board"; the same page as the claude.ai artifact named in the spec). It shows UI INTENT with sample data, and the board itself is Phase 2. The section "The mockup: what is Phase 1, what waits" below maps its parts.

**Working copy:** a worktree on a branch from `origin/main` (2da88061 at planning time). Re-check the migration number before Task 5:

```bash
git fetch origin && git checkout -b feat/scheduling-phase1 origin/main
ls supabase/migrations | tail -3   # expect ≤ 0266; Catalog Phase 4 owns 0264–0266. This plan uses 0267–0270.
```

**Standing rules for every task:**
- Read `AGENTS.md` first (the law-book); re-read every file a task names before editing it (confirm-before-authoring).
- TDD: the failing test first, then the code, then green. Pure modules (`*-shared.ts`) before loaders, and loaders before UI.
- **The equivalence pin stays green from Task 1 to the end:** `npx vitest run tests/people-layer-equivalence.test.ts`.
- Migrations are AUTHORED only. Each has a PGlite harness `scripts/sql-harness-02NN.mjs` and a CI pin `tests/<name>-migration.test.ts`. CC owns sim apply; Juan owns the prod word.
- Every new string ships en + es (operational tú). Every control is at least 44 px with `items-center`. Token roles only. Disclosure state is `useState` only.
- Never key logic on location codes (`EM` = P Street, `MEP` = Capitol Hill, crossed). Use location ids, and names only for display.
- No email, SMS or notification is enqueued anywhere in this phase (`enqueueNotification` is never called from new code; pinned in Task 21).
- Customer contact data never enters this phase. Staff personal data from 7shifts is dropped in the pure normalizer BEFORE any write: email, phones, birth date, tips, punch notes, availability and time-off comments/reasons. Error records carry fixed codes, never payloads or URLs.
- Commit per step (`wip(sched-p1): …`). Each commit ends with the trailers CC gives the builder.

---

## Ground truth this plan is built on (verified 2026-10-15 against `origin/main` @ 2da88061)

| Fact | Where | What the plan does with it |
|---|---|---|
| Latest migration on main is **0263** (0256 is an unused gap; 0264–0266 reserved for Catalog Phase 4) | `supabase/migrations/` | Phase 1 uses **0267, 0268, 0269, 0270**. Task 5 re-checks. |
| `station_events` is append-only (0217): `location_id, business_date, user_id, station_id, position_id (0219), kind assign/claim/move/release, actor_id (nullable since 0230), at, source, reason_code (0228/0230/0233), effective_at`. Service role SELECT + INSERT only. | 0217, 0219, 0228, 0230, 0233 | Position intervals come from it (pure `positionTimeline`, Task 3). Read only. |
| `station_positions` (0219): per shop (`location_id`), per station, `name`/`name_es`, `sort`, `active`; seed 42 names Walk-ins, Walk-ins / Online, Expeditor, Register & Delivery; every other station gets one default position named after it. Trims: `station_positions.usually_trims_at` (0230), `stations.trims` jsonb (0238). | 0219, 0230, 0238, `docs/seed/seed-42-stations.sql` | **"Position" in this plan = a `station_positions` row.** Skills, PM criteria and adjustments key on `position_id`, which is shop-scoped by construction. |
| `stationTimeline()` exists but is per STATION, not per position, and ignores `effective_at` | `lib/assignments-shared.ts:205` | A new pure `positionTimeline()` sits beside it (Task 3). The existing function is untouched. |
| Break releases are station events with `reason_code 'on_break'`; departures and closures release with `effective_at` (0230) | 0230 | An interval ends at `coalesce(effective_at, at)` of the next event for that person and day. |
| `assignment_changes` (0228) is the append-only task-assignment ledger; `report_assignments` carries assigner/assignee | 0228 | Used as evidence only ("assigned X 4 times"). It does not enter the skill math in Phase 1 (judgment J7). |
| `productions.made_by` + `prep_batch_sessions.made_by/produced_at` (0215), applied to prod 2026-10-07. A maker is recorded only for **batch-mode** recipes (`recipes.batch_mode` default false). | 0215 | Prep evidence counts batches the person made and yield vs recipe. The evidence line says so when a shop has no batch-mode recipes ("no maker recorded yet"); nothing is inferred. |
| `toast_employee_links` (0233) auto-links on an exact full-name match | 0233 | **Not copied.** 7shifts links are manual only (GO law). |
| `toast_time_entries` holds no wages by design (0224) | 0224 | 7shifts wages go to their own table with no reader in Phase 1 (judgment J4). |
| `pm_reports` (0072): one live row per (shop, day), status `open/submitted/incomplete_confirmed/auto_finalized`, `mvp_user_id`, `submitted_by`; user UPDATE dropped (0106). `pm_employee_evals` (0072/0073): four gradients `great/good/needs_work` + `area_to_improve` + `note`, supersede pattern. | 0072, 0073, 0106 | v2 keeps the day row (adds `format`). v1 tables are untouched. |
| **Existing exposure (not fixed here, flagged):** `pm_evals_read_self` (0072) lets an employee read their own `pm_employee_evals` rows through PostgREST with a staff JWT, **including `note`** (the KH+-only column). The note-hiding is app-layer only. | 0072 | Out of scope. Reported to CC as a finding. The new v2 tables are deny-all, so v2 notes are not reachable this way. |
| `lib/team-metrics.ts`: `TEAM_VIEW_LEVEL = 6` (so **social_media_mgr, level 6, can open team scoring today**), `RANKED_MAX_LEVEL = 8`, the oversight location bind, `computePersonMetrics` shared by detail + self | `lib/team-metrics.ts` | Refactor onto `lib/people/*` (Tasks 11–13). The SMM refusal is a deliberate tightening (Task 13). |
| `lib/profiles.ts` `loadPublicProfile` reads completions, MVP and gradients company-wide (no location bind on facts) | `lib/profiles.ts` | Moves onto the same loader with its current semantics frozen in the golden. Its company-wide scope is kept: it is the public card, not a performance view. |
| `lib/people-narrative.ts` returns i18n keys; `myPerformanceRead` is positive-only | — | Unchanged. The self skills view inherits the positive-only rule (bands, never ranks). |
| Toast labor pull: fixed error codes, one `AbortSignal` deadline over every await, fail-soft per shop, heartbeat audit `cron.success/cron.failure` with `job` | `lib/toast/labor.ts` | `lib/sevenshifts/sync.ts` copies this shape. |
| Cron lease `claim_cron_route(p_job)` with a CHECK on the job list | 0243, `lib/cron-route-lease.ts` | 0267 re-emits the function and CHECK with `'sevenshifts-sync'` added (line-subsequence pin). |
| `JOBS_REGISTRY` feeds `job-watch`, which **emails** an ops alert on a missing heartbeat | `lib/jobs-registry.ts` | **Not registered in Phase 1** (no-email rule, and a dormant job would alert on day one). Sync health is shown on the 7shifts screen from the ledger. Open question Q6. |
| `/admin/toast-employees` is the existing link screen (GM own shop, MoO+ all) | `app/admin/toast-employees`, `components/admin/toast-employees/ToastEmployeeLinks.tsx` | `/admin/sevenshifts` follows its layout and gates. |
| Fake PostgREST (`tests/fixtures/counts-fake-db.ts`), recording client (`tests/loader-schema-check.test.ts`), PGlite harnesses (`scripts/sql-harness-0263.mjs`) and migration pins (`tests/menu-item-shop-migration.test.ts`) | tests, scripts | Reused as patterns for the golden, the schema check and the four harnesses. |
| Audit vocabulary is closed (`AuditAction`) | `lib/audit-actions.ts`, `lib/destructive-actions.ts` | Every new action is registered in the task that first emits it (list in Task 4 Step 5 and per task). |
| `/pm-report` gate: KH+ (`PM_REPORT_BASE_LEVEL = 4`), `lockLocationContext`, `canDoOperationalTask(…, "pm_report")`; roster = `pmPresenceRoster(board)` | `app/(authed)/pm-report/page.tsx`, `lib/pm-report-shared.ts` | v2 keeps the same outer gates and the same roster source, plus people with a position interval. |
| v1 `submitPmReport` **enqueues a SHIFT_FEEDBACK notification** | `lib/pm-report.ts` | v2 submit enqueues nothing (no-notification rule). v1 is untouched; a v1 day behaves as today. |

### 7shifts API facts (developers.7shifts.com, read 2026-10-15; no live call was made)
- Base `https://api.7shifts.com/v2`. `Authorization: Bearer <token>`. Every call sends `x-api-version` (current docs value **`2026-01-01`**, pinned in one constant).
- Company-scoped paths `GET /v2/company/{company_id}/…`. `GET /v2/whoami` gives the identity (and company).
- **Cursor pagination:** `limit` (1–500, default 100; punches default 20) + `cursor`. Follow `meta.cursor.next` until it is null.
- **Rate limits** (spec §2): 10 req/s and 600 req/min. Handle `429` with backoff.
- Paths: `users` (`status`, `modified_since` YYYY-MM-DD; the payload carries email, phones, birth date and wage, which we DROP) · `users/{id}/assignments` (also per-location / per-role list endpoints) · `users/{id}/wages` (`current_wages` / `upcoming_wages`: `wage_type hourly|weekly_salary|annual_salary`, `wage_cents`, `role_id`, `effective_date`) · `roles` · `departments` · `locations` · `availabilities` (`week_gte`, `repeating`; **min plan "The Works"**) · `time_off` · `shifts` (`start[gte|lte]`, `include_deleted`, `include_draft`, `modified_since`; fields `id, user_id, role_id, station_id, department_id, location_id, start, end, draft, open, deleted, modified`) · `time_punches` (`clocked_in[gte|lte]`, `modified_since`, `deleted`; it also carries `hourly_wage`, `tips`, `notes`, which we DROP) · `labor_settings` (OT thresholds and multipliers).
- **Stations:** shifts carry `station_id`, but the docs list **no stations endpoint**. Phase 1 stores `station_id` as a bare id. The station names/mapping wait for the spec §8 mapping screen (Phase 2), after the read-only look at CO's setup (spec §10).
- **Plan tiers differ per endpoint** (users: Entrée; availabilities: The Works; labor settings: a tier named in the docs). A `403` on one resource is recorded as `plan_forbidden` for that resource, and the rest of the run continues (Q2).
- Task 6 Step 1 re-reads each reference page and fixes any path or parameter that moved, in ONE table (`SEVENSHIFTS_ENDPOINTS`). Read-only, no token needed.

---

## The secret, the switches, the "Not connected" state

| Env var | Who sets it | Meaning |
|---|---|---|
| **`SEVENSHIFTS_ACCESS_TOKEN`** | **Juan only** (Vercel dashboard, Production + Preview as he chooses). CC and builders never set, read, print or log it. | The company access token from 7shifts Developer Tools. Absent → dormant. |
| `SEVENSHIFTS_SYNC` | CC, set to `1` AFTER 0267 + 0268 are applied (the `TOAST_LABOR_PULL=1` precedent) | The cron route and Sync now run only when `=1`. This keeps a deploy safe before the migrations land. |

`lib/sevenshifts/config.ts` exports `sevenShiftsStatus(): { state: "not_connected" | "sync_off" | "ready"; reason: "token_missing" | "sync_off" | null }`. It never returns the token, its length or a prefix. The 7shifts screen and every people surface that would use 7shifts facts render one plain line from it:
- `token_missing` → **"7shifts is not connected yet. Juan adds the access token; nothing is read until then."** / **"7shifts aún no está conectado. Juan agrega el token de acceso; no se lee nada hasta entonces."**
- `sync_off` → "7shifts is connected, but syncing is switched off." / "7shifts está conectado, pero la sincronización está apagada."
- `ready` → the last run from the ledger: "Last synced 2:14 PM · 9 of 10 parts OK · Time off needs a higher 7shifts plan".

The company id is NOT a second secret. Each run calls `whoami` once and uses the company it returns; if the token sees more than one company, the run refuses with `company_ambiguous` (Q2).

---

## Permissions (all in `lib/people/access-shared.ts`, pure, called before any I/O)

`LEVEL`: owner 9, MoO 8, GM 7, AGM / catering_mgr / prep_mgr / social_media_mgr 6, SL 5, KH / trainer 4, employee 3. Location bind = the person's `user_locations` (level 9+: all). "Op-6" = `agm`, `catering_mgr`, `prep_mgr` (level 6 **minus** `social_media_mgr`).

| Act | Rule |
|---|---|
| Team scoring, person detail, skills of others (read) | Op-6 or GM, own shops only. MoO (8)+ any shop. **`social_media_mgr` refused by ROLE** (the `catalogWriteRoleAllowed` precedent). Below 6: never. Keeps today's AGM-level access for the operational roles (J1; Q7 asks Juan whether to narrow it to GM). |
| My Performance / my skills / my feedback | Self only; the person always comes from the session, never a param (today's rule). Skills appear as a band (Building / Solid / Strong) with evidence. No number, no rank, no manager adjustment amount (J3; Q8). |
| Manager adjustment / new-hire rating (write) | GM (7) own shop, MoO (8)+ any shop. The actor must outrank the subject (`canActOn`), so a GM cannot adjust a GM. A reason code is required (`coverage_change`-style closed list: `observed_on_floor`, `training_completed`, `correction`, `other` + note). |
| People shop settings (PM v2 switch, prep evidence position) | GM own shop, MoO+ any. Audited. |
| PM criteria editor | GM own shop, MoO+ any. Audited. |
| 7shifts shop links | MoO (8)+ (company-level config). |
| 7shifts person links | GM own shop (the CO-OPS user must hold an active membership there), MoO+ any. Actor ≥ subject level. |
| 7shifts status + Sync now | Status: GM+ and Op-6 own shop. Sync now: MoO+ (it spends the shared rate budget). |
| **Wages** (`sevenshifts_wages`) | **No reader in Phase 1.** The status line shows a COUNT only ("wages for 31 people"). No individual rate appears on any surface, export or log. Phase 2 decides who sees what (Q5; recommendation in J4). |
| PM v2 copy: write | KH+ with pm_report task access at the shop today (today's `requirePmTask`), not SMM, and only their OWN copy, only while it is open and the day is open. |
| PM v2 copy: read BEFORE submit | **Its author only.** Nobody else, MoO and Owner included (blind by design, so the average is independent). Others see COUNTS only ("2 copies started"). |
| PM v2 day: read AFTER submit | That day's copy authors; GM / Op-6 of that shop; MoO+ any shop. Not SMM. Not other KH/SL of the shop (J9). |
| PM v2 feedback: the subject | Their own averaged grades per position and criterion, as bands, from SUBMITTED days only, without author names and without free text (J10; Q9). |
| Submit the day (= closing manager) | Today's v1 rule: KH+ with pm_report task access, not SMM. The submitter is recorded as the closing manager. |

---

## Migrations (authored only; each with a PGlite harness + CI pin)

| # | File | Tables / functions | Kind | service_role ceiling |
|---|---|---|---|---|
| 0267 | `0267_sevenshifts_sync.sql` | `sevenshifts_sync_runs` (ledger) | append-only | SELECT, INSERT |
| | | `sevenshifts_sync_state` (resource watermark, one row per resource) | config/state | SELECT, INSERT, UPDATE |
| | | `sevenshifts_locations`, `sevenshifts_departments`, `sevenshifts_roles`, `sevenshifts_users`, `sevenshifts_user_assignments`, `sevenshifts_availabilities`, `sevenshifts_time_off`, `sevenshifts_shifts`, `sevenshifts_time_punches`, `sevenshifts_wages`, `sevenshifts_labor_settings` | provider MIRRORS, upsert by 7shifts id, never deleted | SELECT, INSERT, UPDATE |
| | | re-emit `claim_cron_route(text)` + `cron_route_leases_job_check` with `'sevenshifts-sync'` | function | EXECUTE service_role only |
| 0268 | `0268_sevenshifts_links.sql` | `sevenshifts_location_links`, `sevenshifts_user_links` (append-only; unlink = `active=false`) | append-only by grant | SELECT only (writers are definer RPCs) |
| | | `link_sevenshifts_location`, `unlink_sevenshifts_location`, `link_sevenshifts_user`, `unlink_sevenshifts_user` | SECURITY DEFINER, `search_path = pg_catalog, public`, service_role only | — |
| 0269 | `0269_people_layer.sql` | `people_shop_settings` (one row per shop) | config | SELECT, INSERT, UPDATE |
| | | `people_skill_adjustments`, `people_skill_ratings` | append-only | SELECT, INSERT |
| 0270 | `0270_pm_reports_v2.sql` | `pm_reports.format` (new column, default `'v1'`) | additive | (existing grants) |
| | | `pm_criteria` | config (deactivate, never delete) | SELECT, INSERT, UPDATE |
| | | `pm_report_copies` | one row per manager per day; status `open → done → sealed` | SELECT only (RPC writers) |
| | | `pm_copy_positions`, `pm_copy_grades`, `pm_copy_notes` | append-only with supersede | SELECT only (RPC writers) |
| | | `open_pm_copy`, `save_pm_copy_grade`, `save_pm_copy_note`, `add_pm_copy_position`, `set_pm_copy_window`, `mark_pm_copy_done`, `submit_pm_day_v2` | SECURITY DEFINER, pinned, service_role only | — |

Every table: `enable row level security`, NO user policies (the 0257/0203 posture), `revoke all … from public, anon, authenticated, service_role`, then the exact grant, then a `do $$` guard that raises if any of `anon`/`authenticated`/`PUBLIC` holds anything or `service_role` holds DELETE/TRUNCATE/REFERENCES/TRIGGER, or lacks a needed privilege. Every function: `revoke all … from public, anon, authenticated` plus `grant execute … to service_role`, with an `information_schema.routine_privileges` guard. Sequences: revoked from the PostgREST roles.

---

## The mockup: what is Phase 1, what waits

| Mockup part | Phase | Phase 1 shape |
|---|---|---|
| "Staff skills, work types, days off, and soft hours": per position a bar 0–1, caption "Worked data: stations, tasks, prep · manager adjustment optional", a ± adjustment in 0.05 steps clamped to ±0.30 | **Phase 1 (skills + adjustment only)** | The person's **Skills** section on `/reports/trends/team/[personId]`: one row per position worked (bar + value + "Manager adjustment +0.10" chip + evidence lines in a drawer + an Adjust control with the same step/clamp, reason required). Work types, days off, flex day and soft hours are Phase 2 (§5.1, §5.5), so they are NOT built. |
| Default skill when no data (mockup 0.5; management 0.7; Prep/Dishwasher 0.65) | Phase 1 | The PRIOR in the skill model is the manager's rating, else a neutral 0.5. The mockup's role-based defaults are not adopted (they are sample data; J5). |
| "close" pseudo-skill ("closes on time 96%") | Phase 1 as **evidence**, Phase 2 as a skill | "Closing on time" shows as an evidence line on the person's profile. A Closing Manager skill waits for the Phase 2 role. |
| Positions list (Crunchy Boi Station, 3rd Party Station, Walk-ins, Walk-ins / Online, Expeditor, Register & Delivery, Prep, Prep/Dishwasher) | Data | Read from `station_positions`. **Prep and Prep/Dishwasher are positions only if the shop has them as station positions** (Q3); the plan adds none. |
| Week board, timeline, coverage, demand curve, budget suggestion, Regenerate, Out sick, Add to schedule, Leader shifts, staffing recommendation, Schedule structure settings | **Phase 2 / 3** | Not built. Phase 1 stores the 7shifts facts they will need (published shifts, punches, availability, time off, labor settings, wages). |
| "Send to 7shifts as draft" / "does not contact 7shifts" | **Phase 3** | Not built. Phase 1 has NO write path to 7shifts; the client exposes GET only (pinned in Task 6). |
| A 7shifts connection state | Phase 1 | `/admin/sevenshifts` + the status line above. |
| PM report copies | Not in the mockup | Designed from spec §4.3 (Tasks 20–21). |

---

## File Structure

**New — 7shifts**
- `lib/sevenshifts/config.ts` — `sevenShiftsStatus()`, `syncEnabled()`; the ONLY reader of the env vars.
- `lib/sevenshifts/endpoints-shared.ts` — `SEVENSHIFTS_API_VERSION`, `SEVENSHIFTS_ENDPOINTS` (path builders + param sets per resource).
- `lib/sevenshifts/rate-limit-shared.ts` — pure dual token bucket (per-second + per-minute) with an injected clock.
- `lib/sevenshifts/paginate-shared.ts` — pure cursor follower (`nextCursor(meta)`, page cap).
- `lib/sevenshifts/normalize-shared.ts` — pure normalizers per resource → minimal rows (PII dropped).
- `lib/sevenshifts/client.ts` — server-only GET client: fetch injected, bearer header, version header, limiter, 429/Retry-After backoff, deadline, typed `SevenShiftsApiError` with fixed codes. **No method other than GET exists.**
- `lib/sevenshifts/sync.ts` — `runSevenShiftsSync({ trigger, deadlineMs, now })`: whoami → resources in a fixed order → upserts → one ledger row → one heartbeat.
- `lib/sevenshifts/links-shared.ts` / `lib/sevenshifts/links.ts` — link rules, link/unlink lib over the RPCs, `loadLinkScreen`.
- `lib/sevenshifts/facts.ts` — read helpers the people layer uses (linked punches per shop/day). Phase 1 uses punches as presence EVIDENCE only.
- `app/api/cron/sevenshifts-sync/route.ts` — hourly cron.
- `app/api/admin/sevenshifts/route.ts` — POST link/unlink/sync-now.
- `app/admin/sevenshifts/page.tsx`, `components/admin/sevenshifts/SevenShiftsScreen.tsx`.

**New — people layer**
- `lib/people/access-shared.ts` — every permission rule above (pure).
- `lib/people/inputs-shared.ts` — `PeopleInputs` (`{ pmV2: boolean }`) and `LEGACY_INPUTS`.
- `lib/people/facts-shared.ts` — fact row types.
- `lib/people/facts.ts` — `loadPeopleFacts(service, scope)`: the ONE batch loader (queries moved verbatim from team-metrics/profiles, plus the new fact families, each loaded only when its input or view asks for it).
- `lib/people/performance-shared.ts` — pure `teamWindow(facts, …)`, `personMetrics(facts, …)`, `publicProfile(facts, …)`: the bodies moved out of team-metrics/profiles.
- `lib/people/positions-shared.ts` — pure `positionTimeline(events)`, `overlapMinutes(a, b)`, `positionsWorked(intervals, day)`.
- `lib/people/skills-shared.ts` — pure skill model + evidence lines + bands.
- `lib/people/skills.ts` — `loadSkills`, `adjustSkill`, `rateNewHire` (lib-gated, audited).
- `lib/people/settings.ts` — `loadPeopleShopSettings`, `savePeopleShopSettings`.
- `components/people/SkillsSection.tsx`, `components/people/MySkills.tsx`.
- `app/api/people/skills/route.ts`, `app/api/people/settings/route.ts`.

**New — PM v2**
- `lib/pm-report-v2-shared.ts` — pure: grade values, weighted averages, write-in themes, copy visibility, view models.
- `lib/pm-report-v2.ts` — copies, writes through the RPCs, submit, loaders for the copy and the after-submit day.
- `lib/pm-criteria.ts` — criteria CRUD (deactivate, never delete).
- `app/api/pm-report/v2/route.ts`, `app/api/pm-criteria/route.ts`.
- `components/pm-report-v2/PmCopyForm.tsx`, `components/pm-report-v2/PmDayResults.tsx`, `components/pm-report-v2/PmCriteriaEditor.tsx`.
- `app/(authed)/settings/pm-criteria/page.tsx`.
- `scripts/seed-pm-criteria.ts` — loads the criteria Juan confirms (dry run by default; `pathToFileURL` guard).

**New — tests and harnesses**
- `tests/fixtures/people-layer-fixture.ts`, `tests/fixtures/people-layer-harness.ts`, `tests/fixtures/people-layer-golden.json`, `tests/people-layer-equivalence.test.ts`.
- `tests/people-access.test.ts`, `tests/people-positions.test.ts`, `tests/people-skills.test.ts`, `tests/people-loader-schema-check.test.ts`.
- `tests/sevenshifts-rate-limit.test.ts`, `tests/sevenshifts-paginate.test.ts`, `tests/sevenshifts-normalize.test.ts`, `tests/sevenshifts-client.test.ts`, `tests/sevenshifts-sync.test.ts`, `tests/sevenshifts-links.test.ts`, `tests/sevenshifts-screen-ui.test.ts`.
- `tests/pm-report-v2-shared.test.ts`, `tests/pm-report-v2.test.ts`, `tests/pm-report-v2-ui.test.ts`, `tests/pm-report-v2-no-notify.test.ts`.
- `tests/sevenshifts-sync-migration.test.ts`, `tests/sevenshifts-links-migration.test.ts`, `tests/people-layer-migration.test.ts`, `tests/pm-reports-v2-migration.test.ts`.
- `scripts/sql-harness-0267.mjs` … `0270.mjs`, `tests/fixtures/scheduling-pglite-stub.sql` (stub base tables: `users`, `locations`, `user_locations`, `stations`, `station_positions`, `station_events`, `pm_reports`, `audit_log`, `cron_route_leases`, copied from their real migrations' column lists).

**Modified**
- `lib/team-metrics.ts`, `lib/profiles.ts` — thin wrappers over `lib/people/*` (exports and signatures unchanged).
- `lib/pm-report.ts` — `getOrCreatePmReport` stamps `format` from the shop setting; v1 writers refuse a v2 day (`format_mismatch`).
- `app/(authed)/pm-report/page.tsx` — chooses v1 or v2 by the day row's `format`.
- `app/(authed)/my-feedback/page.tsx` — adds "My skills" and v2 feedback.
- `app/(authed)/reports/trends/team/[personId]/page.tsx` — adds the Skills section.
- `app/(authed)/reports/trends/page.tsx`, `…/team/page.tsx` — the SMM refusal through `canViewPeople`.
- `lib/audit-actions.ts`, `lib/destructive-actions.ts`, `lib/i18n/en.json`, `lib/i18n/es.json`, `vercel.json`, `.env.local.example`, `AGENTS.md`, `docs/guides/manager-guide.md`.

---

# Chunk A — Freeze first, then the pure foundations (Tasks 1–4)

Each task stands alone. After Chunk A, today's numbers are frozen and the pure modules exist with no caller.

## Task 1: THE EQUIVALENCE PIN — freeze today's numbers before anything moves

**Files:** create `tests/fixtures/people-layer-fixture.ts`, `tests/fixtures/people-layer-harness.ts`, `tests/fixtures/people-layer-golden.json`, `tests/people-layer-equivalence.test.ts`.

- [ ] **Step 1: The fixture** (`buildPeopleLayerFixture()`): two shops `LOC_A`, `LOC_B` (ids only, never codes), with:
  - one person active at BOTH shops, including oversight rows at each shop (the 2026-08-29 bind);
  - an employee, a trainer, a KH, a SL, an AGM, a GM, a `social_media_mgr`, a MoO, plus a deactivated user and a user whose membership is inactive;
  - `checklist_instances` across 70 days (some dated before the window, with completions inside it), `checklist_completions` with duplicates per (instance, item), superseded, revoked, notes and blank notes;
  - `confirmed_by/at` finalizations on- and off-day; `cash_reports` (signed, superseded, over/short notes);
  - `pm_reports` in every status (one superseded), MVPs, and `pm_employee_evals` with all three gradients plus superseded rows;
  - `audit_log` oversight rows for all five actions, including one unattributable row;
  - `user_locations`, `users` (`created_at`, `profile_blurb`, email/phone on a leader), `locations`;
  - and, so that Task 23 can prove the "switch off ⇒ identical" half, rows in the NEW tables too (`station_events`, `pm_report_copies`, `pm_copy_grades`, `people_skill_adjustments`). Today's loaders never read them; after the refactor they must still not change any legacy number.
- [ ] **Step 2: The harness** (`computePeopleOutputs(api, fixture)`) calls, with `today = "2026-10-14"`:
  - `loadTeamOperatingHealth` for LOC_A and LOC_B × granularity `day|week|month` × `compare true|false`, plus one explicit custom `range`;
  - `loadPersonDetail` for every rankable person × both shops × `compare true|false`;
  - `loadMyPerformance` for every person × both shops;
  - `loadPersonReportLocations`;
  - `loadPublicProfile` for staff and a leader, from a viewer with one shop and from an "all" viewer;
  - `loadProfileDirectory`;
  - `loadMyFeedback`;
  - the team section `lib/report-export.ts` builds (through its exported builder, or by calling `loadTeamOperatingHealth` with the export's exact arguments if the builder is not exported).

  Viewers are AGM, GM and MoO. (**SMM is NOT in the golden.** Its refusal is a deliberate change, pinned separately in Task 13.) The output is a plain JSON object keyed by call.
- [ ] **Step 3: The test** mirrors `tests/shop-versions-equivalence.test.ts`: `vi.mock("@/lib/supabase-server")` → `createFakeDb(fixture).client`; `UPDATE_PEOPLE_LAYER_GOLDEN=1` writes the golden. Header comment: "Regenerate ONLY in Task 1 or with a written reason in the PR."
- [ ] **Step 4:** If `createFakeDb` lacks a builder method the loaders use (e.g. `select(…, { count: "exact", head: true })` in `loadPublicProfile`), extend the fake minimally, test the extension in `tests/counts-fake-db.test.ts` (or beside it), and say so in the commit.
- [ ] **Step 5:** Generate the golden with TODAY's code (no `lib/` file touched in this commit), then run the test without the env var: PASS. Commit the golden ALONE: `test(people): freeze the people-layer golden before the refactor`.

**Why it is safe:** the golden is produced by unmodified loaders on synthetic rows. Every later task runs it, and any drift fails CI.

## Task 2: Permissions, pure (`lib/people/access-shared.ts`)

**Files:** create `lib/people/access-shared.ts`, `tests/people-access.test.ts`.

- [ ] **Step 1 (tests first):** a table-driven test over every role × {own shop, other shop, no shop} × act, for each function:
  - `canViewPeople(actor, locationId)` (refuses `social_media_mgr` at every location; Op-6/GM own shop; 8+ any);
  - `canAdjustSkill(actor, subject, locationId)` (GM own / 8+ any, `canActOn`);
  - `canEditPeopleSettings`, `canEditPmCriteria`;
  - `canManageSevenShiftsShops` (8+);
  - `canLinkSevenShiftsUser(actor, subjectLevel, subjectLocations, locationId)`;
  - `canSyncNow` (8+);
  - `canReadPmCopy(actor, copy, day)`, implementing the matrix above. `copy.authorId === actor.userId` → true; before submit → false for everyone else; after submit → authors of that day, GM/Op-6 of the shop, 8+;
  - `canWritePmCopy(actor, copy, day)` (author, copy open, day open, not SMM);
  - `canSubmitPmDay(actor)` (not SMM; the task-access check stays in the lib's I/O half).

  `actor` is `{ userId, role, level, locations: readonly string[] }`, never a JWT.
- [ ] **Step 2:** implement. No `lockLocationContext` for MoO reads: level 8 reads every shop (`canReadReportLocation` semantics), while writes below 9 stay bound to own shops unless the row says 8+ (written explicitly per function, never inherited by accident).
- [ ] **Step 3:** green. Commit.

## Task 3: Position intervals and observation overlap, pure (`lib/people/positions-shared.ts`)

**Files:** create `lib/people/positions-shared.ts`, `tests/people-positions.test.ts`.

```ts
export interface PositionInterval { locationId: string; businessDate: string; userId: string;
  stationId: string; positionId: string | null; start: string; end: string | null; source: "assigned" | "claimed"; }
/** Half-open; an interval ends at the next event's coalesce(effectiveAt, at) for the same (shop, day, person).
 *  A 0217-era event with positionId null stays null (the "position unknown" bucket), never guessed. */
export function positionTimeline(events: readonly StationEvent[]): PositionInterval[];
/** Clip open intervals to `closeAt` (the business day's end or "now"), never past it. */
export function closeOpenIntervals(iv: readonly PositionInterval[], closeAt: string): PositionInterval[];
export function overlapMinutes(a: { start: string; end: string }, b: { start: string; end: string }): number;
/** Distinct positions a person held that day, with minutes, in first-held order. */
export function positionsWorked(iv: readonly PositionInterval[], userId: string): Array<{ positionId: string | null; stationId: string; minutes: number }>;
```

- [ ] **Step 1 (tests):** a claim then a move (same station, other position) → two intervals. A break release (`reason_code on_break`) ends the interval and the next claim opens a new one. A `clocked_out` release with `effective_at` earlier than `at` ends at `effective_at`. Sequence order wins over `at` ties. Intervals never cross (shop, day). An open interval is clipped by `closeOpenIntervals`. Overlap is 0 for disjoint ranges and correct across DST (instants, not wall time). A 0217 event without a position stays `positionId: null`.
- [ ] **Step 2:** implement, reusing `orderedStationEvents` from `lib/assignments-shared.ts` (import, do not copy).
- [ ] **Step 3:** green. Commit.

## Task 4: The 7shifts pure modules (limiter, paginator, normalizers, endpoint table)

**Files:** create `lib/sevenshifts/endpoints-shared.ts`, `lib/sevenshifts/rate-limit-shared.ts`, `lib/sevenshifts/paginate-shared.ts`, `lib/sevenshifts/normalize-shared.ts`, and `tests/sevenshifts-rate-limit.test.ts`, `tests/sevenshifts-paginate.test.ts`, `tests/sevenshifts-normalize.test.ts`.

- [ ] **Step 1: the limiter.** `createLimiter({ perSecond: 8, perMinute: 500, now: () => number })` with `reserve(): number`, which returns the ms to wait before the next request may go. We run at 80% of the published 10/s and 600/min, which leaves room for a manual call to collide with the cron. Tests:
  - 8 immediate reservations, then the 9th waits ~1000 ms;
  - 500 in a minute, then the 501st waits for the oldest to age out;
  - a `penalize(retryAfterMs)` after a 429 pushes every later reservation past it;
  - the clock is injected, so there are no real sleeps in tests.
- [ ] **Step 2: the paginator.** `nextCursor(json): string | null` reads `meta.cursor.next` defensively (malformed → null). `MAX_PAGES_PER_RESOURCE = 200` (a hard stop that is recorded as `page_cap`, never an infinite loop). Tests: null/absent/malformed meta; and a cursor that repeats → stop with `cursor_loop`.
- [ ] **Step 3: the normalizers.** One function per resource → a row typed for its table. Each one:
  - **drops** email, mobile/home numbers, birth date, `hourly_wage` (users, punches), tips, notes, availability `*_comments`/`*_reason`/`status_action_message`, time-off comments;
  - keeps the 7shifts ids as strings of digits validated with `/^\d{1,18}$/` (stored as `bigint`);
  - keeps instants as ISO strings and `deleted` booleans;
  - skips a malformed row and counts it (`skipped`), never throws.

  Users keep `first_name`, `last_name`, `preferred_first_name`, `active`, `type`, `hire_date`, `skill_level`: exactly what a manager needs to recognise a person on the link screen, plus a tenure hint for new hires. A **leak test** feeds a fully-populated payload and asserts that no output value contains the planted email, phone, birth date, wage, tip or note strings (deep scan of the JSON).
- [ ] **Step 4: the endpoint table.** `SEVENSHIFTS_API_VERSION = "2026-01-01"` and `SEVENSHIFTS_ENDPOINTS: Record<SevenShiftsResource, { path(companyId: string, extra?) => string; params(window) => URLSearchParams }>` for `whoami, locations, departments, roles, users, assignments, wages, availabilities, time_off, shifts, time_punches, labor_settings`. Test: every path starts with `/v2/` and no path contains a token or an email.
- [ ] **Step 5: register the audit actions now** (compile-time vocabulary for the later tasks). DESTRUCTIVE:
  - `sevenshifts_location_link.create`, `sevenshifts_location_link.deactivate`;
  - `sevenshifts_user_link.create`, `sevenshifts_user_link.deactivate`;
  - `people.skill_adjust`, `people.skill_rating`, `people.shop_settings_update`;
  - `pm_criteria.create`, `pm_criteria.update`.

  NON-DESTRUCTIVE:
  - `sevenshifts.sync_requested`;
  - `pm_report.copy_open`, `pm_report.copy_grade`, `pm_report.copy_note`, `pm_report.copy_position_add`, `pm_report.copy_window`, `pm_report.copy_done`, `pm_report.submit_v2`. These mirror `pm_report.submit` being non-destructive: evaluations are an observation of people, not a change to the kitchen's configuration.

  `tests/audit-actions.test.ts` stays green.
- [ ] **Step 6:** green. Commit.

---

# Chunk B — The 7shifts read sync (Tasks 5–7)

## Task 5: Migration 0267 — mirrors, ledger, sync state, the lease

**Files:** create `supabase/migrations/0267_sevenshifts_sync.sql`, `scripts/sql-harness-0267.mjs`, `tests/fixtures/scheduling-pglite-stub.sql`, `tests/sevenshifts-sync-migration.test.ts`.

- [ ] **Step 1:** `ls supabase/migrations | tail -3`. If 0267 is taken, renumber this whole plan's four migrations in one commit and tell CC.
- [ ] **Step 2: the header.** House format: `-- Migration 0267_sevenshifts_sync` / `-- AUTHORED 2026-10-1x. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word, BEFORE SEVENSHIFTS_SYNC=1).` A WHAT / WHO READS-WRITES / PRE-FLIGHT / VERIFY block, as in 0257. A preflight `do $$` asserts `cron_route_leases` + `claim_cron_route(text)` exist with 0243's body and that none of the new tables exist.
- [ ] **Step 3: the tables** (sketch; every id from 7shifts is `bigint`, every table is shop-agnostic because 7shifts ids are company-wide):

```sql
create table public.sevenshifts_sync_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null check (trigger in ('cron','manual')),
  requested_by uuid references public.users(id),           -- manual only
  started_at timestamptz not null, finished_at timestamptz not null,
  status text not null check (status in ('ok','partial','failed')),
  company_id bigint,                                        -- from whoami; null when whoami failed
  requests integer not null check (requests >= 0),
  results jsonb not null,                                   -- per resource: {rows, skipped, pages, error_code|null}
  check ((trigger = 'manual') = (requested_by is not null)),
  check (finished_at >= started_at)
);
create table public.sevenshifts_sync_state (
  resource text primary key check (resource in ('locations','departments','roles','users','assignments','wages',
    'availabilities','time_off','shifts','time_punches','labor_settings')),
  last_success_at timestamptz, modified_watermark timestamptz, last_error_code text,
  updated_at timestamptz not null default clock_timestamp()
);
create table public.sevenshifts_users (
  id bigint primary key, company_id bigint not null,
  first_name text check (char_length(first_name) <= 60), last_name text check (char_length(last_name) <= 60),
  preferred_first_name text check (char_length(preferred_first_name) <= 60),
  user_type text, active boolean not null, hire_date date, skill_level smallint,
  source_modified_at timestamptz, pulled_at timestamptz not null default clock_timestamp()
);
-- sevenshifts_locations (id, company_id, name, timezone, active, pulled_at)
-- sevenshifts_departments (id, location_id, name, pulled_at)
-- sevenshifts_roles (id, location_id, department_id, name, active, pulled_at)
-- sevenshifts_user_assignments (user_id, location_id, department_id, role_id, is_primary, pulled_at,
--   primary key (user_id, location_id, coalesce-free: department_id, role_id) via a generated key column)
-- sevenshifts_availabilities (id, user_id, week date, week_to date, repeating boolean, status smallint,
--   days jsonb  -- {mon:{available:'all'|'none'|'partial', from:'HH:MM', to:'HH:MM'}, …}: NO comments/reasons
--   , source_modified_at, pulled_at)
-- sevenshifts_time_off (id, user_id, from_date, to_date, partial boolean, from_time, to_time, status,
--   hours numeric, source_modified_at, pulled_at)   -- NO comments, NO category text
-- sevenshifts_shifts (id, user_id, location_id, department_id, role_id, station_id bigint, start_at, end_at,
--   draft boolean, open boolean, deleted boolean, source_modified_at, pulled_at)
-- sevenshifts_time_punches (id, user_id, location_id, department_id, role_id, shift_id, clocked_in, clocked_out,
--   break_minutes integer, approved boolean, auto_clocked_out boolean, deleted boolean, source_modified_at, pulled_at)
--   -- NO hourly_wage, NO tips, NO notes
-- sevenshifts_wages (user_id, wage_id bigint, effective_date date, wage_type text check in (hourly|weekly_salary|annual_salary),
--   wage_cents integer check >= 0, role_id bigint, upcoming boolean, pulled_at, primary key (user_id, wage_id))
-- sevenshifts_labor_settings (company_id bigint primary key, daily_ot_threshold numeric, weekly_ot_threshold numeric,
--   premium_ot_threshold numeric, consecutive_days_threshold integer, overtime_enabled boolean,
--   overtime_by_location_enabled boolean, multipliers jsonb, pulled_at)
```

  Indexes:
  - `sevenshifts_shifts (location_id, start_at)`;
  - `sevenshifts_time_punches (location_id, clocked_in)`;
  - `sevenshifts_time_punches (user_id, clocked_in)`;
  - `sevenshifts_availabilities (user_id, week)`.

  `comment on table` for each, naming the writer (`lib/sevenshifts/sync.ts`) and the PII rule.
- [ ] **Step 4: grants.** Mirrors and `sevenshifts_sync_state`: the SELECT/INSERT/UPDATE ceiling. `sevenshifts_sync_runs`: the SELECT/INSERT ceiling (append-only by grant). RLS on everywhere, with no policies. The ceiling guard `do $$` loops over the 13 tables, in the 0238/0257 shape.
- [ ] **Step 5: the lease.** `alter table public.cron_route_leases drop constraint cron_route_leases_job_check, add constraint cron_route_leases_job_check check (job in ('toast-sales-today','toast-catering-scan','sevenshifts-sync'))`. Look up the real constraint name in the PGlite harness (`pg_constraint`); if 0243's inline CHECK got an auto-generated name, use that name and assert it in the preflight. Re-emit `claim_cron_route` with the same body and the job list extended; the lease interval stays 330 s (the hourly sync finishes well inside it).
- [ ] **Step 6: the harness `scripts/sql-harness-0267.mjs`** applies the stub plus the REAL 0243 + 0267 and proves:
  - H1 every table exists with RLS on and no policy;
  - H2 `anon`/`authenticated` hold nothing, and `service_role` is exactly at its ceiling (DELETE/TRUNCATE refused at `set role service_role`);
  - H3 the ledger refuses UPDATE under `service_role`;
  - H4 upsert by id works on each mirror (`on conflict (id) do update`);
  - H5 `claim_cron_route('sevenshifts-sync')` claims once and refuses within the lease, and the two old jobs still claim;
  - H6 the PII columns do not exist (`information_schema.columns` has no `email|phone|mobile|birth|tip|note|comment|reason|hourly_wage` column on any `sevenshifts_*` table, wages excepted for `wage_cents`).

  It prints `PASS 0267:`.
- [ ] **Step 7: the pin** `tests/sevenshifts-sync-migration.test.ts`:
  - the header/gate line (with the later APPLIED-stamp tolerance of the 0263 pin);
  - the harness runs green via `execFileSync`;
  - `claim_cron_route`'s 0243 body is a line-subsequence of the 0267 re-emit (`extractFunction` + `normalize` from `scripts/recipe-versions/reemit-mods`).
- [ ] **Step 8:** green (`node scripts/sql-harness-0267.mjs`; `npx vitest run tests/sevenshifts-sync-migration.test.ts`). Commit.

## Task 6: The client and the status

**Files:** create `lib/sevenshifts/config.ts`, `lib/sevenshifts/client.ts`, `tests/sevenshifts-client.test.ts`; modify `.env.local.example`.

- [ ] **Step 1: re-read the 7shifts reference pages** for the twelve resources. Fix `SEVENSHIFTS_ENDPOINTS` where a path or parameter differs from Task 4, and record the date read in the file header. Docs only; no token.
- [ ] **Step 2 (tests first):**
  - `sevenShiftsStatus()` gives `not_connected/token_missing` with no token (even when `SEVENSHIFTS_SYNC=1`), `sync_off` with a token but no flag, and `ready` with both. Its JSON never contains the token value (asserted with a planted token).
  - `sevenShiftsGet(resource, …)` with an injected `fetch`:
    - sends `Authorization: Bearer <token>` and `x-api-version: 2026-01-01`;
    - waits for the limiter before every request;
    - on 429 honours `Retry-After`, calls `penalize`, and retries ONCE;
    - maps 401 → `auth_failed`, 403 → `plan_forbidden`, 404 → `not_found`, 5xx → `server_error`, abort → `deadline`, a non-JSON body → `bad_payload`;
    - follows cursors through `paginate-shared`;
    - counts requests;
    - never puts the response body, URL or token in an error message.
  - The module exports no POST/PUT/PATCH/DELETE, pinned by a source scan: `client.ts` contains no `method:` other than `"GET"`.
- [ ] **Step 3:** implement (`import "server-only"`). Fetch is `globalThis.fetch` unless injected. `cache: "no-store"`. One `AbortSignal` per call, from the run's deadline.
- [ ] **Step 4:** add to `.env.local.example`: `SEVENSHIFTS_ACCESS_TOKEN=` (comment: "Juan sets this in Vercel; never commit or paste it") and `SEVENSHIFTS_SYNC=` (comment: "1 after 0267 + 0268 are applied").
- [ ] **Step 5:** green. Commit.

## Task 7: The sync run and the ledger

**Files:** create `lib/sevenshifts/sync.ts`, `tests/sevenshifts-sync.test.ts`.

- [ ] **Step 1 (tests first, fake fetch + fake db):**
  - **dormant:** no token → returns `{ ran: false, reason: "token_missing" }`, makes ZERO fetch calls, writes NO ledger row (nothing ran) and no heartbeat;
  - **order:** whoami → locations → departments → roles → users → assignments (per user) → wages (per user) → labor_settings → availabilities → time_off → shifts → time_punches;
  - **fail-soft:** a 403 on availabilities records `plan_forbidden` for that resource only, and the others land; a 401 at whoami stops the run with status `failed`, `company_ambiguous` when whoami lists several companies;
  - **windows:** the first run backfills shifts and punches from `today − 90 days`; later runs use `modified_since = watermark − 48 h` (overlap; upsert makes it idempotent). The watermark advances ONLY for a resource that fully succeeded;
  - **deadline:** when the budget runs out mid-resource, that resource is `deadline`, its watermark does not move, and the ledger row is still written;
  - **upserts:** `on conflict (id)`; a 7shifts `deleted: true` updates the flag, nothing is ever deleted;
  - **one ledger row per run** with per-resource `{ rows, skipped, pages, error_code }` and the request count, then **one heartbeat** `cron.success|cron.failure` with `metadata.job = "sevenshifts-sync"` (manual: `sevenshifts-sync-manual`). Counts and fixed codes only, no names;
  - **budget:** over a fixture of 60 users the limiter never exceeds 8/s or 500/min (assert on the fake clock's timestamps).
- [ ] **Step 2:** implement in the `runToastLaborPull` shape: `withDeadline` around every await (import it from `lib/toast/labor.ts` if it is exported as a utility; otherwise extract it to `lib/deadline-shared.ts` and re-export from labor, keeping labor's tests green). Per-user calls (assignments, wages) only for users `active` or modified inside the window.
- [ ] **Step 3:** green. Commit.

# Chunk C — The schedule, and the links for shops and people (Tasks 8–10)

## Task 8: The cron route and Sync now

**Files:** create `app/api/cron/sevenshifts-sync/route.ts`; modify `vercel.json`; tests in `tests/sevenshifts-sync.test.ts` (route block).

- [ ] **Step 1 (tests):**
  - `cronAuthStatus` is enforced;
  - `syncEnabled()` false → `{ skipped: true, reason: "sync_off" | "token_missing" }` with no lease claim;
  - a busy lease → `{ skipped: true, reason: "cron_route_busy" }`;
  - otherwise one run with `deadlineMs = maxDuration·1000 − 10 s`.
- [ ] **Step 2:** implement. `runtime = "nodejs"`, `maxDuration = 120`.
- [ ] **Step 3:** `vercel.json` gets `{ "path": "/api/cron/sevenshifts-sync", "schedule": "20 * * * *" }` (hourly at :20, clear of the :00 digest and the */10 ticks). CC confirms the Vercel plan allows another cron (Q6).
- [ ] **Step 4: Sync now** lives in Task 10's route (`action: "sync_now"`). It is MoO+, uses the same lease (busy → 409 `sync_busy`), and is audited `sevenshifts.sync_requested` (non-destructive).
- [ ] **Step 5:** green. Commit.

## Task 9: Migration 0268 — the link tables and their RPCs

**Files:** create `supabase/migrations/0268_sevenshifts_links.sql`, `scripts/sql-harness-0268.mjs`, `tests/sevenshifts-links-migration.test.ts`.

- [ ] **Step 1: the tables** (append-only by grant: service_role SELECT only, written by the definer RPCs):

```sql
create table public.sevenshifts_location_links (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  sevenshifts_location_id bigint not null,
  active boolean not null default true,
  linked_by uuid not null references public.users(id), linked_at timestamptz not null default clock_timestamp(),
  unlinked_by uuid references public.users(id), unlinked_at timestamptz,
  check (active = (unlinked_at is null)), check ((unlinked_at is null) = (unlinked_by is null))
);
create unique index sevenshifts_location_links_one_live_shop on public.sevenshifts_location_links(location_id) where active;
create unique index sevenshifts_location_links_one_live_remote on public.sevenshifts_location_links(sevenshifts_location_id) where active;

create table public.sevenshifts_user_links (
  id uuid primary key default gen_random_uuid(),
  sevenshifts_user_id bigint not null,
  user_id uuid not null references public.users(id),
  linked_at_location_id uuid not null references public.locations(id),  -- the shop the linking manager acted for
  active boolean not null default true,
  linked_by uuid not null references public.users(id), linked_at timestamptz not null default clock_timestamp(),
  unlinked_by uuid references public.users(id), unlinked_at timestamptz,
  check (active = (unlinked_at is null)), check ((unlinked_at is null) = (unlinked_by is null))
);
create unique index sevenshifts_user_links_one_live_remote on public.sevenshifts_user_links(sevenshifts_user_id) where active;
create unique index sevenshifts_user_links_one_live_user on public.sevenshifts_user_links(user_id) where active;
```

  **There is no `source` column: every link is manual.** `linked_by` is NOT NULL, so the database itself refuses a machine link.
- [ ] **Step 2: the RPCs** (SECURITY DEFINER, `set search_path = pg_catalog, public`, service_role only; one global advisory lock `hashtextextended('sevenshifts-link',0)`):
  - `link_sevenshifts_location(p_actor, p_location, p_remote)`: actor level ≥ 8 (through `assignment_author_level`), active location; refuses `shop_already_linked` / `remote_already_linked`; same pair → `changed:false`.
  - `unlink_sevenshifts_location(p_actor, p_link)`.
  - `link_sevenshifts_user(p_actor, p_location, p_remote_user, p_user)`: the actor goes through `toast_link_actor_level(p_actor, p_location)` (GM own shop / 8+; reused, not copied); the subject through `assignment_user_level(p_user, p_location)` (an active member of that shop, or 9+); subject level ≤ actor level; refuses `user_already_linked` / `remote_already_linked`; the 7shifts user must exist in `sevenshifts_users` (`remote_unknown`).
  - `unlink_sevenshifts_user(p_actor, p_location, p_link)`: same actor rule, at the shop the link was made for or any shop for 8+.

  All named refusals use `raise exception '<code>'` (P0001), mapped in the lib.
- [ ] **Step 3: the harness** proves each refusal by name, one live link per side, unlink then relink as a NEW row (history kept), the ceilings, that a deactivated actor is refused, and that **no function in 0268 compares names** (a source scan of the migration for `name` inside the function bodies). `PASS 0268:`.
- [ ] **Step 4:** the pin test (header, harness, every function definer + pinned + revoked). Green. Commit.

## Task 10: The links lib and `/admin/sevenshifts`

**Files:** create `lib/sevenshifts/links-shared.ts`, `lib/sevenshifts/links.ts`, `app/api/admin/sevenshifts/route.ts`, `app/admin/sevenshifts/page.tsx`, `components/admin/sevenshifts/SevenShiftsScreen.tsx`, `tests/sevenshifts-links.test.ts`, `tests/sevenshifts-screen-ui.test.ts`; modify `lib/i18n/en.json`, `lib/i18n/es.json`, `lib/nav-links.ts` (admin entry, if admin links are listed there).

- [ ] **Step 1 (tests, pure):** `linkCandidates(sevenShiftsUsers, coopsUsers, links)` returns the unlinked 7shifts users and the unlinked CO-OPS members of the shop, each sorted by display name. **No suggestion, no pre-selection, no match score**: the test asserts that two people with identical names produce no pairing in the output. `displayName(u)` = preferred first name ‖ first name + last initial (the screen shows the full last name only inside the confirm sheet).
- [ ] **Step 2 (tests, lib):** `linkUser` / `unlinkUser` / `linkShop` / `unlinkShop`:
  - check `access-shared` before any I/O;
  - call the RPCs and map P0001 codes to `SevenShiftsLinkError(status, code)`;
  - audit the `sevenshifts_*_link.*` actions with ids only.

  `loadLinkScreen(actor, locationId)` returns status, the last 5 ledger rows (counts and codes), the shop link, linked people, candidates, and a WAGES COUNT (no rates).
- [ ] **Step 3: the screen** (phone-first, disclosure doctrine), top to bottom:
  1. the status line;
  2. "Shops" (MoO+): each CO-OPS shop with its linked 7shifts location or a Link picker;
  3. "People" for the selected shop: summary row "12 linked · 3 waiting"; collapsed "Waiting to link". Each waiting 7shifts person has a "Link to…" picker of CO-OPS members, and a confirm sheet reads **"Link Ana R. in 7shifts to Ana Rivera in CO-OPS? Her 7shifts punches and shifts will count as hers."**;
  4. linked people with Unlink (confirm);
  5. "Recent syncs" (collapsed);
  6. Sync now (MoO+).

  The not-connected state hides sections 2–6 behind the one status line. Every string is en + es (tú). 44 px controls. `useState` disclosure.
- [ ] **Step 4:** the UI test renders with `react-dom/server` for MoO, GM and `not_connected`, asserting no wage figure and no email in the HTML. Green. Commit.

---

# Chunk D — The people layer refactor (Tasks 11–13), golden green throughout

## Task 11: Extract ONE fact loader and the pure performance rules

**Files:** create `lib/people/facts-shared.ts`, `lib/people/facts.ts`, `lib/people/performance-shared.ts`, `lib/people/inputs-shared.ts`; modify `lib/team-metrics.ts`.

- [ ] **Step 1:** `facts-shared.ts`. Types for every fact family the legacy loaders read: completions (`instance_id, template_item_id, completed_by, completed_at, notes`), instances (`id, date, confirmed_by, confirmed_at`), cash, PM v1 reports and evals, MVPs, oversight audit rows. Later families (filled in later tasks): position intervals, prep batches, PM v2 grades, skill adjustments and ratings, linked 7shifts punches. `PeopleFacts` holds arrays per family plus `loaded: Set<FactFamily>`, so a pure function can refuse to compute from a family that was not loaded (throws `fact_family_not_loaded`, which surfaces a missing load in tests rather than a silent zero).
- [ ] **Step 2:** `facts.ts`. `loadPeopleFacts(service, { locationId, bounds, personIds?, families })` **moves the existing queries verbatim**: the same tables, filters, 50-id chunking and `selectAllRows` paging, in the same order. Behaviour does not change; only the location of the code moves. The location bind for oversight (`oversightRowAtLocation`) moves with it into `performance-shared.ts`.
- [ ] **Step 3:** `performance-shared.ts`. `teamWindow(facts, roster, range, granularity)` and `personMetrics(facts, person, range, granularity, today)` hold the materialization bodies of `loadTeamWindow` and `computePersonMetrics`, as pure functions of facts. The `compare` recursion becomes "load the facts once over the union bounds, compute twice". The two windows must produce the same numbers as two loads, and the golden proves it. If the union load changes ANY golden number, keep two loads; that is a loader detail, never a reason to touch the golden.
- [ ] **Step 4:** `inputs-shared.ts`. `export interface PeopleInputs { pmV2: boolean }` and `export const LEGACY_INPUTS: PeopleInputs = { pmV2: false }`. Phase 1 adds exactly one new input to the legacy score family: PM v2 grades in the `gradientTally` and the notes count (Task 23). Skills are a NEW view and change no legacy number.
- [ ] **Step 5:** `team-metrics.ts` becomes the wrappers (gate → facts → pure). Exports, signatures and `OVERSIGHT_ACTIONS` stay. `tests/team-metrics-person-chunks.test.ts` and `tests/team-metrics-oversight-scope.test.ts` stay green unmodified (the chunk sizes `[50,50,50,50,25,…]` are part of the contract).
- [ ] **Step 6:** `npx vitest run tests/people-layer-equivalence.test.ts tests/team-metrics-*.test.ts tests/reports-team-accuracy.test.ts tests/b8-performance-sparse-charts.test.ts` all green. Commit.

## Task 12: Profiles and My feedback onto the same layer

**Files:** modify `lib/profiles.ts`; extend `lib/people/facts.ts` with the company-wide profile facts (the public card's existing scope: the target's completions, MVP count and gradients across all shops); move the pure `publicProfile(...)` body into `performance-shared.ts`.

- [ ] **Step 1:** the same move discipline as Task 11. `loadPublicProfile` keeps the visibility gate (shared location or "all"), the leadership contact rule and the blurb rule in the wrapper. `loadProfileDirectory` keeps its two queries.
- [ ] **Step 2:** `loadMyFeedback` stays in `lib/pm-report.ts` (it is a PM read, not a score). Only its v2 sibling is added later (Task 21).
- [ ] **Step 3:** golden green. Commit.

## Task 13: Access through one rule, and the deliberate SMM refusal

**Files:** modify `lib/team-metrics.ts` (gates call `canViewPeople`), `app/(authed)/reports/trends/page.tsx` (`canSeeTeam` uses `canViewPeople` for the selected shop), `app/(authed)/reports/trends/team/page.tsx`, `app/(authed)/reports/trends/team/[personId]/page.tsx`, `lib/report-export.ts` (the team section is omitted for SMM); create the test block in `tests/people-access.test.ts` (route-level) and `tests/people-smm-refusal.test.ts`.

- [ ] **Step 1 (test first):** an SMM viewer gets `null` from `loadTeamOperatingHealth`/`loadPersonDetail`, the trends page hides the Team panel, the team pages redirect to `/dashboard`, and the export omits the team section. An AGM, GM and MoO get exactly the golden.
- [ ] **Step 2:** implement. `TEAM_VIEW_LEVEL` stays exported (6) as the level floor; `canViewPeople` adds the role refusal and the location rule.
- [ ] **Step 3:** golden green (SMM is not in it). Commit. **The PR description names this as a permission tightening the GO asked for.**

---

# Chunk E — Skills per position (Tasks 14–17)

## Task 14: Migration 0269 — people settings, adjustments, ratings

**Files:** create `supabase/migrations/0269_people_layer.sql`, `scripts/sql-harness-0269.mjs`, `tests/people-layer-migration.test.ts`.

```sql
create table public.people_shop_settings (
  location_id uuid primary key references public.locations(id),
  pm_v2 boolean not null default false,              -- the switch for PM v2 AND its input to scoring
  prep_position_id uuid,                              -- where prep batches count when no interval covers them
  updated_by uuid not null references public.users(id), updated_at timestamptz not null default clock_timestamp(),
  foreign key (prep_position_id) references public.station_positions(id)
);
-- prep_position_id must be a position of THIS shop: enforced by a composite FK on (prep_position_id, location_id)
-- against station_positions(id, location_id). Add unique(id, location_id) on station_positions only if 0219's
-- unique(id, station_id, location_id) cannot serve (it cannot: the FK needs an exact unique key); the preflight checks.

create table public.people_skill_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  location_id uuid not null references public.locations(id),
  position_id uuid not null,
  delta numeric(3,2) not null check (delta between -0.30 and 0.30 and (delta * 100) % 5 = 0),
  reason_code text not null check (reason_code in ('observed_on_floor','training_completed','correction','other')),
  reason_note text check (char_length(reason_note) <= 500),
  actor_id uuid not null references public.users(id),
  created_at timestamptz not null default clock_timestamp(),
  check (reason_code <> 'other' or coalesce(reason_note ~ '[^[:space:]]', false)),
  foreign key (position_id, location_id) references public.station_positions(id, location_id)  -- same note as above
);
create index people_skill_adjustments_head on public.people_skill_adjustments(user_id, position_id, created_at desc);
-- people_skill_ratings: same shape with `rating numeric(3,2) check (rating between 0 and 1 and (rating*100) % 5 = 0)`
-- instead of delta (the new-hire starting point; latest row wins).
```

- [ ] **Step 1:** preflight. Assert `station_positions` has the columns `id, location_id`, then add `create unique index if not exists station_positions_id_location on public.station_positions(id, location_id)` (additive; `id` is already unique, so it cannot fail on existing data) and use it for the composite FKs. **Adding the index changes no row and no grant.**
- [ ] **Step 2:** grants. Settings: the SELECT/INSERT/UPDATE ceiling. Adjustments and ratings: the SELECT/INSERT ceiling (append-only: "current" = the latest row per `(user, position)`; a correction is a new row). RLS on, no policies, plus the guard.
- [ ] **Step 3: the harness.** The step/clamp CHECKs (0.05 granularity, ±0.30); a position from another shop is refused by the FK; UPDATE/DELETE are refused for `service_role` on the append-only tables; ceilings. `PASS 0269:`.
- [ ] **Step 4:** the pin. Green. Commit.

## Task 15: The skill model, pure (`lib/people/skills-shared.ts`)

**Files:** create `lib/people/skills-shared.ts`, `tests/people-skills.test.ts`.

**The model (all tunables in one exported object, `SKILL_TUNABLES`):**

```ts
export const SKILL_TUNABLES = {
  priorWhenNoRating: 0.5,        // neutral; the mockup's role defaults are sample data (J5)
  priorStrength: 6,              // k: how many observed days the prior is "worth"
  weights: { pm: 0.6, closeOnTime: 0.2, prepYield: 0.2 },  // renormalised over the signals present
  gradeValue: { great: 1, good: 0.6, needs_work: 0.2 },     // PM grade → [0,1]
  yieldTolerance: 0.15,          // the 0218 Phase B band: within ±15% of recipe = on target
  bands: { building: 0.45, strong: 0.75 },                  // < building · building..strong · ≥ strong
  minDaysForLearned: 3,          // below this the skill reads "Starting point" (prior-led)
} as const;

export interface PositionSignals {
  positionId: string; minutesWorked: number; daysWorked: number;
  pmGrades: Array<{ day: string; value: number; weightMinutes: number }>;   // PM v1 has no position: see J6
  closeOnTime: { onTime: number; total: number } | null;                     // that station's closing lines vs its close
  prepYield: { onTarget: number; total: number; batches: number } | null;     // prep positions / prep evidence position
}
export interface SkillResult {
  positionId: string; learned: number; prior: number; priorSource: "manager_rating" | "neutral";
  adjustment: number; value: number;  // clamp(learned + adjustment, 0, 1)
  band: "building" | "solid" | "strong"; startingPoint: boolean; observedDays: number;
  evidence: NarrativeLine[];          // i18n keys + params, never prose
}
export function skillFor(signals: PositionSignals, prior: number | null, adjustment: number): SkillResult;
```

- `q` = the weighted mean of the present signals (PM: the weighted average of grade values; closeOnTime: onTime/total; prepYield: onTarget/total), with weights renormalised over the signals that exist.
- `n` = the distinct days with at least one quality signal.
- `learned = (k·prior + n·q) / (k + n)`; with no quality signal, `learned = prior`.
- `value = clamp(learned + adjustment, 0, 1)`.

**Evidence lines** (keys under `people.skills.evidence.*`), e.g.:
- "Worked 14 shifts here this month (52 h)";
- "Managers rated this position 9 times · mostly Great";
- "Closing lines done before the station closed: 17 of 18";
- "Made 18 batches · yield on target 94%";
- "Manager adjustment +0.10 · Alex · Oct 12 · Observed on the floor";
- "Starting point from Alex's rating (new hire)";
- "No maker recorded for this shop's prep yet".

- [ ] **Step 1 (tests):**
  - no data, no rating → 0.5 neutral, `startingPoint: true`;
  - a rating of 0.8 and 2 days of `q = 0.4` → `(6·0.8 + 2·0.4)/8 = 0.7`;
  - 40 days pull the value to `q`;
  - the adjustment clamps at 0 and 1;
  - weights renormalise when only PM exists;
  - bands at the boundaries;
  - evidence keys are present for each signal and absent when a signal is null;
  - a 0217 interval with a null position never produces a skill row (it shows under "Position not recorded" minutes only);
  - determinism: same input, same output.
- [ ] **Step 2:** implement. Signal builders, each pure, from the facts:
  - `closeOnTimeSignal(completions, stationLinesByStation, stationCloseAt)`: closing-template lines whose `checklist_template_items.station` matches the station's `stations.name` (the 0230 `station_closures` join), completed by the person, where on time means at or before `stations.usually_closes_at` (+15 min grace in the tunables), or before the observed `station_closures.closed_at` when the station has no usual close. Attributed to the position the person held at completion time.
  - `prepYieldSignal(batches, intervals, prepPositionId)`: a batch counts for the position the maker held at `produced_at`, else for the shop's `prep_position_id`, else as "unplaced prep work" (evidence only); on target when `|came_out_to/batches_made − yield_at_time| / yield_at_time ≤ 0.15`.
  - `pmSignal(...)`: Task 19 supplies the PM v2 weighted per-position averages.
- [ ] **Step 3:** green. Commit.

## Task 16: The skills loader and the writers

**Files:** create `lib/people/skills.ts`, `lib/people/settings.ts`, `app/api/people/skills/route.ts`, `app/api/people/settings/route.ts`; extend `lib/people/facts.ts` with the families `positionIntervals` (station_events + `closeOpenIntervals`), `closingLines` (via the existing closing-stations helpers, not a second query shape), `prepBatches` (`prep_batch_sessions` joined to `productions` on `made_by` by the two-step pattern), `skillAdjustments`, `skillRatings`; create `tests/people-loader-schema-check.test.ts`.

- [ ] **Step 1 (tests):**
  - `loadSkills(service, { actor, locationId, personId, window })`: `canViewPeople` (or self) BEFORE any I/O; one call to `loadPeopleFacts` with the needed families; returns positions of THIS shop only, ordered by station sort then position sort; never another shop's positions even for a two-shop person.
  - `adjustSkill(...)`: `canAdjustSkill` before I/O; the position belongs to the shop (the FK is the backstop); the delta step/clamp is validated in the lib (named `invalid_adjustment`); inserts a row; audits `people.skill_adjust` with `{ user_id, position_id, delta, reason_code }` and no note text.
  - `rateNewHire(...)`: same shape, audited `people.skill_rating`.
  - `savePeopleShopSettings`: audited `people.shop_settings_update` with before/after.
- [ ] **Step 2: the schema check.** Copy the recording-client pattern: PGlite applies the stub plus 0267–0269 (0270 is added in Task 20) and executes every captured query on those tables with `limit 0`. A misspelled column fails here, not in prod.
- [ ] **Step 3:** routes. `requireSession`, then `lockLocationContext`/`canViewPeople` as the outer layer (the lib bind is the inner one), then a JSON body schema; refusals map to their status and code. No step-up tier (an operational manager act, the Dynamic Pars precedent; J8).
- [ ] **Step 4:** green (golden included: these families are loaded ONLY by `loadSkills`). Commit.

## Task 17: The skills UI — manager view and self view

**Files:** create `components/people/SkillsSection.tsx`, `components/people/MySkills.tsx`; modify `app/(authed)/reports/trends/team/[personId]/page.tsx`, `app/(authed)/my-feedback/page.tsx`, `lib/i18n/en.json`, `lib/i18n/es.json`; create the UI tests in `tests/people-skills-ui.test.ts`.

- [ ] **Manager view** (on the person page, after the existing sections; disclosure doctrine):
  - a summary row "Skills · 5 positions · 1 adjusted" (collapsed by default on phone, open on desktop);
  - per position a full-row toggle: name (es when the viewer's language is es and `name_es` is set), a bar, the value to two decimals, the band, and an "Adjusted +0.10" chip when one applies;
  - the drawer holds the evidence lines and the adjustment history (who, when, reason);
  - the Adjust control is GM+/MoO+ only: − / + in 0.05 steps clamped to ±0.30, as in the mockup, then a reason picker, then Save. 44 px, `items-center`;
  - New-hire rating: when `startingPoint` is true and the viewer may adjust, "Set a starting rating" uses the same 0–1 bar control in 0.05 steps (one scale everywhere, never stars; J5).
- [ ] **Self view** (`/my-feedback`, "My skills"): the positions the person worked at this shop, each with a band label and the positive evidence lines only (no needs-work counts, no adjustment amounts, no numbers), headed "What you've been doing well".
- [ ] **Tests:** render for GM (adjust visible), AGM (no Adjust), SMM (page refused upstream), and self (no numbers: assert the HTML contains no `0.` value and no "Adjusted"). en + es keys exist for every visible string and ARIA label (the key-parity test in `tests/i18n*.test.ts` stays green).
- [ ] Commit.

---

# Chunk F — PM reports v2 (Tasks 18–22)

## Task 18: Migration 0270 — copies, grades, notes, criteria, and the writer RPCs

**Files:** create `supabase/migrations/0270_pm_reports_v2.sql`, `scripts/sql-harness-0270.mjs`, `tests/pm-reports-v2-migration.test.ts`.

```sql
alter table public.pm_reports add column format text not null default 'v1' check (format in ('v1','v2'));

create table public.pm_criteria (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  position_id uuid,                                  -- null = applies to every position at this shop
  label text not null check (char_length(btrim(label)) between 1 and 80),
  label_es text check (label_es is null or char_length(btrim(label_es)) between 1 and 80),
  sort smallint not null default 100, active boolean not null default true,
  created_by uuid not null references public.users(id), created_at timestamptz not null default clock_timestamp(),
  foreign key (position_id, location_id) references public.station_positions(id, location_id)
);
create table public.pm_report_copies (
  id uuid primary key default gen_random_uuid(),
  pm_report_id uuid not null references public.pm_reports(id),
  location_id uuid not null references public.locations(id),
  author_id uuid not null references public.users(id),
  status text not null default 'open' check (status in ('open','done','sealed')),
  observed_from timestamptz, observed_to timestamptz,
  created_at timestamptz not null default clock_timestamp(), sealed_at timestamptz,
  unique (pm_report_id, author_id),
  check ((status = 'sealed') = (sealed_at is not null)),
  check (observed_to is null or observed_from is null or observed_to > observed_from)
);
create table public.pm_copy_grades (
  id uuid primary key default gen_random_uuid(),
  copy_id uuid not null references public.pm_report_copies(id),
  subject_id uuid not null references public.users(id),
  position_id uuid,                                   -- null = "no position recorded" (shared criteria only)
  criterion_id uuid not null references public.pm_criteria(id),
  grade text check (grade in ('great','good','needs_work')),   -- null = "not observed" (an explicit answer)
  created_at timestamptz not null default clock_timestamp(), superseded_at timestamptz
);
create unique index pm_copy_grades_one_live on public.pm_copy_grades
  (copy_id, subject_id, coalesce(position_id, '00000000-0000-0000-0000-000000000000'::uuid), criterion_id)
  where superseded_at is null;
-- pm_copy_notes: (copy_id, subject_id, position_id null-able, note text check 1..500, created_at, superseded_at),
--   the same one-live unique index without criterion_id.
-- pm_copy_positions: (copy_id, subject_id, position_id not null, reason text check 1..200, created_at,
--   superseded_at) — a manager adds a position a person worked but never tapped into (shown "added by <manager>").
```

- [ ] **Step 1: the RPCs** (SECURITY DEFINER, pinned, service_role only). Each locks **the day row (`pm_reports … for update`) first, then the copy row**, the same order everywhere, so they cannot deadlock.
  - `open_pm_copy(p_actor, p_report)`: day `format='v2'` and `status='open'`; inserts on conflict do nothing; returns the copy id.
  - `save_pm_copy_grade(p_actor, p_copy, p_subject, p_position, p_criterion, p_grade)`: the author is the actor, the copy is `open|done` and the day is `open`, else `copy_closed`/`report_already_submitted`; the criterion belongs to the shop, is active, and its position is null or equals `p_position` (`criterion_mismatch`); the subject is an active member of the shop (`assignment_user_level`). Supersede the live row, then insert. A `done` copy reopens to `open` on any write.
  - `save_pm_copy_note`, `add_pm_copy_position`: the same guards.
  - `set_pm_copy_window(p_actor, p_copy, p_from, p_to)`: both inside the business day (ET start of `report_date` to +30 h, which covers a close after midnight); `to > from`.
  - `mark_pm_copy_done(p_actor, p_copy)`.
  - `submit_pm_day_v2(p_actor, p_report)`: a guarded `update pm_reports set status='submitted', submitted_at=clock_timestamp(), submitted_by=p_actor where id=p_report and status='open' and format='v2' and superseded_at is null`. Zero rows → return `{changed:false}` (a losing submit is a no-op, the v1 doctrine). Then `update pm_report_copies set status='sealed', sealed_at=clock_timestamp() where pm_report_id=p_report and status <> 'sealed'`, and `observed_to` defaults to the submit instant where null. **No notification, no insert outside these two tables.**
- [ ] **Step 2: grants.** `pm_criteria`: the SELECT/INSERT/UPDATE ceiling (deactivate only; label edits allowed and audited by the lib). Copies, grades, notes and positions: service_role **SELECT only**, with every write through the RPCs. The `pm_reports` grants are unchanged (assert they are identical before and after: the guard compares `role_table_grants` for `pm_reports` to a literal manifest).
- [ ] **Step 3: the harness.**
  - P1 a copy is invisible to nothing at the DB level (the lib decides), but every write by a non-author is refused (`not_copy_author`);
  - P2 a write after submit is `report_already_submitted`;
  - P3 a concurrent submit: the second returns `changed:false`;
  - P4 submit seals every copy and sets the default `observed_to`;
  - P5 a criterion from another shop or another position is refused;
  - P6 the supersede keeps one live row and keeps history;
  - P7 `format` defaults to v1, and a v1 day refuses every v2 RPC (`format_mismatch`);
  - P8 the ceilings, plus the `pm_reports` grant manifest unchanged;
  - P9 no RPC in 0270 references `notifications`.

  `PASS 0270:`.
- [ ] **Step 4:** the pin. Green. Commit.

## Task 19: PM v2 rules, pure (`lib/pm-report-v2-shared.ts`)

**Files:** create `lib/pm-report-v2-shared.ts`, `tests/pm-report-v2-shared.test.ts`.

```ts
export const PM_GRADE_VALUE = { great: 3, good: 2, needs_work: 1 } as const;  // display scale; skills use SKILL_TUNABLES.gradeValue
export interface CopyObservation { copyId: string; authorId: string; from: string; to: string }
/** minutes manager m observed person p at position s = overlap(m's window, p's intervals at s that day).
 *  A manager-added position (pm_copy_positions) counts the full overlap of m's window with the person's day presence. */
export function observationMinutes(copy: CopyObservation, intervals: readonly PositionInterval[], subjectId: string, positionId: string | null): number;
/** Weighted average per (subject, position, criterion); grade null ("not observed") is excluded;
 *  when every contributing weight is 0, fall back to equal weights and flag `weights: "equal_fallback"`. */
export function averageGrades(grades: readonly LiveGrade[], weights: ReadonlyMap<string /*copyId|subject|position*/, number>): AveragedCell[];
/** Write-ins: every live note, attributed. Themes: recurring terms across distinct (day × author) for one subject×position
 *  over a window; en+es stopwords; light stemming (strip plural -s/-es, Spanish -s/-es); a theme needs ≥2 authors OR ≥3 days. */
export function writeInThemes(notes: readonly AttributedNote[], opts: { minAuthors: 2; minDays: 3; top: 3 }): Theme[];
export function copyVisibility(...): "author_only" | "day_open_counts_only" | "day_submitted_full";
export function rosterForCopy(presenceRoster, intervals, addedPositions): Array<{ subjectId: string; positions: Array<{ positionId: string | null; minutes: number; added?: { by: string } }> }>;
```

- [ ] **Step 1 (tests):**
  - two managers overlapping a person's Expeditor interval for 60 and 180 minutes with Great (3) and Good (2) → `(60·3 + 180·2)/240 = 2.25`;
  - `not observed` is excluded;
  - zero overlap for both → equal fallback, flagged;
  - a person with no station events but on the presence roster → one row with `positionId: null` (shared criteria only);
  - a theme: "slow on the slicer" written by 2 managers on different days surfaces ("slicer", "slow"), while a single mention does not, and the theme's sources are attributed;
  - es notes ("lento con la rebanadora") theme too;
  - themes are deterministic and order-stable;
  - visibility truth table.
- [ ] **Step 2:** implement (pure; positions come from `positionTimeline`).
- [ ] **Step 3:** green. Commit.

## Task 20: The PM v2 lib — copies, writes, submit, loaders

**Files:** create `lib/pm-report-v2.ts`, `tests/pm-report-v2.test.ts`, `tests/pm-report-v2-no-notify.test.ts`; modify `lib/pm-report.ts`; extend `tests/people-loader-schema-check.test.ts` with 0270.

- [ ] **Step 1 (tests first):**
  - `getOrCreatePmReport` stamps `format` from `people_shop_settings.pm_v2` for a NEW day row only; an existing row keeps its format (switching mid-day never converts a day).
  - v1 `saveEmployeeEval` / `setMvp` on a v2 day → `PmReportError(409, "format_mismatch")`. MVP on v2 is written by `setMvpV2` (the same guarded UPDATE, `.eq("format","v2")`), so the existing MVP scoring keeps reading `pm_reports.mvp_user_id`.
  - `openMyCopy(actor, locationId, date)`: `requirePmTask` (existing) plus `canWritePmCopy`/not-SMM, then `open_pm_copy`.
  - `loadMyCopy(actor, …)`: returns ONLY the actor's copy plus the roster (`rosterForCopy` over `pmPresenceRoster(board)`, the position intervals of the day and the copy's added positions), the criteria per position, and the actor's own grades/notes. **Other copies appear as counts only** ("2 other managers have started a copy").
  - `saveGrade` / `saveNote` / `addPosition` / `setWindow` / `markDone` / `submitDay` map the RPC codes to `PmReportError`, audit each (`pm_report.copy_*`, `pm_report.submit_v2`), and **never enqueue a notification**.
  - `loadDayResults(actor, …)`: `canReadPmCopy` for the submitted day; returns copies side by side (author name, window, done/sealed), per person × position × criterion the average with each manager's grade and minutes, the write-ins attributed, and the themes over the last 30 days for that person × position.
  - `loadMyFeedbackV2(userId)`: own grades from SUBMITTED v2 days, averaged per position × criterion, as bands with no author and no note text.
- [ ] **Step 2: the no-notify pin.** `tests/pm-report-v2-no-notify.test.ts` mocks `@/lib/notifications` and asserts that `enqueueNotification` is never called through a full open → grade → submit flow, and a source scan asserts that `lib/pm-report-v2.ts`, `lib/people/**` and `lib/sevenshifts/**` do not import `@/lib/notifications` or `@/lib/email`.
- [ ] **Step 3:** green, golden included (v2 rows in the fixture still change nothing while `pm_v2` is false for the scoring input). Commit.

## Task 21: The PM v2 surfaces (copy form, results, my feedback)

**Files:** create `app/api/pm-report/v2/route.ts`, `components/pm-report-v2/PmCopyForm.tsx`, `components/pm-report-v2/PmDayResults.tsx`, `tests/pm-report-v2-ui.test.ts`; modify `app/(authed)/pm-report/page.tsx`, `app/(authed)/my-feedback/page.tsx`, `lib/i18n/en.json`, `lib/i18n/es.json`.

- [ ] **The page chooses by the day row's `format`.** v1 renders exactly today's client. v2 renders the copy form while the day is open and the results after submit.
- [ ] **The copy form** (phone-first, one person per card, disclosure doctrine):
  - **Header:** "Your copy · only you can see it until the closing manager submits" / "Tu copia · solo tú la ves hasta que el gerente de cierre la envíe". "My time on the floor: 2:00 PM – 9:00 PM" (editable; prefilled from the manager's linked Toast clock-in, else their first CO-OPS activity today, else blank and required before Done).
  - **Summary row:** "8 people · 5 rated".
  - **Per person, a collapsed card** showing name + positions worked ("Expeditor 2h 10m · Register & Delivery 1h"). Expanding shows, per position, the criteria as a 3-way segmented control (Great / Good / Needs work), a "Didn't see" option, and a free-text box ("Anything else? It stays with managers" / "¿Algo más? Queda entre gerentes"). "Worked somewhere else?" adds a position with a short reason.
  - **Footer:**
    - "Mark my copy done";
    - for the closing manager, "Submit the day's report". Its confirm sheet shows counts only: "3 managers started a copy · 2 marked done. Submitting locks every copy." The sheet never shows another copy's content.
  - Autosave per answer (the save-status pattern), 44 px controls.
- [ ] **Results (after submit):**
  - per person, a summary row "Expeditor · Great 2.6 · 2 managers";
  - the drawer holds the criteria averages with each manager's grade and minutes ("Dani · Great · 3h 10m", "Iris · Good · 40m"), the write-ins attributed, and the "Coming up again" themes with their quoted sources;
  - a "Copies" tab shows each copy whole, side by side on desktop (two columns at `lg`) and stacked on phone.
- [ ] **My feedback:** a v2 day shows per position the criteria as bands ("Great · Good · Building") and nothing else. v1 days render as today.
- [ ] **Tests:**
  - render the copy form for its author with another copy in the fixture, and assert the other copy's grades and notes are absent from the HTML;
  - render results for a GM and for a KH who did not author that day (refused);
  - render my-feedback v2 with no author name and no note text;
  - en + es key parity.
- [ ] Commit.

## Task 22: The criteria editor and the confirmed-criteria seed

**Files:** create `lib/pm-criteria.ts`, `app/api/pm-criteria/route.ts`, `app/(authed)/settings/pm-criteria/page.tsx`, `components/pm-report-v2/PmCriteriaEditor.tsx`, `scripts/seed-pm-criteria.ts`; tests in `tests/pm-report-v2.test.ts` (criteria block).

- [ ] **The editor** (GM own shop, MoO+ any): positions of the shop with their criteria, plus "Every position" for the shared ones. Add, rename (en + es side by side, the C.44 rule), reorder, deactivate (never delete). Audited `pm_criteria.create` / `pm_criteria.update` with before/after labels. A deactivated criterion keeps its past grades and stops appearing on new copies.
- [ ] **The seed script** reads a JSON file of the criteria **Juan confirms** (the draft below is its starting content) and maps each position by `(location_id, station name, position name)` read from the database, printing every match. It refuses on any unmatched name (never guesses) and is a dry run unless `--apply`. Audit rows carry `actor_context: "seed_pm_criteria"`, behind a `pathToFileURL` guard. **It does NOT run in this phase without Juan's confirmation** (Q1).
- [ ] Commit.

---

# Chunk G — Switch on, the law, the guide, verification (Tasks 23–26)

## Task 23: PM v2 grades feed the people layer, behind the per-shop switch

**Files:** modify `lib/people/facts.ts` (family `pmV2Grades`: live grades of SUBMITTED v2 days at the shop, with the observation weights from Task 19), `lib/people/performance-shared.ts`, `lib/people/skills-shared.ts` (`pmSignal`); extend `tests/people-layer-equivalence.test.ts`.

- [ ] **Step 1 (tests first):**
  - **(a) switch OFF** (no settings row, or `pm_v2 = false`) with v2 rows present → the golden, byte-identical;
  - **(b) switch ON** for LOC_A only →
    - LOC_A's `gradientTally` adds the v2 grades (great/good/needs_work counted per graded criterion);
    - the copy authors' `notes` count adds one per live v2 note they authored, the v1 rule's twin;
    - finalizations and peopleMgmt are unchanged (they already come from the shared day row);
    - LOC_B is byte-identical to the golden;
  - **(c) skills:** the PM signal uses the weighted per-position averages (`SKILL_TUNABLES.gradeValue`) for both v1 and v2 days, independent of the switch. A v1 grade has no position, so it never enters a position skill (J6). Skills are a new view, not a legacy number.
- [ ] **Step 2:** implement. `PeopleInputs` is resolved per shop from `people_shop_settings` in the wrappers, so the pure functions receive it as a parameter.
- [ ] **Step 3:** green. Commit.

## Task 24: The law (AGENTS.md)

- [ ] Add a section "### Scheduling Phase 1: 7shifts mirror, people layer, PM v2 (0267–0270)" with the durable rules:
  - 7shifts is a read MIRROR keyed by 7shifts ids, never deleted, with PII dropped in the normalizer (the list);
  - person and shop links are manual only, joined at read time (unlink removes attribution at once);
  - `SEVENSHIFTS_ACCESS_TOKEN` is Juan's; `SEVENSHIFTS_SYNC=1` comes after 0267/0268; the client is GET-only;
  - the job is not in `JOBS_REGISTRY` until Juan says so;
  - one people fact loader + pure rules; a new consumer of people facts goes through `loadPeopleFacts`, never its own query;
  - the people equivalence pin is permanent; new inputs enter only through `PeopleInputs` per shop;
  - skills key on `station_positions.id` (shop-scoped); learned = shrink(prior, q, n), with the tunables in one object; the adjustment is ±0.30 in 0.05 steps, append-only and audited;
  - PM v2 is blind until submit; submit seals; averages are weighted by observed minutes; no notification;
  - `social_media_mgr` is refused people data by ROLE;
  - wages have no reader.

  Fix the "Current state" migration lineage line to name 0267–0270 as authored, NOT applied.
- [ ] Commit.

## Task 25: The manager guide (en + es)

- [ ] `docs/guides/manager-guide.md`: three short sections, each with an es twin, no screenshots yet (marked "not shown"):
  - "Linking people to 7shifts" ("we never match by name; you confirm each person");
  - "Skills per position" ("what the bar means, where the evidence comes from, when to adjust and why a reason is required");
  - "PM report copies" ("your copy is private until the closing manager submits; what Didn't see means; why the averages weight by time on the floor").
- [ ] Commit (docs-only).

## Task 26: Final verification

- [ ] `npx vitest run` (full suite, after the other builder's run has finished on that machine). `node scripts/sql-harness-0267.mjs … 0270.mjs` all print PASS. `npx tsc --noEmit`. `npm run build`.
- [ ] Every new string has en + es. `scripts/check-ui-tokens.ts` is clean for the new components.
- [ ] Grep proofs, each with zero hits in new code: `rg "\"EM\"|\"MEP\"" lib/people lib/sevenshifts lib/pm-report-v2* components/people components/pm-report-v2 app/admin/sevenshifts`; `rg "enqueueNotification|lib/email" lib/people lib/sevenshifts lib/pm-report-v2.ts`; `rg "method:\s*\"(POST|PUT|PATCH|DELETE)\"" lib/sevenshifts`.
- [ ] The golden is unchanged since Task 1 (`git log --follow tests/fixtures/people-layer-golden.json` shows one commit).
- [ ] Hand CC the apply order: 0267 → 0268 → 0269 → 0270 (sim, then prod on Juan's word), then `SEVENSHIFTS_SYNC=1`. Juan's token is independent and can come at any time. `pm_v2` stays false per shop until the criteria are confirmed and seeded.

---

## Chunk map

| Chunk | Tasks | Delivers | Independently testable by |
|---|---|---|---|
| A | 1–4 | The frozen golden; the permission rules; position intervals; the 7shifts limiter / paginator / normalizers / endpoint table; the audit vocabulary | vitest only, no DB |
| B | 5–7 | 0267 + harness; the GET-only client + status; the sync run + ledger | PGlite harness; fake fetch + fake db |
| C | 8–10 | the hourly cron + Sync now; 0268 + harness; manual shop/person links; `/admin/sevenshifts` with the "Not connected" state | route tests; PGlite; lib tests; SSR UI tests |
| D | 11–13 | team-metrics/profiles on ONE loader + pure rules; the SMM refusal | the golden (byte-identical) |
| E | 14–17 | 0269; the skill model; skills loader + adjust/rate; manager + self skill views | PGlite; pure tests; schema check; SSR |
| F | 18–22 | 0270; PM v2 pure rules; lib + RPC writers; copy form / results / my feedback; the criteria editor + seed | PGlite; pure + lib tests; the no-notify pin |
| G | 23–26 | PM v2 into scoring behind the per-shop switch; AGENTS.md; the guide; verification | the golden (off) + delta tests (on) |

---

## Draft PM criteria per position — FOR JUAN TO CONFIRM (Q1)

All are graded **Great / Good / Needs work**, with **Didn't see** always available. Every position also gets the two **shared** criteria. Labels are data (`pm_criteria`), not code.

| Position (as in `station_positions`) | Criteria (en / es) |
|---|---|
| **Every position (shared)** | Arrived ready (on time, in uniform) / Llegó listo (a tiempo, con uniforme) · Teamwork and attitude / Trabajo en equipo y actitud |
| **Expeditor** | Ticket accuracy (right items, right mods) / Precisión de tickets · Pace (tickets moving, no pile-ups) / Ritmo · Clear call-outs and communication / Comunicación clara · Bags checked before hand-off / Bolsas revisadas antes de entregar |
| **Register & Delivery** | Order accuracy at the register / Precisión en caja · Greets and helps guests / Atención al cliente · Delivery hand-offs (right bag, right driver) / Entregas correctas · Cash handling / Manejo de efectivo |
| **Walk-ins** | Builds to spec (portions, order) / Arma según la receta · Speed in the rush / Rapidez en la hora pico · Station stocked and clean / Estación surtida y limpia · Helps online when there are no walk-ins / Ayuda con pedidos en línea |
| **Walk-ins / Online** | Online order accuracy / Precisión en pedidos en línea · Ready by the quoted time / Listo a la hora prometida · Balances walk-ins and online / Equilibra tienda y en línea · Station stocked / Estación surtida |
| **Crunchy Boi Station** | Builds to spec / Arma según la receta · Speed / Rapidez · Station stocked and clean / Estación surtida y limpia |
| **3rd Party Station** | Ticket accuracy, incl. modifications / Precisión incluyendo cambios · Packed and labeled right / Empaque y etiquetas correctas · Ready for driver pickup / Listo para el repartidor |
| **Prep** | Prep list done on time / Lista de prep a tiempo · Yield and portions vs recipe / Rendimiento y porciones · Safe, clean slicer and knife work / Rebanadora y cuchillos con seguridad y limpieza · Labeled and dated (first in, first out) / Etiquetado y fechado (PEPS) |
| **Prep/Dishwasher** | Prep list done on time / Lista de prep a tiempo · Dishes kept up (no pile at rush or close) / Platos al día · Sanitation and cleanliness / Higiene y limpieza · Closing dish duties done / Tareas de cierre de platos |

Positions that exist in a shop but are not listed get the shared criteria only, until a manager adds their own in the editor.

---

## Judgment calls (made in this plan; each is reversible in one place)

- **J1 — Level-6 operational roles keep team visibility.** The GO says "GM own shop", but AGM / prep / catering managers already see team scoring today (`TEAM_VIEW_LEVEL = 6`). Phase 1 refuses only `social_media_mgr`, so there is no silent regression for the AGMs who use it. Narrowing to GM is one line in `canViewPeople` (Q7).
- **J2 — Skills key on the shop's `station_positions.id`.** Two shops' "Expeditor" rows are separate positions, so a person working both shops has a skill per shop, and the location bind falls out of the key. There is no cross-shop name rollup, which would key logic on names.
- **J3 — Staff see bands, not numbers.** This keeps the positive-only self-view law of `myPerformanceRead`. Managers see the number, the band, the evidence and the adjustment (Q8).
- **J4 — Wages are synced and read by nothing.** They are stored minimal (type, cents, role, effective date) because Phase 2 needs labor cost. No surface shows an individual rate. Recommendation for Phase 2: per-person rates at MoO+ only; GMs see their shop's labor $ and % in aggregate; never on a staff surface, export or log (Q5).
- **J5 — One 0–1 scale, a neutral prior of 0.5.** The mockup's per-role defaults (management 0.7, Prep/Dishwasher 0.65) are sample data; adopting them would prejudge people by title. The manager's starting rating uses the same bar.
- **J6 — PM v1 grades do not feed position skills.** They have no position. They keep feeding `gradientTally` exactly as today.
- **J7 — Assignment changes and Toast hourly sales are evidence, not skill math, in Phase 1.** Sales during someone's shift is confounded by everything else on the floor; it is shown as context only ("worked 9 lunch rushes").
- **J8 — Adjust, rate and PM copies take no step-up.** They are operational manager acts with a small blast radius, and every one is audited and visible (the Dynamic Pars precedent). The criteria editor and settings also take none; Q10 asks whether the criteria editor should take Tier E.
- **J9 — After submit, a day's PM results are for its authors, GM/Op-6 of the shop, and MoO+**, not every KH/SL of the shop (v1's RLS lets any KH+ read; v2 is lib-gated and narrower).
- **J10 — PM v2 free text stays with managers.** Staff see their averaged criteria as bands only (v1 also hides `note`; v1's `area_to_improve` has no v2 twin) (Q9).
- **J11 — The closing manager is whoever submits** (KH+ with pm_report task access). Phase 2's Closing Manager role (spec §6.2) can narrow it later.
- **J12 — A manager may add a position a person worked without tapping in** ("added by Dani"). Prep/dish work is often not claimed on the board, and a copy limited strictly to station events would hide it. The GO's "from station events" stays the default roster.
- **J13 — The sync job is not in `JOBS_REGISTRY`,** because job-watch emails on a missing heartbeat (no-email rule). Health shows on the 7shifts screen (Q6).
- **J14 — 7shifts punches are mirrored but do not change presence ("Who's here") in Phase 1.** The `presence-shared.ts` seam stays untouched until Phase 2 decides precedence.
- **J15 — Hourly sync at :20.** Phase 1 has no live-schedule consumer, so hourly is plenty and stays far under the rate limits. Phase 2 can tighten it.

## Open questions for Juan

- **Q1 — PM criteria per position.** Confirm or edit the draft table above (labels en + es, which positions, the shared two). Nothing is seeded until you do.
- **Q2 — The 7shifts plan tier and the token.** Which plan is CO on? Pro is assumed. The docs mark availabilities as "The Works" and labor settings as their own tier; anything the plan does not include shows as "needs a higher 7shifts plan" and the rest still syncs. Please create the company access token in 7shifts Developer Tools and set it yourself as **`SEVENSHIFTS_ACCESS_TOKEN`** in Vercel. Does the token see exactly one company?
- **Q3 — Prep and Prep/Dishwasher as positions.** Do both shops have them as station positions today, under the Prep Area station? Skills and PM criteria for them need real rows. If not, a GM adds them on the Stations page; this plan adds no data.
- **Q4 — The person-link flow.** GM links people at their own shop, and MoO+ anywhere. Every link is confirmed by hand with no name suggestion at all. OK? Or do you want 7shifts' employee/punch id shown on the CO-OPS side to make matching easier (it would mean storing one more 7shifts field)?
- **Q5 — Wages.** Phase 1 shows none. For Phase 2: is "MoO and Owner see per-person rates; GMs see only their shop's totals" right?
- **Q6 — Alerts and cron.** Should the 7shifts sync join job-watch (which emails you when a heartbeat is missing) once you connect it? And CC confirms the Vercel plan takes one more hourly cron.
- **Q7 — Who sees team scoring and skills.** Today AGM, prep manager and catering manager see team scoring at their shop. Keep that, or narrow it to GM and up as the GO wording says? (The social media manager is refused either way.)
- **Q8 — What staff see of their skills.** Bands plus evidence (the plan), or also the number? Should a staff member see that a manager adjusted their skill?
- **Q9 — PM free text and staff.** Keep managers' notes private (the plan), or show staff a positive write-in line?
- **Q10 — Passwords on the criteria editor.** Should editing PM criteria ask for the catalog edit password (Tier E), or stay password-free like the PM report?
- **Q11 — The skill constants.** Starting value 0.5, a starting rating "worth" 6 days of data, the PM 60% / closing 20% / prep yield 20% blend, and the bands Building < 0.45 ≤ Solid < 0.75 ≤ Strong. Fine to start with? They are in one place and easy to tune.

## Findings for CC (outside this phase's scope)

- **F1 (security):** `pm_evals_read_self` (0072) lets an employee read their own `pm_employee_evals` rows through PostgREST with a staff JWT, **including `note`**, the KH+-only column. It is the same class as the 0198 `users` column-grant fix. A follow-up migration could replace the policy with a column-scoped grant, or drop it, since every app read is service-role. Not done here.
- **F2:** `TEAM_VIEW_LEVEL = 6` admits `social_media_mgr` to team scoring today. Task 13 closes it, as the GO requires.

## Self-review against the spec and the GO

| Requirement | Where |
|---|---|
| 7shifts read: users + assignments, roles/stations, availability, time off, published shifts, punches, wages, labor settings | Tasks 4–7 (stations as bare `station_id`; there is no stations endpoint in the docs, noted) |
| Poll-based, company token, rate limits 10/s + 600/min, pagination | Tasks 4, 6, 7 (80% self-limit, cursor follower, 429 backoff) |
| Raw facts append-only or upsert-by-id + a sync ledger | 0267: mirrors upsert by id, never deleted; `sevenshifts_sync_runs` append-only |
| Reconcile by stable ids; person match ONLY by a manager-confirmed link, never by name | 0268 (no `source`, `linked_by` NOT NULL, no name compare); Task 10 (no suggestion, pinned) |
| Token absent → dormant + "Not connected"; the exact env var named | `SEVENSHIFTS_ACCESS_TOKEN` (Juan); status line; Task 7 dormant test |
| No emails/notifications | No `JOBS_REGISTRY` entry; v2 submit enqueues nothing; the no-notify pin (Task 20) |
| One profile per person from attributed facts | `loadPeopleFacts` + pure rules (Tasks 11, 12, 16) |
| Skills per position, learned, with evidence | Tasks 15–17 |
| Manager adjustment recorded/audited/shown; new hires from the manager rating | 0269; Tasks 16–17 |
| My Performance + team scoring read the SAME layer; no second scoring system | Tasks 11–13 (wrappers over one loader) |
| Equivalence pin: freeze first; unchanged until new inputs are switched on | Task 1 (golden alone, before any lib change); Task 23 (off ⇒ identical; on ⇒ only that shop moves) |
| PM v2: a copy per manager, private until the closing manager submits | 0270 + Tasks 19–21 (author-only reads, counts only, submit seals) |
| Per-station evaluations for stations actually worked (station events), criteria dropdowns + free text | `positionTimeline` + `rosterForCopy`; criteria per position; notes |
| After submit: side by side, attributed; averaged per person × station × criterion weighted by observation time; write-ins; recurring themes | Task 19 (`observationMinutes`, `averageGrades`, `writeInThemes`); Task 21 (results) |
| Results feed the people layer | Task 23 (PM signal into skills; v2 grades into `gradientTally` behind the switch) |
| Criteria draft per position for Juan | The draft table above + Q1 |
| Migrations from 0267; privilege ceiling, deny-all RLS, append-only history, PGlite per migration | Migrations table; Tasks 5, 9, 14, 18 |
| Location bind; SMM refused from people data; who sees whose PM copy; skills visibility | The permissions matrix; Tasks 2, 13, 16, 20 |
| Chunks of 3–5 tasks, TDD, pure first | 7 chunks (4/3/3/3/4/5/4); every task test-first; Chunk A is pure |
| i18n en/es tú, phone-first 375 px / 44 px, disclosure doctrine | Standing rules; Tasks 10, 17, 21, 22, 25 |
| Customer contact data never in logs; staff personal data minimal; wages considered | No customer table is touched; the normalizer drops PII with a leak test; wages have no reader (J4, Q5) |
| Never key on `EM`/`MEP` | Standing rule; the Task 26 grep |
| The mockup | Read from the bridge file; the Phase 1 / Phase 2 map above |
