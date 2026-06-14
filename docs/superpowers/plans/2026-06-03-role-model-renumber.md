# Role-Model Renumber (0–10 scale) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Renumber the CO-OPS role-level model to a 0–10 scale so `employee` sits strictly below `key_holder`, fixing the `employee = key_holder = 3` collision that lets employees pass every KH+ gate (the §8.4 revoke bug and every other opening/AM-prep/finalize authority gate).

**Architecture:** Levels live in exactly two sources that must move atomically — `lib/roles.ts` ROLES registry (app layer) and the DB `current_user_role_level()` CASE (RLS layer). Every consumer reads a level via one of those two. The renumber shifts `key_holder` and everything above it up by one tier; `employee` stays at 3 and `trainee` at 2; four new roles are added below/around. Because `role_level` is baked into the session JWT at login, the cutover revokes active sessions so no one carries a stale level.

**Tech Stack:** Next.js 16 / React 19, TypeScript (strict + noUncheckedIndexedAccess), Postgres 17 on Supabase (RLS), custom JWT auth. Migrations via Supabase MCP `apply_migration` + in-repo text capture under `supabase/migrations/`.

---

## Ground truth established (do not re-derive — verified 2026-06-03)

- **Per-item `min_role_level` is uniformly `3`** across all four templates (Closing v1 inactive/100, Closing v2/116, Opening v1/156, AM Prep v1/76). The KH+-vs-any-staff distinction is NOT carried per-item — it is carried by lib base-access constants (`OPENING_BASE_LEVEL`, `AM_PREP_BASE_LEVEL`) + the assignment fallback (`lib/prep.ts:928-958`) + the separate `opening_*` RLS policies. **Therefore `min_role_level` does NOT get remapped** — leaving it at 3 keeps generic checklist/prep completion at `employee+` (correct: employees complete items).
- **All level-bearing numeric DATA columns are empty** (`announcements.target_min/max_role_level`, `written_reports.visibility_min_level`, `ai_reports.role_level` — 0 rows each). **No stored-data remap needed.** The `*_role` TEXT columns (`actor_role`, `posted_by_role`, `submitted_by_role`) store role *codes*, not levels — unaffected by a renumber.
- **`users.role` CHECK** currently allows exactly 11 codes: `cgs, owner, moo, gm, agm, catering_mgr, shift_lead, key_holder, trainer, employee, trainee`. The four new roles are NOT present and must be added in lockstep (lib union + DB CHECK + DB CASE).
- **DB function** `current_user_role_level()` is `STABLE SECURITY DEFINER SET search_path TO 'pg_catalog','public'`, a CASE over `role`. Full current body is reproduced in Task 8.

---

## The master threshold remap (the single source of truth for every numeric edit)

Every numeric level literal in the codebase — lib constants, `PERMISSION_MIN_LEVEL`, RLS thresholds, UI gates — maps via this table. The only judgement call is the `>=3` split (KH+ vs any-staff), which is **already decided** below.

| old level | meaning | new level |
|---|---|---|
| `2` (trainee) | trainee | **2** (unchanged) |
| `3` (employee) | employee | **3** (unchanged) |
| `3` as a **KH+** gate | key_holder+ | **4** |
| `3` as an **any-staff** gate | employee+ | **3** (unchanged) |
| `4` | shift_lead+ | **5** |
| `5` | agm+ / catering_mgr+ | **6** |
| `6` | gm+ | **7** |
| `6.5` | moo+ | **8** |
| `7` | owner+ | **9** |
| `8` | cgs | **10** |

### Old→new role levels

| role | old | new |
|---|---|---|
| trainee | 2 | 2 |
| employee | 3 | 3 |
| trainer | 3 | **4** |
| key_holder | 3 | **4** |
| shift_lead | 4 | **5** |
| agm | 5 | **6** |
| catering_mgr | 5 | **6** |
| gm | 6 | **7** |
| moo | 6.5 | **8** |
| owner | 7 | **9** |
| cgs | 8 | **10** |
| **prospect** (new) | — | **0** |
| **hired_not_yet_worked** (new) | — | **1** |
| **prep_mgr** (new) | — | **6** |
| **social_media_mgr** (new) | — | **6** |

### The `>=3` split (decided — KH+ → 4, any-staff → stays 3)

**KH+ (→ `>=4`):** `OPENING_BASE_LEVEL`, `AM_PREP_BASE_LEVEL`, `ASSIGNMENT_BASE_LEVEL`, `lib/checklists.ts` tag/picker/revokeWithReason, closing `canFinalize`, `ChecklistItem` tag affordance; RLS `opening_setup_items_insert/update/delete`, `opening_setup_verifications_insert`, `opening_closer_count_snapshots(ocs_read)`, `opening_section_verifications(osv_read)`.

**Any-staff (stays `>=3`):** RLS `checklist_instances_insert/update`, `checklist_completions_insert` (per-item via `min_role_level<=level`, items stay at 3), `customer_feedback_insert/update`, `deep_clean_tasks_read`, `locations_read`, `positions_read`, `position_responsibilities_read`, `recipes_read`, `recipe_ingredients_read`, `recipe_steps_read`, `vendors_read`, `vendor_items_read`, `training_modules_read`, `report_photos_read/insert`, `shift_overlays_insert`, `training_reports_insert/update`, `vendor_deliveries_insert/update`, `written_reports_insert`. PERMISSION keys `overlay.write.cash`, `checklist.complete`, `written_report.write`, `announcement.acknowledge`, `training_report.write`.

---

## COMPLETE per-site remap (read line-by-line before the migration)

Every numeric level literal in all three layers, verified against current code + live `pg_policies` on 2026-06-03. `DATA` = comparison is against a stored per-row value (`min_role_level`, `target_min/max_role_level`, `visibility_min_level`), all of which stay at their stored numbers and live in empty/`=3` tables → **no literal edit**. `CODE-LIST` = gates by role-code array, not a number → no numeric edit (membership decision flagged).

### Layer A — `lib/roles.ts` ROLES registry (15 rows; the source of every app-layer level)
prospect 0(new) · hired_not_yet_worked 1(new) · trainee 2→2 · employee 3→3 · trainer 3→**4** · key_holder 3→**4** · shift_lead 4→**5** · agm 5→**6** · catering_mgr 5→**6** · prep_mgr 6(new) · social_media_mgr 6(new) · gm 6→**7** · moo 6.5→**8** · owner 7→**9** · cgs 8→**10**

### Layer B — lib constants & inline gates
| site | old | new | class |
|---|---|---|---|
| `lib/opening.ts:95` `OPENING_BASE_LEVEL` | 3 | **4** | KH+ |
| `lib/prep.ts:102` `AM_PREP_BASE_LEVEL` | 3 | **4** | KH+ |
| `lib/report-assignments.ts:66` `ASSIGNMENT_BASE_LEVEL` | 3 | **4** | KH+ |
| `lib/report-assignments.ts:225` `assigner.level >= 7` (all-locations) | 7 | **9** | owner+ |
| `lib/locations.ts:13` `ALL_LOCATIONS_THRESHOLD` | 7 | **9** | owner+ |
| `lib/checklists.ts:1683` `actor.level < 3` (tag-actual-completer) | 3 | **4** | KH+ |
| `lib/checklists.ts:1831` `actor.level < 3` (picker-candidates) | 3 | **4** | KH+ |
| `lib/checklists.ts:1883` `actor.level >= 3` (revokeWithReason `isKH`) | 3 | **4** | KH+ |
| `lib/checklists.ts:777` `actor.level < item.min_role_level` | — | — | DATA — no edit |
| `lib/checklists.ts:1069` `highestCompletedMinRole` compare | — | — | DATA — no edit |

### Layer C — `lib/permissions.ts` `PERMISSION_MIN_LEVEL` (every key)
| key | old | new | | key | old | new |
|---|---|---|---|---|---|---|
| overlay.write.cash | 3 | **3** ⚑ | | announcement.post | 5 | **6** |
| overlay.write.voids_comps_waste | 4 | **5** | | announcement.acknowledge | 3 | **3** |
| overlay.write.customer | 4 | **5** | | training_report.write | 3 | **3** |
| overlay.write.delivery | 4 | **5** | | catering.pipeline.write | 5 | **6** |
| overlay.write.staffing | 4 | **5** | | catering.customers.write | 5 | **6** |
| overlay.write.context | 4 | **5** | | vendor.profile.full_edit | 6 | **7** |
| overlay.write.vendor | 5 | **6** | | vendor.profile.trivial_edit | 5 | **6** |
| overlay.write.people | 5 | **6** | | vendor.lifecycle | 6 | **7** |
| overlay.write.strategic | 6 | **7** | | vendor.items.write | 5 | **6** |
| overlay.write.executive | 7 | **9** | | par_levels.write | 6 | **7** |
| overlay.write.forecast | 8 | **10** | | ai.insights.run | 6 | **7** |
| overlay.read | 4 | **5** | | admin.locations | 7 | **9** |
| overlay.correct | 4 | **5** | | admin.users | 6.5 | **8** |
| checklist.complete | 3 | **3** | | view.all_locations | 7 | **9** |
| checklist.confirm | 3 | **4** | | written_report.write | 3 | **3** |
| checklist.template.write | 6 | **7** | | | | |
| checklist.template.enable | 6.5 | **8** | | | | |

### Layer D — DB `current_user_role_level()` CASE: full rewrite to Layer A levels + 4 new `WHEN` arms. `ELSE 0` unchanged.

### Layer E — RLS policies (88 clauses across 45 tables), grouped by new threshold
- **stays `>=3` (any-staff, 22 clauses):** `checklist_instances_insert` ⚑, `checklist_instances_update` ⚑, `customer_feedback_insert`, `customer_feedback_update`, `deep_clean_tasks_read` ⚑, `locations_read`, `position_responsibilities_read`, `positions_read`, `recipe_ingredients_read`, `recipe_steps_read`, `recipes_read`, `report_photos_insert`, `report_photos_read`, `shift_overlays_insert`, `training_modules_read`, `training_reports_insert`, `training_reports_update`, `vendor_deliveries_insert`, `vendor_deliveries_update`, `vendor_items_read`, `vendors_read`, `written_reports_insert`. *(plus `checklist_completions_insert` `min_role_level<=level` = DATA, no edit.)*
- **`3 → 4` (KH+, 6 clauses):** `ocs_read`, `osv_read`, `opening_setup_items_insert_policy`, `opening_setup_items_update_policy`, `opening_setup_items_delete_policy`, `opening_setup_verifications_insert_policy`.
- **`4 → 5` (3 clauses):** `maintenance_tickets_insert`, `maintenance_tickets_update`, `shift_overlay_corrections_insert`.
- **`5 → 6` (19 clauses):** `announcement_acks_read`, `announcements_insert`, `announcements_update`, `catering_customers_insert`, `catering_customers_update`, `catering_orders_insert`, `catering_orders_update`, `catering_pipeline_insert`, `catering_pipeline_update`, `deep_clean_assignments_insert`, `deep_clean_assignments_update`, `training_progress_insert`, `training_progress_read`, `training_progress_update`, `vendor_items_insert`, `vendor_items_update`, `vendor_price_history_read`, `vendors_update_trivial`, `report_assignments_insert` (the `>=5` floor clause).
- **`6 → 7` (25 clauses):** `checklist_template_items_insert`, `checklist_template_items_update`, `checklist_templates_insert`, `checklist_templates_update`, `deep_clean_tasks_insert`, `deep_clean_tasks_update`, `lto_performance_insert`, `lto_performance_update`, `par_levels_insert`, `par_levels_update`, `recipe_ingredients_insert`, `recipe_ingredients_update`, `recipe_steps_insert`, `recipe_steps_update`, `recipes_insert`, `recipes_update`, `tip_pool_distributions_insert`, `tip_pool_distributions_update`, `tip_pools_insert`, `tip_pools_update`, `vendor_orders_insert`, `vendor_orders_update`, `vendors_insert`, `report_assignments_read_admin` (`>=6` floor), `user_locations_read` (`>=6`), `users_read_self` (`>=6`).
- **`6.5 → 8` (12 clauses):** `locations_insert`, `locations_update`, `position_responsibilities_insert`, `position_responsibilities_update`, `positions_insert`, `positions_update`, `training_modules_insert`, `training_modules_update`, `user_locations_insert`, `user_locations_update`, `users_insert_admin`, `users_update_admin`.
- **`7 → 9` (owner+ all-locations override; standalone + OR-clauses):** standalone — `audit_read`, `notifications_read`, `notification_recipients_read`, `report_views_read`, `user_notification_prefs_read`. OR-override inside reads — `announcements_read`, `catering_customers_read`, `catering_orders_read`, `catering_pipeline_read`, `checklist_completions_read`, `checklist_incomplete_reasons_read`, `checklist_instances_read`, `checklist_submissions_read`, `checklist_template_items_read`, `checklist_templates_read`, `customer_feedback_read`, `deep_clean_assignments_read`, `lto_performance_read`, `maintenance_tickets_read`, `par_levels_read`, `prep_list_resolutions_read`, `shift_overlay_corrections_read`, `shift_overlays_read`, `shifts_daily_data_read`, `tip_pool_distributions_read`, `tip_pools_read`, `toast_daily_data_read`, `training_reports_read`, `vendor_deliveries_read`, `vendor_orders_read`, `weekly_rollups_read`, `written_reports_read`, plus the `>=7` clauses in `report_assignments_insert` and `report_assignments_read_admin`.
- **`8 → 10` (cgs, 1 clause):** `sms_queue_read`.
- **DATA (no literal edit):** `announcements_read` `target_min/max_role_level`; `written_reports_read` `visibility_min_level`; `checklist_completions_insert` `min_role_level<=level`. All compare against stored values in empty/`=3` columns.

### Layer F — UI gates
| site | old | new | class |
|---|---|---|---|
| `components/ChecklistItem.tsx:410` `actorLevel >= 3` (tag affordance) | 3 | **4** | KH+ |
| `app/(authed)/operations/closing/closing-client.tsx:283` `actor.level >= 3` (`canFinalize`) | 3 | **4** | KH+ |
| `app/(authed)/dashboard/page.tsx:318` `auth.level >= 7` (all-locations scope) | 7 | **9** | owner+ |
| `app/(authed)/dashboard/page.tsx:349` `auth.level >= 7` (all-locations badge) | 7 | **9** | owner+ |
| `components/ChecklistItem.tsx:212-217` role-badge ladder | 8/7/6.5/6/5/4 | **10/9/8/7/6/5** + new `>=4` KH rung | ⚑ NOT mechanical — re-label, needs new i18n key |
| `app/(authed)/operations/opening/page.tsx:283` `AGM_PLUS_CODES` | — | — | CODE-LIST ⚑ — new-role membership decision |
| `app/admin/layout.tsx:6` `role_level < 6.5` | 6.5 | **8** | COMMENT-ONLY (Phase 0 stub passthrough; doc edit only) |

### ⚑ Flagged judgment calls — RULINGS (Juan, 2026-06-03)
1. **`checklist_instances_insert` / `checklist_instances_update` (RLS `>=3`)** — **VERIFIED, premise holds with one exception. RULING: A+B (both layers), Juan 2026-06-03.** Every LIVE opening/AM-prep/closing instance-creation path is service-role and bypasses this RLS (opening → `create_opening_instance_atomic` RPC via `getServiceRoleClient()`; AM-prep → `loadAmPrepState` direct insert via `getServiceRoleClient()`; closing → `getOrCreateInstance` via `getServiceRoleClient()` — all three Server Component pages use service-role). The SOLE authenticated, RLS-hitting insert path is `POST /api/checklist/instances` ([route.ts:76](app/api/checklist/instances/route.ts)) — `createAuthedClient`, gated only by this `>=3` RLS, accepts **any** templateId with no type guard, and is **called by no client** (orphaned; grep finds zero fetch sites). An employee (level 3) could direct-POST an opening/prep templateId at their location and create a MALFORMED opening instance (bare row, no closer-count snapshots). **Resolution — A+B, both layers** (rationale: "RLS at 3 is fine because the route's orphaned" is the SAME single-layer-gate reasoning that produced the original `employee=key_holder=3` bug; we do not ship a deliberate single-layer gap on the surface we are hardening):
   - **A (route hardening)** — NEW Task 5a: add a template-type guard to `POST /api/checklist/instances` rejecting any non-`closing` templateId (look up `checklist_templates.type` for the posted `templateId`; reject `opening`/`prep` with 403). Closes the application-layer hole regardless of RLS.
   - **B (type-aware RLS backstop)** — Task 8: rewrite `checklist_instances_insert` to require `>=4` when the instance's template `type IN ('opening','prep')`, `>=3` when `type='closing'` (subquery-join `checklist_templates` on `template_id`). DB-layer backstop so a future client / direct-PostgREST call can't reopen the hole even if Task 5a's guard is bypassed or removed.
   - **UPDATE side — no change.** The only authed update path is `confirmInstance`, already lib-gated by `checklist.confirm` (→4); opening/prep updates are service-role.
2. **`deep_clean_tasks_read` (RLS `>=3`) — CONFIRMED stays 3** (reference read, same shape as `recipes_read` / `positions_read`). Writes are `>=6→7`.
3. **`overlay.write.cash` (PERMISSION `3`) — CONFIRMED stays 3** (cash entry is line-staff shift work; consistent with `shift_overlays_insert` = any-staff).
4. **`AGM_PLUS_CODES` over-par `directedBy` dropdown** (`opening/page.tsx:283`) — **CONFIRMED: add `prep_mgr`** (prep direction is relevant to over-par routing); **leave `social_media_mgr` out** (no prep relevance).

---

## GATE ANSWERS (locked 2026-06-03)

1. **New role CODE strings + attributes — CONFIRMED (Juan, 2026-06-03):** `prospect` (0), `hired_not_yet_worked` (1), `prep_mgr` (6), `social_media_mgr` (6). Codes extend `users.role` CHECK + `lib/roles.ts` ROLES in lockstep (DB CASE + app registry, one atomic migration). Attribute rulings for Task 2's registry write:
   - `prospect` (0): **`hasEmailAuth: false`, `canAdmin: false`** — onboarding-pipeline RECORD, not an active user; does NOT authenticate into ops, exists as a row until flipped to trainee/employee on hire. Minimal attributes only (`label`/`shortLabel`/`color`/level). *(Juan to supply final label/shortLabel/color strings; "Prospect" / "PROS" placeholder until then.)*
   - `hired_not_yet_worked` (1): **`hasEmailAuth: false`, `canAdmin: false`** — same record-only/no-auth ruling; exists post-hire, no shift work until first shift. *(label/shortLabel/color strings owed; "Hired" placeholder.)*
   - `prep_mgr` (6) / `social_media_mgr` (6): **mirror `agm` EXACTLY — `hasEmailAuth: true`, `canAdmin: false`.** Operational managers at AGM tier, not admins; matching `agm` prevents accidental over-privilege on admin surfaces. *(label/shortLabel/color: "Prep Manager"/"Social Media Manager" + shortLabels + colors owed from Juan.)*
2. **`checklist.confirm` = KH+ → `4`. RESOLVED.** Confirm is the higher-authority attestation-of-completion beat (same verify-vs-do pattern as opening verification (KH+) vs prep completion (employee)); it sits above employee. Task 3 sets `4`.
3. **ADD a new `role_model.renumber` destructive action — RESOLVED.** Register it in `lib/destructive-actions.ts`; the migration audit row uses it. A once-ever, system-wide authority change gets its own searchable audit code — reusing an existing action would make the forensic trail misrepresent what happened (same honest-trail principle as `quick_reenter`-not-`error_tap`). Task 8 emits the audit row under this action.

---

## File structure (what each surface owns)

- `lib/roles.ts` — RoleCode union + ROLES registry. **Single app-layer source of every level.** (Task 2)
- `lib/permissions.ts` — `PERMISSION_MIN_LEVEL` threshold table. (Task 3)
- `lib/opening.ts`, `lib/prep.ts`, `lib/report-assignments.ts`, `lib/locations.ts` — base-level constants. (Task 4)
- `lib/checklists.ts` — inline KH+ gates. (Task 5)
- `components/ChecklistItem.tsx`, `app/(authed)/operations/closing/closing-client.tsx`, opening/dashboard/admin pages — UI gates + display ladders. (Task 6)
- `lib/i18n/en.json`, `lib/i18n/es.json` — `role.<code>` labels for the 4 new roles. (Task 7)
- DB migration `0058_role_model_renumber` (Supabase MCP) + `supabase/migrations/0058_role_model_renumber.sql` text capture — `current_user_role_level()` rewrite, `users.role` CHECK extension, RLS threshold remaps, audit row. **Single transaction.** (Task 8)
- Session revocation cutover script. (Task 9)

---

## Task 0: Pre-flight level probe (capture BEFORE state)

**Files:**
- Create: `scripts/role-renumber-probe.ts`

The codebase has no unit-test harness for RLS/role changes; verification is by a who-passes probe run before and after. This probe asserts, for one employee user and one key_holder user, who passes each representative gate. We capture BEFORE now; Task 10 re-runs for AFTER.

- [ ] **Step 1: Identify two probe users**

Run (Supabase MCP `execute_sql`, project `bgcvurheqzylyfehqgzh`):
```sql
-- DISTINCT ON guarantees one row per role. A bare `ORDER BY role LIMIT 2`
-- returns TWO employees ('employee' sorts before 'key_holder') and never
-- surfaces a key_holder — the defect the Task 0 subagent worked around.
SELECT DISTINCT ON (role) id, name, role
FROM users
WHERE role IN ('employee','key_holder') AND active
ORDER BY role, created_at;
```
If no `employee`-role user exists, note it — the probe for the employee row uses a synthetic assertion against `current_user_role_level()`'s CASE output instead. Record both user_ids in the probe script as constants.

- [ ] **Step 2: Write the probe**

`scripts/role-renumber-probe.ts` queries `current_user_role_level()` semantics by asserting expected level per role from the registry AND prints the live DB CASE output per role:
```ts
import { getServiceRoleClient } from "@/lib/supabase-server";

const EXPECTED_AFTER: Record<string, number> = {
  trainee: 2, employee: 3, trainer: 4, key_holder: 4, shift_lead: 5,
  agm: 6, catering_mgr: 6, gm: 7, moo: 8, owner: 9, cgs: 10,
  prospect: 0, hired_not_yet_worked: 1, prep_mgr: 6, social_media_mgr: 6,
};

async function main() {
  const svc = getServiceRoleClient();
  // Live DB CASE output for every role code (mirrors current_user_role_level CASE).
  const { data, error } = await svc.rpc("debug_role_levels"); // see Step 3
  if (error) throw error;
  console.table(data);
  console.log("EXPECTED_AFTER (post-renumber):", EXPECTED_AFTER);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Add a throwaway debug function to read the CASE per role (BEFORE snapshot)**

Run (Supabase MCP `execute_sql`):
```sql
SELECT role,
  CASE role
    WHEN 'cgs' THEN 8 WHEN 'owner' THEN 7 WHEN 'moo' THEN 6.5 WHEN 'gm' THEN 6
    WHEN 'agm' THEN 5 WHEN 'catering_mgr' THEN 5 WHEN 'shift_lead' THEN 4
    WHEN 'key_holder' THEN 3 WHEN 'trainer' THEN 3 WHEN 'employee' THEN 3
    WHEN 'trainee' THEN 2 ELSE 0 END AS before_level
FROM (VALUES ('cgs'),('owner'),('moo'),('gm'),('agm'),('catering_mgr'),
  ('shift_lead'),('key_holder'),('trainer'),('employee'),('trainee')) AS r(role)
ORDER BY before_level DESC;
```
Save the output verbatim into the PR description as the BEFORE snapshot. (No `debug_role_levels` RPC is actually created — the inline SQL is the snapshot; the probe script's `console.table` is replaced by re-running this SQL with new numbers in Task 10.)

- [ ] **Step 3a: Capture the employee + key_holder KH+-gate pass/fail matrix (the root-fix proof)**

This is the verification that we fixed the ROOT, not just shuffled numbers. The four representative KH+ gates all gate at `level >= 3` TODAY (the bug: employee and key_holder are both level 3, so BOTH pass every one) and move to `level >= 4` post-renumber. After the migration, employee (still 3) must FLIP to failing all four; key_holder (now 4) must STAY passing. Capture BEFORE now; Task 10 re-runs the identical matrix for AFTER and diffs.

The four gates and their code sites (all `>=3` before → `>=4` after):
| Gate | Code site | Before | After |
|---|---|---|---|
| revoke (Phase-2 / closing) | `lib/checklists.ts:1883` `actor.level >= 3` | ≥3 | ≥4 |
| finalize (closing) | `closing-client.tsx:283` `actor.level >= 3` | ≥3 | ≥4 |
| AM-prep authority | `OPENING/AM_PREP_BASE_LEVEL` (Task 4) + `opening_setup_verifications` RLS | ≥3 | ≥4 |
| tag actual completer | `lib/checklists.ts:1683` / `ChecklistItem.tsx:410` | ≥3 | ≥4 |

Add to `scripts/role-renumber-probe.ts` a matrix that reads each probe user's live level via the DB function and evaluates pass/fail at BOTH thresholds, so the before/after diff is mechanical:
```ts
// Probe-user ids recorded in Step 1.
const PROBE_USERS = {
  employee: "<EMPLOYEE_USER_ID>",   // null/synthetic if no employee-role user exists (Step 1 note)
  key_holder: "<KEY_HOLDER_USER_ID>",
} as const;

const KH_GATES = ["revoke", "finalize", "am_prep_authority", "tag"] as const;
const BEFORE_THRESHOLD = 3; // every KH+ gate today
const AFTER_THRESHOLD = 4;  // post-renumber

// Pre-renumber CASE (mirrors current_user_role_level() BEFORE the migration).
const BEFORE_CASE: Record<string, number> = {
  cgs: 8, owner: 7, moo: 6.5, gm: 6, agm: 5, catering_mgr: 5, shift_lead: 4,
  key_holder: 3, trainer: 3, employee: 3, trainee: 2,
};

async function gateMatrix(svc: ReturnType<typeof getServiceRoleClient>) {
  for (const [label, id] of Object.entries(PROBE_USERS)) {
    if (!id) { console.log(`${label}: no live user — synthetic level from registry`); continue; }
    // current_user_role_level() reads request.jwt claims, so for an out-of-request
    // probe read the user's role and map through the SAME CASE the function uses.
    const { data, error } = await svc.from("users").select("role").eq("id", id).single<{ role: string }>();
    if (error) throw error;
    const lvlBefore = BEFORE_CASE[data.role] ?? 0;   // BEFORE_CASE = the Step 3 pre-renumber map
    const rows = KH_GATES.map((g) => ({
      gate: g,
      before_pass: lvlBefore >= BEFORE_THRESHOLD,
      // AFTER is filled by Task 10's re-run against the post-migration level:
      after_threshold: AFTER_THRESHOLD,
    }));
    console.log(`\n${label} (role=${data.role}, before_level=${lvlBefore}):`);
    console.table(rows);
  }
}
```
Run it (`npx tsx --env-file=.env.local scripts/role-renumber-probe.ts`) and paste the BEFORE matrix into the PR description. EXPECTED BEFORE: employee → all four `before_pass: true`; key_holder → all four `before_pass: true` (this IS the bug — both pass). EXPECTED AFTER (Task 10): employee → all four FAIL; key_holder → all four PASS. That flip is the proof.

- [ ] **Step 4: Commit**

```bash
git add scripts/role-renumber-probe.ts
git commit -m "chore(roles): add role-renumber level probe + KH+ gate matrix + BEFORE snapshot"
```

---

## Task 1: Resolve the two human-gate questions

**Files:** none (decision-only; blocks all subsequent tasks)

- [ ] **Step 1:** Get Juan's confirmation on the four new role code strings and their registry attributes (label, shortLabel, color, hasEmailAuth, canAdmin). Defaults proposed in Task 2.
- [ ] **Step 2:** Get Juan's decision on `checklist.confirm` (KH+ → 4, or any-staff → stays 3). Default in Task 3 is **4**.
- [ ] **Step 3:** Record both answers at the top of the PR description. Do not proceed until both are answered.

---

## Task 2: `lib/roles.ts` — RoleCode union + ROLES registry

**Files:**
- Modify: `lib/roles.ts:9-20` (RoleCode union), `lib/roles.ts:36-49` (ROLES registry)

- [ ] **Step 1: Extend the RoleCode union**

Replace `lib/roles.ts:9-20`:
```ts
export type RoleCode =
  | "cgs"
  | "owner"
  | "moo"
  | "gm"
  | "agm"
  | "catering_mgr"
  | "prep_mgr"
  | "social_media_mgr"
  | "shift_lead"
  | "key_holder"
  | "trainer"
  | "employee"
  | "trainee"
  | "hired_not_yet_worked"
  | "prospect";
```

- [ ] **Step 2: Renumber existing roles + add the four new ones**

Replace the ROLES object (`lib/roles.ts:36-49`). Note `moo` becomes a clean integer `8` (the 0–10 scale removes the 6.5 fraction). New-role `label`/`shortLabel`/`color`/`hasEmailAuth`/`canAdmin` are PROPOSED — apply Task 1 corrections:
```ts
export const ROLES: Record<RoleCode, RoleDefinition> = {
  cgs:                  { code: "cgs",                  label: "Chief Growth Strategist", shortLabel: "CGS", level: 10, color: "#D4A843", hasEmailAuth: true,  canAdmin: true  },
  owner:                { code: "owner",                label: "Owner",                   shortLabel: "OWN", level: 9,  color: "#6B7280", hasEmailAuth: true,  canAdmin: true  },
  moo:                  { code: "moo",                  label: "Manager of Operations",   shortLabel: "MOO", level: 8,  color: "#1F4E79", hasEmailAuth: true,  canAdmin: true  },
  gm:                   { code: "gm",                   label: "General Manager",         shortLabel: "GM",  level: 7,  color: "#2E75B6", hasEmailAuth: true,  canAdmin: false },
  agm:                  { code: "agm",                  label: "Asst. General Manager",   shortLabel: "AGM", level: 6,  color: "#2D7D46", hasEmailAuth: true,  canAdmin: false },
  catering_mgr:         { code: "catering_mgr",         label: "Catering Manager",        shortLabel: "CTR", level: 6,  color: "#E67E22", hasEmailAuth: true,  canAdmin: false },
  prep_mgr:             { code: "prep_mgr",             label: "Prep Manager",            shortLabel: "PREP",level: 6,  color: "#0D9488", hasEmailAuth: true,  canAdmin: false },
  social_media_mgr:     { code: "social_media_mgr",     label: "Social Media Manager",    shortLabel: "SMM", level: 6,  color: "#A855F7", hasEmailAuth: true,  canAdmin: false },
  shift_lead:           { code: "shift_lead",           label: "Shift Lead",              shortLabel: "SL",  level: 5,  color: "#8B5CF6", hasEmailAuth: false, canAdmin: false },
  key_holder:           { code: "key_holder",           label: "Key Holder",              shortLabel: "KH",  level: 4,  color: "#F59E0B", hasEmailAuth: false, canAdmin: false },
  trainer:              { code: "trainer",              label: "Trainer",                 shortLabel: "TR",  level: 4,  color: "#EC4899", hasEmailAuth: false, canAdmin: false },
  // Color picks for employee/trainee/onboarding tiers are tactical neutrals; revisit alongside brand-book role-color system formalization in Module #2 work.
  employee:             { code: "employee",             label: "Employee",                shortLabel: "EMP", level: 3,  color: "#0EA5E9", hasEmailAuth: false, canAdmin: false },
  trainee:              { code: "trainee",              label: "Trainee",                 shortLabel: "TRN", level: 2,  color: "#94A3B8", hasEmailAuth: false, canAdmin: false },
  hired_not_yet_worked: { code: "hired_not_yet_worked", label: "Hired (Not Yet Worked)",  shortLabel: "NEW", level: 1,  color: "#CBD5E1", hasEmailAuth: false, canAdmin: false },
  prospect:             { code: "prospect",             label: "Prospect",                shortLabel: "PROS",level: 0,  color: "#E2E8F0", hasEmailAuth: false, canAdmin: false },
};
```

- [ ] **Step 3: Find exhaustive RoleCode switches that the union widening might break**

Run:
```bash
grep -rn "RoleCode" lib/ app/ components/ --include=*.ts --include=*.tsx
```
For any `switch`/object that must enumerate every RoleCode (exhaustiveness), add the four new codes. The `role.<code>` i18n usage is handled in Task 7. Note any found sites in the PR description.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (registry is exhaustive over the widened union; levels are plain numbers). If a `Record<RoleCode, …>` elsewhere is now non-exhaustive, fix that site before continuing.

- [ ] **Step 5: Commit**

```bash
git add lib/roles.ts
git commit -m "feat(roles): renumber to 0-10 scale + add prospect/hired/prep_mgr/social_media_mgr (lib layer)"
```

---

## Task 3: `lib/permissions.ts` — PERMISSION_MIN_LEVEL remap

**Files:**
- Modify: `lib/permissions.ts:52-92`

- [ ] **Step 1: Apply the master remap to every threshold**

Replace `PERMISSION_MIN_LEVEL` (`lib/permissions.ts:52-92`). `overlay.write.cash`, `checklist.complete`, `written_report.write`, `announcement.acknowledge`, `training_report.write` stay `3` (any-staff). `checklist.confirm` → **4** per Task 1 default (flip to 3 if Juan said any-staff). All others shift per the master table:
```ts
const PERMISSION_MIN_LEVEL: Record<PermissionKey, number> = {
  // Shift overlay
  "overlay.write.cash":              3,   // any-staff (unchanged)
  "overlay.write.voids_comps_waste": 5,   // 4 -> 5
  "overlay.write.customer":          5,
  "overlay.write.delivery":          5,
  "overlay.write.staffing":          5,
  "overlay.write.context":           5,
  "overlay.write.vendor":            6,   // 5 -> 6
  "overlay.write.people":            6,
  "overlay.write.strategic":         7,   // 6 -> 7
  "overlay.write.executive":         9,   // 7 -> 9
  "overlay.write.forecast":          10,  // 8 -> 10
  "overlay.read":                    5,   // 4 -> 5
  "overlay.correct":                 5,
  // Checklists
  "checklist.complete":              3,   // any-staff (unchanged)
  "checklist.confirm":               4,   // ⚠ Task 1 decision (default KH+ -> 4)
  "checklist.template.write":        7,   // 6 -> 7
  "checklist.template.enable":       8,   // 6.5 -> 8
  // Written reports & announcements
  "written_report.write":            3,   // any-staff (unchanged)
  "announcement.post":               6,   // 5 -> 6
  "announcement.acknowledge":        3,   // any-staff (unchanged)
  // Training
  "training_report.write":           3,   // any-staff (unchanged)
  // Catering
  "catering.pipeline.write":         6,   // 5 -> 6
  "catering.customers.write":        6,
  // Vendors
  "vendor.profile.full_edit":        7,   // 6 -> 7
  "vendor.profile.trivial_edit":     6,   // 5 -> 6
  "vendor.lifecycle":                7,   // 6 -> 7
  "vendor.items.write":              6,   // 5 -> 6
  "par_levels.write":                7,   // 6 -> 7
  // AI / admin
  "ai.insights.run":                 7,   // 6 -> 7
  "admin.locations":                 9,   // 7 -> 9
  "admin.users":                     8,   // 6.5 -> 8
  "view.all_locations":              9,   // 7 -> 9
};
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/permissions.ts
git commit -m "feat(roles): remap PERMISSION_MIN_LEVEL to 0-10 scale"
```

---

## Task 4: lib base-level constants

**Files:**
- Modify: `lib/opening.ts:95` (`OPENING_BASE_LEVEL`)
- Modify: `lib/prep.ts:102` (`AM_PREP_BASE_LEVEL`)
- Modify: `lib/report-assignments.ts:66` (`ASSIGNMENT_BASE_LEVEL`), `:225` (all-locations `>=7`)
- Modify: `lib/locations.ts` (`ALL_LOCATIONS_THRESHOLD`)

- [ ] **Step 1: Bump the KH+ base constants 3 → 4**

Edit each constant to `4` (key_holder's new level), keeping surrounding code identical:
- `lib/opening.ts:95`: `const OPENING_BASE_LEVEL = 4;` (was 3)
- `lib/prep.ts:102`: `const AM_PREP_BASE_LEVEL = 4;` (was 3)
- `lib/report-assignments.ts:66`: `const ASSIGNMENT_BASE_LEVEL = 4;` (was 3)

- [ ] **Step 2: Bump the owner-tier all-locations thresholds 7 → 9**

- `lib/locations.ts`: `ALL_LOCATIONS_THRESHOLD` `7` → `9`.
- `lib/report-assignments.ts:225`: the `assigner.level >= 7` all-locations check → `>= 9`.

- [ ] **Step 3: Grep for any other numeric level literal in these files**

Run:
```bash
grep -nE "level\s*(>=|<|<=|>)\s*[0-9]" lib/opening.ts lib/prep.ts lib/report-assignments.ts lib/locations.ts
```
Map every hit through the master remap table. Common cases: a stray `>= 3` that is a KH+ gate → `>= 4`; a `>= 7` → `>= 9`. Update each, leaving any item-data-driven comparisons (`< item.min_role_level`) untouched.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/opening.ts lib/prep.ts lib/report-assignments.ts lib/locations.ts
git commit -m "feat(roles): bump OPENING/AM_PREP/ASSIGNMENT base + all-locations thresholds to 0-10 scale"
```

---

## Task 5: `lib/checklists.ts` — inline KH+ gates

**Files:**
- Modify: `lib/checklists.ts:1683` (tagActualCompleter `!isSelf && actor.level < 3`), `:1831` (picker `actor.level < 3`), `:1883` (revokeWithReason `actor.level >= 3`)
- Leave: `:777` (`actor.level < item.min_role_level`) and `:1073` (`< highestCompletedMinRole`) UNCHANGED (item-data-driven; `min_role_level` stays 3)

- [ ] **Step 1: Bump the three KH+ gates 3 → 4**

- `:1683`: `if (!isSelf && actor.level < 4)` (was `< 3`)
- `:1831`: `actor.level < 4` (was `< 3`)
- `:1883`: `const isKH = actor.level >= 4` (was `>= 3`)

Update the adjacent "KH+ = level >= 3 per C.41" comments to "KH+ = level >= 4 (key_holder, post-renumber)".

- [ ] **Step 2: Sweep the whole file for stray level literals**

Run:
```bash
grep -nE "level\s*(>=|<|<=|>)\s*[0-9]" lib/checklists.ts
```
Reconcile each via the master table. Per-item comparisons against `min_role_level` / `highestCompletedMinRole` are NOT literals and stay as-is.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/checklists.ts
git commit -m "feat(roles): bump checklists tag/picker/revoke KH+ gates to level 4"
```

---

## Task 5a: Route hardening — template-type guard on `POST /api/checklist/instances` (Flag #1, Option A)

**Files:**
- Modify: `app/api/checklist/instances/route.ts`

**Why:** This is the SOLE authenticated, RLS-hitting instance-insert path ([route.ts:76](app/api/checklist/instances/route.ts) `createAuthedClient`). It accepts **any** `templateId` with no type guard and is gated only by the `checklist_instances_insert` RLS (`>=3`). An employee (level 3) could direct-POST an opening/prep templateId and create a malformed opening instance. Option A closes this at the application layer; Task 8 (Option B) adds the DB-layer backstop. Both ship — see Flag #1 ruling (A+B).

**Guard semantics:** the legitimate purpose of this route is the closing UI getting-or-creating today's *closing* instance (docstring line 2-4). It has no legitimate reason to mint opening/prep instances — those are service-role-only via their own RPC/loader paths. So: look up the posted template's `type`; reject anything that is not `closing` with 403.

- [ ] **Step 1: Add a service-role template-type lookup + guard before `getOrCreateInstance`**

The guard must be a read against `checklist_templates.type` for the posted `templateId`. Use the **service-role** client for this read (pure guard decision, not user data) so RLS can't fail-closed against a legitimate closing post. Fail-closed if the template is missing.

Add the import (alongside the existing `createAuthedClient` import):
```ts
import { createAuthedClient, getServiceRoleClient } from "@/lib/supabase-server";
```

Insert the guard immediately after `requireSession` succeeds (after the `ctx instanceof Response` check at ~line 69, before the `rawJwt`/`authed` block):
```ts
  // Flag #1 Option A — type guard. This route's only legitimate job is the
  // closing UI's get-or-create of today's CLOSING instance. Opening/prep
  // instances are minted exclusively by service-role paths (opening RPC,
  // AM-prep loader), never here. Reject any non-closing templateId so an
  // authed employee (level 3) can't direct-POST a malformed opening/prep row.
  const svc = getServiceRoleClient();
  const { data: tmpl, error: tmplErr } = await svc
    .from("checklist_templates")
    .select("type")
    .eq("id", templateId)
    .maybeSingle<{ type: string }>();
  if (tmplErr) {
    console.error("[/api/checklist/instances POST] template type lookup failed:", tmplErr.message);
    return jsonError(500, "internal_error", { message: "template lookup failed" });
  }
  if (!tmpl) {
    return jsonError(404, "template_not_found", {
      field: "templateId",
      message: `Template ${templateId} not found`,
    });
  }
  if (tmpl.type !== "closing") {
    return jsonError(403, "template_type_forbidden", {
      field: "templateId",
      message:
        "This route only creates closing instances. Opening and prep instances are created by their own service-role flows.",
    });
  }
```

- [ ] **Step 2: Update the route docstring**

The auth block (lines 10-11) says `role_level >= 3 at INSERT time`. Append a line documenting the type guard + the Option B backstop:
```
 *   Type guard (Flag #1 Option A): rejects any non-closing templateId with
 *   403 template_type_forbidden — opening/prep are service-role-only. The
 *   checklist_instances_insert RLS is also type-aware (Option B backstop):
 *   >=4 for opening/prep, >=3 for closing.
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Manual verification (the route is orphaned — no client smoke)**

There is no client caller, so verification is by reasoning + a curl against a running dev server if convenient: POST an `opening`-type templateId as an employee-level session → expect `403 template_type_forbidden`; POST a `closing`-type templateId → expect get-or-create success. Document the result in the PR description (curl optional; the type guard is mechanically simple).

- [ ] **Step 5: Commit**

```bash
git add app/api/checklist/instances/route.ts
git commit -m "feat(roles): type-guard POST /api/checklist/instances to closing-only (Flag #1 A)"
```

---

## Task 6: UI gates + display ladders

**Files:**
- Modify: `components/ChecklistItem.tsx:212-217` (role-badge ladder), `:410` (tag affordance `actorLevel >= 3`)
- Modify: `app/(authed)/operations/closing/closing-client.tsx:283` (`canFinalize … >= 3`), `:1030` (item-data-driven — leave)
- Modify: `app/(authed)/operations/opening/page.tsx:271` (`>= 5` AGM+ loader), `:295` (`>= 7` owner)
- Modify: `app/(authed)/dashboard/page.tsx:318,349` (`>= 7` all-locations)
- Modify: `app/admin/layout.tsx` (`role_level < 6.5`)
- Modify: `app/(authed)/operations/am-prep/page.tsx:105` (reads `AM_PREP_BASE_LEVEL` — no literal, inherits Task 4)

- [ ] **Step 1: ChecklistItem badge ladder (display only — preserve which role shows which badge)**

`components/ChecklistItem.tsx:212-217` currently ladders `>=8 cgs, >=7 owner, >=6.5 moo, >=6 gm, >=5 agm, >=4 shift_lead`. Remap each boundary so the SAME role still lights the SAME badge: `>=10 cgs, >=9 owner, >=8 moo, >=7 gm, >=6 agm, >=5 shift_lead`. Add a `>=4 key_holder` rung if the ladder should now distinguish KH (optional — only if the design wants a KH badge; otherwise leave KH falling through to the employee/no-badge case as before).

- [ ] **Step 2: ChecklistItem tag affordance 3 → 4**

`:410`: `actorLevel >= 4` (was `>= 3`) — this is the KH+ tag affordance, must match `lib/checklists.ts` tag gate.

- [ ] **Step 3: closing-client canFinalize 3 → 4**

`closing-client.tsx:283`: `… && actor.level >= 4 && walkOutVerificationComplete` (was `>= 3`). Leave `:1030` (`it.minRoleLevel > actor.level`) untouched (item-data-driven).

- [ ] **Step 4: opening page loaders**

`opening/page.tsx:271` `>= 5` → `>= 6` (AGM+ loader). `:295` `>= 7` → `>= 9` (owner). Update the adjacent comments ("level >= 5 (AGM+)" → "level >= 6 (AGM+)", "Owner+CGS are level >= 7" → ">= 9").

- [ ] **Step 5: dashboard + admin layout**

`dashboard/page.tsx:318,349` `>= 7` → `>= 9`. `admin/layout.tsx` `< 6.5` → `< 8` (and its comment).

- [ ] **Step 6: Full UI sweep (catch anything the line refs missed)**

Run:
```bash
grep -rnE "(level|role_level|actorLevel)\s*(>=|<|<=|>)\s*[0-9]" app/ components/
```
Reconcile every hit via the master table. Item-data-driven comparisons (`minRoleLevel`, `min_role_level`) stay.

- [ ] **Step 7: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: both PASS (build gate matters — Suspense/prerender constraints are unrelated but the gate must stay green).

- [ ] **Step 8: Commit**

```bash
git add app/ components/
git commit -m "feat(roles): remap UI gates + badge ladders to 0-10 scale"
```

---

## Task 7: i18n role labels for the four new roles

**Files:**
- Modify: `lib/i18n/en.json`, `lib/i18n/es.json`

- [ ] **Step 1: Add `role.<code>` keys for the new roles (both files)**

Per the PR 5d tactical inline-lookup convention, every RoleCode needs `role.<code>` in both locales. Existing roles already have keys; add the four new ones. EN:
```json
"role.prospect": "Prospect",
"role.hired_not_yet_worked": "Hired (Not Yet Worked)",
"role.prep_mgr": "Prep Manager",
"role.social_media_mgr": "Social Media Manager"
```
ES (operational tú-form register; manager titles stay as common usage):
```json
"role.prospect": "Prospecto",
"role.hired_not_yet_worked": "Contratado (sin trabajar aún)",
"role.prep_mgr": "Encargado de Prep",
"role.social_media_mgr": "Encargado de Redes"
```
Place each next to the existing `role.*` block in both files; confirm Spanish wording with Juan if uncertain.

- [ ] **Step 2: Verify key parity**

Run:
```bash
node -e "const e=require('./lib/i18n/en.json'),s=require('./lib/i18n/es.json');const ek=Object.keys(e).filter(k=>k.startsWith('role.')),sk=Object.keys(s).filter(k=>k.startsWith('role.'));console.log('missing in es:',ek.filter(k=>!(k in s)));console.log('missing in en:',sk.filter(k=>!(k in e)));"
```
Expected: both arrays empty.

- [ ] **Step 3: Commit**

```bash
git add lib/i18n/en.json lib/i18n/es.json
git commit -m "feat(roles): add i18n labels for prospect/hired/prep_mgr/social_media_mgr"
```

---

## Task 8: The migration (single transaction) + text capture

**Files:**
- Apply via Supabase MCP `apply_migration`, name `0058_role_model_renumber`
- Create: `supabase/migrations/0058_role_model_renumber.sql` (text capture)

This migration does five things atomically: (a) extend `users.role` CHECK with the 4 new codes; (b) rewrite `current_user_role_level()` CASE; (c) remap every RLS threshold per the master table; (d) rewrite `checklist_instances_insert` to be **type-aware** (Flag #1 Option B backstop); (e) emit one migration audit row under the new `role_model.renumber` action. **One transaction** — Supabase `apply_migration` wraps the statement set; verify it's a single call. Step 0 (a lib-code edit, separate commit) registers the `role_model.renumber` action *before* the migration references it.

- [ ] **Step 0: Register the `role_model.renumber` destructive action (lib edit, ships in this PR before the migration)**

GATE ANSWERS Q3 RESOLVED to add a canonical action (a once-ever, system-wide authority change earns its own searchable audit code; reusing an existing action would misrepresent the forensic trail — same honest-trail principle as `quick_reenter`-not-`error_tap`). Add to `lib/destructive-actions.ts` `DESTRUCTIVE_ACTIONS` (place it near the config/system block, after `system.config_update`):
```ts
  // One-time role-model renumber (C.41 employee/key_holder collision fix).
  // — destructive because it rewrites the authority level of every role
  // system-wide. Emitted once, from migration 0058's audit row (SQL-side
  // INSERT sets destructive=true directly per the 0045 migration-audit
  // convention; this registration is for app-layer forensics + isDestructive()).
  "role_model.renumber",
```
Then commit:
```bash
git add lib/destructive-actions.ts
git commit -m "feat(roles): register role_model.renumber destructive action"
```

- [ ] **Step 1: Extend the users.role CHECK**

```sql
ALTER TABLE public.users DROP CONSTRAINT users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (
  role = ANY (ARRAY[
    'cgs','owner','moo','gm','agm','catering_mgr','prep_mgr','social_media_mgr',
    'shift_lead','key_holder','trainer','employee','trainee',
    'hired_not_yet_worked','prospect'
  ]::text[])
);
```

- [ ] **Step 2: Rewrite current_user_role_level() (mirror the lib registry exactly)**

```sql
CREATE OR REPLACE FUNCTION public.current_user_role_level()
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT CASE role
    WHEN 'cgs' THEN 10
    WHEN 'owner' THEN 9
    WHEN 'moo' THEN 8
    WHEN 'gm' THEN 7
    WHEN 'agm' THEN 6
    WHEN 'catering_mgr' THEN 6
    WHEN 'prep_mgr' THEN 6
    WHEN 'social_media_mgr' THEN 6
    WHEN 'shift_lead' THEN 5
    WHEN 'key_holder' THEN 4
    WHEN 'trainer' THEN 4
    WHEN 'employee' THEN 3
    WHEN 'trainee' THEN 2
    WHEN 'hired_not_yet_worked' THEN 1
    WHEN 'prospect' THEN 0
    ELSE 0
  END FROM public.users WHERE id = public.current_user_id()
$function$;
```
NOTE: `ELSE 0` and `prospect = 0` now collide. That is intentional and harmless — both mean "no operational access"; no gate distinguishes 0-from-unknown. (If a future requirement needs to tell them apart, that's a separate change.)

- [ ] **Step 3: Remap the KH+ RLS policies (3 → 4) — full SQL, correctness-critical**

These four tables' policies are the KH+ split; reproduce each existing expression with the literal swapped 3→4. Fetch current definitions first to copy the non-numeric parts exactly:
```sql
SELECT policyname, tablename, cmd, qual, with_check FROM pg_policies
WHERE tablename IN ('opening_setup_items','opening_setup_verifications',
  'opening_closer_count_snapshots','opening_section_verifications');
```
Then ALTER each (the simple ones are pure `>=3`):
```sql
ALTER POLICY ocs_read ON public.opening_closer_count_snapshots
  USING (current_user_role_level() >= 4);
ALTER POLICY osv_read ON public.opening_section_verifications
  USING (current_user_role_level() >= 4);
ALTER POLICY opening_setup_items_delete_policy ON public.opening_setup_items
  USING (current_user_role_level() >= 4);
ALTER POLICY opening_setup_items_insert_policy ON public.opening_setup_items
  WITH CHECK (current_user_role_level() >= 4);
ALTER POLICY opening_setup_items_update_policy ON public.opening_setup_items
  USING (current_user_role_level() >= 4);
-- opening_setup_verifications_insert combines the level with an instance/location EXISTS;
-- reproduce the fetched with_check verbatim, changing only 3 -> 4:
ALTER POLICY opening_setup_verifications_insert_policy ON public.opening_setup_verifications
  WITH CHECK (
    (current_user_role_level() >= 4) AND (EXISTS (
      SELECT 1 FROM checklist_instances ci
      WHERE ci.id = opening_setup_verifications.opening_instance_id
        AND ci.location_id IN (
          SELECT user_locations.location_id FROM user_locations
          WHERE user_locations.user_id = current_user_id())))
  );
```

- [ ] **Step 4a: Rewrite `checklist_instances_insert` to be type-aware (Flag #1 Option B backstop)**

This is the DB-layer half of A+B. The current policy is a flat `WITH CHECK (current_user_role_level() >= 3 AND location_id IN (...))`. Rewrite so the level requirement depends on the target template's `type`: `>=4` for `opening`/`prep`, `>=3` for `closing`. Fetch the current expression first to reproduce the `location_id IN (...)` half verbatim:
```sql
SELECT policyname, cmd, qual, with_check FROM pg_policies
WHERE tablename = 'checklist_instances' AND policyname = 'checklist_instances_insert';
```
Then ALTER, changing ONLY the level half (reproduce the fetched `location_id IN (...)` predicate exactly):
```sql
ALTER POLICY checklist_instances_insert ON public.checklist_instances
  WITH CHECK (
    (
      CASE
        WHEN (SELECT t.type FROM checklist_templates t WHERE t.id = checklist_instances.template_id)
             IN ('opening','prep')
        THEN current_user_role_level() >= 4
        ELSE current_user_role_level() >= 3   -- closing (and any other non-opening/prep type)
      END
    )
    AND location_id IN (
      SELECT user_locations.location_id FROM user_locations
      WHERE user_locations.user_id = current_user_id()
    )
  );
```
NOTE: the `ELSE` arm keeps the route's legitimate closing get-or-create working at any-staff `>=3` (employee+). The subquery on `checklist_templates` is the type lookup; it runs under the policy-owner's privileges. Verify the fetched `location_id IN (...)` predicate matches what's reproduced above before applying — if the live policy's location predicate differs, reproduce the LIVE one, changing only the level half.

- [ ] **Step 4b: Leave the genuinely any-staff `>=3` policies UNTOUCHED**

Do NOT alter: `checklist_instances_update` (UPDATE side — no change per Flag #1 ruling; only authed update path is `confirmInstance`, lib-gated by `checklist.confirm`→4), `checklist_completions_insert`, `customer_feedback_*`, `deep_clean_tasks_read`, `locations_read`, `positions_read`, `position_responsibilities_read`, `recipes_read`, `recipe_ingredients_read`, `recipe_steps_read`, `vendors_read`, `vendor_items_read`, `training_modules_read`, `report_photos_read/insert`, `shift_overlays_insert`, `training_reports_insert/update`, `vendor_deliveries_insert/update`, `written_reports_insert`. They keep `>=3` (employee+). (`checklist_instances_insert` is NO LONGER in this list — it's rewritten type-aware in Step 4a.)

- [ ] **Step 5: Remap the higher-threshold RLS policies (mechanical +shift)**

Apply the master table to every remaining policy. Fetch-then-ALTER, changing ONLY the numeric literal, reproducing the rest of each expression verbatim. The complete enumerated mapping (run the `pg_policies` fetch per group to get the exact current expression):

**`>=4` → `>=5`:** `maintenance_tickets_insert`, `maintenance_tickets_update`, `shift_overlay_corrections_insert`.

**`>=5` → `>=6`:** `announcement_acks_read`, `announcements_insert`, `announcements_update`, `catering_customers_insert`, `catering_customers_update`, `catering_orders_insert`, `catering_orders_update`, `catering_pipeline_insert`, `catering_pipeline_update`, `deep_clean_assignments_insert`, `deep_clean_assignments_update`, `report_assignments_insert`, `training_progress_insert`, `training_progress_read`, `training_progress_update`, `vendor_items_insert`, `vendor_items_update`, `vendor_price_history_read`.

**`>=6` → `>=7`:** `checklist_template_items_insert`, `checklist_template_items_update`, `checklist_templates_insert`, `checklist_templates_update`, `deep_clean_tasks_insert`, `deep_clean_tasks_update`, `lto_performance_insert`, `lto_performance_update`, `par_levels_insert`, `par_levels_update`, `recipe_ingredients_insert`, `recipe_ingredients_update`, `recipe_steps_insert`, `recipe_steps_update`, `recipes_insert`, `recipes_update`, `report_assignments_read_admin`, `tip_pool_distributions_insert`, `tip_pool_distributions_update`, `tip_pools_insert`, `tip_pools_update`, `user_locations_read`, `users_read_self`, `vendor_orders_insert`, `vendor_orders_update`, `vendors_insert`.

**`>=6.5` → `>=8`:** `locations_insert`, `locations_update`, `position_responsibilities_insert`, `position_responsibilities_update`, `positions_insert`, `positions_update`, `training_modules_insert`, `training_modules_update`, `user_locations_insert`, `user_locations_update`, `users_insert_admin`, `users_update_admin`.

**`>=7` → `>=9`** (these are the all-locations override clauses inside larger `_read` quals — change only the `current_user_role_level() >= 7` literal, leave the `location_id = ANY(...)` half intact): `announcements_read`, `audit_read`, `catering_customers_read`, `catering_orders_read`, `catering_pipeline_read`, `checklist_completions_read`, `checklist_incomplete_reasons_read`, `checklist_instances_read`, `checklist_submissions_read`, `checklist_template_items_read`, `checklist_templates_read`, `customer_feedback_read`, `deep_clean_assignments_read`, `lto_performance_read`, `maintenance_tickets_read`, `notification_recipients_read`, `notifications_read`, `par_levels_read`, `prep_list_resolutions_read`, `report_assignments_insert` (the inner `>=7` branch), `report_assignments_read_admin` (inner `>=7` branch), `report_views_read`, `shift_overlay_corrections_read`, `shift_overlays_read`, `shifts_daily_data_read`, `tip_pool_distributions_read`, `tip_pools_read`, `toast_daily_data_read`, `training_reports_read`, `user_notification_prefs_read`, `vendor_deliveries_read`, `vendor_orders_read`, `weekly_rollups_read`, `written_reports_read`.

**`>=8` → `>=10`:** `sms_queue_read`.

NOTE on data-driven quals: `announcements_read` (`target_min/max_role_level`) and `written_reports_read` (`visibility_min_level`) compare `current_user_role_level()` against a STORED column, not a literal — but those tables are empty (verified) and the comparison operator itself needs no change. Only change the literal `>= 7` all-locations override inside those quals.

- [ ] **Step 6: Emit the migration audit row (per the 0045 migration-audit convention)**

```sql
INSERT INTO audit_log (actor_id, actor_role, action, resource_table, resource_id,
  before_state, after_state, metadata, destructive)
VALUES (
  '<JUAN_USER_ID>', 'cgs', 'role_model.renumber', -- registered in Step 0
  'users', NULL,
  jsonb_build_object('scale','pre-renumber: employee=key_holder=3'),
  jsonb_build_object('scale','0-10: employee=3, key_holder=4, +4 new roles'),
  jsonb_build_object(
    'actor_context','migration_apply',
    'migration','0058_role_model_renumber',
    'phase','3_role_model_reconciliation',
    'reason','C.41 employee/key_holder level collision fix — full 0-10 renumber',
    'new_roles', jsonb_build_array('prospect','hired_not_yet_worked','prep_mgr','social_media_mgr'),
    'rls_policies_remapped', true,
    'ip_address', null, 'user_agent', null,
    'durable_lesson_captured_in','AGENTS.md'),
  false
);
```
Action-code note: `role_model.renumber` is registered in Step 0 (RESOLVED per GATE ANSWERS Q3). The SQL-side INSERT sets `destructive=false` here only because a renumber is an authority-model reconfiguration, not a destruction of a specific record — but note the action IS on the destructive registry for step-up/forensics; the migration-apply path has no interactive step-up, so the column is set explicitly (per the 0045 convention, SQL-side INSERTs set `destructive` directly rather than relying on `isDestructive()`). If Juan prefers `destructive=true` on this row for consistency with the registry membership, flip it — surface the choice at apply time. Replace `<JUAN_USER_ID>` with the real id (`SELECT id FROM users WHERE role='cgs' AND email='juan@complimentsonlysubs.com'`).

- [ ] **Step 7: Verify the function output post-migration**

```sql
SELECT role, public_case.level FROM (VALUES
  ('cgs',10),('owner',9),('moo',8),('gm',7),('agm',6),('catering_mgr',6),
  ('prep_mgr',6),('social_media_mgr',6),('shift_lead',5),('key_holder',4),
  ('trainer',4),('employee',3),('trainee',2),('hired_not_yet_worked',1),('prospect',0)
) AS public_case(role,level)
ORDER BY level DESC;
```
Cross-check this expected table against the live CASE by temporarily selecting the CASE expression (as in Task 0 Step 3 but with new numbers). They must match the registry in `lib/roles.ts`.

- [ ] **Step 8: Capture the migration text in-repo**

Create `supabase/migrations/0058_role_model_renumber.sql` with the going-forward header:
```sql
-- Migration 0058_role_model_renumber
-- Applied via Supabase MCP apply_migration on 2026-06-03.
-- Canonical reference: lib/roles.ts ROLES registry (must stay in lockstep with this CASE);
--   AGENTS.md "Role-level gate audits must include UI-side gates" + this plan.
```
followed by a blank line and the full SQL applied in Steps 1-6.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/0058_role_model_renumber.sql
git commit -m "feat(roles): migration 0058 — renumber DB CASE + CHECK + RLS thresholds to 0-10 scale"
```

---

## Task 9: Cutover — revoke active sessions

**Files:**
- Create: `scripts/role-renumber-revoke-sessions.ts`

`role_level` is baked into the session JWT at login (`lib/session.ts:184,318` via `getRoleLevel`). Every currently-logged-in user carries a stale (pre-renumber) level until token exp (12h) or re-login. The cutover revokes all active sessions so the next request re-derives the new level. This runs ONCE, at deploy time, AFTER the migration + lib are both live.

- [ ] **Step 1: Write the revoke-all-active-sessions script**

```ts
import { getServiceRoleClient } from "@/lib/supabase-server";

async function main() {
  const svc = getServiceRoleClient();
  const { data, error } = await svc
    .from("sessions")
    .update({ revoked_at: new Date().toISOString() })
    .is("revoked_at", null)
    .select("id");
  if (error) throw error;
  console.log(`Revoked ${data?.length ?? 0} active session(s) for role renumber cutover.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Document the deploy ordering in the PR description**

Hard ordering, stated explicitly so no one half-deploys:
1. Apply migration 0058 (DB CASE + CHECK + RLS now on new scale).
2. Deploy the lib/UI changes (Vercel) — NEW logins now get new levels.
3. Run `scripts/role-renumber-revoke-sessions.ts` — existing stale sessions killed.
   Do NOT run step 3 before step 1, and do NOT leave step 1 live without step 2 (split-brain: DB says employee<KH but lib JWT still says employee=KH for old sessions until they re-auth — which is exactly why step 3 exists).

- [ ] **Step 3: Commit**

```bash
git add scripts/role-renumber-revoke-sessions.ts
git commit -m "chore(roles): add session-revocation cutover script for renumber deploy"
```

---

## Task 10: Verification (the gate before "done")

**Files:** none (verification only)

- [ ] **Step 1: Re-run the level probe + KH+ gate matrix (AFTER snapshot — the root-fix proof)**

Re-run the Task 0 Step 3 SQL with the new CASE numbers and confirm every role matches `lib/roles.ts`. Paste the AFTER table into the PR description next to BEFORE. Then re-run the Task 0 Step 3a gate matrix against the SAME two probe users, now reading the POST-migration level (employee=3, key_holder=4). The diff is the proof the root was fixed:
- **employee**: all four KH+ gates flip `before_pass: true` → `after_pass: false` (3 ≥ 3 was true; 3 ≥ 4 is false).
- **key_holder**: all four stay `true` (was 3 ≥ 3; now 4 ≥ 4).

If the employee row does NOT flip to all-false, the renumber did not actually fix the collision — STOP and investigate before claiming done.

- [ ] **Step 2: Prove the revoke fix falls out for free (the whole point)**

Confirm by inspection that NO opening-specific code changed for revoke: `app/api/opening/prep/item/revoke/route.ts` still forwards `ctx.level` unmodified (line ~144); `lib/opening.ts` `isKHPlus = actor.level >= OPENING_BASE_LEVEL` now reads `>= 4`. So: employee (level 3) revoking another's row → `isKHPlus=false`, not self → `else throw not_self`. key_holder (4) → still passes. Document this trace in the PR.

- [ ] **Step 3: Live RLS spot-check with a real employee + key_holder**

Using the two probe users from Task 0, run a SET-LOCAL-role-style or service-role-simulated check (or, simplest, a direct check that `current_user_role_level()` returns 3 for the employee user and 4 for the key_holder user):
```sql
SELECT u.role,
  (SELECT CASE u.role WHEN 'employee' THEN 3 WHEN 'key_holder' THEN 4 ELSE -1 END) AS expected
FROM users u WHERE u.id IN ('<EMPLOYEE_ID>','<KEY_HOLDER_ID>');
```
Then confirm the KH+ opening policies now reject employee: a service-role read of `opening_closer_count_snapshots` simulating the employee's level must show the gate is `>=4`.

- [ ] **Step 4: tsc + build + i18n parity**

Run: `npx tsc --noEmit && npm run build`
Run the Task 7 Step 2 i18n parity check again.
Expected: all PASS, parity arrays empty.

- [ ] **Step 5: Smoke checklist (post-deploy, against the PR preview URL — NOT production)**

Use the PR's Vercel preview URL (`co-ops-git-<branch-slug>-juan-co-devs-projects.vercel.app`). Verify with Juan:
- An `employee`-role user CANNOT see/use the opening Phase 2 revoke/verify affordances, CANNOT finalize closing, CANNOT access AM prep without an assignment — BUT can still complete regular checklist items, read recipes/vendors/locations, acknowledge announcements.
- A `key_holder`-role user CAN do all the KH+ actions (revoke, finalize, AM-prep base access).
- Managers (gm/moo/owner/cgs) retain their existing access (badge ladder + admin still gated correctly).
- This is the **architectural-finder** step (per AGENTS.md): treat any "feels off" report as a possible design gap, not just a bug.

- [ ] **Step 6: Final gate**

Do NOT claim complete until Steps 1-5 all show fresh PASS evidence. Then update AGENTS.md with a Phase 3 durable-knowledge entry summarizing the renumber (master remap table, the per-item-`min_role_level`-stays-3 finding, the empty-data-columns finding, the cutover ordering) and the HELD items below.

---

## Still HELD until this lands (do NOT fold in)

- **Problem 1c** — thread `actorLevel` + current-user-id into `OpeningPrepEntry` and gate the Undo button render. After the renumber, this gates on the now-correct `isKHPlus`.
- **Problem 2** — provenance display (walk revoked rows to show prior author).
- **Two-live-rows** — confirm benign vs supersede bug.
- **Commit B** — merges only after the role model is correct.

---

## Self-review notes (author)

- **Spec coverage:** every one of the user's five surfaced asks maps to a task — full threshold remap (master table + Tasks 3-8), per-item `min_role_level` sub-audit (resolved: stays 3, Ground Truth + Task 5/8 Step 4), role enum/CHECK changes (Tasks 2 + 8 Step 1), atomic migration + lib lockstep + session revocation (Tasks 8-9), revoke-falls-out-free proof (Task 10 Step 2).
- **Two open human gates** (new role codes; `checklist.confirm` tier) are isolated in Task 1 and block downstream tasks — not placeholders, explicit decisions.
- **Type consistency:** `OPENING_BASE_LEVEL`/`AM_PREP_BASE_LEVEL`/`ASSIGNMENT_BASE_LEVEL` all → 4; `ALL_LOCATIONS_THRESHOLD` + report-assignments all-locations → 9; registry levels in Task 2 exactly match the DB CASE in Task 8 Step 2 and the probe's `EXPECTED_AFTER` in Task 0.
- **Flag #1 = A+B (RESOLVED):** route hardening (Task 5a — type guard on `POST /api/checklist/instances`) AND type-aware RLS backstop (Task 8 Step 4a — `checklist_instances_insert` requires `>=4` for opening/prep, `>=3` for closing). Both ship; no deliberate single-layer gap on the opening-instance surface.
- **Action-code (RESOLVED):** `role_model.renumber` is registered in `lib/destructive-actions.ts` (Task 8 Step 0) and used by the migration audit row (Step 6) — per GATE ANSWERS Q3.
- **Root-fix proof:** Task 0 Step 3a captures the employee + key_holder KH+-gate pass/fail matrix BEFORE; Task 10 Step 1 re-runs it AFTER. The employee pass→fail flip across all four gates (revoke/finalize/AM-prep/tag) is the evidence we fixed the collision, not just moved numbers.
