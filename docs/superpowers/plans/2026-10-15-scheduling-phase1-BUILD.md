# Smart Scheduling — Phase 1 (Foundation) Build Plan

## The 7shifts read sync · the unified people layer · PM reports v2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **No app code is written until Astra APPROVES this plan** (CC's GO, 2026-10-15). After approval, each chunk is reviewed by Astra and gated by CC.

**Revision r1 (2026-10-15)** answers Astra's round 1 (CHANGES REQUESTED: 2 P1, 7 P2) and carries CC's lead rulings (`05-BRIDGE/from-cc/GO-coops-scheduling-p1-plan-r1-2026-10-15.md`):
- the migrations are renumbered **0268–0271**;
- the plan **depends on `0267_pm_evals_privacy`**, which is built separately and is not re-solved here;
- PM grades are bound to a valid position at the report's shop, in the lib AND in the DB;
- CC's defaults for the 11 open questions are applied (see "Resolved");
- the new spec additions (min shift length, one person per position, position priority, preferred cover positions, the §6.5 validator) are read from `origin/main` @ f79f4200, and the skill model now exposes what the Phase 2 scheduler needs (see "What Phase 2 reads");
- Juan's added Walk-ins criterion is included (CC note r1b).

**Revision r2 (2026-10-15)** answers Astra's round 2 (CHANGES REQUESTED: r1 P2-3 partly open, plus 3 new P2s). It adds three things:
- **response shapes per endpoint**: assignments, wages, labor settings and whoami are singletons, not cursor pages;
- **row-level snapshot completeness**: a row the normalizer rejects makes that user's snapshot incomplete, so nothing is retired and the watermark does not move;
- **tunables that can never make a skill undefined**: strict validation in both TS and SQL, a defined zero-weight rule, and finite-output property tests.

The finding-by-finding maps are the **Round 1 response** and **Round 2 response** tables at the end. **r0** was the first draft, at deb6823c; **r1** was at 6cc002fb.

**Prerequisite — `0267_pm_evals_privacy`.** This plan does not start Task 1 until 0267's PR has MERGED to main. That PR revokes the direct grants on the PM v1 tables, moves reads and writes to the service role, and lets employees read their own evals without `note`. Two consequences:
- The golden is frozen on top of 0267's library changes. If 0267 changes `loadMyFeedback` or any other output the golden covers, the golden records the post-0267 behaviour.
- 0271 is applied after 0267, and its preflight asserts that 0267 is present. Every v2 read goes through the service role, matching 0267's posture.

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
ls supabase/migrations | tail -3   # expect 0267_pm_evals_privacy present (the prerequisite); Catalog Phase 4 owns 0264–0266. This plan uses 0268–0271.
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

## Ground truth this plan is built on (verified 2026-10-15 against `origin/main` @ 2da88061; spec re-read at f79f4200 for r1)

| Fact | Where | What the plan does with it |
|---|---|---|
| Latest migration on main is **0263** (0256 is an unused gap). 0264–0266 are reserved for Catalog Phase 4, and **0267 = `pm_evals_privacy`** (built separately; the prerequisite) | `supabase/migrations/` | Phase 1 uses **0268, 0269, 0270, 0271**. Task 5 re-checks. |
| `station_events` is append-only (0217): `location_id, business_date, user_id, station_id, position_id (0219), kind assign/claim/move/release, actor_id (nullable since 0230), at, source, reason_code (0228/0230/0233), effective_at`. Service role SELECT + INSERT only. | 0217, 0219, 0228, 0230, 0233 | Position intervals come from it (pure `positionTimeline`, Task 3). Read only. |
| `station_positions` (0219): per shop (`location_id`), per station, `name`/`name_es`, `sort`, `active`; seed 42 names Walk-ins, Walk-ins / Online, Expeditor, Register & Delivery; every other station gets one default position named after it. Trims: `station_positions.usually_trims_at` (0230), `stations.trims` jsonb (0238). | 0219, 0230, 0238, `docs/seed/seed-42-stations.sql` | **"Position" in this plan = a `station_positions` row.** Skills, PM criteria and adjustments key on `position_id`, which is shop-scoped by construction. |
| `stationTimeline()` exists but is per STATION, not per position, and ignores `effective_at` | `lib/assignments-shared.ts:205` | A new pure `positionTimeline()` sits beside it (Task 3). The existing function is untouched. |
| Break releases are station events with `reason_code 'on_break'`; departures and closures release with `effective_at` (0230) | 0230 | An interval ends at `coalesce(effective_at, at)` of the next event for that person and day. |
| `assignment_changes` (0228) is the append-only task-assignment ledger; `report_assignments` carries assigner/assignee | 0228 | Used as evidence only ("assigned X 4 times"). It does not enter the skill math in Phase 1 (judgment J7). |
| `productions` carries `produced_at, made_by, batches_made, came_out_to, yield_at_time` (0215, applied 2026-10-07). `lib/yield-stats.ts` `loadBatches` (~line 91) reads ONE production row per batch observation, keeping only rows with `superseded_at is null`, `revoked_at is null`, `batches_made > 0`, and non-null `came_out_to` and `yield_at_time` (the `YieldBatch` shape in `lib/yield-stats-shared.ts:52`). A maker is recorded only for **batch-mode** recipes. | 0215, `lib/yield-stats.ts` | **r1 (P2-6):** prep evidence reuses EXACTLY that fact shape and those filters, one observation per production row. There is **no join to `prep_batch_sessions`**: `made_by` names a person, not a session, and a maker join multiplies rows. When a shop has no batch-mode recipes, the evidence line says "no maker recorded yet"; nothing is inferred. |
| `toast_employee_links` (0233) auto-links on an exact full-name match | 0233 | **Not copied.** 7shifts links are manual only (GO law). |
| `toast_time_entries` holds no wages by design (0224) | 0224 | 7shifts wages go to their own table with no reader in Phase 1 (judgment J4). |
| `pm_reports` (0072): one live row per (shop, day), status `open/submitted/incomplete_confirmed/auto_finalized`, `mvp_user_id`, `submitted_by`; user UPDATE dropped (0106). `pm_employee_evals` (0072/0073): four gradients `great/good/needs_work` + `area_to_improve` + `note`, supersede pattern. | 0072, 0073, 0106 | v2 keeps the day row (adds `format`). v1 tables are untouched. |
| `pm_evals_read_self` (0072) let an employee read their own `pm_employee_evals` rows, `note` included, through PostgREST (Astra r1 P1-2, confirmed) | 0072 → **0267_pm_evals_privacy** | **Fixed outside this plan by 0267** (lead ruling). This plan depends on it and does not re-solve it. The v2 tables are deny-all from birth. |
| `lib/team-metrics.ts`: `TEAM_VIEW_LEVEL = 6` (so **social_media_mgr, level 6, can open team scoring today**), `RANKED_MAX_LEVEL = 8`, the oversight location bind, `computePersonMetrics` shared by detail + self. **Its `Viewer` (line 90) is `{ userId, level, locations? }`, with NO role**, so an AGM and an SMM look identical to it. Callers: `my-feedback/page.tsx:90`, `reports/trends/page.tsx:74`, `reports/trends/team/page.tsx:68`, `…/team/[personId]/page.tsx:44,69`, and `lib/report-export.ts:249,269`, which passes a reports-hub `Viewer` structurally. | `lib/team-metrics.ts` | Refactor onto `lib/people/*` (Tasks 11–13). **r1 (P2-8):** `Viewer` gains a REQUIRED trusted `role: RoleCode` taken from the session. Every caller, export and fixture passes it, and the compiler finds every missed site. The SMM refusal is a deliberate tightening (Task 13). |
| `lib/profiles.ts` `loadPublicProfile` reads completions, MVP and gradients company-wide (no location bind on facts) | `lib/profiles.ts` | Moves onto the same loader with its current semantics frozen in the golden. Its company-wide scope is kept: it is the public card, not a performance view. |
| `lib/people-narrative.ts` returns i18n keys; `myPerformanceRead` is positive-only | — | Unchanged. The self skills view inherits the positive-only rule (bands, never ranks). |
| Toast labor pull: fixed error codes, one `AbortSignal` deadline over every await, fail-soft per shop, heartbeat audit `cron.success/cron.failure` with `job` | `lib/toast/labor.ts` | `lib/sevenshifts/sync.ts` copies this shape. |
| Cron lease `claim_cron_route(p_job)` with a CHECK on the job list | 0243, `lib/cron-route-lease.ts` | 0268 re-emits the function and CHECK with `'sevenshifts-sync'` added (line-subsequence pin). |
| `JOBS_REGISTRY` feeds `job-watch`, which **emails** an ops alert on a missing heartbeat | `lib/jobs-registry.ts` | **Not registered** (CC default R6: no email before launch). Sync health is shown in the app only, on the 7shifts screen, from the ledger. |
| `/admin/toast-employees` is the existing link screen (GM own shop, MoO+ all) | `app/admin/toast-employees`, `components/admin/toast-employees/ToastEmployeeLinks.tsx` | `/admin/sevenshifts` follows its layout and gates. |
| Fake PostgREST (`tests/fixtures/counts-fake-db.ts`), recording client (`tests/loader-schema-check.test.ts`), PGlite harnesses (`scripts/sql-harness-0263.mjs`) and migration pins (`tests/menu-item-shop-migration.test.ts`) | tests, scripts | Reused as patterns for the golden, the schema check and the four harnesses. |
| Audit vocabulary is closed (`AuditAction`) | `lib/audit-actions.ts`, `lib/destructive-actions.ts` | Every new action is registered in the task that first emits it (list in Task 4 Step 5 and per task). |
| `/pm-report` gate: KH+ (`PM_REPORT_BASE_LEVEL = 4`), `lockLocationContext`, `canDoOperationalTask(…, "pm_report")`; roster = `pmPresenceRoster(board)` | `app/(authed)/pm-report/page.tsx`, `lib/pm-report-shared.ts` | v2 keeps the same outer gates and the same roster source, plus people with a position interval. |
| v1 `submitPmReport` **enqueues a SHIFT_FEEDBACK notification** | `lib/pm-report.ts` | v2 submit enqueues nothing (no-notification rule). v1 is untouched; a v1 day behaves as today. |
| Spec additions on main since 2da88061 (`58e74a33`, `183f81c2`, `2bb62bf1`, `f79f4200`): min shift length (default 4 h); **one person per position** at a time; **position priority per station** (Prep/Dishwasher > Prep, Register & Delivery > Expeditor, Walk-ins / Online > Walk-ins); allowed roles per position; **preferred cover positions per manager**; the §6.5 `checkScheduleRules` validator | spec §5.7, §6.5 | These are all Phase 2 settings and rules, so **none is built here**. Phase 1 stays consistent with them in four ways. (1) Skills key on the same position rows the validator will check. (2) `station_positions.sort` is NOT read as priority: seed 42 puts Walk-ins and Expeditor at sort 1, the OPPOSITE of the spec's primaries, so Phase 2 needs an explicit priority setting. (3) The 0219 `position_taken` refusal already enforces one person per position on the floor, and `positionTimeline` relies on it. (4) The skill matrix exposes per-position skill, evidence and confidence for managers too, so Phase 2's preferred cover positions can rank them (see "What Phase 2 reads"). |

### 7shifts API facts (developers.7shifts.com, read 2026-10-15; no live call was made)
- Base `https://api.7shifts.com/v2`. `Authorization: Bearer <token>`. Every call sends `x-api-version` (current docs value **`2026-01-01`**, pinned in one constant).
- Company-scoped paths `GET /v2/company/{company_id}/…`. `GET /v2/whoami` gives the identity (and company).
- **Response shapes differ per endpoint (r2):**
  - List endpoints return `{ data: [...], meta: { cursor: { next, … } } }`.
  - `GET …/users/{id}/assignments` returns a SINGLETON `{ object: "assignments", data: { locations: [{id,name}], departments: [{id,company_id,location_id,name,…}], roles: [{id,company_id,location_id,department_id,name,is_primary?,skill_level?,sort?}] } }` with NO cursor (developers.7shifts.com/reference/getassignments, read 2026-10-15).
  - `…/users/{id}/wages` returns `{ data: { current_wages: [...], upcoming_wages: [...] } }` with no cursor.
  - `…/labor_settings` returns `{ object: "labor_settings", data: {…} }`.
  - `/v2/whoami` returns `{ object: "whoami", data: { identity_id, users: [{ company_id, … }] } }`; the company comes from the DISTINCT `users[].company_id`.
- **Cursor pagination** (paginated endpoints only): `limit` (1–500, default 100; punches default 20) + `cursor`. Follow `meta.cursor.next` until it is null. **r1 (P2-5):** "null" means the end ONLY when `meta.cursor` is a well-formed object whose `next` is explicitly null. Any other shape is `bad_pagination`, a distinct failure (Task 4).
- **Rate limits** (spec §2): 10 req/s and 600 req/min. Handle `429` with backoff.
- Paths: `users` (`status`, `modified_since` YYYY-MM-DD; the payload carries email, phones, birth date and wage, which we DROP) · `users/{id}/assignments` (also per-location / per-role list endpoints) · `users/{id}/wages` (`current_wages` / `upcoming_wages`: `wage_type hourly|weekly_salary|annual_salary`, `wage_cents`, `role_id`, `effective_date`) · `roles` · `departments` · `locations` · `availabilities` (`week_gte`, `repeating`; **min plan "The Works"**) · `time_off` · `shifts` (`start[gte|lte]`, `include_deleted`, `include_draft`, `modified_since`; fields `id, user_id, role_id, station_id, department_id, location_id, start, end, draft, open, deleted, modified`) · `time_punches` (`clocked_in[gte|lte]`, `modified_since`, `deleted`; it also carries `hourly_wage`, `tips`, `notes`, which we DROP) · `labor_settings` (OT thresholds and multipliers).
- **Stations:** shifts carry `station_id`, but the docs list **no stations endpoint**. Phase 1 stores `station_id` as a bare id. The station names/mapping wait for the spec §8 mapping screen (Phase 2), after the read-only look at CO's setup (spec §10).
- **Plan tiers differ per endpoint** (users: Entrée; availabilities: The Works; labor settings: a tier named in the docs). CC default R2: **assume Pro**. A `403` on one resource is recorded as `plan_forbidden` for that resource, and the rest of the run continues.
- **Assignments come back as the CURRENT set**, not as deletion events. A removed role or location assignment simply stops appearing, so the mirror must reconcile it (r1 P2-3, Task 7).
- Task 6 Step 1 re-reads each reference page and fixes any path or parameter that moved, in ONE table (`SEVENSHIFTS_ENDPOINTS`). Read-only, no token needed.

---

## The secret, the switches, the "Not connected" state

| Env var | Who sets it | Meaning |
|---|---|---|
| **`SEVENSHIFTS_ACCESS_TOKEN`** | **Juan only** (Vercel dashboard, Production + Preview as he chooses). CC and builders never set, read, print or log it. | The company access token from 7shifts Developer Tools. Absent → dormant. |
| `SEVENSHIFTS_SYNC` | CC, set to `1` AFTER 0268 + 0269 are applied (the `TOAST_LABOR_PULL=1` precedent) | The cron route and Sync now run only when `=1`. This keeps a deploy safe before the migrations land. |

`lib/sevenshifts/config.ts` exports `sevenShiftsStatus(): { state: "not_connected" | "sync_off" | "ready"; reason: "token_missing" | "sync_off" | null }`; the screen adds `not_supported` from the latest ledger row. It never returns the token, its length or a prefix. The 7shifts screen and every people surface that would use 7shifts facts render one plain line from it:
- `token_missing` → **"7shifts is not connected yet. Juan adds the access token; nothing is read until then."** / **"7shifts aún no está conectado. Juan agrega el token de acceso; no se lee nada hasta entonces."**
- `sync_off` → "7shifts is connected, but syncing is switched off." / "7shifts está conectado, pero la sincronización está apagada."
- `ready` → the last run from the ledger: "Last synced 2:14 PM · 9 of 10 parts OK · Time off needs a higher 7shifts plan".

The company id is NOT a second secret. Each run calls `whoami` once and uses the company it returns. **One company per token is the supported shape (R2).** A token that sees more than one company yields the status `not_supported` (reason `multi_company`, shown as "This 7shifts token covers more than one company, which CO-OPS doesn't support yet" / "Este token de 7shifts cubre más de una empresa, y CO-OPS todavía no lo admite"). The run writes a ledger row with status `failed` and code `multi_company`, and reads nothing else.

---

## Permissions (all in `lib/people/access-shared.ts`, pure, called before any I/O)

`LEVEL`: owner 9, MoO 8, GM 7, AGM / catering_mgr / prep_mgr / social_media_mgr 6, SL 5, KH / trainer 4, employee 3. Location bind = the person's `user_locations` (level 9+: all). "Op-6" = `agm`, `catering_mgr`, `prep_mgr` (level 6 **minus** `social_media_mgr`).

**r1 (P2-8): every rule takes the trusted ROLE, not just a level.** The actor shape is `PeopleActor = { userId: string; role: RoleCode; level: number; locations: readonly string[] }`, built ONCE per request from the verified session (`auth.user.id`, `auth.role`, `auth.level`, `auth.locations`) by `peopleActorFromAuth(auth)`. No function accepts a level without a role, and the team-metrics `Viewer` gains a required `role` field.

| Act | Rule |
|---|---|
| Team scoring, person detail, person report locations, skills of others (read) | Op-6 or GM, own shops only. MoO (8)+ any shop. **`social_media_mgr` refused by ROLE** (the `catalogWriteRoleAllowed` precedent). Below 6: never. Keeps today's level-6 operational access (**R7**). |
| My Performance / my skills / my feedback | Self only; the person always comes from the session, never a param (today's rule). Skills appear as a band, **Strong / Solid / Building** (es: **Fuerte / Sólido / En progreso**), with positive evidence lines. No number, no rank, and **never a manager adjustment** (neither its existence nor its amount) (**R8**). |
| Manager adjustment / new-hire rating (write) | GM (7) own shop, MoO (8)+ any shop. The actor must outrank the subject (`canActOn`), so a GM cannot adjust a GM. A reason code is required (`coverage_change`-style closed list: `observed_on_floor`, `training_completed`, `correction`, `other` + note). |
| People shop settings: the PM v2 switch and the prep evidence position | GM own shop, MoO+ any. Audited. |
| Skill tunables (the constants as settings, **R11**) | MoO (8)+ only, inside the Tier E window, because they shape how every shop's people are read; one company-wide row plus an optional per-shop override. Audited. |
| PM criteria editor | GM own shop, MoO+ any, **inside the Tier E edit window** (`assertStepUp(ctx, "E")`, the catalog's 15-minute password window; **R10**). Audited. |
| 7shifts shop links | MoO (8)+ (company-level config). |
| 7shifts person links | GM own shop (the CO-OPS user must hold an active membership there), MoO+ any. Actor ≥ subject level. |
| 7shifts status + Sync now | Status: GM+ and Op-6 own shop. Sync now: MoO+ (it spends the shared rate budget). |
| **Wages** (`sevenshifts_wages`) | **R5:** individual rates are visible to **MoO (8)+ only**; a GM sees **shop totals** for their own shop. Phase 1 builds no wage surface. The two rules ship now as pure functions, `canSeeWageRates(actor)` and `canSeeShopLaborTotals(actor, locationId)`, with tests, ready for Phase 2. Phase 1's status line shows a COUNT only ("wages for 31 people"), and no rate appears on any surface, export or log. |
| PM v2 copy: write (grades, notes, added positions, window) | KH+ with pm_report task access at the shop today (today's `requirePmTask`), not SMM, and only their OWN copy, **only while the copy is `open`** and the day is open. |
| PM v2 copy: lifecycle (**r1 P2-9, ONE lifecycle**) | `open` → (Mark done) → `done` → (Reopen, author only, day still open) → `open` → … → `sealed` at submit. **A `done` copy is read-only**: every write is refused `copy_done` until the author taps Reopen. Submit seals `open` and `done` copies alike. The same table drives `canWritePmCopy` / `canMarkDone` / `canReopenPmCopy`, the RPC guards and the UI states (Tasks 2, 18, 21). |
| PM v2 copy: read BEFORE submit | **Its author only.** Nobody else, MoO and Owner included (blind by design, so the average is independent). Others see COUNTS only ("2 copies started"). |
| PM v2 day: read AFTER submit | That day's copy authors; GM / Op-6 of that shop; MoO+ any shop. Not SMM. Not other KH/SL of the shop (J9). |
| PM v2 feedback: the subject | Their own averaged grades per position and criterion, as bands, from SUBMITTED days only, without author names and **without free text** (**R9**, consistent with 0267). |
| Submit the day (= closing manager) | Today's v1 rule: KH+ with pm_report task access, not SMM. The submitter is recorded as the closing manager. |

---

## Migrations (authored only; each with a PGlite harness + CI pin)

| # | File | Tables / functions | Kind | service_role ceiling |
|---|---|---|---|---|
| 0268 | `0268_sevenshifts_sync.sql` | `sevenshifts_sync_runs` (ledger) | append-only | SELECT, INSERT |
| | | `sevenshifts_sync_state` (resource watermark, one row per resource) | config/state | SELECT, INSERT, UPDATE |
| | | `sevenshifts_locations`, `sevenshifts_departments`, `sevenshifts_roles`, `sevenshifts_users`, `sevenshifts_availabilities`, `sevenshifts_time_off`, `sevenshifts_shifts`, `sevenshifts_time_punches`, `sevenshifts_labor_settings` | provider MIRRORS, each with its OWN conflict key (the mirror spec table in Task 5), never deleted | SELECT, INSERT, UPDATE |
| | | `sevenshifts_user_assignments`, `sevenshifts_wages` | SNAPSHOT-RECONCILED mirrors: an `active` marker plus `first_seen_run` / `last_seen_run` / `retired_run`; history kept (r1 P2-3) | SELECT only (written by the reconciler RPC) |
| | | `reconcile_sevenshifts_user_snapshot(p_run, p_user, p_kind, p_complete, p_rows)` | SECURITY DEFINER, pinned, service_role only | — |
| | | re-emit `claim_cron_route(text)` + `cron_route_leases_job_check` with `'sevenshifts-sync'` | function | EXECUTE service_role only |
| 0269 | `0269_sevenshifts_links.sql` | `sevenshifts_location_links`, `sevenshifts_user_links` (append-only; unlink = `active=false`) | append-only by grant | SELECT only (writers are definer RPCs) |
| | | `link_sevenshifts_location`, `unlink_sevenshifts_location`, `link_sevenshifts_user`, `unlink_sevenshifts_user` | SECURITY DEFINER, `search_path = pg_catalog, public`, service_role only | — |
| 0270 | `0270_people_layer.sql` | `people_shop_settings` (one row per shop) | config | SELECT, INSERT, UPDATE |
| | | `people_skill_tunables` (one company row `location_id NULL` + optional shop rows; jsonb validated by `valid_skill_tunables(jsonb)`) | config | SELECT, INSERT, UPDATE |
| | | `people_skill_adjustments`, `people_skill_ratings` | append-only | SELECT, INSERT |
| 0271 | `0271_pm_reports_v2.sql` | `pm_reports.format` (new column, default `'v1'`) | additive | (existing grants) |
| | | `pm_criteria` | config (deactivate, never delete) | SELECT, INSERT, UPDATE |
| | | `pm_report_copies` | one row per manager per day; status `open → done → sealed` | SELECT only (RPC writers) |
| | | `pm_copy_positions`, `pm_copy_grades`, `pm_copy_notes` | append-only with supersede; **each carries `location_id` with COMPOSITE FKs proving the copy, criterion and position all belong to the report's shop** (r1 P1-1) | SELECT only (RPC writers) |
| | | `open_pm_copy`, `save_pm_copy_grade`, `save_pm_copy_note`, `add_pm_copy_position`, `set_pm_copy_window`, `mark_pm_copy_done`, `reopen_pm_copy`, `submit_pm_day_v2`, helper `pm_subject_worked_position` | SECURITY DEFINER, pinned, service_role only | — |

**Order and dependency:** 0267_pm_evals_privacy (separate, prerequisite) → 0268 → 0269 → 0270 → 0271. 0271's preflight asserts that 0267 is applied (the `pm_evals_read_self` policy is gone).

Every table: `enable row level security`, NO user policies (the 0257/0203 posture), `revoke all … from public, anon, authenticated, service_role`, then the exact grant, then a `do $$` guard that raises if any of `anon`/`authenticated`/`PUBLIC` holds anything or `service_role` holds DELETE/TRUNCATE/REFERENCES/TRIGGER, or lacks a needed privilege. Every function: `revoke all … from public, anon, authenticated` plus `grant execute … to service_role`, with an `information_schema.routine_privileges` guard. Sequences: revoked from the PostgREST roles.

---

## The mockup: what is Phase 1, what waits

| Mockup part | Phase | Phase 1 shape |
|---|---|---|
| "Staff skills, work types, days off, and soft hours": per position a bar 0–1, caption "Worked data: stations, tasks, prep · manager adjustment optional", a ± adjustment in 0.05 steps clamped to ±0.30 | **Phase 1 (skills + adjustment only)** | The person's **Skills** section on `/reports/trends/team/[personId]`: one row per position worked (bar + value + "Manager adjustment +0.10" chip + evidence lines in a drawer + an Adjust control with the same step/clamp, reason required). Work types, days off, flex day and soft hours are Phase 2 (§5.1, §5.5), so they are NOT built. |
| Default skill when no data (mockup 0.5; management 0.7; Prep/Dishwasher 0.65) | Phase 1 | The PRIOR in the skill model is the manager's rating, else a neutral 0.5. The mockup's role-based defaults are not adopted (they are sample data; J5). |
| "close" pseudo-skill ("closes on time 96%") | Phase 1 as **evidence**, Phase 2 as a skill | "Closing on time" shows as an evidence line on the person's profile. A Closing Manager skill waits for the Phase 2 role. |
| Positions list (Crunchy Boi Station, 3rd Party Station, Walk-ins, Walk-ins / Online, Expeditor, Register & Delivery, Prep, Prep/Dishwasher) | Data | Read from `station_positions`. **R3:** a one-time data step (Task 14b, dry run first, done through the existing station admin, never a migration) names the two BOH positions "Prep" and "Prep/Dishwasher" at both shops. |
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
- `lib/people/skills.ts` — `loadSkills`, `loadSkillMatrix` (the Phase 2 read: every person × position at a shop), `adjustSkill`, `rateNewHire` (lib-gated, audited).
- `lib/people/tunables-shared.ts` / `lib/people/tunables.ts` — `SKILL_TUNABLE_DEFAULTS`, the pure validator `validSkillTunables`, `resolveTunables(company, shop)`, the loader and the MoO+ writer.
- `lib/sevenshifts/mirror-spec-shared.ts` — `MIRROR_WRITE_SPEC`: per resource, its table, its normalizer, its conflict key or reconcile mode.
- `scripts/check-boh-positions.ts` — the read-only dry run for the BOH positions data step (R3).
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
- `tests/sevenshifts-mirror-upsert.test.ts` (PGlite: every mirror's real upsert/reconcile against its declared schema), `tests/people-skill-tunables.test.ts`, `tests/people-role-carry.test.ts`, `tests/pm-copy-lifecycle.test.ts`, `tests/people-skills-finite.test.ts`, `tests/fixtures/skill-tunables-cases.json`, `tests/fixtures/sevenshifts/assignments-doc-example.json`.
- `tests/sevenshifts-rate-limit.test.ts`, `tests/sevenshifts-paginate.test.ts`, `tests/sevenshifts-normalize.test.ts`, `tests/sevenshifts-client.test.ts`, `tests/sevenshifts-sync.test.ts`, `tests/sevenshifts-links.test.ts`, `tests/sevenshifts-screen-ui.test.ts`.
- `tests/pm-report-v2-shared.test.ts`, `tests/pm-report-v2.test.ts`, `tests/pm-report-v2-ui.test.ts`, `tests/pm-report-v2-no-notify.test.ts`.
- `tests/sevenshifts-sync-migration.test.ts`, `tests/sevenshifts-links-migration.test.ts`, `tests/people-layer-migration.test.ts`, `tests/pm-reports-v2-migration.test.ts`.
- `scripts/sql-harness-0268.mjs` … `0271.mjs`, `tests/fixtures/scheduling-pglite-stub.sql` (stub base tables: `users`, `locations`, `user_locations`, `stations`, `station_positions`, `station_events`, `pm_reports`, `pm_employee_evals` (post-0267 shape), `productions` (0101 + 0215 + the superseded/revoked columns), `audit_log`, `cron_route_leases`, copied from their real migrations' column lists).

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

**Precondition:** `0267_pm_evals_privacy`'s PR has merged to main and this branch is cut after it. The golden freezes the post-0267 library behaviour.

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

  Viewers are AGM, GM and MoO. Every viewer object in the harness ALREADY carries its `role` (an extra field today's loaders ignore), so Task 11's required `role` is a type change, never a golden change. (**SMM is NOT in the golden.** Its refusal is a deliberate change, pinned separately in Task 13.) The output is a plain JSON object keyed by call.
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
  - **the ONE copy lifecycle (r1 P2-9)**, exported as data so the RPC test and the UI test pin the SAME table:
    ```ts
    export const PM_COPY_TRANSITIONS = {
      write:    { from: ["open"],          to: "open" },   // grade, note, add position, window
      markDone: { from: ["open"],          to: "done" },
      reopen:   { from: ["done"],          to: "open" },   // author only, day open
      seal:     { from: ["open", "done"],  to: "sealed" }, // submit only
    } as const;
    ```
    `canWritePmCopy(actor, copy, day)` (author, `copy.status === "open"`, day open, not SMM); `canMarkDone` (same, open → done); `canReopenPmCopy` (author, `copy.status === "done"`, day open). A done copy is read-only, and a write on it is refused `copy_done`;
  - `canSubmitPmDay(actor)` (not SMM; the task-access check stays in the lib's I/O half);
  - `canSeeWageRates(actor)` (8+) and `canSeeShopLaborTotals(actor, locationId)` (GM own shop, 8+ any; not SMM) (R5; no Phase 1 caller, tests only);
  - `canEditSkillTunables(actor)` (8+, R11).

  `actor` is `PeopleActor = { userId, role, level, locations: readonly string[] }`, never a JWT, built by `peopleActorFromAuth(auth)`. **r1 (P2-8):** a test proves that two actors with the SAME level 6 and the same shop get different answers by role: AGM, prep_mgr and catering_mgr are allowed, social_media_mgr is refused. Another test proves `peopleActorFromAuth` takes `role` from `auth.role` and level from `auth.level`, never from a request body.
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
- [ ] **Step 2: response shapes (r2 #1) and the paginator (r1 P2-5).** Every `SEVENSHIFTS_ENDPOINTS` entry declares `shape: "paginated" | "singleton" | "list-unpaginated"`, and the client dispatches on it. **Only `paginated` entries go through `pageStep` and demand cursor metadata.**

  | Resource | Shape | Validator |
  |---|---|---|
  | locations, departments, roles, users, availabilities, time_off, shifts, time_punches | `paginated` | `pageStep` (below) |
  | assignments | `singleton` | `assignmentsSnapshot(json)`: `data` is an object; `data.locations`, `data.departments`, `data.roles` are each an ARRAY (an absent key or a non-array is `bad_snapshot`); `object`, when present, equals `"assignments"` |
  | wages | `singleton` | `wagesSnapshot(json)`: `data.current_wages` and `data.upcoming_wages` are arrays |
  | labor_settings | `singleton` | `laborSettingsSnapshot(json)`: `data` is an object |
  | whoami | `singleton` | `whoamiSnapshot(json)`: `data.users` is an array; companies = the distinct `company_id` |
  | (none today) | `list-unpaginated` | `data` is an array and no cursor is demanded. The shape exists so an endpoint the build-time doc re-read (Task 6 Step 1) finds unpaginated is declared, never forced through `pageStep` |

  A singleton that fails its validator is the resource error **`bad_snapshot`**: a failure, never an empty success. A singleton that carries a `meta.cursor` anyway is ignored (one request, no follow).

  `pageStep(json): { kind: "next"; cursor: string } | { kind: "end" } | { kind: "malformed" }` (paginated only):
  - **`end` ONLY** when `meta` is an object, `meta.cursor` is an object, and `meta.cursor.next` is explicitly `null`.
  - A non-empty string is `next`.
  - **Everything else is `malformed`**: missing `meta`, missing `cursor`, `next` absent/undefined/number/object/empty string, or `data` not an array.
  - `followPages` turns `malformed` into the resource error **`bad_pagination`**, `page_cap` past `MAX_PAGES_PER_RESOURCE = 200`, and a repeated cursor into `cursor_loop`. **All three are FAILURES of that resource**, never a successful end. Rows from earlier, good pages may still be upserted (an upsert is idempotent), but the resource is marked failed, so its **watermark does not move** and a snapshot built from it is **incomplete** (Task 7).
  - Tests: each malformed shape on page 1; **a valid page 1 followed by a malformed page 2 → `bad_pagination`, the rows of page 1 are returned with `complete: false`**; an explicit null on page 3 → `end` with `complete: true`; a repeated cursor; the page cap.
  - **Tests per shape (r2 #1):**
    - `paginated`: as above;
    - `singleton`: the documented assignments example verbatim (fixture `tests/fixtures/sevenshifts/assignments-doc-example.json`) is ACCEPTED with no cursor; a payload with `data.roles` missing or set to an object is `bad_snapshot`; the same for wages, labor settings and whoami (one or two companies);
    - `list-unpaginated`: an array with no meta is accepted and a non-array is refused;
    - every entry in `SEVENSHIFTS_ENDPOINTS` declares a shape, and the table above is pinned (assignments, wages, labor_settings and whoami are `singleton`).
- [ ] **Step 3: the normalizers.** One function per resource → a row typed for its table. Each one:
  - **drops** email, mobile/home numbers, birth date, `hourly_wage` (users, punches), tips, notes, availability `*_comments`/`*_reason`/`status_action_message`, time-off comments;
  - keeps the 7shifts ids as strings of digits validated with `/^\d{1,18}$/` (stored as `bigint`);
  - keeps instants as ISO strings and `deleted` booleans;
  - never throws: it returns `{ rows, rejected }`, where `rejected` lists each refused input row by index with a fixed reason code (`bad_id`, `bad_instant`, `missing_field`, …). **A rejection is reported, never silently dropped (r2 #2):** for list resources it is counted as `skipped` and the resource is marked failed for that run, so its watermark does not move; for the snapshot kinds (assignments, wages) ANY rejection makes that user's snapshot incomplete (Task 7).
  - **assignments (r2 #1):** `normalizeAssignments(userId, snapshot)` turns the singleton into EDGES. Each `roles[]` entry gives `(location_id, department_id, role_id, is_primary)`. Each department with no role under it gives `(location_id, department_id, -)`. Each location with no department or role under it gives `(location_id, -, -)`. A role whose `location_id` / `department_id` are not among the snapshot's own `locations` / `departments` is still an edge (7shifts is the authority), and the case is tested.

  Users keep `first_name`, `last_name`, `preferred_first_name`, `active`, `type`, `hire_date`, `skill_level`, and **`employee_id`** (R4: the link screen shows it). That is what a manager needs to recognise a person on the link screen, plus a tenure hint for new hires. **`punch_id` is NOT kept**: it is a clock-in credential. A **leak test** feeds a fully-populated payload and asserts that no output value contains the planted email, phone, birth date, wage, tip or note strings (deep scan of the JSON).
- [ ] **Step 3b: the mirror write spec (r1 P2-4).** `lib/sevenshifts/mirror-spec-shared.ts` exports ONE table, the only place a resource's write shape is decided. Every resource has its own key:

  | Resource | Table | Mode | Conflict key / identity |
  |---|---|---|---|
  | locations | `sevenshifts_locations` | upsert | `(id)` |
  | departments | `sevenshifts_departments` | upsert | `(id)` |
  | roles | `sevenshifts_roles` | upsert | `(id)` |
  | users | `sevenshifts_users` | upsert | `(id)` |
  | availabilities | `sevenshifts_availabilities` | upsert | `(id)` |
  | time_off | `sevenshifts_time_off` | upsert | `(id)` |
  | shifts | `sevenshifts_shifts` | upsert | `(id)` |
  | time_punches | `sevenshifts_time_punches` | upsert | `(id)` |
  | labor_settings | `sevenshifts_labor_settings` | upsert | `(company_id)` |
  | assignments | `sevenshifts_user_assignments` | **reconcile per user** | `edge_key` = `user_id:location_id:department_id:role_id` (each `-` when null), built by the pure `assignmentEdgeKey`; one LIVE row per `edge_key` (partial unique index `where active`) |
  | wages | `sevenshifts_wages` | **reconcile per user** | `(user_id, wage_id, upcoming)`; one LIVE row per triple (partial unique index `where active`) |

  Each entry names its normalizer, the exact `onConflict` column list (upsert mode) or the reconcile kind, and the column set the normalizer emits. Tests: every normalizer's output keys equal the spec's column set exactly; `assignmentEdgeKey` is stable and nulls are spelled `-`; the spec has one entry per `SevenShiftsResource` and none extra. The DB half is proven in Task 5 Step 6b.
- [ ] **Step 4: the endpoint table.** `SEVENSHIFTS_API_VERSION = "2026-01-01"` and `SEVENSHIFTS_ENDPOINTS: Record<SevenShiftsResource, { path(companyId: string, extra?) => string; params(window) => URLSearchParams }>` for `whoami, locations, departments, roles, users, assignments, wages, availabilities, time_off, shifts, time_punches, labor_settings`. Test: every path starts with `/v2/` and no path contains a token or an email.
- [ ] **Step 5: register the audit actions now** (compile-time vocabulary for the later tasks). DESTRUCTIVE:
  - `sevenshifts_location_link.create`, `sevenshifts_location_link.deactivate`;
  - `sevenshifts_user_link.create`, `sevenshifts_user_link.deactivate`;
  - `people.skill_adjust`, `people.skill_rating`, `people.shop_settings_update`, `people.skill_tunables_update`;
  - `pm_criteria.create`, `pm_criteria.update`.

  NON-DESTRUCTIVE:
  - `sevenshifts.sync_requested`;
  - `pm_report.copy_open`, `pm_report.copy_grade`, `pm_report.copy_note`, `pm_report.copy_position_add`, `pm_report.copy_window`, `pm_report.copy_done`, `pm_report.copy_reopen`, `pm_report.submit_v2`. These mirror `pm_report.submit` being non-destructive: evaluations are an observation of people, not a change to the kitchen's configuration.

  `tests/audit-actions.test.ts` stays green.
- [ ] **Step 6:** green. Commit.

---

# Chunk B — The 7shifts read sync (Tasks 5–7)

## Task 5: Migration 0268 — mirrors, ledger, sync state, the lease

**Files:** create `supabase/migrations/0268_sevenshifts_sync.sql`, `scripts/sql-harness-0268.mjs`, `tests/fixtures/scheduling-pglite-stub.sql`, `tests/sevenshifts-sync-migration.test.ts`.

- [ ] **Step 1:** `ls supabase/migrations | tail -3`. If 0268 is taken, renumber this whole plan's four migrations in one commit and tell CC.
- [ ] **Step 2: the header.** House format: `-- Migration 0268_sevenshifts_sync` / `-- AUTHORED 2026-10-1x. NOT YET APPLIED — apply via MCP after review (sim first, prod on Juan's word, BEFORE SEVENSHIFTS_SYNC=1).` A WHAT / WHO READS-WRITES / PRE-FLIGHT / VERIFY block, as in 0257. A preflight `do $$` asserts `cron_route_leases` + `claim_cron_route(text)` exist with 0243's body and that none of the new tables exist.
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
-- (r1 P2-3) assignments are a SNAPSHOT-RECONCILED mirror with history:
create table public.sevenshifts_user_assignments (
  id uuid primary key default gen_random_uuid(),
  edge_key text not null check (edge_key ~ '^\d{1,18}:(\d{1,18}|-):(\d{1,18}|-):(\d{1,18}|-)$'),
  user_id bigint not null, location_id bigint, department_id bigint, role_id bigint, is_primary boolean,
  active boolean not null default true,
  first_seen_run uuid not null references public.sevenshifts_sync_runs(id),
  last_seen_run uuid not null references public.sevenshifts_sync_runs(id),
  retired_run uuid references public.sevenshifts_sync_runs(id), retired_at timestamptz,
  check (active = (retired_run is null)), check ((retired_run is null) = (retired_at is null))
);
create unique index sevenshifts_user_assignments_one_live on public.sevenshifts_user_assignments(edge_key) where active;
create index sevenshifts_user_assignments_user on public.sevenshifts_user_assignments(user_id, active);
-- A reappearing edge after retirement is a NEW row (history kept). The *_run columns reference
-- sevenshifts_sync_run_ids (Step 3b): the run id is minted up front, the ledger row lands at the end.
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
-- sevenshifts_wages: the same reconciled shape: id uuid pk, user_id bigint, wage_id bigint, upcoming boolean,
--   effective_date date, wage_type text check in ('hourly','weekly_salary','annual_salary'), wage_cents integer check >= 0,
--   role_id bigint, active, first_seen_run, last_seen_run, retired_run, retired_at (same checks);
--   unique (user_id, wage_id, upcoming) where active. An upcoming wage that becomes current is a retire + a new live row.
-- sevenshifts_labor_settings (company_id bigint primary key, daily_ot_threshold numeric, weekly_ot_threshold numeric,
--   premium_ot_threshold numeric, consecutive_days_threshold integer, overtime_enabled boolean,
--   overtime_by_location_enabled boolean, multipliers jsonb, pulled_at)
```

- [ ] **Step 3b: run identity before the ledger row.** The reconciled mirrors reference a run, but the ledger row is written at the END of a run (append-only, no UPDATE). So 0268 adds `sevenshifts_sync_run_ids (id uuid primary key default gen_random_uuid(), started_at timestamptz not null default clock_timestamp(), trigger text not null)` (SELECT, INSERT ceiling). It is minted first, the ledger row `sevenshifts_sync_runs.id` reuses the same id (FK to `sevenshifts_sync_run_ids`), and the `*_run` columns above reference `sevenshifts_sync_run_ids(id)`. A run that dies mid-way leaves its id, with no ledger row, which the screen shows as "interrupted".
- [ ] **Step 3c: the reconciler RPC (r1 P2-3).** `reconcile_sevenshifts_user_snapshot(p_run uuid, p_user bigint, p_kind text, p_complete boolean, p_rows jsonb) returns jsonb`. It is SECURITY DEFINER, pinned, service_role only, takes the advisory lock `hashtextextended('sevenshifts-snap/'||p_kind||'/'||p_user,0)`, and does this in ONE transaction:
  1. validates `p_kind in ('assignments','wages')` and every row's shape (an invalid row → `invalid_payload`; nothing is written);
  2. for each row: if a LIVE row with the same identity exists → `last_seen_run = p_run` (and refreshes `is_primary` / the wage fields); else INSERT a new live row with `first_seen_run = last_seen_run = p_run`;
  3. **only when `p_complete` is true**: `update … set active = false, retired_run = p_run, retired_at = clock_timestamp() where user_id = p_user and active and last_seen_run <> p_run`;
  4. when `p_complete` is false: NO retirement, and it returns `{ retired: 0, refused_retire: 'snapshot_incomplete' }`.

  Returns `{ seen, inserted, retired }`. **What "complete" means (r2 #2, closing r1 P2-3):** the lib passes `p_complete = true` ONLY when ALL of these hold for that user:
  - the singleton request succeeded;
  - its shape validator passed (no `bad_snapshot`);
  - **the normalizer rejected ZERO rows** of that user's snapshot.

  One rejected row (an edge whose ids fail validation, or a wage with an unknown `wage_type`) makes the whole user snapshot INCOMPLETE, because the rejected row may be exactly the live edge a retire would wrongly close. The valid rows are still passed (adds and updates only), and the retire step does not run. The ledger records `incomplete_snapshot` for that user's resource, with a failure count, and the resource's watermark does not advance.

  An EMPTY snapshot that was received, passed the shape validator and had zero rejections is complete. It retires every live row of that user (a person stripped of every role), which is correct and tested. **Empty-because-everything-was-rejected is NOT empty**: it is incomplete.

  The RPC also defends itself: `p_complete = true` with any row failing ITS validation → `invalid_payload`, and nothing is written.

  Indexes:
  - `sevenshifts_shifts (location_id, start_at)`;
  - `sevenshifts_time_punches (location_id, clocked_in)`;
  - `sevenshifts_time_punches (user_id, clocked_in)`;
  - `sevenshifts_availabilities (user_id, week)`.

  `comment on table` for each, naming the writer (`lib/sevenshifts/sync.ts`) and the PII rule.
- [ ] **Step 4: grants.** The nine upsert mirrors and `sevenshifts_sync_state`: the SELECT/INSERT/UPDATE ceiling. `sevenshifts_user_assignments` and `sevenshifts_wages`: **SELECT only** (the reconciler is their one writer, so a plain upsert cannot bypass the snapshot rule). `sevenshifts_sync_runs` and `sevenshifts_sync_run_ids`: the SELECT/INSERT ceiling (append-only by grant). RLS on everywhere, with no policies. The ceiling guard `do $$` loops over every table, in the 0238/0257 shape.
- [ ] **Step 5: the lease.** `alter table public.cron_route_leases drop constraint cron_route_leases_job_check, add constraint cron_route_leases_job_check check (job in ('toast-sales-today','toast-catering-scan','sevenshifts-sync'))`. Look up the real constraint name in the PGlite harness (`pg_constraint`); if 0243's inline CHECK got an auto-generated name, use that name and assert it in the preflight. Re-emit `claim_cron_route` with the same body and the job list extended; the lease interval stays 330 s (the hourly sync finishes well inside it).
- [ ] **Step 6: the harness `scripts/sql-harness-0268.mjs`** applies the stub plus the REAL 0243 + 0268 and proves:
  - H1 every table exists with RLS on and no policy;
  - H2 `anon`/`authenticated` hold nothing, and `service_role` is exactly at its ceiling (DELETE/TRUNCATE refused at `set role service_role`);
  - H3 the ledger refuses UPDATE under `service_role`;
  - H4 each UPSERT mirror accepts its OWN conflict target from the mirror spec (`(id)` for eight tables, `(company_id)` for labor settings), and a second upsert with changed values updates in place;
  - H4b the reconciler:
    - (a) snapshot 1 = {A, B} complete → two live rows;
    - (b) snapshot 2 = {B, C} complete → A retired with `retired_run`, B `last_seen_run` advanced, C inserted;
    - (c) snapshot 3 = {C} with `p_complete=false` → B NOT retired, `refused_retire: snapshot_incomplete`;
    - (c2) live {A, B}; the next call passes {A} with `p_complete=false` (B's payload was rejected upstream) → B stays LIVE, A's `last_seen_run` advances;
    - (d) A reappears → a NEW live row, and the retired A row stays as history;
    - (e) an empty complete snapshot retires all;
    - (f) the same for wages, including upcoming → current;
    - (g) `service_role` cannot INSERT/UPDATE the two reconciled tables directly;
  - H5 `claim_cron_route('sevenshifts-sync')` claims once and refuses within the lease, and the two old jobs still claim;
  - H6 the PII columns do not exist (`information_schema.columns` has no `email|phone|mobile|birth|tip|note|comment|reason|hourly_wage` column on any `sevenshifts_*` table, wages excepted for `wage_cents`).

  It prints `PASS 0268:`.
- [ ] **Step 6b: the real-upsert test (r1 P2-4)** `tests/sevenshifts-mirror-upsert.test.ts` (vitest + PGlite, in the `tests/recipe-loader-schema-check.test.ts` pattern). It applies the stub plus the REAL 0243 + 0268, then for EVERY `MIRROR_WRITE_SPEC` entry feeds a realistic 7shifts payload fixture through the REAL normalizer:
  - **upsert mode:** builds the statement from the spec (`insert into <table> (<normalizer keys>) values … on conflict (<spec key>) do update set …`) and runs it twice (insert, then update). A missing column, a conflict key with no unique index, or a type mismatch fails the test;
  - **reconcile mode:** calls `reconcile_sevenshifts_user_snapshot` with the normalized rows.

  This is the test that would have caught the r0 "`on conflict (id)` everywhere" contradiction.
- [ ] **Step 7: the pin** `tests/sevenshifts-sync-migration.test.ts`:
  - the header/gate line (with the later APPLIED-stamp tolerance of the 0263 pin);
  - the harness runs green via `execFileSync`;
  - `claim_cron_route`'s 0243 body is a line-subsequence of the 0268 re-emit (`extractFunction` + `normalize` from `scripts/recipe-versions/reemit-mods`).
- [ ] **Step 8:** green (`node scripts/sql-harness-0268.mjs`; `npx vitest run tests/sevenshifts-sync-migration.test.ts`). Commit.

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
    - dispatches on the endpoint's declared `shape`: follows cursors through `paginate-shared` for `paginated` only; makes ONE request and runs the shape validator for `singleton` and `list-unpaginated` (r2 #1);
    - counts requests;
    - never puts the response body, URL or token in an error message.
  - The module exports no POST/PUT/PATCH/DELETE, pinned by a source scan: `client.ts` contains no `method:` other than `"GET"`.
- [ ] **Step 3:** implement (`import "server-only"`). Fetch is `globalThis.fetch` unless injected. `cache: "no-store"`. One `AbortSignal` per call, from the run's deadline.
- [ ] **Step 4:** add to `.env.local.example`: `SEVENSHIFTS_ACCESS_TOKEN=` (comment: "Juan sets this in Vercel; never commit or paste it") and `SEVENSHIFTS_SYNC=` (comment: "1 after 0268 + 0269 are applied").
- [ ] **Step 5:** green. Commit.

## Task 7: The sync run and the ledger

**Files:** create `lib/sevenshifts/sync.ts`, `tests/sevenshifts-sync.test.ts`.

- [ ] **Step 1 (tests first, fake fetch + fake db):**
  - **dormant:** no token → returns `{ ran: false, reason: "token_missing" }`, makes ZERO fetch calls, writes NO ledger row (nothing ran) and no heartbeat;
  - **order:** whoami → locations → departments → roles → users → assignments (per user) → wages (per user) → labor_settings → availabilities → time_off → shifts → time_punches;
  - **fail-soft:** a 403 on availabilities records `plan_forbidden` for that resource only, and the others land; a 401 at whoami stops the run with status `failed`; **whoami listing several companies → status `failed`, code `multi_company`, and nothing else is read** (R2: "not supported");
  - **windows:** the first run backfills shifts and punches from `today − 90 days`; later runs use `modified_since = watermark − 48 h` (overlap; upsert makes it idempotent). The watermark advances ONLY for a resource that fully succeeded;
  - **deadline:** when the budget runs out mid-resource, that resource is `deadline`, its watermark does not move, and the ledger row is still written;
  - **writes through `MIRROR_WRITE_SPEC` only:** each upsert uses its spec conflict key; a 7shifts `deleted: true` updates the flag; nothing is ever deleted;
  - **(r1 P2-3, r2 #1/#2) assignments and wages are reconciled per user:** for each user fetched this run, the lib makes the ONE singleton request, validates its shape, normalizes it into edges (or wage rows), then calls the reconciler once with `p_complete = (request ok && shape ok && rejected.length === 0)`.
  - **The documented payload end to end (r2 #1):** `assignments-doc-example.json` goes through the client (fake fetch, no cursor) → `normalizeAssignments` → the reconciler, giving one live edge `(4569, 7890, 2583)` and status `ok`, never `bad_pagination`.
  - **Rejections never retire (r2 #2):**
    - (i) user X has live edges {A, B}; the next snapshot carries A valid and B malformed (a non-numeric `role_id`) → X's call has `p_complete=false`, **B stays live**, A is refreshed, the ledger shows `incomplete_snapshot` for assignments, the run is `partial`, and the assignments watermark does not move;
    - (ii) mixed valid and invalid rows across two users → only the user with a rejection is incomplete, and the other user reconciles completely (a removal there IS retired);
    - (iii) an ENTIRELY invalid snapshot (every role malformed) → zero rows passed, `p_complete=false`, nothing retired;
    - (iv) a GENUINELY empty snapshot (`locations: [], departments: [], roles: []`) → `p_complete=true`, and X's live edges ARE retired;
    - (v) the same four cases for wages.
  - **Other reconcile tests:** a removed role assignment is retired after a complete snapshot; **a 5xx (or `bad_snapshot`) on one user's assignments request → that user's call is skipped or `p_complete=false`, nothing of theirs is retired, the resource is `partial`, and the assignments watermark does not move**; users NOT fetched this run (inactive and unmodified) are never passed to the reconciler, so their rows are untouched;
  - **list-resource rejections (r2 #2):** a shifts page with one malformed row → that row is counted `skipped`, the valid rows are upserted, the resource is marked failed (`rejected_rows`), and **the shifts watermark does not move**, so the next run re-reads the window;
  - **(r1 P2-5) malformed pagination after a good first page:** shifts page 1 is fine and page 2 has a malformed `meta` → the resource is `bad_pagination` (distinct from `deadline`, `server_error` and `ok`), page 1's rows are upserted, the **shifts watermark keeps its previous value**, and the run status is `partial`. The next run re-reads from the old watermark − 48 h, so the missing rows are fetched then;
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
- [ ] **Step 3:** `vercel.json` gets `{ "path": "/api/cron/sevenshifts-sync", "schedule": "20 * * * *" }` (hourly at :20, clear of the :00 digest and the */10 ticks). CC confirms the Vercel plan allows another cron (R6, O2). No `JOBS_REGISTRY` entry.
- [ ] **Step 4: Sync now** lives in Task 10's route (`action: "sync_now"`). It is MoO+, uses the same lease (busy → 409 `sync_busy`), and is audited `sevenshifts.sync_requested` (non-destructive).
- [ ] **Step 5:** green. Commit.

## Task 9: Migration 0269 — the link tables and their RPCs

**Files:** create `supabase/migrations/0269_sevenshifts_links.sql`, `scripts/sql-harness-0269.mjs`, `tests/sevenshifts-links-migration.test.ts`.

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
- [ ] **Step 3: the harness** proves each refusal by name, one live link per side, unlink then relink as a NEW row (history kept), the ceilings, that a deactivated actor is refused, and that **no function in 0269 compares names** (a source scan of the migration for `name` inside the function bodies). `PASS 0269:`.
- [ ] **Step 4:** the pin test (header, harness, every function definer + pinned + revoked). Green. Commit.

## Task 10: The links lib and `/admin/sevenshifts`

**Files:** create `lib/sevenshifts/links-shared.ts`, `lib/sevenshifts/links.ts`, `app/api/admin/sevenshifts/route.ts`, `app/admin/sevenshifts/page.tsx`, `components/admin/sevenshifts/SevenShiftsScreen.tsx`, `tests/sevenshifts-links.test.ts`, `tests/sevenshifts-screen-ui.test.ts`; modify `lib/i18n/en.json`, `lib/i18n/es.json`, `lib/nav-links.ts` (admin entry, if admin links are listed there).

- [ ] **Step 1 (tests, pure):** `linkCandidates(sevenShiftsUsers, liveAssignments, roles, coopsUsers, links)` returns two lists:
  - the unlinked 7shifts users, each with **its 7shifts employee id, name and live role names** at the linked 7shifts location (R4);
  - the unlinked CO-OPS members of the shop.

  Each list is sorted by display name. **No suggestion, no pre-selection, no match score**: the test asserts that two people with identical names AND an employee id equal to some CO-OPS field produce no pairing in the output. `displayName(u)` = preferred first name ‖ first name + last initial (the screen shows the full last name only inside the confirm sheet).
- [ ] **Step 2 (tests, lib):** `linkUser` / `unlinkUser` / `linkShop` / `unlinkShop`:
  - check `access-shared` before any I/O;
  - call the RPCs and map P0001 codes to `SevenShiftsLinkError(status, code)`;
  - audit the `sevenshifts_*_link.*` actions with ids only.

  `loadLinkScreen(actor, locationId)` returns status, the last 5 ledger rows (counts and codes), the shop link, linked people, candidates, and a WAGES COUNT (no rates).
- [ ] **Step 3: the screen** (phone-first, disclosure doctrine), top to bottom:
  1. the status line;
  2. "Shops" (MoO+): each CO-OPS shop with its linked 7shifts location or a Link picker;
  3. "People" for the selected shop: summary row "12 linked · 3 waiting"; collapsed "Waiting to link". Each waiting 7shifts person shows as **"Ana R. · 7shifts #10482 · Line, Prep"** (employee id + roles, R4) with a "Link to…" picker of CO-OPS members. The confirm sheet reads **"Link Ana R. (7shifts #10482) to Ana Rivera in CO-OPS? Her 7shifts punches and shifts will count as hers."**;
  4. linked people with Unlink (confirm);
  5. "Recent syncs" (collapsed);
  6. Sync now (MoO+).

  The `not_connected` and `not_supported` (multi-company) states hide sections 2–6 behind the one status line. Sync health is shown **in the app only**; nothing emails (R6). Every string is en + es (tú). 44 px controls. `useState` disclosure.
- [ ] **Step 4:** the UI test renders with `react-dom/server` for MoO, GM and `not_connected`, asserting no wage figure and no email in the HTML. Green. Commit.

---

# Chunk D — The people layer refactor (Tasks 11–13), golden green throughout

## Task 11: Extract ONE fact loader and the pure performance rules

**Files:** create `lib/people/facts-shared.ts`, `lib/people/facts.ts`, `lib/people/performance-shared.ts`, `lib/people/inputs-shared.ts`; modify `lib/team-metrics.ts`.

- [ ] **Step 1:** `facts-shared.ts`. Types for every fact family the legacy loaders read: completions (`instance_id, template_item_id, completed_by, completed_at, notes`), instances (`id, date, confirmed_by, confirmed_at`), cash, PM v1 reports and evals, MVPs, oversight audit rows. Later families (filled in later tasks): position intervals, prep batches, PM v2 grades, skill adjustments and ratings, linked 7shifts punches. `PeopleFacts` holds arrays per family plus `loaded: Set<FactFamily>`, so a pure function can refuse to compute from a family that was not loaded (throws `fact_family_not_loaded`, which surfaces a missing load in tests rather than a silent zero).
- [ ] **Step 2:** `facts.ts`. `loadPeopleFacts(service, { locationId, bounds, personIds?, families })` **moves the existing queries verbatim**: the same tables, filters, 50-id chunking and `selectAllRows` paging, in the same order. Behaviour does not change; only the location of the code moves. The location bind for oversight (`oversightRowAtLocation`) moves with it into `performance-shared.ts`.
- [ ] **Step 3:** `performance-shared.ts`. `teamWindow(facts, roster, range, granularity)` and `personMetrics(facts, person, range, granularity, today)` hold the materialization bodies of `loadTeamWindow` and `computePersonMetrics`, as pure functions of facts. The `compare` recursion becomes "load the facts once over the union bounds, compute twice". The two windows must produce the same numbers as two loads, and the golden proves it. If the union load changes ANY golden number, keep two loads; that is a loader detail, never a reason to touch the golden.
- [ ] **Step 4:** `inputs-shared.ts`. `export interface PeopleInputs { pmV2: boolean }` and `export const LEGACY_INPUTS: PeopleInputs = { pmV2: false }`. Phase 1 adds exactly one new input to the legacy score family: PM v2 grades in the `gradientTally` and the notes count (Task 23). Skills are a NEW view and change no legacy number.
- [ ] **Step 5 (r1 P2-8, the trusted role):** `Viewer` becomes `{ userId: string; role: RoleCode; level: number; locations?: readonly string[] | "all" }`, with **`role` REQUIRED**. The level stays for the existing floors, and the role is what lets `canViewPeople` tell AGM from SMM. Every construction site passes `role: auth.role` from the verified session:
  - `app/(authed)/my-feedback/page.tsx:90` (`loadMyPerformance`);
  - `app/(authed)/reports/trends/page.tsx:74`;
  - `app/(authed)/reports/trends/team/page.tsx:68`;
  - `app/(authed)/reports/trends/team/[personId]/page.tsx:44` (`loadPersonReportLocations`) and `:69`;
  - `lib/report-export.ts:249` (it builds a reports-hub `Viewer`; add `role: auth.role` there; the team call at `:269` receives it).

  `loadPersonReportLocations(service, viewer, personId)` takes the same `Viewer` (role included). Every test fixture that builds a viewer adds a role: `tests/team-metrics-person-chunks.test.ts`, `tests/team-metrics-oversight-scope.test.ts`, `tests/reports-team-accuracy.test.ts`, `tests/b8-performance-sparse-charts.test.ts`, and the Task 1 harness (which already carries it). `tsc` then fails on any site that was missed. `grep -rn "viewer: {" app lib` is the checklist, and every hit naming a team-metrics call must include `role`.
- [ ] **Step 5b:** `team-metrics.ts` becomes the wrappers (gate → facts → pure). Exports, function names and `OVERSIGHT_ACTIONS` stay; the only signature change is the required `role` in `Viewer`. `tests/team-metrics-person-chunks.test.ts` and `tests/team-metrics-oversight-scope.test.ts` stay green unmodified (the chunk sizes `[50,50,50,50,25,…]` are part of the contract).
- [ ] **Step 6:** `npx vitest run tests/people-layer-equivalence.test.ts tests/team-metrics-*.test.ts tests/reports-team-accuracy.test.ts tests/b8-performance-sparse-charts.test.ts` all green. Commit.

## Task 12: Profiles and My feedback onto the same layer

**Files:** modify `lib/profiles.ts`; extend `lib/people/facts.ts` with the company-wide profile facts (the public card's existing scope: the target's completions, MVP count and gradients across all shops); move the pure `publicProfile(...)` body into `performance-shared.ts`.

- [ ] **Step 1:** the same move discipline as Task 11. `loadPublicProfile` keeps the visibility gate (shared location or "all"), the leadership contact rule and the blurb rule in the wrapper. `loadProfileDirectory` keeps its two queries.
- [ ] **Step 2:** `loadMyFeedback` stays in `lib/pm-report.ts` (it is a PM read, not a score). Only its v2 sibling is added later (Task 21).
- [ ] **Step 3:** golden green. Commit.

## Task 13: Access through one rule, and the deliberate SMM refusal

**Files:** modify `lib/team-metrics.ts` (gates call `canViewPeople`), `app/(authed)/reports/trends/page.tsx` (`canSeeTeam` uses `canViewPeople` for the selected shop), `app/(authed)/reports/trends/team/page.tsx`, `app/(authed)/reports/trends/team/[personId]/page.tsx`, `lib/report-export.ts` (the team section is omitted for SMM); create the test block in `tests/people-access.test.ts` (route-level) and `tests/people-smm-refusal.test.ts`.

- [ ] **Step 1 (test first, `tests/people-role-carry.test.ts`, r1 P2-8):** two viewers with IDENTICAL `level: 6` and the same shop, one with `role: "agm"` and one with `role: "social_media_mgr"`, go through every entry point:
  - `loadTeamOperatingHealth`: AGM gets the golden, SMM gets `null`;
  - `loadPersonDetail`: AGM gets the golden, SMM gets `null`;
  - `loadPersonReportLocations`: AGM gets the shop list, SMM gets `[]`;
  - the export's team section: present for AGM, omitted for SMM;
  - the trends page `canSeeTeam`: true for AGM, false for SMM;
  - the team pages: SMM redirects to `/dashboard`.

  `prep_mgr` and `catering_mgr` follow the AGM path (R7). `loadMyPerformance` is self-only and stays allowed for an SMM's OWN numbers (it is not people data about others).
- [ ] **Step 2:** implement. `TEAM_VIEW_LEVEL` stays exported (6) as the level floor; `canViewPeople` adds the role refusal and the location rule.
- [ ] **Step 3:** golden green (SMM is not in it). Commit. **The PR description names this as a permission tightening the GO asked for.**

---

# Chunk E — Skills per position (Tasks 14, 14b, 15–17)

## Task 14: Migration 0270 — people settings, adjustments, ratings

**Files:** create `supabase/migrations/0270_people_layer.sql`, `scripts/sql-harness-0270.mjs`, `tests/people-layer-migration.test.ts`.

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

-- (R11) the skill constants as tunable settings: one company row (location_id null) + optional shop overrides.
create function public.valid_skill_tunables(p jsonb) returns boolean language plpgsql immutable
  set search_path = pg_catalog, public as $$ … $$;   -- exact keys; each number in its declared range (below)
create table public.people_skill_tunables (
  id uuid primary key default gen_random_uuid(),
  location_id uuid references public.locations(id),            -- null = the company default
  tunables jsonb not null constraint people_skill_tunables_valid check (public.valid_skill_tunables(tunables)),
  updated_by uuid not null references public.users(id), updated_at timestamptz not null default clock_timestamp()
);
create unique index people_skill_tunables_one_per_scope
  on public.people_skill_tunables (coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid));
```

  **The rules (r2 #3)**, enforced IDENTICALLY by `valid_skill_tunables` (SQL, in the CHECK) and `validSkillTunables` (TS, before any write). A test pins the two as equal over one shared JSON table of valid and invalid inputs (`tests/fixtures/skill-tunables-cases.json`), run by vitest against the TS validator and by the 0270 harness against the SQL one:
  - exactly the known keys, each a JSON **number** (never a string, null, NaN or Infinity; JSON cannot carry NaN, and the TS side also checks `Number.isFinite`);
  - `priorWhenNoRating` ∈ [0, 1];
  - `priorStrength` (k) **> 0**, and ≤ 60;
  - `weights.pm`, `weights.closeOnTime`, `weights.prepYield` each ≥ 0, **at least one > 0** (sum > 0), and **no per-weight upper cap** (CC ruling 2026-10-15, Astra r3 P3): `3 / 1 / 1` is accepted and means the same as `0.6 / 0.2 / 0.2`. They are NORMALISED at use (divided by the sum), so they need not sum to 1; the zero-weight rule is in Task 15. The sum must also be finite: the TS validator checks `Number.isFinite(sum)`, and the SQL twin refuses a sum above `1.7976931348623157e308` (the largest double), so the two agree on an overflowing vector such as three weights of `1e308`;
  - `gradeValue.great ≥ good ≥ needs_work`, each ∈ [0, 1];
  - `yieldTolerance` ∈ [0.01, 0.5];
  - `closeGraceMinutes` ∈ [0, 120];
  - **`0 < bands.building < bands.strong < 1`** (strict at both ends);
  - `minQualityDaysForLearned` an integer ∈ [0, 30];
  - `windowDays` an integer ∈ [7, 365].

  **A rejected set leaves the previous set live.** The TS validator refuses before the write (`invalid_tunables`, naming the key). If a bad set reached SQL anyway, the CHECK fails the single upsert statement, so the previous row is untouched. Both paths are tested: save valid set A, then try invalid set B, and the loader still returns A.

  No row = `SKILL_TUNABLE_DEFAULTS` (Task 15), so nothing has to be seeded. The settings change history is the audit trail (`people.skill_tunables_update`, before/after).

- [ ] **Step 1:** preflight. Assert `station_positions` has the columns `id, location_id`, then add `create unique index if not exists station_positions_id_location on public.station_positions(id, location_id)` (additive; `id` is already unique, so it cannot fail on existing data) and use it for the composite FKs. **Adding the index changes no row and no grant.**
- [ ] **Step 2:** grants. Settings and `people_skill_tunables`: the SELECT/INSERT/UPDATE ceiling. `valid_skill_tunables`: revoked from the PostgREST roles, EXECUTE to service_role (the 0238 `valid_station_trims` pattern). Adjustments and ratings: the SELECT/INSERT ceiling (append-only: "current" = the latest row per `(user, position)`; a correction is a new row). RLS on, no policies, plus the guard.
- [ ] **Step 3: the harness.** The step/clamp CHECKs (0.05 granularity, ±0.30); a position from another shop is refused by the FK; UPDATE/DELETE are refused for `service_role` on the append-only tables; the tunables CHECK runs the SHARED case file (every accepted case accepted, every refused case refused, including k = 0, `building` = 0, `strong` = 1, `building = strong`, all weights 0, a negative weight, a string number; and ACCEPTED: weights `3 / 1 / 1`, a single weight above 1 with the others 0, e.g. `{pm: 5, closeOnTime: 0, prepYield: 0}`; REFUSED: three weights of `1e308`, whose sum overflows a double); after a refused upsert the previous row is unchanged; one row per scope; ceilings. `PASS 0270:`.
- [ ] **Step 4:** the pin. Green. Commit.

## Task 14b: The BOH positions data step (R3) — dry run first, through the station admin, never a migration

**Files:** create `scripts/check-boh-positions.ts` (read-only) and `docs/runbooks/boh-positions.md` (en).

- [ ] **Step 1:** `check-boh-positions.ts` (with a `pathToFileURL` guard; service role; SELECT only) prints, per active shop, the station that holds prep work and whether positions named exactly **"Prep"** and **"Prep/Dishwasher"** exist and are active there, with their `name_es`. Exit code 0 when both shops have both. It never writes, and it matches position names exactly as data (a report, not logic).
- [ ] **Step 2:** the runbook. (1) Run the dry run and paste the output into the PR. (2) A MoO, or each shop's GM, opens the existing station admin (`/admin/stations` → the prep station → Positions) and creates or renames the two positions: "Prep" / es "Prep", and "Prep/Dishwasher" / es "Prep/Lavaplatos". The existing writer audits it (`station.position_create` / `station.position_update`). (3) Run the dry run again and expect exit 0.

  **The data step is a human act through the shipped admin, never a migration or a seed** (R3). It must be done before PM v2 is switched on for a shop, because the BOH criteria hang on those rows.
- [ ] **Step 3:** a unit test of the script's pure report function over fixture rows. Commit.

## Task 15: The skill model, pure (`lib/people/skills-shared.ts`)

**Files:** create `lib/people/skills-shared.ts`, `tests/people-skills.test.ts`.

**The model.** The constants live in `lib/people/tunables-shared.ts` as `SKILL_TUNABLE_DEFAULTS` and are overridable by the R11 settings rows (company, then shop). The pure functions take a resolved `SkillTunables` PARAMETER and never import the defaults themselves.

```ts
export const SKILL_TUNABLE_DEFAULTS: SkillTunables = {
  priorWhenNoRating: 0.5,        // neutral; the mockup's role defaults are sample data (J5)
  priorStrength: 6,              // k: how many quality-observed DAYS the prior is "worth"
  weights: { pm: 0.6, closeOnTime: 0.2, prepYield: 0.2 },  // renormalised over the kinds present
  gradeValue: { great: 1, good: 0.6, needs_work: 0.2 },     // PM grade → [0,1]
  yieldTolerance: 0.15,          // the 0218 Phase B band: within ±15% of recipe = on target
  closeGraceMinutes: 15,
  bands: { building: 0.45, strong: 0.75 },                  // < building · building..strong · ≥ strong
  minQualityDaysForLearned: 3,   // below this the skill reads "Starting point" (prior-led)
  windowDays: 90,                // the evidence window
};

// (r1 P2-7) DATED observations, never pre-summed totals: every quality fact keeps its business day,
// so the distinct quality-day set (n) is computable and overlaps between kinds are deduplicated.
export type QualityKind = "pm" | "closeOnTime" | "prepYield";
export interface QualityObservation {
  positionId: string; day: string /* YYYY-MM-DD, ET business day */; kind: QualityKind;
  value: number /* 0..1 */; weight: number /* pm: observed minutes; close: 1 per line; prep: 1 per production row */;
  sourceId: string /* the grade/completion/production id: dedupes a re-load, never double-counts */;
}
export interface WorkedDay { positionId: string; day: string; minutes: number }
export interface PositionSignals {
  positionId: string;
  worked: readonly WorkedDay[];                 // exposure (from position intervals): not quality
  observations: readonly QualityObservation[];  // quality, dated
}
export interface SkillResult {
  positionId: string;
  learned: number; prior: number; priorSource: "manager_rating" | "neutral";
  adjustment: number; value: number;            // clamp(learned + adjustment, 0, 1)
  band: "building" | "solid" | "strong";
  qualityDays: number;                          // n = |distinct days with ≥1 observation of ANY kind|
  workedDays: number; minutesWorked: number;    // exposure, shown, never mixed into n
  confidence: number;                           // n / (k + n): 0 = all prior, → 1 = all data (Phase 2 reads it)
  startingPoint: boolean;                       // qualityDays < minQualityDaysForLearned
  perKind: Record<QualityKind, { mean: number; count: number; days: number } | null>;
  evidence: NarrativeLine[];                    // i18n keys + params, never prose
}
export function skillFor(signals: PositionSignals, prior: number | null, adjustment: number, t: SkillTunables): SkillResult;
```

- `perKind[kind].mean` = the weight-weighted mean of that kind's observations inside `windowDays`, after deduplicating by `sourceId`.
- **Within a kind:** observation weights are ≥ 0 (minutes, or 1). When a kind's observation weights sum to 0 (e.g. every PM copy had zero observed minutes), its mean uses EQUAL weights over those observations and is flagged `equalWeightFallback`, so a kind with observations always has a finite mean.
- **(r2 #3) COUNTING kinds:** a kind COUNTS when it has ≥ 1 observation in the window AND its tunable weight is > 0. A kind that has observations but weight 0 is SHOWN as evidence ("Closing lines: 17 of 18 · not counted in the skill") but contributes nothing to q, n or confidence.
- `q` = Σ_{counting} w_k · mean_k / Σ_{counting} w_k. The denominator is > 0 whenever at least one kind counts.
- **`n` = the size of the SET of distinct `day` values across the observations of the COUNTING kinds.** A day with a PM grade AND a closing line AND a batch counts ONCE. A day worked with no counted quality observation counts ZERO (r1 P2-7).
- **No counting kind** (no evidence at all, OR evidence only of weight-0 kinds, e.g. weights `{pm:1, closeOnTime:0, prepYield:0}` and a person with only closing evidence): q is UNDEFINED and never computed. Then `n = 0`, `learned = prior` (the manager's rating, else `priorWhenNoRating`), `confidence = 0`, `startingPoint = true`, and `perKind` still reports the uncounted kinds for evidence. **No division by a zero sum ever runs.**
- `learned = (k·prior + n·q) / (k + n)` when n > 0 (k > 0 by validation, so k + n > 0); `learned = prior` when n = 0.
- `confidence = n / (k + n)` (0 when n = 0).
- `value = clamp(learned + adjustment, 0, 1)`.
- **Every output is finite:** `learned`, `value`, `confidence`, each `perKind.mean` ∈ [0, 1]; `qualityDays`, `workedDays` and `minutesWorked` are non-negative integers. `skillFor` asserts this before returning, and throws `skill_not_finite` if a future change ever breaks it (a test failure, never a NaN on a screen).

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
  - a rating of 0.8 and 2 quality days of `q = 0.4` → `(6·0.8 + 2·0.4)/8 = 0.7`, `confidence = 2/8 = 0.25`;
  - **(r1 P2-7) overlap:** on the same day a PM grade + 3 closing lines + 2 batches → `qualityDays = 1`, not 6 and not 3; three kinds on three DIFFERENT days → 3; **20 worked days with ONE quality day → `qualityDays = 1`, `workedDays = 20`**, and confidence follows `qualityDays`; a duplicated `sourceId` (a re-loaded row) counts once; an observation outside `windowDays` is excluded from both q and n;
  - **(r2 #3) zero-weight evidence:** weights `{pm:1, closeOnTime:0, prepYield:0}`, a person with ONLY closing evidence → `learned = prior`, `confidence = 0`, `qualityDays = 0`, `startingPoint = true`, `perKind.closeOnTime` reported, and every number finite; the same person with one PM grade added → n = 1 and q = that PM mean;
  - **(r2 #3) property test, finite outputs** (`tests/people-skills-finite.test.ts`). No new dependency: a seeded deterministic generator (mulberry32, fixed seeds, 2,000 cases per run) plus an exhaustive EDGE grid. The grid covers:
    - every weight vector over {0, 0.0001, 0.5, 1, 3} with sum > 0 (3 covers a weight above 1, which is valid: no per-weight cap);
    - k ∈ {0.0001, 1, 6, 60};
    - bands at their strict edges (0.0001 / 0.9999, building = strong − 0.0001);
    - prior ∈ {0, 1, null};
    - adjustment ∈ {−0.30, 0, +0.30};
    - gradeValue all equal or all 0;
    - observation sets: empty, one kind only (each kind), all kinds on the same day, kinds on disjoint days, zero-minute PM weights, duplicate `sourceId`s, and observations all outside the window.

    For EVERY configuration the TS validator ACCEPTS, it asserts that every numeric output is finite and in range, that `band` is one of the three, and that `confidence = 0 ⇔ qualityDays = 0`. Configurations the validator refuses are asserted refused (the same edges from the shared case file).
  - **tunables are a parameter:** the same signals under two different `SkillTunables` give the two expected values; `validSkillTunables(SKILL_TUNABLE_DEFAULTS)` is true; each out-of-range key is false (the SQL twin is pinned in Task 14);
  - 40 days pull the value to `q`;
  - the adjustment clamps at 0 and 1;
  - weights renormalise when only PM exists;
  - bands at the boundaries;
  - evidence keys are present for each signal and absent when a signal is null;
  - a 0217 interval with a null position never produces a skill row (it shows under "Position not recorded" minutes only);
  - determinism: same input, same output.
- [ ] **Step 2:** implement. Signal builders, each pure, from the facts:
  - `closeOnTimeObservations(completions, stationLinesByStation, stationCloseAt, intervals, t)`: one observation per closing-template line completion (`sourceId` = the completion id, `day` = the business day of its instance). The line's `checklist_template_items.station` must match the station's `stations.name` (the 0230 `station_closures` join) and the line must be completed by the person. `value` is 1 when it was done at or before `stations.usually_closes_at` + `closeGraceMinutes`, or before the observed `station_closures.closed_at` when the station has no usual close; else 0. It is attributed to the position the person held at completion time.
  - `prepYieldObservations(productions, intervals, prepPositionId, t)`: **one observation per PRODUCTION ROW in the `YieldBatch` shape** (r1 P2-6; `sourceId` = `productions.id`, `day` = the ET business day of `produced_at`). It is attributed to the position the maker (`made_by`) held at `produced_at`, else to the shop's `prep_position_id`, else to "unplaced prep work" (evidence only, no skill). `value` is 1 when `|came_out_to/batches_made − yield_at_time| / yield_at_time ≤ yieldTolerance`, else 0. Rows with null `made_by` are skipped and counted in the evidence ("3 batches had no maker recorded").
  - `pmObservations(...)`: one observation per (copy, subject, position, criterion) live grade of a SUBMITTED v2 day (`weight` = that copy's observed minutes, Task 19). Day-level weighting happens in `perKind.mean`, so two managers grading the same day still add ONE quality day.
- [ ] **Step 3:** green. Commit.

## Task 16: The skills loader and the writers

**Files:** create `lib/people/skills.ts`, `lib/people/settings.ts`, `app/api/people/skills/route.ts`, `app/api/people/settings/route.ts`; extend `lib/people/facts.ts` with the families `positionIntervals` (station_events + `closeOpenIntervals`), `closingLines` (via the existing closing-stations helpers, not a second query shape), `productionFacts` (**r1 P2-6: NO join to `prep_batch_sessions`**. It reads `productions` alone with EXACTLY `lib/yield-stats.ts` `loadBatches`'s columns and filters: `id, output_item_id, produced_at, made_by, batches_made, came_out_to, yield_at_time`, `location_id = shop`, `superseded_at is null`, `revoked_at is null`, `batches_made > 0`, `came_out_to` and `yield_at_time` not null, and `produced_at` in the window. It is mapped to `YieldBatch` from `lib/yield-stats-shared.ts`; one row = one observation), `skillAdjustments`, `skillRatings`, `skillTunables`; create `tests/people-loader-schema-check.test.ts`.

- [ ] **Step 1 (tests):**
  - `loadSkills(service, { actor, locationId, personId, window })`: `canViewPeople` (or self) BEFORE any I/O; one call to `loadPeopleFacts` with the needed families; returns positions of THIS shop only, ordered by station sort then position sort; never another shop's positions even for a two-shop person.
  - `adjustSkill(...)`: `canAdjustSkill` before I/O; the position belongs to the shop (the FK is the backstop); the delta step/clamp is validated in the lib (named `invalid_adjustment`); inserts a row; audits `people.skill_adjust` with `{ user_id, position_id, delta, reason_code }` and no note text.
  - **(r1 P2-6) the production read is the yield-stats read:** a recording-client test captures the `productions` query built by `loadPeopleFacts` and by `yield-stats` `loadBatches` and asserts the same table, the same selected columns and the same filter set (the window bound excepted). A fixture with ONE maker, TWO sessions and TWO productions yields exactly TWO observations;
  - `loadSkillMatrix(service, { actor, locationId, window })`: the Phase 2 read (see "What Phase 2 reads"). It applies the same gate and returns every active member × every active position of the shop with a `SkillResult` (including confidence and evidence), one batch load, no per-person queries;
  - `rateNewHire(...)`: same shape, audited `people.skill_rating`;
  - `saveSkillTunables(actor, scope, tunables)`: `canEditSkillTunables` (8+), `validSkillTunables`, an upsert per scope, audited `people.skill_tunables_update` with before/after.
  - `savePeopleShopSettings`: audited `people.shop_settings_update` with before/after.
- [ ] **Step 2: the schema check.** Copy the recording-client pattern: PGlite applies the stub plus 0268–0270 (0271 is added in Task 20) and executes every captured query on those tables with `limit 0`. A misspelled column fails here, not in prod.
- [ ] **Step 3:** routes. `requireSession`, then `lockLocationContext`/`canViewPeople` as the outer layer (the lib bind is the inner one), then a JSON body schema; refusals map to their status and code. No step-up tier for adjust and rate (an operational manager act, the Dynamic Pars precedent; J8). The tunables route is MoO+ and Tier E (`assertStepUp(ctx, "E")`).
- [ ] **Step 4:** green (golden included: these families are loaded ONLY by `loadSkills`). Commit.

## Task 17: The skills UI — manager view and self view

**Files:** create `components/people/SkillsSection.tsx`, `components/people/MySkills.tsx`; modify `app/(authed)/reports/trends/team/[personId]/page.tsx`, `app/(authed)/my-feedback/page.tsx`, `lib/i18n/en.json`, `lib/i18n/es.json`; create the UI tests in `tests/people-skills-ui.test.ts`.

- [ ] **Manager view** (on the person page, after the existing sections; disclosure doctrine):
  - a summary row "Skills · 5 positions · 1 adjusted" (collapsed by default on phone, open on desktop);
  - per position a full-row toggle: name (es when the viewer's language is es and `name_es` is set), a bar, the value to two decimals, the band, a confidence hint ("based on 9 days" / "basado en 9 días"), and an "Adjusted +0.10" chip when one applies;
  - the drawer holds the evidence lines and the adjustment history (who, when, reason);
  - the Adjust control is GM+/MoO+ only: − / + in 0.05 steps clamped to ±0.30, as in the mockup, then a reason picker, then Save. 44 px, `items-center`;
  - New-hire rating: when `startingPoint` is true and the viewer may adjust, "Set a starting rating" uses the same 0–1 bar control in 0.05 steps (one scale everywhere, never stars; J5).
- [ ] **Self view** (`/my-feedback`, "My skills"): the positions the person worked at this shop, each with its band label (**Strong / Solid / Building**; es **Fuerte / Sólido / En progreso**; R8) and the positive evidence lines only, headed "What you've been doing well". No needs-work counts, no numbers, no confidence, and **no trace of a manager adjustment**: not the amount, not the fact, and not an adjustment-derived evidence line. The self loader strips them at the lib boundary (`toSelfSkillView`), so a component can never leak them.
- [ ] **Tests:** render for GM (adjust visible), AGM (no Adjust), SMM (page refused upstream), and self (no numbers: assert the HTML contains no `0.` value, no "Adjusted"/"Ajust" text and no adjustment evidence key, even when the fixture has an adjustment for that person). en + es keys exist for every visible string and ARIA label (the key-parity test in `tests/i18n*.test.ts` stays green).
- [ ] Commit.

---

# Chunk F — PM reports v2 (Tasks 18–22)

## Task 18: Migration 0271 — copies, grades, notes, criteria, and the writer RPCs

**Files:** create `supabase/migrations/0271_pm_reports_v2.sql`, `scripts/sql-harness-0271.mjs`, `tests/pm-reports-v2-migration.test.ts`.

**Preflight:**
- **0267 is applied:** no `pm_evals_read_self` policy on `pm_employee_evals`, and the 0267 grant shape is in place; else `raise exception '0271: requires 0267_pm_evals_privacy'`;
- 0270's `station_positions_id_location` unique index exists;
- none of the new tables exist.

**r1 P1-1: every PM v2 row is bound to the report's SHOP by composite foreign keys.** The copy, the criterion and the position must all share the row's `location_id`, so a grade cannot name another shop's position or a UUID that is not a position. The binding to positions the subject actually worked is enforced inside the only writer (the RPC), and no other writer exists (SELECT-only grants).

```sql
alter table public.pm_reports add column format text not null default 'v1' check (format in ('v1','v2'));
create unique index if not exists pm_reports_id_location on public.pm_reports(id, location_id);   -- additive; id is unique

create table public.pm_criteria (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),
  position_id uuid,                                  -- null = applies to every position at this shop
  label text not null check (char_length(btrim(label)) between 1 and 80),
  label_es text check (label_es is null or char_length(btrim(label_es)) between 1 and 80),
  sort smallint not null default 100, active boolean not null default true,
  created_by uuid not null references public.users(id), created_at timestamptz not null default clock_timestamp(),
  foreign key (position_id, location_id) references public.station_positions(id, location_id),
  unique (id, location_id)
);
create table public.pm_report_copies (
  id uuid primary key default gen_random_uuid(),
  pm_report_id uuid not null,
  location_id uuid not null references public.locations(id),
  foreign key (pm_report_id, location_id) references public.pm_reports(id, location_id),   -- the copy's shop IS the day's shop
  unique (id, location_id),
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
  copy_id uuid not null,
  location_id uuid not null,                          -- denormalized from the copy, PROVEN by the FK below
  subject_id uuid not null references public.users(id),
  position_id uuid,                                   -- null = "no position recorded" (shared criteria only)
  criterion_id uuid not null,
  grade text check (grade in ('great','good','needs_work')),   -- null = "not observed" (an explicit answer)
  created_at timestamptz not null default clock_timestamp(), superseded_at timestamptz,
  foreign key (copy_id, location_id)      references public.pm_report_copies(id, location_id),
  foreign key (criterion_id, location_id) references public.pm_criteria(id, location_id),
  foreign key (position_id, location_id)  references public.station_positions(id, location_id)   -- MATCH SIMPLE: null skips
);
create unique index pm_copy_grades_one_live on public.pm_copy_grades
  (copy_id, subject_id, coalesce(position_id, '00000000-0000-0000-0000-000000000000'::uuid), criterion_id)
  where superseded_at is null;
-- pm_copy_notes: (copy_id, location_id, subject_id, position_id null-able, note text check 1..500, created_at, superseded_at),
--   the SAME three composite FKs (copy and position; no criterion), the one-live unique index without criterion_id.
-- pm_copy_positions: (copy_id, location_id, subject_id, position_id NOT NULL, reason text check 1..200, created_at,
--   superseded_at), the same copy + position composite FKs — a manager adds a position a person worked but never
--   tapped into (shown "added by <manager>"), one live row per (copy, subject, position).
```

- [ ] **Step 1: the RPCs** (SECURITY DEFINER, pinned, service_role only). Each locks **the day row (`pm_reports … for update`) first, then the copy row**, the same order everywhere, so they cannot deadlock. **The copy lifecycle is the ONE table from Task 2 (`PM_COPY_TRANSITIONS`, r1 P2-9):** writes need `open`; `done` is read-only; only `reopen_pm_copy` leaves `done`; only submit seals.
  - `open_pm_copy(p_actor, p_report)`: day `format='v2'` and `status='open'`; inserts on conflict do nothing; returns the copy id.
  - `pm_subject_worked_position(p_copy, p_subject, p_position) returns boolean` (internal helper; no EXECUTE grant beyond the definer functions): true iff EITHER a `station_events` row exists with `location_id` = the copy's shop, `business_date` = the day's `report_date`, `user_id = p_subject` and `position_id = p_position` (the subject was assigned or claimed that position that day), OR a live `pm_copy_positions` row of THIS copy adds `p_position` for `p_subject`.
  - `save_pm_copy_grade(p_actor, p_copy, p_subject, p_position, p_criterion, p_grade)` refuses, in this order, each code named:
    1. the actor is not the author → `not_copy_author`;
    2. the day is not open → `report_already_submitted`;
    3. the copy is `done` → `copy_done`; the copy is `sealed` → `copy_sealed`;
    4. the subject is not an active member of the shop → `subject_unavailable` (via `assignment_user_level`);
    5. **(r1 P1-1)** `p_position` is non-null and no `station_positions` row has that id AND the copy's `location_id` → `position_not_at_shop` (this covers both a foreign shop's position and a UUID that is no position at all; the composite FK is the backstop);
    6. the position row exists but `active = false` → `position_retired`;
    7. `p_position` non-null and `not pm_subject_worked_position(...)` → `position_not_worked`;
    8. the criterion is not at the copy's shop or is inactive → `criterion_mismatch`; a criterion WITH a position must equal `p_position`, and a SHARED criterion (null position) accepts `p_position` null or any position that passed checks 5–7.

    Then supersede the live row and insert, with `location_id` copied from the copy (the FKs prove it).
  - `save_pm_copy_note`: guards 1–7 (no criterion).
  - `add_pm_copy_position(p_actor, p_copy, p_subject, p_position, p_reason)`: guards 1–6 (a manager may add a position the subject did NOT tap into; that is its purpose), and `p_reason` is non-blank.
  - `set_pm_copy_window(p_actor, p_copy, p_from, p_to)`: guards 1–3; both instants inside the business day (ET start of `report_date` to +30 h, which covers a close after midnight); `to > from`.
  - `mark_pm_copy_done(p_actor, p_copy)`: `open → done` only (`copy_done` if already done, `copy_sealed` if sealed).
  - `reopen_pm_copy(p_actor, p_copy)`: `done → open` only, author only, day open (`copy_not_done` otherwise).
  - `submit_pm_day_v2(p_actor, p_report)`: a guarded `update pm_reports set status='submitted', submitted_at=clock_timestamp(), submitted_by=p_actor where id=p_report and status='open' and format='v2' and superseded_at is null`. Zero rows → return `{changed:false}` (a losing submit is a no-op, the v1 doctrine). Then `update pm_report_copies set status='sealed', sealed_at=clock_timestamp() where pm_report_id=p_report and status <> 'sealed'`, and `observed_to` defaults to the submit instant where null. **No notification, no insert outside these two tables.**
- [ ] **Step 2: grants.** `pm_criteria`: the SELECT/INSERT/UPDATE ceiling (deactivate only; label edits allowed and audited by the lib). Copies, grades, notes and positions: service_role **SELECT only**, with every write through the RPCs. The `pm_reports` grants are unchanged (assert they are identical before and after: the guard compares `role_table_grants` for `pm_reports` to a literal manifest).
- [ ] **Step 3: the harness.**
  - P1 the DB enforces no read visibility (the lib decides), but every write by a non-author is refused (`not_copy_author`);
  - **P1-1 binding (r1):**
    - (a) a grade naming a position of the OTHER shop → `position_not_at_shop`, and a direct `insert` as owner with that pair fails the composite FK;
    - (b) a **retired** position (`active=false`) of the right shop → `position_retired`;
    - (c) a **nonexistent UUID** → `position_not_at_shop`, and the FK fails it at the DB layer too;
    - (d) a valid shop position the subject never held that day → `position_not_worked`;
    - (e) the same position after `add_pm_copy_position` by THIS copy → accepted, while a position added by ANOTHER manager's copy does not open it for this copy;
    - (f) a criterion of the other shop → `criterion_mismatch` + FK;
    - (g) a position criterion with a different `p_position` → `criterion_mismatch`;
    - (h) a shared criterion with `p_position` null → accepted;
  - **lifecycle (r1 P2-9):** open → mark done → a grade is `copy_done` → reopen → the grade is accepted → mark done → submit seals it; `reopen` on an open copy is `copy_not_done`; no write is possible after seal;
  - P2 a write after submit is `report_already_submitted`;
  - P3 a concurrent submit: the second returns `changed:false`;
  - P4 submit seals every copy and sets the default `observed_to`;
  - P5 a criterion from another shop or another position is refused;
  - P6 the supersede keeps one live row and keeps history;
  - P7 `format` defaults to v1, and a v1 day refuses every v2 RPC (`format_mismatch`);
  - P8 the ceilings, plus the `pm_reports` grant manifest unchanged;
  - P9 no RPC in 0271 references `notifications`.

  `PASS 0271:`.
- [ ] **Step 4:** the pin. Green. Commit.

## Task 19: PM v2 rules, pure (`lib/pm-report-v2-shared.ts`)

**Files:** create `lib/pm-report-v2-shared.ts`, `tests/pm-report-v2-shared.test.ts`.

```ts
export const PM_GRADE_VALUE = { great: 3, good: 2, needs_work: 1 } as const;  // display scale; skills use tunables.gradeValue
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
/** (r1 P1-1) the lib twin of the RPC's checks 5–8, run before the RPC so the UI only ever offers valid targets. */
export function gradeTargetProblem(t: { position: { id: string; locationId: string; active: boolean } | null | undefined;
  positionId: string | null; copyLocationId: string; workedPositionIds: ReadonlySet<string>; addedByThisCopy: ReadonlySet<string>;
  criterion: { locationId: string; positionId: string | null; active: boolean } }): null | "position_not_at_shop" | "position_retired" | "position_not_worked" | "criterion_mismatch";
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
  - visibility truth table;
  - **`gradeTargetProblem` returns the SAME code as the RPC** for the eight P1-1 cases (a) to (h) of Task 18, as a shared table of cases that both `tests/pm-report-v2-shared.test.ts` and the Task 18 harness iterate (the harness reads the same JSON case file, `tests/fixtures/pm-grade-target-cases.json`);
  - the copy lifecycle: `PM_COPY_TRANSITIONS` drives `canWritePmCopy` / `canMarkDone` / `canReopenPmCopy`, and the test walks every (status × act) pair against the same JSON file the harness uses (`tests/fixtures/pm-copy-lifecycle-cases.json`), so the pure rule and the RPC cannot drift.
- [ ] **Step 2:** implement (pure; positions come from `positionTimeline`).
- [ ] **Step 3:** green. Commit.

## Task 20: The PM v2 lib — copies, writes, submit, loaders

**Files:** create `lib/pm-report-v2.ts`, `tests/pm-report-v2.test.ts`, `tests/pm-report-v2-no-notify.test.ts`; modify `lib/pm-report.ts`; extend `tests/people-loader-schema-check.test.ts` with 0271.

- [ ] **Step 1 (tests first):**
  - `getOrCreatePmReport` stamps `format` from `people_shop_settings.pm_v2` for a NEW day row only; an existing row keeps its format (switching mid-day never converts a day).
  - v1 `saveEmployeeEval` / `setMvp` on a v2 day → `PmReportError(409, "format_mismatch")`. MVP on v2 is written by `setMvpV2` (the same guarded UPDATE, `.eq("format","v2")`), so the existing MVP scoring keeps reading `pm_reports.mvp_user_id`.
  - `openMyCopy(actor, locationId, date)`: `requirePmTask` (existing) plus `canWritePmCopy`/not-SMM, then `open_pm_copy`.
  - `loadMyCopy(actor, …)`: returns ONLY the actor's copy plus the roster (`rosterForCopy` over `pmPresenceRoster(board)`, the position intervals of the day and the copy's added positions), the criteria per position, and the actor's own grades/notes. **Other copies appear as counts only** ("2 other managers have started a copy").
  - `saveGrade` / `saveNote` / `addPosition` / `setWindow` / `markDone` / `reopenCopy` / `submitDay` call `canWritePmCopy` / `canMarkDone` / `canReopenPmCopy` and `gradeTargetProblem` before I/O (the lib layer of P1-1 and P2-9), map every RPC code to `PmReportError` (`position_not_at_shop`, `position_retired`, `position_not_worked` → 422; `copy_done`, `copy_sealed`, `copy_not_done`, `report_already_submitted` → 409; `not_copy_author` → 403), audit each (`pm_report.copy_*`, `pm_report.copy_reopen`, `pm_report.submit_v2`), and **never enqueue a notification**. Test: a lib refusal and the RPC refusal agree on the code for the same input.
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
  - **Lifecycle in the UI (r1 P2-9, the same table):** an `open` copy is editable. A `done` copy renders READ-ONLY, with every control disabled and a banner "You marked this done · Reopen to change it" / "Marcaste esto como terminado · Reábrelo para cambiarlo" plus a **Reopen** button. A `sealed` copy renders as results only. The UI test renders all three states from the shared lifecycle fixture.
  - **Grade targets:** each person card offers only positions from the roster (recorded intervals + this copy's added positions); "Worked somewhere else?" lists only ACTIVE positions of this shop. A refusal from the server (`position_retired` if a position was retired mid-shift) shows its en + es message on that card.
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

- [ ] **The editor** (GM own shop, MoO+ any; **Tier E**, R10: every write route calls `assertStepUp(ctx, "E")`, the catalog's fixed 15-minute password window, and the page uses the existing edit-window unlock component; the tier map test `tests/step-up-tier-map.test.ts` gains the two routes): positions of the shop with their criteria, plus "Every position" for the shared ones. Add, rename (en + es side by side, the C.44 rule), reorder, deactivate (never delete). Audited `pm_criteria.create` / `pm_criteria.update` with before/after labels. A deactivated criterion keeps its past grades and stops appearing on new copies.
- [ ] **The seed script** reads `docs/seed/pm-criteria-2026-10-15.json`, the criteria **Juan confirmed on 2026-10-15** (the table below, verbatim). It maps each position by `(location_id, station name, position name)` read from the database and prints every match. It refuses on any unmatched name (never guesses), and is a dry run unless `--apply`. Audit rows carry `actor_context: "seed_pm_criteria"`, behind a `pathToFileURL` guard. **The criteria are editable DATA in `pm_criteria`, never code (R1).** The seed runs once per shop after Task 14b's BOH positions exist, and after that managers edit them in the editor. CC runs the apply on sim first, then on prod on Juan's word.
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
  - **(c) skills:** PM observations come from SUBMITTED v2 days only (`tunables.gradeValue`, weighted by observed minutes), independent of the `gradientTally` switch, because skills are a new view, not a legacy number. A v1 grade has no position, so it never enters a position skill (J6). One overlap test: a day with a v2 grade + a closing line + a batch for the same position adds ONE quality day (P2-7).
- [ ] **Step 2:** implement. `PeopleInputs` is resolved per shop from `people_shop_settings` in the wrappers, so the pure functions receive it as a parameter.
- [ ] **Step 3:** green. Commit.

## Task 24: The law (AGENTS.md)

- [ ] Add a section "### Scheduling Phase 1: 7shifts mirror, people layer, PM v2 (0268–0271)" with the durable rules:
  - 7shifts is a read MIRROR keyed by 7shifts ids, never deleted, with PII dropped in the normalizer (the list);
  - person and shop links are manual only, joined at read time (unlink removes attribution at once);
  - `SEVENSHIFTS_ACCESS_TOKEN` is Juan's; `SEVENSHIFTS_SYNC=1` comes after 0268/0269; the client is GET-only;
  - the job is not in `JOBS_REGISTRY` (no email before launch); sync status is in-app;
  - each mirror's write shape lives in `MIRROR_WRITE_SPEC` only; assignments and wages are snapshot-reconciled by their one RPC and retire only after a COMPLETE per-user snapshot; malformed pagination is `bad_pagination`, never an end; each endpoint declares its response shape (`paginated` | `singleton` | `list-unpaginated`) and only paginated ones demand a cursor; ANY normalizer rejection makes a user's snapshot incomplete (no retire, no watermark);
  - one company per token (multi-company is `not_supported`); `punch_id` is never stored;
  - one people fact loader + pure rules; a new consumer of people facts goes through `loadPeopleFacts`, never its own query;
  - the people equivalence pin is permanent; new inputs enter only through `PeopleInputs` per shop;
  - skills key on `station_positions.id` (shop-scoped); quality evidence is DATED and `n` is the distinct quality-day set; learned = shrink(prior, q, n) and `confidence = n/(k+n)`; the tunables are settings (`people_skill_tunables`, MoO+, validated by the SAME rules in SQL and TS: k > 0, 0 < building < strong < 1, weights ≥ 0 with sum > 0, prior ∈ [0, 1]); a kind with weight 0 never counts, and with no counting kind the skill is the prior with confidence 0, so every output is finite; the adjustment is ±0.30 in 0.05 steps, append-only and audited; prep evidence reads `productions` with the yield-stats filters, never a maker join; `loadSkillMatrix` is the Phase 2 contract;
  - people-data authorization takes the trusted ROLE (`Viewer.role`, `PeopleActor`), never a level alone;
  - PM v2 is blind until submit; one copy lifecycle (`PM_COPY_TRANSITIONS`: done is read-only until Reopen); every grade is bound to a position of the report's shop (composite FKs) that the subject worked or this copy added; submit seals; averages are weighted by observed minutes; no notification; criteria are DATA (Tier E editor);
  - `social_media_mgr` is refused people data by ROLE;
  - wage rates are MoO+ only and GMs get shop totals (no Phase 1 surface).

  Fix the "Current state" migration lineage line to name 0268–0271 as authored, NOT applied.
- [ ] Commit.

## Task 25: The manager guide (en + es)

- [ ] `docs/guides/manager-guide.md`: three short sections, each with an es twin, no screenshots yet (marked "not shown"):
  - "Linking people to 7shifts" ("we never match by name; you confirm each person");
  - "Skills per position" ("what the bar means, where the evidence comes from, when to adjust and why a reason is required");
  - "PM report copies" ("your copy is private until the closing manager submits; what Didn't see means; why the averages weight by time on the floor").
- [ ] Commit (docs-only).

## Task 26: Final verification

- [ ] `npx vitest run` (full suite, after the other builder's run has finished on that machine). `node scripts/sql-harness-0268.mjs … 0271.mjs` all print PASS. `npx tsc --noEmit`. `npm run build`.
- [ ] Every new string has en + es. `scripts/check-ui-tokens.ts` is clean for the new components.
- [ ] Grep proofs, each with zero hits in new code: `rg "\"EM\"|\"MEP\"" lib/people lib/sevenshifts lib/pm-report-v2* components/people components/pm-report-v2 app/admin/sevenshifts`; `rg "enqueueNotification|lib/email" lib/people lib/sevenshifts lib/pm-report-v2.ts`; `rg "method:\s*\"(POST|PUT|PATCH|DELETE)\"" lib/sevenshifts`.
- [ ] The golden is unchanged since Task 1 (`git log --follow tests/fixtures/people-layer-golden.json` shows one commit).
- [ ] Hand CC the apply order: 0268 → 0269 → 0270 → 0271 (sim, then prod on Juan's word), then `SEVENSHIFTS_SYNC=1`. Juan's token is independent and can come at any time. Before switching `pm_v2` on for a shop: Task 14b's BOH positions exist there (dry run exit 0) and the confirmed criteria are seeded there (Task 22).

---

## Chunk map

| Chunk | Tasks | Delivers | Independently testable by |
|---|---|---|---|
| A | 1–4 | The frozen golden; the permission rules; position intervals; the 7shifts limiter / paginator / normalizers / endpoint table; the audit vocabulary | vitest only, no DB |
| B | 5–7 | 0268 + harness; the GET-only client + status; the sync run + ledger | PGlite harness; fake fetch + fake db |
| C | 8–10 | the hourly cron + Sync now; 0269 + harness; manual shop/person links; `/admin/sevenshifts` with the "Not connected" state | route tests; PGlite; lib tests; SSR UI tests |
| D | 11–13 | team-metrics/profiles on ONE loader + pure rules; the SMM refusal | the golden (byte-identical) |
| E | 14, 14b, 15–17 | 0270 (incl. tunables); the BOH positions data step; the skill model (dated observations, confidence); skills loader + matrix + adjust/rate/tunables; manager + self skill views | PGlite; pure tests; schema check; SSR |
| F | 18–22 | 0271; PM v2 pure rules; lib + RPC writers; copy form / results / my feedback; the criteria editor + seed | PGlite; pure + lib tests; the no-notify pin |
| G | 23–26 | PM v2 into scoring behind the per-shop switch; AGENTS.md; the guide; verification | the golden (off) + delta tests (on) |

---

## PM criteria per position — Confirmed by Juan 2026-10-15

Juan confirmed the r1 draft as written, plus two additions he made (CC notes r1b and r1d):
- a guest criterion placed FIRST on both Walk-ins positions;
- a "helps walk-ins" criterion placed LAST on 3rd Party Station.

Expeditor and 3rd Party have no guest-facing criterion.

**These rows SEED the editable `pm_criteria` DATA** (Task 22's seed file `docs/seed/pm-criteria-2026-10-15.json`). They are never code: after the seed, managers change them in the criteria editor (Tier E). Every criterion is graded **Great / Good / Needs work**, with **Didn't see** always available, and every position also gets the two **shared** criteria.

| Position (as in `station_positions`) | Criteria, in order (en / es) |
|---|---|
| **Every position (shared)** | Arrived ready (on time, in uniform) / Llegó listo (a tiempo, con uniforme) · Teamwork and attitude / Trabajo en equipo y actitud |
| **Expeditor** | Ticket accuracy (right items, right mods) / Precisión de tickets · Pace (tickets moving, no pile-ups) / Ritmo · Clear call-outs and communication / Comunicación clara · Bags checked before hand-off / Bolsas revisadas antes de entregar |
| **Register & Delivery** | Order accuracy at the register / Precisión en caja · Greets and helps guests / Atención al cliente · Delivery hand-offs (right bag, right driver) / Entregas correctas · Cash handling / Manejo de efectivo |
| **Walk-ins** | **Greets guests promptly and takes the order in a welcoming way / Saluda rápido y toma la orden de forma amable** · Builds to spec (portions, order) / Arma según la receta · Speed in the rush / Rapidez en la hora pico · Station stocked and clean / Estación surtida y limpia · Helps online when there are no walk-ins / Ayuda con pedidos en línea |
| **Walk-ins / Online** | **Greets guests promptly and takes the order in a welcoming way / Saluda rápido y toma la orden de forma amable** · Online order accuracy / Precisión en pedidos en línea · Ready by the quoted time / Listo a la hora prometida · Balances walk-ins and online / Equilibra tienda y en línea · Station stocked / Estación surtida |
| **Crunchy Boi Station** | Builds to spec / Arma según la receta · Speed / Rapidez · Station stocked and clean / Estación surtida y limpia |
| **3rd Party Station** | Ticket accuracy, incl. modifications / Precisión incluyendo cambios · Packed and labeled right / Empaque y etiquetas correctas · Ready for driver pickup / Listo para el repartidor · **Helps walk-ins when there are no 3rd-party orders / Ayuda en tienda cuando no hay pedidos de terceros** |
| **Prep** | Prep list done on time / Lista de prep a tiempo · Yield and portions vs recipe / Rendimiento y porciones · Safe, clean slicer and knife work / Rebanadora y cuchillos con seguridad y limpieza · Labeled and dated (first in, first out) / Etiquetado y fechado (PEPS) |
| **Prep/Dishwasher** | Prep list done on time / Lista de prep a tiempo · Dishes kept up (no pile at rush or close) / Platos al día · Sanitation and cleanliness / Higiene y limpieza · Closing dish duties done / Tareas de cierre de platos |

Positions that exist in a shop but are not listed get the shared criteria only, until a manager adds their own in the editor.

---

## What Phase 2 reads (the skill contract for the scheduler)

The Phase 2 scheduler (spec §6, §6.5, and the new §5.7 position rules) reads ONE function: `loadSkillMatrix(service, { actor, locationId, window })` → `SkillMatrix`. It is built in Task 16 and pinned by its own tests. Phase 1 builds no scheduler logic on top of it.

```ts
export interface SkillMatrix {
  locationId: string; asOf: string; tunablesVersion: string;   // a digest of the resolved tunables
  positions: Array<{ positionId: string; stationId: string; name: string; nameEs: string | null; active: boolean }>;
  people: Array<{ userId: string; role: RoleCode;
    skills: Array<SkillResult> }>;   // one per (person × active position); value, band, confidence, evidence, adjustment
}
```

- **Skills per position:** `value` (the number the scheduler weighs), `learned`, `prior`, `adjustment`.
- **The evidence behind each:** `evidence` (i18n lines) and `perKind` (mean, count and days per kind), so a Phase 2 reason line can cite them ("Walk-ins on time 94%").
- **Confidence:** `confidence = qualityDays / (priorStrength + qualityDays)`, plus `qualityDays`, `workedDays`, `minutesWorked`, `startingPoint`. Phase 2's "newer people beside a strong one" and "hardest slots to the strongest" can tell a confident 0.8 from a prior-led 0.8.
- **Every person, managers included.** The matrix covers members of every rankable level AND managers (SL+). Phase 2's "preferred cover positions per manager" ranks a manager's ordered list by these same skills, and its validator (§6.5: one person per position, allowed roles, position windows) checks against the same `positionId`s. Phase 1 does not store allowed roles, priority or preferred cover positions; those are Phase 2 settings.
- Phase 1 never reads `station_positions.sort` as priority (see ground truth).

---

## Judgment calls (made in this plan; each is reversible in one place)

- **J1 — Level-6 operational roles keep team visibility.** AGM, prep manager and catering manager see team scoring as they do today; `social_media_mgr` is refused by ROLE. This is now CC default R7.
- **J2 — Skills key on the shop's `station_positions.id`.** Two shops' "Expeditor" rows are separate positions, so a person working both shops has a skill per shop, and the location bind falls out of the key. There is no cross-shop name rollup.
- **J3 — Staff see bands, not numbers, and never an adjustment** (R8).
- **J4 — Wages are synced; individual rates are for MoO+ only, and GMs get shop totals** (R5). Phase 1 builds no wage surface; the two access rules ship as tested pure functions.
- **J5 — One 0–1 scale, a neutral prior of 0.5.** The mockup's per-role defaults are sample data and are not adopted.
- **J6 — PM v1 grades do not feed position skills.** They have no position. They keep feeding `gradientTally` exactly as today.
- **J7 — Assignment changes and Toast hourly sales are evidence, not skill math.**
- **J8 — Adjust, rate and PM copies take no step-up.** The criteria editor takes **Tier E** (R10); the skill tunables editor is MoO+ and takes Tier E too (it shapes every shop's read).
- **J9 — After submit, a day's PM results are for its authors, GM/Op-6 of the shop, and MoO+**, not every KH/SL of the shop.
- **J10 — PM v2 free text stays with managers** (R9, consistent with 0267).
- **J11 — The closing manager is whoever submits** (KH+ with pm_report task access). Phase 2's Closing Manager role can narrow it.
- **J12 — A manager may add a position a person worked without tapping in.** The addition is per COPY: it opens grading of that position only in the copy that added it (r1 P1-1 (e)).
- **J13 — The sync job is not in `JOBS_REGISTRY`;** sync status is in the app only (R6).
- **J14 — 7shifts punches are mirrored but do not change presence ("Who's here") in Phase 1.**
- **J15 — Hourly sync at :20.** CC checks the cron budget.
- **J16 (r1) — One copy lifecycle: `done` is read-only until an explicit Reopen.** The alternative, "a write silently reopens a done copy", was rejected: a manager who marked done must not have their copy change state without a deliberate act, and the closing manager's "2 marked done" count must mean something.
- **J17 (r1) — Assignments and wages are reconciled per user, by a definer RPC that is their only writer.** Retirement needs a COMPLETE snapshot of that user. A failed or malformed page never retires anything, and history is kept (a reappearing edge is a new row).
- **J18 (r1) — Run ids are minted before the ledger row** (`sevenshifts_sync_run_ids`), so reconciled rows can name their run while the ledger stays append-only and is written once at the end.
- **J19 (r1) — Skill tunables are company-wide with an optional per-shop override, MoO+ only**, validated identically in SQL and TS. No row = the defaults, so nothing needs seeding.
- **J21 (r2) — Snapshot completeness is decided per user, not per resource.** One user's rejected row blocks only that user's retirements (and the resource's watermark); other users in the same run reconcile fully.
- **J22 (r2) — Weights are normalised at use, not required to sum to 1.** An editor can set 0.6 / 0.2 / 0.2 or 3 / 1 / 1 with the same meaning: each weight is ≥ 0 with no upper cap, at least one is > 0, and the sum is finite (Task 14's rules; the per-weight cap of 1 in r2 was dropped by CC's ruling on Astra r3 P3). A weight of 0 means "show it, don't count it".
- **J23 (r2) — No property-testing dependency.** The finite-output test uses a seeded in-repo generator plus an exhaustive edge grid, so no new package enters the lockfile.
- **J20 (r1) — A position added mid-shift and then retired:** grades already saved stay (history). A new grade on it is refused `position_retired`, and the UI explains why.

## Resolved (CC defaults, Juan may override)

| # | Question | Resolution | Where it lands |
|---|---|---|---|
| R1 | PM criteria per position | **Confirmed by Juan 2026-10-15**: the draft + the Walk-ins guest line (first, both Walk-ins rows) + the 3rd Party "helps walk-ins" line (last). Editable DATA in `pm_criteria`, not code; seeded once per shop. | Criteria table; Task 22 |
| R2 | 7shifts plan tier, token, companies | Assume **Pro**. Juan sets `SEVENSHIFTS_ACCESS_TOKEN`. One company per token; multi-company → status `not_supported` (`multi_company`), nothing read. | Env section; Tasks 6, 7, 10 |
| R3 | Prep / Prep/Dishwasher positions | A one-time data step, **dry run first, through the existing station admin, never a migration**, names "Prep" and "Prep/Dishwasher" at both shops. | Task 14b |
| R4 | Person-link flow | The link screen shows the **7shifts employee id + name + role(s)**; no auto-match by name; GM own shop, MoO+ any. `punch_id` is never stored. | Tasks 4, 10 |
| R5 | Wages | Individual rates **MoO+ only**; GMs see **shop totals**. No Phase 1 surface. | Permissions; Task 2 |
| R6 | Sync failure alerts | **No email**; in-app sync status only. CC checks the cron budget. | Ground truth; Tasks 8, 10 |
| R7 | Team scoring visibility | Level-6 operational managers (AGM, prep_mgr, catering_mgr) keep it; **social_media_mgr removed**. | Permissions; Task 13 |
| R8 | What staff see of skills | A band, **Strong / Solid / Building** (es **Fuerte / Sólido / En progreso**), never numbers, never adjustments. | Task 17 |
| R9 | PM free text and staff | Stays **private** from staff. | Permissions; Task 21 |
| R10 | Criteria editor password | **Tier E.** | Task 22 |
| R11 | Skill constants | The starting defaults stand, stored as **tunable settings** with tests (SQL + TS validators pinned equal). | Tasks 14, 15, 16 |

## Still open (genuinely Juan's or CC's)

- **O1 — The 7shifts reference re-read.** Task 6 Step 1 re-reads the endpoint pages at build time; if a path changed, it is fixed in one table. Not a question for Juan unless an endpoint we rely on turns out to need a plan above Pro (then: upgrade, or live without that resource).
- **O2 — The cron budget** (CC): one more hourly Vercel cron.

## Findings for CC (outside this phase's scope)

- **F1 (security):** `pm_evals_read_self` (0072) exposed `note` to the employee through PostgREST. **Being fixed by `0267_pm_evals_privacy`** (lead ruling); this plan depends on it.
- **F2:** `TEAM_VIEW_LEVEL = 6` admits `social_media_mgr` to team scoring today. Task 13 closes it (R7).

## Self-review against the spec and the GO

| Requirement | Where |
|---|---|
| 7shifts read: users + assignments, roles/stations, availability, time off, published shifts, punches, wages, labor settings | Tasks 4–7 (stations as bare `station_id`; there is no stations endpoint in the docs, noted) |
| Poll-based, company token, rate limits 10/s + 600/min, pagination | Tasks 4, 6, 7 (80% self-limit, strict cursor follower, 429 backoff) |
| Raw facts append-only or upsert-by-id + a sync ledger | 0268: per-resource conflict keys (the mirror spec), reconciled assignments and wages with history, `sevenshifts_sync_runs` append-only |
| Reconcile by stable ids; person match ONLY by a manager-confirmed link, never by name | 0269 (no `source`, `linked_by` NOT NULL, no name compare); Task 10 (no suggestion, pinned; employee id shown) |
| Token absent → dormant + "Not connected"; the exact env var named | `SEVENSHIFTS_ACCESS_TOKEN` (Juan); status line; Task 7 dormant test |
| No emails/notifications | No `JOBS_REGISTRY` entry; v2 submit enqueues nothing; the no-notify pin (Task 20) |
| One profile per person from attributed facts | `loadPeopleFacts` + pure rules (Tasks 11, 12, 16) |
| Skills per position, learned, with evidence (and confidence, for Phase 2) | Tasks 15–17; "What Phase 2 reads" |
| Manager adjustment recorded/audited/shown; new hires from the manager rating | 0270; Tasks 16–17 |
| My Performance + team scoring read the SAME layer; no second scoring system | Tasks 11–13 (wrappers over one loader; role carried) |
| Equivalence pin: freeze first; unchanged until new inputs are switched on | Task 1 (golden alone, after 0267 merges, before any lib change); Task 23 (off ⇒ identical; on ⇒ only that shop moves) |
| PM v2: a copy per manager, private until the closing manager submits | 0271 + Tasks 19–21 (author-only reads, counts only, one lifecycle, submit seals) |
| Per-station evaluations for stations actually worked, criteria dropdowns + free text | `positionTimeline` + `rosterForCopy`; grades bound to the shop and to worked/added positions (P1-1) |
| After submit: side by side, attributed; averaged per person × station × criterion weighted by observation time; write-ins; recurring themes | Task 19; Task 21 |
| Results feed the people layer | Task 23 |
| Criteria per position | Confirmed table (R1); Task 22 seeds DATA |
| Migrations 0268–0271 after 0267; privilege ceiling, deny-all RLS, append-only history, PGlite per migration | Migrations table; Tasks 5, 9, 14, 18 |
| Location bind; SMM refused from people data; who sees whose PM copy; skills visibility | The permissions matrix; Tasks 2, 13, 16, 20 |
| Chunks of 3–5 tasks, TDD, pure first | 7 chunks (4/3/3/3/5/5/4); every task test-first; Chunk A is pure |
| i18n en/es tú, phone-first 375 px / 44 px, disclosure doctrine | Standing rules; Tasks 10, 17, 21, 22, 25 |
| Customer contact data never in logs; staff personal data minimal; wages considered | No customer table is touched; the normalizer drops PII with a leak test; `punch_id` not stored; wages MoO+ (R5) |
| Never key on `EM`/`MEP` | Standing rule; the Task 26 grep |
| Spec additions since 2da88061 (min shift, one per position, priority, preferred cover, §6.5) | Ground truth row; "What Phase 2 reads" |
| The mockup | Read from the bridge file; the Phase 1 / Phase 2 map |

## Round 1 response (Astra r1, CHANGES REQUESTED: 2 P1, 7 P2)

| # | Finding | What changed | Where | Test |
|---|---|---|---|---|
| P1-1 | PM grades not bound to a valid position at the report's shop | Composite FKs prove that copy, criterion and position share the report's `location_id` (new `unique (id, location_id)` on `pm_reports`, `pm_report_copies`, `pm_criteria`; 0270's on `station_positions`). The RPC refuses, in order: `position_not_at_shop` (foreign shop OR nonexistent UUID), `position_retired`, `position_not_worked` (no station event at that position that day AND not added by THIS copy), `criterion_mismatch` (including a position criterion with another position). The lib twin `gradeTargetProblem` runs before I/O. | Task 18 (schema, RPC Step 1), Task 19 (`gradeTargetProblem`), Task 20 (lib), Task 21 (UI offers only valid targets) | Harness P1-1 (a)–(h): foreign-shop position, **retired position**, **nonexistent UUID**, not-worked, added-by-this-copy vs another copy, foreign criterion, position mismatch, shared + null; FK backstop by direct insert; one shared JSON case file for lib and RPC |
| P1-2 | `pm_evals_read_self` exposes `note` (F1) | Not re-solved: the plan **depends on `0267_pm_evals_privacy`** (lead ruling). Task 1 waits for 0267 to merge; 0271's preflight asserts 0267 is applied; v2 tables are deny-all. | Header prerequisite; ground truth; Task 1; Task 18 preflight | 0271 harness: the preflight refuses without 0267 |
| P2-3 | Upsert-only sync cannot retire removed assignments | `sevenshifts_user_assignments` and `sevenshifts_wages` become snapshot-reconciled: `active` + `first_seen_run` / `last_seen_run` / `retired_run` + `retired_at`, one live row per identity, history kept. A single writer RPC `reconcile_sevenshifts_user_snapshot` retires ONLY after a complete per-user snapshot and refuses retirement (`snapshot_incomplete`) after a partial one. Run ids are minted up front. | Task 5 (Steps 3, 3b, 3c, 4), Task 7 | Harness H4b (a)–(g); sync tests: removal retired after a complete snapshot; 5xx on page 2 → nothing retired, watermark kept; unfetched users untouched |
| P2-4 | A generic `on conflict (id)` contradicts the schema | `MIRROR_WRITE_SPEC`: per resource the table, normalizer, emitted columns and exact conflict key (`(id)` ×8, `(company_id)` for labor settings) or reconcile identity (`edge_key`; `(user_id, wage_id, upcoming)`). | Task 4 Step 3b, Task 5 H4 + Step 6b, Task 7 | `tests/sevenshifts-mirror-upsert.test.ts`: PGlite runs the REAL upsert/reconcile for every spec entry against the declared schema (insert then update); normalizer keys = spec columns |
| P2-5 | Malformed pagination truncates silently | `pageStep` returns `next` / `end` / `malformed`; `end` only on an explicit `meta.cursor.next === null`. `malformed` → `bad_pagination` (distinct from `deadline` and `server_error`); `page_cap` and `cursor_loop` are failures too; the watermark is kept and the snapshot is incomplete. | Task 4 Step 2, Task 7 | Malformed shapes on page 1; **valid page 1 + malformed page 2 → `bad_pagination`, `complete: false`, watermark unchanged, run `partial`** |
| P2-6 | Maker join of prep sessions × productions multiplies rows | The `prep_batch_sessions` join is dropped. Prep facts read `productions` alone with `lib/yield-stats.ts` `loadBatches`'s exact columns and filters (`superseded_at`/`revoked_at` null, `batches_made > 0`, `came_out_to`/`yield_at_time` not null), mapped to `YieldBatch`; one production row = one observation (`sourceId` = production id). | Ground truth; Task 15 (`prepYieldObservations`); Task 16 (`productionFacts`) | Recording-client parity test with `loadBatches`; one maker × 2 sessions × 2 productions → exactly 2 observations |
| P2-7 | The skill input cannot compute its confidence formula | Signals are DATED `QualityObservation`s (position, day, kind, value, weight, sourceId) plus separate `WorkedDay` exposure. `n` = the distinct-day SET across all kinds; `confidence = n/(k+n)`; worked days never count as quality days. | Task 15 (types, formula), Task 16, Task 23 (c) | Overlap tests: PM + closing + prep on one day = 1 quality day; three days = 3; 20 worked / 1 quality day → n = 1; a duplicate `sourceId` counts once; window edge |
| P2-8 | Role refusal vs a role-less `Viewer` | `Viewer` gains a REQUIRED trusted `role` from the session; `PeopleActor` built by `peopleActorFromAuth`. Every caller is listed and updated (`my-feedback`, trends, team, person page incl. `loadPersonReportLocations`, `report-export:249/269`), and every fixture. `tsc` catches a missed site. | Permissions preamble; ground truth; Task 2; Task 11 Step 5; Task 13 | `tests/people-role-carry.test.ts`: same level 6, same shop, AGM allowed vs SMM refused on all four entry points + export + page gate; prep_mgr and catering_mgr follow AGM |
| P2-9 | "Done" copies have contradictory edit rules | ONE lifecycle, `PM_COPY_TRANSITIONS`: writes need `open`; `done` is read-only; only `reopen_pm_copy` (author, day open) leaves it; submit seals open + done. The same table drives the pure rules, the RPC guards (`copy_done`, `copy_not_done`, `copy_sealed`) and the UI (read-only banner + Reopen). | Permissions; Task 2; Task 18; Task 20; Task 21; J16 | `tests/fixtures/pm-copy-lifecycle-cases.json` iterated by the pure test, the 0271 harness and the UI test |

## Round 2 response (Astra r2, CHANGES REQUESTED: r1 P2-3 partly open + 3 new P2)

| # | Finding | What changed | Where | Test |
|---|---|---|---|---|
| r2 #1 | Singleton responses (assignments) rejected as malformed pagination | Every `SEVENSHIFTS_ENDPOINTS` entry declares `shape: paginated \| singleton \| list-unpaginated`, and the client dispatches on it. Only `paginated` uses `pageStep` and demands a cursor. Singletons (assignments, wages, labor_settings, whoami) are ONE request validated by their own snapshot validator (`bad_snapshot` on failure). `normalizeAssignments` turns the documented `{locations, departments, roles}` object into edges. whoami's company comes from the distinct `users[].company_id`. | API facts; Task 4 Steps 2–3; Task 6; Task 7 | A test per shape. The documented assignments example (verbatim fixture) goes client → `normalizeAssignments` → reconciler and gives one live edge and status `ok`. Malformed singletons give `bad_snapshot`. A pin that every endpoint declares a shape. |
| r2 #2 (closes r1 P2-3) | Skipped malformed rows can retire valid assignments/wages | Normalizers return `{rows, rejected}` and never drop silently. `p_complete = request ok && shape ok && rejected.length === 0`, per user. An incomplete snapshot passes its valid rows (add/update only), retires nothing, records `incomplete_snapshot` in the ledger, and holds the watermark. An all-rejected snapshot is incomplete; only a genuinely empty, fully valid snapshot retires. List resources with rejections are marked failed and keep their watermark. The RPC refuses `p_complete=true` with an invalid row. | Task 4 Step 3; Task 5 Step 3c + harness (c2); Task 7 | (i) A malformed row for user X → X's existing edge stays LIVE, `incomplete_snapshot`, watermark held. (ii) Mixed valid/invalid across two users. (iii) An entirely invalid snapshot retires nothing. (iv) A genuinely empty snapshot retires. (v) The same for wages. Plus a shifts page with one bad row keeps its watermark. |
| r2 #3 | Accepted tunables can make skill computation undefined | One rule set in TS AND SQL (a shared case file): numbers only; k > 0; 0 < building < strong < 1; weights ≥ 0 with sum > 0 (normalised at use); prior ∈ [0, 1]; gradeValue ordered; integer windows. A rejected set leaves the previous set live. Defined semantics: only COUNTING kinds (observed AND weight > 0) enter q and n; no counting kind → learned = prior, confidence 0, qualityDays 0, startingPoint, with the uncounted evidence still shown. Within-kind zero weights fall back to equal weights. `skillFor` asserts finite outputs. | Task 14 (rules, harness); Task 15 (formula, tests) | The shared case file runs against the TS validator and the SQL CHECK. Valid A then invalid B → A still live. The zero-weight example (`{pm:1,…0}`, closing-only person). A property test (seeded generator + edge grid): every accepted configuration × every sparse evidence combination gives finite in-range outputs, and confidence 0 ⇔ qualityDays 0. |
