<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

## Phase 0 — Foundation Scaffold (complete 2026-04-28)

### Stack as actually built

- **Next.js 16.2.4** + **React 19.2.4** (App Router, Turbopack stable)
- **Tailwind v4** — CSS-first config in `app/globals.css` via `@theme inline` blocks. **No `tailwind.config.ts`.** If you're tempted to create one because you "remember" Tailwind that way, stop. Tailwind v4 dropped that file. Tokens are in `app/globals.css`. Add new tokens by extending the `@theme inline` block.
- **TypeScript** — `strict: true` AND `noUncheckedIndexedAccess: true`. Array access returns `T | undefined`. Add a guard or use a non-null assertion only when you've verified the access is safe.
- **Node 22.20.0 LTS** via nvm-windows. Pinned in `.nvmrc` and `package.json` `engines`. The `.gitattributes` enforces LF on `*.sh` so the bash secrets script works on macOS/Linux/WSL — don't undo this.

### Spec deviations (intentional, signed off by Juan)

The Foundation Spec v1.2 specifies older versions. We deviated to current stable. **Do not "fix" these back to the spec literal — the deviations are intentional.**

- Next.js **14 → 16** (App Router same model; Turbopack default; `middleware.ts` is now `proxy.ts`)
- Claude **Sonnet 4 → Sonnet 4.6** (`claude-sonnet-4-6`) — see `lib/ai-prompts.ts` `AI_MODEL` constant
- Node **20 → 22 LTS**
- Tailwind **v3 → v4** (token file moved, see above)

### Naming conventions discovered in Next 16

- **`middleware.ts` → `proxy.ts`.** Same export shape, same `config.matcher`, same role. The deprecation warning fires if you write `middleware.ts`. Use `proxy.ts`.
- Auto-generated `AGENTS.md` (this file) is preserved. Auto-generated `CLAUDE.md` is a one-liner `@AGENTS.md` include — keep it.

### Auth architecture

- **Custom JWT layer**, not Supabase Auth. We sign tokens; Supabase verifies them.
- `AUTH_JWT_SECRET` — HS256 secret used to sign JWTs from `lib/auth.ts` (Phase 2).
- **Supabase configured with an HS256 standby key** whose value matches `AUTH_JWT_SECRET`. (Old "JWT Secret" field is no longer editable in the new Supabase JWT signing-keys system, late 2025+.) Standby keys verify but don't sign — exactly what we need.
- RLS reads `current_setting('request.jwt.claim.user_id')`. Helper functions in spec §5 (`current_user_id`, `current_user_role_level`, `current_user_locations`).
- **FOOTGUN:** rotating one without the other = every authenticated request 500s. `docs/runbooks/jwt-rotation.md` will document the procedure when auth lands in Phase 2.

### What's already built ahead of schedule

These foundation libraries are populated in full from spec §4 + §7. Phase 3 doesn't need to write them — only runtime helpers (location scoping logic, step-up modal wiring, session cookie readers).

- `lib/roles.ts` — full role registry, level lookups, `minPinLength()` (5 for level ≥5, 4 below). PIN length is a Juan addition not in spec — see Phase 0 transcript decision #1.
- `lib/permissions.ts` — full permission matrix
- `lib/destructive-actions.ts` — full destructive action list
- `lib/types.ts` — TypeScript shapes for every artifact (User, Location, Vendor, VendorItem, ParLevel, ChecklistTemplate, ChecklistInstance, ChecklistCompletion, ChecklistSubmission, ChecklistIncompleteReason, PrepListResolution, ShiftOverlay, WrittenReport, Announcement, TrainingReport, ReportPhoto, AuditLogEntry, HandoffFlag). camelCase at the application layer; the Supabase client layer (Phase 1) handles the snake_case translation.

### `.env.local` handling pattern

- **`.env*` is gitignored** with `!.env.local.example` exception so the template ships and real env files don't.
- **Never paste secret values into chat.** Always: write to `.env.local` (gitignored), set in Vercel dashboard UI manually.
- **`scripts/generate-secrets.ps1`** (Windows) and **`scripts/generate-secrets.sh`** (POSIX) generate `AUTH_JWT_SECRET`, `AUTH_PIN_PEPPER`, `AUTH_PASSWORD_PEPPER`. Output goes to stdout — redirect to a `.env.local.generated.tmp` file (also gitignored), copy values out, delete the tmp file.
- **`.vercelignore`** excludes `.env*` from CLI uploads as defense-in-depth. The `Detected .env file` warning Vercel emits during builds is about its own injected `.env.production.local`, not ours — it's harmless.

### Domain correction

The CO domain is **`complimentsonlysubs.com`**, NOT `complimentsonly.com`. The original spec had this wrong; the corrected v1.2 (with corrections log) is the source of truth. `EMAIL_FROM` will eventually be `ops@complimentsonlysubs.com` once the domain is verified in Resend; until then `EMAIL_FROM=onboarding@resend.dev`.

If you find any committed reference to `complimentsonly.com`, fix it in the same commit you noticed it.

### Juan's working pattern

- **Discuss before building.** Surface ambiguity in batches of 3–5 related questions, not one at a time. Architectural ambiguity surfaces *immediately* — don't draft around it.
- **Push back on flawed assumptions in real time.** Juan prefers honest collaboration over agreement. If a spec instruction conflicts with current reality, flag it before you act on it.
- **Quality over speed.** This goes in front of Pete (Owner) and Cristian (MoO). Take the extra session to do it right.
- **Foreground commands for anything that prompts.** GUI dialogs (GCM, vercel device-code) don't render reliably from background processes.
- **Never paste secrets into chat.** No exceptions.

### Carry-overs to future phases

- **`docs/runbooks/jwt-rotation.md`** — owed when auth lands in Phase 2.
- **`NEXT_PUBLIC_APP_URL`** — currently unset in Vercel env. Resolve when production domain is known (or use `VERCEL_URL` injection).
- **PAT expiration calendar reminder** — Juan's responsibility; flagged once during Phase 0 push troubleshooting.
- **Resend domain verification** — `complimentsonlysubs.com` not yet verified; `EMAIL_FROM` swap deferred until it is.

### Juan's project identity

Juan's CO/project identity is **`juan@complimentsonlysubs.com`** (his CO work email — also the seed CGS user email in the database). His personal Gmail is kept entirely separate from CO contexts; do not use it as a project identity, do not reference it in code, configs, or docs. If any tooling has captured a Gmail address as Juan's project identity, correct it.

---

## Phase 1 — Database (schema + RLS + seed; Session A complete 2026-04-29)

### Stack as actually built

- **Postgres 17.6.1.111** on Supabase (`co-ops` project, us-east-1, id `bgcvurheqzylyfehqgzh`). Spec §3.1 said PG15; PG17 is what's running. No blocker.
- **`pgcrypto` extension** enabled (`crypt()` + `gen_salt('bf', 12)` for the placeholder bcrypt in Juan's seed `pin_hash`).
- **53 tables** in `public` schema (spec said ~45; actual count is 53 across §4.1–§4.16).
- **28 named migrations** applied via the Supabase MCP `apply_migration` tool — every change is traceable. 15 schema, 10 RLS, 3 seed.
- **`relrowsecurity = true` on every table.** Confirmed by `pg_class` smoke test.

### RLS footguns and durable lessons (Session A)

These cost an extra round of corrective migrations in Session A. **Read this section before writing any RLS policy.**

#### `FOR ALL` permits DELETE silently

Postgres permissive policies OR-stack **per operation**. A `FOR ALL` write policy applies to SELECT, INSERT, UPDATE, **AND DELETE**. Pairing `FOR ALL USING (level >= N)` with `FOR DELETE USING (false)` does *not* deny deletes — the OR-stack resolves to `(level >= N) OR false = level >= N`, so any user passing the write check can delete.

**Fix:** never use `FOR ALL` for writes. Always split into `FOR INSERT` + `FOR UPDATE`, paired with an explicit `FOR DELETE USING (false)`. The spec verbatim policies in §5.2 / §5.4 / §5.5 had this bug; corrected in `0021_rls_auth_corrections` and `0023_rls_verbatim_corrections`.

#### RLS helper functions must be `SECURITY DEFINER` with locked `search_path`

Any helper function that queries a table whose RLS policy calls that same helper will recurse infinitely — `current_user_role_level()` selects from `users`, the `users_read_self` admin branch (`current_user_role_level() >= 6`) calls back into the helper, and any cross-row read where the self-predicate (`id = current_user_id()`) is false fires the admin branch → recursive call → stack-depth crash. The bug only short-circuits when *every* row being scanned is the caller's own row, which is why it stays latent with single-user seed and explodes the moment fixtures land. Fix: mark the helper `SECURITY DEFINER` so its internal queries run as the function owner (`postgres`) and bypass RLS, with `SET search_path = pg_catalog, public` to block schema-shadowing attacks. For invocation control, `REVOKE EXECUTE ... FROM PUBLIC` is *not enough* — Supabase's default schema ACLs explicitly grant EXECUTE on public functions to `anon`, `authenticated`, AND `service_role`, and `REVOKE FROM PUBLIC` doesn't strip those explicit role grants. You need a separate `REVOKE EXECUTE ... FROM anon` (and verify with `information_schema.routine_privileges`) so anon fails loudly with insufficient-privilege if mis-routed code ever invokes a helper without a JWT claim. Caught in Phase 1 Session B audit Step 0 (Test 0.2: anonymous users read crashed instead of returning 0 rows; the Supabase default-ACL gotcha surfaced when the post-migration grants check still showed `anon:EXECUTE`). Resolved in `0029_helpers_security_definer` + `0029_helpers_revoke_anon`. The three helpers (`current_user_id`, `current_user_role_level`, `current_user_locations`) are SECURITY DEFINER going forward — never re-create them as SECURITY INVOKER.

#### RLS denials on UPDATE are silent — 0 rows affected, not an exception

INSERT denials raise `new row violates row-level security policy for table "X"` (sqlstate 42501). UPDATE denials don't — the USING clause filters the row out and the statement returns `UPDATE 0` with no error. From the API layer this is indistinguishable from "the row exists but matched no WHERE clause." Every UPDATE route (users, shift_overlays, announcements, training_progress, vendors, etc.) must check `result.rowCount === 0` and return an explicit error (404 Not Found or 403 Forbidden depending on context) rather than silently succeeding. Phase 4+ acceptance criterion across all UPDATE routes; surfaced in Phase 1 Session B audit Tier 1 Test 2 where SL-updates-KH-phone returned 0 rows affected with no exception.

#### Postgres role switching + temp tables: temp tables aren't auto-shared across roles

A temp table created in service-role context is owned by service-role and isn't automatically accessible to `authenticated` after a `SET LOCAL ROLE authenticated`. The first INSERT under the authenticated role fails with `permission denied for table <temp_name>`. Fix: either `GRANT ALL ON <temp_table> TO authenticated;` immediately after `CREATE TEMP TABLE` (before the role switch), or create the temp table after switching roles. Caught in Phase 1 Session B Tier 1 Test 1 harness construction. Pattern matters for any test or runtime code that switches roles mid-transaction.

#### Append-only philosophy is enforced at RLS

CO-OPS is append-only. Every table has `_no_user_delete USING (false)`. Configuration tables (with `active` columns — `vendors`, `vendor_items`, `par_levels`, `checklist_templates`, `checklist_template_items`, `announcements`, `recipes`, etc.) are **deactivated via `active = false`, never deleted**. The audit trail and correction-table model rely on rows persisting; delete + re-insert breaks history.

If you find yourself wanting to `DELETE`, you're in the wrong code path. Flip `active`, append a correction row, or supersede via a new immutable record.

#### RLS policy naming convention

- `<table>_<action>` for permissive policies that allow operations.
  - Examples: `users_read_self`, `vendor_items_insert`, `announcements_update`, `shift_overlays_update_self`.
- `<table>_no_user_<operation>` for explicit denies via `USING (false)` / `WITH CHECK (false)`.
  - Examples: `audit_no_user_insert`, `users_no_user_delete`, `prep_list_resolutions_no_user_update`.

Service-role bypasses RLS entirely. The `_no_user_*` policies block end-user clients while letting `lib/audit.ts`, `lib/notifications.ts`, integration adapters, etc. continue to write via service-role client.

#### Column-level enforcement is app-layer, not RLS

Postgres can't do per-column RLS cleanly. Where the spec/policy needs column-level gating, RLS allows the row write and the API layer rejects payloads touching restricted columns. Documented sites (each has a `COMMENT ON POLICY` or migration comment):

- **`shift_overlays.forecast_notes`** — CGS-only (level 8). `/api/overlays/*` rejects payloads from non-CGS users that include this field.
- **`vendors_update_trivial`** — RLS allows AGM+ to update any vendor row; `/api/admin/vendors/[id]` enforces trivial-vs-full edit split (trivial = AGM+: contact_person/email/phone, ordering_email/url, notes; full = GM+: name/category/ordering_days/payment_terms/account_number/active).
- **`notification_recipients_update_self`** — RLS allows users to update their own delivery row; the API rejects payloads touching `delivery_status`/`delivery_method`/`delivered_at` (only `read_at`/`acknowledged_at` are user-editable).
- **`users_update_self`** vs **`users_update_admin`** OR-stack — RLS allows self-updates to any field; the admin API enforces that self-updates only touch `phone`/`sms_consent`/`sms_consent_at`. Sensitive fields (role, email, email_verified, active, pin_hash, password_hash, locked_until, failed_login_count) require the admin path.

**`training_progress` self-signoff prevention** is an exception — it *can* be enforced in RLS via `signed_off_by != current_user_id()` in WITH CHECK, and is. Use RLS when the constraint is row-shaped; use app-layer when it's column-shaped or cross-row.

#### `canActOn` (admin cannot act on peer/senior) is app-layer

Strict-greater target check (admin's level > target's level) lives in the admin API, not RLS. RLS gates "can this user touch the table at all?"; the admin route enforces "can this admin act on this specific target?". `lib/roles.ts` `canActOn()` is the helper.

### What's seeded

- **2 locations**: Capitol Hill (code `MEP`, type `permanent`), P Street (code `EM`, type `permanent`). `created_by = NULL` (bootstrap, before Juan existed).
- **1 user**: Juan (`juan@complimentsonlysubs.com`, role `cgs`, active, email_verified). `created_by = NULL` (bootstrap). **`pin_hash` is a placeholder bcrypt of the literal string `seed_placeholder` at cost 12** — Phase 2 must overwrite via the admin tool / PIN reset flow before Juan can sign in.
- **1 vendor**: `TBD - Reassign` (category `other`, active). The visible suffix is the Cristian/Juan reminder to remap items post-foundation.
- **24 vendor_items** attached to TBD - Reassign with `weekday_par = NULL` and `weekend_par = NULL`. NULL is intentional — pars are set per-location via `par_levels` (Phase 5 admin tool).

### Auth path the schema expects

The custom JWT layer (Phase 2 `lib/auth.ts`) sets `request.jwt.claim.user_id` per request via `set_config('request.jwt.claim.user_id', '<uuid>', true)`. Helper functions read from this claim. Service-role connections bypass RLS entirely — used for `lib/audit.ts`, `lib/notifications.ts`, integration adapters, password reset / email verification flows, and the prep-list resolution generator.

### Carry-overs to future phases

- **Phase 1 Session B (RLS audit)** — gate before Phase 2 opens. See `docs/PHASE_1_SESSION_A_HANDOFF.md`.
- **Phase 2 must overwrite Juan's placeholder `pin_hash`** before any auth attempt. Until then, all PIN auth attempts will (correctly) fail.
- **Phase 4+ API routes** must enforce the documented column-level boundaries above (`forecast_notes`, vendors trivial-vs-full, notification recipients fields, users self-update fields).
- **Phase 6 `/api/photos/[id]`** must validate parent artifact RLS before issuing signed URLs. `report_photos_read` is permissive at level ≥3 because the polymorphic FK prevents clean parent-artifact join in RLS — the API is the second layer.
- **Supabase Storage bucket** (`report-photos`, private) — deferred to Phase 6 with the rest of the photo service. Storage policies, CORS, and signed-URL config bundle there.
