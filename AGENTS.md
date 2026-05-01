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

---

## Phase 2 — Session 3 (API routes + email flows + JWT rotation runbook, 2026-04-29)

### Durable-knowledge entries

Nine architectural lessons surfaced during Session 3 implementation. They span proxy edge cases, defense-in-depth choices, deployment shape, and audit conventions; all apply beyond the Session 3 deliverables.

#### Next 16 disallows capturing groups in proxy matcher patterns

`proxy.ts` `config.matcher` regexes are compiled by Next 16 at build/dev start. Any `(...)` capturing group raises `Error parsing ... Capturing groups are not allowed at <pos>` and the proxy fails to register — meaning every protected path is reachable without auth until the matcher is fixed. Use non-capturing groups `(?:...)` for alternation: `api/auth/(?:pin|password|logout|verify|password-reset-request|password-reset)$`. Caught Phase 2 Session 3 Step 1 first dev-server boot — Session 2's smoke had validated proxy logic via mocked `NextRequest`/`NextResponse` but never ran `next dev`, so the parser error slipped through. **Durable lesson:** integration smokes that touch proxy/middleware behavior must exercise a real dev server, not just unit-test the function in isolation. Audit any future `config.matcher` change by booting `next dev` and watching the startup log for parser errors before declaring smoke green.

#### Enumeration-defense scope (constant-shape now; per-IP rate limiting deferred)

`/api/auth/verify` and `/api/auth/password-reset-request` return constant-shape responses regardless of internal state — `verify` always returns 400 `invalid_token` on any token failure (not_found / consumed / expired); `password-reset-request` always returns 200 `{ ok: true }` regardless of whether the email maps to a user, the role supports email auth, the user is active, or the email is verified. Internal disposition is captured exclusively in audit metadata (`metadata.outcome` for reset-request; `auth_token_invalid` / `auth_token_consumed_replay` / `auth_token_expired` action discrimination for verify). Per-IP rate limiting is **explicitly deferred to Phase 5+** when Vercel KV (or equivalent) infrastructure lands — for foundation, the constant-shape pattern is the actual leak-defense; per-IP throttling would only address brute-force volume, which the lockout policy already limits per-user. Acceptable risk for small-team / single-tenant deployment; revisit before any meaningful production traffic.

#### Proxy 307 semantics for POST redirects

`NextResponse.redirect()` returns **307** (Temporary Redirect) in Next 13+, which preserves the request method. For unauthenticated POSTs to non-public API routes, this means the browser/fetch follows the redirect and re-POSTs to `/`, instead of GET-ing the login page. UI in Session 4+ must treat 307 from API routes as an auth failure (extract the `Location` header, navigate the user to `/?next=<orig>`), NOT silently follow the redirect. Server-side fetch in tests must use `redirect: "manual"` to observe the raw 307; default `redirect: "follow"` causes confusing 200s from the home page route. Caught Phase 2 Session 3 Step 2 smoke (case 4: step-up / no session expected 401, got 200 because fetch followed the redirect to `/`).

#### `revokeSession` idempotency contract

`lib/session.ts` `revokeSession(sessionId)` is idempotent: it sets `revoked_at = now()` only when `revoked_at IS NULL` (`.is("revoked_at", null)` filter), and returns `{ rowsAffected: number }`. `rowsAffected: 1` means the call newly revoked the session; `rowsAffected: 0` means already-revoked OR the session id doesn't exist. Callers decide how to interpret 0: `/api/auth/logout` treats it as success-with-anomaly-audit (logout is intent-honoring, not state-asserting; the audit row's `metadata.outcome` distinguishes `revoked` vs `already_revoked` vs `session_not_found`). Future admin paths that revoke other users' sessions can branch differently (e.g., return 404 if 0 rows). The idempotent design mirrors the Phase 1 silent-denial pattern (UPDATE returning 0 rows is not an error in Postgres) but applied at the app layer for an intent-honoring operation.

#### Worktree filesystem isolation

Claude Code worktrees are git-isolated AND filesystem-isolated. `public/`, `.env.local`, and any other untracked-but-required files live only in the parent repo unless explicitly copied. The pattern when starting any worktree-based session is: copy `.env.local` from `<parent>/co-ops/.env.local`, and copy any required untracked assets (e.g., `public/brand/*`). The `.gitignore` correctly keeps these out of git history; the worktree-init bootstrap is the orchestrator's responsibility. Surfaced Phase 2 Session 3 Step 3 pre-flight when `public/brand/` was empty in the worktree but populated in the parent. **Carry-over:** Phase 5+ session kickoffs that touch `public/`, `.env.local`, or other gitignored paths should include explicit asset-copy commands in the kickoff prompt.

#### Email templates: typography-only header is the foundation default

Both verification and password-reset emails use a **typography-only header** — "Compliments Only" set in bold system-font ALL CAPS at 28px with tight tracking (`letter-spacing: -0.02em`) on the Mustard band. The image-based wordmark (`co-wordmark.png`) was tried first and dropped after first-pass visual review: Gmail (and other major clients) blocks `http://localhost` image sources as anti-tracking defense, and image-proxying behavior varies even for production-domain HTTPS sources. Typography renders identically across Gmail / iOS / Apple Mail / Outlook (the latter degrades letter-spacing gracefully, still readable). Inline base64-embedded images were also tried and worked, but added a deploy-shape concern (`fs.readFileSync` from `public/`) that was eliminated by the typographic switch. **The image variant returns to email as a refinement once the production domain is verified and HTTPS image serving is reliable across clients; the typographic header stays as the fallback either way.**

#### Email-rendering routes must stay Node runtime if disk-loaded assets return

`/api/auth/verify`, `/api/auth/password-reset-request`, and any future email-sending route default to Node runtime in Next 16 — sufficient because emails are pure HTML strings (no `fs`). If the image-based wordmark variant returns and reads from disk via `fs.readFileSync`, those routes MUST stay on Node runtime — `export const runtime = "edge"` would break the read because `fs` is Node-only. Currently moot because templates are pure strings; documenting the constraint so a future "let's edge-ify all auth routes for cold-start latency" suggestion knows the trade-off.

#### Audit-action vocabulary lock (Phase 2 Session 3)

The auth-event audit vocabulary is locked at end of Session 3. New auth flows in Phase 5+ should reuse these names verbatim and add new entries in the same `auth_*` namespace:

- `auth_signin_pin_success` / `auth_signin_pin_failure`
- `auth_signin_password_success` / `auth_signin_password_failure`
- `auth_account_locked` (fires exactly once per lockout-threshold crossing)
- `auth_logout` (metadata.outcome ∈ {revoked, already_revoked, session_not_found, jwt_invalid, no_cookie})
- `auth_step_up_success` / `auth_step_up_failure`
- `auth_email_verified`
- `auth_password_reset_requested` (metadata.outcome ∈ {user_not_found, user_inactive, role_not_email_auth, email_not_verified, email_sent, email_failed, insert_failed})
- `auth_password_reset_success`
- `auth_token_invalid` / `auth_token_expired` / `auth_token_consumed_replay` (token-validation failure modes; `resource_table` identifies which token table — `email_verifications` or `password_resets`)
- `session_token_mismatch` (grandfathered from Phase 2 Session 2 — JWT signature passed but stored `token_hash` didn't match; possible `AUTH_JWT_SECRET` leak forgery)

Failure-metadata convention: `reason` for sign-in failures (`wrong_pin`, `wrong_password`, `user_not_found`, `email_not_found`, `account_inactive`, `email_not_verified`, `account_locked_attempt`, `missing_pin_hash`, `missing_password_hash`, `role_not_email_auth`); `requested_user_id` / `requested_email` when `actor_id` is null (spray-attack forensics); `attempt_number` for countable-reason failures; `triggered_lockout: true` on the failure that crossed the threshold. **Note for Session 5 audit:** the `auth_token_expired` path is implemented symmetrically to `auth_token_invalid` and `auth_token_consumed_replay` but was not exercised in Step 3 smoke. Session 5 audit should add an explicit expired-token scenario (insert a verification or password-reset row with `expires_at` in the past, attempt consume, verify the `auth_token_expired` audit row emits with `metadata.expires_at` populated).

#### Defense pattern: credential or authorization changes revoke active sessions

Whenever a user's auth state changes such that the holder of an active session JWT may no longer be the intended owner, the mutation MUST also revoke active sessions. The pattern: mutate the user record AND `UPDATE sessions SET revoked_at = now() WHERE user_id = ? AND revoked_at IS NULL`, capturing `metadata.sessions_revoked: <count>` on the audit row for forensic visibility. Triggers:

- **Password reset** (Phase 2 Session 3, `/api/auth/password-reset` — implemented, smoked end-to-end with 6 active sessions revoked).
- **Admin password change, role demotion, location removal, account deactivation** (Phase 5+ admin user/location routes — acceptance criterion).

The pattern is defense-in-depth against a leaked / forgotten / shared credential: invalidating the credential alone leaves any pre-existing session JWT valid until 12h JWT-exp or idle-timeout. Revoking active sessions kills that residual access immediately.

### Session 3 closing summary

Phase 2 Session 3 (API routes + email flows + JWT rotation runbook) is complete and integration-smoked end-to-end. Live as of this session: `app/api/auth/{pin,password,logout,step-up,verify,password-reset-request,password-reset}` (7 route handlers, all Node runtime, all consuming Session 2's lib primitives); `lib/auth-flows.ts` (3 helpers — `isLocked`, `recordFailedAttempt` with `extraMetadata` for spray-attack forensics, `recordSuccessfulAuth` setting `last_login_at` + creating session + auditing + clearing counters); `lib/api-helpers.ts` (`jsonError` / `jsonOk` / `extractIp` / `parseJsonBody`, locked error response shape with optional `field` for validation errors and `retry_after_seconds` for 423 lockouts); `lib/email.ts` (Resend wrapper with console-error-and-continue semantics, never throws); `lib/email-templates/_layout.ts` + `verification.ts` + `password-reset.ts` (branded HTML with typography-only header per brand book primary palette); `lib/session.ts` extensions (`revokeSession` returns rowsAffected and is idempotent; `applySessionCookie` / `clearSessionCookie` route-handler-facing cookie helpers); `proxy.ts` matcher fix (capturing → non-capturing group) and `/api/auth/logout` added to `PUBLIC_PATHS`; `docs/runbooks/jwt-rotation.md` (313-line operational runbook with dashboard-preferred path, monitoring SQL queries, recovery procedures, forbidden patterns, rotation log). Smoke gates passed: 8/8 Step 1 (PIN + password sign-in), 7/7 Step 2 (logout + step-up), 10/10 Step 3 (verify + password-reset cycle with real Resend deliverability), 7/7 Step 4 final integration. Juan's smoke-test PIN/password were restored to seed-placeholder values before commit. Queued for Sessions 4–5: login/verify/reset UI components (Session 4); `docs/PHASE_2_AUTH_AUDIT.md` (Session 5); Juan's real PIN/password set via admin-tool flow (Session 5); explicit `auth_token_expired` exercise in Session 5 audit.

---

## Phase 2 — Session 4 (UI surfaces — in progress, 2026-04-29)

### Durable-knowledge entries

#### Phase 0 design tokens repointed to brand-book values

Phase 0 design tokens were repointed to brand book values in Phase 2 Session 4. Token names (`--co-bg`, `--co-text`, `--co-gold`, etc.) are load-bearing across modules per Phase 0's comment in `app/globals.css` ("Modules reference them by name. Do not rename without a coordinated migration across all modules."). Original v1.1-era values were dark-theme: `--co-bg: #0A0A0B`, `--co-text: #E5E5E5`, `--co-gold: #D4A843`. v1.2's brand book is canonical; values were updated to the brand-book primary palette while names stayed stable: Mayo `#FFF9E4` → `--co-bg`, Diet Coke `#141414` → `--co-text`, Mustard `#FFE560` → `--co-gold`. Added `--co-cta: #FF3A44` for brand Red — semantically distinct from Mustard gold per the brand book's "use sparingly" rule for CTA text only. Status tokens (`--co-success`, `--co-danger`, `--co-info`) shifted to brand-book secondary palette where applicable. Any future module that looks visually wrong after this swap should fix its color usage rather than reverting tokens — the v1.1 dark-theme design predates the brand-book lock.

#### `/api/users/login-options` privacy contract is documented and accepted

`/api/users/login-options` is a public, unauthenticated endpoint that exposes user names by `(location_id, role)` for the tile-flow login surface. By design — the floor-staff login UX requires showing names in tiles before any credential is collected, mirroring the Toast/7shifts punch-in pattern. Email and `last_login_at` are NOT exposed. Privacy tradeoff acknowledged: an unauthenticated party can enumerate "who works at MEP as Shift Lead" by walking `(location, role)` permutations against the public `/api/locations`. Acceptable for foundation given CO's small-team / single-tenant / public-storefront nature. If CO-OPS ever multi-tenants or hosts non-public roles, revisit: gate behind a low-friction first-factor (e.g., location-code entry), or rate-limit at the IP level.

#### Next.js 16 dev mode cross-origin safety blocks LAN access without `allowedDevOrigins`

Next.js 16 dev mode blocks cross-origin requests to `/_next/*` by default. When testing on a phone via the dev server's LAN IP (e.g., `http://10.0.0.20:3000`), HTML loads but JS bundle requests get blocked, leaving the page rendered but non-interactive ("looks like a screenshot"). Fix: add the LAN IP to `allowedDevOrigins` in `next.config.ts`. The dev server log emits an explicit warning — `⚠ Blocked cross-origin request to Next.js dev resource /_next/webpack-hmr from "<host>"`. Watch for this when mobile testing fails. Production builds aren't affected; this is dev-only.

#### PostgREST embedded-select `.eq()` filter on relation can fail unpredictably

PostgREST embedded select with `.eq()` filters on the embedded relation can return 500 errors depending on FK detection and RLS-policy interaction. Pattern like `.select('*, users!inner(...)').eq('users.active', true)` is fragile. Safer pattern: two-step query — first lookup gets IDs from the join table, second query loads the target table with all filters applied directly. First implemented in `/api/users/login-options` (Phase 2 Session 4). Pattern repeats wherever cross-table filtering meets RLS-protected tables.

#### Worktree filesystem isolation — commit per step or risk losing the working tree

Phase 2 Session 4 was lost mid-session when the worktree directory was partially wiped (likely a worktree management operation by a parallel process). All Session 4 work was uncommitted (lived only in working tree across 6 build steps), so it could not be recovered from git. The branch `claude/loving-yalow-cd1cdf` was unaffected (its only commit was the Session 3 close), but the working-tree changes vanished. Lesson locked: **commit after every step in long sessions**. Commit messages: `wip(s<session>-step-<N>): <description>`. Squash to a clean message at end before merging. The cost of an extra `git commit` per step is trivial; the cost of redoing 5 hours of work is not. Also: never assume an active dev server is preserving anything — Turbopack's `.next/` cache may keep serving stale compiled output even after source files are deleted, masking the loss until the next typecheck or rebuild.


#### Lockout countable-failure-reasons must include defensive `missing_*_hash` branches

A defensive guard branch in `/api/auth/{pin,password}` that fires when the user's hash field is null/empty must be a "countable" failure reason — same rate-limit semantics as wrong credentials, since both return 401 invalid_credentials to the attacker. If the defensive branch isn't countable, an attacker can spam an account in this unusual no-hash state without ever tripping lockout. Additionally, the route handler MUST check `result.locked` after `recordFailedAttempt` for the defensive branch and return 423 on the threshold-crossing attempt — otherwise the user sees a misleading 401 on attempt N (the lockout-triggering one) and 423 only on attempt N+1 (an off-by-one user-facing UX). Surfaced original Phase 2 Session 4 Step 2 visual review when Juan tested the lockout banner against his seed user (email_verified=true + password_hash=null, an unusual state from being directly bootstrapped without going through the verify flow). Fixed in `lib/auth-flows.ts` (countable set extended) + both `pin/route.ts` and `password/route.ts` (lock-check parity in defensive branches). Phase 2 Session 5 audit should regression-test this with both the wrong-credentials path AND the missing-hash path, since they're separate code branches.


#### Email templates use typography-only header as foundation default

Both verification and password-reset email templates use a typography-only header — Mustard band with "COMPLIMENTS ONLY" set in bold system-font ALL CAPS with tight letter-spacing (-0.02em) to evoke Midnight Sans's condensed feel. The image-based wordmark variant (co-wordmark.png) was dropped because Gmail blocks `http://localhost` image sources (anti-tracking) and image-proxying behavior varies across clients. Typography renders identically everywhere. The image variant returns to email as a refinement once the production domain is verified and HTTPS image serving is reliable across clients; the typographic header stays as the fallback either way. CTA button is Diet Coke fill, brand Red text, ALL CAPS, ≥48px tap target, 18px font, 36px horizontal padding — meets brand book "Red used most sparingly — only as CTA text" rule.

#### `NEXT_PUBLIC_APP_URL` is baked into email links at send time and must match the recipient's reachable URL

`NEXT_PUBLIC_APP_URL` is read by `lib/email-templates/_layout.ts` at email render time and concatenated into every CTA URL (`/verify?token=…`, `/reset-password?token=…`). Because emails are static once delivered, the URL value at send-time freezes into the link forever. **Local desktop-only dev:** `http://localhost:3000`. **Local + mobile-on-LAN testing:** `http://10.0.0.20:3000` — must match the dev server's LAN bind, not localhost (localhost only resolves to a dev server on the device running it; on a phone, localhost means the phone itself, which has no dev server). **Vercel preview:** the preview URL. **Production:** the production canonical domain (e.g., `https://complimentsonlysubs.com` once DNS lands). Phase 5+ deployment checklist must include this env var update in Vercel project settings (not just `.env.local`).

#### Resend default sender restricts deliverable recipients to the verified Resend account email

`EMAIL_FROM=onboarding@resend.dev` (Resend's default sender) is the foundation-phase choice. Domain verification of `complimentsonlysubs.com` is queued for Phase 5+ once Pete approves DNS configuration. Until domain verification, the default sender restricts deliverable recipients to the verified Resend account email only — i.e., `juan@complimentsonlysubs.com`. Any production email path that targets a non-Juan address will silently 422 from Resend's side. Foundation phase is single-user (Juan) by design, so this constraint is acceptable. When admin tools onboard real users in Phase 5+, the sender domain switch is a prerequisite — block any user-create flow that emails a non-Juan address until then.


#### `requireSessionFromHeaders` is the Server Component variant of session validation

`lib/session.ts` extracts a `requireSessionCore(rawJwt, ipAddress, userAgent, currentPath)` private helper that holds all dual-verification logic (sessions row + token_hash + revoked + idle + last_activity_at touch + step-up auto-clear). Two thin wrappers consume it: `requireSession(req, currentPath)` for route handlers (returns `AuthContext | NextResponse 401`) and `requireSessionFromHeaders(currentPath)` for Server Components (reads cookies+headers via `next/headers`, returns `AuthContext`, redirects to `/?next=<currentPath>` on denial). Server Components can't return a NextResponse, and the user-facing experience for an authenticated-page denial is "send me to login" — so the redirect-on-denial pattern is right. `redirect` is statically imported from `next/navigation` so TS sees its `never` return type and narrows the result type below the failure branch. `lib/session.ts` is Node-runtime only — `proxy.ts` is the edge layer and imports `verifyJwt` from `lib/auth.ts`, NOT from `lib/session.ts` — so `next/navigation` + `next/headers` static imports here are safe.

#### `/api/auth/heartbeat` intentionally writes no audit row

Heartbeat is a thin wrapper around `requireSession` whose only purpose is to extend the active session by touching `last_activity_at` (a side effect of `requireSession`). It writes NO audit row per call. Justification: every authenticated request in the system already touches `last_activity_at`, so adding an explicit audit row per heartbeat would generate 1 row every 30 seconds during the warning-modal period (or whatever cadence the IdleTimeoutWarning uses) — pure log noise without forensic value. Real session lifecycle events (sign-in, sign-out, token revocation, lockout) keep their audit rows. If heartbeat surfaces a session anomaly later (token_hash mismatch, deactivated user, revoked session), `requireSession`'s built-in audit fires inside the core path, not at the route layer.


#### `PasswordModal` and `PinConfirmModal` are unused scaffolds in foundation

`components/auth/PasswordModal.tsx` is a fully-built scaffold for Phase 5+ admin tools — when destructive actions need step-up auth confirmation, the parent admin surface mounts the modal with `open={true}` and `onConfirm={() => proceed()}`. Wired to POST `/api/auth/step-up`, response handling matches Session 3 lock (401 wrong password / 403 step_up_not_available / 423 defensive lockout banner / 401 unauthorized → onCancel). NO LOCKOUT on repeated step-up failures — the actor is already authenticated, so locking them out of admin doesn't meaningfully raise the bar. `components/auth/PinConfirmModal.tsx` is a fully-built scaffold for Phase 4 checklist confirmation flows. The route it depends on (`POST /api/auth/pin-confirm`) does NOT exist yet — the modal's submit handler is stubbed with a TODO surfacing the inline error "PIN confirmation not yet wired (Phase 4)." so the scaffold doesn't pretend to work. Phase 4 swaps the stub for a real fetch with the same response-handling pattern as PasswordModal. Both modals share IdleTimeoutWarning's overlay shell pattern (centered, dark backdrop, focus-trapped).

---

## Phase 2 — Session 5 (auth audit + Phase 2 closure, 2026-04-30)

### Durable-knowledge entries

#### Schema-level enforcement is the real defense for `pin_hash` non-null

The route handler's `missing_pin_hash` defensive branch in `/api/auth/pin/route.ts` is unreachable in production because `users.pin_hash` is `NOT NULL` at the schema level. Postgres returns sqlstate 23502 on any UPDATE that tries to clear it. The branch is retained as defense-in-depth against future migrations that might relax the constraint (e.g., if Phase 4+ introduces optional PIN-only roles). Future-Claude reading this branch should NOT remove it as dead code — its purpose is forward-looking. Discovered during Phase 2 Session 5 audit harness construction.

#### Supabase JS UPDATE swallows constraint-violation errors silently — must check `error` field

A `.update()` call that hits a NOT NULL or other constraint violation returns the error in the response object but does NOT throw. Calling code that only inspects `data` will see stale state without realizing the write failed. Pattern: every service-role write must explicitly check `if (error)` and surface the error. Discovered during Phase 2 Session 5 audit harness debugging when `resetSL` silently failed and produced ghost test failures. Phase 5+ admin user-management routes inherit this discipline.

#### `next build` is a separate gate from `next dev` and `tsc --noEmit`

Next.js 16 enforces static prerender constraints — specifically, client components reading `useSearchParams()` must be wrapped in `<Suspense>` boundaries — only at build time, not in dev mode. TypeScript checks pass independently. Note that `export const dynamic = "force-dynamic"` does NOT bypass this constraint; the CSR-bailout-with-Suspense protocol is enforced regardless of route segment config (the directive is read but the prerender pass still attempts to render the client subtree, which still requires Suspense). The fix is the standard Next.js Suspense wrapper pattern — refactor the page's default export into a thin wrapper that renders the existing component body inside `<Suspense fallback={...}>`. Phase 3+ pre-merge discipline must include `npm run build` clean as a hard gate, ideally as a CI check on PRs to main. The Session 5 audit harness drives API routes, not page renders, so it cannot catch this category of failure by design. Captured during Phase 2 production-deploy failure ~30 min after merge to main; resolved via Suspense wrappers on `app/page.tsx`, `app/verify/page.tsx`, and `app/reset-password/page.tsx` on hotfix branch `hotfix/phase-2-prerender`.

#### Vercel env var records can exist with empty values — `vercel env ls` only confirms the record, not the value

`vercel env ls` reports each variable as "Encrypted" with the environments it's bound to, but does not surface whether the stored value is empty. Records created with empty strings during initial scaffold show up identically to records carrying real secrets. Always verify with `vercel env pull --environment=production /tmp/some.env` and check field lengths (a `^NAME=$` line or a line with empty quoting indicates a zero-length value — silent failure at runtime). Phase 0 created all 10 critical records with empty values during the initial scaffold; Phase 2 was the first deployment to actually read them at runtime, surfacing as 500 errors on `/api/locations` (because `getServiceRoleClient()` throws on falsy `NEXT_PUBLIC_SUPABASE_URL`) and silent `audit()` failures on every authenticated request (the `audit()` helper catches and logs but never throws, by design). Pattern for Phase 3+ deployments: pull the env file, grep for any zero-length values, populate before declaring environment ready. Mark sensitive vars (auth secrets, peppers, service role keys, API keys) as Sensitive in the Vercel dashboard so values can't be exfiltrated post-save. After populating, redeploy without using existing build cache — `NEXT_PUBLIC_*` vars are inlined into the JavaScript bundle at build time and cached builds retain the empty-string values.

#### `NEXT_PUBLIC_APP_URL` differs between local dev and Vercel deployments

Local `.env.local` uses the LAN IP (`http://10.0.0.20:3000`) so phones on the same WiFi can reach the dev server during mobile testing — this was the chosen value during Phase 2 Session 4 onward. Vercel production needs the **canonical public production URL** (currently `https://co-ops-ashy.vercel.app` until a custom domain lands; eventually `https://complimentsonlysubs.com` once Pete approves DNS). Email links generated server-side via `lib/email-templates/_layout.ts` bake `NEXT_PUBLIC_APP_URL` at send time — using the LAN IP in production would generate links nobody outside the dev network can load. Vercel preview deployments would ideally use their own per-deploy URL but in practice can share the production canonical URL since previews are SSO-gated anyway and email-flow testing runs against dev. Phase 5+ deployment checklist must confirm Vercel production `NEXT_PUBLIC_APP_URL` matches the actual public-facing URL recipients will use to load the app, AND that the corresponding Resend sender domain is verified for that hostname before any non-Juan recipient is invited.

### Session 5 closing summary

Phase 2 Session 5 (auth audit + Phase 2 closure) is complete. Live as of this session: `docs/PHASE_2_AUTH_AUDIT.md` (5,968-word grey-box audit covering 8 threats, 40-case coverage matrix, RLS cross-layer integration evidence, 7 known-gap items, explicit "Phase 2 approved for merge" statement); `scripts/phase-2-audit-harness.ts` (regression harness — invocable via `npx tsx --env-file=.env.local scripts/phase-2-audit-harness.ts`, idempotent, fixture user_ids stable across runs, exits 0 on all-pass); `phase-2-audit-results.json` (40/40 passing across 10 functional groups: PIN sign-in, password sign-in, step-up, verify, password-reset-request, password-reset, logout, heartbeat, RLS cross-layer, session lifecycle); `scripts/phase-2-juan-dogfood-issue.ts` (one-shot operational tool that issued Juan's real verify token via Resend — Juan's `password_hash` is now real, `email_verified_at` set by the verify flow itself, sign-in regression confirmed end-to-end with double-cycle testing). Token cleanup applied pre- and post-dogfood (zero active synthetic tokens at close). Branch tag `phase-2-complete` applied at merge. Post-merge production-deploy saga lasted ~90 minutes and surfaced three operational lessons captured above as durable knowledge — (a) Suspense wrappers on the three `useSearchParams()` pages via hotfix `hotfix/phase-2-prerender`, (b) all 10 Vercel env-var records existed with empty values from Phase 0 scaffold and required manual dashboard population (Juan-side, no values through Claude), (c) `NEXT_PUBLIC_APP_URL` mismatch between LAN-IP local-dev value and the canonical production URL needed for Vercel. Production verified live at `https://co-ops-ashy.vercel.app` end-to-end on phone: location tiles, brand chrome, manager login flow, sign-in to dashboard. Phase 2 closes; Phase 3 opens against `main` with auth, RLS, and the foundation libraries fully proven AND deploying cleanly to production.

---

## Phase 2.5 — temp user provisioning (Pete + Cristian, 2026-04-30)

### Durable-knowledge entries

#### Threshold-at-≥7 separates company-level from operational roles

`lib/locations.ts` `ALL_LOCATIONS_THRESHOLD = 7` and the matching `current_user_role_level() >= 7` clause in 20+ location-scoped RLS policies establish that levels 7+ (Owner, CGS) sit above location authority and get all-locations override at both app and DB layers. Levels below 7 (MoO 6.5, GM 6, Shift Lead 4, etc.) sit at location authority and get access through `user_locations` join rows. This means MoO is location-scoped despite being "operationally unscoped" in CO's org model — Cristian gets explicit `user_locations` rows at provision time. The architecture supports clean growth: future "all-operations" roles created at level 7+ get the override automatically; future role-scoping changes (regional MoO splits) work via `user_locations` without code change. The threshold is load-bearing in RLS, not just app-layer code — lifting it would touch 1 line in `lib/locations.ts` plus 20+ RLS policies plus a Phase 1 audit re-run, so it's not a one-line change. Captured during Phase 2.5 temp user provisioning when the MoO threshold question first surfaced; Phase 3 housekeeping will decide whether to lift the threshold to ≥6.5 or keep MoO permanently per-location-scoped.

#### Service-role direct insert is the foundation-phase user-creation pattern when Resend can't deliver

Phase 2.5 provisioned Pete and Cristian via `scripts/phase-2.5-provision-temp-users.ts` because the proper invite/verify flow can't deliver to non-Juan recipients yet (`EMAIL_FROM=onboarding@resend.dev` only delivers to the verified Resend account email). The pattern: hash plaintext password via `lib/auth.ts` `hashPassword()` (passed in via env var, never written to disk), insert with `email_verified=true` + `email_verified_at=now()`, satisfy the `pin_hash` NOT NULL constraint with a placeholder `hashPin('0000')`, write a `user.create` audit row with `metadata.phase = "2.5_temp_provisioning"` and `metadata.creation_method = "service_role_direct_insert"`, communicate plaintext credentials out-of-band. The audit metadata is the discriminator that lets Phase 5+ tooling distinguish bridge-pattern rows from canonical-flow rows: filter on `metadata->>'creation_method' != 'service_role_direct_insert'`. Bridge accounts are scrubbed in Phase 5+ via `active=false` (append-only philosophy preserves the user_id forensically) plus a fresh canonical-flow account whose creation metadata references the old user_id under `supersedes_bridge_user_id`. See `docs/PHASE_2.5_TEMP_USERS.md` for the full scrub procedure. This pattern should NOT be reused for arbitrary user creation once Resend domain verification lands and the proper admin tooling ships — the canonical invite/verify flow is the right path.

#### Audit action for user creation is `user.create` (canonical, dot-namespaced)

The locked vocabulary in `lib/destructive-actions.ts` uses dot-namespaced action codes for resource lifecycle (`user.create`, `user.deactivate`, `user.promote`, `vendor.create`, `location.create`, etc.) and `user.create` is on the destructive list, so `lib/audit.ts` `audit()` auto-derives `destructive=true`. The `auth_*` namespace from Phase 2 Session 3 is for auth-event audit (sign-in success/failure, lockout, token consumption, session anomalies); `user.create` is for lifecycle audit. Phase 5+ admin invite/verify flows MUST use `user.create` as the canonical action — bridge nature, source of creation, role assignment, and other context belong in `metadata`, not in a separate action namespace. A separate `user_provisioned` action was considered for the Phase 2.5 bridge case and rejected because it would have introduced a one-off namespace that breaks the established convention and would have required manual addition to `DESTRUCTIVE_ACTIONS`. Pattern locked: lifecycle = dot-namespaced verb on the resource; auth = `auth_*` flat-namespaced.

#### Always lowercase email at insert time — login routes lowercase before lookup

`/api/auth/password` and similar routes call `.toLowerCase()` on the input email before issuing the DB lookup. `users.email` is case-sensitive `text` with a case-sensitive unique constraint, so a record stored with mixed case will never be found by lookup. The failure surfaces as `auth_signin_password_failure` with `metadata.reason = "email_not_found"`. **Critically: `email_not_found` is NOT in `COUNTABLE_FAILURE_REASONS` in `lib/auth-flows.ts`, so failed attempts do not increment `failed_login_count` and never trigger lockout** — the user just sees "wrong credentials" forever with no diagnostic visibility from the user's side. Diagnosis requires reading `audit_log.metadata.reason` directly. Pattern: every insert path that puts an email into `users.email` (provisioning script, admin user-create flow, verify-flow user record creation, any future bulk-import) MUST `.toLowerCase()` the email before insert, ideally as the first line of the insert function so it can't be forgotten in a callsite. Phase 5+ admin user-management routes inherit this discipline as a hard requirement; code review for new write paths should specifically check for the lowercase normalization. Discovered during Phase 2.5 temp user provisioning when Pete and Cristian couldn't sign in despite correct passwords — the spec table used title-case (`Pete@…`, `Cristian@…`) and the script preserved that casing literally instead of normalizing. Fixed via in-place `UPDATE users SET email = LOWER(email)` plus two `user.change_email` audit rows; provisioning script patched to lowercase the email at function entry.

---

## Phase 3 — housekeeping (CI build gate, 2026-05-01)

### Durable-knowledge entries

#### CI build gate on PRs to main is the canonical pre-merge regression check

GitHub Actions workflow `.github/workflows/build.yml` runs `npm run build` on every `pull_request` to main and every `push` to main; branch protection on `main` requires the `build` status check to pass before merging. This catches the class of bug that passes `next dev` and `tsc --noEmit` but fails at Vercel's static export step — the canonical case being Next 16's static prerender constraint that `useSearchParams()` must be wrapped in a `<Suspense>` boundary, which broke the Phase 2 production deploy ~30 minutes after merge to main and required `hotfix/phase-2-prerender`. Phase 3+ discipline: any code change that affects build behavior must pass the CI gate before merging. The audit harness (Phase 2 Session 5 — `scripts/phase-2-audit-harness.ts`) remains a manual pre-merge regression check for auth-layer changes — it requires a running dev server + Supabase service-role access and isn't a fit for standard GitHub Actions runners. Established as Phase 3 first housekeeping item after the Phase 2 production deploy saga taught us dev-mode + typecheck pass ≠ production-deployable.

**Workflow shape (locked).** Single job `build` on `ubuntu-latest`, `timeout-minutes: 15`, `concurrency.cancel-in-progress: true` (group keyed on workflow + ref so superseded runs on the same PR get canceled). Steps: `actions/checkout@v4`, `actions/setup-node@v4` with `node-version-file: .nvmrc` (NOT a hardcoded version — `.nvmrc` keeps CI pinned to whatever Vercel runs via `package.json` `engines`, currently 22.20.0) and `cache: npm`, `npm ci`, `npm run build`. No env vars passed — the build doesn't need real Supabase/Resend secrets at compile time, and the Phase 2 production-deploy saga's `NEXT_PUBLIC_*` empty-value issue is a runtime problem, not a build-time one. If a future change introduces build-time env-var dependencies (e.g., a `next.config.ts` that reads `NEXT_PUBLIC_*` at build), that's the moment to add dummy `env:` entries to the workflow — but resist the urge preemptively, because secrets in CI logs are a real attack surface. **Action versions:** `actions/checkout@v4` and `actions/setup-node@v4` use Node.js 20 internally; GitHub forces Node.js 24 by default starting June 2, 2026, with Node.js 20 removed from runners September 16, 2026. Bump to `@v5` when those releases land (or set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` in the workflow `env` block as a stop-gap). Currently soft-deprecated, not failing — `/schedule` candidate for late May / early June 2026.

**Branch protection (locked).** Configured via `gh api -X PUT repos/Juan-CO-dev/co-ops/branches/main/protection`: `required_status_checks.strict: true` ("require branches to be up to date before merging" — forces a rebase or merge of main into the PR branch before the gate is honored, so you don't merge a PR that was green against an older main), `required_status_checks.contexts: ["build"]` with `app_id: 15368` (GitHub Actions, locks the check to that app so a same-named status from a different source can't satisfy it), `enforce_admins: false` (admin bypass is intentionally enabled — emergency hotfixes have an escape hatch, the Phase 2 prerender hotfix is the kind of case this exists for; revisit when Phase 5+ adds team access and admin-token leak becomes a real attack surface), `required_pull_request_reviews: null` (no review gate — solo-dev right now, requiring reviews would block Juan from merging his own PRs), `restrictions: null` (no push restrictions), `allow_force_pushes: false`, `allow_deletions: false`, `required_linear_history: false`, `required_conversation_resolution: false`. The protection settings live in GitHub, not in the repo — to inspect or modify, use `gh api repos/Juan-CO-dev/co-ops/branches/main/protection` (GET to read, PUT with a JSON body to update). When Phase 5+ adds team access, audit this entire block: required reviewers, restricted push, possibly `enforce_admins: true` once admin token discipline is established.

**Gate verified end-to-end.** Junk PR (`ci-test/junk-pr-suspense` → closed without merge, branch deleted) intentionally removed the Suspense wrapper around `app/verify/page.tsx` and confirmed: build job FAILED in 31s with `useSearchParams() should be wrapped in a suspense boundary at page "/verify"` (the exact Phase 2 saga error), `mergeStateStatus: BLOCKED`, merge button disabled. Clean PR (`ci-test/clean-pr-noop` → closed without merge, branch deleted) made a two-word comment edit to `.gitignore` and confirmed: build job SUCCEEDED in 30s, `mergeStateStatus: CLEAN`, merge button enabled. Both tests are reproducible by anyone with `gh` access — the procedure is documented in this entry; if you ever need to re-validate the gate (e.g., after editing `build.yml` or rotating GitHub Actions versions), repeat the junk + clean cycle. Don't merge the test PRs — close-without-merge keeps `main` history clean.

**Operational gotchas surfaced during setup.** (a) `gh pr close --delete-branch` fails with `'main' is already used by worktree at <path>` when the local clone has the parent repo's `main` checked out alongside a worktree branch; workaround is `gh pr close <num>` followed by manual `git push origin --delete <branch>`. Worktree-aware tooling discipline applies to any future PR-housekeeping flow. (b) The status check name as configured in branch protection is the **job name** (lowercase `build`), not the workflow display name (`Build`). Confirmed by querying `repos/{owner}/{repo}/commits/{sha}/check-runs` after the first run on main — `name: build`, `app: github-actions`. If the job is ever renamed in `build.yml`, branch protection must be updated in the same PR or every subsequent PR will be unmergeable until the protection is re-pointed. (c) Vercel's "Vercel Preview Comments" check appears alongside the `build` check on PRs but is NOT in the required-status-checks list — it's informational, not gating. If Vercel ever surfaces a check we DO want to gate on (e.g., a deploy success check), add it to `required_status_checks.contexts` via the same PUT.

#### Squash-merged PRs from a long-lived branch require rebase-onto-main between PRs

When `main` accumulates squash-commits from a series of PRs while the local branch still has the original (non-squash) commits, the next PR off the same branch sees conflicts on files touched by both. The squash-merge replaces all the PR's individual commits with one new commit on main; the local branch still has the originals. When new work is added on top and pushed, GitHub sees the local branch as having the originals + new commits, none of which are on main, while main has the squash-equivalent — and the file-level overlap surfaces as `mergeStateStatus: DIRTY` / `mergeable: CONFLICTING` even though the actual file contents at each old revision match the squash commit byte-for-byte. The fix: between PRs from the same branch, run `git fetch origin main && git reset --hard origin/main` before starting the next step's work (working tree must be clean first). Cherry-pick any uncommitted-but-needed work onto the fresh base. This applies to multi-PR build sequences (e.g., Module #1 Build #1 steps 4–7 each shipping as separate PRs on the same `claude/<name>` branch). Captured during Phase 3 Module #1 Build #1 step 6 when PR #10 came up `CONFLICTING` and required a rebase-and-force-push to clear; the PR was rescued by `git reset --hard origin/main && git cherry-pick <step-6-commits> && git push --force-with-lease`. Force-push to a feature branch is fine in this scenario — no other contributors, branch protection on `main` doesn't apply to feature branches.

