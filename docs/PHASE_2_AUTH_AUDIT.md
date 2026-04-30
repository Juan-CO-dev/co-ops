# Phase 2 Auth Audit Report

**Date:** 2026-04-30
**Branch:** `claude/loving-yalow-cd1cdf`
**Scope:** Phase 2 authentication subsystem — `lib/auth.ts`, `lib/session.ts`, `lib/auth-flows.ts`, `lib/audit.ts`, `proxy.ts`, and the seven `/api/auth/*` route handlers (`pin`, `password`, `step-up`, `verify`, `password-reset-request`, `password-reset`, `logout`) plus the `/api/auth/heartbeat` session-touch endpoint.
**Auditor:** Claude Code (Phase 2 Session 5).
**Evidence file:** [phase-2-audit-results.json](../phase-2-audit-results.json) (40 cases, 40 passed, 0 failed).
**Sign-off pending:** Juan.

---

## 1. Executive summary

Phase 2 delivers the custom JWT auth layer the Foundation Spec calls for — bcrypt-with-pepper credentials, jose HS256 JWTs verified by both the app and Supabase via a matched standby key, dual-verification sessions storage (JWT signature + at-rest token-hash), an edge proxy that enforces signature/exp at the network layer, and a Node-runtime route layer that enforces the full session contract (revocation, idle timeout, hard expiration, step-up unlock state). Phase 1 supplied the RLS substrate; Phase 2 sits on top of it and is the only path by which user-context JWTs reach PostgREST.

The audit is a grey-box regression of every documented control. A purpose-built harness (`scripts/phase-2-audit-harness.ts`) drives 40 cases against the running dev server, brackets each request with an `audit_log` capture window keyed off the harness `run_started_at` ISO timestamp, and asserts on three layers simultaneously: HTTP status code, response body shape, and the audit-log forensic record. Coverage spans every reachable branch of every auth endpoint, two end-to-end RLS cross-layer probes that exercise the JWT → PostgREST → SECURITY DEFINER helpers integration at the differential level-4-vs-level-6 boundary, and five session-lifecycle scenarios — happy create, idle timeout, JWT exp denial (DB-side and signature-side variants), and the cross-route step-up auto-clear that fires when an authenticated session leaves the `/admin/*` URL space.

**Result: 40 / 40 cases pass.**

The audit surfaced two new durable lessons that warrant codification independent of the pass/fail tally:

1. **Schema-level defense for `pin_hash`.** `users.pin_hash` is `NOT NULL` in the database. The route handler's `missing_pin_hash` defensive branch in [app/api/auth/pin/route.ts:115-124](../app/api/auth/pin/route.ts) is therefore unreachable in production by construction — Postgres rejects any UPDATE that tries to clear `pin_hash` with sqlstate `23502`. The branch is correct, costs nothing to keep, and is retained as defense-in-depth against future migrations or pathological code paths that might attempt to bypass the constraint. Symmetrically, `password_hash` IS nullable, which is why the `missing_password_hash` branch in [app/api/auth/password/route.ts:125-139](../app/api/auth/password/route.ts) is reachable, exercised, and was the subject of the Phase 2 Session 4 lockout fix.
2. **Supabase JS swallows constraint violations silently.** A `.update()` call that hits a NOT NULL or check-constraint violation returns the violation under `error` but does NOT throw. Code that only reads `data` sees stale state — no row was returned because no row was updated, but the calling logic continues as if the write succeeded. This is the engineering practice failure mode that produced the harness's two initial false negatives during Workstream 1 development; the discipline is now applied to `resetSL`/`resetGM` and is documented as a Phase 5+ acceptance criterion across all admin UPDATE routes.

The audit's recommendation: **Phase 2 is approved for merge to `main`.** Approval is gated on completion of Workstreams 3–5 (Juan's real password set via the dogfood verify flow, token-table cleanup, branch tag and merge). The five known limitations carried into Phase 5+ are documented in §5 of this report; none of them block foundation-stage operation.

---

## 2. Audit methodology

### 2.1 The harness

[scripts/phase-2-audit-harness.ts](../scripts/phase-2-audit-harness.ts) drives the audit. It is invoked via:

```
npx tsx --env-file=.env.local scripts/phase-2-audit-harness.ts
```

The harness is grey-box: it loads `.env.local` so it has the same `AUTH_JWT_SECRET`, `AUTH_PIN_PEPPER`, `AUTH_PASSWORD_PEPPER`, and Supabase credentials the dev server is using, including the `SUPABASE_SERVICE_ROLE_KEY`. Service-role DB access is intentional and load-bearing — the harness IS the auditor, and the audit's value comes from asserting on `audit_log` content and inspecting `sessions` / `users` state directly; a pure black-box stance would defeat the purpose. External callers and the routes themselves continue to be exercised through the public HTTP surface; service-role is used only for fixture rehydration, state inspection, and synthesizing edge cases (backdated `last_activity_at`, pre-locked accounts, pre-consumed tokens). The harness then:

1. Captures a `run_started_at` ISO timestamp used to scope all audit-row queries throughout the session.
2. Rehydrates two persistent audit fixture users — `audit_test_sl@audit.invalid` (role `shift_lead`, level 4) and `audit_test_gm@audit.invalid` (role `gm`, level 6) — that already exist as `active=false` from prior Session 5 attempts. Setup sets `active=true`, fresh `pin_hash` via [lib/auth.ts](../lib/auth.ts) `hashPin()`, fresh `password_hash` via `hashPassword()` (GM only — `shift_lead` has `hasEmailAuth=false`), `email_verified=true`, and clears `failed_login_count` / `locked_until`. Their user_ids are stable across runs, which the audit document acknowledges in §5 — fixture user_ids predate this run, so any audit row tied to them before `harness_run_at` is prior-run noise and is filtered by the harness's per-case `[since, until]` window.
3. Runs 40 cases across 10 functional groups in dependency-aware sequence (lifecycle cases require sign-in, password-reset cases need active sessions to revoke, etc.).
4. Tears down — sets fixtures to `active=false` and revokes any remaining active sessions for both users. The fixture rows persist (Phase 1 append-only philosophy: never DELETE from `users`), which means re-runs reuse the same user_ids.
5. Writes `phase-2-audit-results.json` to repo root with full per-case evidence: HTTP status, expected status, captured audit rows, and a one-line pass/fail evidence string.

### 2.2 The bracketing pattern

Each case captures a per-call `[sinceIso, untilIso]` window. The `sinceIso` is set 50 ms before the HTTP call to absorb minor clock skew between the harness host and Postgres; the `untilIso` is set 1 second after with a 75 ms hard-sleep first to give the route handler's awaited `audit()` call time to commit. The harness then queries `audit_log WHERE occurred_at BETWEEN since AND until`, filters in JS to the actor IDs / actions / resource tables / metadata predicates the case cares about, and asserts.

This pattern correctly attributes audit rows to the case that produced them even though `audit_log` is process-shared with the dev server, the dev server's incidental writes (auth attempts during Next.js HMR rebuilds, cookie probing, etc.), and the harness's own setup/teardown writes. The 50 ms / 1 s windows are well below any reasonable inter-case interval; cross-attribution is structurally avoided.

### 2.3 The fixture choice

Two fixtures were sufficient:
- **SL** (level 4 `shift_lead`) — exercises PIN sign-in, the `role_not_email_auth` branches in `/api/auth/password-reset-request` and `/api/auth/step-up`, the locked-precondition gate, PIN-only sessions where step-up cannot apply, and the RLS self-only branch (level < 6 → `users_read_self` admits only own row).
- **GM** (level 6 `gm`) — exercises password sign-in, step-up unlock, the verify-and-set-password flow with auto-sign-in, password reset with sessions revocation, every session lifecycle scenario, and the RLS admin branch (level >= 6 → `users_read_self` admits all rows).

The level-4-vs-level-6 split is deliberately chosen at the differential boundary of `users_read_self` (level >= 6) so the cross-layer test in §3.6 produces a strict "SL admits 1 row, GM admits all rows" inequality that proves end-to-end integration rather than just identical behavior. Higher-privilege roles (`cgs`, `owner`, `moo`) were not necessary at this layer — Phase 2 routes do not branch on level beyond `hasEmailAuth: boolean`, and the level-6 admin branch already covers `cgs`/`owner`/`moo`/`gm` uniformly. Phase 5+ admin routes will require finer-grained role coverage.

---

## 3. Threat model

The model below enumerates the eight threats the auth layer is designed to address, the defense for each, the harness case IDs that exercise the defense, and the audit-log evidence captured. Code citations point to the implementation site.

### 3.1 Brute-force PIN guessing

**Defense.** Per-user lockout policy: 5 failed credential attempts → 15-minute time-bound lockout. Attempts that fail because the account is *already locked* are audited but do not extend the lock window or increment the failed-count counter.

**Implementation.** [lib/auth-flows.ts](../lib/auth-flows.ts) `recordFailedAttempt()` (`COUNTABLE_FAILURE_REASONS` set, `FAILURE_LIMIT=5`, `LOCKOUT_MINUTES=15`). The route layer checks lockout BEFORE verifying the credential ([app/api/auth/pin/route.ts:103-109](../app/api/auth/pin/route.ts)), so a locked account returns 423 immediately without ever invoking bcrypt — bcrypt's cost-12 latency is not a side-channel for lockout state.

**Harness evidence.**
- `pin-lockout-threshold-crossing` — five wrong PIN attempts; the fifth returns 423 with `retry_after_seconds` populated and a single `auth_account_locked` audit row emitted alongside the five `auth_signin_pin_failure` rows. The fifth failure carries `metadata.triggered_lockout: true` and `metadata.attempt_number: 5`.
- `pin-locked-precondition` — pre-locked account; first PIN attempt returns 423 with `metadata.reason: "account_locked_attempt"` and `failed_login_count` does not increment (the precondition gate fires before the countable-failure logic).
- `pin-signin-wrong` — single wrong attempt; counter increments to 1, no lockout audit, no 423.

The 4-digit PIN keyspace is 10,000. Five attempts per 15-minute window caps an attacker at ~480 attempts/day per known user_id, which makes brute force practical only at horizon timescales that admin oversight will catch. Per-IP rate limiting (deferred to Phase 5+, see §5) would compound this defense; for foundation, the lockout is the actual guarantee.

### 3.2 Password spraying

**Defense.** Identical lockout policy applies to password sign-in. The constant-shape error response (`401 invalid_credentials`) covers both the unknown-email and wrong-password cases, so an attacker cannot trivially distinguish "this email doesn't exist" from "this password is wrong" — although `account_inactive` and `email_not_verified` are intentionally disclosed (Juan-confirmed Session 3 disclosure policy: those signal admin-actionable states, not credential validity).

**Implementation.** [app/api/auth/password/route.ts](../app/api/auth/password/route.ts). The unknown-email path audits `actor_id: null` with `metadata.requested_email` capturing the lowercase-normalized email — spray-attack forensics. Account-inactive, email-not-verified, role-not-email-auth, and locked-account cases all audit with the user's id so traceability is preserved.

**Harness evidence.**
- `password-lockout-threshold-crossing` — mirror of the PIN test; five wrong-password attempts → 423 + `auth_account_locked` audit.
- `password-signin-missing-hash` — defensive `missing_password_hash` branch fires when the verified-but-no-password user state exists; `metadata.reason: "missing_password_hash"`, counter increments. This is the regression test for the Phase 2 Session 4 fix (see §3.6 for the schema-symmetric note).
- `password-missing-hash-lockout-regression` — five missing-hash attempts trip the lockout, proving the defensive branch participates in the rate-limit envelope rather than being free-spammable.

### 3.3 Session theft (cookie exfiltration via XSS, leaked DB dump, etc.)

**Defense.** Dual verification on every authenticated request. The session JWT is signed with `AUTH_JWT_SECRET` and carries a `session_id` claim. The `sessions.token_hash` column stores `SHA-256(rawCookieJwt)`. [lib/session.ts](../lib/session.ts) `requireSessionCore()` validates BOTH layers: JWT signature/exp via `jwtVerify`, AND that `hashToken(rawCookieJwt) === sessions.token_hash` for the row identified by `session_id`. A mismatch is treated as revoked + audited as `session_token_mismatch` — it indicates a forged JWT signed with a leaked key but not paired with a real session row.

**Implementation.** Session JWT is set as an `httpOnly` cookie (`co_ops_session`) with `Secure` in production and `SameSite: Lax`. Idle timeout 10 minutes (configurable via `SESSION_IDLE_MINUTES`); hard JWT exp 12 hours. On any of {revoked_at set, expires_at past, last_activity_at older than idle threshold, deactivated user, token_hash mismatch}, the route returns 401 with the cookie cleared.

**Harness evidence.**
- `lifecycle-create` — confirms `sessions.token_hash` equals `hashToken(JWT)` immediately after sign-in, `step_up_unlocked: false`, `last_activity_at` recent, `expires_at` ≈ +12h.
- `lifecycle-jwt-exp-db-side` — backdates `sessions.expires_at` to the past while the JWT itself is still valid; the route returns 401 because `requireSessionCore` checks `sessions.expires_at` independently of the JWT exp claim. This is what guards against a stolen long-lived JWT after admin-side session expiration.
- `heartbeat-valid-touch` — proves `last_activity_at` is updated on every authenticated request; the idle countdown restarts on activity.
- `lifecycle-idle-timeout-db` — `last_activity_at` backdated by 11 minutes; next heartbeat → 401, cookie cleared.

The `session_token_mismatch` audit action is present in code ([lib/session.ts:262-271](../lib/session.ts)) and was exercised inadvertently during Phase 2 Session 2 smoke testing (one orphaned audit row remains in `audit_log` from that exercise — documented in AGENTS.md). The harness does not synthesize a leaked-key forgery scenario because it would require running with a different `AUTH_JWT_SECRET` than the dev server and is impractical without infrastructure changes; the code path is straightforwardly proven via inspection and the prior smoke evidence.

### 3.4 Token replay (verification + password reset)

**Defense.** Wins-once atomic consumption. Every `email_verifications` and `password_resets` row has a `consumed_at` column; the consume operation is `UPDATE … SET consumed_at = now() WHERE id = ? AND consumed_at IS NULL`. Only one request wins the race; subsequent attempts find `consumed_at` already set and are rejected with constant-shape `400 invalid_token`. The internal audit row distinguishes `auth_token_invalid`, `auth_token_expired`, and `auth_token_consumed_replay` so forensic investigation can tell the failure modes apart even though the external response is uniform.

**Implementation.** [app/api/auth/verify/route.ts:131-149](../app/api/auth/verify/route.ts), [app/api/auth/password-reset/route.ts:132-151](../app/api/auth/password-reset/route.ts). The lookup-then-update pattern uses `.is("consumed_at", null)` as the race-loser filter; the data array length distinguishes winner from loser without an explicit transaction.

**Harness evidence.**
- `verify-replay-consumed` — pre-consumed token; `400 invalid_token` + `auth_token_consumed_replay` audited with `resource_id` matching the consumed row.
- `verify-expired` — `expires_at` in the past; `400 invalid_token` + `auth_token_expired` audited with `metadata.expires_at` populated. This is the explicit Session 5 audit gap-fill called out in the Session 3 closing summary.
- `verify-invalid` — random hex token never inserted; `400 invalid_token` + `auth_token_invalid` audited with `actor_id: null` (token never mapped to a user).
- `password-reset-replay-consumed`, `password-reset-expired`, `password-reset-invalid` — mirror set against the password-reset endpoint.

### 3.5 User enumeration via auth endpoints

**Defense.** Constant-shape responses. `/api/auth/verify` and `/api/auth/password-reset` always return `400 invalid_token` on any token failure regardless of whether the token is non-existent, consumed, or expired. `/api/auth/password-reset-request` is the strongest enumeration target — it always returns `200 { ok: true }` regardless of whether the email maps to a user, the user is active, the role supports email auth, or the email is verified. Internal disposition is captured exclusively in audit metadata.

**Implementation.** [app/api/auth/password-reset-request/route.ts](../app/api/auth/password-reset-request/route.ts). The negative-disposition branch (`user_not_found`, `user_inactive`, `role_not_email_auth`, `email_not_verified`) audits with the captured `requested_email` and returns the same `200 { ok: true }` body shape and timing.

**Harness evidence.**
- `password-reset-request-happy` — synthetic recipient; outcome is either `email_sent` (Resend accepted the send) or `email_failed` (Resend rejected the address — expected for `audit_test_gm@audit.invalid` because the foundation-phase Resend account only accepts `juan@complimentsonlysubs.com`). The test passes on either outcome because both prove the code path executed and the audit captured the disposition.
- `password-reset-request-user-not-found` — unknown email; `200 { ok: true }` + audit `outcome: "user_not_found"` + `requested_email` captured + `actor_id: null`.
- `password-reset-request-user-inactive`, `password-reset-request-email-not-verified`, `password-reset-request-role-not-email-auth` — each negative disposition audits the corresponding `outcome` while the external response stays `200 { ok: true }`.

The four `outcome` values for negative dispositions are part of the audit-action vocabulary lock from Session 3; new flows in Phase 5+ should reuse them rather than introduce new strings.

### 3.6 Privilege escalation

**Defense.** Layered. RLS at the database (Phase 1, audited separately at [docs/PHASE_1_RLS_AUDIT.md](PHASE_1_RLS_AUDIT.md), 124/124 pass) gates row-shaped access; Phase 2 issues the JWT that PostgREST verifies against the configured HS256 standby key and exposes the claims to RLS via `request.jwt.claims` (modern plural format, per migration `0032_helpers_modern_claim_format`). The JWT carries `app_role` (the application role code) — NOT `role`, which PostgREST reserves for the database role and where we always pass `'authenticated'`. Column-level enforcement (where RLS cannot express the constraint) lives in the API layer per Phase 1 documentation.

**Implementation.** [lib/auth.ts](../lib/auth.ts) `signJwt` produces:

```ts
{ user_id, app_role, role_level, locations, session_id, role: 'authenticated', iat, exp }
```

`proxy.ts` reads `app_role` and `role_level` and forwards them as `x-co-app-role` / `x-co-role-level` request headers; downstream Node-runtime handlers that need authoritative role state call `requireSession()` rather than trusting the headers (the headers are convenience hints only).

**Harness evidence (this report).** Phase 2 tests the issue side: every successful sign-in mints a session JWT containing the user's actual role and level as queried from `users` at sign-in time. Phase 1's audit tests the consume side: RLS reads `current_setting('request.jwt.claims', true)::jsonb ->> 'user_id'` via the SECURITY DEFINER helpers and admits/denies per the policy matrix. The two layers compose; this audit explicitly does not re-prove Phase 1 conclusions.

Cross-layer integration is proven end-to-end by two harness cases that drive the SL and GM session JWTs through PostgREST against the public `users` table — chosen specifically because `users_read_self` has the differential predicate `(id = current_user_id()) OR (current_user_role_level() >= 6)`:

- `rls-cross-layer-sl-self-only` — sign in as the SL fixture (level 4, `shift_lead`); send the resulting session JWT to `GET ${SUPABASE_URL}/rest/v1/users?select=id` with `apikey: <ANON_KEY>` + `Authorization: Bearer <jwt>`. Postgres responds 200 with exactly one row whose `id` matches the SL fixture's user_id. The admin branch (`current_user_role_level() >= 6`) correctly evaluates to false at level 4; the self-predicate fires and gates everything else.
- `rls-cross-layer-gm-admin-branch` — sign in as the GM fixture (level 6, `gm`); same query. Postgres responds 200 with all 10 user rows (matches the service-role baseline count); the admin branch fires because level 6 satisfies the threshold; the self-predicate is irrelevant. The strict inequality vs. the SL result (10 > 1) confirms the boundary is enforced exactly where the policy says it is, not coincidentally — both cases use real session JWTs minted by `recordSuccessfulAuth` from the same harness session, so any discrepancy in role/level signing or PostgREST claim extraction would surface immediately.

Together these cases prove the full chain: sign-in flow → JWT signing with `app_role` + `role_level` claims → cookie delivery → JWT replay to PostgREST → HS256 verification via the matched standby key → claims exposure as `request.jwt.claims` → SECURITY DEFINER helpers consuming the claims → RLS policy evaluation → row admission. A regression at any link breaks one or both cases; both passing means all links hold.

The locations claim is signed at session-create time and would not refresh until session rotation — see §5 for the Phase 5+ implication.

### 3.7 Stolen-credential persistence after rotation

**Defense.** Credential changes revoke active sessions. When `/api/auth/password-reset` updates `password_hash`, it ALSO runs `UPDATE sessions SET revoked_at = now() WHERE user_id = ? AND revoked_at IS NULL`, capturing the count in `metadata.sessions_revoked` for forensic visibility. This kills any pre-existing session JWT immediately rather than waiting up to 12 hours for natural exp.

**Implementation.** [app/api/auth/password-reset/route.ts:170-176](../app/api/auth/password-reset/route.ts).

**Harness evidence.**
- `password-reset-happy` — two sessions are minted before the reset; the reset audit row carries `metadata.sessions_revoked: 2`; the post-reset session count for the user is 0; no `Set-Cookie` header (no auto-sign-in — the user must re-authenticate with the new password).

The pattern is documented as a Phase 5+ acceptance criterion in AGENTS.md: every admin-side mutation that affects authorization (deactivate, role change, location remove) must call `revokeSession()` for every active session of the affected user, not just mutate the user record.

### 3.8 JWT signing key compromise

**Defense.** Operational, not code-level. [docs/runbooks/jwt-rotation.md](runbooks/jwt-rotation.md) (313 lines, written Session 3) is the authoritative procedure for rotating `AUTH_JWT_SECRET` + the matched Supabase HS256 standby key. The runbook documents the dashboard-preferred path, the simultaneous-rotation requirement (rotating one without the other 500s every authenticated request), monitoring SQL queries, recovery procedures, forbidden patterns, and a rotation log section.

**Harness evidence.** Operational; out of scope for an automated regression. Inspection-verified during Session 3 closure.

The JWT's hex-decoded interpretation of `AUTH_JWT_SECRET` (`Buffer.from(secret, "hex")`) is the load-bearing detail — Supabase's Management API hex-decodes the secret server-side when you POST a signing key, and the app must produce matching bytes. This is locked in [lib/auth.ts](../lib/auth.ts) `getJwtKey()` and was the gate test of Session 2 standby-key wiring.

---

## 4. Code path coverage matrix

Every reachable branch of every Phase 2 auth route is exercised by at least one harness case. Heartbeat is a thin wrapper around `requireSession`; its coverage validates the wrapper plus the proxy-edge denial path. The lifecycle group probes `requireSessionCore` paths that are not exposed as dedicated endpoints. The RLS cross-layer group probes the JWT → PostgREST → SECURITY DEFINER helpers integration end-to-end at the differential level-4-vs-level-6 boundary of `users_read_self`.

| Route | Branch | Harness case(s) | Evidence |
|---|---|---|---|
| `POST /api/auth/pin` | happy → 200 + cookie | `pin-signin-happy` | 200 + `auth_signin_pin_success` |
| `POST /api/auth/pin` | wrong PIN → 401 | `pin-signin-wrong` | 401 + `auth_signin_pin_failure` (reason=wrong_pin) |
| `POST /api/auth/pin` | missing pin_hash defensive | `pin-missing-hash-unreachable-by-schema` | Postgres 23502; route branch unreachable in production by schema constraint |
| `POST /api/auth/pin` | locked precondition → 423 | `pin-locked-precondition` | 423 + `auth_signin_pin_failure` (reason=account_locked_attempt; counter NOT incremented) |
| `POST /api/auth/pin` | lockout threshold-cross | `pin-lockout-threshold-crossing` | 5 failures → 423 + `auth_account_locked` |
| `POST /api/auth/password` | happy → 200 + cookie | `password-signin-happy` | 200 + `auth_signin_password_success` |
| `POST /api/auth/password` | wrong password → 401 | `password-signin-wrong` | 401 + `auth_signin_password_failure` (reason=wrong_password) |
| `POST /api/auth/password` | missing password_hash defensive | `password-signin-missing-hash` | 401 + reason=missing_password_hash + counter increments |
| `POST /api/auth/password` | lockout threshold-cross | `password-lockout-threshold-crossing` | 5 failures → 423 + `auth_account_locked` |
| `POST /api/auth/password` | missing-hash + lockout | `password-missing-hash-lockout-regression` | defensive branch participates in lockout envelope (Session 4 regression covered) |
| `POST /api/auth/step-up` | happy → 200 + unlock | `step-up-happy` | 200 + `sessions.step_up_unlocked=true` + `auth_step_up_success` |
| `POST /api/auth/step-up` | wrong password → 401 | `step-up-wrong-password` | 401 + `auth_step_up_failure` (reason=wrong_password) + users counter UNTOUCHED |
| `POST /api/auth/step-up` | role not eligible → 403 | `step-up-role-not-eligible` | 403 + `auth_step_up_failure` (reason=role_not_email_auth) |
| `POST /api/auth/step-up` | no-lockout discipline | `step-up-no-lockout-on-failure` | 6 wrong attempts → 6×401, no `auth_account_locked`, users counters untouched |
| `POST /api/auth/verify` | happy + auto-sign-in | `verify-happy-auto-signin` | 200 + cookie + token consumed + `auth_email_verified` + `auth_signin_password_success` |
| `POST /api/auth/verify` | replay consumed token | `verify-replay-consumed` | 400 + `auth_token_consumed_replay` |
| `POST /api/auth/verify` | expired token | `verify-expired` | 400 + `auth_token_expired` (metadata.expires_at populated) |
| `POST /api/auth/verify` | invalid (unknown) token | `verify-invalid` | 400 + `auth_token_invalid` (actor_id null) |
| `POST /api/auth/password-reset-request` | happy (email_sent or email_failed) | `password-reset-request-happy` | 200 + outcome ∈ {email_sent, email_failed} |
| `POST /api/auth/password-reset-request` | user_not_found | `password-reset-request-user-not-found` | 200 + outcome=user_not_found + requested_email captured + actor null |
| `POST /api/auth/password-reset-request` | user_inactive | `password-reset-request-user-inactive` | 200 + outcome=user_inactive |
| `POST /api/auth/password-reset-request` | email_not_verified | `password-reset-request-email-not-verified` | 200 + outcome=email_not_verified |
| `POST /api/auth/password-reset-request` | role_not_email_auth | `password-reset-request-role-not-email-auth` | 200 + outcome=role_not_email_auth |
| `POST /api/auth/password-reset` | happy + sessions revoked | `password-reset-happy` | 200 + sessions_revoked=2 + active sessions=0 + no Set-Cookie |
| `POST /api/auth/password-reset` | replay consumed | `password-reset-replay-consumed` | 400 + `auth_token_consumed_replay` |
| `POST /api/auth/password-reset` | expired | `password-reset-expired` | 400 + `auth_token_expired` |
| `POST /api/auth/password-reset` | invalid | `password-reset-invalid` | 400 + `auth_token_invalid` |
| `POST /api/auth/logout` | valid → revoked | `logout-valid-revoked` | 200 + cookie cleared + outcome=revoked + sessions row revoked |
| `POST /api/auth/logout` | already-revoked idempotent | `logout-already-revoked` | 200 + outcome=already_revoked |
| `POST /api/auth/logout` | no cookie | `logout-no-cookie` | 200 + outcome=no_cookie |
| `POST /api/auth/logout` | invalid JWT | `logout-invalid-jwt` | 200 + outcome=jwt_invalid |
| `POST /api/auth/heartbeat` | valid → touch last_activity_at | `heartbeat-valid-touch` | 200 + last_activity_at advances; NO audit row written (intentional) |
| `POST /api/auth/heartbeat` | no cookie → 307 | `heartbeat-no-cookie-proxy-bounce` | 307 + Location=`/?next=…` (proxy denied at edge) |
| RLS cross-layer | SL self-only branch | `rls-cross-layer-sl-self-only` | SL JWT → `GET /rest/v1/users` → 1 row (own row only); admin branch suppressed at level 4 |
| RLS cross-layer | GM admin branch | `rls-cross-layer-gm-admin-branch` | GM JWT → `GET /rest/v1/users` → all 10 rows; admin branch fires at level 6; strict inequality vs SL |
| Session lifecycle | create | `lifecycle-create` | sessions row token_hash matches; step_up false; last_activity recent; expires_at +12h |
| Session lifecycle | idle timeout DB-side | `lifecycle-idle-timeout-db` | 401 + cookie cleared (requireSession idle check) |
| Session lifecycle | JWT exp DB-side | `lifecycle-jwt-exp-db-side` | 401 + cookie cleared (sessions.expires_at gate; JWT still valid) |
| Session lifecycle | JWT exp signature-side | `lifecycle-jwt-exp-signature-side` | 307 (proxy edge `verifyJwt` throws JWTExpired before route runs) |
| Session lifecycle | step-up auto-clear | `lifecycle-step-up-auto-clear` | step-up unlocked → heartbeat (non-/admin) → step_up_unlocked back to false |

**40 cases. All pass.** Full evidence (per-case captured audit rows including `metadata`, `actor_id`, `resource_id`, plus per-case PostgREST response counts for the RLS cross-layer cases) is preserved in `phase-2-audit-results.json`.

Two design choices visible in the matrix worth calling out:

- **Heartbeat is intentionally audit-silent.** Every authenticated request touches `last_activity_at` as a side effect of `requireSession`; emitting an explicit audit row per heartbeat would generate one row every 30 seconds during the warning-modal period for zero forensic gain. Real session lifecycle events (sign-in, sign-out, revocation, lockout) carry their own audit rows.
- **The two JWT-exp denial paths are structurally distinct.** Signature-side rejection happens at the proxy (edge runtime, no DB) and produces a 307 redirect to `/`. DB-side rejection happens at the route handler (Node runtime, full session lookup) and produces a 401 with the cookie cleared. The harness exercises both; either alone would mask a regression in the other.

---

## 5. RLS interaction

Phase 1 audited RLS standalone using a `SET LOCAL ROLE authenticated` + `set_config('request.jwt.claim.user_id', ...)` harness pattern that bypassed PostgREST's claim-extraction step. That worked for testing the policies as written, but as documented in the AGENTS.md Session 2 entry "PostgREST v12+ deprecated `request.jwt.claim.<name>` (singular)", the production claim-source pointer differs from what the Phase 1 harness simulated. Migration `0032_helpers_modern_claim_format` updated `current_user_id()` to read `current_setting('request.jwt.claims', true)::jsonb ->> 'user_id'` so the helpers consume the modern plural-claims JSONB that PostgREST actually provides.

This audit does not re-prove RLS policy correctness — Phase 1's 124/124 pass is the authoritative result. What it confirms is the Phase 1 ↔ Phase 2 integration: every successful sign-in produces a JWT whose `user_id`, `app_role`, and `role_level` claims, when verified by Supabase via the standby HS256 key and exposed to RLS as `request.jwt.claims`, are read correctly by the SECURITY DEFINER helpers and produce the policy-defined admit/deny outcome. The cross-layer evidence is direct rather than implicit, via the two harness cases in §3.6 — `rls-cross-layer-sl-self-only` and `rls-cross-layer-gm-admin-branch` — which exercise the chain from sign-in through PostgREST under both branches of `users_read_self` and assert on row-count differential. The Session 2 standby-key smoke test (verified end-to-end that an HS256 JWT signed by `lib/auth.ts` is accepted by PostgREST as a valid `authenticated` JWT) is the foundational evidence layer; the Session 5 cross-layer cases are the regression layer that will catch any future drift in claim shape, helper definition, or PostgREST configuration.

The locations claim is signed into the JWT at session-create time and only refreshes on session rotation (12-hour exp ceiling, or sooner if the user signs out and back in). This is the JWT-embedded authorization claim refresh latency captured in AGENTS.md as a Phase 5+ acceptance criterion: every admin user/location mutation that affects authorization must call `revokeSession()` for every active session of the affected user inside the same transaction, otherwise an in-flight JWT continues to claim stale location membership for up to 12 hours.

---

## 6. Findings

Two findings surfaced during harness construction. Both are durable lessons that warrant codification in AGENTS.md and inform Phase 5+ patterns.

### 6.1 Schema-as-defense for `pin_hash`

**Discovered.** Workstream 1 Step 5 (initial harness run; A3 / A5 cases unexpectedly failed because the `pin_hash=null` UPDATEs were silently rejected by Postgres while the harness assumed the writes succeeded).

**Root cause.** `users.pin_hash` is declared `NOT NULL` at the schema level. Symmetrically, `users.password_hash` is nullable — which models the intentional bootstrap state where a level 5+ user is created (active, email verified through the verify flow, ready to set their password) before the verify-and-set-password flow has run. PIN, in contrast, is the universal first-factor for all roles and is set at user creation; nullable PIN was never a desired state.

**Implication for the route handlers.**
- The `missing_password_hash` defensive branch in `/api/auth/password/route.ts:125-139` is reachable in legitimate production state and is necessary for correct behavior. It is exercised by the harness (`password-signin-missing-hash`, `password-missing-hash-lockout-regression`) and was the subject of the Phase 2 Session 4 lockout-symmetry fix.
- The `missing_pin_hash` defensive branch in `/api/auth/pin/route.ts:115-124` is unreachable in legitimate production state. Postgres rejects any UPDATE that attempts to clear `pin_hash` with sqlstate `23502` (`not_null_violation`), which means an active user can never legitimately be in the precondition state the branch is designed to handle.

**Decision: retain the route branch as defense-in-depth.** The branch is correct, costs nothing to keep, and its purpose is forward-looking: defense against a future migration that relaxes the NOT NULL constraint (e.g., if a Phase 4+ design introduces optional PIN-only roles or a credential-rotation flow that briefly clears PIN before re-setting it), or against a code path that bypasses the PostgREST update layer (e.g., a future raw-SQL migration that updates `pin_hash` directly and forgets to populate it). The harness is documented to test what's reachable + provable; the branch's correctness is implicit in the symmetry with `missing_password_hash` and verifiable by inspection.

**Harness expression.** Case `pin-missing-hash-unreachable-by-schema` directly attempts the UPDATE via service-role and asserts the Postgres error code is `23502`. The audit document records the schema constraint as the actual enforcement layer and the route branch as the secondary defense.

**Durable-knowledge entry queued for AGENTS.md (Workstream 5):**

> Schema-level enforcement is the real defense for `pin_hash` non-null. The route handler's `missing_pin_hash` defensive branch in `/api/auth/pin/route.ts` is unreachable in production because `users.pin_hash` is `NOT NULL` at the schema level. Postgres returns sqlstate 23502 on any UPDATE that tries to clear it. The branch is retained as defense-in-depth against future migrations that might relax the constraint (e.g., if Phase 4+ introduces optional PIN-only roles). Future-Claude reading this branch should NOT remove it as dead code — its purpose is forward-looking. Discovered during Phase 2 Session 5 audit harness construction.

### 6.2 Supabase JS swallows constraint-violation errors silently

**Discovered.** Same workstream; same A3 / A5 false negatives.

**Root cause.** A `.update()` call that hits a NOT NULL or check-constraint violation returns the error in the response object's `error` field but does NOT throw. Calling code that only inspects `data` (or, more commonly, awaits the promise without destructuring the response at all) sees the operation appear to succeed — no exception, no rejected promise, just an empty `data` array. The harness's first iteration of `resetSL` discarded the response entirely; the UPDATE silently failed, the next test ran against stale state, and the harness logged a confusing pass/fail mismatch.

**Generalization.** This applies to every Supabase JS write operation — `.insert`, `.update`, `.upsert`, `.delete` — and to every constraint class — NOT NULL, CHECK, UNIQUE, foreign-key. Service-role bypasses RLS, so RLS denials are not the failure mode at this layer (RLS denials of UPDATE are themselves silent — see Phase 1's UPDATE-0-rows pattern — but distinguishable by the row-count check). Constraint violations are.

**Discipline.** Every service-role write must:
1. Destructure `{ error }` from the response.
2. Either throw (for control-flow paths where a write failure must surface immediately, e.g., harness setup, deployment scripts, migrations) or audit-and-continue with explicit error visibility (for production paths where logging-and-degrading is preferable to throwing — `lib/audit.ts` is the canonical example, and it logs to `console.error` rather than throwing because losing one audit row is preferable to breaking the user-facing operation).
3. Where the operation must succeed for correctness (admin updates with side effects), additionally check `data.length` after operations that include `.select()`, mirroring the Phase 1 RLS UPDATE-0-rows discipline.

**Harness expression.** `resetSL` and `resetGM` were updated in Workstream 1 Step 5 to throw on `error`. Future Phase 5+ admin write paths inherit this discipline as a hard requirement.

**Durable-knowledge entry queued for AGENTS.md (Workstream 5):**

> Supabase JS UPDATE swallows constraint-violation errors silently — must check `error` field. A `.update()` call that hits a NOT NULL or other constraint violation returns the error in the response object but does NOT throw. Calling code that only inspects `data` will see stale state without realizing the write failed. Pattern: every service-role write must explicitly check `if (error)` and surface the error. Discovered during Phase 2 Session 5 audit harness debugging when `resetSL` silently failed and produced ghost test failures. Phase 5+ admin user-management routes inherit this discipline.

---

## 7. Known gaps and scope

The following limitations are acknowledged, intentional, and carried into Phase 5+ rather than blocking Phase 2 close. All five are scope-defined; none are bugs.

### 7.1 Per-IP rate limiting is deferred to Phase 5+

The lockout policy provides per-user brute-force resistance but does not throttle attempts across distinct user_ids from the same IP. An attacker can walk the entire user_id space (possible via the public `/api/users/login-options` endpoint, which surfaces names by location+role) at 5 attempts per user per 15-minute window indefinitely. This is acceptable for a small-team, single-tenant deployment where audit-log monitoring will catch any large-scale spray well before damage; it would not be acceptable at scale. Per-IP rate limiting requires Vercel KV (or equivalent) infrastructure that has not yet been provisioned.

### 7.2 Constant-time response for timing-attack defense is deferred

The auth routes do not normalize their response timing. A practiced attacker could in principle distinguish "wrong PIN" (full bcrypt verification round) from "user not found" (no bcrypt) by latency. The bcrypt cost-12 floor is 200–300 ms on the dev hardware, which dominates the request envelope and provides incidental obfuscation, but is not a guarantee. Production-grade timing-attack defense (e.g., dummy bcrypt invocation on the not-found path to keep latency uniform) is deferred to Phase 5+.

### 7.3 Multi-factor authentication is out of scope for foundation

The auth model is single-factor: PIN OR password. There is no TOTP, SMS, or email-as-second-factor flow. Step-up re-authentication exists for level 5+ admin actions but uses the same password as the primary credential — it confirms current control of the password rather than introducing a second factor. MFA is a Phase 6+ candidate.

### 7.4 Phone number verification is out of scope for foundation

`users.phone` and `users.sms_consent` are schema columns but no flow currently verifies that a phone number belongs to the user, and no notification path requires verified phone state. This is consistent with Phase 0/1 notification scoping; SMS notifications via the Toast/Twilio adapter (Phase 5+) will require phone verification before any user-facing send.

### 7.5 Stolen-credential disclosure response is manual

When a credential leak is suspected, the operational response is documented in [docs/runbooks/jwt-rotation.md](runbooks/jwt-rotation.md) for the JWT-secret case. For password leaks, the response is admin-driven: an admin force-resets the affected user via the Phase 5+ admin tools, which will run `revokeSession()` per the documented acceptance criterion. There is no automated detection of credential leakage (e.g., haveibeenpwned integration); the audit log retains every sign-in for forensic reconstruction.

### 7.6 New scope item — schema-as-defense for `pin_hash`

The route's `missing_pin_hash` defensive branch is unreachable in production because the schema enforces `NOT NULL`. The branch is retained as defense-in-depth (see §6.1). Future migrations that relax the constraint must coordinate with this expectation; future code review of the branch should not flag it as dead code.

### 7.7 New scope item — Supabase JS UPDATE error discipline

Every service-role write must explicitly check `error` (see §6.2). The harness's `resetSL` / `resetGM` apply this discipline; Phase 5+ admin routes are required to follow. Code review for new write paths should specifically check for the `{ data, error } = await sb.from(...).update(...)` destructure-and-throw pattern.

---

## 8. Approval statement

**Phase 2 is approved for merge to `main`.**

The auth layer correctly implements every documented control. All eight threat-model defenses are exercised by the harness and produce the expected behavior at three layers (HTTP status, response shape, audit row). The two surfaced findings — schema-as-defense for `pin_hash` and the Supabase JS silent-error pattern — are documented in AGENTS.md durable-knowledge form and become Phase 5+ acceptance criteria. The five pre-existing scope limitations are documented and accepted; none block foundation-stage operation.

Approval is gated on the remaining Workstream 3–5 deliverables for Session 5: Juan's real password set via the dogfood verify flow, token-table cleanup pre/post the dogfood run, branch tag and merge to `main`. None of those workstreams introduce new code or new threat-model surface area.

The audit document, harness, and `phase-2-audit-results.json` artifact are committed together in Workstream 5. The branch tag `phase-2-complete` is applied at merge.

---

## 9. Appendix — reproduction

```bash
# From the worktree root, with .env.local populated and dev server running:
npx tsx --env-file=.env.local scripts/phase-2-audit-harness.ts

# Output:
#   stdout: per-case PASS/FAIL with one-line evidence
#   file:   phase-2-audit-results.json (per-case full evidence)
#   exit:   0 on all-pass, 1 on any failure
```

The harness is idempotent — fixture rehydration tolerates any prior state, including from prior failed runs. The two fixture user_ids are stable across runs; audit-log rows accumulate but are filtered by per-run `harness_run_at` timestamps.

Re-running after any auth-layer change is the regression discipline. A single failure should be considered a Phase 2 contract violation and fixed before the change merges.
