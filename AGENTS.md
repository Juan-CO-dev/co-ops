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

- `lib/roles.ts` — full role registry, level lookups, `minPinLength()` (returns `4` for all roles per Phase 2 Session 1 decision — matches Toast/7shifts punch-in convention).
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

The custom JWT layer (Phase 2 `lib/auth.ts`) signs an HS256 JWT containing `user_id` and `role: 'authenticated'` (plus app-layer convenience claims — see Phase 2 Session 2 entries). The JWT is sent on the `Authorization: Bearer …` header; PostgREST verifies it against the configured HS256 signing key and exposes the claims as `request.jwt.claims` (plural JSONB). Helper functions read `current_setting('request.jwt.claims', true)::jsonb ->> '<key>'` (per migration `0032_helpers_modern_claim_format`). Service-role connections bypass RLS entirely — used for `lib/audit.ts`, `lib/notifications.ts`, integration adapters, password reset / email verification flows, and the prep-list resolution generator.

### Carry-overs to future phases

- **Phase 1 Session B (RLS audit)** — complete (124/124 pass; see `docs/PHASE_1_RLS_AUDIT.md`). Phase 1 locked at tag `phase-1-complete` on main.
- **Phase 2 must overwrite Juan's placeholder `pin_hash`** before any auth attempt. Until then, all PIN auth attempts will (correctly) fail.
- **Phase 4+ API routes** must enforce the documented column-level boundaries above (`forecast_notes`, vendors trivial-vs-full, notification recipients fields, users self-update fields).
- **Phase 6 `/api/photos/[id]`** must validate parent artifact RLS before issuing signed URLs. `report_photos_read` is permissive at level ≥3 because the polymorphic FK prevents clean parent-artifact join in RLS — the API is the second layer.
- **Supabase Storage bucket** (`report-photos`, private) — deferred to Phase 6 with the rest of the photo service. Storage policies, CORS, and signed-URL config bundle there.

---

## Phase 2 — Session 2 (auth lib + standby-key gate, 2026-04-29)

### Durable-knowledge entries

Seven architectural lessons surfaced during Session 2 implementation. They are independent of any specific Phase 2 deliverable and apply to every auth-bearing path in the codebase.

#### PIN length is 4 digits for all roles

Locked Phase 2 Session 1: every role uses a 4-digit PIN — including level-5+ roles that also have email+password as a secondary auth path. Matches Toast / 7shifts punch-in convention so frontline staff don't mode-switch between systems. Earlier draft spec considered a 5/4 split (5 digits for level≥5, 4 below); that was rejected in Session 1 — the operational cost of the split exceeds the marginal entropy gain when the lockout policy (5 failures / 15 min lock) is the actual brute-force defense. `lib/roles.ts` `minPinLength()` returns `4` for every role; do not reintroduce role-conditional length logic.

#### PostgREST reserves the `role` JWT claim for the database role

PostgREST inspects the `role` claim in any verified JWT and uses it as the Postgres role to switch into for the request. The claim must contain a valid Postgres role name (`authenticated`, `anon`, `service_role`); anything else (such as our app role `cgs`) causes PostgREST to attempt `SET ROLE <invalid>` and fail. Our app role therefore lives in `app_role`, not `role`. **Final JWT claim shape locked Phase 2 Session 2:**

```ts
{ user_id, app_role, role_level, locations, session_id, role: 'authenticated', iat, exp }
```

`proxy.ts` (Phase 2 Session 2) attaches `x-co-role` from `app_role`, `x-co-role-level` from `role_level`, etc. — never from the PostgREST-reserved `role` claim. Caught Phase 2 Session 2 architecture review.

#### Supabase Management API hex-decodes HS256 secrets on key creation

When creating an HS256 signing key via `POST /v1/projects/{ref}/config/auth/signing-keys` with `private_jwk.k` set to a hex string, the API interprets the value as hex-encoded and decodes it to raw bytes server-side (so a 64-character hex `AUTH_JWT_SECRET` becomes a 32-byte HS256 key). Our app must therefore consume `AUTH_JWT_SECRET` via `Buffer.from(secret, "hex")` to produce matching key bytes. Caught Phase 2 Session 2 standby-key smoke test (UTF-8 interpretation produced signatures that PostgREST rejected with PGRST301; hex-decoded interpretation verified correctly). The pattern is baked into `lib/auth.ts` (`getJwtKey()`).

#### PostgREST v12+ deprecated `request.jwt.claim.<name>` (singular)

Modern PostgREST populates only `request.jwt.claims` (plural, JSONB containing the full payload). RLS helpers reading the singular form silently return NULL even when the JWT verifies correctly. Migration `0032_helpers_modern_claim_format` updated `current_user_id()` to read `current_setting('request.jwt.claims', true)::jsonb ->> 'user_id'`; `current_user_role_level()` and `current_user_locations()` were unaffected because they delegate through `current_user_id()`. The Phase 1 RLS audit harness set `request.jwt.claim.user_id` directly via `SET LOCAL`, bypassing PostgREST's claim-extraction step — the policies themselves were correct, only the claim-source pointer was stale. Honest accounting: this latent bug would have shown up the moment Phase 2 hit PostgREST with a real JWT, regardless of how thorough the Phase 1 audit was, because the audit's harness construction sidestepped the integration path.

#### JWT-embedded authorization claims have refresh latency

`locations`, `app_role`, and `role_level` are signed into the session JWT for app-layer convenience and only refresh on session rotation (re-login or 12-hour exp). If admin user-deactivation or location-removal must take effect immediately, the admin path must revoke active sessions in addition to mutating the user record. **Phase 5 admin user/location routes acceptance criterion:** every user/location mutation in the admin API that affects authorization (deactivate, role change, location add/remove) must call `revokeSession()` for every active session of the affected user inside the same transaction.

#### Session storage uses dual verification: JWT + token_hash

The session JWT carries identity (`session_id` claim) and is signed/verified via `AUTH_JWT_SECRET`. The `sessions.token_hash` column stores `hashToken(jwt)` (SHA-256). `requireSession` validates BOTH layers: JWT signature/exp via `verifyJwt`, AND that `hashToken(rawCookieJwt) === sessions.token_hash` for the row identified by `session_id`. This dual-check protects against `AUTH_JWT_SECRET` leak scenarios — a forged JWT can pass signature verification but won't match the stored hash for any existing session. On mismatch, `requireSession` returns 401 with cleared cookie AND writes an `audit_log` entry tagged `session_token_mismatch` (action: `session_token_mismatch`, resource_table: `sessions`, resource_id: the session row id, metadata captures IP + user-agent + reason). The schema column was added in Phase 1 — Phase 2 Session 2 surfaced it during session-lifecycle implementation and wired the verification path correctly. Pattern lives in `lib/session.ts` (`createSession` writes the hash, `requireSession` verifies it).

#### audit_log is permanent and accumulates orphaned references

When test/smoke setups create temporary resources and trigger audit events, the audit row references a `resource_id` that is later cleaned up. The audit row remains. This is correct: the record of detection is more important than referential integrity for forensic data. Production auditors investigating `audit_log` entries should not assume `resource_id` always points to an existing row — historical events about deleted resources are valid evidence. Phase 2 Session 2 smoke testing produced one such row (`session_token_mismatch` with orphaned `session_id`); it stays. The `audit()` helper (`lib/audit.ts`) uses console-error-and-continue failure semantics for the same philosophy: losing an audit row is bad, but breaking the user-facing operation because logging failed is worse — the calling flow always proceeds even when the audit insert errors.

### Session 2 closing summary

Phase 2 Session 2 (foundation: lib + proxy) is complete. Live as of this session: `lib/auth.ts` (8 stateless primitives — bcrypt PIN/password with peppers, JWT sign/verify via jose with hex-decoded `AUTH_JWT_SECRET`, token generate/hash for at-rest storage); `lib/session.ts` (7 exports — `createSession`, `requireSession` with dual JWT+token_hash verification and `/admin/*`-exit step-up auto-clear, `revokeSession`, `unlockStepUp`/`clearStepUp`, `pruneExpiredSessions`, `SESSION_COOKIE_NAME`); `lib/permissions.ts` runtime wiring; `lib/locations.ts` (level-7+ all-locations override and assignment-list lookup); `lib/audit.ts` (single `audit()` helper, service-role-only, console-error failure semantics, destructive auto-derivation); `lib/supabase.ts` + `lib/supabase-server.ts` (anon browser, per-request authenticated, service-role); `proxy.ts` (edge-runtime JWT signature/exp validation only, attaches `x-co-{user-id,app-role,role-level,session-id}` headers, defensive public-path bypass); migration `0032_helpers_modern_claim_format` (helpers read `request.jwt.claims` JSONB). Queued for Sessions 3–5: API route handlers (`/api/auth/{pin,password,logout,step-up,verify,password-reset-request,password-reset}`); login/verify/reset UI components; `docs/PHASE_2_AUTH_AUDIT.md`; Juan's real `pin_hash` overwrite via the admin-tool flow; `docs/runbooks/jwt-rotation.md`. Auth library is functionally complete — the route layer in Session 3 is consumption, not new primitives.
