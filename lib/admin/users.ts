/**
 * Admin user-management data layer (C.44 Module 2).
 *
 * SERVER-ONLY. Service-role client throughout — admin authorization is enforced
 * APP-LAYER by the calling routes (requireSession → GM+ (`canOpenUserAdmin`) → assertStepUp →
 * canActOn) and re-checked here for target-bound mutations (defense in depth).
 * Service-role bypasses RLS by design, consistent with the foundation + the
 * Phase 2.5 provisioning pattern.
 *
 * GM USER MANAGEMENT (staff separations ADDENDUM, Juan 2026-10-20): a GM manages the people of their own shop(s) only —
 * strictly below GM, every active membership at one of the GM's shops (`userAdminRefusal`, lib/admin/user-access-shared.ts),
 * enforced in `loadActionableTarget` for every target-bound write; the list and the detail are scoped the same way.
 * MoO+ unchanged. Employment status (0279) rides on the list, redacted per viewer (`employmentViewFor`).
 */

import { getServiceRoleClient } from "@/lib/supabase-server";
import { type RoleCode, getRoleLevel, canActOn, ROLES } from "@/lib/roles";
import { hashPin, hashPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { isAllLocationsAccess } from "@/lib/locations";
import { userDormancy, type UserDormancy } from "./dormancy-shared";
import { userAdminListScope, userAdminRefusal, USER_ADMIN_MIN_LEVEL } from "./user-access-shared";
import { employmentViewFor, mayProceedPastRehire, type EmploymentView } from "./employment-shared";
import { findRehireMatches, loadEmploymentStates, stateOf, type RehireMatch } from "./employment";
import { linkToastEmployee, LinkError } from "@/lib/toast/employee-links";
import {
  setUserActiveCall, setUserCredentialCall, setUserDormantCall, setUserLocationsCall, setUserRoleCall, updateUserProfileCall,
  USER_ADMIN_RPC_ERRORS,
} from "./user-admin-rpc-shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { lastClockIns, clockInsByUser } from "./dormancy";
import type { AuthContext } from "@/lib/session";

export interface AdminUserListItem {
  id: string;
  name: string;
  email: string | null;
  role: RoleCode;
  level: number;
  active: boolean;
  lastLoginAt: string | null;
  dormantAt: string | null;
  dormancy: UserDormancy;
  locationIds: string[]; // active assignments only
  /** On leave / separated (0279), redacted for the viewer. Absent when listed without a viewer. */
  employment?: EmploymentView;
}

/** Who is looking at the list (scope + redaction). */
export interface UserListViewer { userId: string; role: RoleCode; locations: readonly string[] }

export interface AdminUserDetail extends Omit<AdminUserListItem, "dormancy"> {
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
  locked_until: string | null; dormant_at: string | null;
}

const LIST_COLS = "id, name, email, role, active, last_login_at, created_at, dormant_at";
const DETAIL_COLS =
  "id, name, email, role, active, last_login_at, phone, email_verified, created_at, created_by, locked_until, dormant_at";

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

export async function listUsers(filters: ListUsersFilters, viewer?: UserListViewer): Promise<AdminUserListItem[]> {
  const sb = getServiceRoleClient();

  let idFilter: string[] | null = null;
  // A GM's list is their own shops' people (a filter on another shop finds no one).
  const scope = viewer ? userAdminListScope(viewer) : null;
  if (scope) {
    const shops = filters.locationId ? scope.filter((l) => l === filters.locationId) : [...scope];
    if (shops.length === 0) return [];
    const { data: ul, error: ulErr } = await sb.from("user_locations").select("user_id").in("location_id", shops).eq("active", true);
    if (ulErr) throw new Error(`listUsers scope failed: ${ulErr.message}`);
    idFilter = [...new Set((ul ?? []).map((r) => (r as { user_id: string }).user_id))];
    if (idFilter.length === 0) return [];
  } else if (filters.locationId) {
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
    // A-WB4-01: the search term is interpolated into a PostgREST `.or()` filter STRING, where
    // commas/parens/quotes/backslash are STRUCTURAL (they'd add predicates or break out of the OR
    // group — filter injection). Strip those so the term can only be a literal name/email fragment.
    // (`%`/`_` remain as ILIKE wildcards — harmless search broadening for an already-all-users admin.)
    const raw = filters.query.trim().replace(/[,()\\"]/g, "");
    if (raw) {
      const term = `%${raw}%`;
      q = q.or(`name.ilike.${term},email.ilike.${term}`);
    }
  }

  const { data, error } = await q.returns<DbUserRow[]>();
  if (error) throw new Error(`listUsers failed: ${error.message}`);
  const rows = data ?? [];
  const locMap = await activeLocationsByUser(rows.map((r) => r.id));
  // A failed history read degrades to "deactivated / marked dormant only", never a broken page.
  const clocks = await lastClockIns(sb, "-infinity").then(clockInsByUser, () => {
    console.warn("admin_clock_ins_failed");
    return null;
  });
  const now = Date.now();
  const employment = viewer ? await loadEmploymentStates(sb, rows.map((r) => r.id)) : null;
  return rows.map((r) => ({
    id: r.id, name: r.name, email: r.email, role: r.role,
    level: getRoleLevel(r.role), active: r.active, lastLoginAt: r.last_login_at,
    locationIds: locMap.get(r.id) ?? [],
    dormantAt: r.dormant_at,
    dormancy: userDormancy({ level: getRoleLevel(r.role), active: r.active, createdAt: r.created_at,
      dormantAt: r.dormant_at, lastClockInAt: clocks?.get(r.id) ?? null, now, clockHistoryKnown: clocks !== null }),
    ...(employment && viewer ? { employment: employmentViewFor(viewer, locMap.get(r.id) ?? [], stateOf(employment, r.id)) } : {}),
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
    dormantAt: data.dormant_at,
  };
}

/**
 * Shared guard for target-bound mutations: load the target, then user management's rule (`userAdminRefusal`):
 * strictly below the actor (canActOn), and for a GM every active membership of the target at one of the GM's shops.
 */
export async function loadActionableTarget(actor: AuthContext, id: string): Promise<AdminUserDetail> {
  const target = await getUserDetail(id);
  if (!target) throw new AdminUserError(404, "not_found", "User not found");
  const refusal = userAdminRefusal({ userId: actor.user.id, role: actor.user.role, locations: actor.locations },
    { id: target.id, role: target.role, locationIds: target.locationIds });
  if (refusal === "target_outside_shop") throw new AdminUserError(403, "target_outside_shop", "That person works at a shop you do not manage");
  if (refusal) throw new AdminUserError(403, "forbidden", "Cannot act on a peer or senior");
  return target;
}

/** A detail read is scoped like the list: a GM reads their own shops' people only (404 otherwise, no existence leak). */
export async function getUserDetailFor(actor: AuthContext, id: string): Promise<AdminUserDetail | null> {
  const detail = await getUserDetail(id);
  if (!detail) return null;
  const scope = userAdminListScope({ role: actor.user.role, locations: actor.locations });
  if (scope && !detail.locationIds.some((l) => scope.includes(l))) return null;
  return detail;
}

/**
 * Every target-bound write goes through a 0279 writer (Astra's review of b3213674, BC-007 / BC-022): the writer takes the
 * per-person lock and the target row FOR UPDATE, re-checks the actor rule on the LOCKED state, then writes — so a
 * promotion, a new shop or a separation that commits after `loadActionableTarget`'s snapshot is SEEN, never written over.
 * `loadActionableTarget` stays as the early, friendly refusal. There is NO fallback: without 0279 the write refuses
 * `user_admin_unavailable` (503) — 0279 reaches prod before this code does.
 */
async function userAdminRpc(sb: SupabaseClient, call: { fn: string; args: Record<string, unknown> }): Promise<Record<string, unknown>> {
  const { data, error } = await sb.rpc(call.fn, call.args);
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message)) throw new AdminUserError(503, "user_admin_unavailable");
    const known = USER_ADMIN_RPC_ERRORS[error.message];
    if (known) throw new AdminUserError(known.status, known.code);
    throw new Error(`${call.fn} failed: ${error.code ?? "unknown"}`);
  }
  return (data ?? {}) as Record<string, unknown>;
}

/** The floor for every user-management route and write (GM). */
export const ADMIN_MIN_LEVEL = USER_ADMIN_MIN_LEVEL;
const ALL_LOCATIONS_THRESHOLD = 9; // keep in sync with lib/locations.ts

export interface CreateUserInput {
  name: string;
  role: RoleCode;
  email: string | null;
  tempPin: string;
  tempPassword: string | null;
  locationIds: string[];
  /** Optional; also the rehire check's key (normalized). */
  phone?: string | null;
  /** Optional: the person's Toast employee at one of the chosen shops — linked after create, and the rehire check's key. */
  toast?: { locationId: string; employeeGuid: string } | null;
  /** The actor saw the rehire warning and proceeds (needs the rehire authority for every match). */
  confirmRehire?: boolean;
}

/** A create that found separated people needing more authority to rehire: the screen shows them (redacted). */
export class RehireMatchError extends AdminUserError {
  constructor(public matches: RehireMatch[], status = 409, code = "rehire_match") { super(status, code); this.name = "RehireMatchError"; }
}

export interface CreateUserResult { userId: string; toastLink: "linked" | "not_requested" | "failed"; toastLinkCode?: string }

function assertValidPin(pin: string): void {
  if (!/^\d{4}$/.test(pin)) throw new AdminUserError(400, "invalid_pin", "PIN must be exactly 4 digits");
}

export async function createUser(actor: AuthContext, input: CreateUserInput): Promise<CreateUserResult> {
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

  const phone = typeof input.phone === "string" && input.phone.trim() ? input.phone.trim() : null;
  if (phone && phone.length > 40) throw new AdminUserError(400, "invalid_payload", "Phone is too long");
  const toast = input.toast ?? null;
  if (toast && (!/^[0-9a-f-]{36}$/i.test(toast.locationId) || !/^[A-Za-z0-9-]{1,64}$/.test(toast.employeeGuid) || !locationIds.includes(toast.locationId))) {
    throw new AdminUserError(400, "invalid_payload", "The Toast employee must be at one of the chosen shops");
  }
  // The rehire warning (0279): a separated person whose rehire setting needs authority, by phone or Toast GUID only.
  const check = await findRehireMatches(sb, { role: actor.user.role, locations: actor.locations },
    { phone, toastGuids: toast ? [toast.employeeGuid] : [] });
  if (check.matches.length > 0) {
    if (!input.confirmRehire) throw new RehireMatchError(check.matches);
    if (check.matches.some((m) => !mayProceedPastRehire(actor.user.role, m.rehire))) throw new RehireMatchError(check.matches, 403, "rehire_permission_required");
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
      phone,
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
      // The rehire warning was seen and passed (ids only, never a reason).
      ...(check.matches.length > 0 ? { rehire_match_override: check.matches.map((m) => m.userId) } : {}),
    },
    ipAddress: null, userAgent: null,
  });

  if (!toast) return { userId: row.id, toastLink: "not_requested" };
  try {
    await linkToastEmployee(sb, { actor: { userId: actor.user.id, role: actor.user.role, locations: actor.locations, level: getRoleLevel(actor.user.role) },
      locationId: toast.locationId, employeeGuid: toast.employeeGuid, userId: row.id });
    return { userId: row.id, toastLink: "linked" };
  } catch (e) {
    // The person exists; only the link was not made (e.g. that Toast employee is linked to another account).
    return { userId: row.id, toastLink: "failed", toastLinkCode: e instanceof LinkError ? e.code : "link_failed" };
  }
}

export async function updateUserProfile(
  actor: AuthContext, id: string,
  patch: { name?: string; phone?: string | null; email?: string | null },
): Promise<void> {
  await loadActionableTarget(actor, id);
  const send: { name?: string; phone?: string | null; email?: string | null } = {};
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new AdminUserError(400, "invalid_name", "Name cannot be empty");
    send.name = patch.name.trim();
  }
  if (patch.phone !== undefined) send.phone = patch.phone?.trim() || null;
  if (patch.email !== undefined) send.email = patch.email?.trim() ? patch.email.trim().toLowerCase() : null;
  if (Object.keys(send).length === 0) return;
  // The writer (0279) re-checks the actor under the target's lock, refuses a taken email, and revokes the sessions on
  // an email change in the same transaction (email is the login identifier for email-auth roles).
  const r = await userAdminRpc(getServiceRoleClient(), updateUserProfileCall({ actorId: actor.user.id, userId: id, patch: send }));
  if (r.email_changed === true) {
    await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "user.change_email",
      resourceTable: "users", resourceId: id, metadata: { fields: r.fields ?? Object.keys(send), sessions_revoked: r.sessions_revoked ?? 0 }, ipAddress: null, userAgent: null });
  }
}

async function setCredential(
  actor: AuthContext, id: string, kind: "pin" | "password", value: string,
): Promise<void> {
  await loadActionableTarget(actor, id);
  if (kind === "pin" && !/^\d{4}$/.test(value)) throw new AdminUserError(400, "invalid_pin", "PIN must be 4 digits");
  if (kind === "password" && value.length < 8) throw new AdminUserError(400, "invalid_password", "Password must be >=8 chars");
  // Hash here; the writer receives the HASH only, re-checks the actor under the lock, writes and revokes in one transaction.
  const hash = kind === "pin" ? await hashPin(value) : await hashPassword(value);
  const r = await userAdminRpc(getServiceRoleClient(), setUserCredentialCall({ actorId: actor.user.id, userId: id, kind, hash }));
  await audit({ actorId: actor.user.id, actorRole: actor.user.role,
    action: kind === "pin" ? "user.reset_pin" : "user.reset_password",
    resourceTable: "users", resourceId: id, metadata: { sessions_revoked: r.sessions_revoked ?? 0 }, ipAddress: null, userAgent: null });
}

export const resetPin = (actor: AuthContext, id: string, pin: string) => setCredential(actor, id, "pin", pin);
export const setPassword = (actor: AuthContext, id: string, pw: string) => setCredential(actor, id, "password", pw);

export async function changeRole(actor: AuthContext, id: string, newRole: RoleCode): Promise<void> {
  const target = await loadActionableTarget(actor, id);
  if (!canActOn(actor.user.role, newRole)) {
    throw new AdminUserError(403, "forbidden", "Cannot assign a role at or above your level");
  }
  if (newRole === target.role) return;
  const r = await userAdminRpc(getServiceRoleClient(), setUserRoleCall({ actorId: actor.user.id, userId: id, role: newRole }));
  if (r.changed !== true) return;
  const from = (typeof r.from_role === "string" ? r.from_role : target.role) as RoleCode;
  const promote = getRoleLevel(newRole) > getRoleLevel(from);
  await audit({ actorId: actor.user.id, actorRole: actor.user.role,
    action: promote ? "user.promote" : "user.demote", resourceTable: "users", resourceId: id,
    metadata: { from_role: from, to_role: newRole, sessions_revoked: r.sessions_revoked ?? 0 }, ipAddress: null, userAgent: null });
}

export async function setLocations(actor: AuthContext, id: string, locationIds: string[]): Promise<void> {
  await loadActionableTarget(actor, id);
  const desired = [...new Set(locationIds)];
  // A GM may move a person between their own shops, never leave them with none (they would drop out of the GM's reach).
  if (getRoleLevel(actor.user.role) < 8 && desired.length === 0) throw new AdminUserError(400, "locations_required");
  const actorAll = isAllLocationsAccess({ role: actor.user.role, locations: actor.locations });
  if (!actorAll) {
    const allowed = new Set(actor.locations);
    if (!desired.every((l) => allowed.has(l))) {
      throw new AdminUserError(403, "forbidden", "Location not in your accessible set");
    }
  }
  // The writer (0279) applies the same rules on the locked rows: below 9 only the actor's shops, memberships elsewhere
  // left alone; then it revokes the sessions in the same transaction.
  const r = await userAdminRpc(getServiceRoleClient(), setUserLocationsCall({ actorId: actor.user.id, userId: id, locationIds: desired }));
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "user.change_locations",
    resourceTable: "users", resourceId: id, metadata: { locations: desired, sessions_revoked: r.sessions_revoked ?? 0 }, ipAddress: null, userAgent: null });
}

export async function setActive(actor: AuthContext, id: string, active: boolean): Promise<void> {
  await loadActionableTarget(actor, id);
  const sb = getServiceRoleClient();
  if (active) {
    // Early, friendly refusal: on leave comes back through "Back from leave"; a separated person only through "Rehire".
    const st = stateOf(await loadEmploymentStates(sb, [id]), id);
    if (st.status === "on_leave") throw new AdminUserError(409, "use_back_from_leave");
    if (st.status === "separated") throw new AdminUserError(409, "use_rehire");
  }
  // THE decision is the writer's (Astra BC-007): under the person's lock it re-reads the employment status, so a
  // separation that committed after the read above refuses the activation; a deactivation revokes the sessions in the
  // same transaction.
  const r = await userAdminRpc(sb, setUserActiveCall({ actorId: actor.user.id, userId: id, active }));
  if (!active) {
    await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "user.deactivate",
      resourceTable: "users", resourceId: id, metadata: { sessions_revoked: r.sessions_revoked ?? 0 }, ipAddress: null, userAgent: null });
  } else {
    await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: "user.activate",
      resourceTable: "users", resourceId: id, metadata: {}, ipAddress: null, userAgent: null });
  }
}

/** Display-only mutation: do not revoke sessions or modify login authorization. */
export async function setDormant(actor: AuthContext, id: string, dormant: boolean): Promise<void> {
  if (getRoleLevel(actor.user.role) < ADMIN_MIN_LEVEL) throw new AdminUserError(403, "forbidden"); // GM+ (user management's floor)
  // Same target checks as setActive: a display flag must not be harder to set than deactivation.
  const target = await loadActionableTarget(actor, id);
  // A stale marker already cleared by a clock-in can be marked again. Clearing it cannot
  // override the automatic clock-in rule; the UI offers wake for manual dormancy only.
  if (dormant ? !target.active : !target.dormantAt) return;
  if (dormant && target.dormantAt) {
    // Only this mutation needs wake evidence; credential and activation writers must not
    // acquire a new dependency on Toast history just to load their actionable target.
    const clocks = clockInsByUser(await lastClockIns(getServiceRoleClient(), "-infinity", { userId: id }));
    const state = userDormancy({ level: target.level, active: target.active, createdAt: target.createdAt,
      dormantAt: target.dormantAt, lastClockInAt: clocks.get(id) ?? null, now: Date.now() });
    if (state.dormant && state.reason === "manual") return;
  }
  // Compare-and-set prevents concurrent taps from emitting duplicate audit rows — inside the 0279 writer, under the lock.
  const r = await userAdminRpc(getServiceRoleClient(), setUserDormantCall({ actorId: actor.user.id, userId: id, dormant, expectedDormantAt: target.dormantAt }));
  if (r.changed !== true) return;
  const at = (r.dormant_at as string | null | undefined) ?? null;
  await audit({ actorId: actor.user.id, actorRole: actor.user.role, action: dormant ? "user.dormant" : "user.wake",
    resourceTable: "users", resourceId: id, metadata: { dormant_at: at }, ipAddress: null, userAgent: null });
}
