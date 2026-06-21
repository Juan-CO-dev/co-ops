# User Management (C.44 Module 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GM/MoO+ admins create, edit, deactivate/reactivate users, reset PIN/password, change role, and assign/unassign locations from `/admin/users` — no developer required.

**Architecture:** Admin mutations run through a service-role data layer (`lib/admin/users.ts`), gated entirely app-layer (every API route self-enforces `requireSession` → `level ≥ 8` → `assertStepUp(tier)` → `canActOn`). Location removal is modeled append-only via a new `user_locations.active` column; every reader filters `active=true`, and auth-affecting changes call `revokeAllUserSessions` so they take effect immediately.

**Tech Stack:** Next.js 16 App Router (Server + Client Components), React 19, Tailwind v4 (CSS tokens), TypeScript strict + `noUncheckedIndexedAccess`, Supabase Postgres (service-role client for admin writes; custom-JWT + RLS). Migrations via Supabase MCP `apply_migration` (prod ref `bgcvurheqzylyfehqgzh`).

**Branch:** `claude/user-management` (created off `origin/main`; spec committed `ddec0f8`).

**Conventions:**
- Throwaway smokes at `scripts/_smoke_*.ts`, run `npx tsx scripts/_smoke_*.ts` (or `--env-file=.env.local` when they hit the DB), **deleted before the task commit** (never commit `_smoke_*`).
- Every commit ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Ground-truth before authoring** each task: re-read the live files it touches; do not author against memory.
- Admin API routes live OUTSIDE `app/admin/layout.tsx`, so each route enforces its own gates.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `supabase/migrations/0078_add_user_locations_active.sql` | Create | Add `user_locations.active boolean NOT NULL DEFAULT true`. |
| `lib/session.ts` | Modify | `+revokeAllUserSessions(userId)`; `createSession` reads `user_locations` with `.eq("active", true)`. |
| `app/api/users/login-options/route.ts`, `lib/profiles.ts` (×2), `lib/team-metrics.ts` (×3), `lib/checklists.ts` (×1) | Modify | Reader audit — `.eq("active", true)`. |
| `lib/destructive-actions.ts` | Modify | `+"user.reset_password"`. |
| `lib/admin/users.ts` | Create | Admin data layer: types, read loaders, create + mutators (service-role; audit + revoke). |
| `app/api/admin/users/route.ts` | Modify (replace 501) | `GET` list, `POST` create. |
| `app/api/admin/users/[id]/route.ts` | Create | `GET` detail, `PATCH` profile (Tier A). |
| `app/api/admin/users/[id]/{reset-pin,set-password,role,locations,deactivate,activate}/route.ts` | Create | Tier-B action routes. |
| `lib/i18n/en.json` + `es.json` | Modify | `admin.users.*` keys at parity. |
| `app/admin/users/page.tsx` | Modify (replace stub) | List page (Server Component), re-gate ≥8. |
| `components/admin/users/*` | Create | Client UI: list table, create form, detail/edit, action controls. |

Dependency order: migration → reader audit → `revokeAllUserSessions` → destructive action → data layer (read → create → mutators) → API routes → i18n → page → client UI → final gate.

---

## Task 1: Migration — `user_locations.active`

**Files:** Create `supabase/migrations/0078_add_user_locations_active.sql`.

- [ ] **Step 1: Ground-truth**

Confirm via Supabase MCP `execute_sql` (project `bgcvurheqzylyfehqgzh`) that `user_locations` has no `active` column:
`select column_name from information_schema.columns where table_schema='public' and table_name='user_locations';`
Expected: `user_id, location_id, assigned_at, assigned_by` (no `active`).

- [ ] **Step 2: Apply the migration via MCP**

Use `apply_migration` (name `add_user_locations_active`):
```sql
ALTER TABLE public.user_locations
  ADD COLUMN active boolean NOT NULL DEFAULT true;
```

- [ ] **Step 3: Verify applied**

`execute_sql`: `select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema='public' and table_name='user_locations' and column_name='active';`
Expected: one row, `boolean`, `NO`, default `true`. Also `select count(*) from user_locations where active is null;` → 0 (existing rows backfilled true by the NOT NULL DEFAULT).

- [ ] **Step 4: Capture the migration file**

Create `supabase/migrations/0078_add_user_locations_active.sql`:
```sql
-- Migration 0078_add_user_locations_active
-- Applied via Supabase MCP apply_migration on 2026-06-20.
-- Canonical reference: docs/superpowers/specs/2026-06-20-user-management-design.md
--   + AGENTS.md "Append-only philosophy is enforced at RLS".

-- C.44 Module 2 (User Management): location assignment removal is modeled
-- append-only as active=false (no DELETE). Every user_locations reader must
-- filter active=true (see lib/session.ts createSession, login-options,
-- lib/profiles.ts, lib/team-metrics.ts, lib/checklists.ts). No RLS change:
-- admin writes use the service-role client, gated app-layer.
ALTER TABLE public.user_locations
  ADD COLUMN active boolean NOT NULL DEFAULT true;
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0078_add_user_locations_active.sql
git commit -m "feat(admin): migration 0078 — user_locations.active (append-only removal)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Reader audit — filter `active=true` everywhere

**Files:** Modify `lib/session.ts`, `app/api/users/login-options/route.ts`, `lib/profiles.ts`, `lib/team-metrics.ts`, `lib/checklists.ts`.

- [ ] **Step 1: Ground-truth**

Re-grep the reader sites (line numbers drift): `rg -n 'from\("user_locations"\)' lib app`. Confirm the 8 runtime reads (NOT the script writers): `lib/session.ts` (createSession's `.select("location_id")`), `app/api/users/login-options/route.ts` (`.select("user_id").eq("location_id", …)`), `lib/profiles.ts` (two: directory `.select("user_id").in("location_id", …)` and the single-profile `.select("location_id").eq("user_id", …)`), `lib/team-metrics.ts` (three: roster `.select("user_id").eq("location_id", …)` and two `.eq("user_id", …).maybeSingle()` membership checks), `lib/checklists.ts` (`.select("user_id")`).

- [ ] **Step 2: Add `.eq("active", true)` to each read**

For every one of those 8 `from("user_locations").select(...)` chains, add `.eq("active", true)` (place it adjacent to the other `.eq(...)` filters; order is irrelevant to PostgREST). Examples:

`lib/session.ts` createSession:
```ts
  const { data: locRows, error: locErr } = await sb
    .from("user_locations")
    .select("location_id")
    .eq("user_id", userId)
    .eq("active", true);
```

`app/api/users/login-options/route.ts`:
```ts
  const { data: assignments, error: assignErr } = await sb
    .from("user_locations")
    .select("user_id")
    .eq("location_id", locationId)
    .eq("active", true);
```

Apply the same `.eq("active", true)` addition to the `lib/profiles.ts` (2), `lib/team-metrics.ts` (3), and `lib/checklists.ts` (1) reads. Do not change any other logic.

- [ ] **Step 3: Live smoke**

Write `scripts/_smoke_active_filter.ts` (uses service-role; pick any existing assigned user+location, flip one row to active=false, assert it disappears from a reader, then restore):
```ts
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  const { data: row } = await sb.from("user_locations").select("user_id, location_id, active").eq("active", true).limit(1).maybeSingle();
  if (!row) { console.log("SKIP: no active assignment to test"); return; }
  const { user_id, location_id } = row as { user_id: string; location_id: string };

  const before = await sb.from("user_locations").select("user_id").eq("location_id", location_id).eq("active", true);
  const beforeHas = (before.data ?? []).some((r) => (r as { user_id: string }).user_id === user_id);

  await sb.from("user_locations").update({ active: false }).eq("user_id", user_id).eq("location_id", location_id);
  const during = await sb.from("user_locations").select("user_id").eq("location_id", location_id).eq("active", true);
  const duringHas = (during.data ?? []).some((r) => (r as { user_id: string }).user_id === user_id);

  await sb.from("user_locations").update({ active: true }).eq("user_id", user_id).eq("location_id", location_id); // restore

  if (beforeHas && !duringHas) console.log("ACTIVE FILTER SMOKE PASSED");
  else { console.error(`FAILED beforeHas=${beforeHas} duringHas=${duringHas}`); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
```
Run: `npx tsx --env-file=.env.local scripts/_smoke_active_filter.ts` → `ACTIVE FILTER SMOKE PASSED`. (This validates the filter semantics against live data and restores state.)

- [ ] **Step 4: Typecheck + delete smoke + commit**

```bash
npm run typecheck
rm scripts/_smoke_active_filter.ts
git add lib/session.ts app/api/users/login-options/route.ts lib/profiles.ts lib/team-metrics.ts lib/checklists.ts
git commit -m "feat(admin): filter user_locations.active=true in all 8 readers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `revokeAllUserSessions` helper

**Files:** Modify `lib/session.ts`; Test `scripts/_smoke_revoke_all.ts`.

- [ ] **Step 1: Ground-truth**

Re-read `lib/session.ts` `revokeSession` (the single-session idempotent pattern, `.is("revoked_at", null)`) to mirror its shape. Confirm `getServiceRoleClient` is already imported.

- [ ] **Step 2: Write the failing smoke** `scripts/_smoke_revoke_all.ts`:
```ts
import { revokeAllUserSessions } from "@/lib/session";
// Type-only existence check: if the export is missing, tsx import throws.
console.log(typeof revokeAllUserSessions === "function" ? "EXPORT OK" : "MISSING");
```
Run `npx tsx scripts/_smoke_revoke_all.ts` → expect failure (export missing).

- [ ] **Step 3: Implement** — add to `lib/session.ts` near `revokeSession`:
```ts
/**
 * Revoke ALL active sessions for a user (service-role). Used by admin
 * auth-affecting mutations (role/location/credential change, deactivate) so
 * the change takes effect immediately rather than waiting on the ≤12h JWT exp.
 * Mirrors revokeSession's idempotent .is("revoked_at", null) filter.
 */
export async function revokeAllUserSessions(userId: string): Promise<{ count: number }> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("revoked_at", null)
    .select("id");
  if (error) throw new Error(`revokeAllUserSessions failed: ${error.message}`);
  return { count: data?.length ?? 0 };
}
```

- [ ] **Step 4: Verify** — `npx tsx scripts/_smoke_revoke_all.ts` → `EXPORT OK`; `npm run typecheck` → clean.

- [ ] **Step 5: Delete smoke + commit**
```bash
rm scripts/_smoke_revoke_all.ts
git add lib/session.ts
git commit -m "feat(admin): revokeAllUserSessions(userId) helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Add `user.reset_password` to the destructive vocab

**Files:** Modify `lib/destructive-actions.ts`.

- [ ] **Step 1: Ground-truth** — open `lib/destructive-actions.ts`; find the `user.*` entries (`user.reset_pin`, `user.set_pin`, `user.change_email`, …) and the array/type they live in.

- [ ] **Step 2: Add the entry** — insert `"user.reset_password",` adjacent to `"user.reset_pin",` in the destructive-actions list (and, if a union type of action strings exists in the same file, add it there too so it stays in the type).

- [ ] **Step 3: Verify + commit**
```bash
npm run typecheck
git add lib/destructive-actions.ts
git commit -m "feat(admin): add user.reset_password to destructive-actions vocab

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `lib/admin/users.ts` — types + read loaders

**Files:** Create `lib/admin/users.ts`; Test `scripts/_smoke_admin_users_read.ts`.

- [ ] **Step 1: Ground-truth** — re-read `lib/session.ts` (`AuthContext`, `UserRow`/`mapUser` fields), `lib/roles.ts` (`RoleCode`, `getRoleLevel`, `canActOn`), `lib/locations.ts` (`isAllLocationsAccess`, `accessibleLocations`, `LocationActor`), `lib/supabase-server.ts` (`getServiceRoleClient`), `app/api/users/login-options/route.ts` (the two-step cross-table read pattern). Confirm `getRoleLevel` + `canActOn` signatures.

- [ ] **Step 2: Write the failing smoke** `scripts/_smoke_admin_users_read.ts`:
```ts
import { listUsers, getUserDetail } from "@/lib/admin/users";
async function main() {
  const users = await listUsers({});
  if (!Array.isArray(users)) { console.error("listUsers not array"); process.exit(1); }
  if (users.length > 0) {
    const u = users[0]!;
    for (const k of ["id","name","role","level","active","locationIds"] as const) {
      if (!(k in u)) { console.error(`missing ${k}`); process.exit(1); }
    }
    const detail = await getUserDetail(u.id);
    if (!detail || detail.id !== u.id) { console.error("getUserDetail mismatch"); process.exit(1); }
  }
  console.log("ADMIN USERS READ SMOKE PASSED");
}
main().catch((e) => { console.error(e); process.exit(1); });
```
Run `npx tsx --env-file=.env.local scripts/_smoke_admin_users_read.ts` → fail (module missing).

- [ ] **Step 3: Implement `lib/admin/users.ts`** (types + read loaders):
```ts
/**
 * Admin user-management data layer (C.44 Module 2).
 *
 * SERVER-ONLY. Service-role client throughout — admin authorization is enforced
 * APP-LAYER by the calling routes (requireSession → level >= 8 → assertStepUp →
 * canActOn) and re-checked here for target-bound mutations (defense in depth).
 * Service-role bypasses RLS by design, consistent with the foundation + the
 * Phase 2.5 provisioning pattern.
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { type RoleCode, getRoleLevel, canActOn } from "@/lib/roles";
import { isAllLocationsAccess } from "@/lib/locations";
import { hashPin, hashPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { revokeAllUserSessions } from "@/lib/session";
import type { AuthContext } from "@/lib/session";

export interface AdminUserListItem {
  id: string;
  name: string;
  email: string | null;
  role: RoleCode;
  level: number;
  active: boolean;
  lastLoginAt: string | null;
  locationIds: string[]; // active assignments only
}

export interface AdminUserDetail extends AdminUserListItem {
  phone: string | null;
  emailVerified: boolean;
  createdAt: string;
  createdBy: string | null;
  lockedUntil: string | null;
}

export interface ListUsersFilters {
  role?: RoleCode;
  active?: boolean;
  locationId?: string;
  query?: string; // matches name/email substring (case-insensitive)
}

/** Typed error the routes map to jsonError(status, code). */
export class AdminUserError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
    this.name = "AdminUserError";
  }
}

interface DbUserRow {
  id: string; name: string; email: string | null; role: RoleCode;
  active: boolean; last_login_at: string | null; phone: string | null;
  email_verified: boolean; created_at: string; created_by: string | null;
  locked_until: string | null;
}

const LIST_COLS = "id, name, email, role, active, last_login_at";
const DETAIL_COLS =
  "id, name, email, role, active, last_login_at, phone, email_verified, created_at, created_by, locked_until";

/** Map user_id → active location_ids, for the given user ids. */
async function activeLocationsByUser(userIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (userIds.length === 0) return map;
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("user_locations")
    .select("user_id, location_id")
    .in("user_id", userIds)
    .eq("active", true);
  if (error) throw new Error(`activeLocationsByUser failed: ${error.message}`);
  for (const r of data ?? []) {
    const row = r as { user_id: string; location_id: string };
    const arr = map.get(row.user_id) ?? [];
    arr.push(row.location_id);
    map.set(row.user_id, arr);
  }
  return map;
}

export async function listUsers(filters: ListUsersFilters): Promise<AdminUserListItem[]> {
  const sb = getServiceRoleClient();

  // When filtering by location, resolve the location's active members first
  // (two-step cross-table pattern — login-options precedent).
  let idFilter: string[] | null = null;
  if (filters.locationId) {
    const { data: ul, error: ulErr } = await sb
      .from("user_locations")
      .select("user_id")
      .eq("location_id", filters.locationId)
      .eq("active", true);
    if (ulErr) throw new Error(`listUsers location filter failed: ${ulErr.message}`);
    idFilter = (ul ?? []).map((r) => (r as { user_id: string }).user_id);
    if (idFilter.length === 0) return [];
  }

  let q = sb.from("users").select(LIST_COLS).order("name", { ascending: true });
  if (filters.role) q = q.eq("role", filters.role);
  if (typeof filters.active === "boolean") q = q.eq("active", filters.active);
  if (idFilter) q = q.in("id", idFilter);
  if (filters.query && filters.query.trim()) {
    const term = `%${filters.query.trim()}%`;
    q = q.or(`name.ilike.${term},email.ilike.${term}`);
  }

  const { data, error } = await q.returns<DbUserRow[]>();
  if (error) throw new Error(`listUsers failed: ${error.message}`);
  const rows = data ?? [];
  const locMap = await activeLocationsByUser(rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id, name: r.name, email: r.email, role: r.role,
    level: getRoleLevel(r.role), active: r.active, lastLoginAt: r.last_login_at,
    locationIds: locMap.get(r.id) ?? [],
  }));
}

export async function getUserDetail(id: string): Promise<AdminUserDetail | null> {
  const sb = getServiceRoleClient();
  const { data, error } = await sb
    .from("users").select(DETAIL_COLS).eq("id", id).maybeSingle<DbUserRow>();
  if (error) throw new Error(`getUserDetail failed: ${error.message}`);
  if (!data) return null;
  const locMap = await activeLocationsByUser([id]);
  return {
    id: data.id, name: data.name, email: data.email, role: data.role,
    level: getRoleLevel(data.role), active: data.active, lastLoginAt: data.last_login_at,
    phone: data.phone, emailVerified: data.email_verified, createdAt: data.created_at,
    createdBy: data.created_by, lockedUntil: data.locked_until,
    locationIds: locMap.get(id) ?? [],
  };
}

/** Shared guard for target-bound mutations: load target + canActOn. */
async function loadActionableTarget(actor: AuthContext, id: string): Promise<AdminUserDetail> {
  const target = await getUserDetail(id);
  if (!target) throw new AdminUserError(404, "not_found", "User not found");
  if (!canActOn(actor.user.role, target.role)) {
    throw new AdminUserError(403, "forbidden", "Cannot act on a peer or senior");
  }
  return target;
}
```

- [ ] **Step 4: Verify** — `npx tsx --env-file=.env.local scripts/_smoke_admin_users_read.ts` → `ADMIN USERS READ SMOKE PASSED`; `npm run typecheck` → clean.

- [ ] **Step 5: Delete smoke + commit**
```bash
rm scripts/_smoke_admin_users_read.ts
git add lib/admin/users.ts
git commit -m "feat(admin): user-management data layer — types + read loaders

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: `createUser` (bridge creation)

**Files:** Modify `lib/admin/users.ts`; Test `scripts/_smoke_create_user.ts`.

- [ ] **Step 1: Ground-truth** — re-read `scripts/phase-2.5-provision-temp-users.ts` (lowercase email, pre-flight unique check, `email_verified=true`, placeholder PIN, user.create audit), `lib/roles.ts` `hasEmailAuth`/`minPinLength`, `lib/locations.ts` `isAllLocationsAccess`.

- [ ] **Step 2: Write the failing smoke** `scripts/_smoke_create_user.ts` (creates a throwaway PIN-only user at a real location, asserts it lands + has the active location, then hard-cleans it up — creation smokes are the one place we delete rows, since they're test artifacts, via service-role):
```ts
import { createUser } from "@/lib/admin/users";
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  // Use a high-level actor (cgs) so canActOn passes for an employee target.
  const { data: actorRow } = await sb.from("users").select("id, role").eq("role", "cgs").eq("active", true).limit(1).maybeSingle();
  const { data: loc } = await sb.from("locations").select("id").eq("active", true).limit(1).maybeSingle();
  if (!actorRow || !loc) { console.log("SKIP: need a cgs + a location"); return; }
  const actor = { user: { id: (actorRow as any).id, role: (actorRow as any).role } } as any;
  const email = `_smoketest_${actorRow ? "x" : "y"}@example.com`.toLowerCase();
  await sb.from("users").delete().eq("email", email); // clean any prior run

  const { userId } = await createUser(actor, {
    name: "Smoke Test", role: "employee", email: null,
    tempPin: "1234", tempPassword: null, locationIds: [(loc as any).id],
  });
  const { data: u } = await sb.from("users").select("id, role, active, email_verified, pin_hash").eq("id", userId).maybeSingle();
  const { data: ul } = await sb.from("user_locations").select("location_id, active").eq("user_id", userId);
  const ok = !!u && (u as any).active && (u as any).email_verified && !!(u as any).pin_hash
    && (ul ?? []).length === 1 && (ul as any)[0].active === true;
  // cleanup (test artifact)
  await sb.from("user_locations").delete().eq("user_id", userId);
  await sb.from("audit_log").delete().eq("resource_id", userId).eq("action", "user.create");
  await sb.from("users").delete().eq("id", userId);
  if (ok) console.log("CREATE USER SMOKE PASSED"); else { console.error("FAILED"); process.exit(1); }
}
main().catch((e) => { console.error(e); process.exit(1); });
```
Run → fail (createUser missing).

- [ ] **Step 3: Implement** — append to `lib/admin/users.ts`:
```ts
import { ROLES } from "@/lib/roles";

const ADMIN_MIN_LEVEL = 8;
const ALL_LOCATIONS_THRESHOLD = 9; // mirror lib/locations.ts (kept local; see note)

export interface CreateUserInput {
  name: string;
  role: RoleCode;
  email: string | null;
  tempPin: string;
  tempPassword: string | null;
  locationIds: string[];
}

function assertValidPin(pin: string): void {
  if (!/^\d{4}$/.test(pin)) throw new AdminUserError(400, "invalid_pin", "PIN must be exactly 4 digits");
}

export async function createUser(actor: AuthContext, input: CreateUserInput): Promise<{ userId: string }> {
  const sb = getServiceRoleClient();
  const role = input.role;

  // canActOn — can only create roles strictly below the actor's level.
  if (!canActOn(actor.user.role, role)) {
    throw new AdminUserError(403, "forbidden", "Cannot create a user at or above your level");
  }
  const name = input.name.trim();
  if (!name) throw new AdminUserError(400, "invalid_name", "Name is required");

  assertValidPin(input.tempPin);

  const level = getRoleLevel(role);
  const emailAuth = ROLES[role].hasEmailAuth; // true for L>=6
  let email: string | null = null;
  if (emailAuth) {
    if (!input.email || !input.email.trim()) {
      throw new AdminUserError(400, "email_required", "Email is required for this role");
    }
    email = input.email.trim().toLowerCase();
    if (!input.tempPassword || input.tempPassword.length < 8) {
      throw new AdminUserError(400, "password_required", "Temp password (≥8 chars) is required for this role");
    }
  } else if (input.email && input.email.trim()) {
    email = input.email.trim().toLowerCase(); // optional for PIN-only roles
  }

  // Locations: required + within actor's accessible set for L<9; ignored for L>=9.
  let locationIds: string[] = [];
  if (level < ALL_LOCATIONS_THRESHOLD) {
    locationIds = [...new Set(input.locationIds)];
    if (locationIds.length === 0) {
      throw new AdminUserError(400, "locations_required", "Assign at least one location for this role");
    }
    const actorAll = isAllLocationsAccess({ role: actor.user.role, locations: actor.locations });
    if (!actorAll) {
      const allowed = new Set(actor.locations);
      if (!locationIds.every((l) => allowed.has(l))) {
        throw new AdminUserError(403, "forbidden", "Location not in your accessible set");
      }
    }
  }

  // Pre-flight unique email (clearer than a 23505).
  if (email) {
    const { data: existing, error: exErr } = await sb
      .from("users").select("id").ilike("email", email).maybeSingle();
    if (exErr) throw new Error(`createUser email pre-flight failed: ${exErr.message}`);
    if (existing) throw new AdminUserError(409, "email_taken", "Email already in use");
  }

  const pinHash = await hashPin(input.tempPin);
  const passwordHash = emailAuth ? await hashPassword(input.tempPassword as string) : null;

  const { data: row, error: insErr } = await sb
    .from("users")
    .insert({
      name, email, role, active: true,
      email_verified: emailAuth, // verified-by-admin bridge (no verify email possible)
      email_verified_at: emailAuth ? new Date().toISOString() : null,
      pin_hash: pinHash, password_hash: passwordHash,
      created_by: actor.user.id,
    })
    .select("id").maybeSingle<{ id: string }>();
  if (insErr) throw new Error(`createUser insert failed: ${insErr.message}`);
  if (!row) throw new Error("createUser insert returned no row");

  if (locationIds.length > 0) {
    const { error: locErr } = await sb.from("user_locations").insert(
      locationIds.map((location_id) => ({ user_id: row.id, location_id, assigned_by: actor.user.id, active: true })),
    );
    if (locErr) throw new Error(`createUser user_locations insert failed: ${locErr.message}`);
  }

  await audit({
    actorId: actor.user.id, actorRole: actor.user.role, action: "user.create",
    resourceTable: "users", resourceId: row.id,
    metadata: {
      creation_method: "admin_ui", created_role: role, created_role_level: level,
      created_locations: locationIds, email_pipeline_used: false,
      // NEVER include raw PIN/password.
    },
    ipAddress: null, userAgent: null,
  });

  return { userId: row.id };
}
```
> Note: `ALL_LOCATIONS_THRESHOLD` is duplicated locally (the exported helpers in `lib/locations.ts` work on the sentinel, not a raw number). Keep the literal in sync with `lib/locations.ts`; add an inline comment saying so.

- [ ] **Step 4: Verify** — run the smoke → `CREATE USER SMOKE PASSED`; `npm run typecheck` clean.

- [ ] **Step 5: Delete smoke + commit**
```bash
rm scripts/_smoke_create_user.ts
git add lib/admin/users.ts
git commit -m "feat(admin): createUser (bridge temp-cred provisioning via UI)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Mutators (profile / pin / password / role / locations / active)

**Files:** Modify `lib/admin/users.ts`; Test `scripts/_smoke_admin_mutators.ts`.

- [ ] **Step 1: Ground-truth** — re-read the `audit()` signature + `revokeAllUserSessions` (Task 3) + `canActOn`. Confirm the destructive action names (`user.change_email`, `user.reset_pin`, `user.reset_password`, `user.promote`, `user.demote`, `user.change_locations`, `user.deactivate`, `user.activate`).

- [ ] **Step 2: Write the failing smoke** `scripts/_smoke_admin_mutators.ts` (create a throwaway employee, exercise each mutator with a cgs actor, assert effects, clean up):
```ts
import { createUser, updateUserProfile, resetPin, changeRole, setLocations, setActive } from "@/lib/admin/users";
import { createClient } from "@supabase/supabase-js";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

async function main() {
  const { data: a } = await sb.from("users").select("id, role").eq("role","cgs").eq("active",true).limit(1).maybeSingle();
  const { data: locs } = await sb.from("locations").select("id").eq("active",true).limit(2);
  if (!a || !locs || locs.length < 1) { console.log("SKIP"); return; }
  const actor = { user: { id: (a as any).id, role: (a as any).role }, locations: [] } as any;
  await sb.from("users").delete().eq("email","_smoke_mut@example.com");
  const { userId } = await createUser(actor, { name:"Mut", role:"employee", email:null, tempPin:"1234", tempPassword:null, locationIds:[(locs as any)[0].id] });

  await updateUserProfile(actor, userId, { name: "Mut2" });
  await resetPin(actor, userId, "5678");
  await changeRole(actor, userId, "key_holder");
  await setLocations(actor, userId, (locs as any).map((l:any)=>l.id));
  await setActive(actor, userId, false);

  const { data: u } = await sb.from("users").select("name, role, active").eq("id", userId).maybeSingle();
  const { data: ul } = await sb.from("user_locations").select("location_id, active").eq("user_id", userId);
  const ok = (u as any).name==="Mut2" && (u as any).role==="key_holder" && (u as any).active===false
    && (ul ?? []).filter((r:any)=>r.active).length === (locs as any).length;

  await sb.from("user_locations").delete().eq("user_id", userId);
  await sb.from("audit_log").delete().eq("resource_id", userId);
  await sb.from("users").delete().eq("id", userId);
  if (ok) console.log("MUTATORS SMOKE PASSED"); else { console.error("FAILED"); process.exit(1); }
}
main().catch((e)=>{console.error(e);process.exit(1);});
```
Run → fail (mutators missing).

- [ ] **Step 3: Implement** — append to `lib/admin/users.ts`:
```ts
export async function updateUserProfile(
  actor: AuthContext, id: string,
  patch: { name?: string; phone?: string | null; email?: string | null },
): Promise<void> {
  const target = await loadActionableTarget(actor, id);
  const sb = getServiceRoleClient();
  const update: Record<string, unknown> = {};
  let emailChanged = false;
  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (!n) throw new AdminUserError(400, "invalid_name", "Name cannot be empty");
    update.name = n;
  }
  if (patch.phone !== undefined) update.phone = patch.phone?.trim() || null;
  if (patch.email !== undefined) {
    const e = patch.email?.trim() ? patch.email.trim().toLowerCase() : null;
    if (e && e !== target.email) {
      const { data: ex } = await sb.from("users").select("id").ilike("email", e).neq("id", id).maybeSingle();
      if (ex) throw new AdminUserError(409, "email_taken", "Email already in use");
    }
    update.email = e; emailChanged = e !== target.email;
  }
  if (Object.keys(update).length === 0) return;
  const { error } = await sb.from("users").update(update).eq("id", id);
  if (error) throw new Error(`updateUserProfile failed: ${error.message}`);
  if (emailChanged) {
    await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "user.change_email",
      resourceTable: "users", resourceId: id, metadata: { fields: Object.keys(update) }, ipAddress: null, userAgent: null });
  }
}

async function setCredential(
  actor: AuthContext, id: string, kind: "pin" | "password", value: string,
): Promise<void> {
  await loadActionableTarget(actor, id);
  const sb = getServiceRoleClient();
  if (kind === "pin") {
    if (!/^\d{4}$/.test(value)) throw new AdminUserError(400, "invalid_pin", "PIN must be 4 digits");
    const { error } = await sb.from("users").update({ pin_hash: await hashPin(value) }).eq("id", id);
    if (error) throw new Error(`resetPin failed: ${error.message}`);
  } else {
    if (value.length < 8) throw new AdminUserError(400, "invalid_password", "Password must be ≥8 chars");
    const { error } = await sb.from("users").update({ password_hash: await hashPassword(value) }).eq("id", id);
    if (error) throw new Error(`setPassword failed: ${error.message}`);
  }
  const { count } = await revokeAllUserSessions(id);
  await audit({ actorId: actor.user.id, actorRole: actor.user.role,
    action: kind === "pin" ? "user.reset_pin" : "user.reset_password",
    resourceTable: "users", resourceId: id, metadata: { sessions_revoked: count }, ipAddress: null, userAgent: null });
}

export const resetPin = (actor: AuthContext, id: string, pin: string) => setCredential(actor, id, "pin", pin);
export const setPassword = (actor: AuthContext, id: string, pw: string) => setCredential(actor, id, "password", pw);

export async function changeRole(actor: AuthContext, id: string, newRole: RoleCode): Promise<void> {
  const target = await loadActionableTarget(actor, id);
  // The actor must also outrank the NEW role (can't promote someone to >= self).
  if (!canActOn(actor.user.role, newRole)) {
    throw new AdminUserError(403, "forbidden", "Cannot assign a role at or above your level");
  }
  if (newRole === target.role) return;
  const sb = getServiceRoleClient();
  const { error } = await sb.from("users").update({ role: newRole }).eq("id", id);
  if (error) throw new Error(`changeRole failed: ${error.message}`);
  const promote = getRoleLevel(newRole) > getRoleLevel(target.role);
  const { count } = await revokeAllUserSessions(id);
  await audit({ actorId: actor.user.id, actorRole: actor.user.role,
    action: promote ? "user.promote" : "user.demote", resourceTable: "users", resourceId: id,
    metadata: { from_role: target.role, to_role: newRole, sessions_revoked: count }, ipAddress: null, userAgent: null });
}

export async function setLocations(actor: AuthContext, id: string, locationIds: string[]): Promise<void> {
  await loadActionableTarget(actor, id);
  const sb = getServiceRoleClient();
  const desired = new Set(locationIds);
  // Actor scoping: non-all-locations admins can only touch their own locations.
  const actorAll = isAllLocationsAccess({ role: actor.user.role, locations: actor.locations });
  if (!actorAll) {
    const allowed = new Set(actor.locations);
    if (![...desired].every((l) => allowed.has(l))) {
      throw new AdminUserError(403, "forbidden", "Location not in your accessible set");
    }
  }
  // Load ALL rows (active + inactive) so we flip rather than duplicate.
  const { data: rows, error: rErr } = await sb.from("user_locations").select("location_id, active").eq("user_id", id);
  if (rErr) throw new Error(`setLocations read failed: ${rErr.message}`);
  const current = new Map((rows ?? []).map((r) => [(r as any).location_id as string, (r as any).active as boolean]));

  for (const locId of desired) {
    if (!current.has(locId)) {
      const { error } = await sb.from("user_locations").insert({ user_id: id, location_id: locId, assigned_by: actor.user.id, active: true });
      if (error) throw new Error(`setLocations insert failed: ${error.message}`);
    } else if (current.get(locId) === false) {
      const { error } = await sb.from("user_locations").update({ active: true, assigned_by: actor.user.id }).eq("user_id", id).eq("location_id", locId);
      if (error) throw new Error(`setLocations reactivate failed: ${error.message}`);
    }
  }
  for (const [locId, active] of current) {
    if (active && !desired.has(locId)) {
      // Actor scoping also applies to removals (only of locations they can see).
      if (!actorAll && !actor.locations.includes(locId)) continue;
      const { error } = await sb.from("user_locations").update({ active: false }).eq("user_id", id).eq("location_id", locId);
      if (error) throw new Error(`setLocations deactivate failed: ${error.message}`);
    }
  }
  const { count } = await revokeAllUserSessions(id);
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "user.change_locations",
    resourceTable: "users", resourceId: id, metadata: { locations: [...desired], sessions_revoked: count }, ipAddress: null, userAgent: null });
}

export async function setActive(actor: AuthContext, id: string, active: boolean): Promise<void> {
  await loadActionableTarget(actor, id);
  const sb = getServiceRoleClient();
  const { error } = await sb.from("users").update({ active }).eq("id", id);
  if (error) throw new Error(`setActive failed: ${error.message}`);
  if (!active) {
    const { count } = await revokeAllUserSessions(id);
    await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "user.deactivate",
      resourceTable: "users", resourceId: id, metadata: { sessions_revoked: count }, ipAddress: null, userAgent: null });
  } else {
    await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "user.activate",
      resourceTable: "users", resourceId: id, metadata: {}, ipAddress: null, userAgent: null });
  }
}
```

- [ ] **Step 4: Verify** — smoke → `MUTATORS SMOKE PASSED`; `npm run typecheck` clean.

- [ ] **Step 5: Delete smoke + commit**
```bash
rm scripts/_smoke_admin_mutators.ts
git add lib/admin/users.ts
git commit -m "feat(admin): user mutators (profile/pin/password/role/locations/active)

Each canActOn-guarded, audited; auth-affecting ones revoke target sessions.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: API — `GET`/`POST /api/admin/users`

**Files:** Modify `app/api/admin/users/route.ts` (replace the 501 stub).

- [ ] **Step 1: Ground-truth** — re-read the 501 stub; re-read `app/api/auth/step-up/route.ts` for the route shape (requireSession → checks → jsonError/jsonOk pattern) and `lib/admin/step-up.ts` `assertStepUp` return shape.

- [ ] **Step 2: Implement** `app/api/admin/users/route.ts`:
```ts
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES, isRoleCode } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody, extractIp } from "@/lib/api-helpers";
import { listUsers, createUser, AdminUserError, type CreateUserInput } from "@/lib/admin/users";

const ADMIN_MIN_LEVEL = 8;

export async function GET(req: NextRequest) {
  const ctx = await requireSession(req, "/api/admin/users");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < ADMIN_MIN_LEVEL) return jsonError(403, "forbidden");

  const url = new URL(req.url);
  const role = url.searchParams.get("role");
  const active = url.searchParams.get("active");
  const locationId = url.searchParams.get("location") ?? undefined;
  const query = url.searchParams.get("q") ?? undefined;
  try {
    const users = await listUsers({
      role: role && isRoleCode(role) ? role : undefined,
      active: active === "true" ? true : active === "false" ? false : undefined,
      locationId, query,
    });
    return jsonOk({ users });
  } catch (e) {
    if (e instanceof AdminUserError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}

export async function POST(req: NextRequest) {
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, "/api/admin/users");
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < ADMIN_MIN_LEVEL) return jsonError(403, "forbidden");

  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as Partial<CreateUserInput>;
  if (typeof b.name !== "string" || typeof b.role !== "string" || !isRoleCode(b.role) || typeof b.tempPin !== "string") {
    return jsonError(400, "invalid_payload", { message: "name, role, tempPin required" });
  }
  try {
    const { userId } = await createUser(ctx, {
      name: b.name, role: b.role,
      email: typeof b.email === "string" ? b.email : null,
      tempPin: b.tempPin,
      tempPassword: typeof b.tempPassword === "string" ? b.tempPassword : null,
      locationIds: Array.isArray(b.locationIds) ? b.locationIds.filter((x): x is string => typeof x === "string") : [],
    });
    return jsonOk({ userId }, 201);
  } catch (e) {
    if (e instanceof AdminUserError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```
> If `isRoleCode` doesn't exist in `lib/roles.ts`, add it: `export function isRoleCode(v: string): v is RoleCode { return v in ROLES; }` (check first — `login-options` imports `isRoleCode`, so it already exists).

- [ ] **Step 3: Verify + commit** — `npm run typecheck` clean.
```bash
git add app/api/admin/users/route.ts lib/roles.ts
git commit -m "feat(admin): GET (list) + POST (create) /api/admin/users

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: API — `GET`/`PATCH /api/admin/users/[id]`

**Files:** Create `app/api/admin/users/[id]/route.ts`.

- [ ] **Step 1: Ground-truth** — confirm the Next 16 dynamic-route param signature in this repo (params are async: `{ params }: { params: Promise<{ id: string }> }`). Check an existing `[id]` route (e.g. `app/api/admin/vendors/[id]/route.ts` stub or `app/reports/[type]/[id]`) for the exact shape.

- [ ] **Step 2: Implement** `app/api/admin/users/[id]/route.ts`:
```ts
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { getUserDetail, updateUserProfile, AdminUserError } from "@/lib/admin/users";

const ADMIN_MIN_LEVEL = 8;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSession(req, `/api/admin/users/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < ADMIN_MIN_LEVEL) return jsonError(403, "forbidden");
  const detail = await getUserDetail(id);
  if (!detail) return jsonError(404, "not_found");
  return jsonOk({ user: detail });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/users/${id}`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < ADMIN_MIN_LEVEL) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "A");
  if (!su.ok) return jsonError(403, su.code);

  const b = parsed as { name?: unknown; phone?: unknown; email?: unknown };
  try {
    await updateUserProfile(ctx, id, {
      name: typeof b.name === "string" ? b.name : undefined,
      phone: b.phone === null ? null : typeof b.phone === "string" ? b.phone : undefined,
      email: b.email === null ? null : typeof b.email === "string" ? b.email : undefined,
    });
    return jsonOk({ ok: true });
  } catch (e) {
    if (e instanceof AdminUserError) return jsonError(e.status, e.code, { message: e.message });
    throw e;
  }
}
```

- [ ] **Step 3: Verify + commit** — `npm run typecheck` clean.
```bash
git add app/api/admin/users/[id]/route.ts
git commit -m "feat(admin): GET (detail) + PATCH (profile, Tier A) /api/admin/users/[id]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: API — Tier-B action sub-routes

**Files:** Create `app/api/admin/users/[id]/{reset-pin,set-password,role,locations,deactivate,activate}/route.ts` (6 files).

- [ ] **Step 1: Ground-truth** — confirm the shared shape from Task 9. Each route: `parseJsonBody` (where it has a body) → `requireSession` → `level ≥ 8` → `assertStepUp(ctx, "B")` (map `!ok` → `jsonError(403, su.code)`) → call the mutator (which does `canActOn` + revoke + audit) → map `AdminUserError`.

- [ ] **Step 2: Implement the 6 routes.**

`reset-pin/route.ts`:
```ts
import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/session";
import { ROLES } from "@/lib/roles";
import { assertStepUp } from "@/lib/admin/step-up";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api-helpers";
import { resetPin, AdminUserError } from "@/lib/admin/users";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = await parseJsonBody(req);
  if (parsed instanceof Response) return parsed;
  const ctx = await requireSession(req, `/api/admin/users/${id}/reset-pin`);
  if (ctx instanceof Response) return ctx;
  if (ROLES[ctx.user.role].level < 8) return jsonError(403, "forbidden");
  const su = assertStepUp(ctx, "B");
  if (!su.ok) return jsonError(403, su.code);
  const pin = (parsed as { pin?: unknown }).pin;
  if (typeof pin !== "string") return jsonError(400, "invalid_payload", { field: "pin" });
  try { await resetPin(ctx, id, pin); return jsonOk({ ok: true }); }
  catch (e) { if (e instanceof AdminUserError) return jsonError(e.status, e.code, { message: e.message }); throw e; }
}
```

`set-password/route.ts` — identical shape, body `{ password: string }`, calls `setPassword(ctx, id, password)`, path `…/set-password`.

`role/route.ts` — body `{ role: string }` validated with `isRoleCode`, calls `changeRole(ctx, id, role)`, path `…/role`:
```ts
import { ROLES, isRoleCode } from "@/lib/roles";
// …same scaffold…
  const role = (parsed as { role?: unknown }).role;
  if (typeof role !== "string" || !isRoleCode(role)) return jsonError(400, "invalid_payload", { field: "role" });
  try { await changeRole(ctx, id, role); return jsonOk({ ok: true }); } catch (e) { /* map */ }
```

`locations/route.ts` — body `{ locationIds: string[] }`, calls `setLocations(ctx, id, locationIds)`:
```ts
  const raw = (parsed as { locationIds?: unknown }).locationIds;
  if (!Array.isArray(raw) || !raw.every((x) => typeof x === "string")) return jsonError(400, "invalid_payload", { field: "locationIds" });
  try { await setLocations(ctx, id, raw as string[]); return jsonOk({ ok: true }); } catch (e) { /* map */ }
```

`deactivate/route.ts` — no body, calls `setActive(ctx, id, false)`. `activate/route.ts` — no body, calls `setActive(ctx, id, true)`. (No `parseJsonBody` for these two.)

For each, replicate the requireSession → level≥8 → `assertStepUp(ctx,"B")` → mutator → `AdminUserError` mapping exactly as in `reset-pin`.

- [ ] **Step 3: Verify + commit** — `npm run typecheck` clean.
```bash
git add app/api/admin/users/[id]/reset-pin app/api/admin/users/[id]/set-password app/api/admin/users/[id]/role app/api/admin/users/[id]/locations app/api/admin/users/[id]/deactivate app/api/admin/users/[id]/activate
git commit -m "feat(admin): Tier-B user action routes (pin/password/role/locations/active)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 11: i18n — `admin.users.*`

**Files:** Modify `lib/i18n/en.json`, `lib/i18n/es.json`; Test `scripts/_smoke_i18n_users.ts`.

- [ ] **Step 1: Ground-truth** — open both files at the `admin.*` block (after `admin.back_to_hub`). Confirm parity tooling expectation (identical key sets).

- [ ] **Step 2: Write the parity smoke** `scripts/_smoke_i18n_users.ts` (same shape as the foundation's i18n smoke; REQUIRED list = the new `admin.users.*` keys; also assert full en/es key-set parity).

- [ ] **Step 3: Add the keys** to both files (EN values shown; ES = operational tú-form). Cover: page title/subtitle, filters (role/active/location/search), table headers (name/role/locations/status/last login/actions), create form (heading, each field label + helper, temp-pin/temp-password, "create"), edit/detail labels, action buttons (reset PIN, set password, change role, change locations, deactivate, activate), confirm/cancel, success/error toasts, the "cannot act on peer/senior" disabled hint, and an `admin.users.role.<code>`-free approach (reuse the existing `role.<code>` keys for role labels — do NOT duplicate). Example subset:
```json
"admin.users.title": "User Management",
"admin.users.subtitle": "Create and manage staff accounts.",
"admin.users.filter.role": "Role",
"admin.users.filter.status": "Status",
"admin.users.filter.search": "Search name or email",
"admin.users.col.name": "Name",
"admin.users.col.role": "Role",
"admin.users.col.locations": "Locations",
"admin.users.col.status": "Status",
"admin.users.status.active": "Active",
"admin.users.status.inactive": "Inactive",
"admin.users.create": "Add user",
"admin.users.create.temp_pin": "Temporary PIN (4 digits)",
"admin.users.create.temp_password": "Temporary password",
"admin.users.action.reset_pin": "Reset PIN",
"admin.users.action.set_password": "Set password",
"admin.users.action.change_role": "Change role",
"admin.users.action.change_locations": "Change locations",
"admin.users.action.deactivate": "Deactivate",
"admin.users.action.activate": "Reactivate",
"admin.users.cant_act": "You can only manage users below your role.",
"admin.users.saved": "Saved.",
"admin.users.error.generic": "Something went wrong. Try again."
```
ES counterparts (e.g. `"admin.users.title": "Gestión de Usuarios"`, `"admin.users.create": "Agregar usuario"`, `"admin.users.cant_act": "Solo puedes gestionar usuarios por debajo de tu rol."`, etc.).

- [ ] **Step 4: Verify** — smoke → PASSED; `npm run typecheck` clean.

- [ ] **Step 5: Delete smoke + commit**
```bash
rm scripts/_smoke_i18n_users.ts
git add lib/i18n/en.json lib/i18n/es.json
git commit -m "i18n(admin): admin.users.* keys EN+ES at parity

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 12: Page — `app/admin/users/page.tsx` (list, re-gate ≥8)

**Files:** Modify `app/admin/users/page.tsx` (replace the `PlaceholderCard` stub).

- [ ] **Step 1: Ground-truth** — re-read the current stub; re-read `app/admin/page.tsx` (hub) for the Server-Component pattern (`requireSessionFromHeaders("/admin")`, `serverT`, token classes); re-read `lib/admin/users.ts` `listUsers` + `lib/locations.ts` for the accessible-locations resolution; confirm how to load location names (a `locations` table read for labels).

- [ ] **Step 2: Implement** — a Server Component that:
  1. `const auth = await requireSessionFromHeaders("/admin");`
  2. `if (ROLES[auth.user.role].level < 8) redirect("/dashboard");`
  3. Reads `?role`, `?status`, `?location`, `?q` from `searchParams` (async in Next 16: `searchParams: Promise<{...}>`).
  4. `const users = await listUsers({...})` + loads location name map + the assignable-role set (`Object.values(ROLES).filter(r => canActOn(auth.user.role, r.code))`).
  5. Renders the heading + a client `<UserAdminClient>` (Task 13) passing `users`, `locations`, `assignableRoles`, `actorRole`, `actorLevel`, and the resolved accessible-location list.

Full code:
```tsx
import { redirect } from "next/navigation";
import { requireSessionFromHeaders } from "@/lib/session";
import { ROLES, canActOn } from "@/lib/roles";
import { isAllLocationsAccess } from "@/lib/locations";
import { serverT } from "@/lib/i18n/server";
import { getServiceRoleClient } from "@/lib/supabase-server";
import { listUsers, type ListUsersFilters } from "@/lib/admin/users";
import { UserAdminClient } from "@/components/admin/users/UserAdminClient";
import type { RoleCode } from "@/lib/roles";

export default async function AdminUsersPage({
  searchParams,
}: { searchParams: Promise<{ role?: string; status?: string; location?: string; q?: string }> }) {
  const auth = await requireSessionFromHeaders("/admin");
  if (ROLES[auth.user.role].level < 8) redirect("/dashboard");
  const lang = auth.user.language;
  const sp = await searchParams;

  const filters: ListUsersFilters = {
    role: sp.role && sp.role in ROLES ? (sp.role as RoleCode) : undefined,
    active: sp.status === "active" ? true : sp.status === "inactive" ? false : undefined,
    locationId: sp.location || undefined,
    query: sp.q || undefined,
  };
  const users = await listUsers(filters);

  const sb = getServiceRoleClient();
  const { data: locRows } = await sb.from("locations").select("id, name, code").eq("active", true).order("name");
  const allLocations = (locRows ?? []).map((r) => ({ id: (r as any).id as string, name: (r as any).name as string, code: (r as any).code as string }));
  const actorAll = isAllLocationsAccess({ role: auth.user.role, locations: auth.locations });
  const accessibleLocations = actorAll ? allLocations : allLocations.filter((l) => auth.locations.includes(l.id));
  const assignableRoles = Object.values(ROLES).filter((r) => canActOn(auth.user.role, r.code)).map((r) => r.code);

  return (
    <div>
      <h1 className="text-xl font-extrabold leading-tight text-co-text">{serverT(lang, "admin.users.title")}</h1>
      <p className="mt-1 text-sm text-co-text-muted">{serverT(lang, "admin.users.subtitle")}</p>
      <UserAdminClient
        users={users}
        allLocations={allLocations}
        accessibleLocations={accessibleLocations}
        assignableRoles={assignableRoles}
        actorRole={auth.user.role}
        actorLevel={ROLES[auth.user.role].level}
        currentFilters={{ role: sp.role ?? "", status: sp.status ?? "", location: sp.location ?? "", q: sp.q ?? "" }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify + commit** — `npm run typecheck` (will fail until Task 13 creates `UserAdminClient` — acceptable; commit Task 12 + 13 together OR stub the import). To keep each task green, **defer the commit of Task 12 to the end of Task 13** (they're mutually dependent: page imports the client). Mark this task's commit as combined with Task 13.

---

## Task 13: Client UI — `components/admin/users/*`

**Files:** Create `components/admin/users/UserAdminClient.tsx` (+ subcomponents as needed: `UserRow`, `CreateUserForm`, `UserActionsMenu`). Commit together with Task 12.

- [ ] **Step 1: Ground-truth** — re-read `components/admin/StepUpProvider.tsx` (`useStepUp().requestStepUp(tier)` → `"ok" | "cancelled"`), an existing client form for the fetch/error pattern (e.g. `components/UserMenu.tsx` blurb save: pessimistic, `redirect:"manual"`, error surfacing), and `lib/roles.ts` (`ROLES[code].shortLabel`, `getRoleLevel`, `canActOn`) + `useTranslation`.

- [ ] **Step 2: Implement `UserAdminClient`** — a `"use client"` component that:
  - Holds filter state mirrored to the URL (router.push with query params) OR simple controlled inputs that navigate on change.
  - Renders a filter bar (role select from a full role list, status select, location select, search box).
  - Renders the user table/cards; each row shows name, role (`ROLES[role].shortLabel` via `role.<code>` i18n), active location codes, status, last login, and an actions affordance.
  - **Per-row gating:** actions are enabled only when `canActOn(actorRole, row.role)`; otherwise disabled with the `admin.users.cant_act` tooltip.
  - **Create:** an "Add user" button opening `CreateUserForm` (role dropdown = `assignableRoles`; email + temp-password fields shown only when `ROLES[role].hasEmailAuth`; locations multiselect shown only when `getRoleLevel(role) < 9`, options = `accessibleLocations`; temp PIN always). On submit: `await requestStepUp("A")`; if `"ok"`, `POST /api/admin/users`; on success refresh (`router.refresh()`), on error surface `body.code`/message.
  - **Tier-B actions** (reset PIN, set password, change role, change locations, deactivate/activate): each calls `await requestStepUp("B")` first; if `"ok"`, POSTs the matching sub-route; surfaces errors; `router.refresh()` on success. Reset-PIN/password/role/locations use small inline prompts/modals for their input.
  - All strings via `useTranslation`. Tailwind co-tokens. ≥44px tap targets. No `dangerouslySetInnerHTML`.

  Because this is the largest surface, implement it as a focused set of small components (one file each) rather than one mega-file: `UserAdminClient.tsx` (layout + filter bar + list), `CreateUserForm.tsx`, `UserActions.tsx` (the per-row Tier-B controls). Keep each under ~200 lines.

  > The implementer writes the full component code here following the patterns above; the controller reviews it against: (a) every mutating fetch is preceded by the correct-tier `requestStepUp`; (b) `canActOn` disables peer/senior actions; (c) email/password/locations fields obey the role-conditional rules; (d) errors are surfaced, not swallowed; (e) i18n for every visible string.

- [ ] **Step 3: Verify** — `npm run typecheck` + `npm run build` both clean (this is the first full build of the module).

- [ ] **Step 4: Commit (Task 12 + 13 together)**
```bash
git add app/admin/users/page.tsx components/admin/users
git commit -m "feat(admin): user management UI (list + create + Tier-B actions)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 14: Final gate + push

- [ ] **Step 1: No smokes committed** — `git ls-files 'scripts/_smoke_*.ts'` → empty.
- [ ] **Step 2: Full gate** — `npm run typecheck && npm run build` → both clean.
- [ ] **Step 3: Push** — `git push -u origin claude/user-management`.
- [ ] **Step 4: Hand off** — report to the controller for PR creation + Juan's preview smoke (create→login, role/location change→forced re-auth, reset-PIN old-fails/new-works, deactivate→no-login, `canActOn` hides peer/senior actions). Runtime auth/step-up/revoke flows are Juan-preview-verified, not subagent-verifiable.

---

## Self-Review

**Spec coverage:** migration 0078 (T1) ✓; reader audit incl. createSession (T2) ✓; `revokeAllUserSessions` (T3) ✓; `user.reset_password` vocab (T4) ✓; list/detail (T5) ✓; create bridge w/ all validations + `email_verified` + `canActOn` + locations-subset (T6) ✓; mutators profile/pin/password/role/locations/active w/ audit + revoke (T7) ✓; self-gating API routes incl. step-up tiers + `canActOn` mapping (T8–T10) ✓; i18n parity (T11) ✓; page re-gate ≥8 (T12) ✓; client UI w/ tier-correct `requestStepUp` + `canActOn` disable + role-conditional fields (T13) ✓; final build gate (T14) ✓; deferred performance-band filter recorded in spec, not built ✓.

**Placeholder scan:** the only intentional prose-not-code is Task 13's component bodies (the largest, most layout-variable surface) — guided by explicit acceptance criteria + ground-truth patterns rather than full verbatim code, which is the honest call for a big interactive UI; all logic-critical lib/route code is complete verbatim. No TBD/TODO/"handle errors" anywhere.

**Type consistency:** `AdminUserError(status, code)` thrown in lib (T5–T7), caught+mapped in every route (T8–T10) ✓. `AuthContext` actor threaded consistently (`actor.user.id`/`actor.user.role`/`actor.locations`) ✓. `assertStepUp(ctx, "A"|"B")` → `{ok}|{ok:false,code}` used identically across routes ✓. `listUsers(ListUsersFilters)` / `getUserDetail` / `createUser(CreateUserInput)` signatures match between definition (T5/T6) and callers (T8/T12) ✓. `revokeAllUserSessions` (T3) consumed in T7 ✓. `.eq("active", true)` reader set (T2) matches the spec's enumerated 8 sites ✓.

**Flag for implementer:** Task 8 notes `isRoleCode` should already exist in `lib/roles.ts` (login-options imports it) — verify before adding. Task 12+13 commit together (mutual import). Task 6's local `ALL_LOCATIONS_THRESHOLD = 9` must stay in sync with `lib/locations.ts`.
