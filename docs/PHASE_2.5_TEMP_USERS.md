# Phase 2.5 — temp user provisioning (Pete + Cristian)

**Date:** 2026-04-30
**Branch:** `claude/goofy-johnson-c07586`
**Bridge between:** Phase 2 (auth lifecycle complete, tag `phase-2-complete`) and Phase 5+ (admin tooling + Resend domain verification).
**Author:** Juan, via Claude Code.

---

## 1. What was provisioned

Two production user accounts inserted via service-role direct insert on 2026-04-30:

| Field | Pete | Cristian |
|---|---|---|
| `users.id` | `73ac4b61-ff87-4db6-b338-9098dfe3f295` | `0d467b64-6865-461b-b4fd-f3a17c3a056f` |
| `email` | `Pete@complimentsonlysubs.com` | `Cristian@complimentsonlysubs.com` |
| `name` | `Pete` | `Cristian` |
| `role` | `owner` (level 7) | `moo` (level 6.5) |
| `active` | `true` | `true` |
| `email_verified` | `true` | `true` |
| `phone` | `NULL` | `NULL` |
| `password_hash` | bcrypt cost-12, peppered via `AUTH_PASSWORD_PEPPER` | same |
| `pin_hash` | bcrypt cost-12 of `'0000'`, peppered via `AUTH_PIN_PEPPER` | same |
| `user_locations` rows | `[]` (level-7 override applies at app + RLS) | `MEP` (`54ce1029-400e-4a92-9c2b-0ccb3b031f0a`) + `EM` (`d2cced11-b167-49fa-bab6-86ec9bf4ff09`); explicit assignments via `user_locations` join with `assigned_by = Juan` |
| `created_by` | Juan (`16329556-900e-4cbb-b6e0-1829c6f4a6ed`) | same |
| `audit_log.id` for creation | `607ddafa-5d9d-4fb4-8e56-eb6ca28c0de4` | `e35750f8-483f-4097-82fa-1d325f680aba` |
| audit `action` | `user.create` (auto-flagged `destructive=true`) | same |

Provisioning script: [scripts/phase-2.5-provision-temp-users.ts](../scripts/phase-2.5-provision-temp-users.ts). Script is committed as procedure documentation; plaintext passwords are NEVER in the script and are passed only as runtime env vars (`PETE_PASSWORD`, `CRISTIAN_PASSWORD`).

---

## 2. Why service-role direct insert

The proper invite/verify flow can't deliver email to non-Juan recipients in foundation phase: `EMAIL_FROM=onboarding@resend.dev` (Resend's default sender) only delivers to the verified Resend account email, which is `juan@complimentsonlysubs.com`. Domain verification of `complimentsonlysubs.com` is queued for Phase 5+ once Pete approves DNS configuration. Until then, sends to Pete or Cristian's addresses silently 422 from Resend's side.

Pete and Cristian need to log in to watch Phase 3 progress. Waiting for Phase 5+ would block visibility into the build for ~weeks. The deliberate workaround:

- Insert directly via service-role, bypassing the verify flow.
- Set `email_verified=true` (and `email_verified_at = now()`) at insert time, since the verify flow is the only path that normally sets this.
- Hash a known plaintext password via `lib/auth.ts` `hashPassword()` so they can sign in immediately on the password route.
- Communicate plaintext passwords out-of-band (Juan to Pete/Cristian via text/in-person). **Plaintext is never stored anywhere in the system** — not in the script, not in env files, not in audit metadata.
- Audit each insert with `action = "user.create"` and `metadata.phase = "2.5_temp_provisioning"` so Phase 5+ filtering distinguishes these bridge rows from the canonical-flow rows that admin tooling will produce.

---

## 3. Constraints and decisions captured

### 3.1 `pin_hash` placeholder
`users.pin_hash` is `NOT NULL` at the schema level (audit doc §6.1, durable-knowledge entry). Pete and Cristian don't use PIN auth (level 5+ uses email+password as the secondary auth path), but the schema constraint requires the column to be populated. Both rows carry `bcrypt(AUTH_PIN_PEPPER + '0000', cost=12)` and the audit metadata records `pin_hash_origin: "placeholder hashPin('0000') — schema NOT NULL constraint per audit doc §6.1"`. If they ever attempt PIN auth, `0000` will work — this is an acceptable foundation-phase exposure for two trusted users with known credentials communicated out-of-band; not acceptable for any non-trusted user. Phase 5+ admin tools should reject creation paths that leave a placeholder `0000` PIN hash on a non-bridge user.

### 3.2 Cristian's location assignments are a temp workaround
The all-locations override threshold is `>= 7` at both app layer ([lib/locations.ts:13](../lib/locations.ts) `ALL_LOCATIONS_THRESHOLD`) and DB layer (the `current_user_role_level() >= 7` clause in 20+ location-scoped RLS policies). MoO sits at level 6.5 — *below* the override. Without explicit `user_locations` rows, Cristian would see no location-scoped data (announcements, checklists, catering pipeline, etc.) at the DB layer regardless of his role.

For tonight, Cristian gets explicit assignments to both locations (`MEP` + `EM`) so he sees everything during Phase 3. This is correct foundation behavior — MoO IS location-scoped per the architecture — and the architecture supports clean growth. See AGENTS.md durable-knowledge entry "Threshold-at-≥7 separates company-level from operational roles" for the full rationale.

### 3.3 Audit action = `user.create` (canonical)
Discussed in pre-flight. The locked vocabulary in [lib/destructive-actions.ts](../lib/destructive-actions.ts) uses dot-namespaced action codes (`user.create`, `user.deactivate`, `vendor.create`, etc.) and `user.create` is already on the destructive list, so [lib/audit.ts](../lib/audit.ts) `audit()` auto-derives `destructive=true`. Phase 5+ admin tools will use the same action string when proper invite/verify flows ship. Bridge nature is captured in `metadata.phase = "2.5_temp_provisioning"` and the rest of the standard metadata so filtering for canonical-flow rows is a `metadata->>'creation_method' != 'service_role_direct_insert'` predicate.

A separate `user_provisioned` action was considered and rejected — it would have introduced a one-off namespace and required manual addition to `DESTRUCTIVE_ACTIONS` to keep the destructive flag coherent.

---

## 4. Scrub procedure for Phase 5+

Once admin tooling and Resend domain verification land:

1. **Mark both bridge accounts `active=false`.** Per Phase 1 append-only philosophy ("never DELETE from `users`"), the rows persist as forensic history. user_ids `73ac4b61-ff87-4db6-b338-9098dfe3f295` (Pete) and `0d467b64-6865-461b-b4fd-f3a17c3a056f` (Cristian) remain in the database indefinitely.
2. **Audit the deactivation** with `action = "user.deactivate"` and `metadata.reason = "phase 2.5 bridge account scrubbed; superseded by canonical-flow account <new_user_id>"`.
3. **Create new user records via the canonical Phase 5+ admin invite flow.** Fresh user_ids; the proper verify-and-set-password email goes to each (now deliverable, since the domain is verified). Pete and Cristian click the verify link, set their own passwords (no Juan-knows-plaintext), and `email_verified` is set by the verify flow itself.
4. **Reference the old user_ids in the new records' creation metadata** for forensic continuity:
   ```json
   {
     "supersedes_bridge_user_id": "73ac4b61-ff87-4db6-b338-9098dfe3f295",
     "bridge_phase": "2.5_temp_provisioning",
     "bridge_audit_id": "607ddafa-5d9d-4fb4-8e56-eb6ca28c0de4"
   }
   ```
5. **Revoke any active sessions on the bridge accounts** at deactivation time, per the AGENTS.md Phase 2 Session 2 acceptance criterion ("Whenever a user's auth state changes such that the holder of an active session JWT may no longer be the intended owner, the mutation MUST also revoke active sessions"). For these bridge accounts, that's via `UPDATE sessions SET revoked_at = now() WHERE user_id IN (...) AND revoked_at IS NULL`, capturing `metadata.sessions_revoked` on the deactivation audit row.
6. **Old records remain in DB indefinitely as audit history.** No DELETE. The append-only philosophy is the durable contract.

---

## 5. Phase 3 housekeeping flag — MoO threshold revisit

Cristian's explicit location assignments (§3.2) are a temp workaround for the level-6.5-vs-≥7 threshold gap. If CO's organizational model is "MoO is structurally unscoped — all locations, all the time," the right fix is to lift the all-locations override to `>= 6.5` at both layers. That's a multi-file change (1 line in `lib/locations.ts`, ~20+ RLS policies, a new migration, and a re-run of the Phase 1 RLS audit) — deferred from Phase 2.5 for scope reasons.

**Phase 3 housekeeping task:** decide whether to (a) lift the threshold to `>= 6.5` (make MoO permanently all-locations) or (b) keep the threshold at `>= 7` and treat MoO as per-location-scoped going forward (Cristian's explicit assignments become canonical, future regional MoO splits work via `user_locations`). Either decision is operationally legitimate; current state is the conservative default.

---

## 6. Single-line summary

> Phase 2.5 bridge: Pete (owner, `73ac4b61-ff87-4db6-b338-9098dfe3f295`) + Cristian (moo, `0d467b64-6865-461b-b4fd-f3a17c3a056f`) provisioned via service-role direct insert on 2026-04-30; both `active=true email_verified=true` with bcrypt-hashed passwords + placeholder PIN; Cristian assigned to MEP+EM, Pete unscoped via level-7 override; `user.create` audit rows `607ddafa…` + `e35750f8…` carry `metadata.phase="2.5_temp_provisioning"`; scrubbed via canonical flow in Phase 5+ once Resend domain verification lands.
