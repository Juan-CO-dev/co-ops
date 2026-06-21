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
import { type RoleCode, getRoleLevel, canActOn, ROLES } from "@/lib/roles";
import { hashPin, hashPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isAllLocationsAccess } from "@/lib/locations";
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
  query?: string;
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

/** Shared guard for target-bound mutations (used by Task 7 mutators): load target + canActOn. */
export async function loadActionableTarget(actor: AuthContext, id: string): Promise<AdminUserDetail> {
  const target = await getUserDetail(id);
  if (!target) throw new AdminUserError(404, "not_found", "User not found");
  if (!canActOn(actor.user.role, target.role)) {
    throw new AdminUserError(403, "forbidden", "Cannot act on a peer or senior");
  }
  return target;
}

export const ADMIN_MIN_LEVEL = 8;
const ALL_LOCATIONS_THRESHOLD = 9; // keep in sync with lib/locations.ts

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

  if (!canActOn(actor.user.role, role)) {
    throw new AdminUserError(403, "forbidden", "Cannot create a user at or above your level");
  }
  const name = input.name.trim();
  if (!name) throw new AdminUserError(400, "invalid_name", "Name is required");

  assertValidPin(input.tempPin);

  const level = getRoleLevel(role);
  const emailAuth = ROLES[role].hasEmailAuth;
  let email: string | null = null;
  if (emailAuth) {
    if (!input.email || !input.email.trim()) {
      throw new AdminUserError(400, "email_required", "Email is required for this role");
    }
    email = input.email.trim().toLowerCase();
    if (!input.tempPassword || input.tempPassword.length < 8) {
      throw new AdminUserError(400, "password_required", "Temp password (>=8 chars) is required for this role");
    }
  } else if (input.email && input.email.trim()) {
    email = input.email.trim().toLowerCase();
  }

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
      email_verified: emailAuth,
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
    },
    ipAddress: null, userAgent: null,
  });

  return { userId: row.id };
}

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
    if (value.length < 8) throw new AdminUserError(400, "invalid_password", "Password must be >=8 chars");
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
  const actorAll = isAllLocationsAccess({ role: actor.user.role, locations: actor.locations });
  if (!actorAll) {
    const allowed = new Set(actor.locations);
    if (![...desired].every((l) => allowed.has(l))) {
      throw new AdminUserError(403, "forbidden", "Location not in your accessible set");
    }
  }
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
