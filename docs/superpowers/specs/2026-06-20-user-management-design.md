# User Management (C.44 Module 2) — Design

**Date:** 2026-06-20
**Status:** Approved design, pre-plan
**Cycle:** C.44 capstone, Module 2 (after Admin Foundation #78). The module that makes CO operationally **dev-independent for staffing** — onboarding/offboarding/role/location/credential changes via UI instead of a developer running a provisioning script.

---

## Goal

GM/MoO+ admins create, edit, deactivate, re-activate users, reset PINs/passwords, change roles, and assign/unassign locations from `/admin/users` — gated `admin.users` (level ≥ 8, MoO+), consuming the foundation's two-tier step-up. Replaces the `501` API stubs and the `PlaceholderCard` page with the real API + UI. One migration.

## Decisions (locked with Juan)

1. **Location removal** → add an `active` column to `user_locations` (soft-deactivate the assignment; append-only-consistent; preserves the forensic record). Requires making every `user_locations` reader `active`-aware.
2. **New-user credentials** → admin types a 4-digit temp PIN for everyone + a temp password for email-auth roles (L≥6); service-role insert with `email_verified=true`; credentials relayed out-of-band (the proven Phase 2.5 bridge pattern, now via UI). The email invite/verify flow stays blocked until Resend domain verification.
3. **Admin password reset for L≥6** → in scope (Tier B), since the self-service email reset is also Resend-blocked today.
4. **Scope** → one cycle for the full CRUD. The **performance-band filter is a deferred fast-follow** (see Deferred), not in this cycle.

## Ground-truth (verified live, 2026-06-20)

- `users.role` CHECK allows **all 15 role codes** (`cgs,owner,moo,gm,agm,catering_mgr,prep_mgr,social_media_mgr,shift_lead,key_holder,trainer,employee,trainee,hired_not_yet_worked,prospect`) — matches `lib/roles.ts`. Assignable roles are bounded by `canActOn` (strictly below the admin's level), **not** by the DB constraint.
- `user_locations` has **4 columns** (`user_id, location_id, assigned_at, assigned_by`) — **no `active`** today. The migration adds it.
- `ALL_LOCATIONS_THRESHOLD = 9` (`lib/locations.ts`) — L≥9 (owner/cgs) get all-locations implicitly; **L<9 need explicit `user_locations` rows**.
- `user_locations` runtime readers to make `active`-aware (the reader audit): `lib/session.ts:179` (createSession's JWT `locations` claim ⚠️), `app/api/users/login-options/route.ts:66`, `lib/profiles.ts:71` + `:129`, `lib/team-metrics.ts:79`/`:449`/`:511`, `lib/checklists.ts:1420`. (Seed/script writers are not runtime — left alone.)
- Destructive-action vocabulary already locked: `user.create/activate/deactivate/promote/demote/change_locations/reset_pin/set_pin/change_email` (+ add `user.reset_password`). `lib/auth.ts` `hashPin`/`hashPassword`; `lib/audit.ts` `audit()`; `lib/api-helpers.ts` `jsonError/jsonOk/parseJsonBody/extractIp`; `lib/roles.ts` `canActOn`/`ROLES`; `lib/admin/step-up.ts` `assertStepUp`; `components/admin/StepUpProvider.tsx` `requestStepUp` — all reused.

---

## Architecture

### Migration `0078_add_user_locations_active`
`ALTER TABLE user_locations ADD COLUMN active boolean NOT NULL DEFAULT true;` Apply via Supabase MCP `apply_migration` AND capture as `supabase/migrations/0078_add_user_locations_active.sql` (going-forward header convention). No RLS change — admin writes use the service-role client, app-gated. **Reader audit (same PR):** add `.eq("active", true)` to the 8 reader sites listed above. The `createSession` site is load-bearing (it builds the JWT `locations` claim); combined with `revokeAllUserSessions` on location change, a removed assignment stops granting access immediately (next login builds a filtered claim).

### Authorization layering (every admin API route gates itself)
Admin API routes live **outside** `app/admin/layout.tsx`, so each enforces its own gates, in order:
1. `requireSession(req, "/api/admin/users…")` → 401 on denial.
2. `level = ROLES[ctx.user.role].level; if (level < 8) → jsonError(403, "forbidden")` (`admin.users` gate).
3. For mutations: `assertStepUp(ctx, tier)` → `403 step_up_required` / `step_up_stale` when not satisfied.
4. For target-bound mutations: load the target user, then `if (!canActOn(ctx.user.role, target.role)) → jsonError(403, "forbidden")` (strict-greater — can't touch peers/seniors).

The `/admin/users` **page** (Server Component under the admin layout, which already gives ≥6) additionally redirects when `level < 8`.

### API surface (replaces the `501` stubs)
- `GET /api/admin/users` — list. Service-role; returns users (active + inactive, filterable by role/active/location/query) with their location assignments. Lists everyone for visibility; per-row actions are gated by `canActOn` in the UI + enforced server-side per action.
- `POST /api/admin/users` — **create** (Tier A). Body `{ name, role, email?, tempPin, tempPassword?, locationIds[] }`.
- `GET /api/admin/users/[id]` — detail.
- `PATCH /api/admin/users/[id]` — **edit profile** (name, phone, email) → **Tier A**. Email change lowercased + `user.change_email` audit.
- Tier-B action sub-routes under `/api/admin/users/[id]/` (each: step-up Tier B + `canActOn` + audit; the auth-affecting ones **revoke the target's sessions** — see Session revocation, which excludes `activate`):
  - `POST …/reset-pin` (`user.reset_pin`)
  - `POST …/set-password` (`user.reset_password`)
  - `POST …/role` (`user.promote`/`user.demote` by direction)
  - `POST …/locations` (`user.change_locations` — diff add/remove via `active` toggle)
  - `POST …/deactivate` (`user.deactivate`) / `POST …/activate` (`user.activate`)

### Creation flow (the bridge pattern, in UI)
Service-role insert mirroring `scripts/phase-2.5-provision-temp-users.ts`: lowercase email; pre-flight unique-email check; `hashPin(tempPin)` (4 digits, required for all — `pin_hash` is NOT NULL); `hashPassword(tempPassword)` for L≥6 (else null); `email_verified=true` + `email_verified_at=now()` (no verify email can be sent); `created_by = admin.id`; insert `user_locations` rows for `locationIds` (required when target L<9, must be ⊆ the admin's accessible locations; ignored/empty for L≥9). `user.create` audit with `creation_method: "admin_ui"`. Validation: `canActOn(admin.role, role)`; role ∈ assignable set; PIN is exactly 4 digits; email required+valid for L≥6; tempPassword present + length-checked for L≥6.

### Session revocation
New `revokeAllUserSessions(userId): Promise<{ count: number }>` in `lib/session.ts` — service-role `UPDATE sessions SET revoked_at=now() WHERE user_id=? AND revoked_at IS NULL`, returns count. Called by every auth-affecting Tier-B action (reset-pin, set-password, role, locations, deactivate) so changes take effect immediately rather than waiting on the ≤12h JWT exp. Captured in each action's audit metadata (`sessions_revoked: <count>`), per the AGENTS.md "credential or authorization changes revoke active sessions" criterion.

### Step-up tiers
- **Tier A** (step-up once per admin session): create user, edit profile (name/phone/email).
- **Tier B** (re-prompt every time + revoke target sessions): reset-pin, set-password, change-role, change-locations, deactivate, activate.
- Reads (list/detail): free (role gate only).

### Files
**Migration:** `supabase/migrations/0078_add_user_locations_active.sql`.
**New:** `lib/admin/users.ts` — admin loaders + mutators (`listUsers`, `getUserDetail`, `createUser`, `updateUserProfile`, `resetPin`, `setPassword`, `changeRole`, `setLocations`, `setActive`); service-role; each mutator audits and (where auth-affecting) calls `revokeAllUserSessions`. API route files under `app/api/admin/users/`. Client form components under `components/admin/users/` (`UserList`, `UserDetail`, `CreateUserForm`, edit/action forms) consuming `useStepUp().requestStepUp(tier)` for Tier-B confirmations.
**Modify:** `lib/session.ts` (+`revokeAllUserSessions`; `createSession` user_locations read `.eq("active", true)`); the 6 other reader sites (`active` filter); `lib/destructive-actions.ts` (+`user.reset_password`); `app/admin/users/page.tsx` (replace stub with the real list, re-gate ≥8); `admin.users.*` i18n EN+ES at parity.

## Authorization / privacy
- Two enforcement layers: app-layer gates in every route (level ≥ 8 + step-up tier + `canActOn`) over the service-role client (which bypasses RLS by design — consistent with the foundation + Phase 2.5). RLS remains the boundary for end-user clients.
- **Column gating preserved:** admin edits go through the admin path (the documented `users_update_admin` lane); self-update-only fields are unaffected.
- **`canActOn` strict-greater** everywhere a target is acted on — an MoO (8) can manage GM(7) and below but not peers/seniors; reflected in the UI (disabled actions) AND enforced server-side.
- **Credentials never logged.** Temp PIN/password are hashed at the route and never written to audit metadata or logs (only `creation_method`, role, locations, `sessions_revoked` go to audit).
- Email lowercased at every insert/update path (the silent-`email_not_found` footgun).

## Verification (no test framework)
`tsc --noEmit` + `next build` + throwaway `tsx`/pure smokes (self-deleted, never committed):
1. **Migration:** `user_locations.active` exists, defaults true; existing rows backfilled true.
2. **Reader audit (live smoke):** insert an `active=false` assignment → it does NOT appear in `createSession`'s locations claim, `login-options`, the profile directory, or team-metrics roster; `active=true` still does.
3. **`canActOn` bounds (pure):** an MoO(8) can act on ≤7; cannot on 8/9/10. Assignable-role set for a given admin excludes ≥ own level.
4. **Tier enforcement:** each Tier-B route returns 403 when `assertStepUp` fails; Tier-A routes proceed under a session unlock.
5. **Create validations (pure + live):** PIN must be 4 digits; email required/lowercased for L≥6; tempPassword required for L≥6; locations required+⊆-accessible for L<9; duplicate email rejected pre-flight.
6. **Session revocation:** after deactivate/role/locations/reset-pin/set-password, the target's active sessions are all `revoked_at` set; audit carries `sessions_revoked`.
7. **No-regression:** `next build` clean; existing auth/login flows unaffected by the `active` filter.
8. **Juan preview smoke:** create a user → log in as them on preview; change their role/locations → their session is forced to re-auth; reset PIN → old PIN fails, new works; deactivate → can't log in; `canActOn` hides actions on peers/seniors.

## Deferred (tracked)
- **Fast-follow — Performance-band filter on the user list** (Juan's request, next cycle). Reuse `loadTeamOperatingHealth(service, {viewer, locationId, …})` per location as the data source — **no scoring rebuild**. Three bands derived **absolutely** (health + trend), not percentile: **underperformer** = `needs_attention` (missing a role-expected category or a sharp drop); **outperformer** = `on_track` AND rising/top-standing; **cruising** = `on_track` steady. Banded within **role+location cohort** (scores are role-scoped; cross-role comparison is meaningless). Manager-facing (MoO+) — consistent with the existing AGM+ exposure, doesn't widen who sees performance data. Small-cohort caveat: absolute/health basis chosen precisely so a strong team isn't forced to have a "bottom third." For cross-location admins, compute per location and merge in the app layer (2–5 locations; acceptable).
- Email invite/verify creation flow — once Resend domain verification lands (replaces the bridge temp-credential flow).
- Bulk operations (multi-select deactivate, etc.) — YAGNI for v1.
