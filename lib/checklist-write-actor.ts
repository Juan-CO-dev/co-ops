import "server-only";
import type { AuthContext } from "./session";
import { getServiceRoleClient } from "./supabase-server";
import { getRoleLevel, isRoleCode, type RoleCode } from "./roles";
import type { ChecklistWriteAuthority } from "./checklist-write-guard-shared";

declare const verifiedChecklistActor: unique symbol;
export type ChecklistWriteActor = ChecklistWriteAuthority & {
  readonly sessionId: string;
  readonly role: RoleCode;
  readonly [verifiedChecklistActor]: true;
};

export class ChecklistActorNotAuthorizedError extends Error {
  constructor() { super("checklist_actor_not_authorized"); }
}

export class ChecklistActorTransientError extends Error {
  constructor() { super("checklist_actor_unavailable"); }
}

/** Call only with requireSession/requireSessionFromHeaders' verified context.
 * No body attribution or JWT authorization claims are accepted. R8 membership
 * means active user_locations rows, without a global override. This preserves
 * the app's stronger rule than the live RLS helper's unfiltered membership.
 * Read fresh membership rather than allowing AuthContext's JWT fallback.
 * These reads fail closed; SQL repeats user/membership checks under parent lock.
 */
export async function resolveChecklistWriteActor(auth: AuthContext): Promise<ChecklistWriteActor> {
  const db = getServiceRoleClient();
  const [sessionResult, userResult, locationsResult] = await Promise.all([
    db.from("sessions").select("id,user_id,revoked_at,expires_at")
      .eq("id", auth.session.id).maybeSingle(),
    db.from("users").select("id,role,active").eq("id", auth.user.id).maybeSingle(),
    db.from("user_locations").select("location_id").eq("user_id", auth.user.id).eq("active", true),
  ]).catch(() => { throw new ChecklistActorTransientError(); });
  const session = sessionResult.data;
  const user = userResult.data;
  if (sessionResult.error || userResult.error || locationsResult.error) {
    throw new ChecklistActorTransientError();
  }
  if (!session || !user || !locationsResult.data
    || session.user_id !== auth.user.id || auth.session.userId !== auth.user.id
    || session.revoked_at !== null || !(Date.parse(session.expires_at) > Date.now())
    || !user.active || !isRoleCode(user.role)) {
    throw new ChecklistActorNotAuthorizedError();
  }
  return Object.freeze({
    userId: auth.user.id,
    sessionId: session.id as string,
    active: true,
    role: user.role,
    level: getRoleLevel(user.role),
    locations: Object.freeze(locationsResult.data.map((row) => row.location_id as string)),
  }) as ChecklistWriteActor;
}
