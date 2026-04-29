# Phase 1 RLS Audit Report

**Date:** 2026-04-29
**Branch:** `claude/hopeful-montalcini-fb7dde`
**Schema state:** 30 migrations applied (15 schema + 10 RLS + 2 helper-correction + 3 seed). Migration history is authoritative via Supabase MCP `list_migrations` against project `bgcvurheqzylyfehqgzh` (us-east-1, Postgres 17.6.1.111).
**Tables with RLS:** 53 / 53 (`relrowsecurity = true` confirmed end of Session A; unchanged in Session B).
**Auditor:** Claude Code (Phase 1 Session B).
**Sign-off pending:** Juan.

---

## Audit purpose & methodology

The audit is the security gate before Phase 2 (auth) opens. The schema and RLS were applied in Session A; this session proves with evidence that the policies do what they say they do — every documented allow path admits, every documented deny path rejects, under realistic role × location × time-window contexts.

**Harness pattern.** The Supabase MCP `execute_sql` tool runs as `service_role`, which bypasses RLS entirely. To actually exercise RLS, every test SQL switches to the `authenticated` role inside a transaction and sets the JWT claim per-test, then rolls back. Pseudocode:

```sql
BEGIN;
  -- service-role setup (seed test rows)
SET LOCAL ROLE authenticated;
PERFORM set_config('request.jwt.claim.user_id', '<uuid>', true);
  -- attempt operation, capture pass/fail
ROLLBACK;
```

Per-test results are accumulated into a `TEMP TABLE`. The temp table is created as `service_role` (the default MCP context), so we explicitly `GRANT ALL ... TO authenticated` before switching roles — without this, authenticated-context tests can't write their results back, even though the RLS test itself would still execute correctly. This footgun is captured in AGENTS.md. The final `SELECT` returns the result table; `ROLLBACK` ensures **zero artifacts persist**.

**Outcomes by mechanism:**

- INSERT denial → exception sqlstate **42501** "new row violates row-level security policy for table X" (raises out of the SQL block).
- UPDATE / DELETE denial → **0 rows affected, no exception** (the USING predicate filters out all rows). This silent-denial behavior is captured in AGENTS.md as a Phase 4+ acceptance criterion across all UPDATE routes.
- SELECT denial → **0 rows returned, no exception** (USING filters out).

---

## Test fixtures

Migration `0030_seed_audit_fixtures` seeded 9 users, one per role, plus `user_locations` rows per the matrix below. Emails use the RFC 2606 reserved `.invalid` TLD. `pin_hash` is the same placeholder bcrypt as Juan's seed (`crypt('seed_placeholder', gen_salt('bf', 12))`). `email_verified=true` and `active=true` for all fixtures so audit tests focus on RLS, not lifecycle gates. After audit completes, migration `0031_audit_fixtures_deactivate` flips `active=false`. RLS forbids delete; they remain as permanent inactive fixtures.

| Email | Role | Level | Locations |
|---|---|---|---|
| `audit_test_cgs@audit.invalid`      | `cgs`           | 8   | MEP + EM |
| `audit_test_owner@audit.invalid`    | `owner`         | 7   | MEP + EM |
| `audit_test_moo@audit.invalid`      | `moo`           | 6.5 | MEP + EM |
| `audit_test_gm@audit.invalid`       | `gm`            | 6   | MEP only |
| `audit_test_agm@audit.invalid`      | `agm`           | 5   | MEP only |
| `audit_test_catering@audit.invalid` | `catering_mgr`  | 5   | MEP + EM |
| `audit_test_sl@audit.invalid`       | `shift_lead`    | 4   | MEP only |
| `audit_test_kh@audit.invalid`       | `key_holder`    | 3   | MEP only |
| `audit_test_trainer@audit.invalid`  | `trainer`       | 3   | MEP only |

Locations: `MEP` (`54ce1029-400e-4a92-9c2b-0ccb3b031f0a`) — Capitol Hill; `EM` (`d2cced11-b167-49fa-bab6-86ec9bf4ff09`) — P Street.

---

## Issues found

### Issue #1 — RLS helper recursion under no-claim conditions (BLOCKER, RESOLVED)

**Discovered:** Step 0 Test 0.2 (anonymous SELECT on `users` crashed with `stack depth limit exceeded` instead of returning 0 rows).

**Root cause.** The three RLS helper functions (`current_user_id`, `current_user_role_level`, `current_user_locations`) were `SECURITY INVOKER` (Postgres default). Their internal `SELECT … FROM users` / `FROM user_locations` was therefore subject to RLS in the caller's context. The `users_read_self` policy's admin branch is `current_user_role_level() >= 6` — so when the self-predicate (`id = current_user_id()`) failed for a row (e.g., under no claim, or any cross-row admin read), the admin branch fired and called back into the helper, which re-evaluated the policy, which called the helper, etc. The bug stayed latent with the single-user seed because Juan's-own-row reads short-circuited on the self-predicate; it would have exploded the moment audit fixtures (9 cross-row users) seeded.

**Resolution.** Two migrations applied with sign-off:

- **`0029_helpers_security_definer`** — re-defines all three helpers as `SECURITY DEFINER` (function body runs as owner `postgres`, bypassing RLS), with `SET search_path = pg_catalog, public` to block schema-shadowing, plus `REVOKE EXECUTE FROM PUBLIC` and explicit `GRANT EXECUTE TO authenticated, service_role`.
- **`0029_helpers_revoke_anon`** — defense-in-depth follow-up after discovering Supabase's default schema ACLs explicitly grant EXECUTE on public functions to `anon` (independent of the PUBLIC pseudo-role); `REVOKE FROM PUBLIC` does not strip that. Anon now fails loudly with insufficient privilege if mis-routed code invokes a helper.

**Re-verification.** Step 0 re-run after migration: Test 0.2 returns 0 rows cleanly, no crash. Tests 0.1 / 0.3 still pass. Bonus check: under `authenticated` with no claim, helpers return `current_user_id() = NULL`, `current_user_role_level() = NULL`, `current_user_locations() = []` — the clean denial path (NULL ≥ N is NULL, treated as false in policies).

**Durable knowledge:** captured in AGENTS.md alongside the FOR ALL leak entry. Two related entries also added — UPDATE 0-rows silent denial pattern, and Postgres role-switch + temp-table accessibility footgun. Commit `f846419`.

**No other issues found.**

---

## Step 0 — Harness sanity checks

Mandatory before any test cases run. All four results post-fix.

| # | Test | Expected | Actual | Pass/Fail |
|---|---|---|---|---|
| 0.1 | Authenticated SELECT users with Juan's claim | 1 row (Juan) | 1 row (`juan@complimentsonlysubs.com`) | ✓ |
| 0.2 | Authenticated SELECT users with **no** claim | 0 rows, no crash | 0 rows, no crash | ✓ |
| 0.3a | Service-role baseline SELECT users | 10 (Juan + 9 fixtures) | 10 | ✓ |
| 0.3b | Authenticated SELECT users as audit_test_sl | 1 (own row only via `users_read_self`) | 1 (`audit_test_sl`) | ✓ |
| 0.3c | Authenticated SELECT users as audit_test_cgs | 10 (admin branch fires for level 8) | 10 | ✓ |
| 0.3d | Authenticated SELECT users as audit_test_kh | 1 (own row only) | 1 (`audit_test_kh`) | ✓ |

Test 0.3 cross-check is decisive: service-role returns 10, level-8 admin returns 10, level-3 fixtures return 1 each. The harness is engaging RLS correctly, and the SECURITY DEFINER fix is verified end-to-end (admin-branch reads no longer recurse).

---

## Tier 1 — Must pass (blocker for Phase 2 if any fails)

**6 tests, 27 cases. All pass.**

### Test 1 — `checklist_completions_insert` 3-condition WITH CHECK (8/8 ✓)

The most complex policy in the schema. Three independent boolean axes: `completed_by = current_user_id()` (self vs other), `template_item.min_role_level <= current_user_role_level()` (qualifying vs not), `instance.status = 'open'` (open vs confirmed). All 8 combinations exercised under audit_test_kh (level 3).

| # | completed_by | min_role | status | Expected | Actual | Pass |
|---|---|---|---|---|---|---|
| 1 | self (kh)  | low (3)  | open      | ALLOW | ALLOW | ✓ |
| 2 | self (kh)  | low (3)  | confirmed | DENY  | DENY  | ✓ |
| 3 | self (kh)  | high (5) | open      | DENY  | DENY  | ✓ |
| 4 | self (kh)  | high (5) | confirmed | DENY  | DENY  | ✓ |
| 5 | other (sl) | low (3)  | open      | DENY  | DENY  | ✓ |
| 6 | other (sl) | low (3)  | confirmed | DENY  | DENY  | ✓ |
| 7 | other (sl) | high (5) | open      | DENY  | DENY  | ✓ |
| 8 | other (sl) | high (5) | confirmed | DENY  | DENY  | ✓ |

Only the all-true combination is admitted; every other combination is denied with `new row violates row-level security policy for table "checklist_completions"`.

### Test 2 — `users_update_self` / `users_update_admin` OR-stack (5/5 ✓)

| # | Scenario | Expected | Actual | Pass |
|---|---|---|---|---|
| 1 | SL (lvl 4) updates own phone (self path)              | ALLOW | ALLOW | ✓ |
| 2 | SL updates KH phone (no admin, no self)               | DENY  | DENY  | ✓ |
| 3 | KH (lvl 3) updates own phone (self path)              | ALLOW | ALLOW | ✓ |
| 4 | MoO (lvl 6.5) updates KH phone (admin path)           | ALLOW | ALLOW | ✓ |
| 5 | GM (lvl 6) updates KH phone (lvl 6 < 6.5; no self)    | DENY  | DENY  | ✓ |

The 6.5 admin threshold cleanly excludes GM (6) and admits MoO (6.5). Per AGENTS.md, the strict-greater `canActOn` check (peer/senior protection) is app-layer only — RLS gates "can this user touch the table at all"; the admin route enforces "can this admin act on this specific target." Confirmed.

### Test 3 — `tip_pool_distributions_*` EXISTS subqueries (5/5 ✓)

| # | Scenario | Expected | Actual | Pass |
|---|---|---|---|---|
| 1 | GM (MEP only) → MEP tip pool             | ALLOW | ALLOW | ✓ |
| 2 | GM (MEP only) → EM tip pool              | DENY  | DENY  | ✓ |
| 3 | Owner (MEP+EM, lvl 7) → EM tip pool      | ALLOW | ALLOW | ✓ |
| 4 | KH (lvl 3) → MEP tip pool                | DENY  | DENY  | ✓ |
| 5 | AGM (lvl 5) → MEP tip pool               | DENY  | DENY  | ✓ |

The explicit `tip_pool_distributions.tip_pool_id` qualifier in the EXISTS subquery (the Session A correction) resolves cleanly. Both branches of the AND (level + parent location membership) are individually enforced.

### Test 4 — `training_progress` self-signoff prevention (5/5 ✓)

| # | Scenario | Expected | Actual | Pass |
|---|---|---|---|---|
| 1 | AGM INSERT signed_off_by = self           | DENY  | DENY  | ✓ |
| 2 | AGM INSERT signed_off_by = other          | ALLOW | ALLOW | ✓ |
| 3 | AGM INSERT signed_off_by = NULL           | ALLOW | ALLOW | ✓ |
| 4 | AGM UPDATE signed_off_by = self           | DENY  | DENY  | ✓ |
| 5 | AGM UPDATE signed_off_by = other          | ALLOW | ALLOW | ✓ |

WITH CHECK enforces `signed_off_by IS NULL OR signed_off_by != current_user_id()` at both INSERT and UPDATE. Per AGENTS.md, this is the exception where row-shaped column constraint correctly lives in RLS rather than app-layer.

### Test 5 — `announcements_update` author-scoped 3-hour window (2/2 ✓)

| # | Scenario | Expected | Actual | Pass |
|---|---|---|---|---|
| 1 | AGM edits own announcement at posted 1h ago    | ALLOW | ALLOW | ✓ |
| 2 | AGM edits own announcement at posted 4h ago    | DENY  | DENY  | ✓ |

Backdating `posted_at` via service-role pushed the row out of `posted_at > now() - interval '3 hours'`; UPDATE filtered.

### Test 6 — `shift_overlays_update_self` 3-hour window (2/2 ✓)

| # | Scenario | Expected | Actual | Pass |
|---|---|---|---|---|
| 1 | AGM edits own overlay submitted 1h ago         | ALLOW | ALLOW | ✓ |
| 2 | AGM edits own overlay submitted 4h ago         | DENY  | DENY  | ✓ |

---

## Tier 2 — Should pass

**5 tests, 55 cases. All pass.**

### Test 7 — Cross-location reads denied (5/5 ✓)

audit_test_sl (MEP only). Service-role seeded one row per location across 5 tables. SL reads see only MEP rows.

| # | Table | EM seeded → SL sees | MEP seeded → SL sees | Pass |
|---|---|---|---|---|
| 1 | `shift_overlays`      | 0 | 1 | ✓ |
| 2 | `vendor_deliveries`   | 0 | 1 | ✓ |
| 3 | `catering_orders`     | 0 | 1 | ✓ |
| 4 | `maintenance_tickets` | 0 | 1 | ✓ |
| 5 | `toast_daily_data`    | 0 | 1 | ✓ |

### Test 8 — Service-role-only tables deny user writes (30/30 ✓)

audit_test_kh (level 3) attempts INSERT, UPDATE, DELETE on each of 10 service-role-only tables.

| Table | INSERT | UPDATE | DELETE |
|---|---|---|---|
| `sessions`              | DENY ✓ (42501) | DENY ✓ (0 rows) | DENY ✓ (0 rows) |
| `email_verifications`   | DENY ✓ (42501) | DENY ✓ (0 rows) | DENY ✓ (0 rows) |
| `password_resets`       | DENY ✓ (42501) | DENY ✓ (0 rows) | DENY ✓ (0 rows) |
| `audit_log`             | DENY ✓ (42501) | DENY ✓ (0 rows) | DENY ✓ (0 rows) |
| `notifications`         | DENY ✓ (42501) | DENY ✓ (0 rows) | DENY ✓ (0 rows) |
| `sms_queue`             | DENY ✓ (42501) | DENY ✓ (0 rows) | DENY ✓ (0 rows) |
| `vendor_price_history`  | DENY ✓ (42501) | DENY ✓ (0 rows) | DENY ✓ (0 rows) |
| `weekly_rollups`        | DENY ✓ (42501) | DENY ✓ (0 rows) | DENY ✓ (0 rows) |
| `toast_daily_data`      | DENY ✓ (42501) | DENY ✓ (0 rows) | DENY ✓ (0 rows) |
| `shifts_daily_data`     | DENY ✓ (42501) | DENY ✓ (0 rows) | DENY ✓ (0 rows) |

Every INSERT raises `new row violates row-level security policy for table "<name>"`; every UPDATE / DELETE returns 0 rows affected. The mechanic difference matters at the API layer (see boundary section below).

### Test 9 — `_no_user_delete USING (false)` even for CGS (8/8 ✓)

Highest-role user (CGS, level 8) attempts DELETE; all rejected. `USING(false)` is universal, role-agnostic.

| # | Table | Expected | Actual | Pass |
|---|---|---|---|---|
| 1 | `users`               | DENY | DENY | ✓ |
| 2 | `vendors`             | DENY | DENY | ✓ |
| 3 | `vendor_items`        | DENY | DENY | ✓ |
| 4 | `par_levels`          | DENY | DENY | ✓ |
| 5 | `checklist_templates` | DENY | DENY | ✓ |
| 6 | `checklist_instances` | DENY | DENY | ✓ |
| 7 | `shift_overlays`      | DENY | DENY | ✓ |
| 8 | `tip_pools`           | DENY | DENY | ✓ |

### Test 10 — `notifications_read` EXISTS join (3/3 ✓)

Service-role seeded 1 notification + 1 `notification_recipients` row pointing at SL.

| # | Reader | Expected visible | Actual | Pass |
|---|---|---|---|---|
| 1 | SL (recipient)              | 1 | 1 | ✓ |
| 2 | KH (non-recipient)          | 0 | 0 | ✓ |
| 3 | Owner (lvl 7 admin override) | 1 | 1 | ✓ |

### Test 11 — Tightened reads (`vendor_price_history` AGM+; `sms_queue` CGS-only) (9/9 ✓)

| # | Table | Reader | Level | Expected | Actual | Pass |
|---|---|---|---|---|---|---|
| 1 | `vendor_price_history` | KH    | 3   | 0 | 0 | ✓ |
| 2 | `vendor_price_history` | SL    | 4   | 0 | 0 | ✓ |
| 3 | `vendor_price_history` | AGM   | 5   | 1 | 1 | ✓ |
| 4 | `vendor_price_history` | GM    | 6   | 1 | 1 | ✓ |
| 5 | `sms_queue`            | KH    | 3   | 0 | 0 | ✓ |
| 6 | `sms_queue`            | AGM   | 5   | 0 | 0 | ✓ |
| 7 | `sms_queue`            | MoO   | 6.5 | 0 | 0 | ✓ |
| 8 | `sms_queue`            | Owner | 7   | 0 | 0 | ✓ |
| 9 | `sms_queue`            | CGS   | 8   | 1 | 1 | ✓ |

Both reads cleanly partition at their documented thresholds: 5 (Session A `0024_rls_global` cost-data tightening) and 8 (Session A `0025_rls_audit_misc` PII tightening).

---

## Tier 3 — Adversarial / negative

**3 tests, 36 cases. All pass.**

### Test 12 — Anonymous access sweep (28/28 ✓)

Authenticated role with no JWT claim (`current_user_id()` = NULL → all level-gated predicates evaluate NULL → false). 7 tables sampled across all access patterns: location-scoped, global readable, EXISTS-gated, service-role-only, self-or-admin, audit-log read-self.

| Table | Pattern | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|---|
| `shift_overlays`      | location-scoped         | 0 ✓ | 42501 ✓ | 0 rows ✓ | 0 rows ✓ |
| `vendor_items`        | global readable ≥3      | 0 ✓ | 42501 ✓ | 0 rows ✓ | 0 rows ✓ |
| `notifications`       | EXISTS-gated read       | 0 ✓ | 42501 ✓ | 0 rows ✓ | 0 rows ✓ |
| `audit_log`           | self-or-admin read      | 0 ✓ | 42501 ✓ | 0 rows ✓ | 0 rows ✓ |
| `checklist_instances` | location-scoped         | 0 ✓ | 42501 ✓ | 0 rows ✓ | 0 rows ✓ |
| `recipes`             | global readable ≥3      | 0 ✓ | 42501 ✓ | 0 rows ✓ | 0 rows ✓ |
| `sms_queue`           | CGS-only read           | 0 ✓ | 42501 ✓ | 0 rows ✓ | 0 rows ✓ |

The pattern holds across every shape. Anonymous reach into RLS-protected tables is uniformly zero.

### Test 13 — Cross-role boundary violations (5/5 ✓)

Four negative cases (deny when role lacks tier) + one positive control (admit when role exactly meets tier).

| # | Scenario | Expected | Actual | Pass |
|---|---|---|---|---|
| 1 | SL (lvl 4) INSERT `vendor_orders` (req GM+/6)                                 | DENY  | DENY  | ✓ |
| 2 | Trainer (lvl 3) INSERT `announcements` (req AGM+/5)                           | DENY  | DENY  | ✓ |
| 3 | AGM (lvl 5) INSERT `users` (req MoO+/6.5)                                     | DENY  | DENY  | ✓ |
| 4 | KH (lvl 3) INSERT `tip_pools` (req GM+/6)                                     | DENY  | DENY  | ✓ |
| 5 | Catering Mgr (lvl 5) INSERT `deep_clean_assignments` at MEP (req AGM+/5) — POSITIVE | ALLOW | ALLOW | ✓ |

The positive control (5) confirms we're not over-restricting — `catering_mgr` sits exactly at level 5 alongside AGM, and the policy admits both.

### Test 14 — Column-level boundary documentation (3/3 ✓ — RLS allow at row level confirmed)

These are positive ALLOW tests at the row level. Each ALLOW is empirical confirmation that RLS does **not** gate columns; the corresponding API route in a future phase must reject the column-level violation. See "App-layer enforcement boundaries" below for the full criteria.

| # | Scenario | RLS expected | RLS actual | Pass | API criterion |
|---|---|---|---|---|---|
| 1 | GM (lvl 6, MEP) INSERT `shift_overlays` with `forecast_notes` (CGS-only field) | ALLOW | ALLOW | ✓ | Phase 4 |
| 2 | AGM (lvl 5, MEP) UPDATE `vendors.name` (full/GM-only field via `vendors_update_trivial`)   | ALLOW | ALLOW | ✓ | Phase 5 |
| 3 | SL UPDATE own `notification_recipients` row's `delivery_status` + `delivery_method` (service-role-only fields) | ALLOW | ALLOW | ✓ | Phase 6 |

Test 14.3 initially returned a `check constraint` error on `delivery_method='spoof'` (an unrelated CHECK enum validation, not RLS); rerun with valid enum values (`'failed'`, `'sms'`) confirmed ALLOW at the RLS layer. The CHECK constraint is a separate defense-in-depth that is *good* — it would catch spoofed values at the column type level — but the column-content gate is still the API route's job.

---

## App-layer enforcement boundaries

These are documented Phase 4+ acceptance criteria. RLS is a row-shaped gate; columns and silent-denial UX are app-layer responsibilities. Each item below has empirical confirmation from this audit.

- **`shift_overlays.forecast_notes` — CGS-only.** RLS allows the row write for any level-3+ user (Test 14.1 ALLOW under GM). **Phase 4 acceptance criterion:** `/api/overlays/*` must reject payloads from `role_level < 8` that include `forecast_notes`.

- **`vendors_update_trivial` full-vs-trivial split.** RLS allows AGM+ (level 5) to UPDATE any column on a vendor row (Test 14.2 ALLOW under AGM). **Phase 5 acceptance criterion:** `/api/admin/vendors/[id]` must reject AGM payloads touching `name` / `category` / `ordering_days` / `payment_terms` / `account_number` / `active` (full-edit fields, GM+ only). Only `contact_person` / `email` / `phone` / `ordering_email` / `ordering_url` / `notes` are AGM-trivial.

- **`notification_recipients` editable columns.** RLS allows a user to UPDATE *any* column on their own delivery row (Test 14.3 ALLOW under SL editing own `delivery_status` and `delivery_method`). **Phase 6 acceptance criterion:** `/api/notifications/*` must reject user payloads touching `delivery_status` / `delivery_method` / `delivered_at` / `delivery_error` (service-role-only fields). Only `read_at` / `acknowledged_at` are user-editable.

- **`users_update_self` vs `users_update_admin` column split.** RLS admits self-updates to any column on the user's own row (Test 2 ALLOW under SL/KH editing own phone). **Phase 2 acceptance criterion:** `/api/auth/profile` (or wherever self-edit lives) must reject self-updates touching `role` / `email` / `email_verified` / `active` / `pin_hash` / `password_hash` / `locked_until` / `failed_login_count`. Only `phone` / `sms_consent` / `sms_consent_at` are self-editable. Sensitive fields go through the admin path.

- **`canActOn` strict-greater target check.** RLS admits any admin (level ≥ 6.5) to UPDATE *any* user row (Test 2 ALLOW under MoO updating KH). **Phase 5 acceptance criterion:** `/api/admin/users/[id]` must reject promote/edit attempts on users at or above the actor's own level (`actor.level > target.level`). The `lib/roles.ts` `canActOn()` helper is the single source of truth.

- **`training_progress` direct write.** RLS admits AGM+ to write progress rows (Test 4). **Phase 5 acceptance criterion:** trainees must not be able to write `training_progress` directly through any API route — only AGM+ via the admin path. The self-signoff prevention is enforced *both* at RLS (Test 4.1, 4.4 DENY) and should also be checked app-side as defense-in-depth.

- **`/api/photos/[id]` parent-artifact RLS join.** `report_photos_read` is permissive at level ≥ 3 because the polymorphic FK prevents clean parent-artifact join in RLS (per Session A handoff). **Phase 6 acceptance criterion:** `/api/photos/[id]` must validate parent artifact RLS before issuing signed URLs. The API is the second layer of defense.

- **0-rows-affected on UPDATE distinction.** RLS denials for UPDATE surface as `result.rowCount === 0`, not as an exception (per Test 2, 5, 6, 8 mechanic; AGENTS.md durable knowledge). **Phase 4+ acceptance criterion across all UPDATE routes** (`users`, `shift_overlays`, `announcements`, `training_progress`, `vendors`, `notification_recipients`, etc.): every route must check `rowCount === 0` and return an explicit error (404 Not Found or 403 Forbidden depending on context) rather than silently succeeding. Without this check, an attacker probing for tampering targets gets a 200 OK on every blocked UPDATE.

---

## Migrations applied during this session

| Version | Name | Purpose |
|---|---|---|
| `0029_helpers_security_definer` | Re-define helpers as SECURITY DEFINER + locked search_path | Fixes Issue #1 (RLS recursion) |
| `0029_helpers_revoke_anon`      | Strip explicit anon EXECUTE on helpers | Defense-in-depth follow-up |
| `0030_seed_audit_fixtures`      | 9 audit users + 13 user_locations rows | Tier 1/2/3 test contexts |

`0031_audit_fixtures_deactivate` is queued for application after audit sign-off (flips all 9 fixtures to `active=false`; rows persist forever per append-only philosophy).

---

## Result summary

| Tier | Tests | Cases | Pass |
|---|---|---|---|
| Step 0 (sanity) | 4 cases (post-fix; pre-fix Test 0.2 surfaced Issue #1) | 6 (incl. 0.3a/b/c/d divergence) | 6/6 ✓ |
| Tier 1 (must pass)        | 6 | 27 | 27/27 ✓ |
| Tier 2 (should pass)      | 5 | 55 | 55/55 ✓ |
| Tier 3 (adversarial)      | 3 | 36 | 36/36 ✓ |
| **Cumulative**            | **14 + Step 0** | **124** | **124/124 ✓** |

Zero policy failures. One policy *bug* (helper recursion) found, surfaced, fixed in-session with sign-off, durable knowledge captured in AGENTS.md, re-verified clean.

---

## Sign-off

Audit complete. Foundation is ready for Phase 2 (auth) once Juan signs off on this report.

After sign-off, the closing actions are:
1. Apply `0031_audit_fixtures_deactivate`.
2. Commit this report to `claude/hopeful-montalcini-fb7dde`.
3. Decide merge path (likely: `hopeful-montalcini` → `strange-keller` → `main`, tagged Phase 1 complete).

— End of report.
