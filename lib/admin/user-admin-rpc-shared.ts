/**
 * The user-admin writers of 0279 — the EXACT arguments the lib sends (the PGlite harness calls the same builders).
 * No runtime import: scripts/sql-harness-0279.mjs imports this file with plain node.
 *
 * Every writer takes the ONE gate first (`user_admin_lock`: the per-person lock, the target row FOR UPDATE, the actor row
 * FOR SHARE, the actor rule on the locked state), then writes, in one transaction (Astra's review of b3213674, BC-007 /
 * BC-022: a check on a snapshot followed by a separate write let a promotion, a new shop or a separation slip between).
 */

export interface UserAdminCall<F extends string, A extends Record<string, unknown>> { fn: F; args: A }

export const setUserActiveCall = (a: { actorId: string; userId: string; active: boolean }) =>
  ({ fn: "admin_user_set_active", args: { p_actor: a.actorId, p_user: a.userId, p_active: a.active } }) as const;

/** The HASH, never the plaintext (the lib hashes first). */
export const setUserCredentialCall = (a: { actorId: string; userId: string; kind: "pin" | "password"; hash: string }) =>
  ({ fn: "admin_user_set_credential", args: { p_actor: a.actorId, p_user: a.userId, p_kind: a.kind, p_hash: a.hash } }) as const;

export const setUserRoleCall = (a: { actorId: string; userId: string; role: string }) =>
  ({ fn: "admin_user_set_role", args: { p_actor: a.actorId, p_user: a.userId, p_role: a.role } }) as const;

export const setUserLocationsCall = (a: { actorId: string; userId: string; locationIds: readonly string[] }) =>
  ({ fn: "admin_user_set_locations", args: { p_actor: a.actorId, p_user: a.userId, p_locations: [...a.locationIds] } }) as const;

export const setUserDormantCall = (a: { actorId: string; userId: string; dormant: boolean; expectedDormantAt: string | null }) =>
  ({ fn: "admin_user_set_dormant", args: { p_actor: a.actorId, p_user: a.userId, p_dormant: a.dormant, p_expected: a.expectedDormantAt } }) as const;

export const updateUserProfileCall = (a: { actorId: string; userId: string; patch: { name?: string; phone?: string | null; email?: string | null } }) =>
  ({ fn: "admin_user_update_profile", args: { p_actor: a.actorId, p_user: a.userId, p_patch: { ...a.patch } } }) as const;

/** Add user in ONE transaction (Astra BC-007/004): the actor re-checked under its row lock, the user and every membership. */
export const createUserCall = (a: {
  actorId: string; name: string; role: string; email: string | null; phone: string | null; pinHash: string; passwordHash: string | null;
  locationIds: readonly string[];
  /** The Toast employee picked on the form (the writer re-runs the rehire match by it and by the phone). */
  toastGuid: string | null;
  /** The creator confirmed past these separated matches (the writer's own match must be covered by them). */
  rehireConfirmed: boolean; rehireUserIds: readonly string[];
  /** Required when a match is "not eligible for rehire". */
  rehireReason: string | null;
}) => ({ fn: "admin_user_create", args: { p_actor: a.actorId, p_name: a.name, p_role: a.role, p_email: a.email, p_phone: a.phone,
  p_pin_hash: a.pinHash, p_password_hash: a.passwordHash, p_locations: [...a.locationIds], p_toast_guid: a.toastGuid,
  p_rehire_confirmed: a.rehireConfirmed, p_rehire_user_ids: [...a.rehireUserIds], p_rehire_reason: a.rehireReason } }) as const;

/** Postgres lock refusals that are not a rule: a deadlock victim (40P01) or a lock not available (55P03). */
export const USER_ADMIN_BUSY_SQLSTATES: readonly string[] = ["40P01", "55P03"];

/** 0279's named refusals for the user-admin writers → the HTTP status and the code the screen knows. */
export const USER_ADMIN_RPC_ERRORS: Readonly<Record<string, { status: number; code: string }>> = {
  invalid_payload: { status: 400, code: "invalid_payload" },
  forbidden: { status: 403, code: "forbidden" },
  target_outside_shop: { status: 403, code: "target_outside_shop" },
  user_not_found: { status: 404, code: "not_found" },
  use_back_from_leave: { status: 409, code: "use_back_from_leave" },
  use_rehire: { status: 409, code: "use_rehire" },
  locations_required: { status: 400, code: "locations_required" },
  dormancy_changed: { status: 409, code: "dormancy_changed" },
  invalid_name: { status: 400, code: "invalid_name" },
  email_taken: { status: 409, code: "email_taken" },
  email_required: { status: 400, code: "email_required" },
  password_required: { status: 400, code: "password_required" },
  rehire_match: { status: 409, code: "rehire_match" },
  rehire_permission_required: { status: 403, code: "rehire_permission_required" },
  rehire_reason_required: { status: 400, code: "rehire_reason_required" },
};
